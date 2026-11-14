// Cassette library store. Persists to localStorage for now so the UI works with no backend.
// When a cassettes API exists, swap the load/save functions for api client calls.

import { useSyncExternalStore } from 'react';
import type { Cassette } from '@runman/shared';
import { SHELL_COLORS } from '@/components/cassette/constants';

const STORAGE_KEY = 'runman.cassettes.v1';

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function makeCassette(partial: Partial<Cassette> = {}): Cassette {
  const now = new Date().toISOString();
  return {
    id: newId(),
    name: 'Untitled Mix',
    shellColor: SHELL_COLORS[Math.floor(Math.random() * SHELL_COLORS.length)],
    labelColor: '#fff6ea',
    inkColor: '#7a1f3d',
    shellType: 'solid',
    penStyle: 'handwritten',
    stickers: [],
    tracks: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

function seed(): Cassette[] {
  return [
    makeCassette({
      name: 'Be Mine',
      shellColor: '#f9c6d3',
      inkColor: '#7a1f3d',
      stickers: [{ id: newId(), kind: 'heart', x: 82, y: 22, rotation: 12, scale: 1, color: '#ef4444' }],
    }),
    makeCassette({ name: 'Road Trip', shellColor: '#f07a1a', labelColor: '#fde68a', penStyle: 'marker', inkColor: '#1f2937' }),
    makeCassette({ name: 'Late Night', shellColor: '#13e0c4', shellType: 'clear', penStyle: 'script', inkColor: '#1d4ed8' }),
    makeCassette({ name: 'Study Beats', shellColor: '#e8c931', shellType: 'retro', penStyle: 'typewriter', inkColor: '#1f2937' }),
  ];
}

function load(): Cassette[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Cassette[];
  } catch {
    /* fall through to seed */
  }
  return seed();
}

let cassettes: Cassette[] = load();
const listeners = new Set<() => void>();

function commit(next: Cassette[]) {
  cassettes = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage full / private mode: keep in memory */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const cassetteStore = {
  getAll: () => cassettes,
  get: (id: string) => cassettes.find((c) => c.id === id),
  create(partial?: Partial<Cassette>): Cassette {
    const c = makeCassette(partial);
    commit([...cassettes, c]);
    return c;
  },
  update(id: string, patch: Partial<Cassette> | ((c: Cassette) => Partial<Cassette>)) {
    commit(
      cassettes.map((c) =>
        c.id === id
          ? { ...c, ...(typeof patch === 'function' ? patch(c) : patch), updatedAt: new Date().toISOString() }
          : c,
      ),
    );
  },
  /**
   * Put the library in the user's own order. `ids` lists tapes in their new order; any tape it
   * leaves out keeps its place after them. Reordering isn't an edit, so updatedAt is untouched.
   */
  reorder(ids: string[]) {
    const byId = new Map(cassettes.map((c) => [c.id, c]));
    const listed = ids.map((id) => byId.get(id)).filter((c): c is Cassette => Boolean(c));
    const rest = cassettes.filter((c) => !ids.includes(c.id));
    commit([...listed, ...rest]);
  },
  remove(id: string) {
    commit(cassettes.filter((c) => c.id !== id));
  },
};

export function useCassettes(): Cassette[] {
  return useSyncExternalStore(subscribe, cassetteStore.getAll);
}

export function useCassette(id: string | undefined): Cassette | undefined {
  const all = useCassettes();
  return id ? all.find((c) => c.id === id) : undefined;
}
