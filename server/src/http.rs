//! Intergiciels HTTP : en-têtes de sécurité (équivalent de helmet), limitation
//! de débit par IP et journal des appels `/api`.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::extract::{ConnectInfo, Request, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use serde_json::json;

use crate::state::AppState;

/// Fenêtre fixe par IP, comme express-rate-limit.
pub struct RateLimiter {
    max: u32,
    window: Duration,
    hits: Mutex<HashMap<IpAddr, (Instant, u32)>>,
}

pub struct RateDecision {
    pub allowed: bool,
    pub limit: u32,
    pub remaining: u32,
    pub reset_secs: u64,
}

impl RateLimiter {
    pub fn new(max: u32, window: Duration) -> Self {
        Self { max, window, hits: Mutex::new(HashMap::new()) }
    }

    pub fn check(&self, ip: IpAddr) -> RateDecision {
        let now = Instant::now();
        let mut hits = self.hits.lock().expect("verrou du limiteur");
        if hits.len() > 10_000 {
            let window = self.window;
            hits.retain(|_, (start, _)| now.duration_since(*start) < window);
        }
        let entry = hits.entry(ip).or_insert((now, 0));
        if now.duration_since(entry.0) >= self.window {
            *entry = (now, 0);
        }
        entry.1 += 1;
        let reset = self.window.saturating_sub(now.duration_since(entry.0));
        RateDecision {
            allowed: entry.1 <= self.max,
            limit: self.max,
            remaining: self.max.saturating_sub(entry.1),
            reset_secs: reset.as_secs(),
        }
    }
}

/// IP du client : dernier saut de `X-Forwarded-For` (posé par Nginx, `trust proxy 1`),
/// sinon l'adresse de la connexion.
pub fn client_ip(headers: &HeaderMap, peer: Option<SocketAddr>) -> IpAddr {
    if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(ip) = xff.split(',').map(str::trim).filter(|s| !s.is_empty()).last() {
            if let Ok(ip) = ip.parse() {
                return ip;
            }
        }
    }
    peer.map(|p| p.ip()).unwrap_or(IpAddr::from([127, 0, 0, 1]))
}

pub async fn rate_limit(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let path = request.uri().path();
    if !path.starts_with("/api/") {
        return next.run(request).await;
    }
    let peer = request.extensions().get::<ConnectInfo<SocketAddr>>().map(|c| c.0);
    let ip = client_ip(request.headers(), peer);

    let decision = state.global_limiter.check(ip);
    if !decision.allowed {
        return too_many(&decision, "Trop de requêtes, réessayez plus tard");
    }
    if path == "/api/auth/login" {
        let auth = state.auth_limiter.check(ip);
        if !auth.allowed {
            return too_many(&auth, "Trop de tentatives de connexion, réessayez dans 15 minutes");
        }
    }

    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert("ratelimit-limit", HeaderValue::from(decision.limit));
    headers.insert("ratelimit-remaining", HeaderValue::from(decision.remaining));
    headers.insert("ratelimit-reset", HeaderValue::from(decision.reset_secs));
    response
}

fn too_many(decision: &RateDecision, message: &str) -> Response {
    let mut response = (StatusCode::TOO_MANY_REQUESTS, axum::Json(json!({ "error": message }))).into_response();
    let headers = response.headers_mut();
    headers.insert("ratelimit-limit", HeaderValue::from(decision.limit));
    headers.insert("ratelimit-remaining", HeaderValue::from(0u32));
    headers.insert("ratelimit-reset", HeaderValue::from(decision.reset_secs));
    headers.insert("retry-after", HeaderValue::from(decision.reset_secs));
    response
}

const CSP: &str = "default-src 'self';\
base-uri 'self';\
font-src 'self' https://fonts.gstatic.com;\
form-action 'self';\
frame-ancestors 'self';\
img-src 'self' data: https: blob:;\
object-src 'none';\
script-src 'self' 'unsafe-inline' 'unsafe-eval';\
script-src-attr 'none';\
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;\
connect-src 'self' https://graph.facebook.com https://openrouter.ai https://res.cloudinary.com wss: ws:;\
media-src 'self' https: data:;\
upgrade-insecure-requests";

/// En-têtes posés par helmet dans l'ancien serveur.
pub async fn security_headers(request: Request, next: Next) -> Response {
    let is_upload = request.uri().path().starts_with("/uploads/");
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    let mut set = |name: &'static str, value: &'static str| {
        headers
            .entry(HeaderName::from_static(name))
            .or_insert(HeaderValue::from_static(value));
    };
    set("content-security-policy", CSP);
    set("cross-origin-opener-policy", "same-origin");
    // Les fichiers téléversés sont lus par d'autres origines (rendu des Reels)
    set("cross-origin-resource-policy", if is_upload { "cross-origin" } else { "same-origin" });
    set("origin-agent-cluster", "?1");
    set("referrer-policy", "no-referrer");
    set("strict-transport-security", "max-age=31536000; includeSubDomains");
    set("x-content-type-options", "nosniff");
    set("x-dns-prefetch-control", "off");
    set("x-download-options", "noopen");
    set("x-frame-options", "SAMEORIGIN");
    set("x-permitted-cross-domain-policies", "none");
    set("x-xss-protection", "0");
    response
}

/// Journal des appels `/api` (méthode, chemin, statut, durée).
pub async fn log_requests(request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();
    if !path.starts_with("/api") {
        return next.run(request).await;
    }
    let method = request.method().clone();
    let started = Instant::now();
    let response = next.run(request).await;
    let status = response.status();
    // Les 401 de /api/auth/session sont la vérification normale de session
    if !(path == "/api/auth/session" && status == StatusCode::UNAUTHORIZED) {
        tracing::info!("{method} {path} {} in {}ms", status.as_u16(), started.elapsed().as_millis());
    }
    response
}
