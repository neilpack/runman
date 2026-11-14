import { Fragment, type ReactNode } from 'react';

interface SessionGuardProps {
  authStatus: string;
  route: string;
  userId: string | undefined;
  children: ReactNode;
}

export function SessionGuard({ authStatus, route, userId, children }: SessionGuardProps) {
  // Authenticator also renders children during signOut. Never show private UI then.
  if (authStatus !== 'authenticated' || route !== 'authenticated' || !userId?.trim()) {
    return <p role="status">Checking your session…</p>;
  }
  // A different account gets a fresh subtree with no previous account's local state.
  return <Fragment key={userId}>{children}</Fragment>;
}
