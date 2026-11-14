// Real playback for the RunMan deck. The loaded cassette's current side plays like a tape:
// its tracks run back to back, and the transport keys drive one shared <audio> element.
//
//   PLAY ......... play from the current position
//   PAUSE ........ freeze in place; press again to carry on (PLAY stays down)
//   STOP ......... stop, pop every key up, rewind to the start of the current song
//   FF / REW ..... wind through the side at WIND_SPEED (with a tape-whirr sound, not the song),
//                  crossing song boundaries, and auto-stop with a clunk at either end.
//                  Press PLAY to listen from wherever you land.
//   ⏮ / ⏭ ........ jump to the start of the previous / next song (⏮ on the first song restarts
//                  it). Playing carries on into the new song; paused stays paused.
//   FLIP / EJECT . stop and start over on the new side / tape
//
// The deck keeps a "tape position" (song index + seconds) of its own, so winding doesn't
// have to download every song it passes; audio is only loaded when PLAY needs it.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Cassette, TapeSide, Track } from '@runman/shared';
import { nextLatched, type DeckControl } from '@/components/cassette/CassettePlayer';
import { playSfx, startWinding } from '@/audio/sfx';
import { createPlaybackController } from '@/audio/playbackController';
import { MediaPlaybackError, playAudioSource, playbackFailureMessage } from '@/audio/mediaPlayback';
import { playbackDiagnostic, probePlaybackSource, type PlaybackDiagnostic } from '@/audio/playbackDiagnostics';
import { subscribeMediaAccount } from '@/auth/mediaContext';

/** How many times faster than real time FF / REW move through the tape. */
const WIND_SPEED = 16;
const WIND_TICK_MS = 100;
const NOTICE_MS = 2200;

export interface TapeDeck {
  /** Transport keys held down. */
  latched: DeckControl[];
  /** LCD text, or undefined for the player's default (tape name + side). */
  display?: string;
  /** Reels turn while the tape is actually moving. */
  spinning: boolean;
  track?: Track;
  /** 1-based position of `track` on this side, and how many playable songs the side has. */
  trackNumber: number;
  trackCount: number;
  /** Seconds into the current song, and its length. */
  position: number;
  duration: number;
  press(control: DeckControl): void;
  seek(seconds: number): void;
  /** Jump to the start of the next (1) or previous (-1) song on this side. */
  skip(direction: 1 | -1): void;
  diagnostic?: PlaybackDiagnostic;
  clearDiagnostic(): void;
}

const playable = (t: Track) => Boolean(t.audioUrl || t.audioReference);

async function resolveUrl(cassetteId: string, track: Track, signal: AbortSignal): Promise<{ url: string; expiresAt?: number }> {
  if (track.audioReference) {
    const { audioStorage } = await import('@/audio/apiAudioStorage');
    const { url, expiresAt } = await audioStorage.playback(cassetteId, track.audioReference, signal);
    return { url: url.toString(), expiresAt: expiresAt.getTime() };
  }
  if (track.audioUrl) return { url: track.audioUrl };
  throw new Error('This song has no audio.');
}

