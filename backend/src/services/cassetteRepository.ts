import type { CassetteDocument, SaveCassetteRequest } from '@runman/shared';

export class CassetteConflict extends Error {}
export class CassetteMissing extends Error {}
export interface CassettePage { items: CassetteDocument[]; afterId?: string }
export interface CassetteRepository {
  get(owner: string, id: string): Promise<CassetteDocument | undefined>;
  list(owner: string, limit: number, afterId?: string): Promise<CassettePage>;
  save(owner: string, request: SaveCassetteRequest, now: string): Promise<CassetteDocument>;
  remove(owner: string, id: string, revision: number): Promise<void>;
}

/** Explicit development backend only. No DynamoDB-error fallback. */
export function createMemoryCassetteRepository(): CassetteRepository {
  const owners = new Map<string, Map<string, CassetteDocument>>();
  return {
    async get(owner, id) { return structuredClone(owners.get(owner)?.get(id)); },
    async list(owner, limit, afterId) {
      const entries = [...(owners.get(owner)?.entries() ?? [])]
        .filter(([id]) => afterId === undefined || id > afterId).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      const selected = entries.slice(0, limit);
      return { items: structuredClone(selected.map(([, item]) => item)), ...(entries.length > limit ? { afterId: selected.at(-1)![0] } : {}) };
    },
    async save(owner, request, now) {
      let tapes = owners.get(owner);
      if (!tapes) { tapes = new Map(); owners.set(owner, tapes); }
      const previous = tapes.get(request.cassette.id);
      if (request.expectedRevision === 0 ? Boolean(previous) : previous?.revision !== request.expectedRevision) {
        if (!previous && request.expectedRevision > 0) throw new CassetteMissing();
        throw new CassetteConflict();
      }
      const item: CassetteDocument = {
        schemaVersion: 1, revision: request.expectedRevision + 1,
        createdAt: previous?.createdAt ?? now, updatedAt: now, payload: structuredClone(request.cassette),
      };
      tapes.set(request.cassette.id, item);
      return structuredClone(item);
    },
    async remove(owner, id, revision) {
      const tapes = owners.get(owner);
      const item = tapes?.get(id);
      if (!item) throw new CassetteMissing();
      if (item.revision !== revision) throw new CassetteConflict();
      tapes!.delete(id);
    },
  };
}
