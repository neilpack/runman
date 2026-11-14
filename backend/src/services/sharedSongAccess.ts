import { HttpError } from '../middleware/errorHandler.js';
import type { PublicCatalogRepository } from './publicCatalogRepository.js';
import type { CassetteRepository } from './cassetteRepository.js';

/** An add is a durable account grant, separate from a song's Discover visibility. */
export function createSharedSongAccess(repository: PublicCatalogRepository, cassettes?: CassetteRepository) {
  async function previouslySaved(owner: string, id: string, cassetteId?: string) {
    if (!cassettes || !cassetteId || !/^[a-zA-Z0-9_-]{1,128}$/.test(cassetteId)) return false;
    const tape = await cassettes.get(owner, cassetteId);
    return !!tape?.payload.tracks.some((track) => track.provider === 'explore' && track.sourceId === id);
  }
  return {
    async canPlay(owner: string, id: string, cassetteId?: string) {
      const song = await repository.getSong(id);
      return !!song && (song.listed || song.ownerId === owner || await repository.hasSongAccess(id, owner) || await previouslySaved(owner, id, cassetteId));
    },
    async retain(owner: string, id: string, cassetteId?: string) {
      const song = await repository.getSong(id);
      if (!song) throw new HttpError(404, 'This shared song is no longer available.');
      if (song.ownerId === owner || await repository.hasSongAccess(id, owner)) return;
      // Compatibility for tapes saved before add records became reliable grants.
      // Only a server-stored tape in this verified account counts, never the incoming payload.
      if (!song.listed && await previouslySaved(owner, id, cassetteId)) return;
      if (await repository.recordAdd(id, owner) === undefined) throw new HttpError(404, 'This song is no longer available to add.');
    },
  };
}
