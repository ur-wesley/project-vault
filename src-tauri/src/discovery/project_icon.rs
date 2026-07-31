use std::path::Path;

const ICON_CANDIDATES: &[&str] = &[
    "icon.png",
    "icon.svg",
    "icon.ico",
    "logo.png",
    "logo.svg",
    "favicon.ico",
    "public/favicon.ico",
    "public/icon.png",
    "src-tauri/icons/128x128.png",
    "src-tauri/icons/icon.ico",
    "src-tauri/icons/32x32.png",
    "build/icon.png",
    "assets/icon.png",
    "resources/icon.png",
];

fn normalize_relative_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub fn find_project_icon(root: &Path) -> Option<String> {
    for candidate in ICON_CANDIDATES {
        let full = root.join(candidate);
        if full.is_file() {
            return Some(normalize_relative_path(Path::new(candidate)));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn empty_dir_returns_none() {
        let dir = TempDir::new().unwrap();
        assert_eq!(find_project_icon(dir.path()), None);
    }

    #[test]
    fn favicon_only() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("favicon.ico"), b"").unwrap();
        assert_eq!(find_project_icon(dir.path()), Some("favicon.ico".into()));
    }

    #[test]
    fn icon_png_beats_favicon() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("favicon.ico"), b"").unwrap();
        fs::write(dir.path().join("icon.png"), b"").unwrap();
        assert_eq!(find_project_icon(dir.path()), Some("icon.png".into()));
    }

    #[test]
    fn public_favicon() {
        let dir = TempDir::new().unwrap();
        let public = dir.path().join("public");
        fs::create_dir_all(&public).unwrap();
        fs::write(public.join("favicon.ico"), b"").unwrap();
        assert_eq!(
            find_project_icon(dir.path()),
            Some("public/favicon.ico".into())
        );
    }

    #[test]
    fn tauri_icon() {
        let dir = TempDir::new().unwrap();
        let icons = dir.path().join("src-tauri/icons");
        fs::create_dir_all(&icons).unwrap();
        fs::write(icons.join("128x128.png"), b"").unwrap();
        assert_eq!(
            find_project_icon(dir.path()),
            Some("src-tauri/icons/128x128.png".into())
        );
    }
}
