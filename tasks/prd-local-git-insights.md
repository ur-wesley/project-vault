# PRD: Local Git insights (branch, pull) — basic

## 1. Introduction / overview

**Problem:** Project Vault already surfaces **remote** Git metadata via GitHub (issues, README, `owner/repo` from `origin`) but does not show **local** repository state. Users working in the app need quick confidence about which branch the folder is on and a simple way to run **`git pull`** without leaving the app.

**Goal:** Add **read-only, minimal** local Git insight for each project (when its path is a Git working tree) plus a **single** write action: **pull** from the configured remote tracking branch, with clear feedback. No full Git client.

## 2. Goals

- Show whether the project path is a Git repo and, if so, the **current branch** (or a clear “detached HEAD” / not-a-repo message).
- Let the user run **`git pull`** against that folder with **visible success or error output** (at least a summary line; stderr on failure).
- Keep scope **small and maintainable** (few commands, one obvious UI surface, predictable security surface).

## 3. User stories

1. As a user with a project opened in Project Vault, I want to **see the current branch name** so I know I am on the right line of work.
2. As a user, I want to **pull the latest changes** with one action so I can sync with teammates without opening a separate terminal.
3. As a user, when the folder is **not a Git repository**, I want a **short message** so I am not confused by missing data.
4. As a user, if **pull fails** (network, conflicts, not configured upstream), I want to see **what went wrong** so I can fix it outside the app if needed.

## 4. Functional requirements

1. **Repository detection**  
   The system must determine, for a project’s on-disk path, whether it is inside a **Git work tree** (including worktrees and `.git` file indirection), consistent with how the app already locates remotes in Rust (see existing `resolve_git_dir` / similar). If not a repo, the UI must show a **stable, non-technical** message (e.g. “This folder is not a Git repository”).

2. **Current branch (read-only)**  
   For a valid repo, the system must show the **current branch name** (e.g. from `git rev-parse --abbrev-ref HEAD` with handling for **detached HEAD** — e.g. show short SHA or “(detached)” instead of failing silently).

3. **Optional one-line sync hint (v1 if low effort)**  
   If available without extra product complexity, the system may show a **single line** of upstream sync information (e.g. from `git status -sb` or `git rev-list --left-right --count` only when a tracking branch exists). If this slips schedule, it may be dropped; branch name + pull remain mandatory.

4. **Pull**  
   The system must provide a **“Pull”** (or “Git pull”) action scoped to the project’s working directory that runs the equivalent of **`git pull`** (default merge configuration as Git is already set on the user’s machine). The action must be **async**; the user must not be left without feedback.

5. **Output / errors**  
   After pull, the system must show **whether it succeeded** and either a **short success summary** and/or the **relevant** command output. On failure, **error text** (stderr and/or a parsed message) must be visible. No requirement for a full terminal; a scrollable or truncated text area is enough.

6. **Refresh**  
   The user must be able to **re-query** branch (and optional sync line) after pull or on demand (e.g. a “Refresh” control or re-run when opening the view).

7. **Permissions / security**  
   Implementation must use the existing **Tauri** security model: Git commands should run in the **Rust backend** (or another controlled path), with **shell scope** / working-directory constraints that only allow `git` (or a fixed allowlist) on paths under known project locations — aligned with `tauri-plugin-shell` and app capabilities (document exact capability changes in the implementation task, not in this PRD).

8. **Platform**  
   Behavior must be acceptable on **Windows and macOS** (Git on `PATH` is assumed; if Git is missing, show a clear error).

## 5. Non-goals (out of scope)

- `git push`, `fetch` without merge, rebase, merge resolution UI, cherry-pick, **branch switch/create**, **stash**, **tags**.
- **Visual diff**, **file-level status**, **blame**, **log browser**, or **submodule** management.
- **Authenticating** or managing Git credentials (use the user’s existing Git/SSH/HTTPS setup).
- Replacing a full **terminal**; no arbitrary shell commands in v1.
- **GitHub-only** features beyond what local `git pull` does (e.g. no new GitHub API for “merge PR” in this feature).

## 6. Design considerations (UI/UX)

- **Placement:** A dedicated sub-area in **Project detail** (e.g. a new tab **“Git”** or a **card** on an existing “Overview”/“Repository” area). Copy should distinguish **“Local Git”** from the existing **GitHub** (API) panel so users do not confuse **remote** API data with **local** state.
- **Layout:** One compact block: **Branch** (and optional one-line **status**), primary button **Pull**, **Refresh**, output/error region below, muted text when not a repo.
- **i18n:** New strings in `en.json` (and follow-up locales if any) for labels, errors, and empty states.
- **Accessibility:** Buttons and status region must have readable labels; pull **disabled** or **loading** while a command runs.

## 7. Technical considerations (optional)

- Reuse or extend **Rust** `commands` in `src-tauri` for:
  - read: branch (+ optional short status)
  - write: `git pull` with captured stdout/stderr, exit code
- Prefer **structured DTOs** to the front end (`branch`, `detached: boolean`, `syncLine?`, `pull: { ok, message }` style).
- **Query keys:** Add TanStack Query keys for `["git", "local", projectId]`; invalidate after pull and on manual refresh.
- **Dependency note:** `tauri-plugin-shell` is already in the project; align with Tauri 2 **capability** entries for `git` and working directory.

## 8. Success metrics

- Users can read **current branch** for typical repos without opening a terminal.
- **Pull** completes successfully in the common case (clean tree, valid upstream) and **failures** are understandable from in-app text.
- No **critical** security regression (Git only for project-scoped paths, no arbitrary command injection).

## 9. Open questions (clarify in planning or a short follow-up)

1. **Tab vs. card:** Is a new **“Git”** tab preferred, or a **collapsible “Local Git”** block on the existing GitHub/Readme area? _(Default in this PRD: new **Git** sub-tab in project detail to avoid clutter.)_
2. **Upstream line:** Is **one-line** `git status -sb` (e.g. ahead/behind) required for v1, or is **branch + pull** alone enough? _(PRD: optional v1 if cheap.)_
3. **Concurrency:** Should **Pull** be disabled while a **terminal** session for the same project is active (if applicable), or is a simple in-flight **busy** state enough?

---

_Document generated per `/ai/create-prd.md`. Implementation should not start until this scope is agreed; adjust “Open questions” and re-export if the team picks different UI placement or drops the optional sync line._
