import type { MusicSearchResponse, MusicTrack } from '@runman/shared';
import { config } from '../config.js';

interface JamendoTrack {
  id?: string | number;
  name?: string;
  artist_name?: string;
  album_name?: string;
  duration?: number;
  image?: string;
  audio?: string;
  audiodownload?: string;
  license_ccurl?: string;
  lyrics?: unknown;
  musicinfo?: unknown;
}

interface JamendoResponse {
  headers?: {
    code?: number;
    error_message?: string;
    results_count?: number;
  };
  results?: JamendoTrack[];
}

export class JamendoError extends Error {}

// Conservative text filter for titles, artist/album names, lyrics, and Jamendo metadata.
// This is a safety filter for the demo, not a promise that it can understand every lyric.
const UNSAFE_TERMS = [
  'blowjob',
  'bullshit',
  'cocksucker',
  'faggot',
  'fucking',
  'hentai',
  'motherfucker',
  'nigga',
  'nigger',
  'porn',
  'pussy',
  'rape',
  'shit',
  'slut',
  'whore',
  'asshole',
  'bitch',
  'cock',
  'cunt',
  'dick',
  'fag',
  'fuck',
  'molest',
  'sex',
];

const UNSAFE_TERM_PATTERN = new RegExp(
  `(?:^|[^a-z])(?:${UNSAFE_TERMS.map((term) => term.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')).join('|')})(?:$|[^a-z])`,
);

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[0134578]/g, (character) => ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b' })[character] ?? character)
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

function containsUnsafeLanguage(value: string): boolean {
  return UNSAFE_TERM_PATTERN.test(normalizeText(value));
}

function serializeMetadata(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

export function isFamilyFriendlyTrack(track: JamendoTrack): boolean {
  const searchableText = [
    track.name,
    track.artist_name,
    track.album_name,
    serializeMetadata(track.lyrics),
    serializeMetadata(track.musicinfo),
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');

  return !containsUnsafeLanguage(searchableText);
}

function toMusicTrack(track: JamendoTrack): MusicTrack | undefined {
  if (
    (typeof track.id !== 'string' && typeof track.id !== 'number') ||
    typeof track.name !== 'string' ||
    typeof track.artist_name !== 'string' ||
    typeof track.duration !== 'number'
  ) {
    return undefined;
  }

  return {
    id: String(track.id),
    name: track.name,
    artistName: track.artist_name,
    albumName: track.album_name || undefined,
    duration: track.duration,
    imageUrl: track.image || undefined,
    audioUrl: track.audio || undefined,
    downloadUrl: track.audiodownload || undefined,
    licenseUrl: track.license_ccurl || undefined,
  };
}

export async function searchJamendoTracks(
  query: string,
  limit: number,
  offset: number,
): Promise<MusicSearchResponse> {
  if (!config.jamendo.clientId) {
    throw new JamendoError('JAMENDO_CLIENT_ID is not configured');
  }

  // Fetch extra candidates so filtering does not usually leave the picker nearly empty.
  const fetchLimit = Math.min(50, Math.max(limit, limit * 2));
  const url = new URL(`${config.jamendo.apiUrl}/tracks/`);
  url.searchParams.set('client_id', config.jamendo.clientId);
  url.searchParams.set('format', 'json');
  url.searchParams.set('search', query);
  url.searchParams.set('limit', String(fetchLimit));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('order', 'relevance');
  url.searchParams.set('audioformat', 'mp32');
  url.searchParams.set('imagesize', '300');
  url.searchParams.set('include', 'lyrics musicinfo');

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new JamendoError(
      `Unable to reach Jamendo: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  const body = (await response.json().catch(() => undefined)) as JamendoResponse | undefined;
  if (!response.ok || body?.headers?.code !== 0) {
    const message = body?.headers?.error_message || `Jamendo returned HTTP ${response.status}`;
    throw new JamendoError(message);
  }

  const tracks = (body.results ?? [])
    .filter(isFamilyFriendlyTrack)
    .map(toMusicTrack)
    .filter((track): track is MusicTrack => Boolean(track))
    .slice(0, limit);
  return {
    tracks,
    total: body.headers?.results_count ?? tracks.length,
    offset,
    limit,
  };
}

/** Resolve authoritative public metadata by provider ID for listening/discovery. */
export async function getJamendoTrack(id: string): Promise<MusicTrack | undefined> {
  if (!/^[1-9]\d{0,19}$/.test(id) || !config.jamendo.clientId) return;
  const url = new URL(`${config.jamendo.apiUrl}/tracks/`);
  for (const [key, value] of Object.entries({ client_id: config.jamendo.clientId, format: 'json', id, audioformat: 'mp32', imagesize: '300', include: 'lyrics musicinfo' })) url.searchParams.set(key, value);
  url.searchParams.set('type', 'single albumtrack');
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const body = await response.json() as JamendoResponse;
  if (!response.ok || body.headers?.code !== 0) throw new JamendoError('Jamendo track lookup failed.');
  const row = body.results?.find((track) => String(track.id) === id && isFamilyFriendlyTrack(track));
  return row ? toMusicTrack(row) : undefined;
}
