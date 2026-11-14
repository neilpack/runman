// Shared, signed-in account state for the Account page and the nav avatar.
// Follows the session: loads when someone signs in, clears on sign-out or account switch.

import { accountErrorText, type AccountAction, type AccountProfile, type TapeSnapshot } from './profileModel';
import type { AccountService } from './accountService';

export interface AccountSnapshot {
  status: 'signedOut' | 'loading' | 'ready' | 'error';
  profile: AccountProfile | null;
  error: string | null;
}

export type MutationResult = { ok: true } | { ok: false; error: string };

interface SessionSource {
  getSnapshot(): { status: string; user: { userId: string } | null };
  subscribe(listener: () => void): () => void;
}

const SIGNED_OUT: AccountSnapshot = { status: 'signedOut', profile: null, error: null };

function messageFor(error: unknown, action: AccountAction): string {
  if (error instanceof Error && error.name === 'ValidationError') return error.message;
  return accountErrorText(error, action);
}

export function createAccountStore(service: AccountService, session: SessionSource) {
  let snapshot: AccountSnapshot = SIGNED_OUT;
  let userId: string | null = null;
  let epoch = 0;
  const listeners = new Set<() => void>();

  function publish(next: AccountSnapshot) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }

  async function load(id: string) {
    const ticket = ++epoch;
    userId = id;
    publish({ status: 'loading', profile: null, error: null });
    try {
      const profile = await service.load(id);
      if (ticket === epoch) publish({ status: 'ready', profile, error: null });
    } catch (error) {
      if (ticket === epoch) publish({ status: 'error', profile: null, error: messageFor(error, 'load') });
    }
  }

  function sync() {
    const s = session.getSnapshot();
    if (s.status === 'signedIn' && s.user) {
      if (s.user.userId !== userId) void load(s.user.userId);
    } else if (s.status !== 'checking' && userId !== null) {
      // Signed out, errored, or switching: never keep the previous account's details around.
      ++epoch;
      userId = null;
      publish(SIGNED_OUT);
    }
  }

  /** Runs a change, then applies `patch` only if the same account is still loaded. */
  async function mutate(
    action: AccountAction,
    run: (profile: AccountProfile) => Promise<Partial<AccountProfile> | void>,
  ): Promise<MutationResult> {
    const profile = snapshot.profile;
    const ticket = epoch;
    if (!profile || snapshot.status !== 'ready') return { ok: false, error: 'Your account is still loading.' };
    try {
      const patch = await run(profile);
      if (ticket === epoch && patch && snapshot.profile) publish({ ...snapshot, profile: { ...snapshot.profile, ...patch } });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: messageFor(error, action) };
    }
  }

  let started = false;

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start() {
      if (started) return;
      started = true;
      session.subscribe(sync);
      sync();
    },
    retry() {
      if (userId) void load(userId);
    },
    setUsername: (username: string) =>
      mutate('username', async () => ({ username: await service.setUsername(username), hasUsername: true })),
    setAvatar: (dataUrl: string) => mutate('avatar', async () => ({ avatar: await service.setAvatar(dataUrl) })),
    removeAvatar: () => mutate('avatar', async () => { await service.removeAvatar(); return { avatar: null }; }),
    setFavorite: (tape: TapeSnapshot | null) =>
      mutate('favorite', async (profile) => { await service.setFavorite(profile.userId, tape); return { favoriteTape: tape }; }),
    changePassword: (current: string, next: string) =>
      mutate('password', async () => { await service.changePassword(current, next); }),
  };
}

export type AccountStore = ReturnType<typeof createAccountStore>;
