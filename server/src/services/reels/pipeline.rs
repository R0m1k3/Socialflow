//! Rendu d'un Reel à partir d'une vidéo, puis médiathèque et publication.
//! Exécuté par la file `reel_jobs` (voir `queue.rs`).
//!
//! Deux moteurs :
//! - « remotion » (défaut) : le service Python prépare l'image (recadrage, HDR,
//!   stabilisation) et la piste son finale, le service Remotion compose les
//!   sous-titres animés, le logo et l'effet de fin — le même rendu que l'aperçu ;
//! - « ffmpeg » : tout est fait par le service Python (sous-titres ASS),
//!   plus rapide, conservé en secours (`REEL_RENDERER=ffmpeg`).

use std::time::Instant;

use anyhow::{anyhow, bail};
use bytes::Bytes;
use serde_json::{json, Map, Value};

use super::assets::{
    resolve_gemini_api_key, resolve_logo_path, resolve_music_url, resolve_qwen_target,
};
use super::params::{parse_video_reel_params, VideoReelParams};
use super::publish::{
    describe_publish_failure, publish_reel_to_pages, store_rendered_video, PublishOptions,
};
use super::queue::JobContext;
use super::remotion::{render_composition, temp_file_url, to_data_url};
use crate::db::MediaType;
use crate::services::ffmpeg::{self, ReelRenderOptions};
use crate::services::media_store;
use crate::state::AppState;

/// Moteur demandé par la configuration (`REEL_RENDERER`).
pub fn configured_renderer(state: &AppState) -> &'static str {
    if state.config.reel_renderer == "ffmpeg" {
        "ffmpeg"
    } else {
        "remotion"
    }
}

/// Moteur réellement utilisé : Remotion exige l'adresse de son service.
pub fn effective_renderer(state: &AppState) -> &'static str {
    match configured_renderer(state) {
        "remotion" if state.config.remotion_url.is_some() => "remotion",
        _ => "ffmpeg",
    }
}

pub async fn run_video_reel_job(ctx: &JobContext) -> anyhow::Result<Value> {
    let state = &ctx.state;
    let job = &ctx.job;
    let post_id = job
        .post_id
        .as_deref()
        .ok_or_else(|| anyhow!("Job vidéo sans post associé"))?;
    let params = parse_video_reel_params(&job.params).map_err(|issue| anyhow!(issue))?;

    ctx.progress(5, "prepare").await?;
    let media = state.db.get_media_by_id(&params.video_media_id).await?;
    let Some(media) = media.filter(|m| m.media_type == MediaType::Video) else {
        bail!("Vidéo source introuvable ou invalide");
    };

    let engine = params.tts_engine.as_deref();
    let (music_url, logo_path, gemini_api_key, qwen) = tokio::join!(
        resolve_music_url(
            state,
            params.music_track_id.as_deref(),
            params.music_url.as_deref()
        ),
        resolve_logo_path(state),
        resolve_gemini_api_key(state, engine),
        resolve_qwen_target(state, engine),
    );

    let options = ReelRenderOptions {
        text: if params.srt_cues.is_some() {
            None
        } else {
            params.overlay_text.clone()
        },
        srt_cues: params.srt_cues.clone(),
        music_url,
        tts_enabled: Some(params.tts_enabled),
        tts_voice: params.tts_voice.clone(),
        tts_engine: params.tts_engine.clone(),
        tts_style: params.tts_style.clone(),
        gemini_api_key: gemini_api_key?,
        qwen: qwen?,
        font_size: Some(params.font_size),
        music_volume: Some(params.music_volume),
        draw_text: Some(params.draw_text),
        stabilize: Some(params.stabilize),
        watermark_url: None,
        store_name: params.store_name.clone(),
        enable_ending_effect: Some(params.enable_ending_effect),
        show_logo: Some(params.show_logo),
    };

    let renderer = match (configured_renderer(state), &state.config.remotion_url) {
        ("remotion", None) => {
            tracing::warn!(
                "⚠️ [Reels] REMOTION_RENDERER_URL non défini : rendu par le service FFmpeg à la place de Remotion"
            );
            "ffmpeg"
        }
        (renderer, _) => renderer,
    };

    let video_url = media_store::resolve_internal_url(state, &media.original_url);
    let started = Instant::now();
    let video = match (renderer, state.config.remotion_url.as_deref()) {
        ("remotion", Some(base_url)) => {
            render_with_remotion(
                ctx,
                base_url,
                &video_url,
                &options,
                &params,
                logo_path.as_deref(),
            )
            .await?
        }
        _ => render_with_ffmpeg(ctx, &video_url, options, logo_path.as_deref()).await?,
    };
    tracing::info!(
        "⏱️ [Reels] Rendu {renderer} : {:.1} s",
        started.elapsed().as_secs_f64()
    );

    ctx.progress(88, "store").await?;
    let file_name = format!("reel-{}.mp4", chrono::Utc::now().timestamp_millis());
    let processed = store_rendered_video(state, &job.user_id, &video, &file_name).await?;
    state
        .db
        .update_post_media(post_id, std::slice::from_ref(&processed.id))
        .await?;

    ctx.progress(93, "publish").await?;
    let description = params
        .description
        .clone()
        .or_else(|| params.overlay_text.clone())
        .unwrap_or_default();
    let results = publish_reel_to_pages(
        state,
        PublishOptions {
            post_id,
            page_ids: &params.page_ids,
            video,
            description: &description,
            scheduled_for: params.scheduled_for.as_deref(),
            also_story: params.also_story,
        },
    )
    .await?;

    if !results.iter().any(|r| r.success) {
        bail!(describe_publish_failure(&results));
    }

    Ok(json!({ "mediaId": processed.id, "renderer": renderer, "results": results }))
}

