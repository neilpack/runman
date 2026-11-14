// Publishing to Explore: profiles, uploaded songs and tapes. Storage: publicCatalogRepository.ts.

import { createHash } from 'node:crypto';
import {
  validatePublishProfileRequest, validatePublishSongRequest, validatePublishTapeRequest, validateUnpublishSongRequest,
  type CassetteValidationResult, type PublicSong, type PublicTape, type PublicTapeTrack, type PublishProfileResponse, type PublishSongResponse,
  type PublishTapeResponse, type RecordSongAddResponse, type UnpublishResponse,
} from '@runman/shared';
import { HttpError } from '../middleware/errorHandler.js';
import type { MediaAuthorizer } from './mediaService.js';
import { CatalogConflict, CatalogCorrupt, UsernameTaken, type PublicCatalogRepository, type PublicSongItem } from './publicCatalogRepository.js';

/** Stable catalog IDs, so republishing the same audio/tape updates one row. */
function catalogId(kind: string, owner: string, key: string) {
  return createHash('sha256').update(`${kind}\n${owner}\n${key}`).digest('base64url').slice(0, 32);
}
export const publicSongId = (owner: string, objectKey: string) => catalogId('song', owner, objectKey);
export const publicTapeId = (owner: string, cassetteId: string) => catalogId('tape', owner, cassetteId);

export function toPublicSong(item: PublicSongItem, username = item.uploaderUsername): PublicSong {
  return {
    id: item.id, title: item.title, artist: item.artist, durationSec: item.durationSec,
    uploader: { userId: item.ownerId, username }, ...(item.artworkUrl ? { artworkUrl: item.artworkUrl } : {}),
    hasAudio: true, addCount: item.addCount, publishedAt: item.publishedAt,
  };
}

