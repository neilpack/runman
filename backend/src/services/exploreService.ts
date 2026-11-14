// Explore: songs listeners made public, plus listener profiles (username, avatar, tape on display).
//
// Data source, chosen at startup:
//   UPLOADS_BUCKET set ........ S3 (below). Read-only here; the "make public" flow writes it.
//   unset, local dev .......... built-in sample data (exploreDemoData.ts)
//   unset, deployed ........... empty catalog
//
// S3 layout (the contract for whatever publishes songs/profiles):
//   public/songs/<songId>/song.json    SongManifest: metadata for one public song
//   public/songs/<songId>/<file>       its audio; song.json `audioKey` points here
//   public/profiles/<userId>.json      ProfileManifest: a PublicProfile
//
// Everything read from the bucket is validated before it is served. Invalid manifests are
// skipped (and logged), so one bad file never breaks the page. `audioKey` must stay inside its
// own song folder, so a manifest can never get us to presign a private object.
//
// Search and trending run in memory over a cached listing (fine for a hackathon-sized catalog).
// At scale, move manifests into a DynamoDB table with an index and keep the same service API.

import type {
  ExploreCatalog,
  ListenerProfileResponse,
  ListenerSearchResponse,
  ListenerSummary,
  PenStyle,
  PublicProfile,
  PublicSong,
  PublicSongPage,
  ShellType,
  SideLook,
  Sticker,
  TapeSnapshot,
  TrendingSongsResponse,
} from '@runman/shared';
import { sanitizeCustomStickers } from '@runman/shared';
import { getDownloadUrl, getObjectText, listObjectKeys } from '../aws/s3.js';
import { config } from '../config.js';
import { demoProfiles, demoSongs } from './exploreDemoData.js';

export const TRENDING_COUNT = 5;
export const PUBLIC_PREFIX = 'public/';
const SONG_MANIFEST = /^public\/songs\/([A-Za-z0-9_-]{1,128})\/song\.json$/;
const PROFILE_MANIFEST = /^public\/profiles\/([A-Za-z0-9_-]{1,128})\.json$/;
/** Presigned audio links outlive a typical listen; the stable /audio URL re-signs on each request. */
const AUDIO_URL_SECONDS = 3600;

/** A public song as stored (song.json), after validation. */
export interface SongRecord {
  id: string;
  title: string;
  artist: string;
  durationSec: number;
  uploaderId: string;
  uploaderUsername: string;
  /** S3 key of the audio, inside public/songs/<id>/. */
  audioKey?: string;
  artworkUrl?: string;
  addCount: number;
  publishedAt: string;
}

export interface ExploreSnapshot {
  songs: SongRecord[];
  profiles: PublicProfile[];
}

export interface ExploreSource {
  catalog: ExploreCatalog;
  snapshot(): Promise<ExploreSnapshot>;
  audioUrl(song: SongRecord): Promise<string | undefined>;
}

// ---------------------------------------------------------------------------
// Validation (manifests are untrusted input)
// ---------------------------------------------------------------------------

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{1,24}$/;
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const STICKER_KIND = /^[a-z0-9-]{1,64}$/i;
const DATA_AVATAR = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const SHELL_TYPES: readonly ShellType[] = ['solid', 'clear', 'retro'];
const PEN_STYLES: readonly PenStyle[] = ['handwritten', 'marker', 'script', 'typewriter', 'clean'];

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : undefined;
}

function finite(v: unknown, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
}

function httpsUrl(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 2048) return undefined;
  try {
    return new URL(v).protocol === 'https:' ? v : undefined;
  } catch {
    return undefined;
  }
}

function isoDate(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 40) return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

export function parseSongManifest(id: string, raw: unknown): SongRecord | undefined {
  if (!ID_PATTERN.test(id) || !isObject(raw)) return undefined;
  const title = text(raw.title, 200);
  const artist = text(raw.artist, 200);
  const durationSec = finite(raw.durationSec, 0, 6 * 3600);
  const uploaderId = typeof raw.uploaderId === 'string' && ID_PATTERN.test(raw.uploaderId) ? raw.uploaderId : undefined;
  const uploaderUsername =
    typeof raw.uploaderUsername === 'string' && USERNAME_PATTERN.test(raw.uploaderUsername) ? raw.uploaderUsername : undefined;
  const publishedAt = isoDate(raw.publishedAt);
  if (!title || !artist || durationSec === undefined || !uploaderId || !uploaderUsername || !publishedAt) return undefined;

  let audioKey: string | undefined;
  if (raw.audioKey !== undefined) {
    const folder = `${PUBLIC_PREFIX}songs/${id}/`;
    const key = raw.audioKey;
    // Stay inside this song's folder: no other prefixes, no traversal, not the manifest itself.
    if (
      typeof key !== 'string' ||
      !key.startsWith(folder) ||
      !/^[A-Za-z0-9_.-]{1,200}$/.test(key.slice(folder.length)) ||
      key.slice(folder.length).startsWith('.') ||
      key === `${folder}song.json`
    ) {
      return undefined;
    }
    audioKey = key;
  }

  const addCount = finite(raw.addCount, 0, Number.MAX_SAFE_INTEGER);
  return {
    id,
    title,
    artist,
    durationSec: Math.round(durationSec),
    uploaderId,
    uploaderUsername,
    audioKey,
    artworkUrl: httpsUrl(raw.artworkUrl),
    addCount: addCount === undefined ? 0 : Math.floor(addCount),
    publishedAt,
  };
}

