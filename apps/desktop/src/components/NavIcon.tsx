const paths: Record<string, string> = {
  Dashboard: 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',
  Workspaces: 'm12 3 10 5-10 5L2 8Zm-9 9 9 5 9-5M3 17l9 5 9-5',
  Routing: 'M12 6v5M5 18v-3l7-4 7 4v3M10 3h4v4h-4ZM3 18h4v4H3Zm14 0h4v4h-4Z',
  Content: 'M5 3h10l4 4v14H5ZM14 3v5h5M9 12h6M9 16h6',
  Clients: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  Migration: 'M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4',
  Logs: 'M5 3h14v18H5ZM9 7h6M9 11h6M9 15h4',
  Settings: 'm10 3-1 3-3 1-3 3 2 2-1 3 3 3 3-1 2 2 3-1 1-3 3-1 1-3-2-2 1-3-3-3-3 1-2-2Zm5 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
};
export function NavIcon({ name }: { name: string }) {
  return <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
