// Sample Explore catalog, served only in local dev when no UPLOADS_BUCKET is configured
// (see exploreService.ts). Made-up listeners and songs; none of them have audio.

import type { PublicProfile, Sticker, TapeSnapshot } from '@runman/shared';
import type { SongRecord } from './exploreService.js';

const sticker = (id: string, kind: string, x: number, y: number, rotation: number, color: string, scale = 1): Sticker => ({
  id, kind, x, y, rotation, scale, color,
});

const tape = (t: Omit<TapeSnapshot, 'updatedAt' | 'sideB'> & Pick<TapeSnapshot, 'sideB'>): TapeSnapshot => ({
  updatedAt: '2026-11-01T12:00:00.000Z',
  ...t,
});

const USERS = {
  mo: { userId: 'demo-midnight-mo', username: 'midnight.mo' },
  june: { userId: 'demo-juniper', username: 'juniper_beats' },
  lou: { userId: 'demo-lofi-lou', username: 'lofi-lou' },
  rae: { userId: 'demo-riverside-rae', username: 'riverside.rae' },
  kid: { userId: 'demo-cassette-kid', username: 'cassettekid' },
  tess: { userId: 'demo-tapehead-tess', username: 'tapehead' },
} as const;

export function demoProfiles(): PublicProfile[] {
  return [
    {
      ...USERS.mo,
      avatar: null,
      favoriteTape: tape({
        id: 'demo-tape-mo', name: 'Night Drive', shellColor: '#1f1f23', labelColor: '#fde68a', inkColor: '#1d4ed8',
        shellType: 'solid', penStyle: 'marker', trackCount: 11,
        stickers: [sticker('s1', 'star', 84, 20, 14, '#f59e0b'), sticker('s2', 'sparkle', 14, 26, -10, '#ffffff', 0.8)],
        sideB: { labelColor: '#1f1f23', inkColor: '#ffffff', stickers: [sticker('s3', 'bolt', 80, 24, 8, '#f59e0b')] },
      }),
    },
    {
      ...USERS.june,
      avatar: null,
      favoriteTape: tape({
        id: 'demo-tape-june', name: 'Greenhouse', shellColor: '#13e0c4', labelColor: '#d9f99d', inkColor: '#047857',
        shellType: 'clear', penStyle: 'script', trackCount: 8,
        stickers: [sticker('s1', 'flower', 82, 22, 0, '#ec4899'), sticker('s2', 'flower', 16, 70, 20, '#f59e0b', 0.7)],
      }),
    },
    {
      ...USERS.lou,
      avatar: null,
      favoriteTape: tape({
        id: 'demo-tape-lou', name: 'Study Hall', shellColor: '#e8c931', labelColor: '#fff6ea', inkColor: '#1f2937',
        shellType: 'retro', penStyle: 'typewriter', trackCount: 14,
        stickers: [sticker('s1', 'note', 85, 22, 10, '#3b82f6')],
      }),
    },
    {
      ...USERS.rae,
      avatar: null,
      favoriteTape: tape({
        id: 'demo-tape-rae', name: 'Porch Songs', shellColor: '#f07a1a', labelColor: '#fff6ea', inkColor: '#7a1f3d',
        shellType: 'solid', penStyle: 'handwritten', trackCount: 9,
        stickers: [sticker('s1', 'heart', 83, 20, 12, '#ef4444'), sticker('s2', 'smiley', 14, 24, -8, '#f59e0b', 0.8)],
      }),
    },
    {
      ...USERS.kid,
      avatar: null,
      favoriteTape: tape({
        id: 'demo-tape-kid', name: 'Be Mine', shellColor: '#f9c6d3', labelColor: '#ffffff', inkColor: '#b91c1c',
        shellType: 'clear', penStyle: 'handwritten', trackCount: 6,
        stickers: [sticker('s1', 'heart', 82, 22, 12, '#ef4444'), sticker('s2', 'heart', 90, 64, -14, '#ec4899', 0.6)],
      }),
    },
    // No tape on display yet: exercises the empty state on a listener page.
    { ...USERS.tess, avatar: null, favoriteTape: null },
  ];
}

type DemoSong = Omit<SongRecord, 'uploaderId' | 'uploaderUsername' | 'publishedAt'> & {
  by: keyof typeof USERS;
  daysAgo: number;
};

const SONGS: DemoSong[] = [
  { id: 'demo-neon-rain', title: 'Neon Rain', artist: 'Mo & the Moths', durationSec: 214, by: 'mo', addCount: 41, daysAgo: 2 },
  { id: 'demo-exit-14', title: 'Exit 14', artist: 'Mo & the Moths', durationSec: 187, by: 'mo', addCount: 12, daysAgo: 9 },
  { id: 'demo-sodium-lights', title: 'Sodium Lights', artist: 'Mo & the Moths', durationSec: 251, by: 'mo', addCount: 3, daysAgo: 30 },
  { id: 'demo-fern-gully', title: 'Fern Gully Groove', artist: 'Juniper', durationSec: 198, by: 'june', addCount: 27, daysAgo: 1 },
  { id: 'demo-terrarium', title: 'Terrarium', artist: 'Juniper', durationSec: 166, by: 'june', addCount: 9, daysAgo: 6 },
  { id: 'demo-pencil-taps', title: 'Pencil Taps', artist: 'Lofi Lou', durationSec: 143, by: 'lou', addCount: 58, daysAgo: 12 },
  { id: 'demo-quiet-floor', title: 'Quiet Floor (Library Mix)', artist: 'Lofi Lou', durationSec: 312, by: 'lou', addCount: 19, daysAgo: 3 },
  { id: 'demo-chai-latte', title: 'Chai Latte, 2 A.M.', artist: 'Lofi Lou', durationSec: 128, by: 'lou', addCount: 6, daysAgo: 20 },
  { id: 'demo-screen-door', title: 'Screen Door Summer', artist: 'Rae Rivers', durationSec: 205, by: 'rae', addCount: 33, daysAgo: 4 },
  { id: 'demo-gravel-road', title: 'Gravel Road Waltz', artist: 'Rae Rivers', durationSec: 232, by: 'rae', addCount: 2, daysAgo: 45 },
  { id: 'demo-mixtape-for-you', title: 'Mixtape for You', artist: 'The Cassette Kid', durationSec: 176, by: 'kid', addCount: 15, daysAgo: 0 },
  { id: 'demo-rewind', title: 'Rewind (Pencil in the Spool)', artist: 'The Cassette Kid', durationSec: 159, by: 'kid', addCount: 4, daysAgo: 15 },
  { id: 'demo-cafe-noir', title: 'Café Noir', artist: 'Tess & Tape', durationSec: 221, by: 'tess', addCount: 7, daysAgo: 5 },
];

/** Dates are relative to `now`, so trending stays interesting whenever you run it. */
export function demoSongs(now: Date): SongRecord[] {
  return SONGS.map(({ by, daysAgo, ...song }) => ({
    ...song,
    uploaderId: USERS[by].userId,
    uploaderUsername: USERS[by].username,
    publishedAt: new Date(now.getTime() - daysAgo * 86_400_000 - 3_600_000).toISOString(),
  }));
}
