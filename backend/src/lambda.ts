// AWS Lambda entry point (API Gateway HTTP API -> Express). Bundled by `npm run build`.
import serverless from 'serverless-http';
import { createApp } from './app.js';

export const handler = serverless(createApp());
