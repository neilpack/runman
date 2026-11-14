// The Walkman floating at the side of every page except the Library, so a tape keeps playing
// (and stays controllable) while you browse Explore, edit a tape or open your account.
// The arrow tab tucks it away against the screen edge; phones start tucked away.

import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { CassettePlayer } from '@/components/cassette/CassettePlayer';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { deckProgress, useDeck } from './DeckProvider';
import './nowPlayingDock.css';

const COLLAPSED_KEY = 'runman.dock.collapsed';
const PHONE = '(max-width: 760px)';

function readCollapsed(): boolean {
  try {
    const saved = localStorage.getItem(COLLAPSED_KEY);
    if (saved !== null) return saved === '1';
  } catch {
    /* storage blocked: fall through to the default */
  }
  return window.matchMedia(PHONE).matches;
}

export function NowPlayingDock() {
  const { loaded, side, setSide, deck, control } = useDeck();
  const { pathname } = useLocation();
  const phone = useMediaQuery(PHONE);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  // Only an actual click is remembered, so the screen-size default can follow the device.
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      /* private mode: only remembered for this visit */
    }
  };

  // The Library has the full-size Walkman; elsewhere, only when a tape is in the deck.
  if (!loaded || pathname === '/library') return null;

  const playing = deck.spinning;
  const nowPlaying = deck.track ? `${deck.track.title} · ${deck.track.artist}` : `${loaded.name} · side ${side}`;

  return (
    <aside className={`np-dock studio-vars${collapsed ? ' collapsed' : ''}${phone ? ' phone' : ''}`} aria-label="Now playing">
      <button
        type="button"
        className="np-toggle"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls="np-panel"
        aria-label={collapsed ? 'Show the RunMan player' : 'Hide the RunMan player'}
        title={collapsed ? 'Show player' : 'Hide player'}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={collapsed ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
        </svg>
        {collapsed && <span className={`np-reel${playing ? ' turning' : ''}`} aria-hidden="true" />}
      </button>

      <div id="np-panel" className="np-panel" hidden={collapsed}>
        <div className="np-head">
          <span className={`np-dot${playing ? ' live' : ''}`} aria-hidden="true" />
          <span className="np-title" title={nowPlaying}>
            {nowPlaying}
          </span>
          <Link to="/library" className="np-open" title="Open the Library">
            Library
          </Link>
        </div>
        <div className="np-walkman">
          <CassettePlayer
            loaded={loaded}
            side={side}
            onSideChange={setSide}
            onControl={control}
            latched={deck.latched}
            spinning={deck.spinning}
            display={deck.display}
            progress={deckProgress(deck)}
          />
        </div>
      </div>
    </aside>
  );
}
