import type { Cassette, StoredAudioReference, Track } from './index.js';
import type { CassetteAudioReferences, CassetteDocument, CassettePayload, CassetteValidationIssue, CassetteValidationResult, PersistedCassetteTrack, RestoredCassette, SaveCassetteRequest } from './cassettePersistence.js';
import { validateCassetteDocument, validateSaveCassetteRequest } from './cassetteValidation.js';

function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}

function publicLicense(value: string | undefined): string | undefined {
  if (!value) return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' && ['creativecommons.org', 'www.creativecommons.org'].includes(url.hostname.toLowerCase()) && url.pathname.startsWith('/licenses/') && !url.port && !url.username && !url.password) {
      url.protocol = 'https:';
      return url.toString();
    }
  } catch { /* The normal metadata validator reports malformed URLs. */ }
  return value;
}

/** Pure local adapter only; it neither uploads audio nor proves object ownership. */
export function cassetteToSaveRequest(cassette: Cassette, expectedRevision: number, references: CassetteAudioReferences = {}): CassetteValidationResult<SaveCassetteRequest> {
  const issues: CassetteValidationIssue[] = [];
  const trackFields = ['id', 'sourceId', 'title', 'artist', 'durationSec', 'side', 'source', 'audioUrl', 'audioReference', 'artworkUrl', 'licenseUrl'];
  try {
    const { createdAt: _createdAt, updatedAt: _updatedAt, tracks, sideB, ...look } = cassette;
    const persisted = tracks.map((track, index) => {
      for (const key of Object.keys(track)) if (!trackFields.includes(key)) issues.push({ path: `cassette.tracks[${index}].${key}`, message: 'Unknown UI track field.' });
      const { source, audioUrl, audioReference, ...details } = track;
      if (details.licenseUrl !== undefined) details.licenseUrl = publicLicense(details.licenseUrl);
      if (source === 'library') {
        if (audioReference !== undefined) issues.push({ path: `cassette.tracks[${index}].audioReference`, message: 'Library tracks cannot include private audio references.' });
        return defined({ ...details, source, provider: 'jamendo', ...(audioUrl !== undefined ? { audioUrl } : {}) });
      }
      const sideReferences = (track.side === 'A' || track.side === 'B') && Object.hasOwn(references, track.side) ? references[track.side] : undefined;
      const audio = audioReference ?? (sideReferences && Object.hasOwn(sideReferences, track.id) ? sideReferences[track.id] : undefined);
      if (source !== 'recording' && source !== 'upload') issues.push({ path: `cassette.tracks[${index}].source`, message: 'Unknown UI track source.' });
      if (!audio) issues.push({ path: `cassette.tracks[${index}].audio`, message: 'Upload this audio first and supply its durable audio reference; local, blob, or public-looking playback URLs are not enough.' });
      // Earlier UI versions represented uploads as recording + a separate map.
      const persistedSource = audioReference === undefined && source === 'recording' ? audio?.source ?? source : source;
      return defined({ ...details, source: persistedSource, provider: 's3', audio });
    });
    if (issues.length) return { ok: false, issues };
    // JSON optional fields remain absent; sideB={} is deliberately kept distinct.
    const payload = { ...look, ...(sideB !== undefined ? { sideB: defined(sideB) } : {}), tracks: persisted };
    return validateSaveCassetteRequest({ cassette: payload, expectedRevision });
  } catch {
    return { ok: false, issues: [{ path: 'cassette', message: 'Expected a complete local cassette with track metadata.' }] };
  }
}

/** Durable audio returns as references, never fabricated/expired playback URLs. */
export function cassetteFromDocument(document: CassetteDocument): CassetteValidationResult<RestoredCassette> {
  const validated = validateCassetteDocument(document);
  if (!validated.ok) return validated;
  const { payload, createdAt, updatedAt } = validated.value;
  const references: Record<'A' | 'B', Record<string, StoredAudioReference>> = {
    A: Object.create(null) as Record<string, StoredAudioReference>,
    B: Object.create(null) as Record<string, StoredAudioReference>,
  };
  const tracks: Track[] = payload.tracks.map((track: PersistedCassetteTrack) => {
    if (track.source === 'library') { const { provider: _provider, ...ui } = track; return ui; }
    const { provider: _provider, source: _source, audio, ...ui } = track;
    references[track.side][track.id] = audio;
    return { ...ui, source: track.source, audioReference: audio };
  });
  const { tracks: _tracks, ...look }: CassettePayload = payload;
  return { ok: true, value: { cassette: { ...look, tracks, createdAt, updatedAt }, audioReferences: references } };
}
