//! STUB — routes à porter (voir `server/routes/facebook.ts`).

use axum::Router;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
}
