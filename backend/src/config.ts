// Central place for environment configuration. Read env vars here, not elsewhere.

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
    clientId: process.env.JAMENDO_CLIENT_ID || undefined,
    apiUrl: process.env.JAMENDO_API_URL ?? 'https://api.jamendo.com/v3.0',
  },
} as const;
