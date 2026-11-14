// One sound at a time. The Walkman deck keeps playing as you move around the app, so it would
// otherwise talk over Explore's song previews and the editor's preview players. Each player
// registers how to pause itself; whichever starts next takes the focus and the others pause.

const players = new Map<string, () => void>();

/** Register a player under `id`. `pause` is called when another player takes the focus. */
export function registerAudio(id: string, pause: () => void): () => void {
  players.set(id, pause);
  return () => {
    if (players.get(id) === pause) players.delete(id);
  };
}

/** `id` is about to make sound: pause every other registered player. */
export function takeAudioFocus(id: string) {
  for (const [other, pause] of players) if (other !== id) pause();
}

/**
 * <audio controls> elements on a page (song picker / upload previews) aren't registered
 * individually: playing any of them takes the focus as 'page-media', and taking the focus from
 * them pauses them all.
 */
let pageMediaWatched = false;
export function watchPageMedia() {
  if (pageMediaWatched || typeof document === 'undefined') return;
  pageMediaWatched = true;
  // Media 'play' events don't bubble, so listen in the capture phase.
  document.addEventListener('play', (e) => e.target instanceof HTMLMediaElement && takeAudioFocus('page-media'), true);
  registerAudio('page-media', () => document.querySelectorAll('audio, video').forEach((m) => (m as HTMLMediaElement).pause()));
}
