# PRD: Runtime and tooling metadata suggester

## 1. Introduction / overview

Project Vault already detects project types, tasks, and runtime hints. This feature adds a suggestion layer that finds missing or incomplete runtime and package-manager metadata, then offers safe one-click fixes for common project ecosystems.

The goal is to help projects declare the right toolchain and package metadata up front, so Project Vault can resolve runtimes more accurately and users spend less time guessing which runtime or package manager a project expects.

## 2. Goals

1. Detect missing or inconsistent runtime and tooling metadata for supported project types.
2. Suggest minimal fixes for common ecosystems such as JavaScript/TypeScript, Python, Go, and Rust.
3. Let the user preview and apply suggested edits to manifest files safely.
4. Refresh runtime detection and task resolution after the fix is applied.
5. Keep suggestions explainable, reversible, and scoped to the affected project files.

## 3. User stories

1. As a developer, I want to see that my `package.json` is missing `packageManager` or `engines` so I can fix it before launch errors happen.
2. As a developer, I want Project Vault to suggest a Python runtime declaration when my project is missing version metadata.
3. As a developer, I want to review the exact file changes before the app writes anything.
4. As a developer, I want runtime and task discovery to become more accurate after I accept a suggestion.
5. As a developer, I want the app to avoid changing unrelated fields or rewriting whole files unnecessarily.

## 4. Functional requirements

1. **Analyze project metadata**
   - The system must scan supported project manifests and runtime markers for missing, incomplete, or conflicting metadata.
   - The system must classify each finding as missing, recommended, conflicting, or deprecated.
   - The system must associate each finding with a specific file and field whenever possible.

2. **Suggest fixes for supported ecosystems**
   - For JavaScript/TypeScript/Bun projects, the system must be able to suggest values such as `packageManager`, `engines.node`, and `engines.bun` when they are missing or inconsistent with detected usage.
   - For Python projects, the system must be able to suggest project version metadata such as `requires-python`, `.python-version`, or equivalent runtime declaration used by the app.
   - For Go projects, the system must be able to suggest the `go` directive or a matching toolchain declaration when it is absent.
   - For Rust projects, the system must be able to suggest edition or toolchain metadata when the project is missing a clear runtime/tooling declaration.
   - The system must not suggest edits that would conflict with already declared user intent unless the suggestion is explicitly marked as a conflict.

3. **Present suggestions in the UI**
   - The UI must show the issue, the reason it was detected, and the file that would be changed.
   - The UI must show a preview of the change before it is applied.
   - The UI must allow the user to accept, skip, or dismiss individual suggestions.

4. **Apply edits safely**
   - The backend must write only the required fields to the relevant manifest file.
   - The backend must preserve unrelated content and formatting as much as the file format allows.
   - The backend must fail gracefully if the target file cannot be parsed or if a local edit would conflict with existing content.
   - The backend must report a clear success or failure result after each applied suggestion.

5. **Refresh runtime and task detection**
   - After a suggestion is applied, the system must rescan the project and update runtime hints and task resolution.
   - The UI must reflect the updated state without requiring a full app restart.

6. **Remember suggestion state**
   - The system must be able to remember dismissed suggestions for a project so the same warning is not shown repeatedly without a change in file state.
   - The system must distinguish between dismissed, applied, and still-pending suggestions.

7. **Support common file formats**
   - The system must support JSON-based manifests such as `package.json` and TOML-based manifests such as `pyproject.toml` or `Cargo.toml`.
   - If a format cannot be edited safely, the system must show a read-only suggestion and explain why auto-apply is unavailable.

## 5. Non-goals

- Not a general-purpose linter for all config files.
- Not a package installer or dependency updater.
- Not an auto-fixer for arbitrary source code outside manifest and toolchain files.
- Not a replacement for the project creation wizard, although it may reuse some of the same runtime and template logic.
- Not a bulk refactor tool that rewrites many files at once.

## 6. Design considerations

- Best placement is inside **Project Detail**, near runtime and task information, as a dedicated **Suggestions** or **Setup** panel.
- A secondary entry point can live in the command palette as a quick action such as “Review project setup suggestions”.
- Copy should make it clear whether a suggestion is required, recommended, or informational.
- Diff previews should show only the fields that change, not the entire file.
- Applied changes should be easy to scan and easy to reverse.

## 7. Technical considerations

- The suggestion engine should reuse existing project detectors and runtime resolution logic instead of inventing a second detection path.
- The backend should own the scan, classification, and file-edit logic so the UI receives typed suggestion DTOs only.
- JSON and TOML edits should preserve formatting where possible, using format-aware writers rather than raw string replacement.
- The feature should be careful about writing to `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, or similar files only when the user explicitly accepts the change.
- The suggestion engine may later share rules with project templates or project creation defaults.

## 8. Success metrics

- Fewer projects fail launch because their runtime or package-manager metadata is missing.
- Users can apply a suggested fix in a small number of clicks.
- Runtime and task detection become more accurate after metadata is added.
- Users can understand why a suggestion exists without reading implementation details.

## 9. Open questions

1. Should the app auto-scan for suggestions on project open, or only when the user asks for them?
2. Should the first version support only `package.json` and `pyproject.toml`, or include `go.mod` and `Cargo.toml` immediately?
3. Should suggestions be applied one at a time, or can the user batch several safe edits together?
4. Should this feature also suggest creating `.mise.toml` / `.tool-versions` when they are missing?
5. Should the UI live in a dedicated tab, a card on the project overview, or both?
