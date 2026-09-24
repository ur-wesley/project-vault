//! Luau plugin loading: specs, registry, manager, runtime tasks, graph.
//! Split from `loader.rs`; this module re-exports the full surface so
//! `crate::lua::loader::*` paths keep working unchanged.

pub mod load;
pub mod manager;
pub mod runtime;
pub mod spec;

pub use load::*;
pub use manager::*;
pub use runtime::*;
pub use spec::*;

