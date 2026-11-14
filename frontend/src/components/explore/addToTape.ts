// Rules for adding a public song from Explore onto one of your tapes.

import { CASSETTE_LIMITS, type Cassette, type PublicSong, type TapeSide, type Track } from '@runman/shared';
import { SIDE_CAPACITY_SEC } from '@/components/cassette/constants';

export type TapeFit =
  | { ok: true; remainingSec: number }
  | { ok: false; reason: 'duplicate' | 'full' | 'limit'; remainingSec: number };

export function remainingOnSide(cassette: Cassette, side: TapeSide): number {
  const used = cassette.tracks.filter((t) => t.side === side).reduce((sum, t) => sum + t.durationSec, 0);
  return Math.max(0, SIDE_CAPACITY_SEC - used);
}

export function isOnTape(cassette: Cassette, song: PublicSong): boolean {
  return cassette.tracks.some((t) => song.provider === 'jamendo' ? t.source === 'library' && t.sourceId === song.sourceId : t.source === 'community' && t.sourceId === song.id);
}

/** Like a real C60: a song only goes on a side with enough tape left. */
export function tapeFit(cassette: Cassette, side: TapeSide, song: PublicSong): TapeFit {
  const remainingSec = remainingOnSide(cassette, side);
  if (isOnTape(cassette, song)) return { ok: false, reason: 'duplicate', remainingSec };
  if (cassette.tracks.length >= CASSETTE_LIMITS.tracksPerCassette) return { ok: false, reason: 'limit', remainingSec };
  if (song.durationSec > remainingSec) return { ok: false, reason: 'full', remainingSec };
  return { ok: true, remainingSec };
}

export function trackFromPublicSong(song: PublicSong, side: TapeSide, id: string, audioUrl = `/api/explore/songs/${encodeURIComponent(song.id)}/audio`): Track {
  return {
    id,
    sourceId: song.provider === 'jamendo' ? song.sourceId : song.id,
    title: song.title,
    artist: song.artist,
    durationSec: song.durationSec,
    side,
    source: song.provider === 'jamendo' ? 'library' : 'community',
    // A stable API URL (never an expiring S3 link), so it stays playable after saving.
    audioUrl: song.hasAudio ? audioUrl : undefined,
    artworkUrl: song.artworkUrl,
    ...(song.licenseUrl ? { licenseUrl: song.licenseUrl } : {}),
  };
}
