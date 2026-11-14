// Search, filter and sort for the tape library drawer. Pure functions, no React.

import type { Cassette, ShellType } from '@runman/shared';

export type TapeStatus = 'all' | 'has-songs' | 'blank' | 'in-deck';
/** 'custom' = the user's own drag-to-arrange order (the store's array order). */
export type TapeSort = 'custom' | 'recent' | 'newest' | 'name' | 'longest';
export type ColorFamily = 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink' | 'neutral';

export interface TapeFilter {
  query: string;
  status: TapeStatus;
  shellTypes: ShellType[];
  colors: ColorFamily[];
  sort: TapeSort;
}

export const DEFAULT_FILTER: TapeFilter = { query: '', status: 'all', shellTypes: [], colors: [], sort: 'custom' };

export const STATUS_OPTIONS: { id: TapeStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'has-songs', label: 'Has songs' },
  { id: 'blank', label: 'Blank' },
  { id: 'in-deck', label: 'In deck' },
];

export const SORT_OPTIONS: { id: TapeSort; label: string }[] = [
  { id: 'custom', label: 'My order' },
  { id: 'recent', label: 'Recently edited' },
  { id: 'newest', label: 'Newest first' },
  { id: 'name', label: 'Name A–Z' },
  { id: 'longest', label: 'Most songs' },
];

/** Swatch shown for each colour family in the filter. */
export const COLOR_FAMILIES: { id: ColorFamily; swatch: string }[] = [
  { id: 'red', swatch: '#e8402f' },
  { id: 'orange', swatch: '#f07a1a' },
  { id: 'yellow', swatch: '#e8c931' },
  { id: 'green', swatch: '#4f8a14' },
  { id: 'teal', swatch: '#14857a' },
  { id: 'blue', swatch: '#1688c4' },
  { id: 'purple', swatch: '#6d3fc0' },
  { id: 'pink', swatch: '#f9a8c8' },
  { id: 'neutral', swatch: '#8b8b94' },
];

/** Bucket a shell colour into a family by hue (greys/near-black/near-white are "neutral"). */
export function colorFamily(hex: string): ColorFamily {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 'neutral';
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.18 || l < 0.12 || l > 0.94) return 'neutral';
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 12 || h >= 345) return l > 0.75 ? 'pink' : 'red';
  if (h < 40) return 'orange';
  if (h < 68) return 'yellow';
  if (h < 150) return 'green';
  if (h < 195) return 'teal';
  if (h < 255) return 'blue';
  if (h < 290) return 'purple';
  return 'pink';
}

/** Every word of the query must appear in the tape name or one of its songs/artists. */
function matchesQuery(c: Cassette, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [c.name, ...c.tracks.flatMap((t) => [t.title, t.artist])].join(' ').toLowerCase();
  return words.every((w) => haystack.includes(w));
}

export function filterTapes(tapes: Cassette[], f: TapeFilter, loadedId: string | null): Cassette[] {
  const result = tapes.filter((c) => {
    if (!matchesQuery(c, f.query)) return false;
    if (f.status === 'has-songs' && c.tracks.length === 0) return false;
    if (f.status === 'blank' && c.tracks.length > 0) return false;
    if (f.status === 'in-deck' && c.id !== loadedId) return false;
    if (f.shellTypes.length && !f.shellTypes.includes(c.shellType)) return false;
    if (f.colors.length && !f.colors.includes(colorFamily(c.shellColor))) return false;
    return true;
  });
  const byName = (a: Cassette, b: Cassette) => (a.name || 'Untitled').localeCompare(b.name || 'Untitled');
  switch (f.sort) {
    case 'name':
      return result.sort(byName);
    case 'newest':
      return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case 'longest':
      return result.sort((a, b) => b.tracks.length - a.tracks.length || byName(a, b));
    case 'recent':
      return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    case 'custom':
    default:
      return result; // filter() keeps the store's order, which is the user's arrangement.
  }
}

/** How many filters (not counting search or sort) are switched on, for the badge. */
export function activeFilterCount(f: TapeFilter): number {
  return (f.status !== 'all' ? 1 : 0) + f.shellTypes.length + f.colors.length;
}

export function isFiltering(f: TapeFilter): boolean {
  return f.query.trim() !== '' || activeFilterCount(f) > 0;
}
