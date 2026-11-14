// Explore: find songs other listeners made public and add them to your tapes, or look up a
// listener by username and visit their page. Data comes from /api/explore (S3 once connected,
// sample data locally). Tab and search live in the URL, so Back returns to the same results.

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { PublicSong } from '@runman/shared';
import { api } from '@/api/client';
import { AddToTapeDialog } from '@/components/explore/AddToTapeDialog';
import { CatalogNote, ListenerGrid } from '@/components/explore/Listeners';
import { LoadError } from '@/components/explore/LoadError';
import { previewPlayer } from '@/components/explore/previewPlayer';
import { SongList, SongListSkeleton, TrendingSongs } from '@/components/explore/Songs';
import { useRemote } from '@/hooks/useRemote';
import '@/components/explore/explore.css';

type Tab = 'songs' | 'listeners';
const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 250;

export function ExplorePage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'listeners' ? 'listeners' : 'songs';
  const q = params.get('q') ?? '';
  const [adding, setAdding] = useState<PublicSong | null>(null);

  // Stop any preview when leaving the page.
  useEffect(() => () => previewPlayer.stop(), []);

  // The box keeps its own text (URL updates are async, so binding it to `q` drops keystrokes)
  // and writes it to the URL after a pause. That URL change is what triggers the search.
  const [text, setText] = useState(q);
  const pushed = useRef(q);
  useEffect(() => {
    // Back/forward or a tab switch changed the URL: show that query.
    if (q !== pushed.current) {
      pushed.current = q;
      setText(q);
    }
  }, [q]);
  useEffect(() => {
    if (text === pushed.current) return;
    const timer = window.setTimeout(() => {
      pushed.current = text;
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (text) next.set('q', text);
          else next.delete('q');
          return next;
        },
        { replace: true },
      );
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text, setParams]);

  const setTab = (next: Tab) => setParams(next === 'listeners' ? { tab: next } : {});

  return (
    <div className="page explore">
      <header className="ex-head">
        <h1>Explore</h1>
        <p className="muted">Find songs other listeners have shared, add them to your tapes, and peek at their mixtapes.</p>
      </header>

      <div className="ex-tabs" role="tablist" aria-label="Explore">
        {(['songs', 'listeners'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`ex-tab-${t}`}
            aria-selected={tab === t}
            aria-controls="ex-panel"
            className={tab === t ? 'on' : ''}
            onClick={() => tab !== t && setTab(t)}
          >
            {t === 'songs' ? 'Songs' : 'Listeners'}
          </button>
        ))}
      </div>

      <div id="ex-panel" role="tabpanel" aria-labelledby={`ex-tab-${tab}`} className="ex-panel">
        <div className="ex-search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={tab === 'songs' ? 'Search songs, artists or usernames' : 'Search usernames'}
            aria-label={tab === 'songs' ? 'Search all shared songs' : 'Search listeners by username'}
            maxLength={tab === 'songs' ? 200 : 25}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {tab === 'songs' ? <SongsTab q={q.trim()} onAdd={setAdding} /> : <ListenersTab q={q.trim()} />}
      </div>

      {adding && <AddToTapeDialog key={adding.id} song={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

function SongsTab({ q, onAdd }: { q: string; onAdd: (song: PublicSong) => void }) {
  const trending = useRemote((signal) => api.trendingSongs(signal), []);
  const first = useRemote((signal) => api.exploreSongs({ q, limit: PAGE_SIZE }, signal), [q]);

  // Pages after the first, for the current query only.
  const [more, setMore] = useState<{ q: string; songs: PublicSong[] }>({ q: '', songs: [] });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string>();
  const extra = more.q === q ? more.songs : [];
  const songs = first.data ? [...first.data.songs, ...extra] : [];
  const total = first.data?.total ?? 0;

  const loadMore = async () => {
    setLoadingMore(true);
    setMoreError(undefined);
    try {
      const page = await api.exploreSongs({ q, limit: PAGE_SIZE, offset: songs.length });
      setMore({ q, songs: [...extra, ...page.songs] });
    } catch (error) {
      setMoreError(error instanceof Error ? error.message : 'Could not load more songs.');
    } finally {
      setLoadingMore(false);
    }
  };

  const catalog = first.data?.catalog ?? trending.data?.catalog;

  return (
    <>
      <CatalogNote catalog={catalog} />

      {!q && (
        <section className="ex-section" aria-labelledby="ex-trending-title">
          <h2 id="ex-trending-title" className="ex-section-title">
            Trending now <span className="ex-flame" aria-hidden="true">🔥</span>
          </h2>
          {trending.error ? (
            <LoadError what="trending songs" error={trending.error} onRetry={trending.retry} />
          ) : !trending.data ? (
            <p className="muted" role="status">Loading trending songs…</p>
          ) : trending.data.songs.length === 0 ? (
            <p className="muted">Nothing is trending yet. Be the first to share a song!</p>
          ) : (
            <TrendingSongs songs={trending.data.songs} onAdd={onAdd} />
          )}
        </section>
      )}

      <section className="ex-section" aria-labelledby="ex-songs-title" aria-busy={first.loading}>
        <h2 id="ex-songs-title" className="ex-section-title">
          {q ? <>Results for “{q}”</> : 'All shared songs'}
          {first.data && <span className="ex-count">{total}</span>}
        </h2>

        {first.error ? (
          <LoadError what="songs" error={first.error} onRetry={first.retry} />
        ) : !first.data ? (
          <SongListSkeleton />
        ) : songs.length === 0 ? (
          <div className="ex-empty">
            {q ? (
              <>
                <p>No songs match “{q}”.</p>
                <p className="muted">Try a song title, an artist, or someone's @username.</p>
              </>
            ) : (
              <>
                <p>No one has shared a song yet.</p>
                <p className="muted">Songs you upload stay private until you choose to make them public.</p>
              </>
            )}
          </div>
        ) : (
          <>
            <SongList songs={songs} onAdd={onAdd} />
            {songs.length < total && (
              <div className="ex-more">
                <button type="button" className="btn btn-secondary" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : `Show more (${total - songs.length} left)`}
                </button>
                {moreError && <p className="error" role="alert">{moreError}</p>}
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}

function ListenersTab({ q }: { q: string }) {
  const result = useRemote((signal) => api.searchListeners(q, signal), [q]);
  const shown = q.replace(/^@/, '');

  return (
    <>
      <CatalogNote catalog={result.data?.catalog} />
      <section className="ex-section" aria-labelledby="ex-listeners-title" aria-busy={result.loading}>
        <h2 id="ex-listeners-title" className="ex-section-title">
          {q ? <>Listeners matching “{shown}”</> : 'Listeners to check out'}
          {result.data && <span className="ex-count">{result.data.total}</span>}
        </h2>
        {result.error ? (
          <LoadError what="listeners" error={result.error} onRetry={result.retry} />
        ) : !result.data ? (
          <p className="muted" role="status">Loading listeners…</p>
        ) : result.data.profiles.length === 0 ? (
          <div className="ex-empty">
            <p>{q ? <>No listener called “{shown}”.</> : 'No public profiles yet.'}</p>
            {q && <p className="muted">Usernames use letters, numbers, dots, dashes and underscores.</p>}
          </div>
        ) : (
          <ListenerGrid listeners={result.data.profiles} />
        )}
      </section>
    </>
  );
}
