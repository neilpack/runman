import type { Track } from '@runman/shared';

export interface PlaybackUrl {
  url: string;
  expiresAt?: number;
}

export type PlaybackUrlResolver = (cassetteId: string, track: Track, signal: AbortSignal) => Promise<PlaybackUrl>;

// Use explicit fields so equivalent references have the same key regardless of
// JSON property order. Replacement audio under an existing track ID is distinct.
function keyFor(cassetteId: string, track: Track): string {
  const reference = track.audioReference;
  return JSON.stringify([cassetteId, track.id, track.audioUrl ?? null,
    reference ? [reference.source, reference.objectKey, reference.contentType, reference.sizeBytes] : null]);
}

/** In-memory URLs only; ownership changes and unloading must call invalidate. */
export function createPlaybackController(resolveUrl: PlaybackUrlResolver, now: () => number = Date.now) {
  let generation = 0;
  let selectedKey: string | null = null;
  let pending: AbortController | undefined;
  let cached: { key: string; value: PlaybackUrl } | undefined;

  return {
    isCurrent(cassetteId: string, track: Track): boolean {
      return selectedKey === keyFor(cassetteId, track);
    },
    cancelPending(): void {
      ++generation;
      pending?.abort();
      pending = undefined;
    },
    invalidate(): void {
      ++generation;
      selectedKey = null;
      cached = undefined;
      pending?.abort();
      pending = undefined;
    },
    async resolve(cassetteId: string, track: Track, options: { force?: boolean } = {}): Promise<PlaybackUrl | null> {
      const ticket = ++generation;
      pending?.abort();
      pending = undefined;
      const key = keyFor(cassetteId, track);
      selectedKey = key;
      if (!options.force && cached?.key === key &&
        (cached.value.expiresAt === undefined || cached.value.expiresAt - now() > 15_000)) {
        return { ...cached.value };
      }
      // A failed forced renewal must not leave its broken URL available to retry.
      cached = undefined;
      const controller = new AbortController();
      pending = controller;
      try {
        const value = await resolveUrl(cassetteId, track, controller.signal);
        if (ticket !== generation || controller.signal.aborted) return null;
        cached = { key, value: { ...value } };
        return { ...value };
      } catch (error) {
        if (ticket !== generation || controller.signal.aborted) return null;
        throw error;
      } finally {
        if (pending === controller) pending = undefined;
      }
    },
  };
}
