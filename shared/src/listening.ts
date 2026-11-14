/** Authenticated analytics; clients send selectors and elapsed listening, never counters/metadata. */
export type ListeningSelector = { provider: 'jamendo' | 'explore' | 'media'; id: string };
export interface StartListeningRequest { playId: string; song: ListeningSelector }
export interface StartListeningResponse { eligible: boolean }
export interface ListeningProgressRequest { playId: string; listenedMs: number }
export interface ListeningProgressResponse { counted: boolean; listenedMs: number }
export const LISTENING_THRESHOLD_MS = 30_000;
export const LISTENING_MAX_MS = 6 * 3600 * 1000;
export function validPlayId(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
export function validListeningSelector(value: unknown): value is ListeningSelector {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== 'id,provider' || typeof row.id !== 'string') return false;
  return row.provider === 'jamendo' ? /^[1-9]\d{0,19}$/.test(row.id) : row.provider === 'explore' ? /^[A-Za-z0-9_-]{1,128}$/.test(row.id) : row.provider === 'media' && validPlayId(row.id);
}
