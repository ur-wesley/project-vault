# Rust Style Guide

Conventions for building a scalable, safe, and maintainable Rust backend for Project Vault.

## Core Principles

- **Idiomatic & Explicit**: Prefer standard Rust patterns. Avoid "clever" code; prefer clarity over brevity.
- **Strong Typing**: Use the type system to enforce invariants. Avoid string-ly typed APIs.
- **Modular Design**: Keep files small (< 500 lines). Extract complex logic into sub-modules.
- **Fail Fast & Explicitly**: Use `Result` for all recoverable errors. Avoid `panic!`, `unwrap()`, and `expect()` in production code unless in tests or truly unreachable branches.
- **Tauri Bridge Isolation**: Keep Tauri commands thin. Delegate business logic to domain-specific services or modules.
- **Resource Efficiency**: Be mindful of cloning large structures. Use references and Cow where appropriate.

## Project Structure

- `src-tauri/src/commands`: Tauri command definitions (the API bridge).
- `src-tauri/src/db`: Database interactions and migrations.
- `src-tauri/src/discovery`: Logic for finding and identifying projects.
- `src-tauri/src/models.rs`: Shared Data Transfer Objects (DTOs) and domain models.
- `src-tauri/src/error.rs`: Centralized error handling.

## Modularity Rules

- When a file exceeds 500 lines, it **must** be considered for refactoring into a module directory.
- Prefer the directory-based module pattern:
  ```text
  discovery/
  ├── mod.rs        # Exports and trait definitions
  ├── detectors/    # Specific implementations
  │   ├── mod.rs
  │   ├── node.rs
  │   └── rust.rs
  └── utils.rs      # Internal helpers
  ```
- Public APIs in modules should be minimal. Use `pub(crate)` for internal shared logic.

## Error Handling

### Internal Errors
Use `thiserror` to define domain-specific error enums.
```rust
#[derive(thiserror::Error, Debug)]
pub enum DiscoveryError {
    #[error("Failed to read directory: {0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid metadata in {0}")]
    InvalidMetadata(PathBuf),
}
```

### Tauri Bridge Errors
Convert internal errors to `StableError` at the command boundary. `StableError` is what the frontend expects.
```rust
// In commands/projects.rs
pub async fn scan_path(path: String) -> Result<Vec<Project>, StableError> {
    service::scan(path).map_err(|e| e.into())
}
```

### Rules
- Never use `anyhow` in library-like modules (e.g., `db`, `discovery`).
- Use `anyhow` sparingly in top-level commands if additional context is needed for logging.
- Always provide a `From` implementation or a mapping function to `StableError`.

## Tauri Commands

- Commands should be located in `src-tauri/src/commands/`.
- Validate all input at the command boundary.
- Commands should return `Result<T, StableError>`.
- Keep logic out of commands; they should merely parse arguments, call a service, and map errors.

## Concurrency & Async

- Prefer `tokio` for async tasks (native to Tauri).
- Use `tauri::State` for shared global state.
- For CPU-bound tasks that might block the executor, use `tokio::task::spawn_blocking`.
- Be careful with `Mutex` in async contexts; prefer `tokio::sync::Mutex` if the lock must be held across `.await` points, otherwise use `std::sync::Mutex` for brief synchronous locks.

## Naming Conventions

- **Files**: `snake_case.rs`
- **Structs/Enums/Traits**: `PascalCase`
- **Functions/Variables/Modules**: `snake_case`
- **Constants/Statics**: `SCREAMING_SNAKE_CASE`
- **Acronyms**: Treat as words (e.g., `HttpServer` not `HTTPServer`).

## Testing

- Place unit tests in a `tests` module at the bottom of the file:
  ```rust
  #[cfg(test)]
  mod tests {
      use super::*;
      #[test]
      fn test_logic() { ... }
  }
  ```
- Use `mockall` or similar traits for mocking external dependencies (filesystem, network) if necessary.
- Integration tests go in `src-tauri/tests/`.

## Documentation

- Use `///` for doc comments on all public structs, enums, traits, and functions.
- Use `//` for internal implementation notes.
- Include "Examples" or "Errors" sections in doc comments for complex public APIs.
