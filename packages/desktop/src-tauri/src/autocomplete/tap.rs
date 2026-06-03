use std::sync::Arc;
use std::time::Duration;

use super::buffer::WordBuffer;
use super::state::AutocompleteState;

pub fn start_monitor(state: Arc<AutocompleteState>) {
    // Idle-reset task: if no keystroke for 3s, reset to fallback phrases.
    let idle_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        loop {
            interval.tick().await;
            let elapsed = idle_state
                .last_keystroke
                .lock()
                .unwrap()
                .elapsed();
            if elapsed > Duration::from_secs(3) {
                idle_state.reset_to_fallback();
            }
        }
    });

    // Keyboard tap thread — rdev::listen is blocking, must run in a dedicated std::thread.
    std::thread::spawn(move || {
        let mut buffer = WordBuffer::new();
        if let Err(e) = rdev::listen(move |event: rdev::Event| {
            if !state.is_enabled() {
                return;
            }
            if let rdev::EventType::KeyPress(_) = event.event_type {
                if let Some(name) = event.name {
                    if let Some(ch) = name.chars().next() {
                        let was_boundary = buffer.push(ch);
                        let (count, fallback) = {
                            let cfg = state.config.lock().unwrap();
                            (cfg.suggestion_count, cfg.fallback_phrases.clone())
                        };
                        if was_boundary {
                            state.set_suggestions(fallback);
                            return;
                        }
                        let partial = buffer.current();
                        if partial.len() < 2 {
                            return;
                        }
                        let completions = super::spell::get_completions(&partial, count);
                        if completions.is_empty() {
                            state.set_suggestions(fallback);
                        } else {
                            state.set_suggestions(completions);
                        }
                    }
                }
            }
        }) {
            tracing::warn!(error = ?e, "keyboard monitor stopped (check Accessibility permission in System Settings → Privacy & Security)");
        }
    });
}
