# PRD: Rust Backend Refactoring and Style Guide

## Introduction/Overview
The Rust backend of Project Vault has grown in complexity, with several files exceeding 500 lines of code (notably `detectors.rs` at ~1300 LOC and `ide.rs` at ~600 LOC). This makes maintenance, testing, and readability difficult. This project aims to refactor the Rust codebase for better modularity and establish a definitive Style Guide to ensure long-term maintainability.

## Goals
1.  **Modularity**: Decompose large files into smaller, focused modules (< 500 LOC).
2.  **Standardization**: Create and enforce a Rust Style Guide (`ai/styleguide-rust.md`) similar to the existing Tailwind style guide.
3.  **Error Handling**: Transition from string-based error codes to idiomatic `thiserror` enums while maintaining compatibility with the frontend `StableError`.
4.  **Architectural Separation**: Clearly separate Tauri commands (the "bridge") from core business logic (the "services").
5.  **Testability**: Improve the ease of writing unit tests by decoupling logic from file system and global state.

## User Stories
1.  As a developer, I want to find the logic for a specific project detector without scrolling through a 1300-line file.
2.  As a developer, I want to know the "best way" to handle errors in this project so that my code is consistent with others.
3.  As a maintainer, I want smaller files so that PR reviews are more focused and less prone to merge conflicts.

## Functional Requirements
1.  **Modularize Discovery Detectors**:
    *   Convert `src-tauri/src/discovery/detectors.rs` into a module directory `src-tauri/src/discovery/detectors/`.
    *   Each specific detector (Node, Rust, Python, etc.) must reside in its own file.
    *   Extract shared discovery utilities (e.g., `deps_has_package`, `read_utf8`) into a dedicated `discovery/utils.rs` or similar.
2.  **Modularize IDE Detection**:
    *   Convert `src-tauri/src/ide.rs` into a module directory `src-tauri/src/ide/`.
    *   Split platform-specific logic and candidate lookup into separate files.
3.  **Implement Rust Style Guide**:
    *   Create `/ai/styleguide-rust.md`.
    *   Define standards for: Error handling, Modularity, Naming, Async usage, and Tauri command structure.
4.  **Refactor Error System**:
    *   Update `src-tauri/src/error.rs` to support `thiserror`.
    *   Create a mapping mechanism from internal Enums to the frontend-safe `StableError`.

## Non-Goals (Out of Scope)
*   Rewriting core business logic or changing existing functionality (this is a refactor).
*   Changing the frontend-backend communication protocol (must stay Tauri commands).
*   Refactoring the frontend code (unless necessary to accommodate error handling changes).

## Technical Considerations
*   **Dependencies**: Add `thiserror` and `anyhow` to `Cargo.toml`.
*   **Modularity**: Use the "folder-with-mod-rs" or "folder-with-filename-rs" pattern consistently.
*   **Error Handling**: Use `thiserror` for internal modules. Consider `anyhow` only for the top-level command handlers if high-level context is needed.
*   **Traits**: Leverage the `ProjectDetector` trait to register detectors in the `DetectorRegistry` more dynamically.
*   **Tauri State**: Ensure state management remains thread-safe and idiomatic.

## Success Metrics
*   `src-tauri/src/discovery/detectors.rs` is replaced by a directory where no file exceeds 400 lines.
*   `src-tauri/src/ide.rs` is replaced by a directory where no file exceeds 400 lines.
*   `ai/styleguide-rust.md` is created and all refactored code complies with it.
*   The project builds and passes all existing tests.

## Open Questions
1.  Should we use a macro or a manual registry for detectors to make adding new ones easier?
2.  How strictly should we enforce the 500 LOC limit for complex generated files (e.g., if we had any)? (Currently not an issue but good to define).
