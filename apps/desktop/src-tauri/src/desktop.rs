use std::{sync::Mutex,time::Duration,fs};
use tauri::{Manager,State};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_updater::{UpdaterExt,Update};
use serde_json::{json,Value};
use crate::SharedBackend;

pub struct DesktopState { pub automatic:Mutex<bool>,pub pending:Mutex<Option<Update>>,pub status:Mutex<Value> }
impl DesktopState { pub fn new(automatic:bool)->Self{Self{automatic:Mutex::new(automatic),pending:Mutex::new(None),status:Mutex::new(json!({"phase":"idle"}))}} }
fn installed()->bool {std::env::current_exe().ok().and_then(|p|p.parent().map(|d|d.join("uninstall.exe").is_file())).unwrap_or(false)}
fn status(state:&DesktopState)->Value{state.status.lock().unwrap().clone()}
#[tauri::command]
pub fn desktop_settings(app:tauri::AppHandle,state:State<'_,DesktopState>)->Result<Value,String>{
 Ok(json!({"installed":installed(),"autostart":app.autolaunch().is_enabled().map_err(|_|"Windows startup status is unavailable.")?,"automatic_checks":*state.automatic.lock().unwrap(),"version":app.package_info().version.to_string(),"executable":std::env::current_exe().map_err(|_|"Application path is unavailable.")?,"update":status(&state)}))
}
#[tauri::command]
pub fn set_autostart(app:tauri::AppHandle,enabled:bool)->Result<bool,String>{
 if enabled&&!installed(){return Err("Install LV999 before enabling Windows startup.".into());}
 let manager=app.autolaunch();if enabled{manager.enable()}else{manager.disable()}.map_err(|_|"Windows startup registration failed.")?;
 let actual=manager.is_enabled().map_err(|_|"Windows startup status could not be verified.")?;if actual!=enabled{return Err("Windows startup change was not verified.".into());}Ok(actual)
}
#[tauri::command]
pub fn set_update_checks(app:tauri::AppHandle,state:State<'_,DesktopState>,enabled:bool)->Result<bool,String>{
 let directory=app.path().app_local_data_dir().map_err(|_|"Settings directory unavailable.")?;fs::create_dir_all(&directory).map_err(|_|"Settings directory unavailable.")?;
 let path=directory.join("desktop-settings.json");let temporary=directory.join("desktop-settings.tmp");fs::write(&temporary,json!({"automatic_checks":enabled}).to_string()).and_then(|_|fs::rename(&temporary,&path)).map_err(|_|"Update preference could not be saved.")?;*state.automatic.lock().unwrap()=enabled;Ok(enabled)
}
#[tauri::command]
pub async fn check_app_update(app:tauri::AppHandle,state:State<'_,DesktopState>)->Result<Value,String>{
 {let mut current=state.status.lock().unwrap();if matches!(current["phase"].as_str(),Some("checking"|"downloading"|"installing")){return Ok(current.clone());}*current=json!({"phase":"checking"});}
 let backend=app.state::<SharedBackend>().inner().clone();
 let builder=app.updater_builder().timeout(Duration::from_secs(60)).on_before_exit(move||{if let Ok(mut owned)=backend.lock(){let _=owned.child.kill();let _=owned.child.wait();}});
 let checked=match builder.build(){Ok(updater)=>updater.check().await,Err(error)=>Err(error)};
 let next=match checked{
  Ok(Some(update))=>{let info=json!({"phase":"available","version":update.version,"notes":update.body});*state.pending.lock().unwrap()=Some(update);info},
  Ok(None)=>{*state.pending.lock().unwrap()=None;json!({"phase":"up_to_date"})},
  Err(error)=>{*state.pending.lock().unwrap()=None;if error.to_string().contains("404"){json!({"phase":"no_release","message":"No published update is available yet."})}else{json!({"phase":"error","message":"Update check failed. Check the connection and retry."})}}
 };*state.status.lock().unwrap()=next.clone();Ok(next)
}
#[tauri::command]
pub async fn install_app_update(app:tauri::AppHandle,state:State<'_,DesktopState>)->Result<Value,String>{
 if !installed(){return Err("Install LV999 before using automatic updates.".into());}
 let update=state.pending.lock().unwrap().take().ok_or("Check for an update first.")?;
 let shared=app.state::<SharedBackend>().inner().clone();let owner=uuid::Uuid::new_v4().to_string();let lease_owner=owner.clone();let guard_backend=shared.clone();
 let ready=tauri::async_runtime::spawn_blocking(move||guard_backend.lock().map_err(|_|"Backend lock unavailable.")?.request("begin_app_update",json!({"owner":lease_owner,"desktop_pid":std::process::id()}))).await.map_err(|_|"Update guard failed.")??;
 if ready["data"]["ready"]!=true{*state.pending.lock().unwrap()=Some(update);return Err("Finish or inspect pending writes before updating.".into());}
 *state.status.lock().unwrap()=json!({"phase":"downloading","downloaded":0});
 let progress_app=app.clone();let result=update.download_and_install(move|length,total|{let state=progress_app.state::<DesktopState>();let mut value=state.status.lock().unwrap();let downloaded=value["downloaded"].as_u64().unwrap_or(0)+length as u64;*value=json!({"phase":"downloading","downloaded":downloaded,"total":total});},||{}).await;
 // Windows exits after the verified installer starts. A failure keeps the old app and releases the lease.
 if let Ok(mut backend)=shared.lock(){let _=backend.request("end_app_update",json!({"owner":owner}));}
 match result{Ok(())=>{*state.status.lock().unwrap()=json!({"phase":"installing"});Ok(status(&state))},Err(_)=>{*state.status.lock().unwrap()=json!({"phase":"error","message":"Update verification or installation failed. The current version was kept."});Ok(status(&state))}}
}
