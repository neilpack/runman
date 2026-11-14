// One shared <audio> for song previews on Explore, so starting a preview stops the last one.

import { useSyncExternalStore } from 'react';

export type PreviewStatus = 'idle' | 'loading' | 'playing' | 'error';

interface PreviewState {
  songId: string | null;
  status: PreviewStatus;
}

let audio: HTMLAudioElement | null = null;
let state: PreviewState = { songId: null, status: 'idle' };
const listeners = new Set<() => void>();

function set(next: PreviewState) {
  state = next;
  listeners.forEach((l) => l());
}

function element(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = 'none';
  a.addEventListener('playing', () => state.songId && set({ songId: state.songId, status: 'playing' }));
  a.addEventListener('waiting', () => state.songId && set({ songId: state.songId, status: 'loading' }));
  a.addEventListener('ended', () => set({ songId: null, status: 'idle' }));
  a.addEventListener('error', () => {
    // Clearing `src` in stop() can also raise this; only report real failures.
    if (state.songId && a.getAttribute('src')) set({ songId: state.songId, status: 'error' });
  });
  audio = a;
  return a;
}

export const previewPlayer = {
  /** Play `songId`, or pause it if it is the one already playing. */
  toggle(songId: string, url: string) {
    const a = element();
    if (state.songId === songId && (state.status === 'playing' || state.status === 'loading')) {
      previewPlayer.stop();
      return;
    }
    a.src = url;
    set({ songId, status: 'loading' });
    a.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return; // replaced by another preview
      if (state.songId === songId) set({ songId, status: 'error' });
    });
  },
  stop() {
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    if (state.songId !== null) set({ songId: null, status: 'idle' });
  },
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;

/** Preview status for one song ('idle' unless it is the current preview). */
export function usePreviewStatus(songId: string): PreviewStatus {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  return s.songId === songId ? s.status : 'idle';
}
