// Side A / Side B tracklist for a cassette, plus the (stubbed) song library picker.

import { useEffect, useState } from 'react';
import type { Cassette, TapeSide, Track } from '@runman/shared';
import { songLibrary, type SongResult } from '@/api/songLibrary';
import { newId } from '@/hooks/useCassettes';
import { SIDE_CAPACITY_SEC } from './constants';

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

  const sideTracks = cassette.tracks.filter((t) => t.side === side);
  const used = sideTracks.reduce((sum, t) => sum + t.durationSec, 0);
  const pct = Math.min(100, (used / SIDE_CAPACITY_SEC) * 100);

  const move = (id: string, dir: -1 | 1) => {
    const ids = sideTracks.map((t) => t.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const reordered = ids.map((tid) => sideTracks.find((t) => t.id === tid)!);
    onChange([...cassette.tracks.filter((t) => t.side !== side), ...reordered]);
  };

  const remove = (id: string) => onChange(cassette.tracks.filter((t) => t.id !== id));

  const add = (song: SongResult) =>
    onChange([
      ...cassette.tracks,
      {
        id: newId(),
        title: song.title,
        artist: song.artist,
        durationSec: song.durationSec,
        audioUrl: song.audioUrl,
        side,
        source: 'library',
      },
    ]);

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

      <div className="tape-meter" title="C60 tape: 30 minutes per side">
        <div className="tape-meter-fill" style={{ width: `${pct}%` }} />
        <span>
          {formatTime(used)} / {formatTime(SIDE_CAPACITY_SEC)}
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
            <li key={t.id} className="track-row">
              <span className="track-num">{i + 1}</span>
              <span className="track-meta">
                <strong>{t.title}</strong>
                <small>{t.artist}</small>
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

      <button type="button" className="studio-btn primary" onClick={() => setPickerOpen(true)}>
        + Add songs to side {side}
      </button>

      {pickerOpen && <SongPicker side={side} onAdd={add} onClose={() => setPickerOpen(false)} />}
    </section>
  );
}

function SongPicker({ side, onAdd, onClose }: { side: TapeSide; onAdd: (s: SongResult) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SongResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!songLibrary.available || !query.trim()) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      songLibrary
        .search(query.trim(), ctrl.signal)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div className="picker" role="dialog" aria-label="Song library" onClick={(e) => e.stopPropagation()}>
        <header className="panel-head">
          <h2>Song library · Side {side}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
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
            {results.map((r) => (
              <li key={r.id} className="track-row">
                <span className="track-meta">
                  <strong>{r.title}</strong>
                  <small>{r.artist}</small>
                </span>
                <span className="track-time">{formatTime(r.durationSec)}</span>
                <button type="button" className="studio-btn" onClick={() => onAdd(r)}>
                  Add
                </button>
              </li>
            ))}
            {query && results.length === 0 && <p className="studio-muted">No matches.</p>}
          </ul>
        )}
      </div>
    </div>
  );
}
