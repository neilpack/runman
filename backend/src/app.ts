// Builds the Express app. Shared by the local dev server (index.ts) and Lambda (lambda.ts).

import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { itemsRouter } from './routes/items.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

export function createApp({ disableLegacyExamples = false }: { disableLegacyExamples?: boolean } = {}) {
  const app = express();
  const allowLegacyExamples = config.legacyExamplesEnabled && !disableLegacyExamples;

  // Deny before CORS preflight and body parsing so every disabled example method
  // returns 404, including OPTIONS and malformed JSON requests.
  if (!allowLegacyExamples) app.use('/api/items', notFound);

  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json());

  // Register routes here. All API routes live under /api.
  app.use('/api/health', healthRouter);
  if (allowLegacyExamples) app.use('/api/items', itemsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
