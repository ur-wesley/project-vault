//! Backend DTO mirror, sliced by domain. Split from `models.rs`; this
//! module re-exports the full surface so `crate::models::*` paths keep
//! working unchanged.

pub mod canvas;
pub mod cleaner;
pub mod events;
pub mod files;
pub mod location;
pub mod mise;
pub mod project;
pub mod screenshot;
pub mod search;
pub mod sessions;
pub mod tasks;
pub mod workspaces;

pub use canvas::*;
pub use cleaner::*;
pub use events::*;
pub use files::*;
pub use location::*;
pub use mise::*;
pub use project::*;
pub use screenshot::*;
pub use search::*;
pub use sessions::*;
pub use tasks::*;
pub use workspaces::*;
