// Adapter between the editor's song picker and the backend music API.

import type { MusicTrack } from '@runman/shared';
import { api } from './client';

export interface SongResult {
  id: string;
  title: string;
  artist: string;
  durationSec: number;
  licenseUrl?: string;
  audioUrl?: string;
  artworkUrl?: string;
}

export interface SongLibrary {
  /** false = show the "coming soon" state in the UI. */
  available: boolean;
  search(query: string, signal?: AbortSignal): Promise<SongResult[]>;
  recommend(signal?: AbortSignal): Promise<SongResult[]>;
}

const recommendationQueries = [
  'acoustic',
  'ambient',
  'chill',
  'electronic',
  'indie',
  'jazz',
  'rock',
  'soul',
];

function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function toSongResult(track: MusicTrack): SongResult {
  return {
    id: track.id,
    title: track.name,
    artist: track.artistName,
    durationSec: track.duration,
    licenseUrl: track.licenseUrl,
    audioUrl: track.audioUrl,
    artworkUrl: track.imageUrl,
  };
}

export const songLibrary: SongLibrary = {
  available: true,
  async search(query, signal) {
    const response = await api.searchMusic(query, { limit: 20 }, signal);
    return response.tracks.map(toSongResult);
  },
  async recommend(signal) {
    const query = recommendationQueries[Math.floor(Math.random() * recommendationQueries.length)];
    const response = await api.searchMusic(query, { limit: 20 }, signal);
    return shuffle(response.tracks.map(toSongResult)).slice(0, 8);
  },
};
