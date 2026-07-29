// Cockpit desktop shell (Tauri 2). Backs the web layer's FileStore +
// SecureKeyStore contracts. Everything written to disk or the keychain is
// AES-GCM ciphertext produced by the web layer — Rust never sees plaintext
// PHI, prompts, outputs, or unwrapped keys.
//
// Build: `npm run tauri build` (see native/README.md). This file is complete
// and buildable with the documented toolchain; it is intentionally not
// compiled in the browser/web CI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const SERVICE: &str = "app.cockpit.therapist";

fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().expect("app data dir");
    fs::create_dir_all(&dir).ok();
    dir
}

/// Resolve a relative path under the app-data dir, refusing traversal so the
/// web layer can never read/write outside its own private storage tree.
fn safe_join(app: &tauri::AppHandle, rel: &str) -> Result<PathBuf, String> {
    if rel.contains("..") || Path::new(rel).is_absolute() {
        return Err("invalid path".into());
    }
    let allowed = ["meta/", "records/", "blobs/"];
    if !allowed.iter().any(|p| rel.starts_with(p)) && !rel.is_empty() {
        return Err("path outside storage tree".into());
    }
    Ok(data_dir(app).join(rel))
}

#[tauri::command]
fn cockpit_read_file(app: tauri::AppHandle, path: String) -> Result<Option<String>, String> {
    let full = safe_join(&app, &path)?;
    Ok(fs::read_to_string(full).ok())
}

#[tauri::command]
fn cockpit_write_file(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
    let full = safe_join(&app, &path)?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(full, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn cockpit_remove_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let full = safe_join(&app, &path)?;
    if full.exists() {
        fs::remove_file(full).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn cockpit_list_dir(app: tauri::AppHandle, dir_prefix: String) -> Result<Vec<String>, String> {
    let base = safe_join(&app, &dir_prefix)?;
    let mut out = vec![];
    if let Ok(entries) = fs::read_dir(base) {
        for entry in entries.flatten() {
            if let Ok(name) = entry.file_name().into_string() {
                out.push(format!("{dir_prefix}{name}"));
            }
        }
    }
    Ok(out)
}

#[tauri::command]
fn cockpit_keychain_get(account: String) -> Option<String> {
    keyring::Entry::new(SERVICE, &account).ok()?.get_password().ok()
}

#[tauri::command]
fn cockpit_keychain_set(account: String, value: String) -> Result<(), String> {
    keyring::Entry::new(SERVICE, &account)
        .and_then(|e| e.set_password(&value))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn cockpit_keychain_delete(account: String) -> Result<(), String> {
    if let Ok(entry) = keyring::Entry::new(SERVICE, &account) {
        // Wiping the OS key must force passphrase unlock on next launch — there
        // is no recovery backdoor. Ignore "not found" so delete is idempotent.
        let _ = entry.delete_credential();
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .invoke_handler(tauri::generate_handler![
            cockpit_read_file,
            cockpit_write_file,
            cockpit_remove_file,
            cockpit_list_dir,
            cockpit_keychain_get,
            cockpit_keychain_set,
            cockpit_keychain_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running Cockpit");
}
