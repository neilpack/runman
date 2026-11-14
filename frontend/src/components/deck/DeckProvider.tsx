// The RunMan deck for the whole signed-in app. It lives in Layout, above the routed pages, so a
// tape loaded on the Library keeps playing while you browse Explore, edit a tape or open your
// account. The Library shows the full Walkman; every other page shows NowPlayingDock.

import { createContext, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { Cassette, TapeSide } from '@runman/shared';
import type { DeckControl } from '@/components/cassette/CassettePlayer';
import { useCassettes, useCassetteSync } from '@/hooks/useCassettes';
import { DeckRecorder } from './DeckRecorder';
import type { RecordingTarget } from '@/audio/tapeRecording';
import { useTapeDeck, type TapeDeck } from '@/hooks/useTapeDeck';
import { registerAudio, takeAudioFocus, watchPageMedia } from '@/audio/audioFocus';

interface DeckContextValue {
  /** The tape in the deck. */
  loaded?: Cassette;
  loadedId: string | null;
  setLoadedId: Dispatch<SetStateAction<string | null>>;
  side: TapeSide;
  setSide: Dispatch<SetStateAction<TapeSide>>;
  deck: TapeDeck;
  /**
   * A transport key pressed on any Walkman. FLIP turns the tape over and EJECT takes it out of
   * the deck (the Library then also puts it back on the stage).
   */
  control(control: DeckControl): void;
}

const DeckContext = createContext<DeckContextValue | null>(null);

export function DeckProvider({ children }: { children: ReactNode }) {
  const cassettes = useCassettes();
  const sync = useCassetteSync();
  const [recordingTarget, setRecordingTarget] = useState<RecordingTarget>();
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [side, setSide] = useState<TapeSide>('A');
  const loaded = loadedId ? cassettes.find((c) => c.id === loadedId) : undefined;
  const deck = useTapeDeck(loaded, side);

  useEffect(() => {
    if (recordingTarget && (recordingTarget.context !== sync.context || recordingTarget.cassetteId !== loadedId || recordingTarget.side !== side || !loaded)) setRecordingTarget(undefined);
  }, [recordingTarget, sync.context, loadedId, side, loaded]);

  // If the tape in the deck is deleted (here or in another tab), take it out.
  useEffect(() => {
    if (loadedId && !loaded) setLoadedId(null);
  }, [loadedId, loaded]);

  // Another player starting (an Explore preview, the song picker) pauses the tape.
  const deckRef = useRef(deck);
  deckRef.current = deck;
  useEffect(() => {
    watchPageMedia();
    return registerAudio('deck', () => {
      const keys = deckRef.current.latched;
      if (keys.includes('play') && !keys.includes('pause')) deckRef.current.press('pause');
    });
  }, []);

  const control = (key: DeckControl) => {
    if (key === 'record') {
      if (!loaded || recordingTarget) return;
      takeAudioFocus('recording');
      deck.press('stop');
      setRecordingTarget({ cassetteId: loaded.id, side, context: sync.context });
      return;
    }
    const keys = deck.latched;
    // PLAY, or PAUSE releasing a paused tape, is about to make sound.
    if (key === 'play' || (key === 'pause' && keys.includes('pause') && keys.includes('play'))) takeAudioFocus('deck');
    deck.press(key);
    if (key === 'flip') setSide((s) => (s === 'A' ? 'B' : 'A'));
    if (key === 'eject') setLoadedId(null);
  };

  return (
    <DeckContext.Provider value={{ loaded, loadedId, setLoadedId, side, setSide, deck, control }}>
      {children}
      {recordingTarget && <DeckRecorder key={`${recordingTarget.context}:${recordingTarget.cassetteId}:${recordingTarget.side}`} target={recordingTarget} onClose={() => setRecordingTarget(undefined)} />}
    </DeckContext.Provider>
  );
}

export function useDeck(): DeckContextValue {
  const value = useContext(DeckContext);
  if (!value) throw new Error('useDeck must be used inside <DeckProvider> (it lives in Layout).');
  return value;
}

/** The Walkman's time-slider props for the current deck. */
export function deckProgress(deck: TapeDeck) {
  return {
    position: deck.position,
    duration: deck.duration,
    label: deck.trackCount ? `TRK ${deck.trackNumber}/${deck.trackCount}` : 'NO SONGS',
    onSeek: deck.seek,
    onSkip: deck.skip,
    canSkipNext: deck.trackNumber < deck.trackCount,
  };
}
