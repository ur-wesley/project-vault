# Release hardening (Project Vault)

## Updater (Tauri v2)

To ship auto-updates later:

1. Add `tauri-plugin-updater` to `src-tauri/Cargo.toml` and register the plugin in `lib.rs`.
2. In `tauri.conf.json`, under `plugins`, configure updater `endpoints` to your JSON manifest URL and set `pubkey` to the public key that signs releases.
3. Code signing: on Windows use an Authenticode certificate for the installer; on macOS use Apple notarization and hardened runtime as required by Apple.

Placeholders are intentionally not committed so dev builds stay simple until a release channel exists.

## Manual QA matrix

| Area                                              | Windows | macOS | Linux |
| ------------------------------------------------- | ------- | ----- | ----- |
| Add library folder + scan                         |         |       |       |
| Project detail: files, tasks, terminal, history   |         |       |       |
| Command palette (Ctrl/Cmd+K), open project detail |         |       |       |
| New project wizard + rescan                       |         |       |       |
| Settings: shell, density, scan interval           |         |       |       |
| Export library JSON                               |         |       |       |
| Locale / i18n strings                             |         |       |       |

Record build version and notes in your release ticket.
