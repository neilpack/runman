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

  const url = new URL(`${config.jamendo.apiUrl}/tracks/`);
  url.searchParams.set('client_id', config.jamendo.clientId);
  url.searchParams.set('format', 'json');
  url.searchParams.set('search', query);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('order', 'relevance');
  url.searchParams.set('audioformat', 'mp32');
  url.searchParams.set('imagesize', '300');

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

  const tracks = (body.results ?? []).map(toMusicTrack).filter((track): track is MusicTrack => Boolean(track));
  return {
    tracks,
    total: body.headers?.results_count ?? tracks.length,
    offset,
    limit,
  };
}
