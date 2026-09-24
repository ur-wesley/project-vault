--!strict
-- Fragment: vault.createSignal/createMemo/createEffect/batch (Solid-style).
-- Runtime: src-tauri/src/lua/ui/signals.luau, wired in src-tauri/src/lua/engine.rs
--
-- Example:
--   local count, setCount = vault.createSignal(0)
--   local doubled = vault.createMemo(function() return count() * 2 end)
--   vault.createEffect(function()
--     vault.ui.update_view({ id = "dirty", patch = { count = count() } })
--   end)

export type VaultSignalsFragment = {
    createSignal: (initial: any) -> ((() -> any) & ((any) -> ())),
    createMemo: (fn: () -> any) -> (() -> any),
    createEffect: (fn: () -> ()) -> (() -> ()),
    batch: (fn: () -> ()) -> (),
}
