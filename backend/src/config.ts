// Central place for environment configuration. Read env vars here, not elsewhere.

export function readConfig(env: NodeJS.ProcessEnv) {
  const cloudExecution = env.AWS_LAMBDA_FUNCTION_NAME !== undefined ||
    env.AWS_EXECUTION_ENV !== undefined || env.LAMBDA_TASK_ROOT !== undefined;

  return {
    port: Number(env.PORT ?? 4000),
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    legacyExamplesEnabled: env.NODE_ENV === 'development' &&
      env.ENABLE_LEGACY_EXAMPLES === 'true' && !cloudExecution,
    aws: {
      region: env.AWS_REGION ?? 'us-east-1',
      itemsTable: env.ITEMS_TABLE || undefined,
      uploadsBucket: env.UPLOADS_BUCKET || undefined,
    },
  } as const;
}

export const config = readConfig(process.env);
