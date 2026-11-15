#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{io::{BufRead, BufReader, Write}, path::PathBuf, process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Arc, Mutex}, time::Duration};
use tauri::Manager;

struct Backend {
    child: Child,
    input: ChildStdin,
    output: mpsc::Receiver<String>,
    sequence: u64,
}
impl Backend {
    fn spawn(runtime: PathBuf, data: PathBuf) -> Result<Self, String> {
        let mut command = Command::new(runtime.join("lv999-node.exe"));
        command.arg(runtime.join("backend.mjs")).args(["management", "--data-dir"]).arg(data)
            .env_remove("NODE_OPTIONS").env_remove("NODE_PATH")
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().map_err(|_| "Bundled backend could not start. Reinstall LV999.".to_string())?;
        let input = child.stdin.take().ok_or("Backend input pipe unavailable.")?;
        let output = child.stdout.take().ok_or("Backend output pipe unavailable.")?;
        let (send, receive) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(output).lines() {
                match line { Ok(line) => { if send.send(line).is_err() { break; } }, Err(_) => break }
            }
        });
        Ok(Self { child, input, output: receive, sequence: 0 })
    }
    fn request(&mut self, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
        self.sequence += 1;
        let request = serde_json::json!({"id": self.sequence, "method": method, "params": params});
        writeln!(self.input, "{request}").and_then(|_| self.input.flush())
            .map_err(|_| "Backend stopped. Restart LV999 to reconnect.".to_string())?;
        let line = self.output.recv_timeout(Duration::from_secs(35))
            .map_err(|_| "Backend did not respond within 35 seconds. Restart LV999 and check the connection.".to_string())?;
        let response: serde_json::Value = serde_json::from_str(&line).map_err(|_| "Backend protocol error.")?;
        if response["id"].as_u64() != Some(self.sequence) { return Err("Backend response mismatch. Restart LV999.".into()); }
        response.get("result").cloned().ok_or("Backend rejected the management request.".into())
    }
}
impl Drop for Backend {
    fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); }
}
type SharedBackend = Arc<Mutex<Backend>>;

#[tauri::command]
async fn backend_snapshot(state: tauri::State<'_, SharedBackend>) -> Result<serde_json::Value, String> {
    let backend = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut snapshot = backend.lock().map_err(|_| "Backend lock unavailable.")?.request("snapshot", serde_json::Value::Null)?;
        if let Some(diagnostics) = snapshot["diagnostics"].as_array_mut() {
            diagnostics.push(serde_json::json!({"key":"webview", "label":"Windows WebView2", "status":"pass", "detail":"Native IPC handshake received from the desktop webview"}));
        }
        Ok(snapshot)
    }).await.map_err(|_| "Backend worker failed.".to_string())?
}

#[tauri::command]
async fn verify_workspace(workspace_id: String, state: tauri::State<'_, SharedBackend>) -> Result<serde_json::Value, String> {
    let backend = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        backend.lock().map_err(|_| "Backend lock unavailable.")?.request("verify_workspace", serde_json::json!({"workspace_id":workspace_id}))
    }).await.map_err(|_| "Backend worker failed.".to_string())?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let runtime = if cfg!(debug_assertions) {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("runtime")
            } else { app.path().resource_dir()?.join("runtime") };
            let backend = Backend::spawn(runtime, app.path().app_local_data_dir()?).map_err(std::io::Error::other)?;
            app.manage(Arc::new(Mutex::new(backend)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![backend_snapshot, verify_workspace])
        .build(tauri::generate_context!())
        .expect("LV999 desktop could not start")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Wry can exit the process without running Rust destructors. Reap the owned child explicitly.
                let state = app.state::<SharedBackend>();
                if let Ok(mut backend) = state.lock() {
                    let _ = backend.child.kill();
                    let _ = backend.child.wait();
                };
            }
        });
}
