import { validateCassetteDocument, validateDeleteCassetteRequest, validateListCassettesRequest, validateSaveCassetteRequest, type CassetteDocument, type CassetteValidationResult, type DeleteCassetteResponse, type ListCassettesResponse } from '@runman/shared';
import { HttpError } from '../middleware/errorHandler.js';
import { CassetteCorrupt } from '../aws/dynamoCassettes.js';
import { CassetteConflict, CassetteMissing, type CassetteRepository } from './cassetteRepository.js';
import { createCassetteCursor } from './cassetteCursor.js';

export function createCassettesService(repository: CassetteRepository, cursor: ReturnType<typeof createCassetteCursor>, clock = () => new Date().toISOString()) {
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
    if (checked.value.payload.tracks.some((track) => track.source !== 'library')) throw new HttpError(422, 'Private audio references are not supported until server-side audio ownership checks are connected.');
    return checked.value;
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
        return { cassette: publicDocument(item, pathId) };
      });
    },
    async save(owner: string, pathId: string, body: unknown) {
      id(pathId);
      const request = valid(validateSaveCassetteRequest(body));
      if (request.cassette.id !== pathId) throw new HttpError(400, 'Path ID must match the cassette ID.');
      if (request.expectedRevision >= Number.MAX_SAFE_INTEGER) throw new HttpError(400, 'Cassette revision cannot be incremented safely.');
      if (request.cassette.tracks.some((track) => track.source !== 'library')) throw new HttpError(422, 'Private audio references are not supported until server-side audio ownership checks are connected.');
      return storage(async () => ({ cassette: publicDocument(await repository.save(owner, request, clock()), pathId) }));
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
        return { items: page.items.map((item) => publicDocument(item)), ...(page.afterId ? { nextCursor: cursor.encode(owner, limit, page.afterId) } : {}) };
      });
    },
    async remove(owner: string, pathId: string, body: unknown): Promise<DeleteCassetteResponse> {
      id(pathId);
      const request = valid(validateDeleteCassetteRequest(body));
      return storage(async () => { await repository.remove(owner, pathId, request.expectedRevision); return { id: pathId, deletedRevision: request.expectedRevision }; });
    },
  };
}
