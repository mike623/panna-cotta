pub mod buffer;
pub mod spell;
pub mod state;

#[cfg(target_os = "macos")]
pub mod tap;

pub use state::{AutocompleteConfig, AutocompleteState};
