use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Instant;
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
    suggestions_tx: watch::Sender<Vec<String>>,
    pub suggestions_rx: watch::Receiver<Vec<String>>,
}

impl AutocompleteState {
    pub fn new(config: AutocompleteConfig) -> Self {
        let fallback = config.fallback_phrases.clone();
        let (tx, rx) = watch::channel(fallback);
        Self {
            config: Mutex::new(config),
            last_keystroke: Mutex::new(Instant::now()),
            suggestions_tx: tx,
            suggestions_rx: rx,
        }
    }

    pub fn set_suggestions(&self, words: Vec<String>) {
        *self.last_keystroke.lock().unwrap() = Instant::now();
        let _ = self.suggestions_tx.send(words);
    }

    pub fn reset_to_fallback(&self) {
        let fallback = self.config.lock().unwrap().fallback_phrases.clone();
        let _ = self.suggestions_tx.send(fallback);
    }

    pub fn is_enabled(&self) -> bool {
        self.config.lock().unwrap().enabled
    }
}