function parseSticker(raw: unknown): Sticker | undefined {
  if (!isObject(raw)) return undefined;
  const id = text(raw.id, 128);
  const kind = typeof raw.kind === 'string' && STICKER_KIND.test(raw.kind) ? raw.kind : undefined;
  const x = finite(raw.x, -50, 150);
  const y = finite(raw.y, -50, 150);
  const rotation = finite(raw.rotation, -3600, 3600);
  const scale = finite(raw.scale, 0.05, 10);
  const color = typeof raw.color === 'string' && HEX_COLOR.test(raw.color) ? raw.color : undefined;
  if (!id || !kind || x === undefined || y === undefined || rotation === undefined || scale === undefined || !color) {
    return undefined;
  }
  return { id, kind, x, y, rotation, scale, color };
}

function parseStickers(raw: unknown): Sticker[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 60).map(parseSticker).filter((s): s is Sticker => Boolean(s));
}

const color = (v: unknown) => (typeof v === 'string' && HEX_COLOR.test(v) ? v : undefined);
const penStyle = (v: unknown) => (PEN_STYLES.includes(v as PenStyle) ? (v as PenStyle) : undefined);

export function parseTapeSnapshot(raw: unknown): TapeSnapshot | null {
  if (!isObject(raw)) return null;
  const id = typeof raw.id === 'string' && ID_PATTERN.test(raw.id) ? raw.id : undefined;
  const name = typeof raw.name === 'string' && raw.name.length <= 80 ? raw.name : undefined;
  const shellColor = color(raw.shellColor);
  const labelColor = color(raw.labelColor);
  const inkColor = color(raw.inkColor);
  const shellType = SHELL_TYPES.includes(raw.shellType as ShellType) ? (raw.shellType as ShellType) : undefined;
  const pen = penStyle(raw.penStyle);
  const trackCount = finite(raw.trackCount, 0, 10_000);
  const updatedAt = isoDate(raw.updatedAt);
  if (
    !id || name === undefined || !shellColor || !labelColor || !inkColor || !shellType || !pen ||
    trackCount === undefined || !updatedAt
  ) {
    return null;
  }

  let sideB: Partial<SideLook> | undefined;
  if (isObject(raw.sideB)) {
    sideB = {};
    const b = raw.sideB;
    if (color(b.labelColor)) sideB.labelColor = color(b.labelColor);
    if (color(b.inkColor)) sideB.inkColor = color(b.inkColor);
    if (penStyle(b.penStyle)) sideB.penStyle = penStyle(b.penStyle);
    if (Array.isArray(b.stickers)) sideB.stickers = parseStickers(b.stickers);
  }

  return {
    id,
    name,
    shellColor,
    labelColor,
    inkColor,
    shellType,
    penStyle: pen,
    stickers: parseStickers(raw.stickers),
    sideB,
    customStickers: sanitizeCustomStickers(raw.customStickers),
    updatedAt,
    trackCount: Math.floor(trackCount),
  };
}

function safeAvatar(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 2048) return null;
  return DATA_AVATAR.test(v) ? v : (httpsUrl(v) ?? null);
}

export function parseProfileManifest(userId: string, raw: unknown): PublicProfile | undefined {
  if (!ID_PATTERN.test(userId) || !isObject(raw)) return undefined;
  if (raw.userId !== undefined && raw.userId !== userId) return undefined;
  const username = typeof raw.username === 'string' && USERNAME_PATTERN.test(raw.username) ? raw.username : undefined;
  if (!username) return undefined;
  return { userId, username, avatar: safeAvatar(raw.avatar), favoriteTape: parseTapeSnapshot(raw.favoriteTape) };
}

// ---------------------------------------------------------------------------
// Search and ranking (pure, so they're easy to test)
// ---------------------------------------------------------------------------

