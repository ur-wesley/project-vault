use std::path::Path;

pub fn skip_dir_name(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | ".turbo"
            | ".next"
            | ".nuxt"
            | "__pycache__"
            | ".venv"
            | "venv"
            | "vendor"
            | ".idea"
            | ".vs"
            | "coverage"
            | ".cache"
            | "obj"
            | ".Trash"
            | ".fseventsd"
            | "lost+found"
    )
}

fn reserved_system_dir(name: &str) -> bool {
    #[cfg(windows)]
    {
        let n = name;
        if n.starts_with('$') {
            return true;
        }
        let lower = n.to_ascii_lowercase();
        matches!(
            lower.as_str(),
            "system volume information"
                | "recovery"
                | "windows"
                | "windows.old"
                | "program files"
                | "program files (x86)"
                | "programdata"
                | "perflogs"
                | "inetpub"
                | "msocache"
                | "boot"
                | "documents and settings"
                | "config.msi"
                | "intel"
                | "amd"
                | "nvidia"
        ) || lower.ends_with(".tmp")
    }
    #[cfg(not(windows))]
    {
        let lower = name.to_ascii_lowercase();
        matches!(
            lower.as_str(),
            "lost+found" | ".trash" | ".trashes" | "proc" | "sys" | "dev" | "run"
        )
    }
}

pub fn should_skip_directory(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
        return false;
    };
    if skip_dir_name(name) || reserved_system_dir(name) {
        return true;
    }
    false
}

pub fn path_has_skipped_dir_segment(path: &Path) -> bool {
    for a in path.ancestors() {
        if a.as_os_str().is_empty() {
            continue;
        }
        if should_skip_directory(a) {
            return true;
        }
    }
    false
}
