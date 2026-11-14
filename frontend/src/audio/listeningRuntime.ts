import type { Track } from '@runman/shared';
import { api } from '@/api/client';
import { getMediaAccount, subscribeMediaAccount } from '@/auth/mediaContext';
import { createListeningTracker } from './listeningTracker';

export function watchListening(audio: HTMLAudioElement, currentTrack: () => Track | undefined) {
  const tracker = createListeningTracker({ api: api.listening, account: getMediaAccount, subscribe: subscribeMediaAccount, randomId: () => crypto.randomUUID(), changed: () => window.dispatchEvent(new Event('runman:plays-updated')) });
  let stoppedAt: number | undefined;
  const sample = (ending = false) => { tracker.select(currentTrack()); tracker.sample(performance.now(), audio.currentTime, (ending || !audio.paused) && audio.readyState >= 2, audio.seeking, audio.playbackRate); };
  const playing = () => {
    if (stoppedAt !== undefined && stoppedAt > 0.5 && audio.currentTime < 0.25) tracker.finish();
    stoppedAt = undefined; sample();
  };
  const pause = () => { sample(true); stoppedAt = audio.currentTime; tracker.pause(); };
  const update = () => sample();
  const seeking = () => tracker.pause();
  const ended = () => { sample(true); tracker.ended(); };
  const emptied = () => { if (!currentTrack()) tracker.finish(); else tracker.pause(); };
  const handlers = { playing, timeupdate: update, pause, seeking, ended, emptied, error: pause, waiting: pause };
  for (const [name, handler] of Object.entries(handlers)) audio.addEventListener(name, handler);
  return () => { for (const [name, handler] of Object.entries(handlers)) audio.removeEventListener(name, handler); tracker.dispose(); };
}
