// Side A / Side B tracklist for a cassette, plus the (stubbed) song library picker.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Cassette, StoredAudioReference, TapeSide, Track, Visibility } from '@runman/shared';
import { isOwnAudio, visibilityOf } from '@/api/publicSync';
import { songLibrary, type SongResult } from '@/api/songLibrary';
import { newId } from '@/hooks/useCassettes';
import { AudioInput, type UploadedAudioMetadata } from '@/components/AudioInput';
import { SIDE_CAPACITY_SEC } from './constants';

/** Below this much free tape a side shows as full (no real song fits in under a minute). */
const NEARLY_FULL_SEC = 60;

interface TrackListProps {
  cassette: Cassette;
  side: TapeSide;
  onSideChange: (side: TapeSide) => void;
  onChange: (tracks: Track[]) => void;
}

export function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function TrackList({ cassette, side, onSideChange, onChange }: TrackListProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const draggedIdRef = useRef<string | null>(null);
  // Which uploaded song's ⋮⋮ menu is open, and where its button is on screen.
  const [menu, setMenu] = useState<{ trackId: string; anchor: DOMRect } | null>(null);
  const menuTrack = menu ? cassette.tracks.find((t) => t.id === menu.trackId) : undefined;
  const closeMenu = useCallback(() => setMenu(null), []);

  const sideTracks = cassette.tracks.filter((t) => t.side === side);
  const used = sideTracks.reduce((sum, t) => sum + t.durationSec, 0);
  // A C60 tape holds 30 minutes a side: nothing gets added past that.
  const remaining = Math.max(0, SIDE_CAPACITY_SEC - used);
  const full = remaining < 1;
  // With under a minute left there's no room for a real song, so the meter reads as full.
  const nearlyFull = remaining < NEARLY_FULL_SEC;
  const pct = nearlyFull ? 100 : Math.min(100, (used / SIDE_CAPACITY_SEC) * 100);
  const fits = (durationSec: number) => durationSec <= remaining;

  const move = (id: string, dir: -1 | 1) => {
    const ids = sideTracks.map((t) => t.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const reordered = ids.map((tid) => sideTracks.find((t) => t.id === tid)!);
    onChange([...cassette.tracks.filter((t) => t.side !== side), ...reordered]);
  };

  const drop = (targetId: string) => {
    const sourceId = draggedIdRef.current;
    if (!sourceId || sourceId === targetId) return;
    const from = sideTracks.findIndex((t) => t.id === sourceId);
    const to = sideTracks.findIndex((t) => t.id === targetId);
    if (from < 0 || to < 0) return;

    const reordered = [...sideTracks];
    const [dragged] = reordered.splice(from, 1);
    reordered.splice(to, 0, dragged);
    onChange([...cassette.tracks.filter((t) => t.side !== side), ...reordered]);
  };

  const remove = (id: string) => onChange(cassette.tracks.filter((t) => t.id !== id));

  // Saved locally now; the upload to AWS happens when the editor closes (see api/publicSync.ts).
  const setVisibility = (id: string, visibility: Visibility) =>
    onChange(cassette.tracks.map((t) => (t.id === id ? { ...t, visibility } : t)));

  const add = (song: SongResult) => {
    if (!fits(song.durationSec)) return;
    onChange([
      ...cassette.tracks,
      {
        id: newId(),
        sourceId: song.id,
        title: song.title,
        artist: song.artist,
        durationSec: song.durationSec,
        audioUrl: song.audioUrl,
        artworkUrl: song.artworkUrl,
        licenseUrl: song.licenseUrl,
        side,
        source: 'library',
      },
    ]);
  };

  const addUpload = (reference: StoredAudioReference, metadata: UploadedAudioMetadata) => {
    // AudioInput already blocks clips that don't fit; this is the last line of defence.
    if (!fits(metadata.durationSec)) {
      throw new Error(`Side ${side} only has ${formatTime(remaining)} left on the tape.`);
    }
    onChange([
      ...cassette.tracks,
      {
        id: newId(),
        title: metadata.name.replace(/\.[^/.]+$/, '') || 'Uploaded audio',
        artist: 'Your upload',
        durationSec: metadata.durationSec,
        audioReference: reference,
        side,
        source: 'upload',
      },
    ]);
  };

  return (
    <section className="panel tracks">
      <header className="panel-head">
        <h2>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zm11-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3z" />
          </svg>
          Tracklist
        </h2>
        <div className="seg">
          {(['A', 'B'] as const).map((s) => (
            <button key={s} type="button" className={side === s ? 'on' : ''} onClick={() => onSideChange(s)}>
              Side {s}
            </button>
          ))}
        </div>
      </header>

      <div
        className={`tape-meter${nearlyFull ? ' full' : ''}`}
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
        title="C60 tape: 30 minutes per side"
        role="meter"
        aria-label={`Side ${side} tape used`}
        aria-valuemin={0}
        aria-valuemax={SIDE_CAPACITY_SEC}
        aria-valuenow={Math.min(used, SIDE_CAPACITY_SEC)}
        aria-valuetext={`${formatTime(used)} of ${formatTime(SIDE_CAPACITY_SEC)} used`}
      >
        <span>
          {formatTime(used)} / {formatTime(SIDE_CAPACITY_SEC)}
          {full ? ' · FULL' : nearlyFull ? ` · ${formatTime(remaining)} LEFT` : ''}
        </span>
      </div>

      {sideTracks.length === 0 ? (
        <div className="tracks-empty">
          <p>Side {side} is blank.</p>
          <p className="studio-muted">Add songs from the library to start your mix.</p>
        </div>
      ) : (
        <ol className="track-rows">
          {sideTracks.map((t, i) => (
            <li
              key={t.id}
              className={`track-row${draggedId === t.id ? ' dragging' : ''}${dropTargetId === t.id ? ' drop-target' : ''}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', t.id);
                draggedIdRef.current = t.id;
                setDraggedId(t.id);
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                if (draggedIdRef.current !== t.id) setDropTargetId(t.id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (draggedIdRef.current !== t.id) setDropTargetId(t.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(t.id);
                draggedIdRef.current = null;
                setDraggedId(null);
                setDropTargetId(null);
              }}
              onDragEnd={() => {
                draggedIdRef.current = null;
                setDraggedId(null);
                setDropTargetId(null);
              }}
            >
              {isOwnAudio(t) ? (
                <button
                  type="button"
                  className={`track-drag-handle track-menu-btn${menu?.trackId === t.id ? ' open' : ''}`}
                  title="Song options · drag to reorder"
                  aria-label={`Options for ${t.title}`}
                  aria-haspopup="menu"
                  aria-expanded={menu?.trackId === t.id}
                  onClick={(e) => {
                    const anchor = e.currentTarget.getBoundingClientRect();
                    setMenu((m) => (m?.trackId === t.id ? null : { trackId: t.id, anchor }));
                  }}
                >
                  ⋮⋮
                </button>
              ) : (
                <span className="track-drag-handle" aria-hidden="true" title="Drag to reorder">
                  ⋮⋮
                </span>
              )}
              <span className="track-num">{i + 1}</span>
              <span className="track-meta">
                <strong>{t.title}</strong>
                <small>
                  {t.artist}
                  {isOwnAudio(t) && (
                    <span className={`track-visibility ${visibilityOf(t)}`}>
                      {visibilityOf(t) === 'public' ? 'Public' : 'Private'}
                    </span>
                  )}
                </small>
              </span>
              <span className="track-time">{formatTime(t.durationSec)}</span>
              <span className="track-actions">
                <button type="button" onClick={() => move(t.id, -1)} disabled={i === 0} aria-label="Move up">
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(t.id, 1)}
                  disabled={i === sideTracks.length - 1}
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button type="button" onClick={() => remove(t.id)} aria-label="Remove">
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      <button type="button" className="studio-btn primary" onClick={() => setPickerOpen(true)} disabled={full}>
        {full ? `Side ${side} is full (30:00)` : `+ Add songs to side ${side}`}
      </button>

      {menu && menuTrack && (
        <TrackMenu
          track={menuTrack}
          anchor={menu.anchor}
          onPick={(v) => {
            setVisibility(menuTrack.id, v);
            setMenu(null);
          }}
          onClose={closeMenu}
        />
      )}

      {pickerOpen && (
        <SongPicker
          cassetteId={cassette.id}
          side={side}
          remainingSec={remaining}
          onAdd={add}
          onAddUpload={addUpload}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </section>
  );
}

const VISIBILITY_CHOICES: { id: Visibility; label: string; hint: string }[] = [
  { id: 'private', label: 'Private', hint: 'Only you can play it' },
  { id: 'public', label: 'Public', hint: 'Anyone can find it and add it to a tape' },
];

/** Little pop-up menu beside an uploaded song's ⋮⋮ button: choose private or public. */
function TrackMenu({
  track,
  anchor,
  onPick,
  onClose,
}: {
  track: Track;
  anchor: DOMRect;
  onPick: (v: Visibility) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const current = visibilityOf(track);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onDown = (e: PointerEvent) => {
      // Clicking the ⋮⋮ button again is handled by its own toggle.
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest('.track-menu-btn')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // The anchor rect goes stale once anything scrolls, so just close.
    const onScroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  // Fixed to the viewport beside the button. Portalled because the tracklist pane is rotated,
  // which would otherwise trap a fixed element inside it. Flips above when near the bottom.
  const MENU_W = 240;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - MENU_W - 8));
  const openUp = anchor.bottom + 170 > window.innerHeight;
  const style: React.CSSProperties = openUp
    ? { left, bottom: window.innerHeight - anchor.top + 6, width: MENU_W }
    : { left, top: anchor.bottom + 6, width: MENU_W };

  return createPortal(
    <div ref={ref} className="track-menu studio-vars" role="menu" aria-label={`${track.title} visibility`} style={style}>
      <span className="track-menu-title">Who can hear this song?</span>
      {VISIBILITY_CHOICES.map((c, i) => (
        <button
          key={c.id}
          type="button"
          role="menuitemradio"
          aria-checked={current === c.id}
          className={current === c.id ? 'on' : ''}
          onClick={() => onPick(c.id)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const items = ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [];
              const step = e.key === 'ArrowDown' ? 1 : -1;
              items[(i + step + items.length) % items.length]?.focus();
            }
          }}
        >
          <span className="track-menu-check" aria-hidden="true">
            {current === c.id ? '✓' : ''}
          </span>
          <span className="track-menu-text">
            <strong>{c.label}</strong>
            <small>{c.hint}</small>
          </span>
        </button>
      ))}
      <span className="track-menu-foot">Public songs upload when you leave the editor.</span>
    </div>,
    document.body,
  );
}

function SongPicker({
  cassetteId,
  side,
  remainingSec,
  onAdd,
  onAddUpload,
  onClose,
}: {
  cassetteId: string;
  side: TapeSide;
  /** Tape time still free on this side. */
  remainingSec: number;
  onAdd: (s: SongResult) => void;
  onAddUpload: (reference: StoredAudioReference, metadata: UploadedAudioMetadata) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SongResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());
  const [source, setSource] = useState<'library' | 'upload'>('library');

  useEffect(() => {
    if (!songLibrary.available || source !== 'library') return;

    const ctrl = new AbortController();
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(undefined);
      const request = query.trim()
        ? songLibrary.search(query.trim(), ctrl.signal)
        : songLibrary.recommend(ctrl.signal);
      request
        .then((songs) => {
          if (active) setResults(songs);
        })
        .catch((error: unknown) => {
          if (active && (!(error instanceof Error) || error.name !== 'AbortError')) {
            setResults([]);
            setError(error instanceof Error ? error.message : 'The music library could not be loaded.');
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, query.trim() ? 250 : 0);
    return () => {
      active = false;
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [query, source]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Keep the page behind the picker from scrolling while it's open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Rendered into <body> so it covers the whole page: inside the (tilted, scrolling) tracklist
  // pane a fixed overlay would be trapped in that pane's box. `studio-vars` carries the theme.
  return createPortal(
    <div className="picker-backdrop studio-vars" onClick={onClose}>
      <div className="picker" role="dialog" aria-label="Song library" onClick={(e) => e.stopPropagation()}>
        <header className="panel-head">
          <h2>
            {query ? `Search results · Side ${side}` : `Recommended songs · Side ${side}`}
            <small className={`picker-remaining${remainingSec < 60 ? ' low' : ''}`}>
              {formatTime(remainingSec)} left
            </small>
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="picker-sources" role="tablist" aria-label="Song source">
          <button
            type="button"
            role="tab"
            aria-selected={source === 'library'}
            className={source === 'library' ? 'on' : ''}
            onClick={() => setSource('library')}
          >
            Jamendo library
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={source === 'upload'}
            className={source === 'upload' ? 'on' : ''}
            onClick={() => setSource('upload')}
          >
            Upload your audio
          </button>
        </div>
        {source === 'upload' ? (
          <AudioInput
            key={`${cassetteId}-${side}`}
            cassetteId={cassetteId}
            onUploaded={onAddUpload}
            maxDurationSec={remainingSec}
            limitLabel={`Side ${side}`}
          />
        ) : (
          <>
      <input
          className="studio-input"
          placeholder={songLibrary.available ? 'Search songs or artists…' : 'Search (coming soon)'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!songLibrary.available}
          autoFocus
        />
      {!songLibrary.available ? (
          <div className="tracks-empty">
            <p>The song library isn't connected yet.</p>
            <p className="studio-muted">
              Once it is, search results show up here and can be added straight to side {side}.
            </p>
          </div>
      ) : loading ? (
          <p className="studio-muted">Searching…</p>
        ) : (
          <ul className="track-rows">
            {results.map((r) => {
              const added = addedIds.has(r.id);
              const tooLong = !added && r.durationSec > remainingSec;
              return (
              <li key={r.id} className={`track-row${tooLong ? ' too-long' : ''}`}>
                {r.artworkUrl ? (
                  <img className="track-artwork" src={r.artworkUrl} alt="" />
                ) : (
                  <span className="track-artwork-placeholder" aria-hidden="true">♪</span>
                )}
                <span className="track-meta">
                  <strong>{r.title}</strong>
                  <small>{r.artist}</small>
                </span>
                <span className="track-time">{formatTime(r.durationSec)}</span>
                {r.audioUrl && <audio className="track-preview" controls preload="none" src={r.audioUrl} />}
                <button
                  type="button"
                  className={`studio-btn${added ? ' song-added' : ''}`}
                  onClick={() => {
                    if (tooLong) return;
                    onAdd(r);
                    setAddedIds((ids) => new Set(ids).add(r.id));
                  }}
                  disabled={added || tooLong}
                  title={tooLong ? `Only ${formatTime(remainingSec)} left on side ${side}` : undefined}
                >
                  {added ? 'Song Added' : tooLong ? 'Too long' : 'Add'}
                </button>
              </li>
              );
            })}
            {query && results.length === 0 && <p className="studio-muted">No matches.</p>}
          </ul>
        )}
        {error && <p className="picker-error" role="alert">{error}</p>}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
