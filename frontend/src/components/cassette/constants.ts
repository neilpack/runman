// Look-and-feel options for cassettes: palettes, fonts, stickers, tape length.

import type { PenStyle, ShellType, StickerKind } from '@runman/shared';

export const SHELL_COLORS = [
  '#f9c6d3', '#2b2a5c', '#174a3a', '#a4a1bf', '#7a3d14', '#14857a',
  '#a3195b', '#a68a12', '#1688c4', '#4f8a14', '#1c1c1f', '#4a5266',
  '#e8402f', '#f07a1a', '#13e0c4', '#e8c931',
];

export const LABEL_COLORS = ['#fff6ea', '#ffffff', '#fde68a', '#fecdd3', '#bae6fd', '#d9f99d', '#e9d5ff', '#1f1f23'];

export const INK_COLORS = ['#7a1f3d', '#1f2937', '#1d4ed8', '#b91c1c', '#047857', '#ffffff'];

/** `charWidth` = average glyph width in em, used to shrink long names so they fit the label. */
export const PEN_STYLES: { id: PenStyle; label: string; font: string; charWidth: number }[] = [
  { id: 'handwritten', label: 'Handwritten', font: "'Caveat', cursive", charWidth: 0.46 },
  { id: 'marker', label: 'Marker', font: "'Permanent Marker', cursive", charWidth: 0.66 },
  { id: 'script', label: 'Script', font: "'Pacifico', cursive", charWidth: 0.64 },
  { id: 'typewriter', label: 'Typewriter', font: "'Special Elite', 'Courier New', monospace", charWidth: 0.62 },
  { id: 'clean', label: 'Clean', font: "'Inter', system-ui, sans-serif", charWidth: 0.56 },
];

export function penFont(style: PenStyle): string {
  return PEN_STYLES.find((p) => p.id === style)?.font ?? PEN_STYLES[0].font;
}

/** Font size (in face em units) that keeps a name inside the label. */
export function fitNameSize(name: string, style: PenStyle): number {
  const cw = PEN_STYLES.find((p) => p.id === style)?.charWidth ?? 0.55;
  const LABEL_TEXT_WIDTH = 68; // em, label width minus padding
  return Math.max(3.4, Math.min(9, LABEL_TEXT_WIDTH / (Math.max(1, name.length) * cw)));
}

export const SHELL_TYPES: { id: ShellType; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'clear', label: 'Clear' },
  { id: 'retro', label: 'Retro' },
];

export const STICKER_KINDS: StickerKind[] = ['heart', 'star', 'note', 'smiley', 'bolt', 'disc', 'flower', 'sparkle'];

export const STICKER_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#ffffff', '#111827'];

/** C60 tape: 30 minutes per side. */
export const SIDE_CAPACITY_SEC = 30 * 60;
