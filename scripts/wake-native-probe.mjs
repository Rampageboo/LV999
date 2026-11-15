import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const folder=await mkdtemp(join(tmpdir(),'lv999-wake-native-'));
try{
  await build({entryPoints:['tests/fixtures/wake-library.ts'],outfile:join(folder,'bridge.mjs'),bundle:true,platform:'node',format:'esm',target:'node26'});
  const {NativeAgentBridge}=await import(pathToFileURL(join(folder,'bridge.mjs')).href);const bridge=new NativeAgentBridge();
  for(const actor of process.argv.includes('--stop-only')?['codex']:['claude','codex']){
    let nativeId=null;
    try{
      if(process.argv.includes('--stop-only')){
        const controller=new AbortController();let delivered=false;
        try{await bridge.run({actor,model:'gpt-5.6-sol',effort:'low',cwd:join(folder,actor),nativeId:null,messageId:randomUUID(),nonce:randomUUID(),
          body:'Bounded interruption test. Reply with a short hello and receipt JSON.',signal:controller.signal,onSession:id=>{nativeId=id;},onDelivered:()=>{delivered=true;controller.abort();}});
          throw new Error('Stopped turn unexpectedly returned a response');
        }catch(error){if(error.code!=='CANCELLED'||!delivered)throw error;console.log(JSON.stringify({actor,stop_ok:true,delivered,reply_accepted:false}));}
        continue;
      }
      const reply=await bridge.run({actor,model:actor==='claude'?'sonnet':'gpt-5.6-sol',effort:'low',cwd:join(folder,actor),nativeId:null,
        messageId:randomUUID(),nonce:randomUUID(),body:'This is a bounded LV999 wake integration test. Reply with the requested receipt JSON and a short hello. Do not use tools.',
        signal:new AbortController().signal,onSession:id=>{nativeId=id;},onDelivered:()=>{}});
      console.log(JSON.stringify({actor,ok:true,session_created:Boolean(nativeId),receipt_confirmed:true,reply_length:reply.reply.length}));
      if(actor==='codex'){
        const resumed=await bridge.run({actor,model:'gpt-5.6-sol',effort:'low',cwd:join(folder,actor),nativeId,messageId:randomUUID(),nonce:randomUUID(),
          body:'Second bounded test in this same managed session. Return the new receipt JSON and a short acknowledgement. Do not use tools.',signal:new AbortController().signal,
          onSession:id=>{if(id!==nativeId)throw new Error('Session changed during resume');},onDelivered:()=>{}});
        console.log(JSON.stringify({actor,resume_ok:true,reply_length:resumed.reply.length}));
      }
    }catch(error){process.exitCode=1;console.log(JSON.stringify({actor,ok:false,code:error.code??'NATIVE_FAILED',message:error.message}));}
  }
}finally{if(!resolve(folder).startsWith(resolve(tmpdir())+'\\lv999-wake-native-'))throw new Error('Invalid QA cleanup path');await rm(folder,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
