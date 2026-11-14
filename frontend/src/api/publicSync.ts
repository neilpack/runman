// Pushes a cassette's public/private choices to Explore when the listener leaves the editor.
//
// The editor saves every change locally as it happens (see hooks/useCassettes.ts). Visibility is
// different: going public means publishing to the shared catalog, so the editor takes a snapshot
// when it opens and calls syncPublicContent() once, on exit, with the before/after states.
//
// Server side: PUT/DELETE /api/explore/mine/... (shared/src/explorePublishing.ts). The order matters:
// the Explore profile first (songs and tapes need a username), then songs, then the tape, because a
// tape only lists your uploads that are already published.

import { cassetteToSaveRequest, type Cassette, type PublishProfileRequest, type Track, type Visibility } from '@runman/shared';
import type { PublishApi } from './publishClient';

/** Missing visibility means private (everything saved before the field existed). */
export const visibilityOf = (item: { visibility?: Visibility }): Visibility => item.visibility ?? 'private';

/** Songs the listener supplied themselves. Only these get a public/private choice. */
export const isOwnAudio = (t: Track) => t.source === 'upload' || t.source === 'recording';

/** The public/private state of a cassette and its own-audio songs at one moment. */
export interface VisibilitySnapshot {
  cassette: Visibility;
  /** Track id → visibility, for own-audio tracks only. */
  songs: Map<string, Visibility>;
  /** Track id → uploaded audio object key (what identifies a published song). */
  audioKeys: Map<string, string>;
}

export function snapshotVisibility(c: Cassette): VisibilitySnapshot {
  const own = c.tracks.filter(isOwnAudio);
  return {
    cassette: visibilityOf(c),
    songs: new Map(own.map((t) => [t.id, visibilityOf(t)])),
    audioKeys: new Map(own.flatMap((t) => (t.audioReference ? [[t.id, t.audioReference.objectKey] as [string, string]] : []))),
  };
}

export interface PublicSyncDependencies {
  publish: Pick<PublishApi, 'publishProfile' | 'publishSong' | 'unpublishSong' | 'publishTape' | 'unpublishTape'>;
  /** The Explore profile to publish, or null until the listener picks a username. */
  profile(): Omit<PublishProfileRequest, 'ifPublished'> | null;
}

export function createPublicSync(deps: PublicSyncDependencies) {
  async function settle(jobs: Promise<unknown>[], errors: string[]) {
    for (const result of await Promise.allSettled(jobs)) {
      if (result.status === 'rejected') errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  /**
   * Publish whatever is public, and take down whatever stopped being public, since `before`.
   * A public cassette and its public songs are re-sent on every exit so edits show up too.
   * Resolves with the error messages; the local copy is already saved either way.
   */
  async function sync(before: VisibilitySnapshot, after: Cassette): Promise<string[]> {
    const errors: string[] = [];
    const publicSongs = after.tracks.filter((t) => isOwnAudio(t) && visibilityOf(t) === 'public');
    const stillPublicKeys = new Set(publicSongs.flatMap((t) => (t.audioReference ? [t.audioReference.objectKey] : [])));

    // Take down songs that were public when the editor opened and no longer are (made private or removed).
    const takeDown = new Set<string>();
    for (const [trackId, visibility] of before.songs) {
      const key = before.audioKeys.get(trackId);
      if (visibility === 'public' && key && !stillPublicKeys.has(key)) takeDown.add(key);
    }
    const removals: Promise<unknown>[] = [...takeDown].map((key) => deps.publish.unpublishSong(key));
    if (visibilityOf(after) !== 'public' && before.cassette === 'public') removals.push(deps.publish.unpublishTape(after.id));

    const wantsPublic = visibilityOf(after) === 'public' || publicSongs.length > 0;
    if (wantsPublic) {
      const profile = deps.profile();
      if (!profile) errors.push('Pick a username on your Account page before sharing on Explore.');
      else {
        try {
          await deps.publish.publishProfile(profile);
          const songs = publicSongs.flatMap((t) => {
            if (!t.audioReference) { errors.push(`"${t.title}" hasn't finished uploading, so it wasn't shared.`); return []; }
            return [deps.publish.publishSong({
              title: t.title, artist: t.artist, durationSec: t.durationSec, audio: t.audioReference,
              ...(t.artworkUrl ? { artworkUrl: t.artworkUrl } : {}),
            })];
          });
          await settle(songs, errors);
          if (visibilityOf(after) === 'public') {
            const converted = cassetteToSaveRequest(after, 0);
            if (!converted.ok) errors.push(`This tape can't be shared yet: ${converted.issues[0]?.message ?? 'invalid tape'}`);
            else await settle([deps.publish.publishTape(converted.value.cassette)], errors);
          }
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    }
    await settle(removals, errors);
    return errors;
  }

  /**
   * A deleted tape (and any public songs on it) should disappear from Explore.
   * `live` is what was last synced, i.e. the snapshot taken when the editor opened.
   */
  async function remove(cassetteId: string, live: VisibilitySnapshot): Promise<string[]> {
    const errors: string[] = [];
    const jobs: Promise<unknown>[] = [];
    if (live.cassette === 'public') jobs.push(deps.publish.unpublishTape(cassetteId));
    for (const [trackId, visibility] of live.songs) {
      const key = live.audioKeys.get(trackId);
      if (visibility === 'public' && key) jobs.push(deps.publish.unpublishSong(key));
    }
    await settle(jobs, errors);
    return errors;
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
