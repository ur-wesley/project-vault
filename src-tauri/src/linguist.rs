//! GitHub Linguist-style language mapping for the language graph.
//!
//! Source: <https://github.com/github-linguist/linguist/blob/main/lib/linguist/languages.yml>
//! Pinned reference rev: main @ 2026-09 (colors/names verified against upstream).
//! Regenerate the table with `scripts/update-linguist-table.mjs` (allowlist subset).
//!
//! What we borrow from Linguist (per agreed scope: names + colors + bytes):
//! - Canonical language **names** (e.g. `TypeScript`, not `ts`).
//! - Per-language **colors** (`color` field from `languages.yml`).
//! - Extension + special-**filename** mapping (e.g. `Dockerfile`, `CMakeLists.txt`).
//! - `type` filtering: only `programming`/`markup` are countable, mirroring
//!   Linguist's default stats inclusion (`data`/`prose` like JSON/YAML/Markdown
//!   are excluded unless `linguist-detectable`).
//!
//! Explicit non-goals (documented follow-ups, not bugs):
//! - No shebang/modeline/heuristics/Bayesian disambiguation (`.h` maps to C).
//! - No full `vendor.yml` / `documentation.yml` / `generated.rb` port; the
//!   caller skips well-known dependency/build dirs instead.
//! - No `.gitattributes` `linguist-*` overrides.
//!
//! NOTE: `search::guess_language` keeps its own lowercase identifiers for
//! Tantivy index stability and intentionally does NOT use this table.

/// A countable language (Linguist `type: programming|markup` subset).
pub struct LangDef {
    /// Canonical Linguist name, e.g. `"TypeScript"`.
    pub name: &'static str,
    /// CSS hex color from `languages.yml`, e.g. `"#3178c6"`.
    pub color: &'static str,
}

macro_rules! lang {
    ($name:ident, $display:literal, $color:literal) => {
        const $name: LangDef = LangDef {
            name: $display,
            color: $color,
        };
    };
}

// Colors below are verbatim from upstream `languages.yml`, except SQL which
// has no upstream color (pv-fallback `#e38c00` keeps the previous UI hue).
lang!(TYPESCRIPT, "TypeScript", "#3178c6");
lang!(JAVASCRIPT, "JavaScript", "#f1e05a");
lang!(RUST, "Rust", "#dea584");
lang!(GO, "Go", "#00ADD8");
lang!(PYTHON, "Python", "#3572A5");
lang!(CSHARP, "C#", "#7355dd");
lang!(CPP, "C++", "#f34b7d");
lang!(C_LANG, "C", "#555555");
lang!(JAVA, "Java", "#b07219");
lang!(PHP, "PHP", "#4F5D95");
lang!(RUBY, "Ruby", "#701516");
lang!(ELIXIR, "Elixir", "#6e4a7e");
lang!(SWIFT, "Swift", "#F05138");
lang!(KOTLIN, "Kotlin", "#A97BFF");
lang!(SCALA, "Scala", "#c22d40");
lang!(SQL, "SQL", "#e38c00");
lang!(HTML, "HTML", "#e34c26");
lang!(CSS, "CSS", "#663399");
lang!(SCSS, "SCSS", "#c6538c");
lang!(LESS, "Less", "#1d365d");
lang!(VUE, "Vue", "#41b883");
lang!(SVELTE, "Svelte", "#ff3e00");
lang!(ASTRO, "Astro", "#ff5a03");
lang!(TEX, "TeX", "#3D6117");
lang!(SHELL, "Shell", "#89e051");
lang!(POWERSHELL, "PowerShell", "#012456");
lang!(BATCHFILE, "Batchfile", "#C1F12E");
lang!(DOCKERFILE, "Dockerfile", "#384d54");
lang!(CMAKE, "CMake", "#DA3434");
lang!(MAKEFILE, "Makefile", "#427819");
lang!(LUA, "Lua", "#000080");
lang!(LAU, "Luau", "#000080");
lang!(DART, "Dart", "#00B4AB");
lang!(HASKELL, "Haskell", "#5e5086");
lang!(OCAML, "OCaml", "#ef7a08");
lang!(CLOJURE, "Clojure", "#db5855");
lang!(FSHARP, "F#", "#b845fc");
lang!(PERL, "Perl", "#0298c3");
lang!(R_LANG, "R", "#198CE7");
lang!(JULIA, "Julia", "#a270ba");
lang!(ZIG, "Zig", "#ec915c");
lang!(SOLIDITY, "Solidity", "#AA6746");
lang!(GDSCRIPT, "GDScript", "#355570");
lang!(COFFEESCRIPT, "CoffeeScript", "#244776");
lang!(CRYSTAL, "Crystal", "#000100");
lang!(NIM, "Nim", "#ffc200");
lang!(ERLANG, "Erlang", "#B83998");
lang!(ELM, "Elm", "#60B5CC");
lang!(STYLUS, "Stylus", "#ff6347");

