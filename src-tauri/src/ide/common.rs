use std::collections::HashSet;
use std::path::{Path, PathBuf};
use crate::models::IdeCandidateDto;

pub fn dedup_key(path: &Path) -> String {
    dunce::canonicalize(path)
        .map(|p| p.to_string_lossy().to_lowercase())
        .unwrap_or_else(|_| path.to_string_lossy().to_lowercase())
}

pub fn is_executable_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(windows)]
    {
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            let ext_lower = ext.to_lowercase();
            return matches!(ext_lower.as_str(), "exe" | "cmd" | "bat");
        }
        return false;
    }
    #[cfg(not(windows))]
    {
        true
    }
}

pub fn icon_for_id(id: &str) -> Option<String> {
    Some(
        match id {
            "vscode" | "vscode-insiders" | "vscode-oss" | "vscodium" => {
                "mdi--visual-studio-code"
            }
            "cursor" => "mdi--target",
            "windsurf" => "mdi--surfing",
            "trae" => "mdi--robot",
            "fleet" => "mdi--jet",
            "intellij" => "mdi--language-java",
            "webstorm" => "mdi--language-javascript",
            "pycharm" => "mdi--language-python",
            "rustrover" => "mdi--language-rust",
            "goland" => "mdi--language-go",
            "clion" => "mdi--language-cpp",
            "phpstorm" => "mdi--language-php",
            "rider" => "mdi--language-cpp",
            "sublime" => "mdi--text-box-outline",
            "zed" => "mdi--alpha-z-box",
            "lapce" => "mdi--lightning-bolt",
            "helix" => "mdi--hexagon",
            "android-studio" => "mdi--android-debug-bridge",
            "notepad-plus-plus" => "mdi--note-edit",
            "eclipse" => "mdi--eclipse",
            "netbeans" => "mdi--netbeans",
            "atom" => "mdi--atom",
            "brackets" => "mdi--code-brackets",
            "vim" | "neovim" => "mdi--vi",
            "emacs" => "mdi--gnu",
            "kate" => "mdi--text",
            "geany" => "mdi--code",
            "nova" => "mdi--star",
            "textmate" => "mdi--text-box",
            "bbedit" => "mdi--text-box",
            "coteditor" => "mdi--text-box",
            "codeblocks" => "mdi--application-code",
            "arduino" => "mdi--arduino",
            "rstudio" => "mdi--language-r",
            "jupyterlab" => "mdi--notebook",
            "spyder" => "mdi--spider",
            "thonny" => "mdi--snake",
            "bluej" => "mdi--coffee",
            "greenfoot" => "mdi--foot-print",
            "processing" => "mdi--code",
            "positron" => "mdi--atom",
            "micro" => "mdi--microphone",
            "scite" => "mdi--text-box",
            "drracket" => "mdi--code",
            _ if id.starts_with("vs-20") => "mdi--visual-studio",
            _ => "mdi--application-edit-outline",
        }
        .to_string(),
    )
}

pub fn push_candidate(
    out: &mut Vec<IdeCandidateDto>,
    seen_paths: &mut HashSet<String>,
    seen_ids: &mut HashSet<String>,
    id: &str,
    label: &str,
    path: PathBuf,
) {
    if !is_executable_file(&path) {
        return;
    }
    if seen_ids.contains(id) {
        return;
    }
    let key = dedup_key(&path);
    if !seen_paths.insert(key) {
        return;
    }
    seen_ids.insert(id.to_string());

    out.push(IdeCandidateDto {
        id: id.to_string(),
        label: label.to_string(),
        executable: path.to_string_lossy().to_string(),
        icon: icon_for_id(id),
    });
}

#[cfg(windows)]
pub fn path_dirs_lookup(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for ext in [".exe", ".cmd", ".bat", ""] {
            let p = dir.join(format!("{name}{ext}"));
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

#[cfg(not(windows))]
pub fn path_dirs_lookup(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let p = dir.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}
