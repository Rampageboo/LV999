import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach,expect,it,vi } from 'vitest';
import { Store } from '../apps/server/src/infra/store.js';
import { MessageHub } from '../apps/server/src/messenger/hub.js';
import { WakeEngine } from '../apps/server/src/messenger/wake-engine.js';
import { BridgeFailure,type AgentBridge,type NativeRun,type NativeReply } from '../apps/server/src/messenger/native-bridge.js';
import { DomainError } from '../apps/server/src/notion/adapter.js';
const cleanup:(()=>void)[]=[];afterEach(()=>cleanup.splice(0).reverse().forEach(fn=>fn()));
function fixture(bridge?:AgentBridge){
  const directory=mkdtempSync(join(tmpdir(),'lv999-wake-unit-')),store=new Store(directory),workspace=randomUUID();
  store.add({id:workspace,label:'Wake test',environment:'test'});const hub=new MessageHub(store);
  const fake={run:vi.fn(async(input:NativeRun):Promise<NativeReply>=>{input.onSession(input.nativeId??randomUUID());input.onDelivered();return{message_id:input.messageId,receipt_nonce:input.nonce,reply:'Hello from managed session'};})};
  const engine=new WakeEngine(hub,bridge??fake);cleanup.push(()=>{engine.shutdown();store.close();rmSync(directory,{recursive:true,force:true});});
  const configure=(actor:'codex'|'claude'='codex')=>engine.configure({workspace_id:workspace,actor,model:actor==='codex'?'gpt-5.6-sol':'sonnet',effort:'low',enabled:true,expected_revision:0});
  const send=(mentions:('claude'|'codex')[]=[],extra:object={})=>hub.send({actor:'human',workspace_ids:'owner'},{workspace_id:workspace,body:'Hello',mentions,idempotency_key:randomUUID(),...extra});
  return{directory,store,workspace,hub,engine,fake,configure,send};
}
it('ordinary messages, including literal @ text, never invoke the bridge',async()=>{
  const f=fixture();f.configure();f.send([], {body:'@Codex is plain text'});f.engine.tick();await Promise.resolve();expect(f.fake.run).not.toHaveBeenCalled();
});
it('keeps Notion access opt-in and starts a new session when its tool scope changes',async()=>{
  const f=fixture();const binding=f.configure().data!;expect(binding.notion_tools).toBe(false);
  const first=f.send(['codex']).data!;f.engine.tick();await vi.waitFor(()=>expect(f.hub.wakes.messages(first.id)[0].status).toBe('ACKNOWLEDGED'));
  const current=f.hub.wakes.view(f.hub.wakes.rows()[0]);expect(current.native_session_id).not.toBeNull();
  const changed=f.engine.configure({workspace_id:f.workspace,actor:'codex',model:current.model,effort:current.effort,enabled:true,notion_tools:true,expected_revision:current.revision});
  expect(changed.data).toMatchObject({notion_tools:true,native_session_id:null});
});
it('creates one durable wake per structured target and keeps retries idempotent',()=>{
  const f=fixture();f.configure();f.configure('claude');const key=randomUUID();
  const first=f.send(['codex','claude'],{idempotency_key:key});
  const second=f.send(['claude','codex'],{idempotency_key:key});expect(second.data!.id).toBe(first.data!.id);expect(first.data!.wakes).toHaveLength(2);
  expect(f.send([],{idempotency_key:key}).code).toBe('IDEMPOTENCY_CONFLICT');
  expect(f.send(['codex','codex']).data!.wakes).toHaveLength(1);
});
it('automatically creates an owned session and records only a verified native acknowledgement',async()=>{
  const f=fixture();const binding=f.configure().data!;const message=f.send(['codex']).data!;f.engine.tick();
  await vi.waitFor(()=>expect(f.hub.wakes.messages(message.id)[0].status).toBe('ACKNOWLEDGED'));
  const row=f.hub.wakes.rows().find(b=>b.id===binding.id)!;expect(row.native_session_id).not.toBeNull();
  const history=f.hub.read({actor:'human',workspace_ids:'owner'},{workspace_id:f.workspace}).data!.messages;
  expect(history).toHaveLength(2);expect(history[0].receipts.find(r=>r.recipient_id==='codex')!.read_source).toBe('native_response');
  expect(history[1]).toMatchObject({sender_id:'codex',reply_to_id:message.id,mentions:[]});
});
it('resumes the same owned session on the next mention and never auto-mentions its reply',async()=>{
  const f=fixture();f.configure();const first=f.send(['codex']).data!;f.engine.tick();await vi.waitFor(()=>expect(f.hub.wakes.messages(first.id)[0].status).toBe('ACKNOWLEDGED'));
  await vi.waitFor(()=>expect(f.hub.wakes.rows()[0].status).toBe('Idle'));const native=f.hub.wakes.rows()[0].native_session_id;
  const second=f.send(['codex']).data!;f.engine.tick();await vi.waitFor(()=>expect(f.hub.wakes.messages(second.id)[0].status).toBe('ACKNOWLEDGED'));
  expect(f.fake.run.mock.calls[1][0].nativeId).toBe(native);expect(f.store.db.prepare('SELECT count(*) AS n FROM wake_requests').get()!.n).toBe(2);
});
it('uses project overrides and keeps Workspace defaults as separate owned bindings',async()=>{
  const f=fixture();f.configure();const root=randomUUID();
  f.store.saveProject({project_key:'QA',name:'Project topic',workspace_id:f.workspace,root_page_id:root,expected_revision:0},
    {workspace_id:f.workspace,id:root,title:'Root',url:'https://www.notion.so/',parent_kind:'workspace',last_edited_time:null,root_eligible:true,root_reason:null});
  expect(f.engine.configure({workspace_id:f.workspace,project_key:'QA',actor:'codex',model:'project-model',effort:'low',enabled:true,expected_revision:0}).ok).toBe(true);
  const project=f.send(['codex'],{project_key:'QA',route_revision:1}).data!,general=f.send(['codex']).data!;f.engine.tick();
  await vi.waitFor(()=>expect([project,general].every(msg=>f.hub.wakes.messages(msg.id)[0].status==='ACKNOWLEDGED')).toBe(true));
  expect(f.fake.run.mock.calls.map(call=>call[0].model).sort()).toEqual(['gpt-5.6-sol','project-model']);
  expect(new Set(f.fake.run.mock.calls.map(call=>call[0].cwd)).size).toBe(2);
});
it('queues busy messages until the first turn completes without steering/interruption',async()=>{
  let finish!:(value:NativeReply)=>void;let active!:NativeRun;
  const run=vi.fn(async(input:NativeRun)=>{active=input;input.onSession(randomUUID());input.onDelivered();return new Promise<NativeReply>(resolve=>{finish=resolve;});});
  const f=fixture({run});f.configure();const first=f.send(['codex']).data!;f.engine.tick();await vi.waitFor(()=>expect(run).toHaveBeenCalledTimes(1));
  const second=f.send(['codex']).data!;f.engine.tick();expect(run).toHaveBeenCalledTimes(1);expect(f.hub.wakes.messages(second.id)[0].status).toBe('PENDING');
  finish({message_id:active.messageId,receipt_nonce:active.nonce,reply:'First'});await vi.waitFor(()=>expect(f.hub.wakes.messages(first.id)[0].status).toBe('ACKNOWLEDGED'));
  f.engine.tick();await vi.waitFor(()=>expect(run).toHaveBeenCalledTimes(2));f.engine.stop(f.hub.wakes.rows()[0].id);finish({message_id:active.messageId,receipt_nonce:active.nonce,reply:'Late'});
});
it('persists Stop before interruption and fences a late model reply/read receipt',async()=>{
  let finish!:(value:NativeReply)=>void;let active!:NativeRun;
  const f=fixture({run:async input=>{active=input;input.onSession(randomUUID());input.onDelivered();return new Promise(resolve=>{finish=resolve;});}});
  const binding=f.configure().data!,message=f.send(['codex']).data!;f.engine.tick();await vi.waitFor(()=>expect(active).toBeDefined());
  expect(f.engine.stop(binding.id).data!.paused).toBe(true);expect(active.signal.aborted).toBe(true);
  expect(f.engine.resume(binding.id,f.hub.wakes.rows()[0].revision).code).toBe('SESSION_BUSY');
  finish({message_id:active.messageId,receipt_nonce:active.nonce,reply:'Late result'});await Promise.resolve();await Promise.resolve();
  expect(f.hub.wakes.messages(message.id)[0].status).toBe('CANCELLED');expect(f.store.db.prepare('SELECT count(*) AS n FROM chat_messages').get()!.n).toBe(1);
  expect(f.hub.readOne({actor:'human',workspace_ids:'owner'},message.id).data!.receipts.find(r=>r.recipient_id==='codex')!.read_at).toBeNull();
});
it('stale Resume and Retry requests cannot race past a newer user Stop',()=>{
  const f=fixture(),binding=f.configure().data!;f.engine.stop(binding.id);
  const firstPause=f.hub.wakes.rows()[0].revision,message=f.send(['codex']).data!;
  f.engine.stop(binding.id);
  expect(f.engine.resume(binding.id,firstPause).code).toBe('BINDING_CONFLICT');
  const latest=f.hub.wakes.rows()[0].revision;expect(f.engine.resume(binding.id,latest).ok).toBe(true);
  expect(f.engine.retry(message.wakes[0].id,latest).code).toBe('BINDING_CONFLICT');
  f.engine.stop(binding.id);f.engine.tick();expect(f.fake.run).not.toHaveBeenCalled();
});
it('still interrupts its native process if persisting Stop fails, and refuses that aborted reply',async()=>{
  let active!:NativeRun,finish!:(value:NativeReply)=>void;
  const f=fixture({run:async input=>{active=input;return new Promise(resolve=>{finish=resolve;});}}),binding=f.configure().data!,message=f.send(['codex']).data!;
  f.engine.tick();await vi.waitFor(()=>expect(active).toBeDefined());
  const pause=vi.spyOn(f.hub.wakes,'pause').mockImplementationOnce(()=>{throw new DomainError('LOCAL_SAVE_FAILED','Storage unavailable');});
  expect(f.engine.stop(binding.id).ok).toBe(false);expect(active.signal.aborted).toBe(true);pause.mockRestore();
  finish({message_id:active.messageId,receipt_nonce:active.nonce,reply:'Must not be accepted'});
  await vi.waitFor(()=>expect(f.hub.wakes.messages(message.id)[0].status).toBe('BLOCKED'));
  expect(f.store.db.prepare('SELECT count(*) AS n FROM chat_messages').get()!.n).toBe(1);expect(f.hub.wakes.rows()[0].paused).toBe(1);
});
it('new mentions, restart and retry cannot silently resume a user-stopped binding',async()=>{
  const f=fixture();const binding=f.configure().data!;f.engine.stop(binding.id);
  const message=f.send(['codex']).data!;expect(message.wakes[0].code).toBe('PAUSED_BY_USER');f.engine.tick();expect(f.fake.run).not.toHaveBeenCalled();
  const otherStore=new Store(f.directory),otherHub=new MessageHub(otherStore),other=new WakeEngine(otherHub,f.fake);cleanup.push(()=>{other.shutdown();otherStore.close();});other.tick();
  expect(f.fake.run).not.toHaveBeenCalled();expect(other.retry(message.wakes[0].id,otherHub.wakes.rows()[0].revision).ok).toBe(false);
  other.resume(binding.id,otherHub.wakes.rows()[0].revision);other.tick();expect(f.fake.run).not.toHaveBeenCalled();expect(other.retry(message.wakes[0].id,otherHub.wakes.rows()[0].revision).ok).toBe(true);other.tick();
  await vi.waitFor(()=>expect(f.hub.wakes.messages(message.id)[0].status).toBe('ACKNOWLEDGED'));
});
it('authentication/quota/native errors block and preserve unread instead of blind retry',async()=>{
  const run=vi.fn(async()=>{throw new BridgeFailure('AUTH_REQUIRED','Sign in');});const f=fixture({run});f.configure();const message=f.send(['codex']).data!;f.engine.tick();
  await vi.waitFor(()=>expect(f.hub.wakes.messages(message.id)[0]).toMatchObject({status:'BLOCKED',code:'AUTH_REQUIRED'}));
  f.engine.tick();f.engine.tick();expect(run).toHaveBeenCalledTimes(1);expect(f.hub.wakes.rows()[0].paused).toBe(1);
  expect(f.hub.unread({actor:'codex',workspace_ids:[f.workspace]}).data!.unread).toBe(1);
});
it('invalid model receipt never marks a message read',async()=>{
  const f=fixture({run:async()=>({message_id:randomUUID(),receipt_nonce:randomUUID(),reply:'Wrong receipt'})});f.configure();const msg=f.send(['codex']).data!;f.engine.tick();
  await vi.waitFor(()=>expect(f.hub.wakes.messages(msg.id)[0].code).toBe('INVALID_ACK'));expect(f.hub.unread({actor:'codex',workspace_ids:[f.workspace]}).data!.unread).toBe(1);
});
it('two dispatcher instances cannot claim the same active session',async()=>{
  let finish!:(value:NativeReply)=>void;let active!:NativeRun;const run=vi.fn(async(input:NativeRun)=>{active=input;return new Promise<NativeReply>(resolve=>{finish=resolve;});});
  const f=fixture({run});f.configure();f.send(['codex']);f.engine.tick();
  const otherStore=new Store(f.directory),other=new WakeEngine(new MessageHub(otherStore),{run});cleanup.push(()=>{other.shutdown();otherStore.close();});other.tick();
  await vi.waitFor(()=>expect(run).toHaveBeenCalledTimes(1));f.engine.stop(f.hub.wakes.rows()[0].id);finish({message_id:active.messageId,receipt_nonce:active.nonce,reply:'Late'});
});
it('expired unknown outcomes are blocked and paused, never automatically resubmitted',()=>{
  const f=fixture();const binding=f.configure().data!,msg=f.send(['codex']).data!;
  f.store.db.prepare(`UPDATE wake_requests SET status='DELIVERED',lease_until=0 WHERE id=?`).run(msg.wakes[0].id);
  f.store.db.prepare(`UPDATE agent_bindings SET status='Busy',active_wake_id=? WHERE id=?`).run(msg.wakes[0].id,binding.id);
  f.engine.tick();expect(f.hub.wakes.messages(msg.id)[0].code).toBe('PREVIOUS_OUTCOME_UNKNOWN');expect(f.hub.wakes.rows()[0].paused).toBe(1);expect(f.fake.run).not.toHaveBeenCalled();
});
it('a stale binding editor cannot undo Stop',()=>{
  const f=fixture();const binding=f.configure().data!;f.engine.stop(binding.id);
  expect(f.engine.configure({workspace_id:f.workspace,actor:'codex',model:'gpt-5.6-sol',effort:'low',enabled:true,expected_revision:binding.revision}).code).toBe('BINDING_CONFLICT');
  expect(f.hub.wakes.rows()[0].paused).toBe(1);
});
it('agent handoff loops are bounded and ordinary receipts cannot cause wake',()=>{
  const f=fixture();f.configure();f.configure('claude');let parent=f.send(['claude']).data!;
  for(let hop=1;hop<=5;hop++){
    const actor=hop%2?'claude':'codex',target=actor==='claude'?'codex':'claude';
    parent=f.hub.send({actor,workspace_ids:[f.workspace]},{workspace_id:f.workspace,body:'Handoff',mentions:[target],reply_to_id:parent.id,idempotency_key:randomUUID()}).data!;
  }
  expect(parent.wakes[0]).toMatchObject({status:'BLOCKED',code:'HOP_LIMIT'});
});
