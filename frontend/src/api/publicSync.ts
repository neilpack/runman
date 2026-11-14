// Pushes a cassette's public/private choice to Explore when the listener leaves the editor.
//
// Visibility belongs to the whole tape: a public tape shares every track on it (uploads and
// recordings included), a private tape shares nothing. The editor saves every change locally as it
// happens (see hooks/useCassettes.ts); publishing is different, so the editor takes a snapshot when
// it opens and calls syncPublicContent() once, on exit, with the before/after states.
//
// Server side: PUT/DELETE /api/explore/mine/... (shared/src/explorePublishing.ts). The Explore
// profile goes first because a tape needs its owner's username.

import { cassetteToSaveRequest, type Cassette, type PublishProfileRequest, type Visibility } from '@runman/shared';
import type { PublishApi } from './publishClient';

/** Missing visibility means private (everything saved before the field existed). */
export const visibilityOf = (item: { visibility?: Visibility }): Visibility => item.visibility ?? 'private';

/** The tape's public/private state at one moment (when the editor opened). */
export interface VisibilitySnapshot {
  cassette: Visibility;
}

export function snapshotVisibility(c: Cassette): VisibilitySnapshot {
  return { cassette: visibilityOf(c) };
}

export interface PublicSyncDependencies {
  publish: Pick<PublishApi, 'publishProfile' | 'publishTape' | 'unpublishTape'>;
  /** The Explore profile to publish, or null until the listener picks a username. */
  profile(): Omit<PublishProfileRequest, 'ifPublished'> | null;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createPublicSync(deps: PublicSyncDependencies) {
  /**
   * Publishes the tape if it is public (re-sent on every exit so edits show up), or takes it down
   * if it was public when the editor opened. Resolves with error messages; the local copy is
   * already saved either way.
   */
  async function sync(before: VisibilitySnapshot, after: Cassette): Promise<string[]> {
    if (visibilityOf(after) !== 'public') {
      if (before.cassette !== 'public') return [];
      try { await deps.publish.unpublishTape(after.id); return []; } catch (error) { return [message(error)]; }
    }
    const profile = deps.profile();
    if (!profile) return ['Pick a username on your Account page before sharing on Explore.'];
    const converted = cassetteToSaveRequest(after, 0);
    if (!converted.ok) return [`This tape can't be shared yet: ${converted.issues[0]?.message ?? 'invalid tape'}`];
    try {
      await deps.publish.publishProfile(profile);
      await deps.publish.publishTape(converted.value.cassette);
      return [];
    } catch (error) {
      return [message(error)];
    }
  }

  /** A deleted tape disappears from Explore if it was public. */
  async function remove(cassetteId: string, live: VisibilitySnapshot): Promise<string[]> {
    if (live.cassette !== 'public') return [];
    try { await deps.publish.unpublishTape(cassetteId); return []; } catch (error) { return [message(error)]; }
  }

  return { sync, remove };
}

// ---------------------------------------------------------------------------
// App wiring (loaded lazily so the core above stays free of Amplify for tests)
// ---------------------------------------------------------------------------

let app: Promise<ReturnType<typeof createPublicSync>> | undefined;
function appSync() {
  app ??= Promise.all([import('./client'), import('@/profile/account')]).then(([{ api }, { accountStore }]) => createPublicSync({
    publish: api.publish,
    profile() {
      const profile = accountStore.getSnapshot().profile;
      return profile?.hasUsername ? { username: profile.username, avatar: profile.avatar, favoriteTape: profile.favoriteTape } : null;
    },
  }));
  return app;
}

function report(errors: string[]) {
  for (const error of errors) console.error('[publicSync] Explore sync failed:', error);
}

export async function syncPublicContent(before: VisibilitySnapshot, after: Cassette): Promise<void> {
  report(await (await appSync()).sync(before, after));
}

export async function removePublicContent(cassetteId: string, live: VisibilitySnapshot): Promise<void> {
  report(await (await appSync()).remove(cassetteId, live));
}
