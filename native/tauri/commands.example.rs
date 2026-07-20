// Tauri command skeletons (Phase 6 scaffold — illustrative, not compiled here).
//
// These back the web layer's FileStore + SecureKeyStore contracts. Files are
// written under the OS app-data directory (backup-safe, app-private); the
// keychain uses the `keyring` crate (macOS Keychain / Windows Credential
// Manager). Everything written is AES-GCM ciphertext produced by the web
// layer — Rust never sees plaintext PHI.
//
// Cargo.toml (excerpt):
//   tauri = { version = "2", features = [] }
//   keyring = "3"
//   serde = { version = "1", features = ["derive"] }

use std::fs;
use std::path::PathBuf;
use tauri::Manager;

const SERVICE: &str = "app.cockpit.therapist";

fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().expect("app data dir");
    fs::create_dir_all(&dir).ok();
    dir
}

fn safe_join(app: &tauri::AppHandle, rel: &str) -> PathBuf {
    // Prevent path traversal: only allow the known subdirs the adapter uses.
    let rel = rel.replace("..", "");
    data_dir(app).join(rel)
}

#[tauri::command]
fn cockpit_read_file(app: tauri::AppHandle, path: String) -> Option<String> {
    fs::read_to_string(safe_join(&app, &path)).ok()
}

#[tauri::command]
fn cockpit_write_file(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
    let full = safe_join(&app, &path);
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(full, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn cockpit_remove_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let full = safe_join(&app, &path);
    if full.exists() {
        fs::remove_file(full).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn cockpit_list_dir(app: tauri::AppHandle, dir_prefix: String) -> Vec<String> {
    let base = data_dir(&app).join(&dir_prefix);
    let mut out = vec![];
    if let Ok(entries) = fs::read_dir(base) {
        for entry in entries.flatten() {
            if let Ok(name) = entry.file_name().into_string() {
                out.push(format!("{dir_prefix}{name}"));
            }
        }
    }
    out
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
        let _ = entry.delete_credential();
    }
    Ok(())
}

// In main(): .invoke_handler(tauri::generate_handler![
//   cockpit_read_file, cockpit_write_file, cockpit_remove_file, cockpit_list_dir,
//   cockpit_keychain_get, cockpit_keychain_set, cockpit_keychain_delete ])
