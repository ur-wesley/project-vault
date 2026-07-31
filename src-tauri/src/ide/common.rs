use std::collections::HashSet;
use std::path::{Path, PathBuf};
use crate::models::IdeCandidateDto;
use super::icon::icon_data_for_with_id;

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
            "vscode" | "vscode-insiders" | "vscode-oss" => "devicon-plain--vscode",
            "vscodium" => "devicon-plain--vscodium",
            "visualstudio" => "devicon-plain--visualstudio",
            "intellij" => "devicon-plain--intellij",
            "webstorm" => "devicon-plain--webstorm",
            "pycharm" => "devicon-plain--pycharm",
            "goland" => "devicon-plain--goland",
            "clion" => "devicon-plain--clion",
            "phpstorm" => "devicon-plain--phpstorm",
            "rider" => "devicon-plain--rider",
            "android-studio" => "devicon-plain--androidstudio",
            "vim" => "devicon-plain--vim",
            "neovim" => "devicon-plain--neovim",
            "eclipse" => "devicon-plain--eclipse",
            "netbeans" => "devicon-plain--netbeans",
            "arduino" => "devicon-plain--arduino",
            "rstudio" => "devicon-plain--rstudio",
            "cursor" => "mdi--target",
            "windsurf" => "mdi--surfing",
            "trae" => "mdi--robot",
            "fleet" => "mdi--rocket-launch",
            "rustrover" => "mdi--language-rust",
            "sublime" => "mdi--text-box-outline",
            "zed" => "mdi--alpha-z-box",
            "lapce" => "mdi--lightning-bolt",
            "helix" => "mdi--hexagon",
            "notepad-plus-plus" => "mdi--note-edit",
            "atom" => "mdi--atom",
            "brackets" => "mdi--code-brackets",
            "emacs" => "mdi--text-box-edit",
            "kate" => "mdi--text",
            "geany" | "processing" | "drracket" => "mdi--code-tags",
            "nova" => "mdi--star",
            "textmate" | "bbedit" | "coteditor" | "scite" => "mdi--text-box",
            "codeblocks" => "mdi--application-braces",
            "jupyterlab" => "mdi--notebook",
            "spyder" => "mdi--spider",
            "thonny" => "mdi--snake",
            "bluej" => "mdi--coffee",
            "greenfoot" => "mdi--foot-print",
            "positron" => "mdi--atom",
            "micro" => "mdi--microphone",
            "antigravity" => "mdi--satellite",
            _ if id.starts_with("vs-20") => "devicon-plain--visualstudio",
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
        icon_data: icon_data_for_with_id(&path, Some(id)),
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

#[cfg(test)]
mod tests {
    use super::icon_for_id;

    #[test]
    fn icon_for_id_devicon_branded() {
        let branded = [
            ("vscode", "devicon-plain--vscode"),
            ("vscodium", "devicon-plain--vscodium"),
            ("visualstudio", "devicon-plain--visualstudio"),
            ("intellij", "devicon-plain--intellij"),
            ("webstorm", "devicon-plain--webstorm"),
            ("pycharm", "devicon-plain--pycharm"),
            ("goland", "devicon-plain--goland"),
            ("clion", "devicon-plain--clion"),
            ("phpstorm", "devicon-plain--phpstorm"),
            ("rider", "devicon-plain--rider"),
            ("android-studio", "devicon-plain--androidstudio"),
            ("vim", "devicon-plain--vim"),
            ("neovim", "devicon-plain--neovim"),
            ("eclipse", "devicon-plain--eclipse"),
            ("netbeans", "devicon-plain--netbeans"),
            ("arduino", "devicon-plain--arduino"),
            ("rstudio", "devicon-plain--rstudio"),
        ];
        for (id, expected) in branded {
            assert_eq!(icon_for_id(id).unwrap(), expected, "unexpected icon for {id}");
        }
    }

    #[test]
    fn icon_for_id_vscode_variants_and_vs_prefix() {
        assert_eq!(
            icon_for_id("vscode-insiders").unwrap(),
            "devicon-plain--vscode"
        );
        assert_eq!(icon_for_id("vscode-oss").unwrap(), "devicon-plain--vscode");
        assert_eq!(
            icon_for_id("vs-2022-community").unwrap(),
            "devicon-plain--visualstudio"
        );
        assert_eq!(
            icon_for_id("vs-2022-pro").unwrap(),
            "devicon-plain--visualstudio"
        );
        assert_eq!(
            icon_for_id("vs-2019-enterprise").unwrap(),
            "devicon-plain--visualstudio"
        );
    }

    #[test]
    fn icon_for_id_mdi_fallbacks() {
        let fallbacks = [
            ("cursor", "mdi--target"),
            ("windsurf", "mdi--surfing"),
            ("trae", "mdi--robot"),
            ("fleet", "mdi--rocket-launch"),
            ("rustrover", "mdi--language-rust"),
            ("sublime", "mdi--text-box-outline"),
            ("zed", "mdi--alpha-z-box"),
            ("lapce", "mdi--lightning-bolt"),
            ("helix", "mdi--hexagon"),
            ("notepad-plus-plus", "mdi--note-edit"),
            ("atom", "mdi--atom"),
            ("brackets", "mdi--code-brackets"),
            ("emacs", "mdi--text-box-edit"),
            ("kate", "mdi--text"),
            ("geany", "mdi--code-tags"),
            ("nova", "mdi--star"),
            ("textmate", "mdi--text-box"),
            ("bbedit", "mdi--text-box"),
            ("coteditor", "mdi--text-box"),
            ("codeblocks", "mdi--application-braces"),
            ("jupyterlab", "mdi--notebook"),
            ("spyder", "mdi--spider"),
            ("thonny", "mdi--snake"),
            ("bluej", "mdi--coffee"),
            ("greenfoot", "mdi--foot-print"),
            ("processing", "mdi--code-tags"),
            ("positron", "mdi--atom"),
            ("micro", "mdi--microphone"),
            ("scite", "mdi--text-box"),
            ("drracket", "mdi--code-tags"),
            ("antigravity", "mdi--satellite"),
        ];
        for (id, expected) in fallbacks {
            assert_eq!(icon_for_id(id).unwrap(), expected, "unexpected fallback for {id}");
        }
    }

    #[test]
    fn icon_for_id_unknown_default() {
        assert_eq!(
            icon_for_id("some-future-ide").unwrap(),
            "mdi--application-edit-outline"
        );
        assert_eq!(
            icon_for_id("").unwrap(),
            "mdi--application-edit-outline"
        );
    }
}
