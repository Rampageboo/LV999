import type { ReactNode } from 'react';
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><span className="empty-icon" aria-hidden="true">◇</span><p>{title}</p>{children ? <small>{children}</small> : null}</div>;
}
export function DisabledAction({ children, reason }: { children: ReactNode; reason: string }) {
  return <span className="disabled-action" title={reason}><button disabled>{children}</button><small>{reason}</small></span>;
}
export function Status({ value }: { value: string }) {
  const good = ['Running', 'Connected', 'pass'].includes(value);
  return <span className={`status ${good ? 'good' : 'muted'}`}><i aria-hidden="true" />{value}</span>;
}
