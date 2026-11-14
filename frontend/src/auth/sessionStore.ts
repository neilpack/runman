import type { AuthSession, AuthUser } from 'aws-amplify/auth';

export async function readConfirmedUser(sdk: {
  fetchAuthSession(): Promise<AuthSession>;
  getCurrentUser(): Promise<AuthUser>;
}) {
  const session = await sdk.fetchAuthSession();
  const access = session.tokens?.accessToken.payload;
  const id = session.tokens?.idToken?.payload;
  if (!access || !id) return null;
  const now = Date.now() / 1000;
  if (typeof access.exp !== 'number' || access.exp <= now || typeof id.exp !== 'number' || id.exp <= now) return null;
  const user = await sdk.getCurrentUser();
  return access.sub === user.userId && id.sub === user.userId ? user : null;
}

export interface SessionSnapshot {
  status: 'checking' | 'signedOut' | 'signedIn' | 'signingOut' | 'unavailable' | 'error';
  user: AuthUser | null;
  error: string | null;
}

export function createSessionStore(sdk: {
  readSession(): Promise<AuthUser | null>;
  signOut(): Promise<void>;
}, configured: boolean) {
  let snapshot: SessionSnapshot = { status: configured ? 'checking' : 'unavailable', user: null, error: null };
  let epoch = 0;
  let blocked = false;
  let readingEpoch: number | null = null;
  let attempt: { id: number; canceled: boolean } | null = null;
  const listeners = new Set<() => void>();
  function publish(status: SessionSnapshot['status'], user: AuthUser | null = null, error: string | null = null) {
    snapshot = { status, user, error };
    listeners.forEach((listener) => listener());
  }
  async function refresh(passive = false) {
    if (!configured || blocked || attempt || snapshot.status === 'signingOut') return false;
    if (passive && readingEpoch !== null) return false;
    const ticket = ++epoch;
    readingEpoch = ticket;
    if (!passive || (snapshot.status !== 'signedIn' && snapshot.status !== 'signedOut')) publish('checking');
    try {
      const user = await sdk.readSession();
      if (ticket !== epoch) return false;
      publish(user ? 'signedIn' : 'signedOut', user);
      return Boolean(user);
    } catch {
      if (ticket === epoch) publish('error', null, 'Your session could not be checked. Please try again.');
      return false;
    } finally {
      if (readingEpoch === ticket) readingEpoch = null;
    }
  }
  function closeSession() {
    ++epoch;
    if (attempt) {
      attempt.canceled = true;
      publish('checking');
    } else publish('signedOut');
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh,
    handleAuthEvent(event: string) {
      if (blocked && event !== 'signedOut') return;
      if (event === 'signedOut') { blocked = false; closeSession(); }
      else if (event === 'tokenRefresh_failure') closeSession();
      else if (event === 'signedIn' && !attempt) void refresh();
      else if (event === 'tokenRefresh' && snapshot.status === 'signedIn' && !attempt) void refresh(true);
    },
    beginSignIn() {
      if (!configured || blocked || attempt || snapshot.status === 'signingOut') return null;
      attempt = { id: ++epoch, canceled: false };
      publish('checking');
      return attempt.id;
    },
    abandonSignIn(id: number) {
      if (attempt?.id === id) { attempt.canceled = true; ++epoch; publish('checking'); }
    },
    async settleSignIn(id: number, done: boolean) {
      if (attempt?.id !== id) return false;
      if (done && !attempt.canceled) {
        try {
          const user = await sdk.readSession();
          if (attempt?.id === id && !attempt.canceled) {
            attempt = null;
            ++epoch;
            publish(user ? 'signedIn' : 'signedOut', user);
            return Boolean(user);
          }
        } catch {
          if (attempt?.id === id && !attempt.canceled) {
            attempt = null;
            ++epoch;
            publish('error', null, 'Your session could not be checked. Please try again.');
            return false;
          }
        }
      }
      if (attempt?.id !== id) return false;
      if (attempt.canceled || !done) {
        try {
          await sdk.signOut();
          blocked = false;
          attempt = null;
          ++epoch;
          publish('signedOut');
        } catch {
          blocked = true;
          attempt = null;
          ++epoch;
          publish('error', null, 'The interrupted sign-in could not be cleared. Please clear your session and retry.');
        }
        return false;
      }
      return false;
    },
    async signOut() {
      if (!configured || snapshot.status === 'signingOut') return;
      if (attempt) { attempt.canceled = true; ++epoch; publish('checking'); return; }
      const ticket = ++epoch;
      publish('signingOut');
      try {
        await sdk.signOut();
        if (ticket === epoch) { blocked = false; publish('signedOut'); }
      } catch {
        if (ticket !== epoch) return;
        if (blocked) { publish('error', null, 'Your session could not be cleared. Please retry sign-out.'); return; }
        // Recheck SDK state after failure; never restore a cached user optimistically.
        publish('checking');
        const repair = refresh();
        const repairEpoch = epoch;
        await repair;
        if (epoch !== repairEpoch) return;
        snapshot = { ...snapshot, error: 'Sign-out failed. Please try again.' };
        listeners.forEach((listener) => listener());
      }
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
