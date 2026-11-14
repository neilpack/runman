// Song library integration point (e.g. Jamendo, per the README).
//
// The Edit Cassette page's "Add songs" panel talks ONLY to this module. To wire up the real
// library, implement `search` (and flip `available` to true); the UI needs no other changes.

export interface SongResult {
  id: string;
  title: string;
  artist: string;
  durationSec: number;
  audioUrl?: string;
  artworkUrl?: string;
}

export interface SongLibrary {
  /** false = show the "coming soon" state in the UI. */
  available: boolean;
  search(query: string, signal?: AbortSignal): Promise<SongResult[]>;
}

export const songLibrary: SongLibrary = {
  available: false,
  async search() {
    return [];
  },
};