/** Lowercase and strip accents, so "Beyonce" finds "Beyoncé". */
export function fold(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function tokens(q: string): string[] {
  return fold(q).split(/\s+/).filter(Boolean);
}

/** 2 when `token` starts a word in `field`, 1 when it appears anywhere, else 0. */
function hit(field: string, token: string): number {
  if (!field.includes(token)) return 0;
  return field.split(/[^a-z0-9]+/).some((w) => w.startsWith(token)) ? 2 : 1;
}

const newest = (a: SongRecord, b: SongRecord) => b.publishedAt.localeCompare(a.publishedAt);
const popularThenNewest = (a: SongRecord, b: SongRecord) => b.addCount - a.addCount || newest(a, b);

export function newestFirst(songs: SongRecord[]): SongRecord[] {
  return [...songs].sort((a, b) => newest(a, b) || a.id.localeCompare(b.id));
}

/**
 * Songs matching every word of `q` in the title, artist, or uploader username, best first.
 * Title hits outrank artist hits, which outrank uploader hits.
 */
export function searchSongs(songs: SongRecord[], q: string, usernameOf: (s: SongRecord) => string): SongRecord[] {
  const words = tokens(q);
  if (words.length === 0) return newestFirst(songs);
  const phrase = words.join(' ');

  const scored: { song: SongRecord; score: number }[] = [];
  for (const song of songs) {
    const title = fold(song.title);
    const artist = fold(song.artist);
    const uploader = fold(usernameOf(song));
    let score = title.includes(phrase) ? 5 : 0;
    let matchedAll = true;
    for (const word of words) {
      const best = Math.max(hit(title, word) * 3, hit(artist, word) * 2, hit(uploader, word));
      if (best === 0) {
        matchedAll = false;
        break;
      }
      score += best;
    }
    if (matchedAll) scored.push({ song, score });
  }
  return scored.sort((a, b) => b.score - a.score || popularThenNewest(a.song, b.song)).map((s) => s.song);
}

/**
 * Top songs by adds, decayed by age (Hacker-News style), so a fresh song with a few adds can
 * overtake an old one with many. Falls back to newest when nothing has been added yet.
 */
export function trendingSongs(songs: SongRecord[], now: Date, count = TRENDING_COUNT): SongRecord[] {
  const score = (s: SongRecord) => {
    const ageDays = Math.max(0, (now.getTime() - Date.parse(s.publishedAt)) / 86_400_000);
    return s.addCount / (ageDays + 2) ** 1.5;
  };
  return [...songs]
    .map((song) => ({ song, score: score(song) }))
    .sort((a, b) => b.score - a.score || newest(a.song, b.song))
    .slice(0, count)
    .map((s) => s.song);
}

export function searchListeners(listeners: ListenerSummary[], q: string): ListenerSummary[] {
  const needle = fold(q.trim().replace(/^@/, ''));
  const byActivity = (a: ListenerSummary, b: ListenerSummary) =>
    b.songCount - a.songCount || a.username.localeCompare(b.username);
  if (!needle) return [...listeners].sort(byActivity);

  return listeners
    .map((listener) => {
      const name = fold(listener.username);
      const score = name === needle ? 3 : name.startsWith(needle) ? 2 : name.includes(needle) ? 1 : 0;
      return { listener, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || byActivity(a.listener, b.listener))
    .map((s) => s.listener);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createExploreService(source: ExploreSource, now: () => Date = () => new Date()) {
  const catalog = source.catalog;

  /** Profiles by user id. Uploaders without a profile file still get a page (no avatar/tape). */
  async function load() {
    const { songs, profiles } = await source.snapshot();
    const byUser = new Map<string, PublicProfile>(profiles.map((p) => [p.userId, p]));
    for (const song of songs) {
      if (!byUser.has(song.uploaderId)) {
        byUser.set(song.uploaderId, {
          userId: song.uploaderId,
          username: song.uploaderUsername,
          avatar: null,
          favoriteTape: null,
        });
      }
    }
    // The profile's username wins, so renames show up everywhere without rewriting song files.
    const usernameOf = (s: SongRecord) => byUser.get(s.uploaderId)?.username ?? s.uploaderUsername;
    const toPublic = (s: SongRecord): PublicSong => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      durationSec: s.durationSec,
      uploader: { userId: s.uploaderId, username: usernameOf(s) },
      artworkUrl: s.artworkUrl,
      hasAudio: Boolean(s.audioKey),
      addCount: s.addCount,
      publishedAt: s.publishedAt,
    });
    return { songs, byUser, usernameOf, toPublic };
  }

  return {
    catalog,

    async songs(input: { q: string; limit: number; offset: number }): Promise<PublicSongPage> {
      const { songs, usernameOf, toPublic } = await load();
      const matches = searchSongs(songs, input.q, usernameOf);
      return {
        songs: matches.slice(input.offset, input.offset + input.limit).map(toPublic),
        total: matches.length,
        offset: input.offset,
        limit: input.limit,
        catalog,
      };
    },

    async trending(): Promise<TrendingSongsResponse> {
      const { songs, toPublic } = await load();
      return { songs: trendingSongs(songs, now()).map(toPublic), catalog };
    },

    async listeners(input: { q: string; limit: number }): Promise<ListenerSearchResponse> {
      const { songs, byUser } = await load();
      const counts = new Map<string, number>();
      for (const s of songs) counts.set(s.uploaderId, (counts.get(s.uploaderId) ?? 0) + 1);
      const all = [...byUser.values()].map((p): ListenerSummary => ({ ...p, songCount: counts.get(p.userId) ?? 0 }));
      const matches = searchListeners(all, input.q);
      return { profiles: matches.slice(0, input.limit), total: matches.length, catalog };
    },

    /** Case-insensitive username lookup. */
    async listener(username: string): Promise<ListenerProfileResponse | undefined> {
      const { songs, byUser, toPublic } = await load();
      const wanted = username.toLowerCase();
      const profile = [...byUser.values()].find((p) => p.username.toLowerCase() === wanted);
      if (!profile) return undefined;
      const theirs = newestFirst(songs.filter((s) => s.uploaderId === profile.userId)).map(toPublic);
      return { profile, songs: theirs, catalog };
    },

    /** A short-lived playable URL for the song's audio, or undefined if it has none. */
    async audioUrl(songId: string): Promise<string | undefined> {
      const { songs } = await source.snapshot();
      const song = songs.find((s) => s.id === songId);
      return song?.audioKey ? source.audioUrl(song) : undefined;
    },
  };
}

export type ExploreService = ReturnType<typeof createExploreService>;

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** The S3 calls the source needs; injected so tests run without AWS. */
export interface S3Access {
  list(prefix: string): Promise<string[]>;
  read(key: string): Promise<string>;
  presign(key: string, expiresIn: number): Promise<string>;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export function createS3Source(s3: S3Access, options: { ttlMs?: number; now?: () => number } = {}): ExploreSource {
  const ttlMs = options.ttlMs ?? 60_000;
  const clock = options.now ?? Date.now;
  let cache: { at: number; value: Promise<ExploreSnapshot> } | undefined;

  async function readManifest<T>(key: string, parse: (raw: unknown) => T | undefined): Promise<T | undefined> {
    try {
      const parsed = parse(JSON.parse(await s3.read(key)));
      if (!parsed) console.warn(`[explore] skipped invalid manifest ${key}`);
      return parsed;
    } catch (error) {
      console.warn(`[explore] skipped unreadable manifest ${key}: ${error instanceof Error ? error.message : 'unknown error'}`);
      return undefined;
    }
  }

  async function fetchSnapshot(): Promise<ExploreSnapshot> {
    const keys = await s3.list(PUBLIC_PREFIX);
    const songKeys = keys.flatMap((key) => {
      const m = SONG_MANIFEST.exec(key);
      return m ? [{ key, id: m[1] }] : [];
    });
    const profileKeys = keys.flatMap((key) => {
      const m = PROFILE_MANIFEST.exec(key);
      return m ? [{ key, id: m[1] }] : [];
    });
    const [songs, profiles] = await Promise.all([
      mapLimit(songKeys, 8, ({ key, id }) => readManifest(key, (raw) => parseSongManifest(id, raw))),
      mapLimit(profileKeys, 8, ({ key, id }) => readManifest(key, (raw) => parseProfileManifest(id, raw))),
    ]);
    return {
      songs: songs.filter((s): s is SongRecord => Boolean(s)),
      profiles: profiles.filter((p): p is PublicProfile => Boolean(p)),
    };
  }

  return {
    catalog: 's3',
    snapshot() {
      const at = clock();
      if (!cache || at - cache.at >= ttlMs) {
        const value = fetchSnapshot();
        cache = { at, value };
        // Don't cache failures: the next request retries.
        value.catch(() => {
          if (cache?.value === value) cache = undefined;
        });
      }
      return cache.value;
    },
    audioUrl: (song) => (song.audioKey ? s3.presign(song.audioKey, AUDIO_URL_SECONDS) : Promise.resolve(undefined)),
  };
}

export function createStaticSource(catalog: ExploreCatalog, snapshot: ExploreSnapshot): ExploreSource {
  return {
    catalog,
    snapshot: async () => snapshot,
    audioUrl: async () => undefined,
  };
}

function chooseSource(): ExploreSource {
  if (config.aws.uploadsBucket) {
    return createS3Source({ list: (p) => listObjectKeys(p), read: (k) => getObjectText(k), presign: getDownloadUrl });
  }
  if (config.explore.demoCatalog) {
    return createStaticSource('demo', { songs: demoSongs(new Date()), profiles: demoProfiles() });
  }
  return createStaticSource('empty', { songs: [], profiles: [] });
}

export const exploreService = createExploreService(chooseSource());