export function useTapeDeck(cassette: Cassette | undefined, side: TapeSide): TapeDeck {
  const tracks = useMemo(
    () => (cassette ? cassette.tracks.filter((t) => t.side === side && playable(t)) : []),
    [cassette, side],
  );

  const [latched, setLatchedState] = useState<DeckControl[]>([]);
  const [index, setIndexState] = useState(0);
  const [position, setPositionState] = useState(0);
  const [loadedDuration, setLoadedDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [audioRunning, setAudioRunning] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [diagnostic, setDiagnostic] = useState<PlaybackDiagnostic>();
  const diagnosticTicket = useRef(0);
  const diagnosticProbe = useRef<AbortController | undefined>(undefined);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const cassetteIdRef = useRef(cassette?.id);
  cassetteIdRef.current = cassette?.id;
  const latchedRef = useRef<DeckControl[]>([]);
  const indexRef = useRef(0);
  const posRef = useRef(0);
  /** Which song (by track id) the <audio> element currently holds, and when its URL expires. */
  const loadedRef = useRef<{ trackId: string; expiresAt?: number } | null>(null);
  /** Bumped on every transport change so a slow URL lookup can't start stale playback. */
  const opRef = useRef(0);
  const playback = useRef(createPlaybackController(resolveUrl));
  const errorRetry = useRef(false);
  const mediaAttempt = useRef<AbortController | undefined>(undefined);
  const startingPlayback = useRef(false);
  const windTimer = useRef<number | undefined>(undefined);
  const stopWindSound = useRef<(() => void) | undefined>(undefined);
  const noticeTimer = useRef<number | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);

  const audio = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = 'auto';
    }
    return audioRef.current;
  };

  const clearDiagnostic = () => {
    diagnosticTicket.current++;
    diagnosticProbe.current?.abort();
    setDiagnostic(undefined);
  };
  const reportFailure = (error: unknown, stage: PlaybackDiagnostic['stage'], track: Track, sourceUrl?: string) => {
    const ticket = ++diagnosticTicket.current;
    diagnosticProbe.current?.abort();
    const report = playbackDiagnostic(error, {
      stage, track, retried: errorRetry.current, audio: audio(), userAgent: navigator.userAgent,
    });
    const probe = Boolean(sourceUrl && track.audioReference && stage !== 'playback-url' &&
      !(error instanceof DOMException && error.name === 'NotAllowedError'));
    if (probe) report.s3 = { outcome: 'checking' };
    setDiagnostic(report);
    console.error('[runman playback diagnostics]', JSON.stringify(report));
    if (!probe || !sourceUrl) return;
    const controller = new AbortController(); diagnosticProbe.current = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
    void probePlaybackSource(sourceUrl, controller.signal).then((result) => {
      if (diagnosticTicket.current !== ticket) return;
      const completed = { ...report, s3: timedOut ? { outcome: 'timeout' as const } : result };
      setDiagnostic(completed);
      console.error('[runman playback diagnostics]', JSON.stringify(completed));
    }).finally(() => window.clearTimeout(timer));
  };

  const setLatched = (next: DeckControl[]) => {
    latchedRef.current = next;
    setLatchedState(next);
  };
  const setIndex = (i: number) => {
    indexRef.current = i;
    setIndexState(i);
  };
  const setPosition = (p: number) => {
    posRef.current = p;
    setPositionState(p);
  };

  const flash = (text: string) => {
    setNotice(text);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(undefined), NOTICE_MS);
  };

  const isLoaded = (i: number) => Boolean(loadedRef.current && tracksRef.current[i] && loadedRef.current.trackId === tracksRef.current[i].id);

  /** Length of song i: the real decoded length if it's loaded, else what the tape recorded. */
  const durationOf = (i: number) => {
    const a = audioRef.current;
    if (a && isLoaded(i) && Number.isFinite(a.duration) && a.duration > 0) return a.duration;
    return tracksRef.current[i]?.durationSec ?? 0;
  };

  const stopWinding = () => {
    window.clearInterval(windTimer.current);
    windTimer.current = undefined;
    stopWindSound.current?.();
    stopWindSound.current = undefined;
  };

  /** The deck stopping itself (end of tape): keys clunk back up. */
  const autoStop = (text: string) => {
    halt(text);
    playSfx('keyRelease');
  };

  const silence = () => {
    opRef.current += 1;
    mediaAttempt.current?.abort();
    startingPlayback.current = false;
    playback.current.cancelPending();
    setLoading(false);
    const a = audioRef.current;
    // Only a song that was actually playing has moved the tape; while winding, posRef leads.
    if (a && !a.paused) {
      a.pause();
      if (isLoaded(indexRef.current)) setPosition(a.currentTime);
    }
  };

  /** Everything stops and the keys pop up; the tape stays where it is. */
  const halt = (text?: string) => {
    stopWinding();
    silence();
    setLatched([]);
    if (text) flash(text);
  };

  const startPlaying = async (force = false) => {
    const op = ++opRef.current;
    mediaAttempt.current?.abort();
    const attempt = new AbortController();
    mediaAttempt.current = attempt;
    const i = indexRef.current;
    const track = tracksRef.current[i];
    const cassetteId = cassetteIdRef.current;
    if (!track || !cassetteId) return;
    startingPlayback.current = true;
    const a = audio();
    if (!force) { errorRetry.current = false; clearDiagnostic(); }
    let stage: PlaybackDiagnostic['stage'] = 'playback-url';
    let sourceUrl: string | undefined;
    try {
      setLoading(true);
      const resolved = await playback.current.resolve(cassetteId, track, { force });
      if (!resolved || op !== opRef.current) return;
      stage = 'media-start'; sourceUrl = resolved.url;
      // Always reconcile the returned URL with the actual media element. A
      // pre-request cache decision can be obsolete after renewal/cancellation.
      await playAudioSource(a, resolved.url, posRef.current, attempt.signal, force);
      if (op !== opRef.current) return;
      loadedRef.current = { trackId: track.id, expiresAt: resolved.expiresAt };
      setLoadedDuration(Number.isFinite(a.duration) ? a.duration : track.durationSec);
      setLoading(false);
    } catch (err) {
      if (op !== opRef.current || (err instanceof DOMException && err.name === 'AbortError')) return;
      // play() can reject before a media error event. Both paths need the same
      // bounded renewal, and a failed source must never remain a usable cache hit.
      const mediaFailure = err instanceof MediaPlaybackError || (err instanceof DOMException && err.name === 'NotSupportedError');
      if (track.audioReference && mediaFailure && !errorRetry.current) {
        errorRetry.current = true;
        void startPlaying(true);
        return;
      }
      loadedRef.current = null;
      playback.current.invalidate();
      reportFailure(err, stage, track, sourceUrl);
      halt(playbackFailureMessage(err));
      a.removeAttribute('src');
      a.load();
    } finally {
      if (op === opRef.current) startingPlayback.current = false;
    }
  };

  const windTick = (dir: 1 | -1) => {
    const n = tracksRef.current.length;
    let i = indexRef.current;
    let p = posRef.current + (dir * WIND_SPEED * WIND_TICK_MS) / 1000;
    if (dir > 0 && p >= durationOf(i)) {
      if (i + 1 < n) {
        i += 1;
        p = 0;
      } else {
        setPosition(durationOf(i));
        autoStop(`END OF SIDE ${side}`);
        return;
      }
    } else if (dir < 0 && p <= 0) {
      if (i > 0) {
        i -= 1;
        p = durationOf(i);
      } else {
        setPosition(0);
        autoStop(`START OF SIDE ${side}`);
        return;
      }
    }
    if (i !== indexRef.current) setIndex(i);
    setPosition(p);
  };

  /** Make the audio do whatever the keys now say. */
  const apply = (keys: DeckControl[]) => {
    stopWinding();
    const paused = keys.includes('pause');
    const dir = keys.includes('fastForward') ? 1 : keys.includes('rewind') ? -1 : 0;
    if (keys.includes('play') && !paused) {
      void startPlaying();
    } else {
      silence();
    }
    if (dir && !paused) {
      windTimer.current = window.setInterval(() => windTick(dir), WIND_TICK_MS);
      stopWindSound.current = startWinding(dir > 0 ? 'fastForward' : 'rewind');
    }
  };

  const press = (control: DeckControl) => {
    if (!cassette) return;
    const n = tracksRef.current.length;

    if (control === 'flip' || control === 'eject') {
      halt();
      return; // The page changes the side / unloads the tape; the reset effect below rewinds.
    }
    if (control === 'record') {
      halt();
      const current = tracksRef.current[indexRef.current];
      setLatched(['record']);
      setNotice(`RECORDING · ${current?.title ?? 'NEW TRACK'}`);
      return;
    }
    if (control === 'stop') {
      halt();
      setPosition(0);
      if (audioRef.current && isLoaded(indexRef.current)) audioRef.current.currentTime = 0;
      return;
    }
    if (n === 0) {
      halt(`SIDE ${side} IS BLANK`);
      return;
    }
    // Pressing PLAY at the very end of the side starts the side over.
    if (control === 'play' && indexRef.current === n - 1 && posRef.current >= durationOf(n - 1) - 0.25) {
      setIndex(0);
      setPosition(0);
    }
    const next = nextLatched(latchedRef.current, control);
    setLatched(next);
    setNotice(undefined);
    apply(next);
  };

  const seek = (seconds: number) => {
    const p = Math.max(0, Math.min(seconds, durationOf(indexRef.current)));
    const resume = latchedRef.current.includes('play') && !latchedRef.current.includes('pause');
    if (resume) silence();
    setPosition(p);
    if (resume) { void startPlaying(); return; }
    const a = audioRef.current;
    const expiry = loadedRef.current?.expiresAt;
    if (a && isLoaded(indexRef.current) && (expiry === undefined || expiry - Date.now() > 15_000)) a.currentTime = p;
  };

  const skip = (direction: 1 | -1) => {
    if (!cassette) return;
    const n = tracksRef.current.length;
    if (n === 0) {
      flash(`SIDE ${side} IS BLANK`);
      return;
    }
    const to = indexRef.current + direction;
    if (to >= n) {
      flash('LAST SONG ON THIS SIDE');
      return;
    }
    const target = Math.max(0, to); // Back from the first song just restarts it.
    setNotice(undefined);
    setIndex(target);
    setPosition(0);
    const a = audioRef.current;
    if (a && isLoaded(target)) a.currentTime = 0;
    // Playing carries straight on into the new song. Paused / stopped / winding keep their keys;
    // the new song is simply where the tape now sits.
    const keys = latchedRef.current;
    if (keys.includes('play') && !keys.includes('pause') && !keys.includes('fastForward') && !keys.includes('rewind')) {
      void startPlaying();
    }
  };

  // A new tape or a flipped side starts over at the first song with every key up.
  useEffect(() => {
    clearDiagnostic();
    stopWinding();
    opRef.current += 1;
    playback.current.invalidate();
    mediaAttempt.current?.abort();
    errorRetry.current = false;
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute('src');
      a.load();
    }
    loadedRef.current = null;
    setLatched([]);
    setIndex(0);
    setPosition(0);
    setLoading(false);
    setNotice(undefined);
  }, [cassette?.id, side]);

  // Auth callbacks run synchronously, before React switches the visible account.
  useEffect(() => subscribeMediaAccount(() => {
    clearDiagnostic();
    stopWinding();
    opRef.current += 1;
    playback.current.invalidate();
    mediaAttempt.current?.abort();
    const a = audioRef.current;
    a?.pause(); a?.removeAttribute('src'); a?.load();
    loadedRef.current = null;
    setLatched([]); setPosition(0); setIndex(0);
    setLoading(false); setAudioRunning(false); setNotice(undefined);
  }), []);

  // If songs are removed while the tape is in, don't point past the end of the side.
  useEffect(() => {
    if (indexRef.current >= tracks.length && tracks.length > 0) {
      halt();
      setIndex(tracks.length - 1);
      setPosition(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.length]);

  useEffect(() => {
    const loaded = loadedRef.current;
    const current = tracksRef.current[indexRef.current];
    const cassetteId = cassetteIdRef.current;
    if (!loaded || !cassetteId) return;
    const removed = !tracks.some((track) => track.id === loaded.trackId);
    const replaced = current?.id === loaded.trackId && !playback.current.isCurrent(cassetteId, current);
    if (removed || replaced) {
      halt();
      playback.current.invalidate();
      audioRef.current?.removeAttribute('src');
      audioRef.current?.load();
      loadedRef.current = null;
    }
  }, [tracks]);

  // Audio element events: smooth progress while playing, and songs running into each other.
  useEffect(() => {
    const a = audio();
    const tick = () => {
      if (isLoaded(indexRef.current)) setPosition(a.currentTime);
      frame.current = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setAudioRunning(true);
      cancelAnimationFrame(frame.current ?? 0);
      frame.current = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setAudioRunning(false);
      cancelAnimationFrame(frame.current ?? 0);
    };
    const onMeta = () => {
      if (Number.isFinite(a.duration)) setLoadedDuration(a.duration);
    };
    const onEnded = () => {
      const i = indexRef.current;
      if (i + 1 < tracksRef.current.length) {
        setIndex(i + 1);
        setPosition(0);
        void startPlaying();
      } else {
        autoStop(`END OF SIDE ${side}`);
        setIndex(0);
        setPosition(0);
      }
    };
    const onError = () => {
      // During loading, playAudioSource owns this error and its retry. The same
      // native event must not initiate a second competing URL request here.
      if (startingPlayback.current) return;
      const track = tracksRef.current[indexRef.current];
      if (!track || !latchedRef.current.includes('play') || latchedRef.current.includes('pause')) return;
      // One renewal per play/seek attempt; decoding or permission failures must
      // stop instead of repeatedly requesting new bearer URLs.
      if (track.audioReference && !errorRetry.current) {
        errorRetry.current = true;
        if (Number.isFinite(a.currentTime) && a.currentTime > 0) setPosition(a.currentTime);
        void startPlaying(true);
      } else {
        const failure = new MediaPlaybackError(a.error?.code ?? 4);
        reportFailure(failure, 'media-playback', track, a.src);
        loadedRef.current = null;
        playback.current.invalidate();
        halt(playbackFailureMessage(failure));
        a.removeAttribute('src'); a.load();
      }
    };
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('ended', onEnded);
    a.addEventListener('error', onError);
    return () => {
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('ended', onEnded);
      a.removeEventListener('error', onError);
      cancelAnimationFrame(frame.current ?? 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side]);

  // Leaving the page stops the music.
  useEffect(
    () => () => {
      diagnosticTicket.current++;
      diagnosticProbe.current?.abort();
      stopWinding();
      window.clearTimeout(noticeTimer.current);
      opRef.current += 1;
      playback.current.invalidate();
      mediaAttempt.current?.abort();
      audioRef.current?.pause();
      audioRef.current?.removeAttribute('src');
    },
    [],
  );

  const track = tracks[index];
  const duration = track && isLoaded(index) && loadedDuration > 0 ? loadedDuration : (track?.durationSec ?? 0);
  const winding = !latched.includes('pause') && (latched.includes('fastForward') || latched.includes('rewind'));

  let display: string | undefined;
  if (notice) display = notice;
  else if (track && loading) display = `LOADING · ${track.title}`;
  else if (track && latched.includes('fastForward')) display = `▶▶ ${track.title}`;
  else if (track && latched.includes('rewind')) display = `◀◀ ${track.title}`;
  else if (track && latched.includes('play')) display = `${latched.includes('pause') ? '❚❚' : '▶'} ${track.title}`;
  else if (latched.includes('pause')) display = '❚❚ PAUSE';

  return {
    latched,
    display,
    spinning: audioRunning || winding,
    track,
    trackNumber: track ? index + 1 : 0,
    trackCount: tracks.length,
    position: Math.min(position, duration || position),
    duration,
    press,
    seek,
    skip,
    diagnostic,
    clearDiagnostic,
  };
}
