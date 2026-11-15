import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import type { WorkspaceView } from '../../../../packages/contracts/src/index.js';

type Props = {
  workspace?: WorkspaceView;
  busy: boolean;
  failure: string | null;
  onClose: () => void;
  onSubmit: (label: string, token: string) => Promise<void>;
};

export function WorkspaceConnectionDialog({ workspace, busy, failure, onClose, onSubmit }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const tokenInput = form.elements.namedItem('connection_token') as HTMLInputElement;
    const labelInput = form.elements.namedItem('display_name') as HTMLInputElement | null;
    const token = tokenInput.value;
    // Uncontrolled password field: never place a token in React state, storage or feedback.
    tokenInput.value = '';
    void onSubmit(labelInput?.value ?? '', token);
  }

  function keepFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled])')];
    if (!controls.length) { event.preventDefault(); return; }
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }

  return <dialog ref={dialog} className="connection-dialog" aria-labelledby="connection-title" onKeyDown={keepFocus}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={submit} autoComplete="off">
      <h2 id="connection-title">{workspace ? 'Reauthorize workspace' : 'Connect test workspace'}</h2>
      <p>{workspace ? 'The replacement token must belong to this exact workspace. The current credential is kept if validation fails.'
        : 'Use a Notion Internal Connection from a test workspace. LV999 will detect its real name and ID before saving.'}</p>
      {workspace ? <div className="connection-target"><strong>{workspace.label}</strong><span className="mono">{workspace.id}</span></div>
        : <label className="form-field">Display name <span className="field-hint">Optional · defaults to the Notion workspace name</span>
          <input name="display_name" type="text" maxLength={80} disabled={busy} autoFocus /></label>}
      <label className="form-field">Internal Connection token
        <input name="connection_token" type="password" required maxLength={2048} autoComplete="off"
          spellCheck={false} autoCapitalize="none" data-lpignore="true" data-1p-ignore="true" disabled={busy} autoFocus={Boolean(workspace)} />
      </label>
      <p className="field-hint">Saved only in Windows Credential Manager after verification. Do not paste tokens into a chat.</p>
      <label className="test-confirm"><input name="test_confirm" type="checkbox" required disabled={busy} />
        <span>This is a test workspace. It is not Vibecode or Honour.</span></label>
      {failure ? <div role="alert" className="form-error">{failure}</div> : null}
      {busy ? <p role="status">Checking workspace identity and read access, then saving securely…</p> : null}
      <div className="dialog-actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Checking…' : workspace ? 'Verify & replace token' : 'Verify & connect'}</button></div>
    </form>
  </dialog>;
}
