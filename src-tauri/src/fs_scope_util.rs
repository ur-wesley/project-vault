use std::path::Path;

use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

use crate::error::{codes, StableError};

pub fn allow_library_root(app: &AppHandle, path: &str) -> Result<(), StableError> {
    let p = Path::new(path);
    if !p.is_dir() {
        return Err(StableError::new(
            codes::INVALID_PATH,
            "library path is not a directory",
        ));
    }
    app.fs_scope()
        .allow_directory(p, true)
        .map_err(|e| StableError::new(codes::INTERNAL, e.to_string()))
}
