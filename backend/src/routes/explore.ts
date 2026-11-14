// Explore API. Public reads: shared songs, trending, tapes and listener profiles.
// Signed in (/mine, /songs/:id/adds): publishing to the DynamoDB catalog (shared/src/explorePublishing.ts).

import express, { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { config, type CassettesSettings } from '../config.js';
import { cachedAccessTokenVerifier, cassetteAuth, type AccessTokenVerifier } from '../middleware/cassetteAuth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { createDynamoPublicCatalogRepository } from '../aws/dynamoPublicCatalog.js';
import { demoProfiles, demoSongs } from '../services/exploreDemoData.js';
import {
  ID_PATTERN, USERNAME_PATTERN, createCatalogSource, createExploreService, defaultExploreSource,
  type ExploreService, type ExploreSource,
} from '../services/exploreService.js';
import type { MediaService } from '../services/mediaService.js';
import { createMemoryPublicCatalogRepository, type PublicCatalogRepository } from '../services/publicCatalogRepository.js';
import { createPublishService, type PublishService } from '../services/publishService.js';
import { cassetteSettingsReady } from './cassettes.js';

function parseInteger(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return Number.NaN;
  return Number(value);
}

function queryText(value: unknown, max: number): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new HttpError(400, '`q` must be a single string');
  const q = value.trim();
  if (q.length > max) throw new HttpError(400, `\`q\` must be ${max} characters or fewer`);
  return q;
}

function boundedLimit(value: unknown, fallback: number, max: number): number {
  const limit = parseInteger(value, fallback);
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    throw new HttpError(400, `\`limit\` must be an integer between 1 and ${max}`);
  }
  return limit;
}

export function createExploreRouter(service: ExploreService, publishing?: { publisher: PublishService; auth: RequestHandler }) {
  const router = Router();

  router.get('/songs', async (req, res) => {
    const q = queryText(req.query.q, 200);
    const limit = boundedLimit(req.query.limit, 20, 50);
    const offset = parseInteger(req.query.offset, 0);
    if (!Number.isInteger(offset) || offset < 0) throw new HttpError(400, '`offset` must be a non-negative integer');
    res.json(await service.songs({ q, limit, offset }));
  });

  router.get('/songs/trending', async (_req, res) => {
    res.json(await service.trending());
  });

  // Stable audio URL for a public song. Redirects to a fresh presigned S3 link each time, so
  // tracks can store this URL even though the S3 links themselves expire.
  router.get('/songs/:id/audio', async (req, res) => {
    if (!ID_PATTERN.test(req.params.id)) throw new HttpError(400, 'Invalid song id');
    const url = await service.audioUrl(req.params.id);
    if (!url) throw new HttpError(404, 'This song has no audio');
    res.set('Cache-Control', 'no-store');
    res.redirect(302, url);
  });

  router.get('/profiles', async (req, res) => {
    const q = queryText(req.query.q, 25);
    const limit = boundedLimit(req.query.limit, 24, 50);
    res.json(await service.listeners({ q, limit }));
  });

  router.get('/profiles/:username', async (req, res) => {
    const { username } = req.params;
    if (!USERNAME_PATTERN.test(username)) throw new HttpError(404, `No listener called @${username.slice(0, 24)}`);
    const page = await service.listener(username);
    if (!page) throw new HttpError(404, `No listener called @${username}`);
    res.json(page);
  });

  router.get('/tapes', async (req, res) => {
    const q = queryText(req.query.q, 200);
    const limit = boundedLimit(req.query.limit, 20, 50);
    const offset = parseInteger(req.query.offset, 0);
    if (!Number.isInteger(offset) || offset < 0) throw new HttpError(400, '`offset` must be a non-negative integer');
    res.json(await service.tapes({ q, limit, offset }));
  });

  router.get('/tapes/:id', async (req, res) => {
    if (!ID_PATTERN.test(req.params.id)) throw new HttpError(400, 'Invalid tape id');
    const page = await service.tape(req.params.id);
    if (!page) throw new HttpError(404, 'That tape is not on Explore.');
    res.json(page);
  });

  // ---- Signed in: publishing and add counts ----
  if (!publishing) {
    const off = (_req: unknown, _res: unknown, next: (error: unknown) => void) => next(new HttpError(503, 'Explore publishing is not configured for this environment.'));
    router.use('/mine', off);
    router.post('/songs/:id/adds', off);
    return router;
  }
  const { publisher, auth } = publishing;
  const parse = express.json({ limit: '300kb', strict: true });
  const body = (req: Request, res: Response, next: NextFunction) => parse(req, res, (error: unknown) => {
    if (!error) { next(); return; }
    const kind = typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
    next(new HttpError(kind === 'entity.too.large' ? 413 : 400, kind === 'entity.too.large' ? 'Publish request is too large.' : 'Malformed JSON request.'));
  });
  const owner = (res: Response) => res.locals.cassetteOwner as string;
  // Authentication runs before the larger body parser.
  router.use('/mine', auth, body);
  router.put('/mine/profile', async (req, res) => { res.json(await publisher.publishProfile(owner(res), req.body)); });
  router.put('/mine/songs', async (req, res) => { res.json(await publisher.publishSong(owner(res), req.body)); });
  router.delete('/mine/songs', async (req, res) => { res.json(await publisher.unpublishSong(owner(res), req.body)); });
  router.put('/mine/tapes/:id', async (req, res) => { res.json(await publisher.publishTape(owner(res), req.params.id, req.body)); });
  router.delete('/mine/tapes/:id', async (req, res) => { res.json(await publisher.unpublishTape(owner(res), req.params.id)); });
  router.post('/songs/:id/adds', auth, async (req, res) => { res.json(await publisher.recordAdd(owner(res), String(req.params.id))); });
  return router;
}

export interface ExploreApiOptions {
  settings?: CassettesSettings;
  repository?: PublicCatalogRepository;
  verifier?: AccessTokenVerifier;
  clock?: () => string;
  /** Owner-checked private audio, from the media runtime. Without it songs can't be published or streamed. */
  media?: Pick<MediaService, 'authorize' | 'playback'>;
  /** Overrides everything above (tests): a plain read-only Explore. */
  source?: ExploreSource;
}

/**
 * Explore for this environment. With cassette storage configured, it is backed by the published
 * catalog in the same table (memory in local dev, mixed with the sample catalog); otherwise it falls
 * back to the uploads bucket / sample data and publishing answers 503.
 */
export function createExploreApi(options: ExploreApiOptions = {}) {
  const settings = options.settings ?? config.cassettes;
  if (options.source || !cassetteSettingsReady(settings)) return createExploreRouter(createExploreService(options.source ?? defaultExploreSource()));
  const memory = settings.storageMode === 'memory';
  const repository = options.repository ?? (memory ? createMemoryPublicCatalogRepository() : createDynamoPublicCatalogRepository(settings.tableName!));
  const media = options.media;
  const source = createCatalogSource(repository, {
    catalog: memory ? 'demo' : 'dynamodb',
    ...(memory && config.explore.demoCatalog ? { extra: { songs: demoSongs(new Date()), profiles: demoProfiles() } } : {}),
    ...(media ? { playback: async (owner: string, mediaId: string) => (await media.playback(owner, { mediaId })).url } : {}),
  });
  const publisher = createPublishService(repository, { authorizeAudio: media?.authorize, clock: options.clock, onChange: () => source.invalidate() });
  const verifier = options.verifier ?? cachedAccessTokenVerifier(settings.userPoolId!, settings.clientId!);
  return createExploreRouter(createExploreService(source), { publisher, auth: cassetteAuth(verifier) });
}
