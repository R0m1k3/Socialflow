//! Lignes de la base, sérialisées en camelCase comme les objets Drizzle que
//! renvoyait l'ancien serveur.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;

use crate::time::Ts;

macro_rules! pg_enum {
    ($name:ident, $pg:literal, { $($variant:ident => $text:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, sqlx::Type)]
        #[sqlx(type_name = $pg)]
        pub enum $name {
            $(
                #[serde(rename = $text)]
                #[sqlx(rename = $text)]
                $variant,
            )+
        }

        impl $name {
            pub fn as_str(&self) -> &'static str {
                match self {
                    $( $name::$variant => $text, )+
                }
            }

            pub fn parse(value: &str) -> Option<Self> {
                match value {
                    $( $text => Some($name::$variant), )+
                    _ => None,
                }
            }

            /// Nom du type énuméré PostgreSQL (pour les conversions `$1::type`).
            #[allow(dead_code)]
            pub const PG_TYPE: &'static str = $pg;
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str(self.as_str())
            }
        }
    };
}

pg_enum!(Platform, "platform", { Facebook => "facebook", Instagram => "instagram", Tiktok => "tiktok" });
pg_enum!(PostType, "post_type", { Feed => "feed", Story => "story", Both => "both", Reel => "reel" });
pg_enum!(PostStatus, "post_status", { Draft => "draft", Scheduled => "scheduled", Published => "published", Failed => "failed" });
pg_enum!(MediaType, "media_type", { Image => "image", Video => "video" });
pg_enum!(UserRole, "user_role", { Admin => "admin", User => "user" });
pg_enum!(TokenStatus, "token_status", { Valid => "valid", Expiring => "expiring", Expired => "expired", Error => "error" });

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub username: String,
    #[serde(skip_serializing)]
    pub password: String,
    pub role: UserRole,
}

impl User {
    pub fn is_admin(&self) -> bool {
        self.role == UserRole::Admin
    }
}

/// Page ou compte connecté. Les jetons sont **déchiffrés** par la couche
/// d'accès aux données ; ils ne sont jamais sérialisés vers le navigateur.
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SocialPage {
    pub id: String,
    pub user_id: String,
    pub platform: Platform,
    pub page_id: String,
    pub page_name: String,
    #[serde(skip_serializing)]
    pub access_token: String,
    pub token_expires_at: Option<Ts>,
    pub followers_count: Option<i32>,
    pub is_active: String,
    pub token_status: Option<TokenStatus>,
    pub last_token_check: Option<Ts>,
    #[serde(skip_serializing)]
    pub user_access_token: Option<String>,
    pub user_token_expires_at: Option<Ts>,
    pub token_error: Option<String>,
    #[serde(skip_serializing)]
    pub refresh_token: Option<String>,
    pub refresh_token_expires_at: Option<Ts>,
    pub scopes: Option<String>,
    pub avatar_url: Option<String>,
    pub created_at: Option<Ts>,
}

