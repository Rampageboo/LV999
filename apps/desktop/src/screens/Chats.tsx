import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatOverview, ChatMessage, Snapshot, SendMessageRequest } from '../../../../packages/contracts/src/index.js';
import { getChatOverview, readChat, sendChat } from '../ipc/backend.js';
import { EmptyState } from '../components/Primitives.js';
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
      body: body.trim(), ...(reply ? { reply_to_id: reply.id } : {}), idempotency_key: crypto.randomUUID(), mentions: [] };
    setSending(true); setPending(input); setFailure(null);
    try {
      const response = await sendChat(input);
      if (response.ok) { setBody(''); setReply(null); setPending(null); await loadRef.current(); }
      else { setFailure(`${response.code}: ${response.errors.join(' ')}`); setPending(null); }
    } catch { setFailure('Save result unknown. Retry this same message to avoid duplicates.'); }
    finally { setSending(false); }
  }
  const visible = messages.filter(message => `${message.body} ${message.project_name ?? ''} ${message.sender_id}`.toLowerCase().includes(query.toLowerCase()));
  const actorName = (actor: string) => actor === 'human' ? 'You' : actor === 'claude' ? 'Claude' : 'Codex';
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
        <p>You · Claude · Codex <span className="wake-label" title="Automatic agent wake is not enabled. Ordinary messages are saved for the agents to read via MCP; presence is not monitored.">@ wake off</span></p></div>
          <button onClick={() => void loadRef.current()}>Refresh chats</button></div>
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
                {message.sender_id === 'human' ? <small title={message.receipts.map(receipt => `${actorName(receipt.recipient_id)}: ${receipt.read_at ? 'Read via API (not task completion)' : 'Unread'}`).join('; ')}>
                  {message.receipts.some(receipt => !receipt.read_at) ? `Unread by ${message.receipts.filter(receipt => !receipt.read_at).map(receipt => actorName(receipt.recipient_id)).join(', ')}` : 'Read via API'}</small> : null}</div>
            </div>
          </article>)}
        </div>
        <div className="chat-composer"><div className="composer-context"><span>{overview?.workspaces.find(w => w.workspace_id === workspace)?.label ?? 'Choose a project route to send'}</span>
          <label>Topic<select aria-label="Project topic" value={project} disabled={sending || Boolean(pending) || Boolean(selection.project_key)} onChange={event => setProject(event.target.value)}>
            <option value="">General</option>{topicInvalid ? <option value={project} disabled>{project} · target changed — choose again</option> : null}{overview?.projects.filter(item => item.workspace_id === workspace).map(item => <option value={item.project_key} key={item.project_key}>{item.project_key} · {item.name}</option>)}</select></label>
          </div>
          {topicInvalid ? <p className="notice">This project moved to another Workspace. Choose a valid topic or open its project conversation before sending.</p> : null}
          {reply ? <div className="reply-preview"><span>Replying to {actorName(reply.sender_id)}: {reply.body.slice(0, 100)}</span><button disabled={sending || Boolean(pending)} onClick={() => setReply(null)}>Cancel reply</button></div> : null}
          <div className="composer-input"><textarea aria-label="Message" placeholder="Write a message…" rows={2} maxLength={8000} value={body} disabled={sending || Boolean(pending)} onChange={event => setBody(event.target.value)} onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!sending && workspace && (!topicInvalid || pending) && (body.trim() || pending)) void send(); }
          }} />
          <button className="primary" disabled={sending || !workspace || (topicInvalid && !pending) || (!body.trim() && !pending)} onClick={() => void send()}>{sending ? 'Saving…' : pending ? 'Retry same message' : 'Send message'}</button>
          </div><small className="composer-hint">Enter to send · Shift+Enter for a new line</small>
        </div>
      </>}
    </section></div>
  </>;
}
