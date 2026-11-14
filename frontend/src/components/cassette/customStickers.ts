// Hand-drawn ("custom") stickers. Each tape keeps up to 5 drawings in `cassette.customStickers`;
// stickers placed on a side point at one with kind `custom-<id>` (see Sticker in @runman/shared).

import { CASSETTE_LIMITS, CUSTOM_STICKER_PREFIX, type CustomSticker, type StickerKind } from '@runman/shared';

/** Slots shown in the editor's "Custom stickers" tray. */
export const CUSTOM_SLOT_COUNT = CASSETTE_LIMITS.customStickers;

/** Most coordinates one drawing may hold (each point is two). */
export const CUSTOM_INK_BUDGET = CASSETTE_LIMITS.customStickerCoords;

/** Most strokes one drawing may hold. */
export const CUSTOM_STROKE_BUDGET = CASSETTE_LIMITS.customStickerStrokes;

export const customKind = (id: string): StickerKind => `${CUSTOM_STICKER_PREFIX}${id}`;

export const isCustomKind = (kind: StickerKind) => kind.startsWith(CUSTOM_STICKER_PREFIX);

/** The drawing a placed sticker points at, if it is a custom sticker and still exists. */
export function findCustomSticker(list: CustomSticker[] | undefined, kind: StickerKind): CustomSticker | undefined {
  if (!list || !isCustomKind(kind)) return undefined;
  const id = kind.slice(CUSTOM_STICKER_PREFIX.length);
  return list.find((art) => art.id === id);
}

/** Coordinates used by a drawing, for the ink meter. */
export const inkUsed = (art: Pick<CustomSticker, 'strokes'>) => art.strokes.reduce((n, s) => n + s.points.length, 0);

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Smooth SVG path through flat [x, y, …] points (midpoint quadratic curves). */
export function strokePath(points: number[]): string {
  const n = points.length / 2;
  if (n < 1) return '';
  const x = (i: number) => points[i * 2];
  const y = (i: number) => points[i * 2 + 1];
  // A lone point: a tiny segment so the round cap draws a dot.
  if (n === 1) return `M${x(0)} ${y(0)}l0.01 0`;
  if (n === 2) return `M${x(0)} ${y(0)}L${x(1)} ${y(1)}`;
  let d = `M${x(0)} ${y(0)}`;
  for (let i = 1; i < n - 1; i++) {
    d += `Q${x(i)} ${y(i)} ${r1((x(i) + x(i + 1)) / 2)} ${r1((y(i) + y(i + 1)) / 2)}`;
  }
  return `${d}L${x(n - 1)} ${y(n - 1)}`;
}

/** Ramer–Douglas–Peucker: drops points that barely change the line, so drawings stay small. */
export function simplifyPoints(points: number[], epsilon = 0.35): number[] {
  const n = points.length / 2;
  if (n <= 2) return points;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = points[a * 2], ay = points[a * 2 + 1];
    const dx = points[b * 2] - ax, dy = points[b * 2 + 1] - ay;
    const len = Math.hypot(dx, dy) || 1;
    let far = -1;
    let farDist = epsilon;
    for (let i = a + 1; i < b; i++) {
      const dist = Math.abs(dy * (points[i * 2] - ax) - dx * (points[i * 2 + 1] - ay)) / len;
      if (dist > farDist) { far = i; farDist = dist; }
    }
    if (far !== -1) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i * 2], points[i * 2 + 1]);
  return out;
}

/** Shortest distance from (px, py) to a stroke's centre line. */
export function distanceToStroke(points: number[], px: number, py: number): number {
  let best = Infinity;
  const n = points.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = points[i * 2], ay = points[i * 2 + 1];
    if (i === n - 1) { best = Math.min(best, Math.hypot(px - ax, py - ay)); break; }
    const bx = points[i * 2 + 2], by = points[i * 2 + 3];
    const dx = bx - ax, dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}
