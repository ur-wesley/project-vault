# Plugin SDK fragments

Each new UI/store capability owns one fragment here, colocated by concern
with its Rust module under `src-tauri/src/lua/ui/`.

- `store.luau` ↔ `lua/ui/store_state.rs` + `lua/modules/store.rs`
- `signals.luau` ↔ `lua/ui/signals.luau` + `lua/engine.rs` wiring
- `table.luau` ↔ `lua/ui/types.rs` + `lua/ui/dialogs.rs`

`vault.luau` (parent dir) is the concatenated output shipped to plugins
(`lib.rs` copies it to `<app_data>/plugins/vault.luau` on startup).
Regenerate after editing fragments:

```sh
bun run gen:sdk
```

The script concatenates `fragments/*.luau` between the header/footer markers
in `vault.luau` and fails when a fragment type is missing from the output.
