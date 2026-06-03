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

pub struct AutocompleteState {
    pub config: Mutex<AutocompleteConfig>,
    pub last_keystroke: Mutex<Instant>,
    pub monitor_running: std::sync::atomic::AtomicBool,
    suggestions_tx: watch::Sender<Vec<String>>,
}

impl AutocompleteState {
    pub fn new(config: AutocompleteConfig) -> Self {
        let fallback = config.fallback_phrases.clone();
        let (tx, _rx) = watch::channel(fallback);
        Self {
            config: Mutex::new(config),
            last_keystroke: Mutex::new(Instant::now()),
            monitor_running: std::sync::atomic::AtomicBool::new(false),
            suggestions_tx: tx,
        }
    }

    /// Get a new Receiver for the suggestions channel.
    /// Each SSE connection and monitor thread calls this to get its own Receiver.
    pub fn subscribe(&self) -> watch::Receiver<Vec<String>> {
        self.suggestions_tx.subscribe()
    }

    pub fn set_suggestions(&self, words: Vec<String>) {
        *self.last_keystroke.lock().unwrap() = Instant::now();
        let _ = self.suggestions_tx.send(words);
    }

    pub fn reset_to_fallback(&self) {
        // Reset last_keystroke to far past so idle timer treats this as idle immediately.
        *self.last_keystroke.lock().unwrap() =
            Instant::now() - Duration::from_secs(60);
        let fallback = self.config.lock().unwrap().fallback_phrases.clone();
        let _ = self.suggestions_tx.send(fallback);
    }

    pub fn is_enabled(&self) -> bool {
        self.config.lock().unwrap().enabled
    }
}
