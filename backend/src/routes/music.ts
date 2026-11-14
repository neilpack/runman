import { Router } from 'express';
import { HttpError } from '../middleware/errorHandler.js';
import { JamendoError, searchJamendoTracks } from '../services/jamendoService.js';

export const musicRouter = Router();

musicRouter.get('/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query) throw new HttpError(400, '`q` is required');
  if (query.length > 200) throw new HttpError(400, '`q` must be 200 characters or fewer');

  const limit = parseInteger(req.query.limit, 20);
  const offset = parseInteger(req.query.offset, 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new HttpError(400, '`limit` must be an integer between 1 and 50');
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new HttpError(400, '`offset` must be a non-negative integer');
  }

  try {
    res.json(await searchJamendoTracks(query, limit, offset));
  } catch (error) {
    if (error instanceof JamendoError) throw new HttpError(502, error.message);
    throw error;
  }
});

function parseInteger(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return Number.NaN;
  return Number(value);
}
