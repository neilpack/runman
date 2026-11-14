import { CASSETTE_LIMITS, type Cassette, type StoredAudioReference, type TapeSide, type Track } from '@runman/shared';

export interface RecordingTarget { cassetteId: string; side: TapeSide; context: number }
export const RECORDING_SIDE_SECONDS = 30 * 60;
export function recordingTimeLeft(cassette: Cassette, side: TapeSide): number {
  return Math.max(0, RECORDING_SIDE_SECONDS - cassette.tracks.filter((track) => track.side === side).reduce((total, track) => total + track.durationSec, 0));
}
/** Re-evaluate capacity against the latest draft; one completed file is adopted once. */
export function appendTapeRecording(cassette: Cassette, side: TapeSide, reference: StoredAudioReference, metadata: { name: string; durationSec: number }, newId: () => string): Track[] {
  if (reference.source !== 'recording') throw new Error('The recorder only accepts microphone recordings.');
  if (cassette.tracks.some((track) => track.audioReference?.objectKey === reference.objectKey)) return cassette.tracks;
  if (!Number.isFinite(metadata.durationSec) || metadata.durationSec <= 0) throw new Error('The recording duration is unavailable.');
  if (cassette.tracks.length >= CASSETTE_LIMITS.tracksPerCassette) throw new Error('This cassette already has 100 tracks. Remove a track before adding a recording.');
  if (metadata.durationSec > recordingTimeLeft(cassette, side)) throw new Error(`Side ${side} does not have enough recording time left. Choose a shorter recording.`);
  return [...cassette.tracks, { id: newId(), title: metadata.name.replace(/\.[^/.]+$/, '').slice(0, CASSETTE_LIMITS.title) || 'Microphone recording',
    artist: 'Your recording', durationSec: metadata.durationSec, audioReference: reference, side, source: 'recording' }];
}

interface RecordingStore {
  getSync(): { context: number; status: string };
  get(id: string): Cassette | undefined;
  update(id: string, patch: Partial<Cassette>): void;
}
export function adoptTapeRecording(store: RecordingStore, target: RecordingTarget, reference: StoredAudioReference, metadata: { name: string; durationSec: number }, newId: () => string): void {
  const sync = store.getSync();
  if (sync.context !== target.context || sync.status !== 'authenticated') throw new Error('Your account changed. Reopen the recorder after signing in.');
  const latest = store.get(target.cassetteId);
  if (!latest) throw new Error('This cassette is no longer available.');
  const tracks = appendTapeRecording(latest, target.side, reference, metadata, newId);
  if (tracks === latest.tracks) return;
  store.update(latest.id, { tracks });
  if (!store.get(latest.id)?.tracks.some((track) => track.audioReference?.objectKey === reference.objectKey)) throw new Error('The cassette could not be updated. Keep this recording and try again.');
}