export function createPublishService(repository: PublicCatalogRepository, options: { authorizeAudio?: MediaAuthorizer; clock?: () => string; onChange?: () => void } = {}) {
  const clock = options.clock ?? (() => new Date().toISOString());
  const changed = () => options.onChange?.();
  function valid<T>(result: CassetteValidationResult<T>): T {
    if (!result.ok) throw new HttpError(400, 'Invalid publish request.', result.issues);
    return result.value;
  }
  async function storage<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof UsernameTaken) throw new HttpError(409, 'That username is already taken on Explore. Pick another one.');
      if (error instanceof CatalogConflict) throw new HttpError(409, 'That catalog entry changed or belongs to someone else. Try again.');
      if (error instanceof CatalogCorrupt) throw new HttpError(500, 'Explore storage returned an invalid record.');
      throw new HttpError(503, 'Explore storage is temporarily unavailable.');
    }
  }
  async function publishedProfile(owner: string) {
    const profile = await repository.getProfile(owner);
    if (!profile) throw new HttpError(409, 'Publish your Explore profile (pick a username) before sharing songs or tapes.');
    return profile;
  }
  const songIdsOf = (tape: PublicTape) => tape.tape.tracks.flatMap((t) => (t.provider === 'explore' ? [t.sourceId] : []));
  /** Song ids the owner's public tapes still play. */
  async function tapeSongIds(owner: string) {
    const tapes = (await repository.listTapes()).filter((t) => t.owner.userId === owner);
    return new Set(tapes.flatMap(songIdsOf));
  }
  /** Withdraw unused songs without revoking earlier listeners' saved access. */
  async function dropUnusedSongs(owner: string, candidates: string[]) {
    if (!candidates.length) return;
    const used = await tapeSongIds(owner);
    for (const id of new Set(candidates)) {
      if (used.has(id)) continue;
      const song = await repository.getSong(id);
      if (song && song.ownerId === owner) await repository.unlistSong(id, owner, clock());
    }
  }
  function cassetteId(value: string) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new HttpError(400, 'Invalid cassette ID.');
    return value;
  }

  return {
    async publishProfile(owner: string, body: unknown): Promise<PublishProfileResponse> {
      const { ifPublished, ...input } = valid(validatePublishProfileRequest(body));
      return storage(async () => {
        const saved = await repository.putProfile(owner, input, clock(), ifPublished === true);
        if (saved) changed();
        return { profile: saved ? { userId: saved.userId, username: saved.username, avatar: saved.avatar, favoriteTape: saved.favoriteTape } : null };
      });
    },

    async publishSong(owner: string, body: unknown): Promise<PublishSongResponse> {
      const request = valid(validatePublishSongRequest(body));
      if (!options.authorizeAudio) throw new HttpError(503, 'Private audio storage is not configured, so songs cannot be shared here.');
      const authorize = options.authorizeAudio;
      return storage(async () => {
        await authorize(owner, request.audio);
        const profile = await publishedProfile(owner);
        const item = await repository.putSong({ id: publicSongId(owner, request.audio.objectKey), ownerId: owner, uploaderUsername: profile.username, ...request, listed: true }, clock());
        changed();
        return { song: toPublicSong(item, profile.username) };
      });
    },

    /** Takes the song off Explore's lists while preserving earlier recipients' playback. */
    async unpublishSong(owner: string, body: unknown): Promise<UnpublishResponse> {
      const { objectKey } = valid(validateUnpublishSongRequest(body));
      const id = publicSongId(owner, objectKey);
      return storage(async () => {
        const song = await repository.getSong(id);
        if (!song || song.ownerId !== owner || !song.listed) throw new HttpError(404, 'That song is not on Explore.');
        await repository.unlistSong(id, owner, clock());
        changed();
        return { id };
      });
    },

    /**
     * Publishes the whole tape: its look and every track. Jamendo and Explore tracks are kept as they
     * are. The owner's own uploads/recordings become Explore songs (listed under Explore → Songs), so
     * anyone can play them; when withdrawn they remain playable by earlier recipients.
     * Without private audio storage those tracks can't stream, so they are left off.
     */
    async publishTape(owner: string, pathId: string, body: unknown): Promise<PublishTapeResponse> {
      const { cassette } = valid(validatePublishTapeRequest(body));
      if (cassette.id !== cassetteId(pathId)) throw new HttpError(400, 'Path ID must match the cassette ID.');
      return storage(async () => {
        const profile = await publishedProfile(owner);
        const id = publicTapeId(owner, cassette.id);
        const before = await repository.getTape(id);
        const now = clock();
        const tracks: PublicTapeTrack[] = [];
        for (const track of cassette.tracks) {
          if (track.provider !== 's3') { tracks.push(track); continue; }
          if (!options.authorizeAudio) continue;
          await options.authorizeAudio(owner, track.audio);
          const song = await repository.putSong({
            id: publicSongId(owner, track.audio.objectKey), ownerId: owner, uploaderUsername: profile.username,
            title: track.title, artist: track.artist, durationSec: track.durationSec, audio: track.audio,
            ...(track.artworkUrl ? { artworkUrl: track.artworkUrl } : {}), listed: true,
          }, now);
          const { audio: _audio, provider: _provider, source: _source, visibility: _visibility, sourceId: _sourceId, ...details } = track;
          tracks.push({ ...details, source: 'community', provider: 'explore', sourceId: song.id, hasAudio: true });
        }
        const { visibility: _visibility, tracks: _tracks, ...look } = cassette;
        const tape = await repository.putTape({ id, owner: { userId: owner, username: profile.username }, tape: { ...look, tracks } }, now);
        // Songs this tape no longer uses may now be orphaned.
        await dropUnusedSongs(owner, before ? songIdsOf(before) : []);
        changed();
        return { tape };
      });
    },

    async unpublishTape(owner: string, pathId: string): Promise<UnpublishResponse> {
      const id = publicTapeId(owner, cassetteId(pathId));
      return storage(async () => {
        const before = await repository.getTape(id);
        if (!before || before.owner.userId !== owner || !await repository.deleteTape(id, owner)) throw new HttpError(404, 'That tape is not on Explore.');
        await dropUnusedSongs(owner, songIdsOf(before));
        changed();
        return { id };
      });
    },

    async recordAdd(listener: string, songId: string): Promise<RecordSongAddResponse> {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(songId)) throw new HttpError(400, 'Invalid song id');
      return storage(async () => {
        const addCount = await repository.recordAdd(songId, listener);
        if (addCount === undefined) throw new HttpError(404, 'That song is not on Explore.');
        changed();
        return { addCount };
      });
    },
  };
}

export type PublishService = ReturnType<typeof createPublishService>;
