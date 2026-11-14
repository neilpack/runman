// Builds the Express app. Shared by the local dev server (index.ts) and Lambda (lambda.ts).

import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { itemsRouter } from './routes/items.js';
import { musicRouter } from './routes/music.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json());

  // Register routes here. All API routes live under /api.
  app.use('/api/health', healthRouter);
  app.use('/api/items', itemsRouter);
  app.use('/api/music', musicRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
