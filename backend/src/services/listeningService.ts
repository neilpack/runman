import { LISTENING_MAX_MS, LISTENING_THRESHOLD_MS, mediaObjectKey, validListeningSelector, validPlayId, type ListeningProgressResponse, type StartListeningResponse, type MusicTrack } from '@runman/shared';
import { HttpError } from '../middleware/errorHandler.js';
import { publicSongId } from './publishService.js';
import type { PublicCatalogRepository } from './publicCatalogRepository.js';
import { listeningSongKey, type ListeningRepository, type ListeningSong } from './listeningRepository.js';

function object(value: unknown, fields: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === fields.sort().join(',');
}
function secure(value: string | undefined) { if (!value) return undefined; try { const url = new URL(value); if (url.protocol === 'http:') url.protocol = 'https:'; return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : undefined; } catch { return undefined; } }
export function createListeningService(repository: ListeningRepository, catalog: PublicCatalogRepository, options: { jamendo(id: string): Promise<MusicTrack | undefined>; clock?: () => number; changed?(): void }) {
  const clock = options.clock ?? Date.now;
  return {
    async start(owner: string, body: unknown): Promise<StartListeningResponse> {
      if (!object(body, ['playId', 'song']) || !validPlayId(body.playId) || !validListeningSelector(body.song)) throw new HttpError(400, 'Invalid listening start.');
      const createdAt = clock(); const selector = body.song; let song: ListeningSong;
      if (selector.provider === 'jamendo') {
        const track = await options.jamendo(selector.id);
        if (!track?.audioUrl || !Number.isFinite(track.duration) || track.duration <= 0 || track.duration * 1000 > LISTENING_MAX_MS) return { eligible: false };
        song = { provider: 'jamendo', id: track.id, title: track.name, artist: track.artistName, durationSec: track.duration,
          ...(secure(track.audioUrl) ? { audioUrl: secure(track.audioUrl) } : {}), ...(secure(track.imageUrl) ? { artworkUrl: secure(track.imageUrl) } : {}), ...(secure(track.licenseUrl) ? { licenseUrl: secure(track.licenseUrl) } : {}) };
      } else {
        const id = selector.provider === 'media' ? publicSongId(owner, mediaObjectKey(owner, selector.id)) : selector.id;
        const row = await catalog.getSong(id);
        if (!row) return { eligible: false }; // Never publish or count a private recording.
        song = { provider: 'explore', id: row.id, title: row.title, artist: row.artist, durationSec: row.durationSec, ...(row.artworkUrl ? { artworkUrl: row.artworkUrl } : {}) };
      }
      const previous = await repository.start({ owner, playId: body.playId, song, createdAt, revision: 0, listenedMs: 0, counted: false });
      if (listeningSongKey(previous.song) !== listeningSongKey(song)) throw new HttpError(409, 'Playback ID already belongs to another song.');
      return { eligible: true };
    },
    async progress(owner: string, body: unknown): Promise<ListeningProgressResponse> {
      if (!object(body, ['playId', 'listenedMs']) || !validPlayId(body.playId) || typeof body.listenedMs !== 'number' || !Number.isSafeInteger(body.listenedMs) || body.listenedMs < 0 || body.listenedMs > LISTENING_MAX_MS) throw new HttpError(400, 'Invalid listening progress.');
      for (let attempt = 0; attempt < 4; attempt++) {
        const previous = await repository.get(owner, body.playId);
        if (!previous) throw new HttpError(404, 'Playback session not found.');
        if (clock() - previous.createdAt > 24 * 3600 * 1000) throw new HttpError(410, 'Playback session expired.');
        const listenedMs = Math.min(body.listenedMs, Math.ceil(previous.song.durationSec * 1000));
        if (listenedMs > Math.max(0, clock() - previous.createdAt) + 2000) throw new HttpError(400, 'Listening exceeds playback elapsed time.');
        if (listenedMs <= previous.listenedMs) return { counted: previous.counted, listenedMs: previous.listenedMs };
        const counted = previous.counted || listenedMs >= Math.min(LISTENING_THRESHOLD_MS, Math.ceil(previous.song.durationSec * 1000));
        const next = { ...previous, revision: previous.revision + 1, listenedMs, counted };
        if (await repository.advance(previous, next)) { options.changed?.(); return { counted, listenedMs }; }
      }
      throw new HttpError(409, 'Playback progress changed. Retry the same progress.');
    },
  };
}
export type ListeningService = ReturnType<typeof createListeningService>;
