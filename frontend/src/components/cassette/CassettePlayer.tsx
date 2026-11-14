// The RunMan portable player (Walkman-style): transport keys on the top edge, a tape door you
// drop cassettes into, an A/B side lamp, LCD, eject slider, and wired orange headphones.
//
// This component is presentational. It does NOT play audio. Whoever implements playback should
// own the state and pass it in: handle `onControl`, then drive `spinning`, `latched`, `display`.
// `side` + the FLIP key already work: the page flips the side and the tape animates over.

import type { Cassette, TapeSide } from '@runman/shared';
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

export interface CassettePlayerProps {
  loaded?: Cassette;
  side?: TapeSide;
  /** Reels spin while true (set by the playback implementation). */
  spinning?: boolean;
  /** Keys that should look held down, e.g. ['play'] while playing. */
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
  spinning = false,
  latched = [],
  display,
  onControl,
  dropHover = false,
  slotRef,
}: CassettePlayerProps) {
  const text = display ?? (loaded ? `${loaded.name} · SIDE ${side}` : 'EJECTED / IDLE');

  return (
    <div className="walkman-wrap">
      <Headphones />

      <div className="walkman">
        <div className="wm-keys">
          {TOP_KEYS.map((k) => (
            <button
              key={k.id}
              type="button"
              className={`wm-key wm-key-${k.id}${latched.includes(k.id) ? ' latched' : ''}`}
              onClick={() => onControl?.(k.id)}
              disabled={!loaded}
              aria-label={k.label}
            >
              <svg
                viewBox="0 0 24 24"
                style={k.id === 'flip' ? { transform: `rotate(${side === 'B' ? 180 : 0}deg)` } : undefined}
              >
                {k.icon}
              </svg>
              <span>{k.label}</span>
            </button>
          ))}
        </div>

        <div className="wm-body">
          <span className="wm-jack" aria-hidden="true" />
          <span className="wm-wheel" aria-hidden="true" />

          <div className="wm-head">
            <div className="wm-logo">
              <strong>RUNMAN</strong>
              <small>STEREO CASSETTE PLAYER</small>
            </div>
            <div className={`wm-side${loaded ? '' : ' off'}`} aria-label={`Side ${side}`}>
              <span className={side === 'A' ? 'on' : ''}>A</span>
              <span className={side === 'B' ? 'on' : ''}>B</span>
            </div>
          </div>
          <div className="wm-stripe" />

          <div ref={slotRef} className={`wm-door${loaded ? '' : ' empty'}${dropHover ? ' drop-hover' : ''}`}>
            {loaded && (
              <div className="wm-tape" key={loaded.id}>
                <FlippableFace cassette={loaded} width="88cqw" side={side} spinning={spinning} />
              </div>
            )}
          </div>

          <div className="wm-foot">
            <button
              type="button"
              className="wm-eject"
              onClick={() => onControl?.('eject')}
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

/** Orange foam-pad headphones, wired into the player's jack. Purely decorative. */
function Headphones() {
  return (
    <svg className="wm-phones" viewBox="0 0 220 300" aria-hidden="true">
      <defs>
        <linearGradient id="wm-band" x1="0" x2="1">
          <stop offset="0" stopColor="#6b7280" />
          <stop offset="0.5" stopColor="#f3f4f6" />
          <stop offset="1" stopColor="#6b7280" />
        </linearGradient>
        <radialGradient id="wm-foam" cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#ffb057" />
          <stop offset="0.6" stopColor="#ff7a1a" />
          <stop offset="1" stopColor="#c44d00" />
        </radialGradient>
        <pattern id="wm-foam-dots" width="5" height="5" patternUnits="userSpaceOnUse">
          <circle cx="2.5" cy="2.5" r="0.9" fill="rgba(120,40,0,0.35)" />
        </pattern>
      </defs>

      {/* cord: from the jack on the player's right side up into the left ear cup */}
      <path
        className="wm-cord"
        d="M4 128 C 40 132, 30 250, 80 240 S 100 190, 96 168"
        fill="none"
        stroke="#1d1d22"
        strokeWidth="3.2"
        strokeLinecap="round"
      />

      <g transform="rotate(-10 140 110)">
        <path d="M96 140 C 88 30, 196 30, 188 140" fill="none" stroke="url(#wm-band)" strokeWidth="7" strokeLinecap="round" />
        <path d="M101 134 C 96 46, 184 46, 179 134" fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="1.5" />
        <rect x="90" y="122" width="12" height="22" rx="3" fill="#9ca3af" />
        <rect x="182" y="122" width="12" height="22" rx="3" fill="#9ca3af" />
        {[96, 188].map((cx) => (
          <g key={cx}>
            <ellipse cx={cx} cy="168" rx="25" ry="30" fill="url(#wm-foam)" />
            <ellipse cx={cx} cy="168" rx="25" ry="30" fill="url(#wm-foam-dots)" />
            <ellipse cx={cx - 7} cy="156" rx="8" ry="6" fill="rgba(255,255,255,0.28)" />
          </g>
        ))}
      </g>
    </svg>
  );
}
