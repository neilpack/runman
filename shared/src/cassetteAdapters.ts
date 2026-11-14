import type { Cassette, StoredAudioReference, Track } from './index.js';
import type { CassetteAudioReferences, CassetteDocument, CassettePayload, CassetteValidationIssue, CassetteValidationResult, PersistedCassetteTrack, RestoreCassetteOptions, RestoredCassette, SaveCassetteRequest } from './cassettePersistence.js';
import { validateCassetteDocument, validateSaveCassetteRequest } from './cassetteValidation.js';
import type { PublicTapePayload } from './explorePublishing.js';

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
  const trackFields = ['id', 'sourceId', 'title', 'artist', 'durationSec', 'side', 'source', 'audioUrl', 'audioReference', 'artworkUrl', 'licenseUrl', 'visibility'];
  try {
    const { createdAt: _createdAt, updatedAt: _updatedAt, tracks, sideB, ...look } = cassette;
    const persisted = tracks.map((track, index) => {
      for (const key of Object.keys(track)) if (!trackFields.includes(key)) issues.push({ path: `cassette.tracks[${index}].${key}`, message: 'Unknown UI track field.' });
      // Visibility only applies to the listener's own audio; other sources drop it.
      const { source, audioUrl, audioReference, visibility, ...details } = track;
      if (details.licenseUrl !== undefined) details.licenseUrl = publicLicense(details.licenseUrl);
      if (source === 'community') {
        if (audioReference !== undefined) issues.push({ path: `cassette.tracks[${index}].audioReference`, message: 'Community tracks cannot include private audio references.' });
        // The stable audio URL is rebuilt from sourceId on restore (see cassetteFromDocument).
        return defined({ ...details, source, provider: 'explore', hasAudio: audioUrl !== undefined });
      }
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
      return defined({ ...details, source: persistedSource, provider: 's3', audio, visibility });
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
export function cassetteFromDocument(document: CassetteDocument, options: RestoreCassetteOptions = {}): CassetteValidationResult<RestoredCassette> {
  const validated = validateCassetteDocument(document);
  if (!validated.ok) return validated;
  const { payload, createdAt, updatedAt } = validated.value;
  const references: Record<'A' | 'B', Record<string, StoredAudioReference>> = {
    A: Object.create(null) as Record<string, StoredAudioReference>,
    B: Object.create(null) as Record<string, StoredAudioReference>,
  };
  const tracks: Track[] = payload.tracks.map((track: PersistedCassetteTrack) => {
    if (track.source === 'library') { const { provider: _provider, ...ui } = track; return ui; }
    if (track.source === 'community') {
      const { provider: _provider, hasAudio, ...ui } = track;
      return { ...ui, ...(hasAudio && options.communityAudioUrl ? { audioUrl: options.communityAudioUrl(track.sourceId) } : {}) };
    }
    const { provider: _provider, source: _source, audio, ...ui } = track;
    references[track.side][track.id] = audio;
    return { ...ui, source: track.source, audioReference: audio };
  });
  const { tracks: _tracks, ...look }: CassettePayload = payload;
  return { ok: true, value: { cassette: { ...look, tracks, createdAt, updatedAt }, audioReferences: references } };
}

/**
 * A copy of someone's public tape for your own library: the full look plus every track. Jamendo
 * tracks stay library tracks; Explore tracks (including the owner's uploads) stay playable through
 * their stable song URL. The caller picks the new cassette's id and timestamps.
 */
export function cassetteFromPublicTape(tape: PublicTapePayload, options: RestoreCassetteOptions = {}): Omit<Cassette, 'id' | 'createdAt' | 'updatedAt'> {
  const { id: _id, tracks, ...look } = structuredClone(tape);
  return {
    ...look,
    tracks: tracks.map((track): Track => {
      if (track.provider === 'jamendo') { const { provider: _provider, ...ui } = track; return ui; }
      const { provider: _provider, hasAudio, ...ui } = track;
      return { ...ui, ...(hasAudio && options.communityAudioUrl ? { audioUrl: options.communityAudioUrl(track.sourceId) } : {}) };
    }),
  };
}
