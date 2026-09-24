//! Portable PostgreSQL version manager + lightweight SQL engine.
//!
//! Storage layout under `<app_data>/postgres/`:
//! ```text
//! versions/<major>/          unpacked EDB portable binaries (+ version.json)
//! clusters/<name>/           data/  logfile  cluster.json
//! ```
//!
//! All SQL goes through the version's own `psql --csv` binary (no extra
//! wire-protocol dependency). Clusters are created with `--auth=trust` for
//! localhost-only dev use; the server only ever binds 127.0.0.1.

pub mod clusters;
pub mod docker;
pub mod engine;
pub mod extensions;
pub mod records;
pub mod settings;
pub mod versions;

pub use clusters::*;
pub use docker::*;
pub use engine::*;
pub use extensions::*;
pub use records::*;
pub use settings::*;
pub use versions::*;

