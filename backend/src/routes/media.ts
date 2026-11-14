import express, { Router } from 'express';
import { config } from '../config.js';
import { cassetteAuth, cachedAccessTokenVerifier, type AccessTokenVerifier } from '../middleware/cassetteAuth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { createMediaRuntime, type MediaRuntimeOptions } from '../services/mediaRuntime.js';

export interface MediaApiOptions extends MediaRuntimeOptions { verifier?: AccessTokenVerifier }
export function createMediaRouter(options: MediaApiOptions = {}, runtime = createMediaRuntime(options)) {
  const router = Router();
  if (!runtime) { router.use((_req, _res, next) => next(new HttpError(503, 'Private media API is not configured.'))); return router; }
  const settings = options.settings ?? config.media;
  router.use(cassetteAuth(options.verifier ?? cachedAccessTokenVerifier(settings.userPoolId!, settings.clientId!)));
  const parse = express.json({ limit: '4kb', strict: true });
  router.use((req, res, next) => parse(req, res, (error: unknown) => {
    if (!error) { next(); return; }
    const kind = typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
    next(new HttpError(kind === 'entity.too.large' ? 413 : 400, kind === 'entity.too.large' ? 'Media request is too large.' : 'Malformed JSON request.'));
  }));
  router.post('/uploads', async (req, res) => { res.status(201).json(await runtime.create(res.locals.cassetteOwner as string, req.body)); });
  router.post('/complete', async (req, res) => { res.json(await runtime.complete(res.locals.cassetteOwner as string, req.body)); });
  router.post('/playback', async (req, res) => { res.json(await runtime.playback(res.locals.cassetteOwner as string, req.body)); });
  return router;
}
