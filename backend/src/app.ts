// Builds the Express app. Shared by the local dev server (index.ts) and Lambda (lambda.ts).

import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { itemsRouter } from './routes/items.js';
import { musicRouter } from './routes/music.js';
import { createCassettesRouter, type CassetteApiOptions } from './routes/cassettes.js';
import { createMediaRouter, type MediaApiOptions } from './routes/media.js';
import { createProfileRouter, type ProfileApiOptions } from './routes/profile.js';
import { createMediaRuntime } from './services/mediaRuntime.js';
import { createExploreApi, type ExploreApiOptions } from './routes/explore.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

export function createApp({ disableLegacyExamples = false, cassetteApi, mediaApi, profileApi, exploreApi }: { disableLegacyExamples?: boolean; cassetteApi?: CassetteApiOptions; mediaApi?: MediaApiOptions; profileApi?: ProfileApiOptions; exploreApi?: ExploreApiOptions } = {}) {
  const app = express();
  const allowLegacyExamples = config.legacyExamplesEnabled && !disableLegacyExamples;

  // Deny before CORS preflight and body parsing so every disabled example method
  // returns 404, including OPTIONS and malformed JSON requests.
  if (!allowLegacyExamples) app.use('/api/items', notFound);

  app.use(cors({ origin: config.corsOrigins }));
  // Cassette authentication runs before its larger, bounded JSON parser.
  const media = createMediaRuntime(mediaApi);
  app.use('/api/media', createMediaRouter(mediaApi, media));
  app.use('/api/cassettes', createCassettesRouter({ ...cassetteApi, authorizeAudio: cassetteApi?.authorizeAudio ?? media?.authorize }));
  app.use('/api/profile', createProfileRouter(profileApi));
  // Explore publishing parses its own bounded JSON after authentication.
  app.use('/api/explore', createExploreApi({ ...exploreApi, media: exploreApi?.media ?? media }));
  app.use(express.json());

  // Register routes here. All API routes live under /api.
  app.use('/api/health', healthRouter);
  if (allowLegacyExamples) app.use('/api/items', itemsRouter);
  app.use('/api/music', musicRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
