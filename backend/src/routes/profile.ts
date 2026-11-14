// Signed-in account settings stored in DynamoDB (currently the favorite tape).
// Uses the cassette API's settings, table and Cognito access-token check.

import express, { Router } from 'express';
import { config, type CassettesSettings } from '../config.js';
import { cachedAccessTokenVerifier, cassetteAuth, type AccessTokenVerifier } from '../middleware/cassetteAuth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { createDynamoProfileRepository } from '../aws/dynamoProfiles.js';
import { createMemoryProfileRepository, type ProfileRepository } from '../services/profileRepository.js';
import { createProfileService } from '../services/profileService.js';
import { cassetteSettingsReady } from './cassettes.js';

export interface ProfileApiOptions {
  settings?: CassettesSettings;
  repository?: ProfileRepository;
  verifier?: AccessTokenVerifier;
  clock?: () => string;
}

export function createProfileRouter(options: ProfileApiOptions = {}) {
  const router = Router();
  const settings = options.settings ?? config.cassettes;
  if (!cassetteSettingsReady(settings)) {
    router.use((_req, _res, next) => next(new HttpError(503, 'Profile API is not configured for this environment.')));
    return router;
  }
  const verifier = options.verifier ?? cachedAccessTokenVerifier(settings.userPoolId!, settings.clientId!);
  const repository = options.repository ?? (settings.storageMode === 'memory' ? createMemoryProfileRepository() : createDynamoProfileRepository(settings.tableName!));
  const service = createProfileService(repository, options.clock);
  router.use(cassetteAuth(verifier));
  const parse = express.json({ limit: '300kb', strict: true });
  router.use((req, res, next) => parse(req, res, (error: unknown) => {
    if (!error) { next(); return; }
    const kind = typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
    next(new HttpError(kind === 'entity.too.large' ? 413 : 400, kind === 'entity.too.large' ? 'Profile request is too large.' : 'Malformed JSON request.'));
  }));
  router.get('/', async (_req, res) => { res.json(await service.get(res.locals.cassetteOwner as string)); });
  router.put('/', async (req, res) => { res.json(await service.save(res.locals.cassetteOwner as string, req.body)); });
  return router;
}
