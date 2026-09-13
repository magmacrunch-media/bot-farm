//! BOT//FARM desktop shell.
//!
//! Thin on purpose. The window loads the same HTML, CSS and JavaScript a
//! browser would; this crate adds the things a browser tab cannot give it —
//! `gh`, the Task Scheduler, two HTTP probes, a log file on disk — and
//! nothing else. Everything the app knows about its bots lives in app/core/,
//! in JavaScript, where it is testable in Node.
//!
//! The behavior of the commands below is magma_kit's and farm.rs's; what
//! this file owns is the ALLOWLIST — one named command per thing the
//! frontend may do.

// `pub` for the sake of src/bin/farm-cli.rs, which is the MCP server's
// transport: the readings have a second reader now, and it must be the
// same collectors behind the same allowlists rather than a copy of them.
pub mod farm;

use std::sync::Mutex;

use magma_kit::dirty::Dirty;
use serde_json::Value;
use tauri::Manager;

/// The log file's path, resolved once at startup.
struct LogReady(Mutex<Option<String>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Dirty::new())
        .manage(LogReady(Mutex::new(None)))
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&dir)?;
            let path = magma_kit::log::init(&dir, "bot-farm.log");
            *app.state::<LogReady>().0.lock().unwrap() = Some(path.display().to_string());
            magma_kit::log::rs("boot", "app starting");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_text,
            write_text,
            exists,
            config_dir,
            app_version,
            log_line,
            log_path,
            quit,
            gh_api,
            gh_workflow,
            tasks_list,
            task_action,
            probe,
            journal,
            webhook,
            open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running BOT//FARM");
}

// ── files ───────────────────────────────────────────────
//
// Three-line wrappers over magma_kit::fs. The kit owns the behavior; this
// list is the surface. Only what herd.json needs.

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    magma_kit::fs::read_text(&path)
}

#[tauri::command]
fn write_text(path: String, contents: String) -> Result<(), String> {
    magma_kit::fs::write_text(&path, &contents)
}

#[tauri::command]
fn exists(path: String) -> bool {
    magma_kit::fs::exists(&path)
}

// ── config, version, lifecycle ──────────────────────────

/// The OS config directory, never the repo: herd.json lives here so this
/// machine's additions stay this machine's.
#[tauri::command]
fn config_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no config directory: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(dir.display().to_string())
}

/// Cargo.toml is the one source of truth for the version; the footer asks for
/// it rather than hardcoding one that would be wrong forever after.
#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// The webview's side of the log file — kit/boot.js reports crashes here,
/// main.js records chores.
#[tauri::command]
fn log_line(kind: String, message: String, detail: Option<String>) {
    magma_kit::log::write("JS", &kind, &message, detail.as_deref());
}

#[tauri::command]
fn log_path(state: tauri::State<LogReady>) -> Option<String> {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

// ── the farm ────────────────────────────────────────────
//
// Each of these blocks on a child process or a socket for up to a few
// seconds, so they run on the blocking pool rather than the main thread —
// the page fires a dozen at once on every walk and the window must stay
// responsive while gh answers.

async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
async fn gh_api(path: String) -> Result<Value, String> {
    blocking(move || farm::gh_api(&path)).await
}

#[tauri::command]
async fn gh_workflow(action: String, repo: String, file: String) -> Result<String, String> {
    blocking(move || farm::gh_workflow(&action, &repo, &file)).await
}

#[tauri::command]
async fn tasks_list() -> Result<Value, String> {
    blocking(farm::tasks_list).await
}

#[tauri::command]
async fn task_action(action: String, name: String) -> Result<String, String> {
    blocking(move || farm::task_action(&action, &name)).await
}

#[tauri::command]
async fn probe(name: String) -> Result<Value, String> {
    blocking(move || farm::probe(&name)).await
}

#[tauri::command]
async fn journal(name: String) -> Result<Value, String> {
    blocking(move || farm::journal(&name)).await
}

/// The webhook URLs this machine holds, if it holds any, live beside
/// herd.json — config, not repo, because they are credentials and because
/// which of them a machine has is that machine's business. farm.rs resolves
/// the name against this file and never hands the URL back.
#[tauri::command]
async fn webhook(app: tauri::AppHandle, name: String) -> Result<Value, String> {
    let secrets = app
        .path()
        .app_config_dir()
        .map(|d| d.join("webhooks.json").display().to_string())
        .ok();
    blocking(move || farm::webhook(&name, secrets.as_deref())).await
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    farm::open_url(&url)
}
