// Central place for environment configuration. Read env vars here, not elsewhere.

// Jamendo documents this client ID for read-only API testing. It keeps local setup
// friction-free for teammates; deployed environments must provide our own client ID.
const localJamendoTestClientId = '709fa152';

export function readConfig(env: NodeJS.ProcessEnv) {
  const cloudExecution = env.AWS_LAMBDA_FUNCTION_NAME !== undefined ||
    env.AWS_EXECUTION_ENV !== undefined || env.LAMBDA_TASK_ROOT !== undefined;
  const isLocal = !cloudExecution && (env.NODE_ENV === undefined || env.NODE_ENV === 'development' || env.NODE_ENV === 'test');
  return {
    port: Number(env.PORT ?? 4000),
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    legacyExamplesEnabled: env.NODE_ENV === 'development' && env.ENABLE_LEGACY_EXAMPLES === 'true' && !cloudExecution,
    cassettes: {
      storageMode: env.CASSETTE_STORAGE_MODE ?? 'disabled',
      localMemoryAllowed: env.NODE_ENV === 'development' && !cloudExecution,
      region: env.AWS_REGION ?? 'us-east-1',
      userPoolId: env.COGNITO_USER_POOL_ID,
      clientId: env.COGNITO_USER_POOL_CLIENT_ID,
      tableName: env.CASSETTES_TABLE,
      cursorSecret: env.CASSETTE_CURSOR_SECRET,
    },
    aws: {
      region: env.AWS_REGION ?? 'us-east-1',
      itemsTable: env.ITEMS_TABLE || undefined,
      uploadsBucket: env.UPLOADS_BUCKET || undefined,
    },
    jamendo: {
      clientId: env.JAMENDO_CLIENT_ID || (isLocal ? localJamendoTestClientId : undefined),
      apiUrl: env.JAMENDO_API_URL ?? 'https://api.jamendo.com/v3.0',
    },
  } as const;
}

export const config = readConfig(process.env);
export type CassettesSettings = ReturnType<typeof readConfig>['cassettes'];
