# Installer identity

`template.nsi` is Tauri's standard NSIS template from tag `tauri-cli-v2.12.4`, under its MIT license (included here):
https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.4/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi

LV999 changes the uninstall/installation registry keys and autostart cleanup key to `BUNDLEID`, installation directory defaults to `<base>/com.rampageboo.lv999/app`, directory placeholder, and shortcut filename suffix `(Notion)`. Legacy WiX discovery by matching display name/publisher is disabled. The data-deletion checkbox and its recursive deletion block are removed; uninstall always preserves user data. Display product/window name stays LV999. The start menu folder is `LV999 Notion`. When updating the pinned Tauri CLI, compare the upstream template and repeat installer checks; do not revert to its display-name-derived identity.

The default Tauri template otherwise uses `%LOCALAPPDATA%/LV999` and an uninstall key named LV999, which can collide with the legacy C#/WPF product. App data remains in the parent `com.rampageboo.lv999` directory, separate from installed program files. The template must never recursively delete that local user-data directory.
