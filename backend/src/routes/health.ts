import { Router } from 'express';
import type { HealthResponse } from '@runman/shared';
import { storageMode } from '../services/itemsService.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const body: HealthResponse = {
    status: 'ok',
    service: 'runman-api',
    timestamp: new Date().toISOString(),
    storage: storageMode,
  };
  res.json(body);
});
