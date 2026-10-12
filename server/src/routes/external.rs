//! STUB — routes à porter (voir `server/routes/external.ts`).

use axum::Router;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
}
