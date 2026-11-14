import { parseMediaObjectKey, type ListeningSelector, type Track } from '@runman/shared';
import type { MediaAccount } from '../api/mediaClient';
import type { ListeningApi } from '../api/listeningClient';

interface Session {
  account: MediaAccount; playId: string; song: ListeningSelector; durationMs: number; total: number; reported: number;
  closed: boolean; eligible?: boolean; started?: Promise<void>; pending?: Promise<void>; controller: AbortController; counted: boolean; retryAt: number;
}
export function listeningSelector(track: Track): ListeningSelector | undefined {
  if (track.source === 'library' && track.sourceId && /^[1-9]\d{0,19}$/.test(track.sourceId)) return { provider: 'jamendo', id: track.sourceId };
  if (track.source === 'community' && track.sourceId) return { provider: 'explore', id: track.sourceId };
  const media = track.audioReference && parseMediaObjectKey(track.audioReference.objectKey);
  return media ? { provider: 'media', id: media.mediaId } : undefined;
}
/** Actual media advancement capped by monotonic elapsed time; seeks/stalls earn no artificial time. */
export function createListeningTracker(deps: { api: ListeningApi; account(): MediaAccount | null; subscribe(listener: () => void): () => void; randomId(): string; changed?(): void; now?(): number }) {
  const now = deps.now ?? Date.now;
  let selected: string | undefined; let session: Session | undefined;
  let sample: { at: number; position: number } | undefined;
  const sessions = new Set<Session>();
  const same = (account: MediaAccount) => { const next = deps.account(); return next?.owner === account.owner && next.generation === account.generation; };
  const unsubscribe = deps.subscribe(() => {
    for (const row of sessions) if (!same(row.account)) { row.controller.abort(); sessions.delete(row); }
    if (!session || !same(session.account)) { selected = undefined; session = undefined; sample = undefined; }
  });
  async function start(row: Session) {
    if (row.eligible !== undefined) return;
    if (!row.started) row.started = deps.api.start(row.account, row.playId, row.song, row.controller.signal).then((result) => { row.eligible = result.eligible; }).catch((error) => { row.started = undefined; row.retryAt = now() + 15_000; throw error; });
    await row.started;
  }
  function flush(row = session): Promise<void> {
    if (!row || !same(row.account) || row.controller.signal.aborted) return Promise.resolve();
    if (now() < row.retryAt) { if (row.closed) { sessions.delete(row); row.controller.abort(); } return Promise.resolve(); }
    if (row.pending) return row.pending;
    row.pending = (async () => {
      await start(row);
      if (!row.eligible) return;
      do {
        const total = Math.floor(row.total); if (total <= row.reported) return;
        const result = await deps.api.progress(row.account, row.playId, total, row.controller.signal);
        row.reported = total;
        if (!row.counted && result.counted) { row.counted = true; deps.changed?.(); }
      } while (row.closed && row.total > row.reported && same(row.account));
    })().catch(() => { row.retryAt = now() + 15_000; /* Best effort with backoff; never interrupt playback. */ }).finally(() => { row.pending = undefined; if (row.closed) { sessions.delete(row); row.controller.abort(); } });
    return row.pending;
  }
  function finish() { if (session) { session.closed = true; void flush(session); } selected = undefined; session = undefined; sample = undefined; }
  return {
    select(track: Track | undefined) {
      const selector = track && listeningSelector(track);
      const key = track && selector ? JSON.stringify([track.id, selector]) : undefined;
      if (key === selected) return;
      finish(); selected = key;
      const account = deps.account();
      if (track && selector && account && track.durationSec > 0) {
        session = { account, playId: deps.randomId(), song: selector, durationMs: Math.ceil(track.durationSec * 1000), total: 0, reported: 0, closed: false, controller: new AbortController(), counted: false, retryAt: 0 };
        sessions.add(session); void start(session).catch(() => {});
      }
    },
    sample(at: number, position: number, playing: boolean, seeking = false, rate = 1) {
      if (!session || !playing || seeking || !Number.isFinite(at) || !Number.isFinite(position) || !Number.isFinite(rate) || rate <= 0) { sample = undefined; return; }
      if (sample) {
        const elapsed = at - sample.at; const advanced = (position - sample.position) * 1000 / rate;
        if (elapsed > 0 && advanced > 0 && advanced <= elapsed + 750) session.total = Math.min(session.durationMs, session.total + Math.min(elapsed, advanced));
        if (session.total - session.reported >= 10_000 || (!session.counted && session.total >= Math.min(30_000, session.durationMs))) void flush();
      }
      sample = { at, position };
    },
    pause() { sample = undefined; void flush(); },
    ended() { if (session && session.durationMs <= 30_000 && session.durationMs - session.total <= 500) session.total = session.durationMs; finish(); },
    finish, flush,
    dispose() { finish(); void Promise.all([...sessions].map((row) => flush(row))).finally(unsubscribe); },
  };
}
