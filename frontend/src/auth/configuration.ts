import type { ResourcesConfig } from 'aws-amplify';

export type AuthSetup =
  | { ready: true }
  | { ready: false; reason: 'missing' | 'invalid' | 'configuration-failed' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCognitoConfig(raw: string): ResourcesConfig | null {
  const input: unknown = JSON.parse(raw);
  if (!isRecord(input)) return null;
  const allowedFields = ['region', 'userPoolId', 'userPoolClientId'];
  if (Object.keys(input).some((key) => !allowedFields.includes(key))) return null;
  const { region, userPoolId, userPoolClientId } = input;
  if (
    (region !== 'us-west-2' && region !== 'us-east-1') ||
    typeof userPoolId !== 'string' || !userPoolId.startsWith(`${region}_`) ||
    !/^[a-z0-9-]+_[a-zA-Z0-9]+$/.test(userPoolId) ||
    typeof userPoolClientId !== 'string' || !/^[a-zA-Z0-9]{1,128}$/.test(userPoolClientId)
  ) return null;

  // Explicit user-pool-only mapping: never pass arbitrary JSON to Amplify.
  // The SDK derives its region from userPoolId; region above guards lab scope.
  return {
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        loginWith: { email: true },
        signUpVerificationMethod: 'code',
        userAttributes: { email: { required: true } },
        passwordFormat: {
          minLength: 8,
          requireLowercase: true,
          requireUppercase: true,
          requireNumbers: true,
          requireSpecialCharacters: true,
        },
      },
    },
  };
}

// Initialize outside React; StrictMode and route changes must not reconfigure the SDK.
export function createAuthInitializer(configure: (resources: ResourcesConfig) => void) {
  let result: AuthSetup | undefined;
  return (raw: string | undefined): AuthSetup => {
    if (result) return result;
    if (raw === undefined) return (result = { ready: false, reason: 'missing' });
    let resources: ResourcesConfig | null;
    try {
      resources = parseCognitoConfig(raw);
    } catch {
      return (result = { ready: false, reason: 'invalid' });
    }
    if (!resources) return (result = { ready: false, reason: 'invalid' });
    try {
      configure(resources);
      return (result = { ready: true });
    } catch {
      return (result = { ready: false, reason: 'configuration-failed' });
    }
  };
}
