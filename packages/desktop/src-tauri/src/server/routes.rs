use axum::Router;
use std::sync::Arc;
use crate::server::state::AppState;

pub fn create_router(_state: Arc<AppState>) -> Router {
    Router::new()
}
