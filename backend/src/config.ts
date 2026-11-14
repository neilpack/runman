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
} as const;
