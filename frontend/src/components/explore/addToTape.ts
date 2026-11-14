// Rules for adding a public song from Explore onto one of your tapes.

import type { Cassette, PublicSong, TapeSide, Track } from '@runman/shared';
import { api } from '@/api/client';
import { SIDE_CAPACITY_SEC } from '@/components/cassette/constants';

export type TapeFit =
  | { ok: true; remainingSec: number }
  | { ok: false; reason: 'duplicate' | 'full'; remainingSec: number };

export function remainingOnSide(cassette: Cassette, side: TapeSide): number {
  const used = cassette.tracks.filter((t) => t.side === side).reduce((sum, t) => sum + t.durationSec, 0);
  return Math.max(0, SIDE_CAPACITY_SEC - used);
}

export function isOnTape(cassette: Cassette, song: PublicSong): boolean {
  return cassette.tracks.some((t) => t.source === 'community' && t.sourceId === song.id);
}

/** Like a real C60: a song only goes on a side with enough tape left. */
export function tapeFit(cassette: Cassette, side: TapeSide, song: PublicSong): TapeFit {
  const remainingSec = remainingOnSide(cassette, side);
  if (isOnTape(cassette, song)) return { ok: false, reason: 'duplicate', remainingSec };
  if (song.durationSec > remainingSec) return { ok: false, reason: 'full', remainingSec };
  return { ok: true, remainingSec };
}

export function trackFromPublicSong(song: PublicSong, side: TapeSide, id: string): Track {
  return {
    id,
    sourceId: song.id,
    title: song.title,
    artist: song.artist,
    durationSec: song.durationSec,
    side,
    source: 'community',
    // A stable API URL (never an expiring S3 link), so it stays playable after saving.
    audioUrl: song.hasAudio ? api.publicSongAudioUrl(song.id) : undefined,
    artworkUrl: song.artworkUrl,
  };
}