impl SocialPage {
    /// Vue client : sans jetons, avec l'indicateur de renouvellement automatique.
    pub fn to_client(&self) -> Value {
        let mut value = serde_json::to_value(self).unwrap_or(Value::Null);
        let auto_renew = match self.platform {
            Platform::Tiktok => self.refresh_token.as_deref().is_some_and(|t| !t.is_empty()),
            _ => self
                .user_access_token
                .as_deref()
                .is_some_and(|t| !t.is_empty()),
        };
        if let Value::Object(map) = &mut value {
            map.insert("autoRenew".into(), Value::Bool(auto_renew));
        }
        value
    }
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    pub id: String,
    pub user_id: String,
    #[serde(rename = "type")]
    #[sqlx(rename = "type")]
    pub media_type: MediaType,
    pub cloudinary_public_id: Option<String>,
    pub original_url: String,
    pub facebook_landscape_url: Option<String>,
    pub facebook_feed_url: Option<String>,
    pub instagram_feed_url: Option<String>,
    pub instagram_story_url: Option<String>,
    pub thumbnail_url: Option<String>,
    pub file_name: String,
    pub file_size: i32,
    pub created_at: Option<Ts>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Post {
    pub id: String,
    pub user_id: String,
    pub content: String,
    pub ai_generated: String,
    pub product_info: Option<Value>,
    pub status: PostStatus,
    pub scheduled_for: Option<Ts>,
    pub generation_status: Option<String>,
    pub generation_progress: Option<i32>,
    pub generation_error: Option<String>,
    pub created_at: Option<Ts>,
    pub updated_at: Option<Ts>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PostMedia {
    pub id: String,
    pub post_id: String,
    pub media_id: String,
    pub display_order: i32,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledPost {
    pub id: String,
    pub post_id: String,
    pub page_id: String,
    pub post_type: PostType,
    pub scheduled_at: Ts,
    pub published_at: Option<Ts>,
    pub external_post_id: Option<String>,
    pub error: Option<String>,
    pub publish_id: Option<String>,
    pub publish_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AiGeneration {
    pub id: String,
    pub user_id: String,
    pub product_info: Value,
    pub generated_texts: Value,
    pub selected_text: Option<String>,
    pub created_at: Option<Ts>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CloudinaryConfig {
    pub id: String,
    pub cloud_name: String,
    pub api_key: String,
    #[serde(skip_serializing)]
    pub api_secret: String,
    pub logo_public_id: Option<String>,
    pub endpoint_url: Option<String>,
    pub public_url: Option<String>,
    pub created_at: Option<Ts>,
    pub updated_at: Option<Ts>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct OpenrouterConfig {
    pub id: String,
    pub user_id: String,
    #[serde(skip_serializing)]
    pub api_key: String,
    pub model: String,
    pub system_prompt: String,
    pub created_at: Option<Ts>,
    pub updated_at: Option<Ts>,
}

/// Application développeur Facebook (secret déchiffré).
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct FacebookConfig {
    pub id: String,
    pub app_id: String,
    #[serde(skip_serializing)]
    pub app_secret: String,
    pub created_at: Option<Ts>,
    pub updated_at: Option<Ts>,
}

/// Application développeur TikTok (secret déchiffré).
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TiktokConfig {
    pub id: String,
    pub client_key: String,
    #[serde(skip_serializing)]
    pub client_secret: String,
    pub created_at: Option<Ts>,
    pub updated_at: Option<Ts>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MusicFavorite {
    pub id: String,
    pub user_id: String,
    pub track_id: String,
    pub title: String,
    pub artist: String,
    pub album_name: Option<String>,
    pub duration: i32,
    pub preview_url: String,
    pub download_url: String,
    pub image_url: Option<String>,
    pub license: Option<String>,
    pub created_at: Option<Ts>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub id: String,
    pub external_api_key: Option<String>,
    pub gemini_api_key: Option<String>,
    pub qwen_tts_url: Option<String>,
    pub qwen_tts_api_key: Option<String>,
    pub created_at: Option<Ts>,
    pub updated_at: Option<Ts>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrack {
    pub id: String,
    pub user_id: Option<String>,
    pub title: String,
    pub file_name: String,
    pub url: String,
    pub duration: Option<i32>,
    pub created_at: Option<Ts>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct UserPagePermission {
    pub id: String,
    pub user_id: String,
    pub page_id: String,
    pub created_at: Option<Ts>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ReelJob {
    pub id: String,
    pub user_id: String,
    pub post_id: Option<String>,
    pub kind: String,
    pub params: Value,
    pub status: String,
    pub step: Option<String>,
    pub progress: i32,
    pub attempts: i32,
    pub result: Option<Value>,
    pub error: Option<String>,
    pub heartbeat_at: Option<Ts>,
    pub created_at: Ts,
    pub updated_at: Ts,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PostAnalytics {
    pub id: String,
    pub post_id: String,
    pub fetched_at: Option<Ts>,
    pub impressions: Option<i32>,
    pub reach: Option<i32>,
    pub engagement: Option<i32>,
    pub reactions: Option<i32>,
    pub comments: Option<i32>,
    pub shares: Option<i32>,
    pub clicks: Option<i32>,
    pub raw_data: Option<Value>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PageAnalyticsHistory {
    pub id: String,
    pub page_id: String,
    pub date: Ts,
    pub followers_count: Option<i32>,
    pub page_views: Option<i32>,
    pub page_reach: Option<i32>,
    pub page_engagement: Option<i32>,
    pub created_at: Option<Ts>,
}

/// Publication planifiée accompagnée du post et de la page (sans jetons),
/// telle que la renvoyaient les routes du calendrier et de l'historique.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledPostWithDetails {
    #[serde(flatten)]
    pub scheduled: ScheduledPost,
    pub post: ScheduledPostPost,
    pub page: Option<ScheduledPostPage>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledPostPost {
    pub id: String,
    pub user_id: String,
    pub content: String,
    pub status: PostStatus,
    pub scheduled_for: Option<Ts>,
    pub ai_generated: String,
    pub generation_status: Option<String>,
    pub generation_progress: Option<i32>,
    pub created_at: Option<Ts>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledPostPage {
    pub id: String,
    pub page_id: String,
    pub page_name: String,
    pub platform: Platform,
    pub avatar_url: Option<String>,
}
