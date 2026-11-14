import express, { Router } from 'express';
import { config, type CassettesSettings } from '../config.js';
import { cachedAccessTokenVerifier, cassetteAuth, type AccessTokenVerifier } from '../middleware/cassetteAuth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { createDynamoCassetteRepository } from '../aws/dynamoCassettes.js';
import { createMemoryCassetteRepository, type CassetteRepository } from '../services/cassetteRepository.js';
import { createCassetteCursor } from '../services/cassetteCursor.js';
import { createCassettesService } from '../services/cassettesService.js';
import type { MediaAuthorizer } from '../services/mediaService.js';

export interface CassetteApiOptions {
  settings?: CassettesSettings;
  repository?: CassetteRepository;
  verifier?: AccessTokenVerifier;
  clock?: () => string;
  authorizeAudio?: MediaAuthorizer;
}

export function createCassettesRouter(options: CassetteApiOptions = {}) {
  const router = Router();
  const settings = options.settings ?? config.cassettes;
  const ready = ['memory', 'dynamodb'].includes(settings.storageMode) &&
    (settings.storageMode !== 'memory' || settings.localMemoryAllowed) &&
    ['us-west-2', 'us-east-1'].includes(settings.region) &&
    typeof settings.userPoolId === 'string' && new RegExp(`^${settings.region}_[a-zA-Z0-9]+$`).test(settings.userPoolId) &&
    typeof settings.clientId === 'string' && /^[a-zA-Z0-9]{1,128}$/.test(settings.clientId) &&
    typeof settings.cursorSecret === 'string' && Buffer.byteLength(settings.cursorSecret, 'utf8') >= 32 &&
    (settings.storageMode !== 'dynamodb' || (typeof settings.tableName === 'string' && /^[a-zA-Z0-9_.-]{3,255}$/.test(settings.tableName)));
  if (!ready) {
    router.use((_req, _res, next) => next(new HttpError(503, 'Cassette API is not configured for this environment.')));
    return router;
  }
  const verifier = options.verifier ?? cachedAccessTokenVerifier(settings.userPoolId!, settings.clientId!);
  const repository = options.repository ?? (settings.storageMode === 'memory' ? createMemoryCassetteRepository() : createDynamoCassetteRepository(settings.tableName!));
  const context = `${settings.region}:${settings.userPoolId}:${settings.clientId}:${settings.storageMode}:${settings.tableName ?? 'local'}`;
  const service = createCassettesService(repository, createCassetteCursor(settings.cursorSecret!, context), options.clock, options.authorizeAudio);
  router.use(cassetteAuth(verifier));
  const parse = express.json({ limit: '300kb', strict: true });
  router.use((req, res, next) => parse(req, res, (error: unknown) => {
    if (!error) { next(); return; }
    const kind = typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
    next(new HttpError(kind === 'entity.too.large' ? 413 : 400, kind === 'entity.too.large' ? 'Cassette request is too large.' : 'Malformed JSON request.'));
  }));
  router.get('/', async (req, res) => {
    const values: Record<string, unknown> = {};
    const params = new URL(req.originalUrl, 'http://localhost').searchParams;
    for (const key of params.keys()) {
      if (!['limit', 'cursor'].includes(key) || params.getAll(key).length !== 1) throw new HttpError(400, 'Unknown or duplicate pagination parameter.');
      const value = params.get(key)!;
      values[key] = key === 'limit' && /^\d+$/.test(value) ? Number(value) : value;
    }
    res.json(await service.list(res.locals.cassetteOwner as string, values));
  });
  router.get('/:id', async (req, res) => { res.json(await service.get(res.locals.cassetteOwner as string, req.params.id)); });
  router.put('/:id', async (req, res) => {
    const result = await service.save(res.locals.cassetteOwner as string, req.params.id, req.body);
    res.status(result.cassette.revision === 1 ? 201 : 200).json(result);
  });
  router.delete('/:id', async (req, res) => { res.json(await service.remove(res.locals.cassetteOwner as string, req.params.id, req.body)); });
  return router;
}
