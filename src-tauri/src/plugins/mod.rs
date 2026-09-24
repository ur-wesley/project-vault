//! Plugin management: repo checkouts, monorepo install, lockfiles,
//! local linking, and updates. Split from `commands/plugins.rs`.

pub mod dto;
pub mod link;
pub mod lockfile;
pub mod monorepo;
pub mod paths;
pub mod repo;
pub mod updates;

