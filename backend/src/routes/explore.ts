// Explore API (public, read-only): shared songs, trending, and listener profiles.
// Publishing a song/profile is a separate, authenticated flow that writes the S3 layout
// documented in services/exploreService.ts.

import { Router } from 'express';
import { HttpError } from '../middleware/errorHandler.js';
import { ID_PATTERN, USERNAME_PATTERN, exploreService, type ExploreService } from '../services/exploreService.js';

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

export function createExploreRouter(service: ExploreService) {
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

  return router;
}

export const exploreRouter = createExploreRouter(exploreService);
