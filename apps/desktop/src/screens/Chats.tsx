import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatOverview, ChatMessage, Snapshot, SendMessageRequest } from '../../../../packages/contracts/src/index.js';
import { getChatOverview, readChat, sendChat, stopAgent, retryWake } from '../ipc/backend.js';
import { EmptyState } from '../components/Primitives.js';
import { AgentSessionsDialog } from '../components/AgentSessionsDialog.js';
export type ChatSelection = { workspace_id?: string; project_key?: string } | null;

export function Chats({ data, selection, onSelect }: { data: Snapshot; selection: ChatSelection; onSelect: (selection: ChatSelection) => void }) {
  const [overview, setOverview] = useState<ChatOverview | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [more, setMore] = useState(false);
  const [workspace, setWorkspace] = useState(selection?.workspace_id ?? '');
  const [project, setProject] = useState(selection?.project_key ?? '');
  const [body, setBody] = useState('');
  const [reply, setReply] = useState<ChatMessage | null>(null);
  const [pending, setPending] = useState<SendMessageRequest | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [mentions,setMentions]=useState<('claude'|'codex')[]>([]);
  const [mentionMenu,setMentionMenu]=useState(false);
  const [settings,setSettings]=useState<{projectKey?:string}|null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const expandedHistory = useRef(false);
  const messageList = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const current = overview?.projects.find(item => item.project_key === selection?.project_key);
  const selectedTopic = overview?.projects.find(item => item.project_key === project);
  const topicInvalid = Boolean(project && overview && workspace && selectedTopic?.workspace_id !== workspace);
  const selectionKey = `${selection?.workspace_id ?? ''}/${selection?.project_key ?? ''}`;
  const load = useCallback(async (older = false) => {
    if (inFlight.current) return;
    inFlight.current = true; const request = generation.current;
    try {
      const summary = await getChatOverview();
      if (request !== generation.current) return;
      if (!summary.ok) { setFailure(summary.errors.join(' ')); return; }
      setOverview(summary.data!);
      if (selection) {
        const response = await readChat({ ...selection, limit: 50, ...(older && messages.length ? { before_seq: messages[0].seq } : {}) });
        if (request !== generation.current) return;
        if (!response.ok) { setFailure(`${response.code}: ${response.errors.join(' ')}`); return; }
        setMessages(previous => [...new Map([...previous, ...response.data!.messages].map(message => [message.id, message])).values()].sort((a, b) => a.seq - b.seq));
        if (older) expandedHistory.current = true;
        if (older || !expandedHistory.current) setMore(response.data!.has_more);
        const updated = await getChatOverview(); if (request === generation.current && updated.ok) setOverview(updated.data!);
      }
    } catch { if (request === generation.current) setFailure('Chat backend unavailable. Refresh before retrying; no delivery is assumed.'); }
    finally {
      inFlight.current = false;
      if (alive.current && request !== generation.current) void loadRef.current();
      else if (alive.current) setLoadingMessages(false);
    }
  }, [selectionKey, messages.length]);
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => {
    alive.current = true; generation.current++; setMessages([]); setMore(false); setLoadingMessages(true); setFailure(null); setReply(null); setBody(''); setQuery(''); setPending(null);
    expandedHistory.current = false; nearBottom.current = true;
    setMentions([]);setMentionMenu(false);setSettings(null);
    setWorkspace(selection?.workspace_id ?? current?.workspace_id ?? ''); setProject(selection?.project_key ?? '');
    // A previous request may still finish; the next poll loads only this selection.
    void loadRef.current();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void loadRef.current(); }, 3000);
    return () => { alive.current = false; generation.current++; clearInterval(timer); };
  }, [selectionKey]);
  useEffect(() => { if (selection?.project_key && current?.workspace_id) setWorkspace(current.workspace_id); }, [selectionKey, current?.workspace_id]);
  useEffect(() => { if (nearBottom.current && messageList.current) messageList.current.scrollTop = messageList.current.scrollHeight; }, [messages.length]);
  async function send() {
    if (sending) return;
    const route = overview?.projects.find(item => item.project_key === project);
    const input: SendMessageRequest = pending ?? { workspace_id: workspace, ...(project ? { project_key: project, route_revision: route?.revision ?? undefined } : {}),
      body: body.trim(), ...(reply ? { reply_to_id: reply.id } : {}), idempotency_key: crypto.randomUUID(), mentions };
    setSending(true); setPending(input); setFailure(null);
    try {
      const response = await sendChat(input);
      if (response.ok) { setBody(''); setReply(null); setPending(null);setMentions([]);setMentionMenu(false); await loadRef.current(); }
      else { setFailure(`${response.code}: ${response.errors.join(' ')}`); setPending(null); }
    } catch { setFailure('Save result unknown. Retry this same message to avoid duplicates.'); }
    finally { setSending(false); }
  }
  const visible = messages.filter(message => `${message.body} ${message.project_name ?? ''} ${message.sender_id}`.toLowerCase().includes(query.toLowerCase()));
  const actorName = (actor: string) => actor === 'human' ? 'You' : actor === 'claude' ? 'Claude' : 'Codex';
  const effectiveBinding=(actor:'claude'|'codex')=>overview?.bindings.find(row=>row.workspace_id===workspace&&row.actor===actor&&row.project_key===(selection?.project_key??null))??overview?.bindings.find(row=>row.workspace_id===workspace&&row.actor===actor&&row.project_key===null);
  async function stop(id:string){const response=await stopAgent(id);if(!response.ok)setFailure(response.errors.join(' '));await loadRef.current();}
  async function retry(id:string,actor:'claude'|'codex',messageWorkspace:string,messageProject:string|null){
    const candidates=overview?.bindings.filter(row=>row.workspace_id===messageWorkspace&&row.actor===actor)??[];
    const binding=candidates.find(row=>row.project_key===messageProject)??candidates.find(row=>row.project_key===null);
    if(!binding){setFailure('Set up this agent session before retrying.');return;}
    try{const response=await retryWake(id,binding.revision);if(!response.ok)setFailure(response.errors.join(' '));await loadRef.current();}
    catch{setFailure('Retry result unknown. Refresh before retrying again.');}
  }
  function mention(actor:'claude'|'codex'){
    setMentions(old=>old.includes(actor)?old:[...old,actor]);setMentionMenu(false);
    if(!body.includes(`@${actorName(actor)}`))setBody(old=>{const prefix=old.replace(/@(?:claude|codex)?$/i,'').trimEnd();return `${prefix?prefix+' ':''}@${actorName(actor)} `;});
  }
  const wakeLabel=(status:string,code:string|null)=>status==='CANCELLED'?'Stopped':code==='AUTH_REQUIRED'?'Sign-in required':code==='PAUSED_BY_USER'?'Paused':code==='SESSION_NOT_BOUND'?'Set up session':
    status==='PENDING'?'Queued':status==='DISPATCHING'?'Starting':status==='DELIVERED'?'Working':status==='ACKNOWLEDGED'?'Acknowledged':status==='CANCELLED'?'Stopped':'Blocked';
  return <>
    {failure ? <p role="alert" className="form-error">{failure}</p> : null}
    <div className="chat-layout"><div className="chat-directory" aria-label="Chat overview">
      <button className={!selection ? 'selected' : ''} onClick={() => onSelect(null)}>All conversations · {overview?.total_unread ?? 0} unread for you</button>
      <h3>By project</h3>{overview?.projects.map(item => <button key={item.project_key} className={selection?.project_key === item.project_key ? 'selected' : ''} onClick={() => onSelect({ project_key: item.project_key })}>
        <strong>{item.project_key} · {item.name}</strong><small>{item.message_count} messages · {item.unread} unread for you</small></button>)}
      {!overview?.projects.length ? <p className="field-hint">Project topics appear after routing is configured.</p> : null}
      <h3>Workspace groups</h3>{overview?.workspaces.map(item => <button key={item.workspace_id} className={selection?.workspace_id === item.workspace_id && !selection.project_key ? 'selected' : ''} onClick={() => onSelect({ workspace_id: item.workspace_id })}>
        <strong>{item.label}</strong><small>{item.message_count} messages · {item.unread} unread for you</small></button>)}
    </div><section className="chat-conversation" aria-label="Group conversation">
      {!selection ? <><div className="conversation-header"><h2>Conversation overview</h2><button onClick={() => void loadRef.current()}>Refresh chats</button></div><div className="conversation-inbox">{overview?.workspaces.length ? overview.workspaces.map(item => <div className="chat-summary" key={item.workspace_id}><button onClick={() => onSelect({ workspace_id: item.workspace_id })}>{item.label} group chat</button><p>{item.last_preview ?? 'No messages yet. This Workspace group is ready.'}</p></div>) : <EmptyState title="No Workspace groups yet">Connect a test Workspace to create its group automatically.</EmptyState>}</div></> : <>
        <div className="conversation-header"><div>
        <h2>{selection.project_key ? `${selection.project_key} · ${current?.name ?? 'Project history'}` : `${overview?.workspaces.find(w => w.workspace_id === selection.workspace_id)?.label ?? 'Workspace'} group chat`}</h2>
        <p>You · Claude · Codex <span className="wake-label" title="Only actors explicitly selected in the @ menu are woken. Native sessions are message-only and use your account quota.">Selected @ wakes an agent</span></p></div>
          <div className="conversation-actions"><button disabled={!workspace} onClick={()=>setSettings({projectKey:selection.project_key})}>Agent sessions</button><button onClick={() => void loadRef.current()}>Refresh chats</button></div></div>
        <div className="agent-presence">{(['claude','codex'] as const).map(actor=>{const binding=effectiveBinding(actor);return <span key={actor}>{actorName(actor)}: {binding?.stopping?'Stopping…':binding?.status??'Not bound'}{binding?.status==='Busy'?<button onClick={()=>void stop(binding.id)}>Stop {actorName(actor)}</button>:null}</span>;})}</div>
        <div className="conversation-search"><input aria-label="Search loaded messages" placeholder="Search loaded messages" value={query} onChange={event => setQuery(event.target.value)} /></div>
        <div className="message-list" ref={messageList} onScroll={() => { const list = messageList.current; if (list) nearBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80; }}>
          {more ? <button className="older-messages" onClick={() => { nearBottom.current = false; void loadRef.current(true); }}>Load older messages</button> : null}
          {loadingMessages ? <p role="status" className="conversation-loading">Loading messages…</p> : !messages.length ? <EmptyState title="Start the conversation">Leave a message for your Workspace group.</EmptyState> : null}
          {visible.map(message => <article className={`chat-message ${message.sender_id === 'human' ? 'own-message' : ''}`} key={message.id} aria-label={`Message from ${message.sender_id}`}>
            <div className={`chat-avatar avatar-${message.sender_id}`} aria-hidden="true">{message.sender_id === 'human' ? 'Y' : message.sender_id === 'claude' ? 'C' : 'X'}</div>
            <div className="message-content"><div className="message-meta"><strong>{actorName(message.sender_id)}</strong><time title={new Date(message.created_at).toLocaleString()}>{new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
              {selection.project_key || message.project_key ? <small>{overview?.workspaces.find(w => w.workspace_id === message.workspace_id)?.label}{message.project_key ? ` · ${message.project_key}` : ''}</small> : null}
              <div className="message-bubble">{message.reply_to_id ? <blockquote>Reply to {messages.find(item => item.id === message.reply_to_id)?.body.slice(0, 80) ?? 'an earlier message'}</blockquote> : null}<p className="message-body">{message.body}</p></div>
              <div className="message-footer"><button disabled={sending || Boolean(pending) || Boolean(selection.project_key && message.workspace_id !== current?.workspace_id)} onClick={() => { setReply(message); setWorkspace(message.workspace_id); if (!selection.project_key) setProject(''); }}>Reply</button>
                {message.sender_id === 'human' ? <small title={message.receipts.map(receipt => `${actorName(receipt.recipient_id)}: ${receipt.read_at ? receipt.read_source==='native_response'?'Native response verified (not task completion)':'Read via API (not task completion)' : 'Unread'}`).join('; ')}>
                  {message.receipts.some(receipt => !receipt.read_at) ? `Unread by ${message.receipts.filter(receipt => !receipt.read_at).map(receipt => actorName(receipt.recipient_id)).join(', ')}` : 'Read'}</small> : null}</div>
              {message.wakes?.length?<div className="message-wakes">{message.wakes.map(wake=><span key={wake.id} title={wake.code??wake.status}>{actorName(wake.actor)} · {wakeLabel(wake.status,wake.code)}
                {['BLOCKED','CANCELLED'].includes(wake.status)?<button onClick={()=>void retry(wake.id,wake.actor,message.workspace_id,message.project_key)}>Retry {actorName(wake.actor)} wake</button>:null}</span>)}</div>:null}
            </div>
          </article>)}
        </div>
        <div className="chat-composer"><div className="composer-context"><span>{overview?.workspaces.find(w => w.workspace_id === workspace)?.label ?? 'Choose a project route to send'}</span>
          <label>Topic<select aria-label="Project topic" value={project} disabled={sending || Boolean(pending) || Boolean(selection.project_key)} onChange={event => setProject(event.target.value)}>
            <option value="">General</option>{topicInvalid ? <option value={project} disabled>{project} · target changed — choose again</option> : null}{overview?.projects.filter(item => item.workspace_id === workspace).map(item => <option value={item.project_key} key={item.project_key}>{item.project_key} · {item.name}</option>)}</select></label>
          </div>
          {topicInvalid ? <p className="notice">This project moved to another Workspace. Choose a valid topic or open its project conversation before sending.</p> : null}
          {reply ? <div className="reply-preview"><span>Replying to {actorName(reply.sender_id)}: {reply.body.slice(0, 100)}</span><button disabled={sending || Boolean(pending)} onClick={() => setReply(null)}>Cancel reply</button></div> : null}
          {mentions.length?<div className="selected-mentions">{mentions.map(actor=><button key={actor} disabled={sending||Boolean(pending)} onClick={()=>setMentions(old=>old.filter(value=>value!==actor))}>Wake {actorName(actor)} ×</button>)}</div>:null}
          {mentionMenu?<div className="mention-menu" role="menu" aria-label="Mention an agent">{(['claude','codex'] as const).map(actor=><button type="button" role="menuitem" key={actor} onClick={()=>mention(actor)}>Mention {actorName(actor)}</button>)}</div>:null}
          <div className="composer-input"><button aria-label="Choose mention" title="Explicitly choose an agent to wake" disabled={sending||Boolean(pending)} onClick={()=>setMentionMenu(old=>!old)}>@</button><textarea aria-label="Message" placeholder="Write a message…" rows={2} maxLength={8000} value={body} disabled={sending || Boolean(pending)} onChange={event => {setBody(event.target.value);setMentionMenu(/@(?:claude|codex)?$/i.test(event.target.value));}} onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!sending && workspace && (!topicInvalid || pending) && (body.trim() || pending)) void send(); }
          }} />
          <button className="primary" disabled={sending || !workspace || (topicInvalid && !pending) || (!body.trim() && !pending)} onClick={() => void send()}>{sending ? 'Saving…' : pending ? 'Retry same message' : 'Send message'}</button>
          </div><small className="composer-hint">Enter to send · Shift+Enter for a new line · Only selected @ chips wake agents</small>
        </div>
      </>}
    </section></div>
    {settings&&workspace?<AgentSessionsDialog workspaceId={workspace} projectKey={settings.projectKey} bindings={overview?.bindings??[]} onClose={()=>setSettings(null)} refresh={()=>loadRef.current()}/>:null}
  </>;
}
