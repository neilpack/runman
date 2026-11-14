// AWS Lambda entry point (API Gateway HTTP API -> Express). Bundled by `npm run build`.
import serverless from 'serverless-http';
import { createApp } from './app.js';

// Defense in depth: this entry point never exposes local examples, even if its
// environment is mistakenly marked development and Lambda markers are absent.
export const handler = serverless(createApp({ disableLegacyExamples: true }));
