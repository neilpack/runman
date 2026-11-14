// Song views for Explore: artwork (doubles as the preview button), list rows and trending cards.

import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import type { PublicSong } from '@runman/shared';
import { api } from '@/api/client';
import { formatTime } from '@/components/cassette/TrackList';
import { previewPlayer, usePreviewStatus } from './previewPlayer';
import './explore.css';

function hueFor(id: string): number {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

export const listenerPath = (username: string) => `/explore/u/${encodeURIComponent(username)}`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Cover art (or a colored tile). With audio, it is also the play/pause button for a preview. */
export function SongArt({ song, size }: { song: PublicSong; size: number }) {
  const status = usePreviewStatus(song.id);
  const style = { width: size, height: size, '--art-hue': hueFor(song.id) } as CSSProperties;
  const art = song.artworkUrl ? (
    <img src={song.artworkUrl} alt="" width={size} height={size} loading="lazy" />
  ) : (
    <span className="ex-art-glyph" aria-hidden="true">♪</span>
  );

  if (!song.hasAudio) {
    return (
      <span className="ex-art" style={style} title="No preview available">
        {art}
      </span>
    );
  }

  const playing = status === 'playing' || status === 'loading';
  const label =
    status === 'error'
      ? `Preview of ${song.title} could not play. Try again.`
      : `${playing ? 'Pause' : 'Play'} preview of ${song.title}`;
  return (
    <button
      type="button"
      className={`ex-art ex-art-play is-${status}`}
      style={style}
      onClick={() => previewPlayer.toggle(song.id, api.publicSongAudioUrl(song.id))}
      aria-label={label}
      aria-pressed={playing}
      title={status === 'error' ? 'Preview unavailable' : undefined}
    >
      {art}
      <span className="ex-art-overlay" aria-hidden="true">
        {status === 'error' ? '!' : playing ? '❚❚' : '▶'}
      </span>
    </button>
  );
}

interface SongProps {
  song: PublicSong;
  onAdd: (song: PublicSong) => void;
}

export function SongRow({ song, onAdd, showUploader = true }: SongProps & { showUploader?: boolean }) {
  return (
    <li className="ex-song">
      <SongArt song={song} size={52} />
      <span className="ex-song-meta">
        <strong>{song.title}</strong>
        <small>
          {song.artist}
          {showUploader && (
            <>
              {' · '}
              <Link to={listenerPath(song.uploader.username)} className="ex-uploader">
                @{song.uploader.username}
              </Link>
            </>
          )}
        </small>
      </span>
      <span className="ex-song-time">{formatTime(song.durationSec)}</span>
      <button
        type="button"
        className="btn btn-secondary ex-add"
        onClick={() => onAdd(song)}
        aria-label={`Add ${song.title} to a tape`}
      >
        <span aria-hidden="true">+</span> Add<span className="ex-add-long"> to tape</span>
      </button>
    </li>
  );
}

export function SongList({ songs, onAdd, showUploader }: { songs: PublicSong[]; onAdd: SongProps['onAdd']; showUploader?: boolean }) {
  return (
    <ul className="ex-songs">
      {songs.map((song) => (
        <SongRow key={song.id} song={song} onAdd={onAdd} showUploader={showUploader} />
      ))}
    </ul>
  );
}

export function TrendingSongs({ songs, onAdd }: { songs: PublicSong[]; onAdd: SongProps['onAdd'] }) {
  return (
    <ol className="ex-trending" aria-label="Trending songs">
      {songs.map((song, i) => (
        <li key={song.id} className="ex-trend">
          <span className="ex-trend-rank" aria-label={`Number ${i + 1}`}>
            {i + 1}
          </span>
          <SongArt song={song} size={88} />
          <span className="ex-trend-meta">
            <strong title={song.title}>{song.title}</strong>
            <small>{song.artist}</small>
            <Link to={listenerPath(song.uploader.username)} className="ex-uploader">
              @{song.uploader.username}
            </Link>
          </span>
          <span className="ex-trend-foot">
            <small className="muted">{plural(song.addCount, 'add')}</small>
            <button
              type="button"
              className="btn btn-secondary ex-add"
              onClick={() => onAdd(song)}
              aria-label={`Add ${song.title} to a tape`}
            >
              <span aria-hidden="true">+</span> Add
            </button>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Placeholder rows while songs load. */
export function SongListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="ex-songs" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="ex-song ex-skeleton">
          <span className="ex-art" style={{ width: 52, height: 52 }} />
          <span className="ex-song-meta">
            <span className="ex-skel-line" />
            <span className="ex-skel-line short" />
          </span>
        </li>
      ))}
    </ul>
  );
}
