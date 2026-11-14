// Types shared between the frontend and backend.
// Put API request/response shapes here so both sides stay in sync.

export interface HealthResponse {
  status: 'ok';
  service: string;
  timestamp: string;
  storage: 'dynamodb' | 'memory';
}

export interface Item {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
}

export interface CreateItemRequest {
  name: string;
  description?: string;
}

export interface ApiError {
  error: string;
  details?: unknown;
}

// ---------------------------------------------------------------------------
// Cassettes
// ---------------------------------------------------------------------------

/** Which physical shell style the cassette uses. */
export type ShellType = 'solid' | 'clear' | 'retro';

/** Font used for the handwritten label. Frontend maps these ids to font families. */
export type PenStyle = 'handwritten' | 'marker' | 'script' | 'typewriter' | 'clean';

export type StickerKind = 'heart' | 'star' | 'note' | 'smiley' | 'bolt' | 'disc' | 'flower' | 'sparkle';

export interface Sticker {
  id: string;
  kind: StickerKind;
  /** Position of the sticker centre on the cassette face, in % (0-100). */
  x: number;
  y: number;
  /** Degrees. */
  rotation: number;
  /** 1 = default size. */
  scale: number;
  color: string;
}

export type TapeSide = 'A' | 'B';

export interface Track {
  id: string;
  title: string;
  artist: string;
  durationSec: number;
  side: TapeSide;
  /** Where the audio comes from: the song library, or a user recording. */
  source: 'library' | 'recording';
  /** Playable URL once the song library / recordings exist. */
  audioUrl?: string;
}

/** The parts of a cassette's look that can differ between side A and side B. */
export interface SideLook {
  labelColor: string;
  inkColor: string;
  penStyle: PenStyle;
  stickers: Sticker[];
}

export interface Cassette {
  id: string;
  name: string;
  shellColor: string;
  labelColor: string;
  inkColor: string;
  shellType: ShellType;
  penStyle: PenStyle;
  /** Side A stickers. */
  stickers: Sticker[];
  /**
   * Side B label overrides. The top-level labelColor/inkColor/penStyle/stickers are side A.
   * Missing B fields fall back to side A's values, except stickers, which default to none.
   */
  sideB?: Partial<SideLook>;
  tracks: Track[];
  createdAt: string;
  updatedAt: string;
}
