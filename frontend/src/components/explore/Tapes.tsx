// Public tape cards for Explore and listener pages. Each opens the tape's own page.

import { Link } from 'react-router';
import type { PublicTape } from '@runman/shared';
import { CassetteFace } from '@/components/cassette/CassetteFace';
import { faceFor } from '@/components/cassette/sides';
import './explore.css';

export const tapePath = (id: string) => `/explore/tapes/${encodeURIComponent(id)}`;

export function TapeCard({ tape, showOwner = true }: { tape: PublicTape; showOwner?: boolean }) {
  const count = tape.tape.tracks.length;
  const name = tape.tape.name || 'Untitled';
  return (
    <li>
      <Link to={tapePath(tape.id)} className="ex-listener ex-tape-card">
        <span className="ex-listener-tape" aria-hidden="true">
          <CassetteFace cassette={faceFor(tape.tape, 'A')} width="100cqw" />
        </span>
        <span className="ex-listener-name">
          <strong>{name}</strong>
          <small className="muted">
            {showOwner && <>@{tape.owner.username} · </>}
            {count} {count === 1 ? 'song' : 'songs'}
          </small>
        </span>
      </Link>
    </li>
  );
}

export function TapeGrid({ tapes, showOwner = true }: { tapes: PublicTape[]; showOwner?: boolean }) {
  return (
    <ul className="ex-listeners">
      {tapes.map((t) => (
        <TapeCard key={t.id} tape={t} showOwner={showOwner} />
      ))}
    </ul>
  );
}
