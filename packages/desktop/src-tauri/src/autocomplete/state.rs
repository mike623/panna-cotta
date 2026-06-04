use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::sync::watch;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutocompleteConfig {
    pub enabled: bool,
    pub suggestion_count: usize,
    pub fallback_phrases: Vec<String>,
}

impl Default for AutocompleteConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            suggestion_count: 3,
            fallback_phrases: vec![
                "Thanks".into(),
                "On my way".into(),
                "👍".into(),
            ],
        }
    }
}

/// Payload sent on the SSE channel.
/// `partial` is the word fragment already typed; the client types only the suffix.
/// Empty string means show full word (fallback phrases, or word boundary reset).
#[derive(Debug, Clone)]
pub struct SuggestionUpdate {
    pub words:   Vec<String>,
    pub partial: String,
}

pub struct AutocompleteState {
    pub config: Mutex<AutocompleteConfig>,
    pub last_keystroke: Mutex<Instant>,
    pub monitor_running: std::sync::atomic::AtomicBool,
    /// True while the admin window has focus.
    pub admin_focused: std::sync::atomic::AtomicBool,
    /// CFMachPortRef for the live CGEventTap (stored as usize). 0 = tap not created.
    /// Paused/resumed via CGEventTapEnable — never stopped/restarted.
    pub tap_port: std::sync::atomic::AtomicUsize,
    suggestions_tx: watch::Sender<SuggestionUpdate>,
}

impl AutocompleteState {
    pub fn new(config: AutocompleteConfig) -> Self {
        let fallback = config.fallback_phrases.clone();
        let (tx, _rx) = watch::channel(SuggestionUpdate { words: fallback, partial: String::new() });
        Self {
            config: Mutex::new(config),
            last_keystroke: Mutex::new(Instant::now()),
            monitor_running: std::sync::atomic::AtomicBool::new(false),
            admin_focused: std::sync::atomic::AtomicBool::new(false),
            tap_port: std::sync::atomic::AtomicUsize::new(0),
            suggestions_tx: tx,
        }
    }

    pub fn subscribe(&self) -> watch::Receiver<SuggestionUpdate> {
        self.suggestions_tx.subscribe()
    }

    /// `partial` — the word fragment already typed. Client types only the suffix.
    pub fn set_suggestions(&self, words: Vec<String>, partial: String) {
        *self.last_keystroke.lock().unwrap_or_else(|e| e.into_inner()) = Instant::now();
        let _ = self.suggestions_tx.send(SuggestionUpdate { words, partial });
    }

    pub fn reset_to_fallback(&self) {
        *self.last_keystroke.lock().unwrap_or_else(|e| e.into_inner()) =
            Instant::now() - Duration::from_secs(60);
        let fallback = self.config.lock().unwrap_or_else(|e| e.into_inner()).fallback_phrases.clone();
        let _ = self.suggestions_tx.send(SuggestionUpdate { words: fallback, partial: String::new() });
    }

    pub fn is_enabled(&self) -> bool {
        self.config.lock().unwrap_or_else(|e| e.into_inner()).enabled
    }
}
