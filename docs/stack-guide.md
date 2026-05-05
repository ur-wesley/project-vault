# Tauri + SolidJS Stack Guide

This guide outlines the architectural patterns and development workflows for this project. Use it as a reference for maintaining consistency and as inspiration for similar stacks.

## 🚀 Core Stack

- **Runtime:** [Bun](https://bun.sh/) (Fast all-in-one JavaScript runtime)
- **Framework:** [Tauri v2](https://v2.tauri.app/) (Rust-based desktop app framework)
- **Frontend:** [SolidJS](https://www.solidjs.com/) (Reactive UI library with no virtual DOM)
- **Tooling:** [Mise](https://mise.jdx.dev/) (Tool/environment manager)
- **Styling:** [Tailwind CSS v4](https://tailwindcss.com/)
- **State/Data:** [TanStack Query](https://tanstack.com/query/latest) (Async state management)
- **Language:** [TypeScript](https://www.typescriptlang.org/) & [Rust](https://www.rust-lang.org/)

---

## 🏗️ Architecture

### 1. Hybrid Backend/Frontend
- **Rust (src-tauri):** Handles OS-level operations (FS, Network, PTY, SQLite). Logic is exposed via `#[tauri::command]`.
- **TypeScript (src):** Reactive UI layer. Communicates with Rust using `invoke()` and `listen()`.

### 2. Command Pattern
Commands in Rust return `Result<T, E>`. Frontend uses `invoke` wrapped in error-handling utilities.
- **Rust:** Use `thiserror` for custom error types.
- **Frontend:** Use `neverthrow` or similar result patterns for type-safe error handling.

### 3. Reactive State
Avoid global stores where possible. Use SolidJS signals and memos locally, and TanStack Query for server/system state.
```typescript
const [data, setData] = createSignal(null);
const query = createQuery(() => ({ queryKey: ['key'], queryFn: fetchData }));
```

---

## 🛠️ Development Workflow

### Tool Management
Always use `mise` to ensure consistent tool versions across the team.
```bash
mise install
mise run <task>
```

### Build & Run
- **Dev:** `bun dev` (Starts Vite with HMR)
- **Desktop Dev:** `bun tauri dev` (Starts Tauri window with dev tools)
- **Linting:** `bun run lint` (Powered by [Oxlint](https://oxlint.dev/))

---

## 💡 Best Practices

### 1. Tauri Commands
Keep commands thin. Delegate complex logic to Rust modules (`src-tauri/src/...`).
```rust
#[tauri::command]
pub async fn my_command(payload: String) -> Result<Response, Error> {
    my_module::process(payload).await
}
```

### 2. Performance
- Use `For` and `Show` components in SolidJS for efficient DOM reconciliation.
- Prefer `createMemo` over inline derived state.

### 3. Component Design
- Follow the Atomic Design or Feature-based folder structure (`src/features/...`).
- Export UI primitives to `src/components/ui` (e.g., Shadcn-style components).

### 4. Terminal/PTY
- Use `portable-pty` in Rust for terminal integration.
- Use `@xterm/xterm` in Frontend for rendering.
- Sync state via Tauri events (`listen`).

---

## 📦 Distribution
The project uses GitHub Actions (`.github/workflows/build-windows.yml`) to build and sign binaries. Release notes are maintained in `docs/RELEASE.md`.
