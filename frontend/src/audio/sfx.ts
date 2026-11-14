// UI sound effects for the Walkman (key clicks, eject, insert, flip, FF / REW tape winding).
//
// ─── ADDING YOUR OWN SOUNDS ──────────────────────────────────────────────────────────
//  Drop audio files into  frontend/public/sfx/  using the file names in SFX_FILES below
//  (mp3, wav or ogg all work; change the extension here if yours differ). That's it: any
//  file that's present is used, and any that's missing falls back to a synthesized sound.
//  Keep clips short (< 0.5 s) and trimmed so there's no silence at the start. The two winding
//  sounds are the exception: they loop for as long as FF / REW is held, so make them seamless loops.
// ──────────────────────────────────────────────────────────────────────────────────────

export type SfxName = 'keyPress' | 'keyRelease' | 'eject' | 'insert' | 'flip' | 'fastForward' | 'rewind';

/** The looping sounds played while the tape winds (see startWinding). */
export type WindSound = Extract<SfxName, 'fastForward' | 'rewind'>;

export const SFX_FILES: Record<SfxName, string> = {
  keyPress: '/sfx/key-press.mp3', // a transport key going down
  keyRelease: '/sfx/key-release.mp3', // the key springing back up
  eject: '/sfx/eject.mp3', // tape door popping open
  insert: '/sfx/insert.mp3', // tape clunking into the door
  flip: '/sfx/flip.mp3', // tape being turned over
  fastForward: '/sfx/fast-forward.mp3', // looped while FF winds the tape
  rewind: '/sfx/rewind.mp3', // looped while REW winds the tape
};

/** Per-sound volume, 0-1. */
const VOLUME: Record<SfxName, number> = {
  keyPress: 0.8,
  keyRelease: 0.5,
  eject: 0.8,
  insert: 0.9,
  flip: 0.6,
  fastForward: 0.5,
  rewind: 0.5,
};

const MUTE_KEY = 'runman.sfx.muted';

let ctx: AudioContext | null = null;
/** undefined = not loaded yet, null = no file (use the synth fallback). */
const buffers = new Map<SfxName, AudioBuffer | null>();
const loading = new Map<SfxName, Promise<AudioBuffer | null>>();
let muted = readMuted();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isSfxMuted() {
  return muted;
}

export function setSfxMuted(value: boolean) {
  muted = value;
  if (value) activeWinds.forEach((stop) => stop());
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    /* private mode: keep it in memory */
  }
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function load(name: SfxName): Promise<AudioBuffer | null> {
  const existing = loading.get(name);
  if (existing) return existing;
  const c = audio();
  const p = (async () => {
    if (!c) return null;
    try {
      const res = await fetch(SFX_FILES[name]);
      // A missing file comes back as the SPA's index.html, so check the type too.
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || type.includes('text/html')) return null;
      return await c.decodeAudioData(await res.arrayBuffer());
    } catch {
      return null;
    }
  })().then((buf) => {
    buffers.set(name, buf);
    return buf;
  });
  loading.set(name, p);
  return p;
}

/** Start fetching/decoding every sound so the first press has no delay. */
export function preloadSfx() {
  (Object.keys(SFX_FILES) as SfxName[]).forEach((n) => void load(n));
}

export function playSfx(name: SfxName) {
  if (muted) return;
  const c = audio();
  if (!c) return;
  const buf = buffers.get(name);
  if (buf === undefined) {
    void load(name).then(() => playSfx(name));
    return;
  }
  const gain = c.createGain();
  gain.gain.value = VOLUME[name];
  gain.connect(c.destination);
  if (buf) {
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    src.start();
  } else {
    synth(c, name, gain);
  }
}

// ---------------------------------------------------------------------------
// FF / REW winding loop
// ---------------------------------------------------------------------------

const activeWinds = new Set<() => void>();

/**
 * Start the whirr of the tape winding. Returns a function that fades it out; call it when the
 * key pops up. Uses public/sfx/fast-forward.mp3 / rewind.mp3 when present, else a synth.
 */
export function startWinding(name: WindSound): () => void {
  if (muted) return () => {};
  const c = audio();
  if (!c) return () => {};
  const buf = buffers.get(name);
  if (buf === undefined) void load(name); // Not ready this time; the synth covers it.

  const t = c.currentTime;
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(VOLUME[name], t + 0.12);
  out.connect(c.destination);

  const sources: AudioScheduledSourceNode[] = buf ? [loopFile(c, buf, out)] : windSynth(c, name, out);
  sources.forEach((s) => s.start(t));

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    activeWinds.delete(stop);
    const now = c.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), now);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    sources.forEach((s) => s.stop(now + 0.2));
    window.setTimeout(() => out.disconnect(), 300);
  };
  activeWinds.add(stop);
  return stop;
}

function loopFile(c: AudioContext, buf: AudioBuffer, out: AudioNode): AudioBufferSourceNode {
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.connect(out);
  return src;
}

/**
 * A synthesized cassette wind: the motor's whine spinning up (rewind runs a little higher), a
 * band of tape hiss, and a fast flutter from the reels, all looping until stopped.
 */
