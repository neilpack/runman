// Central place for environment configuration. Read env vars here, not elsewhere.

// Jamendo documents this client ID for read-only API testing. It keeps local setup
// friction-free for teammates; deployed environments must provide our own client ID.
const localJamendoTestClientId = '709fa152';
const isDeployed = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) || process.env.NODE_ENV === 'production';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  aws: {
    region: process.env.AWS_REGION ?? 'us-east-1',
    itemsTable: process.env.ITEMS_TABLE || undefined,
    uploadsBucket: process.env.UPLOADS_BUCKET || undefined,
  },
  jamendo: {
    clientId: process.env.JAMENDO_CLIENT_ID || (isDeployed ? undefined : localJamendoTestClientId),
    apiUrl: process.env.JAMENDO_API_URL ?? 'https://api.jamendo.com/v3.0',
  },
} as const;
