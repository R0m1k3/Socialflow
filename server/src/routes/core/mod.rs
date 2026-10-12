//! STUB — routes principales à porter depuis `server/routes.ts`.

use axum::Router;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
}
