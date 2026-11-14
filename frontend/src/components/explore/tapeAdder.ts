import type { PublicSong, TapeSide } from '@runman/shared';
import type { createCassetteStore } from '@/cassettes/store';
import { createEditorSaver } from '@/cassettes/editorSaver';
import { tapeFit, trackFromPublicSong } from './addToTape';
export interface SongAddedToTape { cassetteId: string; name: string; side: TapeSide; saved: boolean; local: boolean; error?: string }
export function createTapeAdder(store: ReturnType<typeof createCassetteStore>, options: { newId(): string; audioUrl(id: string): string }) {
  const context = store.getSync().context;
  function guard() { if (store.getSync().context !== context || store.getSync().status === 'hidden') throw new Error('Your account changed. Reopen Add to tape.'); }
  async function save(cassetteId: string, side: TapeSide): Promise<SongAddedToTape> {
    guard(); const tape = store.get(cassetteId); if (!tape) throw new Error('This tape is no longer available.');
    const local = store.getSync().status === 'guest';
    const success = await createEditorSaver(store, cassetteId, context)(); guard();
    return { cassetteId, name: tape.name || 'Untitled', side, saved: success && !local, local,
      ...(!success ? { error: store.getSync().tapes[cassetteId]?.error ?? 'The song is in your local draft. Retry saving this tape.' } : {}) };
  }
  return {
    save,
    async add(song: PublicSong, side: TapeSide, existingId?: string, name = 'New Mix') {
      guard(); let id: string;
      if (!Number.isFinite(song.durationSec) || song.durationSec <= 0 || song.durationSec > 1800) throw new Error('This song does not fit on a tape side.');
      const track = trackFromPublicSong(song, side, options.newId(), options.audioUrl(song.id));
      if (existingId) {
        const tape = store.get(existingId); if (!tape) throw new Error('This tape is no longer available.');
        const fit = tapeFit(tape, side, song); if (!fit.ok) throw new Error(fit.reason === 'duplicate' ? 'This song is already on that tape.' : fit.reason === 'limit' ? 'This cassette already has 100 tracks.' : 'This side does not have enough room for the song.');
        store.update(existingId, { tracks: [...tape.tracks, track] }); id = existingId;
        if (!store.get(id)?.tracks.some((item) => item.id === track.id)) throw new Error('The tape could not be updated. Try again after its current operation finishes.');
      } else id = store.create({ name: name.trim().slice(0, 120) || 'New Mix', tracks: [track] }).id;
      return save(id, side);
    },
  };
}
