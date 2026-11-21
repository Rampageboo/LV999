import {useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
type DesktopInfo={installed:boolean;autostart:boolean;automatic_checks:boolean;version:string;executable:string;update:{phase:string;version?:string;notes?:string;message?:string;downloaded?:number;total?:number}};
export function useDesktopFeatures(){
 const native=Boolean((window as any).__TAURI_INTERNALS__?.metadata?.currentWindow?.label),started=useRef(false);
 const [info,setInfo]=useState<DesktopInfo|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
 async function refresh(){if(!native)return;const value=await invoke<DesktopInfo>('desktop_settings');setInfo(value);return value;}
 async function action(command:string,args?:Record<string,unknown>){setBusy(true);setError(null);try{await invoke(command,args);await refresh();}catch(e){setError(String(e));}finally{setBusy(false);}}
 useEffect(()=>{if(!native)return;let alive=true;void refresh().then(value=>{if(alive&&value?.automatic_checks&&!started.current){started.current=true;void action('check_app_update');}}).catch(e=>{if(alive)setError(String(e));});const timer=setInterval(()=>{void refresh().catch(()=>{});},2000);const checks=setInterval(()=>{void refresh().then(value=>{if(alive&&value?.automatic_checks)void action('check_app_update');}).catch(()=>{});},6*60*60*1000);return()=>{alive=false;clearInterval(timer);clearInterval(checks);};},[native]);
 return{info,error,busy,native,action};
}
export type DesktopFeatures=ReturnType<typeof useDesktopFeatures>;
export function UpdateNotice({desktop,onOpen}:{desktop:DesktopFeatures;onOpen:()=>void}){return desktop.info?.update.phase==='available'?<div className="setup-banner"><span>LV999 {desktop.info.update.version} is available.</span><button onClick={onOpen}>View update</button></div>:null;}
export function DesktopSettings({desktop}:{desktop:DesktopFeatures}){
 const {info,error,busy,action}=desktop;if(!desktop.native)return <p>Application controls are available in LV999 Desktop.</p>;
 if(!info)return <p role="status">{error??'Loading application settings…'}</p>;
 const update=info.update,working=busy||['checking','downloading','installing'].includes(update.phase);
 return <section className="desktop-settings"><h2>Startup & updates</h2>{error?<p role="alert" className="backend-error">{error}</p>:null}
 <label className="desktop-setting"><input type="checkbox" checked={info.autostart} disabled={busy||!info.installed&&!info.autostart} onChange={e=>void action('set_autostart',{enabled:e.target.checked})}/><span>Start with Windows</span></label>
 <label className="desktop-setting"><input type="checkbox" checked={info.automatic_checks} disabled={busy} onChange={e=>void action('set_update_checks',{enabled:e.target.checked})}/><span>Automatically check for updates</span></label>
 {!info.installed?<p>Install LV999 to enable Windows startup and update installation.</p>:null}
 <div className="workspace-actions"><button disabled={working} onClick={()=>void action('check_app_update')}>{update.phase==='checking'?'Checking…':'Check for updates'}</button>{update.phase==='available'?<button className="primary" disabled={working||!info.installed} onClick={()=>void action('install_app_update')}>Update to {update.version} & restart</button>:null}</div>
 <p role="status">{update.phase==='up_to_date'?'You have the latest version.':update.phase==='available'?`Version ${update.version} is available.`:update.phase==='downloading'?`Downloading verified update… ${Math.round((update.downloaded??0)/1024/1024)} MB${update.total?' / '+Math.round(update.total/1024/1024)+' MB':''}`:update.phase==='installing'?'Installing update and restarting…':update.message??''}</p>
 {update.notes?<details><summary>Release notes</summary><p className="release-notes">{update.notes}</p></details>:null}
 </section>;
}
