mod resolve;
mod runner;
pub mod task_monitor;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod embedded;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod ide_session;

pub use resolve::use_mise_for_project;
pub use runner::{argv_needs_confirmation, open_interactive_shell};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use task_monitor::{TaskMonitorEntry, TaskMonitors};

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

#[cfg(any(target_os = "android", target_os = "ios"))]
#[derive(Clone, Default)]
pub struct TaskMonitors;
