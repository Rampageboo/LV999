import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { result, type AgentBinding } from '../../../../packages/contracts/src/index.js';
import { safeError } from '../notion/adapter.js';
import type { MessageHub } from './hub.js';
import { NativeAgentBridge, BridgeFailure, type AgentBridge } from './native-bridge.js';
import type { BindingRow } from './wake-store.js';

type Claim={ wake_id:string; message_id:string; nonce:string; binding:BindingRow; owner:string; body:string };
export class WakeEngine {
  private readonly owner=randomUUID();
  private readonly running=new Map<string,{bindingId:string;generation:number;abort:AbortController}>();
  private timer:ReturnType<typeof setInterval>|null=null;
  private closing=false;
  constructor(readonly hub:MessageHub,private bridge:AgentBridge=new NativeAgentBridge()){}
  start(){if(this.timer)return;this.closing=false;this.timer=setInterval(()=>this.tick(),500);this.timer.unref();this.tick();}
  shutdown(){this.closing=true;if(this.timer)clearInterval(this.timer);this.timer=null;for(const job of this.running.values())job.abort.abort();}
  private fence(claim:Claim) {
    return Boolean(this.hub.wakes.store.db.prepare(`SELECT b.id FROM agent_bindings b JOIN wake_requests w ON w.id=b.active_wake_id WHERE b.id=? AND b.generation=?
      AND b.paused=0 AND b.enabled=1 AND b.active_wake_id=? AND w.lease_owner=? AND w.status IN ('DISPATCHING','DELIVERED')`).get(claim.binding.id,claim.binding.generation,claim.wake_id,claim.owner));
  }
  private claim():Claim|null {
    const db=this.hub.wakes.store.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      const wake=db.prepare(`SELECT w.* FROM wake_requests w JOIN agent_bindings b ON b.workspace_id=w.workspace_id AND b.project_key=w.project_key AND b.actor=w.actor
        WHERE w.status='PENDING' AND b.enabled=1 AND b.paused=0 AND b.status='Idle' AND b.active_wake_id IS NULL ORDER BY w.created_at,w.id LIMIT 1`).get();
      if(!wake){db.exec('COMMIT');return null;}
      const binding=this.hub.wakes.rows().find(b=>b.workspace_id===wake.workspace_id&&b.project_key===wake.project_key&&b.actor===wake.actor)!;
      db.prepare(`UPDATE wake_requests SET status='DISPATCHING',attempts=attempts+1,lease_owner=?,lease_until=?,generation=?,code=NULL,updated_at=? WHERE id=?`)
        .run(this.owner,Date.now()+180000,binding.generation,new Date().toISOString(),wake.id!);
      db.prepare(`UPDATE agent_bindings SET status='Busy',active_wake_id=?,last_code=NULL,updated_at=? WHERE id=?`).run(wake.id!,new Date().toISOString(),binding.id);
      const message=db.prepare('SELECT body FROM chat_messages WHERE id=?').get(wake.message_id!)!;
      db.exec('COMMIT');return {wake_id:String(wake.id),message_id:String(wake.message_id),nonce:String(wake.nonce),binding,owner:this.owner,body:String(message.body)};
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  private expire(){
    const db=this.hub.wakes.store.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      const expired=db.prepare(`SELECT id FROM wake_requests WHERE status IN ('DISPATCHING','DELIVERED') AND lease_until<?`).all(Date.now());
      for(const row of expired){
        db.prepare(`UPDATE agent_bindings SET paused=1,status='Blocked',generation=generation+1,revision=revision+1,active_wake_id=NULL,last_code='PREVIOUS_OUTCOME_UNKNOWN',updated_at=? WHERE active_wake_id=?`).run(new Date().toISOString(),row.id!);
        db.prepare(`UPDATE wake_requests SET status='BLOCKED',code='PREVIOUS_OUTCOME_UNKNOWN',updated_at=? WHERE id=?`).run(new Date().toISOString(),row.id!);
      }
      db.prepare(`UPDATE agent_bindings SET active_wake_id=NULL WHERE paused=1 AND active_wake_id IN (SELECT id FROM wake_requests WHERE status='CANCELLED' AND lease_until<?)`).run(Date.now());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  tick(){
    if(this.closing)return;
    try {
      this.expire();
      for(const [wakeId,job]of this.running){
        const row=this.hub.wakes.rows().find(b=>b.id===job.bindingId);
        if(!row||row.paused||row.active_wake_id!==wakeId||row.generation!==job.generation)job.abort.abort();
        else this.hub.wakes.store.db.prepare(`UPDATE wake_requests SET lease_until=? WHERE id=? AND lease_owner=? AND status IN ('DISPATCHING','DELIVERED')`).run(Date.now()+180000,wakeId,this.owner);
      }
      while(this.running.size<2){const claim=this.claim();if(!claim)break;const abort=new AbortController();this.running.set(claim.wake_id,{bindingId:claim.binding.id,generation:claim.binding.generation,abort});void this.run(claim,abort).finally(()=>this.running.delete(claim.wake_id));}
    }catch{/* Another local writer or unavailable storage does not authorize another native turn. */}
  }
  private async run(claim:Claim,abort:AbortController){
    const db=this.hub.wakes.store.db;
    try {
      if(!this.fence(claim))return;
      const reply=await this.bridge.run({actor:claim.binding.actor,model:claim.binding.model,effort:claim.binding.effort,
        cwd:join(this.hub.wakes.store.directory,'managed-sessions',claim.binding.id),nativeId:claim.binding.native_session_id,
        messageId:claim.message_id,nonce:claim.nonce,body:claim.body,signal:abort.signal,
        onSession:id=>{
          if(!this.fence(claim)){abort.abort();throw new BridgeFailure('CANCELLED','Binding was stopped.');}
          db.prepare('UPDATE agent_bindings SET native_session_id=?,updated_at=? WHERE id=? AND generation=? AND paused=0')
            .run(id,new Date().toISOString(),claim.binding.id,claim.binding.generation);
        },onDelivered:()=>{if(this.fence(claim))db.prepare(`UPDATE wake_requests SET status='DELIVERED',updated_at=? WHERE id=? AND lease_owner=?`).run(new Date().toISOString(),claim.wake_id,this.owner);}});
      if(abort.signal.aborted)throw new BridgeFailure('CANCELLED','Stopped native turn cannot be acknowledged.');
      if(reply.message_id!==claim.message_id||reply.receipt_nonce!==claim.nonce||!reply.reply.trim()||reply.reply.length>8000)throw new BridgeFailure('INVALID_ACK','Native reply did not match this wake.');
      db.exec('BEGIN IMMEDIATE');
      try {
        if(!this.fence(claim)){db.exec('ROLLBACK');return;}
        const message=db.prepare('SELECT * FROM chat_messages WHERE id=?').get(claim.message_id)!;
        const existing=db.prepare('SELECT * FROM chat_messages WHERE sender_id=? AND idempotency_key=?').get(claim.binding.actor,claim.wake_id);
        if(existing&&existing.body!==reply.reply)throw new BridgeFailure('REPLY_CONFLICT','Reply retry key conflicted.');
        if(!existing){
          const id=randomUUID();
          db.prepare(`INSERT INTO chat_messages(id,workspace_id,project_key,project_name,sender_id,body,reply_to_id,idempotency_key,created_at,mentions_json,correlation_id,hop_count) VALUES (?,?,?,?,?,?,?,?,?,'[]',?,?)`)
            .run(id,message.workspace_id!,message.project_key!,message.project_name!,claim.binding.actor,reply.reply,claim.message_id,claim.wake_id,new Date().toISOString(),message.correlation_id??claim.message_id,Number(message.hop_count??0)+1);
          for(const actor of ['human','claude','codex'])if(actor!==claim.binding.actor)db.prepare('INSERT INTO chat_receipts(message_id,recipient_id) VALUES (?,?)').run(id,actor);
        }
        db.prepare(`UPDATE chat_receipts SET read_at=COALESCE(read_at,?),read_source=COALESCE(read_source,'native_response') WHERE message_id=? AND recipient_id=?`)
          .run(new Date().toISOString(),claim.message_id,claim.binding.actor);
        db.prepare(`UPDATE wake_requests SET status='ACKNOWLEDGED',code=NULL,lease_until=NULL,updated_at=? WHERE id=?`).run(new Date().toISOString(),claim.wake_id);
        db.prepare(`UPDATE agent_bindings SET status='Idle',active_wake_id=NULL,last_code=NULL,updated_at=? WHERE id=? AND generation=?`).run(new Date().toISOString(),claim.binding.id,claim.binding.generation);
        this.hub.wakes.store.log({level:'info',action:`Agent ${claim.binding.actor} wake acknowledged`,workspace_id:claim.binding.workspace_id,code:'OK'});
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
    }catch(error){
      try{
        if(!this.fence(claim))return;
        const code=error instanceof BridgeFailure?error.code:'NATIVE_FAILED';
        db.exec('BEGIN IMMEDIATE');
        if(!this.fence(claim)){db.exec('ROLLBACK');return;}
        db.prepare(`UPDATE wake_requests SET status='BLOCKED',code=?,lease_until=NULL,updated_at=? WHERE id=?`).run(code,new Date().toISOString(),claim.wake_id);
        db.prepare(`UPDATE agent_bindings SET paused=1,status='Blocked',active_wake_id=NULL,last_code=?,revision=revision+1,updated_at=? WHERE id=? AND generation=?`).run(code,new Date().toISOString(),claim.binding.id,claim.binding.generation);
        db.exec('COMMIT');
      }catch{try{db.exec('ROLLBACK');}catch{}}
    }finally{
      try{db.prepare(`UPDATE agent_bindings SET active_wake_id=NULL,status=CASE WHEN paused=1 THEN status ELSE 'Idle' END,updated_at=?
        WHERE id=? AND active_wake_id=? AND EXISTS(SELECT id FROM wake_requests WHERE id=? AND lease_owner=?)
        AND (paused=1 OR EXISTS(SELECT id FROM wake_requests WHERE id=agent_bindings.active_wake_id AND status IN ('ACKNOWLEDGED','BLOCKED','CANCELLED')))`)
        .run(new Date().toISOString(),claim.binding.id,claim.wake_id,claim.wake_id,claim.owner);}catch{}
    }
  }
  configure(input:unknown){return this.hub.wakes.configure(input);}
  stop(id:string){
    try {const binding=this.hub.wakes.pause(id);return result(binding,binding.workspace_id);}
    catch(error){const failure=safeError(error);return result<AgentBinding>(null,null,failure.code,[failure.message]);}
    finally{for(const job of this.running.values())if(job.bindingId===id)job.abort.abort();}
  }
  resume(id:string,revision:number){try{const binding=this.hub.wakes.resume(id,revision);return result(binding,binding.workspace_id);}catch(error){const failure=safeError(error);return result<AgentBinding>(null,null,failure.code,[failure.message]);}}
  retry(id:string,revision:number){try{return result(this.hub.wakes.retry(id,revision));}catch(error){const failure=safeError(error);return result(null,null,failure.code,[failure.message]);}}
  async stopAll(){
    for(const row of this.hub.wakes.rows())if(row.enabled||row.active_wake_id)this.stop(row.id);
    const deadline=Date.now()+6000;
    while(this.running.size&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,30));
    this.shutdown();return result({paused:true,remaining_turns:this.running.size});
  }
}