function windSynth(c: AudioContext, name: WindSound, out: AudioNode): AudioScheduledSourceNode[] {
  const t = c.currentTime;
  const base = name === 'rewind' ? 190 : 160;

  // Motor whine, spinning up over the first second and a half.
  const motor = c.createOscillator();
  motor.type = 'sawtooth';
  motor.frequency.setValueAtTime(base * 0.6, t);
  motor.frequency.exponentialRampToValueAtTime(base * 1.6, t + 1.5);
  const motorTone = c.createBiquadFilter();
  motorTone.type = 'lowpass';
  motorTone.frequency.value = 1100;
  const motorGain = c.createGain();
  motorGain.gain.value = 0.18;
  motor.connect(motorTone).connect(motorGain).connect(out);

  // Pitch wobble, so it sounds mechanical rather than like a synth note.
  const wobble = c.createOscillator();
  wobble.frequency.value = 6.5;
  const wobbleDepth = c.createGain();
  wobbleDepth.gain.value = base * 0.04;
  wobble.connect(wobbleDepth).connect(motor.frequency);

  // Tape hiss rushing past the heads.
  const hiss = noise(c, 2);
  hiss.loop = true;
  const hissBand = c.createBiquadFilter();
  hissBand.type = 'bandpass';
  hissBand.frequency.setValueAtTime(900, t);
  hissBand.frequency.exponentialRampToValueAtTime(name === 'rewind' ? 2600 : 2200, t + 1.5);
  hissBand.Q.value = 0.9;
  const hissGain = c.createGain();
  hissGain.gain.value = 0.55;
  hiss.connect(hissBand).connect(hissGain).connect(out);

  // Reel flutter: the hiss pulses quickly as the spools turn.
  const flutter = c.createOscillator();
  flutter.frequency.setValueAtTime(9, t);
  flutter.frequency.linearRampToValueAtTime(name === 'rewind' ? 17 : 14, t + 1.5);
  const flutterDepth = c.createGain();
  flutterDepth.gain.value = 0.22;
  flutter.connect(flutterDepth).connect(hissGain.gain);

  return [motor, wobble, hiss, flutter];
}

// ---------------------------------------------------------------------------
// Synthesized fallbacks (used until real files are added)
// ---------------------------------------------------------------------------

function noise(c: AudioContext, seconds: number): AudioBufferSourceNode {
  const len = Math.max(1, Math.floor(c.sampleRate * seconds));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  return src;
}

function burst(c: AudioContext, out: AudioNode, opts: { at?: number; dur: number; freq: number; q?: number; level: number }) {
  const t = c.currentTime + (opts.at ?? 0);
  const src = noise(c, opts.dur);
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = opts.freq;
  filter.Q.value = opts.q ?? 1;
  const g = c.createGain();
  g.gain.setValueAtTime(opts.level, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + opts.dur);
  src.connect(filter).connect(g).connect(out);
  src.start(t);
}

function thump(c: AudioContext, out: AudioNode, opts: { at?: number; dur: number; from: number; to: number; level: number }) {
  const t = c.currentTime + (opts.at ?? 0);
  const osc = c.createOscillator();
  osc.frequency.setValueAtTime(opts.from, t);
  osc.frequency.exponentialRampToValueAtTime(opts.to, t + opts.dur);
  const g = c.createGain();
  g.gain.setValueAtTime(opts.level, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + opts.dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + opts.dur);
}

function synth(c: AudioContext, name: SfxName, out: AudioNode) {
  switch (name) {
    case 'keyPress':
      burst(c, out, { dur: 0.03, freq: 2600, level: 0.9 });
      thump(c, out, { dur: 0.05, from: 220, to: 90, level: 0.5 });
      break;
    case 'keyRelease':
      burst(c, out, { dur: 0.02, freq: 3800, level: 0.5 });
      break;
    case 'eject':
      burst(c, out, { dur: 0.04, freq: 1800, level: 0.9 });
      thump(c, out, { at: 0.03, dur: 0.14, from: 320, to: 110, level: 0.5 });
      burst(c, out, { at: 0.12, dur: 0.05, freq: 3000, level: 0.4 });
      break;
    case 'insert':
      burst(c, out, { dur: 0.05, freq: 1200, level: 0.8 });
      thump(c, out, { dur: 0.1, from: 160, to: 70, level: 0.8 });
      burst(c, out, { at: 0.07, dur: 0.03, freq: 2600, level: 0.5 });
      break;
    case 'flip': {
      const t = c.currentTime;
      const src = noise(c, 0.4);
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 2;
      filter.frequency.setValueAtTime(500, t);
      filter.frequency.exponentialRampToValueAtTime(2500, t + 0.35);
      const g = c.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      src.connect(filter).connect(g).connect(out);
      src.start(t);
      burst(c, out, { at: 0.4, dur: 0.04, freq: 1500, level: 0.6 });
      break;
    }
    case 'fastForward':
    case 'rewind':
      // Winding sounds loop; they're played with startWinding, not as one-shots.
      break;
  }
}
