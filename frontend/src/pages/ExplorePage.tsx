// Explore: find songs other listeners made public and add them to your tapes, browse public tapes,
// or look up a listener by username and visit their page. Data comes from /api/explore.
// Tab and search live in the URL, so Back returns to the same results.

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { PublicSong } from '@runman/shared';
import { api } from '@/api/client';
import { AddToTapeDialog } from '@/components/explore/AddToTapeDialog';
import { CatalogNote, ListenerGrid } from '@/components/explore/Listeners';
import { LoadError } from '@/components/explore/LoadError';
import { previewPlayer } from '@/components/explore/previewPlayer';
import { SongList, SongListSkeleton, TrendingSongs } from '@/components/explore/Songs';
import { TapeGrid } from '@/components/explore/Tapes';
import { useRemote } from '@/hooks/useRemote';
import '@/components/explore/explore.css';

type Tab = 'songs' | 'tapes' | 'listeners';
const TABS: { id: Tab; label: string; placeholder: string; label2: string; max: number }[] = [
  { id: 'songs', label: 'Songs', placeholder: 'Search songs, artists or usernames', label2: 'Search all shared songs', max: 200 },
  { id: 'tapes', label: 'Tapes', placeholder: 'Search tape names, songs or usernames', label2: 'Search public tapes', max: 200 },
  { id: 'listeners', label: 'Listeners', placeholder: 'Search usernames', label2: 'Search listeners by username', max: 25 },
];
const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 250;

export function ExplorePage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find((t) => t.id === params.get('tab'))?.id ?? 'songs';
  const current = TABS.find((t) => t.id === tab)!;
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

  const setTab = (next: Tab) => setParams(next === 'songs' ? {} : { tab: next });

  return (
    <div className="page explore">
      <header className="ex-head">
        <h1>Explore</h1>
        <p className="muted">Find songs other listeners have shared, add them to your tapes, and play their public mixtapes.</p>
      </header>

      <div className="ex-tabs" role="tablist" aria-label="Explore">
        {TABS.map(({ id: t, label }) => (
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
            {label}
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
            placeholder={current.placeholder}
            aria-label={current.label2}
            maxLength={current.max}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {tab === 'songs' ? <SongsTab q={q.trim()} onAdd={setAdding} /> : tab === 'tapes' ? <TapesTab q={q.trim()} /> : <ListenersTab q={q.trim()} />}
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

function TapesTab({ q }: { q: string }) {
  const result = useRemote((signal) => api.exploreTapes({ q, limit: 50 }, signal), [q]);
  return (
    <>
      <CatalogNote catalog={result.data?.catalog} />
      <section className="ex-section" aria-labelledby="ex-tapes-title" aria-busy={result.loading}>
        <h2 id="ex-tapes-title" className="ex-section-title">
          {q ? <>Tapes matching “{q}”</> : 'Public tapes'}
          {result.data && <span className="ex-count">{result.data.total}</span>}
        </h2>
        {result.error ? (
          <LoadError what="tapes" error={result.error} onRetry={result.retry} />
        ) : !result.data ? (
          <p className="muted" role="status">Loading tapes…</p>
        ) : result.data.tapes.length === 0 ? (
          <div className="ex-empty">
            <p>{q ? <>No public tapes match “{q}”.</> : 'No one has shared a tape yet.'}</p>
            <p className="muted">Make one of your tapes public in the editor and it shows up here when you leave the editor.</p>
          </div>
        ) : (
          <TapeGrid tapes={result.data.tapes} />
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
