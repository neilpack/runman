// Preset cassette looks the welcome page cycles through, plus the stickers that fly across the screen.

import type { StickerKind } from '@runman/shared';
import type { SidedCassette } from '@/components/cassette/sides';

type StickerSpec = [kind: StickerKind, x: number, y: number, rotation: number, scale: number, color: string];

function stickers(prefix: string, specs: StickerSpec[]) {
  return specs.map(([kind, x, y, rotation, scale, color], i) => ({
    id: `${prefix}-${i}`,
    kind,
    x,
    y,
    rotation,
    scale,
    color,
  }));
}

/** One per 5-second beat. Each has its own shell colour, label, pen and sticker layout on both sides. */
export const RETRO_LOOKS: SidedCassette[] = [
  {
    name: "Mixtape '85",
    shellColor: '#ff2e88',
    labelColor: '#fff6ea',
    inkColor: '#7a1f3d',
    shellType: 'retro',
    penStyle: 'marker',
    stickers: stickers('a', [
      ['star', 12, 16, -14, 0.9, '#e8c931'],
      ['bolt', 88, 70, 18, 1, '#13e0c4'],
      ['heart', 84, 18, 12, 0.75, '#ef4444'],
    ]),
    sideB: { stickers: stickers('ab', [['disc', 50, 24, 0, 0.9, '#ff2e88']]) },
  },
  {
    name: 'Neon Nights',
    shellColor: '#13e0c4',
    labelColor: '#1f1f23',
    inkColor: '#ffffff',
    shellType: 'clear',
    penStyle: 'script',
    stickers: stickers('b', [
      ['sparkle', 14, 72, -8, 0.95, '#ff2e88'],
      ['disc', 86, 16, 0, 0.85, '#a855f7'],
      ['sparkle', 90, 62, 22, 0.55, '#e8c931'],
    ]),
    sideB: { stickers: stickers('bb', [['star', 20, 20, 10, 0.9, '#13e0c4']]) },
  },
  {
    name: 'Totally Rad',
    shellColor: '#7b2cbf',
    labelColor: '#fde68a',
    inkColor: '#1d4ed8',
    shellType: 'solid',
    penStyle: 'handwritten',
    stickers: stickers('c', [
      ['smiley', 13, 18, -18, 1, '#e8c931'],
      ['note', 87, 22, 14, 0.85, '#13e0c4'],
      ['flower', 85, 72, -6, 0.8, '#ff2e88'],
    ]),
    sideB: { stickers: stickers('cb', [['smiley', 80, 22, 12, 0.9, '#f07a1a']]) },
  },
  {
    name: 'Synth City',
    shellColor: '#1c1c1f',
    labelColor: '#fecdd3',
    inkColor: '#b91c1c',
    shellType: 'retro',
    penStyle: 'typewriter',
    stickers: stickers('d', [
      ['bolt', 11, 22, -20, 1, '#e8c931'],
      ['star', 88, 18, 16, 0.8, '#ff2e88'],
      ['star', 14, 74, -4, 0.55, '#13e0c4'],
      ['disc', 88, 74, 0, 0.7, '#f07a1a'],
    ]),
    sideB: { stickers: stickers('db', [['bolt', 50, 22, 8, 0.9, '#ff2e88']]) },
  },
  {
    name: "Summer '84",
    shellColor: '#f07a1a',
    labelColor: '#bae6fd',
    inkColor: '#1f2937',
    shellType: 'solid',
    penStyle: 'marker',
    stickers: stickers('e', [
      ['flower', 13, 20, 10, 0.95, '#ec4899'],
      ['heart', 86, 70, -12, 0.85, '#ef4444'],
      ['sparkle', 86, 18, 0, 0.7, '#ffffff'],
    ]),
    sideB: { stickers: stickers('eb', [['flower', 22, 22, -10, 0.9, '#e8c931']]) },
  },
  {
    name: 'Rewind!',
    shellColor: '#1688c4',
    labelColor: '#d9f99d',
    inkColor: '#047857',
    shellType: 'clear',
    penStyle: 'clean',
    stickers: stickers('f', [
      ['note', 12, 70, -16, 0.95, '#ff2e88'],
      ['star', 87, 20, 20, 0.9, '#e8c931'],
      ['smiley', 14, 18, 8, 0.6, '#13e0c4'],
    ]),
    sideB: { stickers: stickers('fb', [['note', 78, 24, 14, 0.9, '#13e0c4']]) },
  },
];

export type FlyingSticker =
  | { type: 'icon'; kind: StickerKind; color: string }
  | { type: 'text'; text: string; color: string };

/** Stickers that drift across the screen left to right. Timing is derived from the index in the stage. */
export const FLYING_STICKERS: FlyingSticker[] = [
  { type: 'icon', kind: 'star', color: '#e8c931' },
  { type: 'text', text: 'RAD!', color: '#ff2e88' },
  { type: 'icon', kind: 'heart', color: '#ef4444' },
  { type: 'icon', kind: 'bolt', color: '#13e0c4' },
  { type: 'text', text: 'PLAY ▶', color: '#13e0c4' },
  { type: 'icon', kind: 'disc', color: '#ff2e88' },
  { type: 'icon', kind: 'smiley', color: '#e8c931' },
  { type: 'text', text: 'HI-FI', color: '#f07a1a' },
  { type: 'icon', kind: 'note', color: '#a855f7' },
  { type: 'icon', kind: 'sparkle', color: '#ffffff' },
  { type: 'text', text: 'TUBULAR', color: '#e8c931' },
  { type: 'icon', kind: 'flower', color: '#ec4899' },
];
