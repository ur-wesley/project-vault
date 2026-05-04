# Rust Style Guide — Project Vault

## File Organization

- **500 LOC max** per file. If a file exceeds 300 LOC, consider splitting.
- Use `folder/mod.rs` for multi-file modules. Use `file.rs` for single-file modules.
- Name modules after their domain: `detectors/`, `ide/`, `commands/`, etc.
- Keep Tauri command files thin (< 30 LOC). Delegate to service functions.

## Error Handling

- Use `thiserror` enums (`AppError`) for internal Rust code.
- Use `StableError` **only** at the Tauri command boundary (frontend contract).
- Implement `From<AppError> for StableError` once in `error.rs`.
- Never construct `StableError` manually inside business logic.

## Naming

- `snake_case` for functions, variables, modules, files.
- `PascalCase` for structs, enums, traits.
- `SCREAMING_SNAKE_CASE` for constants.
- Module names match domain: `js.rs`, `windows.rs`, `jetbrains.rs`.

## Platform Code

- Isolate `#[cfg(windows)]`, `#[cfg(target_os = "macos")]`, `#[cfg(unix)]` into dedicated modules.
- Never inline `#[cfg]` blocks inside shared functions.

## Async

- Prefer `tokio::spawn` for background work.
- Never block the Tauri command thread with synchronous I/O.

## Imports

Group in this order, separated by blank lines:
1. `std`
2. External crates
3. `crate::`
4. `super::`

No wildcard imports (`use crate::*;`).
