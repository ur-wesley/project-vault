use std::path::Path;

pub const MAX_PATH_DEPTH: usize = 48;

pub fn path_key(path: &Path) -> String {
    dunce::canonicalize(path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.to_string_lossy().to_string())
}
