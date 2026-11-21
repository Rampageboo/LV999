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
        // Identity + read probe + vault round-trip + compensation each have bounded waits.
        let timeout = if matches!(method, "execute_mutation" | "prepare_mutation" | "content_read" | "setup_message_board") { 180 }
            else if matches!(method, "connect_workspace" | "reauthorize_workspace" | "test_client" | "refresh_oauth" | "shutdown_agents") { 120 } else { 60 };
        let line = self.output.recv_timeout(Duration::from_secs(timeout))
            .map_err(|_| "Backend response timed out. The operation result is unknown; restart LV999 and refresh before retrying.".to_string())?;
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

#[tauri::command]
async fn connect_workspace(input: serde_json::Value, state: tauri::State<'_, SharedBackend>) -> Result<serde_json::Value, String> {
    let backend = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        backend.lock().map_err(|_| "Backend lock unavailable.")?.request("connect_workspace", input)
    }).await.map_err(|_| "Backend worker failed.".to_string())?
}

#[tauri::command]
async fn reauthorize_workspace(input: serde_json::Value, state: tauri::State<'_, SharedBackend>) -> Result<serde_json::Value, String> {
    let backend = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        backend.lock().map_err(|_| "Backend lock unavailable.")?.request("reauthorize_workspace", input)
    }).await.map_err(|_| "Backend worker failed.".to_string())?
}

#[tauri::command]
async fn page_route_request(method: String, input: serde_json::Value, state: tauri::State<'_, SharedBackend>) -> Result<serde_json::Value, String> {
    if !matches!(method.as_str(), "browse_pages" | "inspect_page" | "save_project" | "resolve_project") {
        return Err("Unsupported page/routing operation.".into());
    }
    let backend = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        backend.lock().map_err(|_| "Backend lock unavailable.")?.request(&method, input)
    }).await.map_err(|_| "Backend worker failed.".to_string())?
}

#[tauri::command]
async fn client_request(method: String, input: serde_json::Value, state: tauri::State<'_, SharedBackend>) -> Result<serde_json::Value, String> {
    if !matches!(method.as_str(), "detect_clients" | "generate_client_config" | "preview_client_config" | "apply_client_config" | "test_client") {
        return Err("Unsupported client operation.".into());
    }
    let backend = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        backend.lock().map_err(|_| "Backend lock unavailable.")?.request(&method, input)
    }).await.map_err(|_| "Backend worker failed.".to_string())?
}

#[tauri::command]
async fn oauth_request(method: String, input: serde_json::Value, state: tauri::State<'_, SharedBackend>) -> Result<serde_json::Value, String> {
    if !matches!(method.as_str(), "oauth_status" | "configure_oauth" | "start_oauth" | "cancel_oauth" | "refresh_oauth") {
        return Err("Unsupported OAuth operation.".into());
    }
    let backend = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        backend.lock().map_err(|_| "Backend lock unavailable.")?.request(&method, input)
    }).await.map_err(|_| "Backend worker failed.".to_string())?
}

#[tauri::command]
fn open_notion_authorization(url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|_| "Invalid Notion authorization URL.")?;
    let pairs: Vec<_> = parsed.query_pairs().collect();
    let value = |key: &str| pairs.iter().find(|(name, _)| name.as_ref() == key).map(|(_, value)| value.as_ref());
    if parsed.scheme() != "https" || parsed.host_str() != Some("api.notion.com") || parsed.port().is_some()
        || parsed.path() != "/v1/oauth/authorize" || !parsed.username().is_empty() || parsed.password().is_some() || parsed.fragment().is_some()
        || pairs.len() != 5 || value("response_type") != Some("code") || value("owner") != Some("user")
        || value("redirect_uri") != Some("http://localhost:8765/oauth/notion/callback")
        || !value("client_id").is_some_and(|v| v.len() == 36 && v.chars().all(|c| c.is_ascii_hexdigit() || c == '-'))
        || !value("state").is_some_and(|v| v.len() == 43 && v.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')) {
        return Err("Invalid Notion authorization URL.".into());
    }
    let system = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\Windows"));
    let mut command = Command::new(system.join("System32").join("rundll32.exe"));
    command.args(["url.dll,FileProtocolHandler", &url]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    command.spawn().map(|_| ()).map_err(|_| "The browser could not be opened. Retry from LV999.".into())
}

#[tauri::command]
async fn content_request(method: String, input: serde_json::Value, state: tauri::State<'_, SharedBackend>) -> Result<serde_json::Value, String> {
    if !matches!(method.as_str(), "content_read" | "set_workspace_writes" | "prepare_mutation" | "approve_mutation" | "execute_mutation" | "mutation_status" | "pending_mutations" | "list_message_boards" | "setup_message_board" | "set_board_posting") {
        return Err("Unsupported content operation.".into());
    }
    let backend = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        backend.lock().map_err(|_| "Backend lock unavailable.")?.request(&method, input)
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
        .invoke_handler(tauri::generate_handler![backend_snapshot, verify_workspace, connect_workspace, reauthorize_workspace, page_route_request, client_request, oauth_request, open_notion_authorization, content_request])
        .build(tauri::generate_context!())
        .expect("LV999 desktop could not start")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Wry can exit the process without running Rust destructors. Reap the owned child explicitly.
                let state = app.state::<SharedBackend>();
                if let Ok(mut backend) = state.lock() {
                    let _ = backend.request("shutdown_agents", serde_json::Value::Null);
                    let _ = backend.child.kill();
                    let _ = backend.child.wait();
                };
            }
        });
}
