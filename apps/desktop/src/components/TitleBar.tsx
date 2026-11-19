import {useEffect,useState} from 'react';
import {getCurrentWindow} from '@tauri-apps/api/window';

export function TitleBar({page}:{page:string}){
 const native=typeof window!=='undefined'&&Boolean((window as any).__TAURI_INTERNALS__?.metadata?.currentWindow?.label);
 const [maximized,setMaximized]=useState(false),[failure,setFailure]=useState<string|null>(null);
 useEffect(()=>{
  if(!native)return;let alive=true,unlisten:(()=>void)|undefined;const app=getCurrentWindow();
  const update=()=>void app.isMaximized().then(value=>{if(alive)setMaximized(value);}).catch(()=>{});
  update();void app.onResized(update).then(stop=>{if(alive)unlisten=stop;else stop();}).catch(()=>{});
  return()=>{alive=false;unlisten?.();};
 },[native]);
 async function action(kind:'minimize'|'maximize'|'close'){
  if(!native)return;setFailure(null);try{const app=getCurrentWindow();if(kind==='minimize')await app.minimize();else if(kind==='close')await app.close();else{await app.toggleMaximize();setMaximized(await app.isMaximized());}}catch{setFailure('Window action unavailable.');}
 }
 return <div className="titlebar"><div className="titlebar-drag" onMouseDown={event=>{if(!native||event.button!==0)return;if(event.detail===2)void action('maximize');else void getCurrentWindow().startDragging().catch(()=>setFailure('Window drag unavailable.'));}}>
  <span className="titlebar-mark">LV</span><span>LV999</span><span className="titlebar-divider">/</span><span className="titlebar-page">{page}</span>
 </div>{failure?<span role="alert" className="titlebar-error">{failure}</span>:null}<div className="window-controls">
  <button aria-label="Minimize window" title="Minimize" disabled={!native} onClick={()=>void action('minimize')}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10"/></svg></button>
  <button aria-label={maximized?'Restore window':'Maximize window'} title={maximized?'Restore':'Maximize'} disabled={!native} onClick={()=>void action('maximize')}><svg viewBox="0 0 16 16" aria-hidden="true">{maximized?<path d="M5 3h8v8M3 5h8v8H3z"/>:<path d="M3 3h10v10H3z"/>}</svg></button>
  <button className="window-close" aria-label="Close window" title="Close" disabled={!native} onClick={()=>void action('close')}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13"/></svg></button>
 </div></div>;
}