/// Classify a file into a countable language.
///
/// Inputs must already be lowercased (`file_name` = full basename,
/// `ext` = extension without dot, may be empty). Returns `None` for
/// everything Linguist would exclude from stats by default
/// (`data`/`prose`/unknown), so callers can skip it.
pub fn classify(file_name: &str, ext: &str) -> Option<&'static LangDef> {
    // Filename-first, like Linguist (handles extensionless files).
    match file_name {
        "dockerfile" | "containerfile" => return Some(&DOCKERFILE),
        "cmakelists.txt" => return Some(&CMAKE),
        "makefile" | "gnumakefile" | "makefile.am" | "makefile.in" => return Some(&MAKEFILE),
        "gemfile" | "rakefile" | "guardfile" | "berksfile" | "cheffile" | "vagrantfile"
        | "fastfile" | "appfile" | "deliverfile" | "gymfile" | "matchfile" | "scanfile"
        | "snapfile" => return Some(&RUBY),
        "apkbuild" => return Some(&SHELL),
        _ => {}
    }

    match ext {
        "ts" | "mts" | "cts" => Some(&TYPESCRIPT),
        // TSX is TypeScript in Linguist (separate grammar, same stats family).
        "tsx" => Some(&TYPESCRIPT),
        "js" | "mjs" | "cjs" | "ssjs" => Some(&JAVASCRIPT),
        // JSX groups into JavaScript for stats purposes.
        "jsx" => Some(&JAVASCRIPT),
        "rs" => Some(&RUST),
        "go" => Some(&GO),
        "py" | "pyw" | "gyp" | "gypi" => Some(&PYTHON),
        "cs" | "cake" | "csx" => Some(&CSHARP),
        "cpp" | "c++" | "cc" | "cp" | "cxx" | "h++" | "hh" | "hpp" | "hxx" | "inl" | "ipp"
        | "tcc" | "tpp" | "txx" | "cppm" | "ixx" | "ino" | "re" => Some(&CPP),
        // `.h` is ambiguous upstream (C/C++/Obj-C, heuristics decide);
        // we map to C and document it (see module docs).
        "c" | "h" | "cats" | "idc" => Some(&C_LANG),
        "java" => Some(&JAVA),
        "php" | "phtml" | "ctp" => Some(&PHP),
        "rb" | "builder" | "gemspec" | "god" | "jbuilder" | "mspec" | "podspec" | "prawn"
        | "rabl" | "rake" | "rbuild" | "rbw" | "rbx" | "ru" | "ruby" => Some(&RUBY),
        "ex" | "exs" => Some(&ELIXIR),
        "swift" => Some(&SWIFT),
        "kt" | "kts" => Some(&KOTLIN),
        "scala" | "sc" => Some(&SCALA),
        "sql" | "ddl" | "dml" => Some(&SQL),
        "html" | "htm" | "xhtml" | "cshtml" | "razor" => Some(&HTML),
        "css" => Some(&CSS),
        "scss" => Some(&SCSS),
        "less" => Some(&LESS),
        "vue" => Some(&VUE),
        "svelte" => Some(&SVELTE),
        "astro" => Some(&ASTRO),
        "tex" | "ltx" | "sty" | "cls" | "dtx" => Some(&TEX),
        "sh" | "bash" | "zsh" | "fish" | "ksh" | "mksh" => Some(&SHELL),
        "ps1" | "psm1" | "psd1" => Some(&POWERSHELL),
        "bat" | "cmd" => Some(&BATCHFILE),
        "dockerfile" | "containerfile" => Some(&DOCKERFILE),
        "cmake" | "cmake.in" => Some(&CMAKE),
        "mk" | "mak" | "mkfile" => Some(&MAKEFILE),
        "lua" => Some(&LUA),
        "luau" => Some(&LAU),
        "dart" => Some(&DART),
        "hs" => Some(&HASKELL),
        "ml" | "mli" => Some(&OCAML),
        "clj" | "cljs" | "cljc" | "bb" => Some(&CLOJURE),
        "fs" | "fsi" | "fsx" => Some(&FSHARP),
        "pl" | "pm" | "pod" | "t" => Some(&PERL),
        "r" | "rd" | "rsx" => Some(&R_LANG),
        "jl" => Some(&JULIA),
        "zig" => Some(&ZIG),
        "sol" => Some(&SOLIDITY),
        "gd" => Some(&GDSCRIPT),
        "coffee" | "_coffee" | "cjsx" | "iced" => Some(&COFFEESCRIPT),
        "cr" => Some(&CRYSTAL),
        "nim" | "nims" => Some(&NIM),
        "erl" | "hrl" => Some(&ERLANG),
        "elm" => Some(&ELM),
        "styl" => Some(&STYLUS),
        // Everything else (incl. data/prose: json, yaml, toml, xml, md, txt,
        // csv, lock, env, ini, and media/archives/binaries) => excluded.
        _ => None,
    }
}