async fn render_with_ffmpeg(
    ctx: &JobContext,
    video_url: &str,
    mut options: ReelRenderOptions,
    logo_path: Option<&str>,
) -> anyhow::Result<Bytes> {
    ctx.progress(15, "render").await?;
    // Le logo sert au coin de la vidéo et/ou à l'effet de fin : inutile de l'envoyer si aucun des deux
    let logo_used = options.show_logo != Some(false) || options.enable_ending_effect != Some(false);
    options.watermark_url = logo_path
        .filter(|_| logo_used)
        .map(|path| media_store::resolve_internal_url(&ctx.state, path));
    let rendered = ffmpeg::render_reel(&ctx.state, video_url, &options).await?;
    Ok(rendered.video)
}

async fn render_with_remotion(
    ctx: &JobContext,
    base_url: &str,
    video_url: &str,
    options: &ReelRenderOptions,
    params: &VideoReelParams,
    logo_path: Option<&str>,
) -> anyhow::Result<Bytes> {
    let state = &ctx.state;
    let workdir = state
        .config
        .temp_upload_dir
        .join(format!("reel-{}", ctx.job.id));
    let result = async {
        // 1. Image recadrée à la durée finale, piste son finale, mots minutés
        ctx.progress(10, "voice").await?;
        let prepared =
            ffmpeg::prepare_reel(state, video_url, options, logo_path.is_some(), &workdir).await?;

        // 2. Composition : sous-titres animés, logo, effet de fin
        ctx.progress(40, "render").await?;
        let mut props = Map::new();
        props.insert(
            "videoUrl".into(),
            temp_file_url(state, &prepared.video_path).into(),
        );
        props.insert("videoDuration".into(), prepared.total_duration.into());
        props.insert("totalDuration".into(), prepared.total_duration.into());
        props.insert("words".into(), serde_json::to_value(&prepared.words)?);
        props.insert("captionStyle".into(), params.caption_style.clone().into());
        if let Some(logo) = logo_path {
            props.insert("logoUrl".into(), to_data_url(state, logo).await?.into());
        }
        props.insert("showWatermark".into(), params.show_logo.into());
        if params.enable_ending_effect {
            if let Some(name) = &params.store_name {
                props.insert("storeName".into(), name.clone().into());
            }
        }
        props.insert("logoStart".into(), prepared.logo_start.into());
        props.insert("fadeStart".into(), prepared.fade_start.into());
        props.insert("fadeDuration".into(), prepared.fade_duration.into());
        if let Some(audio) = &prepared.audio_path {
            props.insert("mixedAudioUrl".into(), temp_file_url(state, audio).into());
        }

        let output = workdir.join("reel.mp4");
        let mut last_reported = 40;
        render_composition(
            state,
            base_url,
            "ReelVideo",
            Value::Object(props),
            &output,
            |ratio| {
                let pct = 40 + (ratio * 45.0).floor() as i32;
                let report = pct >= last_reported + 5;
                if report {
                    last_reported = pct;
                }
                async move {
                    if report {
                        // Non bloquant : un échec d'écriture n'interrompt pas le rendu
                        let _ = ctx.progress(pct, "render").await;
                    }
                }
            },
        )
        .await?;
        Ok(Bytes::from(tokio::fs::read(&output).await?))
    }
    .await;

    // Dossier toujours nettoyé, rendu réussi ou non
    let _ = tokio::fs::remove_dir_all(&workdir).await;
    result
}
