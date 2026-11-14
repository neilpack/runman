// Types shared between the frontend and backend.
// Put API request/response shapes here so both sides stay in sync.

/** Persist only after upload succeeds. Playback URLs are temporary browser state. */
export interface StoredAudioReference {
  source: 'upload' | 'recording';
  objectKey: string;
  contentType: string;
  sizeBytes: number;
}

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

/**
 * Sticker id: one of the built-in doodles ('heart', 'star', 'note', 'smiley', 'bolt', 'disc',
 * 'flower', 'sparkle') or an icon sticker id from frontend/src/components/cassette/stickerLibrary.ts.
 */
export type StickerKind = string;

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
  /** Original ID from the external music source, when applicable. */
  sourceId?: string;
  title: string;
  artist: string;
  durationSec: number;
  side: TapeSide;
  /**
   * Where the audio comes from: Jamendo, your own upload, a recording, or a song another
   * listener shared publicly (found on Explore; `sourceId` is its PublicSong id).
   */
  source: 'library' | 'upload' | 'recording' | 'community';
  /** Playable URL once the song library / recordings exist. */
  audioUrl?: string;
  /** Durable reference for user audio; playback URLs are generated separately. */
  audioReference?: StoredAudioReference;
  artworkUrl?: string;
  licenseUrl?: string;
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

export interface MusicTrack {
  id: string;
  name: string;
  artistName: string;
  albumName?: string;
  duration: number;
  imageUrl?: string;
  audioUrl?: string;
  downloadUrl?: string;
  licenseUrl?: string;
}

export interface MusicSearchResponse {
  tracks: MusicTrack[];
  total: number;
  offset: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Explore: songs listeners made public, and listener profiles
// ---------------------------------------------------------------------------

/**
 * A tape's look, frozen when it was picked as a favorite. Other listeners see this snapshot,
 * never your private library (tracks/audio are deliberately not included).
 */
export type TapeSnapshot = Pick<
  Cassette,
  'id' | 'name' | 'shellColor' | 'labelColor' | 'inkColor' | 'shellType' | 'penStyle' | 'stickers' | 'sideB' | 'updatedAt'
> & { trackCount: number };

/** What other listeners can see on your profile. */
export interface PublicProfile {
  userId: string;
  username: string;
  /** Safe image URL (https or a small base64 data URL), or null for the initials fallback. */
  avatar: string | null;
  /** The mixtape on display. */
  favoriteTape: TapeSnapshot | null;
}

/**
 * Where Explore data came from:
 * - 's3': public songs/profiles in the uploads bucket
 * - 'demo': built-in sample data (local dev with no bucket configured)
 * - 'empty': deployed without a bucket, so nothing to show
 */
export type ExploreCatalog = 's3' | 'demo' | 'empty';

/** A song a listener uploaded and made public. */
export interface PublicSong {
  id: string;
  title: string;
  artist: string;
  durationSec: number;
  uploader: { userId: string; username: string };
  artworkUrl?: string;
  /** True when audio streams from GET /api/explore/songs/:id/audio (a stable URL; safe to store on a Track). */
  hasAudio: boolean;
  /** How many times listeners added it to a tape. Feeds trending. */
  addCount: number;
  publishedAt: string;
}

/** GET /api/explore/songs?q=&limit=&offset= — all public songs, or matches for `q`. */
export interface PublicSongPage {
  songs: PublicSong[];
  total: number;
  offset: number;
  limit: number;
  catalog: ExploreCatalog;
}

/** GET /api/explore/songs/trending — the top 5. */
export interface TrendingSongsResponse {
  songs: PublicSong[];
  catalog: ExploreCatalog;
}

export interface ListenerSummary extends PublicProfile {
  songCount: number;
}

/** GET /api/explore/profiles?q= — username search. */
export interface ListenerSearchResponse {
  profiles: ListenerSummary[];
  total: number;
  catalog: ExploreCatalog;
}

/** GET /api/explore/profiles/:username — a listener's page. */
export interface ListenerProfileResponse {
  profile: PublicProfile;
  songs: PublicSong[];
  catalog: ExploreCatalog;
}
