import { useState, type FormEvent } from 'react';
import { Button } from '@/components/Button';
import { accountStore } from '@/profile/account';
import { USERNAME_MAX, validateUsername, type AccountProfile } from '@/profile/profileModel';
import { FormNote, type Note } from './FormNote';

export function UsernameForm({ profile }: { profile: AccountProfile }) {
  const saved = profile.hasUsername ? profile.username : '';
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  const trimmed = value.trim();
  const problem = trimmed ? validateUsername(trimmed) : null;
  const unchanged = trimmed === saved;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (problem || unchanged || !trimmed) return;
    setBusy(true);
    setNote(null);
    const result = await accountStore.setUsername(trimmed);
    setBusy(false);
    setNote(result.ok ? { kind: 'ok', text: `You're now @${trimmed}.` } : { kind: 'error', text: result.error });
  }

  return (
    <form className="account-form" onSubmit={submit} noValidate>
      <label className="account-field">
        <span>Username</span>
        <div className="account-handle">
          <span aria-hidden="true">@</span>
          <input
            className="input"
            value={value}
            onChange={(e) => { setValue(e.target.value); setNote(null); }}
            placeholder={profile.username}
            maxLength={USERNAME_MAX + 8}
            autoComplete="nickname"
            spellCheck={false}
            aria-invalid={problem ? true : undefined}
            aria-describedby="username-hint"
            disabled={busy}
          />
        </div>
      </label>
      <p id="username-hint" className={problem ? 'account-hint error' : 'account-hint muted'}>
        {problem ?? 'This is the name other listeners see. Letters, numbers, dots, dashes and underscores.'}
      </p>
      <div className="row">
        <Button type="submit" disabled={busy || unchanged || !trimmed || problem !== null}>
          {busy ? 'Saving…' : 'Save username'}
        </Button>
      </div>
      <FormNote note={note} />
    </form>
  );
}
