// The RunMan portable player (Walkman-style): transport keys on the top edge, a tape door you
// drop cassettes into, an A/B side lamp, LCD and eject button.
//
// Keys behave like a real Walkman: PLAY, REW, FF and REC lock down when pressed and can't be
// pressed again until STOP (or another transport key, or EJECT) pops them back up. PAUSE toggles
// down/up on its own. FLIP is a plain push button and never locks.
//
// This component does NOT play audio. By default it keeps the key state itself; a playback
// implementation can take over by passing `latched` (and `spinning`) and handling `onControl`.
// `side` + the FLIP key already work: the page flips the side and the tape animates over.

import { useEffect, useState } from 'react';
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
                onClick={() => press(k.id)}
                onPointerDown={() => loaded && !locked && playSfx('keyPress')}
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
            <div className={`wm-lcd${loaded ? '' : ' idle'}`}>{text.toUpperCase()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
