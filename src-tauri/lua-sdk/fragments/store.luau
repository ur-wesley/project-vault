--!strict
-- Fragment: vault.store — per-plugin isolated KV store (memory + opt-in persist).
-- Rust: src-tauri/src/lua/ui/store_state.rs + src-tauri/src/lua/modules/store.rs
--
-- Example:
--   vault.store.define({ key = "repos/filter", initial = "all" })
--   vault.store.define({ key = "repos/pinned", initial = {}, persist = true })
--   vault.store.set("repos/filter", "dirty")
--   local filter = vault.store.get("repos/filter")

export type VaultStoreFragment = {
    define: (options: { key: string, initial: any?, persist: boolean? }) -> { value: any, version: number },
    set: (key: string, value: any) -> { value: any, version: number },
    get: (key: string) -> any?,
    remove: (key: string) -> boolean,
    list: () -> { string },
    set_persist: (key: string, persist: boolean) -> boolean,
    clear: () -> (),
}