/// Color lookup by canonical language name (for tests and future payloads).
pub fn language_color(name: &str) -> &'static str {
    match name {
        "TypeScript" => TYPESCRIPT.color,
        "JavaScript" => JAVASCRIPT.color,
        "Rust" => RUST.color,
        "Go" => GO.color,
        "Python" => PYTHON.color,
        "C#" => CSHARP.color,
        "C++" => CPP.color,
        "C" => C_LANG.color,
        "Java" => JAVA.color,
        "PHP" => PHP.color,
        "Ruby" => RUBY.color,
        "Elixir" => ELIXIR.color,
        "Swift" => SWIFT.color,
        "Kotlin" => KOTLIN.color,
        "Scala" => SCALA.color,
        "SQL" => SQL.color,
        "HTML" => HTML.color,
        "CSS" => CSS.color,
        "SCSS" => SCSS.color,
        "Less" => LESS.color,
        "Vue" => VUE.color,
        "Svelte" => SVELTE.color,
        "Astro" => ASTRO.color,
        "TeX" => TEX.color,
        "Shell" => SHELL.color,
        "PowerShell" => POWERSHELL.color,
        "Batchfile" => BATCHFILE.color,
        "Dockerfile" => DOCKERFILE.color,
        "CMake" => CMAKE.color,
        "Makefile" => MAKEFILE.color,
        "Lua" => LUA.color,
        "Luau" => LAU.color,
        "Dart" => DART.color,
        "Haskell" => HASKELL.color,
        "OCaml" => OCAML.color,
        "Clojure" => CLOJURE.color,
        "F#" => FSHARP.color,
        "Perl" => PERL.color,
        "R" => R_LANG.color,
        "Julia" => JULIA.color,
        "Zig" => ZIG.color,
        "Solidity" => SOLIDITY.color,
        "GDScript" => GDSCRIPT.color,
        "CoffeeScript" => COFFEESCRIPT.color,
        "Crystal" => CRYSTAL.color,
        "Nim" => NIM.color,
        "Erlang" => ERLANG.color,
        "Elm" => ELM.color,
        "Stylus" => STYLUS.color,
        _ => "#888888",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_maps_to_canonical_name() {
        assert_eq!(classify("main.tsx", "tsx").unwrap().name, "TypeScript");
        assert_eq!(classify("app.jsx", "jsx").unwrap().name, "JavaScript");
        assert_eq!(classify("main.rs", "rs").unwrap().name, "Rust");
        assert_eq!(classify("main.cs", "cs").unwrap().name, "C#");
        assert_eq!(classify("style.css", "css").unwrap().color, "#663399");
    }

    #[test]
    fn extensionless_filenames_resolve() {
        assert_eq!(classify("dockerfile", "").unwrap().name, "Dockerfile");
        assert_eq!(classify("cmakelists.txt", "txt").unwrap().name, "CMake");
        assert_eq!(classify("makefile", "").unwrap().name, "Makefile");
        assert_eq!(classify("gemfile", "").unwrap().name, "Ruby");
    }

    #[test]
    fn data_and_prose_are_excluded_like_github() {
        assert!(classify("package.json", "json").is_none());
        assert!(classify("config.yaml", "yaml").is_none());
        assert!(classify("readme.md", "md").is_none());
        assert!(classify("data.csv", "csv").is_none());
        assert!(classify("logo.png", "png").is_none());
        assert!(classify(".env", "").is_none());
    }

    #[test]
    fn current_upstream_colors() {
        assert_eq!(language_color("C#"), "#7355dd");
        assert_eq!(language_color("CSS"), "#663399");
        assert_eq!(language_color("TypeScript"), "#3178c6");
        assert_eq!(language_color("Unknown"), "#888888");
    }
}
