import { LISTENING_MAX_MS, validPlayId } from '@runman/shared';
export interface ListeningSong {
  provider: 'explore' | 'jamendo'; id: string; title: string; artist: string; durationSec: number;
  artworkUrl?: string; audioUrl?: string; licenseUrl?: string;
}
export interface ListeningSession { owner: string; playId: string; song: ListeningSong; createdAt: number; revision: number; listenedMs: number; counted: boolean }
export interface SongListeningStats { song: ListeningSong; playCount: number; listenedMs: number }
export interface ListeningRepository {
  get(owner: string, playId: string): Promise<ListeningSession | undefined>;
  start(session: ListeningSession): Promise<ListeningSession>;
  advance(previous: ListeningSession, next: ListeningSession): Promise<boolean>;
  listStats(): Promise<SongListeningStats[]>;
}
export const listeningSongKey = (song: Pick<ListeningSong, 'provider' | 'id'>) => `${song.provider}#${song.id}`;
export function checkedListeningSession(value: unknown): ListeningSession {
  const row = value as ListeningSession;
  if (!row || !/^[A-Za-z0-9_-]{1,128}$/.test(row.owner) || !validPlayId(row.playId) || !validSong(row.song) || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0 ||
    !Number.isSafeInteger(row.revision) || row.revision < 0 || !Number.isSafeInteger(row.listenedMs) || row.listenedMs < 0 || row.listenedMs > LISTENING_MAX_MS || typeof row.counted !== 'boolean') throw new Error('Invalid listening session');
  return structuredClone(row);
}
function validSong(song: ListeningSong): boolean {
  if (!song || !['explore', 'jamendo'].includes(song.provider) || !/^[A-Za-z0-9_-]{1,128}$/.test(song.id) || typeof song.title !== 'string' || song.title.length > 256 || typeof song.artist !== 'string' || song.artist.length > 256 || !Number.isFinite(song.durationSec) || song.durationSec <= 0 || song.durationSec * 1000 > LISTENING_MAX_MS) return false;
  return ['audioUrl', 'artworkUrl', 'licenseUrl'].every((key) => { const value = song[key as keyof ListeningSong]; if (value === undefined) return true; try { const url = new URL(String(value)); return url.protocol === 'https:' && !url.username && !url.password && String(value).length <= 2048; } catch { return false; } });
}
export function checkedListeningStats(value: unknown): SongListeningStats {
  const row = value as SongListeningStats;
  if (!row || !validSong(row.song) || ![row.playCount, row.listenedMs].every((n) => Number.isSafeInteger(n) && n >= 0)) throw new Error('Invalid listening totals');
  return structuredClone(row);
}
export function createMemoryListeningRepository(): ListeningRepository {
  const sessions = new Map<string, ListeningSession>(); const stats = new Map<string, SongListeningStats>();
  const key = (owner: string, id: string) => `${owner}\n${id}`;
  return {
    async get(owner, id) { const row = sessions.get(key(owner, id)); return row ? structuredClone(row) : undefined; },
    async start(session) { const id = key(session.owner, session.playId); const row = sessions.get(id) ?? checkedListeningSession(session); sessions.set(id, row); return structuredClone(row); },
    async advance(previous, next) {
      const id = key(next.owner, next.playId); if (sessions.get(id)?.revision !== previous.revision) return false;
      const songKey = listeningSongKey(next.song); const total = stats.get(songKey) ?? { song: next.song, playCount: 0, listenedMs: 0 };
      const updated = checkedListeningStats({ song: next.song, playCount: total.playCount + Number(!previous.counted && next.counted), listenedMs: total.listenedMs + next.listenedMs - previous.listenedMs });
      sessions.set(id, checkedListeningSession(next)); stats.set(songKey, updated); return true;
    },
    async listStats() { return structuredClone([...stats.values()]); },
  };
}
