// Listener search results, and the note shown when Explore is serving sample data.

import { Link } from 'react-router';
import type { ExploreCatalog, ListenerSummary } from '@runman/shared';
import { CassetteFace } from '@/components/cassette/CassetteFace';
import { faceFor } from '@/components/cassette/sides';
import { Avatar } from '@/components/profile/Avatar';
import { listenerPath } from './Songs';
import './explore.css';

export function ListenerCard({ listener }: { listener: ListenerSummary }) {
  const tape = listener.favoriteTape;
  return (
    <li>
      <Link to={listenerPath(listener.username)} className="ex-listener">
        <span className="ex-listener-head">
          <Avatar src={listener.avatar} name={listener.username} size={44} />
          <span className="ex-listener-name">
            <strong>@{listener.username}</strong>
            <small className="muted">
              {listener.songCount} shared {listener.songCount === 1 ? 'song' : 'songs'}
            </small>
          </span>
        </span>
        {tape ? (
          <span className="ex-listener-tape" aria-label={`On display: ${tape.name || 'Untitled'}`}>
            <CassetteFace cassette={faceFor(tape, 'A')} width="100cqw" />
          </span>
        ) : (
          <span className="ex-listener-notape muted">No tape on display</span>
        )}
      </Link>
    </li>
  );
}

export function ListenerGrid({ listeners }: { listeners: ListenerSummary[] }) {
  return (
    <ul className="ex-listeners">
      {listeners.map((l) => (
        <ListenerCard key={l.userId} listener={l} />
      ))}
    </ul>
  );
}

/** Shown when the backend has no S3 bucket and is serving its built-in sample catalog. */
export function CatalogNote({ catalog }: { catalog: ExploreCatalog | undefined }) {
  if (catalog !== 'demo') return null;
  return (
    <p className="ex-note" role="note">
      <strong>Sample data.</strong> The shared-songs bucket isn't connected yet, so these listeners and songs are
      examples. Once it is, songs people make public show up here.
    </p>
  );
}
