// The RunMan portable player (Walkman-style): transport keys on the top edge, a tape door you
// drop cassettes into, an A/B side lamp, LCD and eject button.
//
// Keys behave like a real Walkman: PLAY, REW, FF and REC lock down when pressed and can't be
// pressed again until STOP (or another transport key, or EJECT) pops them back up. PAUSE toggles
// down/up on its own. FLIP is a plain push button and never locks.
//
// This component does NOT play audio itself. By default it keeps the key state on its own; the
// library page hands control to `useTapeDeck` by passing `latched`, `spinning`, `display` and
// `progress` and handling `onControl`. `side` + FLIP: the page flips the side and the tape animates.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Cassette, TapeSide } from '@runman/shared';
import { isSfxMuted, playSfx, preloadSfx, setSfxMuted } from '@/audio/sfx';
import { FlippableFace } from './FlippableFace';
import './walkman.css';

export type DeckControl = 'pause' | 'play' | 'rewind' | 'fastForward' | 'stop' | 'record' | 'flip' | 'eject';

interface KeyDef {
  id: DeckControl;
  label: string;
  icon: React.ReactNode;
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const TOP_KEYS: KeyDef[] = [
  { id: 'record', label: 'REC', icon: <circle cx="12" cy="12" r="5.5" fill="currentColor" /> },
  { id: 'play', label: 'PLAY', icon: <path {...stroke} d="M7 4.5l12 7.5-12 7.5z" /> },
  { id: 'rewind', label: 'REW', icon: <path {...stroke} d="M11 6l-7 6 7 6zM20 6l-7 6 7 6z" /> },
  { id: 'fastForward', label: 'FF', icon: <path {...stroke} d="M13 6l7 6-7 6zM4 6l7 6-7 6z" /> },
  { id: 'stop', label: 'STOP', icon: <rect {...stroke} x="6" y="6" width="12" height="12" rx="1.5" /> },
  { id: 'pause', label: 'PAUSE', icon: <path {...stroke} d="M9 5v14M15 5v14" /> },
  {
    id: 'flip',
    label: 'FLIP',
    icon: <path {...stroke} d="M4 9a8 8 0 0 1 14-3l2 2M20 4v4h-4M20 15a8 8 0 0 1-14 3l-2-2M4 20v-4h4" />,
  },
];

/** Keys that lock down when pressed (REC also takes PLAY down with it, like a real deck). */
const LATCHING: DeckControl[] = ['play', 'rewind', 'fastForward', 'record'];

/** Which keys are down after `pressed` is pressed. Exported so playback code can reuse the rules. */
export function nextLatched(current: DeckControl[], pressed: DeckControl): DeckControl[] {
  switch (pressed) {
    case 'stop':
    case 'eject':
      return [];
    case 'pause':
      return current.includes('pause') ? current.filter((k) => k !== 'pause') : [...current, 'pause'];
    case 'flip':
      return current;
    case 'record':
      return ['record', 'play'];
    default:
      return [pressed];
  }
}

/** A key that's locked down can't be pressed again (PAUSE toggles, FLIP never locks). */
function isLocked(down: DeckControl[], key: DeckControl): boolean {
  return LATCHING.includes(key) && down.includes(key);
}

export interface CassettePlayerProps {
  loaded?: Cassette;
  side?: TapeSide;
  /** Reels spin while true. Defaults to spinning while PLAY / REW / FF is down (and not paused). */
  spinning?: boolean;
  /** Keys held down. Leave undefined to let the player manage this itself (see nextLatched). */
  latched?: DeckControl[];
  /** LCD text. Defaults to EJECTED / IDLE or the loaded tape name + side. */
  display?: string;
  onControl?: (control: DeckControl) => void;
  /** Highlight the tape door as a drop target. */
  dropHover?: boolean;
  slotRef?: React.Ref<HTMLDivElement>;
  /** Song time slider under the tape door. Omit to hide it. */
  progress?: SongProgress;
}

export interface SongProgress {
  /** Seconds into the song, and its length (0 = no song). */
  position: number;
  duration: number;
  /** Small caption on the left, e.g. "TRK 2/5". */
  label?: string;
  onSeek: (seconds: number) => void;
  /** Previous (-1) / next (1) song buttons at either end of the bar. Omit to hide them. */
  onSkip?: (direction: 1 | -1) => void;
  /** False on the side's last song, which greys out the next-song button. */
  canSkipNext?: boolean;
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function SkipButton({ direction, onSkip, disabled }: { direction: 1 | -1; onSkip: (d: 1 | -1) => void; disabled: boolean }) {
  const label = direction > 0 ? 'Next song' : 'Previous song';
  return (
    <button
      type="button"
      className="wm-skip"
      onPointerDown={() => !disabled && playSfx('keyPress')}
      onClick={() => onSkip(direction)}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {direction > 0 ? <path d="M5 5.5l10 6.5-10 6.5zM18 5.5v13" /> : <path d="M19 5.5L9 12l10 6.5zM6 5.5v13" />}
      </svg>
    </button>
  );
}

function TimeSlider({ position, duration, label, onSeek, onSkip, canSkipNext = true, disabled }: SongProgress & { disabled: boolean }) {
  // While the thumb is held, show where the finger is rather than where the audio has got to.
  const [dragValue, setDragValue] = useState<number | null>(null);
  const value = Math.min(dragValue ?? position, duration);
  const pct = duration > 0 ? (value / duration) * 100 : 0;
  const off = disabled || duration <= 0;

  return (
    <div className={`wm-progress${off ? ' off' : ''}`}>
      {onSkip && <SkipButton direction={-1} onSkip={onSkip} disabled={off} />}
      <span className="wm-progress-label">{label}</span>
      <span className="wm-time">{formatTime(value)}</span>
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={value}
        disabled={off}
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
        onPointerDown={() => setDragValue(position)}
        onPointerUp={() => setDragValue(null)}
        onPointerCancel={() => setDragValue(null)}
        onBlur={() => setDragValue(null)}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (dragValue !== null) setDragValue(v);
          onSeek(v);
        }}
        aria-label="Song position"
        aria-valuetext={`${formatTime(value)} of ${formatTime(duration)}`}
      />
      <span className="wm-time">{formatTime(duration)}</span>
      {onSkip && <SkipButton direction={1} onSkip={onSkip} disabled={off || !canSkipNext} />}
    </div>
  );
}

