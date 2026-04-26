mod resolve;
mod runner;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod embedded;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod ide_session;

pub use resolve::use_mise_for_project;
pub use runner::{argv_needs_confirmation, open_interactive_shell, spawn_in_new_console};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use embedded::EmbeddedTerminals;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use ide_session::ProjectIdeSessions;

#[cfg(any(target_os = "android", target_os = "ios"))]
#[derive(Clone, Default)]
pub struct EmbeddedTerminals;

#[cfg(any(target_os = "android", target_os = "ios"))]
#[derive(Clone, Default)]
pub struct ProjectIdeSessions;
