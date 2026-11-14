// Pushes a cassette's public/private choices to AWS when the listener leaves the editor.
//
// The editor saves every change locally as it happens (see hooks/useCassettes.ts). Visibility is
// different: going public means uploading to the shared catalog, so the editor takes a snapshot
// when it opens and calls syncPublicContent() once, on exit, with the before/after states.
//
// Nothing is sent to AWS yet. Each TODO(aws) below marks where the real call goes.

import type { Cassette, Track, Visibility } from '@runman/shared';

/** Missing visibility means private (everything saved before the field existed). */
export const visibilityOf = (item: { visibility?: Visibility }): Visibility => item.visibility ?? 'private';

/** Songs the listener supplied themselves. Only these get a public/private choice. */
export const isOwnAudio = (t: Track) => t.source === 'upload' || t.source === 'recording';

/** The public/private state of a cassette and its own-audio songs at one moment. */
export interface VisibilitySnapshot {
  cassette: Visibility;
  /** Track id → visibility, for own-audio tracks only. */
  songs: Map<string, Visibility>;
}

export function snapshotVisibility(c: Cassette): VisibilitySnapshot {
  return {
    cassette: visibilityOf(c),
    songs: new Map(c.tracks.filter(isOwnAudio).map((t) => [t.id, visibilityOf(t)])),
  };
}

/**
 * Upload whatever is public, and take down whatever stopped being public, since `before`.
 * A public cassette is re-sent on every exit so edits made while it was public show up too.
 */
export async function syncPublicContent(before: VisibilitySnapshot, after: Cassette): Promise<void> {
  const jobs: Promise<void>[] = [];

  // ---- The cassette ----
  if (visibilityOf(after) === 'public') {
    jobs.push(publishCassette(after));
  } else if (before.cassette === 'public') {
    jobs.push(unpublishCassette(after.id));
  }

  // ---- Uploaded songs ----
  const ownTracks = after.tracks.filter(isOwnAudio);
  for (const t of ownTracks) {
    if (visibilityOf(t) === 'public') {
      if (before.songs.get(t.id) !== 'public') jobs.push(publishSong(after, t));
    } else if (before.songs.get(t.id) === 'public') {
      jobs.push(unpublishSong(t.id));
    }
  }
  // Public songs removed from the tape while the editor was open come down too.
  const stillOnTape = new Set(ownTracks.map((t) => t.id));
  for (const [trackId, v] of before.songs) {
    if (v === 'public' && !stillOnTape.has(trackId)) jobs.push(unpublishSong(trackId));
  }

  // One failure shouldn't stop the rest; the local copy is already saved either way.
  const results = await Promise.allSettled(jobs);
  for (const r of results) {
    if (r.status === 'rejected') console.error('[publicSync] AWS sync failed', r.reason);
  }
}

/**
 * A deleted tape (and any public songs on it) should disappear from the public catalog.
 * `live` is what was last synced, i.e. the snapshot taken when the editor opened.
 */
export async function removePublicContent(cassetteId: string, live: VisibilitySnapshot): Promise<void> {
  const jobs: Promise<void>[] = [];
  if (live.cassette === 'public') jobs.push(unpublishCassette(cassetteId));
  for (const [trackId, v] of live.songs) {
    if (v === 'public') jobs.push(unpublishSong(trackId));
  }
  await Promise.allSettled(jobs);
}

// ---------------------------------------------------------------------------
// AWS calls (not hooked up yet)
// ---------------------------------------------------------------------------

async function publishCassette(c: Cassette): Promise<void> {
  // TODO(aws): upload the public cassette so anyone can view it and add it to their library.
  // Suggested shape: add `PUT /api/explore/cassettes/:id` to shared/src/index.ts → backend route →
  // service writing JSON to the uploads S3 bucket (like exploreService does for public songs).
  // Send the tape's look plus its track list. Uploaded songs that are still private must NOT
  // leak: strip their audioReference (or drop them) and only include ones marked public.
  logStub('publish cassette', c.id, c.name);
}

async function unpublishCassette(cassetteId: string): Promise<void> {
  // TODO(aws): `DELETE /api/explore/cassettes/:id` — remove it from the public catalog.
  logStub('unpublish cassette', cassetteId);
}

async function publishSong(c: Cassette, t: Track): Promise<void> {
  // TODO(aws): make this uploaded song a PublicSong on Explore (see PublicSong in shared).
  // The audio is already in S3 at t.audioReference.objectKey (private, per-user); the backend
  // should copy or expose it under the public prefix and write the song's metadata
  // (title, artist, durationSec, uploader) so GET /api/explore/songs lists it.
  logStub('publish song', t.id, `${t.title} (on "${c.name}")`);
}

async function unpublishSong(trackId: string): Promise<void> {
  // TODO(aws): remove the song from the public catalog (the private upload stays).
  logStub('unpublish song', trackId);
}

function logStub(action: string, id: string, detail?: string) {
  if (import.meta.env.DEV) console.info(`[publicSync] would ${action}: ${id}${detail ? ` · ${detail}` : ''}`);
}
