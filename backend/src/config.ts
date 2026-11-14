// Central place for environment configuration. Read env vars here, not elsewhere.

// Jamendo documents this client ID for read-only API testing. It keeps local setup
// friction-free for teammates; deployed environments must provide our own client ID.
const localJamendoTestClientId = '709fa152';

export function readConfig(env: NodeJS.ProcessEnv) {
  const cloudExecution =
    env.AWS_LAMBDA_FUNCTION_NAME !== undefined || env.AWS_EXECUTION_ENV !== undefined || env.LAMBDA_TASK_ROOT !== undefined;
  const isDeployed = Boolean(env.AWS_LAMBDA_FUNCTION_NAME) || env.NODE_ENV === 'production';

  return {
    port: Number(env.PORT ?? 4000),
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    legacyExamplesEnabled: env.NODE_ENV === 'development' && env.ENABLE_LEGACY_EXAMPLES === 'true' && !cloudExecution,
    aws: {
      region: env.AWS_REGION ?? 'us-east-1',
      itemsTable: env.ITEMS_TABLE || undefined,
      uploadsBucket: env.UPLOADS_BUCKET || undefined,
    },
    explore: {
      /**
       * With no UPLOADS_BUCKET, Explore serves built-in sample songs/listeners so the page works
       * locally. Never in deployed environments: there it shows an empty catalog instead.
       */
      demoCatalog: !isDeployed,
    },
    jamendo: {
      clientId: env.JAMENDO_CLIENT_ID || (isDeployed ? undefined : localJamendoTestClientId),
      apiUrl: env.JAMENDO_API_URL ?? 'https://api.jamendo.com/v3.0',
    },
  } as const;
}

export const config = readConfig(process.env);
