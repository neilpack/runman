import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/Button';
import { CassetteFace } from '@/components/cassette/CassetteFace';
import { useCassettes } from '@/hooks/useCassettes';
import { accountStore } from '@/profile/account';
import { snapshotTape, type AccountProfile } from '@/profile/profileModel';
import { FormNote, type Note } from './FormNote';

export function FavoriteTapePicker({ profile }: { profile: AccountProfile }) {
  const cassettes = useCassettes();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const favorite = profile.favoriteTape;
  const live = favorite ? cassettes.find((c) => c.id === favorite.id) : undefined;

  // Keep the published snapshot in step with edits made to the tape in the editor.
  useEffect(() => {
    if (live && favorite && live.updatedAt !== favorite.updatedAt) void accountStore.setFavorite(snapshotTape(live));
  }, [live, favorite]);

  async function choose(id: string | null) {
    const tape = id ? cassettes.find((c) => c.id === id) : undefined;
    setBusy(true);
    setNote(null);
    const result = await accountStore.setFavorite(tape ? snapshotTape(tape) : null);
    setBusy(false);
    if (!result.ok) setNote({ kind: 'error', text: result.error });
    else setNote({ kind: 'ok', text: tape ? `"${tape.name || 'Untitled'}" is now your favorite tape.` : 'Favorite tape cleared.' });
  }

  if (cassettes.length === 0) {
    return (
      <p className="muted">
        You don't have any tapes yet. <Link to="/library">Make one in your library</Link>, then come back to pick a favorite.
      </p>
    );
  }

  return (
    <div className="account-fav">
      {favorite && !live && (
        <p className="account-hint muted">
          "{favorite.name || 'Untitled'}" is no longer in your library, but it stays on your profile until you pick another.
        </p>
      )}
      <div className="account-tapes" role="group" aria-label="Pick your favorite tape">
        {cassettes.map((c) => {
          const selected = favorite?.id === c.id;
          return (
            <button
              key={c.id}
              type="button"
              className={`account-tape${selected ? ' selected' : ''}`}
              aria-pressed={selected}
              disabled={busy}
              onClick={() => { if (!selected) void choose(c.id); }}
            >
              <span className="account-tape-face">
                <CassetteFace cassette={c} width="100cqw" />
              </span>
              <span className="account-tape-name">{c.name || 'Untitled'}</span>
              {selected && <span className="account-tape-badge">★ Favorite</span>}
            </button>
          );
        })}
      </div>
      {favorite && (
        <div className="row">
          <Button type="button" variant="secondary" onClick={() => choose(null)} disabled={busy}>Clear favorite</Button>
        </div>
      )}
      <FormNote note={note} />
    </div>
  );
}
