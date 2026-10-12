//! Client minimal de l'API Graph (ex-`utils/graph_client.ts`), utilisé par le
//! contrôle des jetons et les statistiques.

use serde_json::Value;

use crate::state::AppState;

const GRAPH_API_VERSION: &str = "v19.0";

/// Erreur renvoyée par l'API Graph (`{ error: { message, code, fbtrace_id } }`).
#[derive(Debug, Clone, thiserror::Error)]
#[error("{message}")]
pub struct FacebookApiError {
    pub message: String,
    pub status: u16,
    pub code: i64,
    pub fb_trace_id: String,
}

/// Code d'erreur Graph d'une erreur `anyhow`, s'il s'agit d'une [`FacebookApiError`].
pub fn error_code(error: &anyhow::Error) -> Option<i64> {
    error.downcast_ref::<FacebookApiError>().map(|e| e.code)
}

/// URL complète d'un appel : `endpoint` avec ou sans « / » initial, jeton puis
/// paramètres en query string.
pub fn build_url(
    endpoint: &str,
    access_token: Option<&str>,
    params: &[(&str, &str)],
) -> anyhow::Result<url::Url> {
    let path = if endpoint.starts_with('/') {
        endpoint.to_string()
    } else {
        format!("/{endpoint}")
    };
    let mut url = url::Url::parse(&format!(
        "https://graph.facebook.com/{GRAPH_API_VERSION}{path}"
    ))?;
    {
        let mut query = url.query_pairs_mut();
        if let Some(token) = access_token.filter(|t| !t.is_empty()) {
            query.append_pair("access_token", token);
        }
        for (key, value) in params {
            query.append_pair(key, value);
        }
    }
    Ok(url)
}

/// `GET` sur l'API Graph.
pub async fn get(
    state: &AppState,
    endpoint: &str,
    access_token: Option<&str>,
    params: &[(&str, &str)],
) -> anyhow::Result<Value> {
    let url = build_url(endpoint, access_token, params)?;
    tracing::info!("[GraphAPI] GET {endpoint}");
    let response = state.http.get(url).send().await?;
    handle_response(response).await
}

/// `POST` d'un corps JSON sur l'API Graph.
pub async fn post(
    state: &AppState,
    endpoint: &str,
    body: &Value,
    access_token: Option<&str>,
    params: &[(&str, &str)],
) -> anyhow::Result<Value> {
    let url = build_url(endpoint, access_token, params)?;
    tracing::info!("[GraphAPI] POST {endpoint}");
    let response = state.http.post(url).json(body).send().await?;
    handle_response(response).await
}

async fn handle_response(response: reqwest::Response) -> anyhow::Result<Value> {
    let status = response.status();
    let data: Value = response.json().await?;
    if !status.is_success() {
        return Err(api_error(status.as_u16(), &data).into());
    }
    Ok(data)
}

fn api_error(status: u16, data: &Value) -> FacebookApiError {
    let error = data.get("error");
    let field = |key: &str| error.and_then(|e| e.get(key));
    FacebookApiError {
        message: field("message")
            .and_then(Value::as_str)
            .filter(|m| !m.is_empty())
            .unwrap_or("Unknown Facebook API Error")
            .to_string(),
        status,
        code: field("code").and_then(Value::as_i64).unwrap_or(0),
        fb_trace_id: field("fbtrace_id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn url_with_and_without_leading_slash() {
        let a = build_url("me", Some("TOKEN"), &[]).unwrap();
        assert_eq!(
            a.as_str(),
            "https://graph.facebook.com/v19.0/me?access_token=TOKEN"
        );
        let b = build_url(
            "/123/insights/page_views_total",
            Some("T"),
            &[("period", "day")],
        )
        .unwrap();
        assert_eq!(
            b.as_str(),
            "https://graph.facebook.com/v19.0/123/insights/page_views_total?access_token=T&period=day"
        );
    }

    #[test]
    fn params_are_encoded() {
        let url = build_url(
            "1_2",
            Some("a b"),
            &[("fields", "insights.metric(post_clicks),shares")],
        )
        .unwrap();
        assert_eq!(
            url.query(),
            Some("access_token=a+b&fields=insights.metric%28post_clicks%29%2Cshares")
        );
    }

    #[test]
    fn error_structure_is_parsed() {
        let err = api_error(
            400,
            &json!({ "error": { "message": "Bad token", "code": 190, "fbtrace_id": "X" } }),
        );
        assert_eq!(err.message, "Bad token");
        assert_eq!(err.code, 190);
        assert_eq!(err.fb_trace_id, "X");
        let unknown = api_error(500, &json!({}));
        assert_eq!(unknown.message, "Unknown Facebook API Error");
        assert_eq!(unknown.code, 0);
        let any: anyhow::Error = err.into();
        assert_eq!(error_code(&any), Some(190));
    }
}