/** LCD text that scrolls back and forth when it's too long to fit. */
function LcdText({ text }: { text: string }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      const inner = box.firstElementChild as HTMLElement | null;
      setOverflow(inner ? Math.max(0, inner.scrollWidth - box.clientWidth) : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [text]);

  return (
    <span ref={boxRef} className="wm-lcd-text">
      <span
        key={text}
        className={overflow > 0 ? 'scroll' : undefined}
        style={
          overflow > 0
            ? ({ '--shift': `-${overflow}px`, '--dur': `${Math.max(4, overflow / 18 + 3)}s` } as React.CSSProperties)
            : undefined
        }
      >
        {text}
      </span>
    </span>
  );
}

export function CassettePlayer({
  loaded,
  side = 'A',
  spinning,
  latched,
  display,
  onControl,
  dropHover = false,
  slotRef,
  progress,
}: CassettePlayerProps) {
  const text = display ?? (loaded ? `${loaded.name} · SIDE ${side}` : 'EJECTED / IDLE');
  const [muted, setMuted] = useState(isSfxMuted);
  const [ownLatched, setOwnLatched] = useState<DeckControl[]>([]);
  const down = latched ?? ownLatched;
  const reelsTurning =
    spinning ?? (!down.includes('pause') && down.some((k) => k === 'play' || k === 'rewind' || k === 'fastForward'));

  useEffect(() => preloadSfx(), []);

  // A different tape (or no tape) means every key pops back up.
  useEffect(() => setOwnLatched([]), [loaded?.id]);

  const toggleMute = () => {
    setSfxMuted(!muted);
    setMuted(!muted);
  };

  const press = (key: DeckControl) => {
    if (!loaded || isLocked(down, key)) return;
    const next = nextLatched(down, key);
    const poppedUp = down.some((k) => !next.includes(k));
    if (latched === undefined) setOwnLatched(next);
    if (key === 'flip') playSfx('flip');
    else if (key === 'eject') playSfx('eject');
    // Keys springing back up get their own little clack.
    if (poppedUp) window.setTimeout(() => playSfx('keyRelease'), 70);
    onControl?.(key);
  };

  return (
    <div className="walkman-wrap">
      <div className="walkman">
        <div className="wm-keys">
          {TOP_KEYS.map((k) => {
            const isDown = down.includes(k.id);
            const locked = isLocked(down, k.id);
            return (
              <button
                key={k.id}
                type="button"
                className={`wm-key wm-key-${k.id}${isDown ? ' latched' : ''}`}
                // Keys act the moment they go down, like real mechanical keys. Waiting for a click
                // missed presses: the key slides down under the pointer, so a press near its top
                // edge was released over the body instead and the browser never fired a click.
                onPointerDown={(e) => {
                  if (e.button !== 0 || !loaded || locked) return;
                  playSfx('keyPress');
                  press(k.id);
                }}
                // Keyboard (Enter / Space) still arrives as a click with no pointer press (detail 0).
                onClick={(e) => {
                  if (e.detail !== 0 || !loaded || locked) return;
                  playSfx('keyPress');
                  press(k.id);
                }}
                // Momentary keys spring straight back up; latching ones stay down.
                onPointerUp={() => loaded && !locked && !LATCHING.includes(k.id) && k.id !== 'pause' && playSfx('keyRelease')}
                disabled={!loaded}
                aria-disabled={locked || undefined}
                aria-pressed={k.id === 'flip' ? undefined : isDown}
                aria-label={k.label}
                title={locked ? `${k.label} is down · press STOP to release` : k.label}
              >
                <svg
                  viewBox="0 0 24 24"
                  style={k.id === 'flip' ? { transform: `rotate(${side === 'B' ? 180 : 0}deg)` } : undefined}
                >
                  {k.icon}
                </svg>
                <span>{k.label}</span>
              </button>
            );
          })}
        </div>

        <div className="wm-body">
          <span className="wm-wheel" aria-hidden="true" />

          <div className="wm-head">
            <div className="wm-logo">
              <strong>RUNMAN</strong>
              <small>STEREO CASSETTE PLAYER</small>
            </div>
            <button
              type="button"
              className={`wm-mute${muted ? ' muted' : ''}`}
              onClick={toggleMute}
              aria-label={muted ? 'Turn button sounds on' : 'Turn button sounds off'}
              aria-pressed={muted}
              title={muted ? 'Sounds off' : 'Sounds on'}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9h4l5-4v14l-5-4H4z" />
                {muted ? <path d="M17 9l5 5M22 9l-5 5" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />}
              </svg>
            </button>
            <div className={`wm-side${loaded ? '' : ' off'}`} aria-label={`Side ${side}`}>
              <span className={side === 'A' ? 'on' : ''}>A</span>
              <span className={side === 'B' ? 'on' : ''}>B</span>
            </div>
          </div>
          <div className="wm-stripe" />

          <div ref={slotRef} className={`wm-door${loaded ? '' : ' empty'}${dropHover ? ' drop-hover' : ''}`}>
            {loaded && (
              <div className="wm-tape" key={loaded.id}>
                <FlippableFace cassette={loaded} width="88cqw" side={side} spinning={reelsTurning} />
              </div>
            )}
          </div>

          {progress && <TimeSlider {...progress} disabled={!loaded} />}

          <div className="wm-foot">
            <button
              type="button"
              className="wm-eject"
              onClick={() => press('eject')}
              disabled={!loaded}
              aria-label="Eject"
            >
              <svg viewBox="0 0 24 24">
                <path {...stroke} d="M5 14l7-8 7 8zM5 18.5h14" />
              </svg>
              EJECT
            </button>
            <div className={`wm-lcd${loaded ? '' : ' idle'}`} aria-live="polite">
              <LcdText text={text.toUpperCase()} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
