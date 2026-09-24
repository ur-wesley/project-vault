//! App startup orchestration: plugin bootstrap, orphan recovery,
//! playtime tracking, MCP autostart, and file watchers. Split from the
//! `run()` setup closure in `lib.rs` (which keeps only plugin
//! registrations and thin setup calls).

pub mod mcp;
pub mod orphans;
pub mod playtime;
pub mod plugins;
pub mod watchers;
