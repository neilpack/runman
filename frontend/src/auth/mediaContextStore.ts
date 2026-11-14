import type { MediaAccount } from '../api/mediaClient';

/** Passive validated-session refreshes retain generation; every departure closes it. */
export function createMediaContext(source: { getSnapshot(): { status: string; user: { userId: string } | null }; subscribe(listener: () => void): () => void }) {
  let owner: string | null = null; let generation = 0;
  const listeners = new Set<() => void>();
  function update() {
    const snapshot = source.getSnapshot();
    const next = snapshot.status === 'signedIn' ? snapshot.user?.userId ?? null : null;
    if (owner === next) return;
    owner = next; generation++;
    listeners.forEach((listener) => listener());
  }
  source.subscribe(update); update();
  return {
    account: (): MediaAccount | null => owner ? { owner, generation } : null,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
