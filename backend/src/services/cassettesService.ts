import { validateCassetteDocument, validateDeleteCassetteRequest, validateListCassettesRequest, validateSaveCassetteRequest, type CassetteDocument, type CassetteValidationResult, type DeleteCassetteResponse, type ListCassettesResponse } from '@runman/shared';
import { HttpError } from '../middleware/errorHandler.js';
import { CassetteCorrupt } from '../aws/dynamoCassettes.js';
import { CassetteConflict, CassetteMissing, type CassetteRepository } from './cassetteRepository.js';
import { createCassetteCursor } from './cassetteCursor.js';
import type { MediaAuthorizer } from './mediaService.js';
import type { CassettePayload, StoredAudioReference } from '@runman/shared';

export function createCassettesService(repository: CassetteRepository, cursor: ReturnType<typeof createCassetteCursor>, clock = () => new Date().toISOString(), authorizeAudio?: MediaAuthorizer, retainSong?: (owner: string, id: string, cassetteId?: string) => Promise<void>) {
  function valid<T>(result: CassetteValidationResult<T>): T {
    if (!result.ok) throw new HttpError(400, 'Invalid cassette request.', result.issues);
    return result.value;
  }
  function id(value: string) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new HttpError(400, 'Invalid cassette ID.');
    return value;
  }
  function publicDocument(value: CassetteDocument, expectedId?: string) {
    const checked = validateCassetteDocument(value);
    if (!checked.ok || (expectedId !== undefined && checked.value.payload.id !== expectedId)) throw new CassetteCorrupt();
    return checked.value;
  }
  async function authorize(owner: string, payloads: CassettePayload[]) {
    const unique = new Map<string, StoredAudioReference>();
    for (const payload of payloads) for (const track of payload.tracks) if (track.provider === 's3') {
      const previous = unique.get(track.audio.objectKey);
      if (previous && (previous.source !== track.audio.source || previous.contentType !== track.audio.contentType || previous.sizeBytes !== track.audio.sizeBytes)) throw new HttpError(422, 'Conflicting metadata for the same private audio object.');
      unique.set(track.audio.objectKey, track.audio);
    }
    if (!unique.size) return;
    if (!authorizeAudio) throw new HttpError(422, 'Private audio references are not supported until server-side audio ownership checks are connected.');
    const references = [...unique.values()];
    let index = 0;
    let failed = false;
    let failure: unknown;
    // One bounded pool across the entire listing request, not one per tape.
    await Promise.all(Array.from({ length: Math.min(4, references.length) }, async () => {
      while (!failed && index < references.length) {
        const reference = references[index++];
        try { await authorizeAudio(owner, reference); }
        catch (error) { if (!failed) { failed = true; failure = error; } }
      }
    }));
    if (failed) throw failure;
  }
  async function storage<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof CassetteMissing) throw new HttpError(404, 'Cassette not found.');
      if (error instanceof CassetteConflict) throw new HttpError(409, 'Cassette revision conflict. Reload before retrying.');
      if (error instanceof CassetteCorrupt) throw new HttpError(500, 'Cassette storage returned an invalid record.');
      throw new HttpError(503, 'Cassette storage is temporarily unavailable.');
    }
  }
  return {
    async get(owner: string, pathId: string) {
      id(pathId);
      return storage(async () => {
        const item = await repository.get(owner, pathId);
        if (!item) throw new CassetteMissing();
        const cassette = publicDocument(item, pathId);
        await authorize(owner, [cassette.payload]);
        return { cassette };
      });
    },
    async save(owner: string, pathId: string, body: unknown) {
      id(pathId);
      const request = valid(validateSaveCassetteRequest(body));
      if (request.cassette.id !== pathId) throw new HttpError(400, 'Path ID must match the cassette ID.');
      if (request.expectedRevision >= Number.MAX_SAFE_INTEGER) throw new HttpError(400, 'Cassette revision cannot be incremented safely.');
      return storage(async () => {
        await authorize(owner, [request.cassette]);
        // Establish durable access while a shared song is listed. Old grants remain valid
        // after withdrawal. This applies to every save path, including copied public tapes.
        const songs = new Set(request.cassette.tracks.flatMap((track) => track.provider === 'explore' ? [track.sourceId] : []));
        for (const song of songs) {
          if (!retainSong) throw new HttpError(503, 'Shared song saving is not configured.');
          await retainSong(owner, song, pathId);
        }
        return { cassette: publicDocument(await repository.save(owner, request, clock()), pathId) };
      });
    },
    async list(owner: string, input: unknown): Promise<ListCassettesResponse> {
      const request = valid(validateListCassettesRequest(input));
      const limit = request.limit ?? 25;
      let afterId: string | undefined;
      if (request.cursor) {
        try { afterId = cursor.decode(request.cursor, owner, limit); }
        catch { throw new HttpError(400, 'Invalid pagination cursor.'); }
      }
      return storage(async () => {
        const page = await repository.list(owner, limit, afterId);
        const items: CassetteDocument[] = [];
        const mediaKeys = new Set<string>();
        let truncated = false;
        for (const item of page.items) {
          const document = publicDocument(item);
          const keys = document.payload.tracks.flatMap((track) => track.provider === 's3' ? [track.audio.objectKey] : []);
          const added = new Set(keys.filter((key) => !mediaKeys.has(key)));
          // Bound total Dynamo/HEAD work as well as parallelism. The first
          // cassette always fits because the shared track cap is 100.
          if (mediaKeys.size + added.size > 100) { truncated = true; break; }
          keys.forEach((key) => mediaKeys.add(key));
          items.push(document);
        }
        await authorize(owner, items.map((item) => item.payload));
        const nextAfterId = truncated ? items.at(-1)?.payload.id : page.afterId;
        return { items, ...(nextAfterId ? { nextCursor: cursor.encode(owner, limit, nextAfterId) } : {}) };
      });
    },
    async remove(owner: string, pathId: string, body: unknown): Promise<DeleteCassetteResponse> {
      id(pathId);
      const request = valid(validateDeleteCassetteRequest(body));
      return storage(async () => { await repository.remove(owner, pathId, request.expectedRevision); return { id: pathId, deletedRevision: request.expectedRevision }; });
    },
  };
}
