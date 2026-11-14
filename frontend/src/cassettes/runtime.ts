import { Amplify } from 'aws-amplify';
import type { Cassette } from '@runman/shared';
import { api } from '../api/client';
import { sessionStore } from '../auth/session';
import { createCassetteStore } from './store';

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function seed(): Cassette[] {
  const now = new Date().toISOString();
  const base: Cassette = { id: '', name: '', shellColor: '#f9c6d3', labelColor: '#fff6ea', inkColor: '#7a1f3d', shellType: 'solid', penStyle: 'handwritten', stickers: [], tracks: [], createdAt: now, updatedAt: now };
  return [
    { ...base, id: newId(), name: 'Be Mine', stickers: [{ id: newId(), kind: 'heart', x: 82, y: 22, rotation: 12, scale: 1, color: '#ef4444' }] },
    { ...base, id: newId(), name: 'Road Trip', shellColor: '#f07a1a', labelColor: '#fde68a', penStyle: 'marker', inkColor: '#1f2937' },
    { ...base, id: newId(), name: 'Late Night', shellColor: '#13e0c4', shellType: 'clear', penStyle: 'script', inkColor: '#1d4ed8' },
    { ...base, id: newId(), name: 'Study Beats', shellColor: '#e8c931', shellType: 'retro', penStyle: 'typewriter', inkColor: '#1f2937' },
  ];
}

const cognito = Amplify.getConfig().Auth?.Cognito;
export const cassetteStore = createCassetteStore({
  api: api.cassettes,
  storage: { getItem: (key) => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) },
  namespace: `${cognito?.userPoolId ?? 'unconfigured'}:${cognito?.userPoolClientId ?? 'unconfigured'}`,
  newId, now: () => new Date().toISOString(), seed,
});

let started = false;
export function startCassettesSession() {
  if (started) return;
  started = true;
  function sync() {
    const session = sessionStore.getSnapshot();
    if (session.status === 'signedIn' && session.user) cassetteStore.setSession('authenticated', session.user.userId);
    else if (session.status === 'signedOut' || session.status === 'unavailable') cassetteStore.setSession('guest');
    else cassetteStore.setSession('hidden');
  }
  // This subscription switches ownership synchronously, before React can render
  // a newly authenticated account using the previous account's visible data.
  sessionStore.subscribe(sync);
  sync();
  window.addEventListener('storage', (event) => cassetteStore.storageChanged(event.key));
}
