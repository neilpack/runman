export interface AuthOutputs extends Record<string, unknown> {
  version: string;
  auth: Record<string, unknown> & {
    aws_region: string;
    user_pool_id: string;
    user_pool_client_id: string;
  };
}

export type AuthSetup =
  | { ready: true }
  | { ready: false; reason: 'missing' | 'invalid' | 'configuration-failed' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOutputs(raw: string): AuthOutputs | null {
  const outputs: unknown = JSON.parse(raw);
  if (!isRecord(outputs) || !isRecord(outputs.auth)) return null;
  const { version, auth } = outputs;
  const { aws_region: region, user_pool_id: poolId, user_pool_client_id: clientId } = auth;
  if (
    typeof version !== 'string' || !/^1(?:\.\d+)?$/.test(version) ||
    typeof region !== 'string' || !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region) ||
    typeof poolId !== 'string' || !poolId.startsWith(`${region}_`) ||
    !/^[a-z0-9-]+_[a-zA-Z0-9]+$/.test(poolId) ||
    typeof clientId !== 'string' || !/^[a-zA-Z0-9]+$/.test(clientId)
  ) return null;

  return {
    ...outputs,
    version,
    auth: { ...auth, aws_region: region, user_pool_id: poolId, user_pool_client_id: clientId },
  };
}

// Initialize outside React; StrictMode and route changes must not reconfigure the SDK.
export function createAuthInitializer(configure: (outputs: AuthOutputs) => void) {
  let result: AuthSetup | undefined;
  return (raw: string | undefined): AuthSetup => {
    if (result) return result;
    if (raw === undefined) return (result = { ready: false, reason: 'missing' });
    let outputs: AuthOutputs | null;
    try {
      outputs = parseOutputs(raw);
    } catch {
      return (result = { ready: false, reason: 'invalid' });
    }
    if (!outputs) return (result = { ready: false, reason: 'invalid' });
    try {
      configure(outputs);
      return (result = { ready: true });
    } catch {
      return (result = { ready: false, reason: 'configuration-failed' });
    }
  };
}
