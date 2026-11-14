import { useState, type FormEvent } from 'react';
import { Button } from '@/components/Button';
import { accountStore } from '@/profile/account';
import { PASSWORD_RULES, validatePasswordChange, type AccountProfile } from '@/profile/profileModel';
import { FormNote, type Note } from './FormNote';

const EMPTY = { current: '', next: '', confirm: '' };

export function PasswordForm({ profile }: { profile: AccountProfile }) {
  const [fields, setFields] = useState(EMPTY);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  const set = (key: keyof typeof EMPTY) => (value: string) => {
    setFields((f) => ({ ...f, [key]: value }));
    setNote(null);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = validatePasswordChange(fields);
    if (problem) { setNote({ kind: 'error', text: problem }); return; }
    setBusy(true);
    setNote(null);
    const result = await accountStore.changePassword(fields.current, fields.next);
    setBusy(false);
    if (result.ok) {
      setFields(EMPTY);
      setNote({ kind: 'ok', text: 'Password changed. Use it the next time you log in.' });
    } else setNote({ kind: 'error', text: result.error });
  }

  const type = show ? 'text' : 'password';
  const mismatch = fields.confirm.length > 0 && fields.confirm !== fields.next;

  return (
    <form className="account-form" onSubmit={submit} noValidate>
      {/* Lets password managers attach the new password to the right account. */}
      <input type="email" name="username" autoComplete="username" value={profile.email} readOnly hidden />
      <label className="account-field">
        <span>Current password</span>
        <input className="input" type={type} autoComplete="current-password" value={fields.current} onChange={(e) => set('current')(e.target.value)} disabled={busy} />
      </label>
      <label className="account-field">
        <span>New password</span>
        <input className="input" type={type} autoComplete="new-password" value={fields.next} onChange={(e) => set('next')(e.target.value)} aria-describedby="password-rules" disabled={busy} />
      </label>
      <ul id="password-rules" className="account-rules" aria-label="Password rules">
        {PASSWORD_RULES.map((rule) => {
          const met = rule.test(fields.next);
          return (
            <li key={rule.id} className={met ? 'met' : ''}>
              <span aria-hidden="true">{met ? '✓' : '○'}</span> {rule.label}
              <span className="sr-only">{met ? ' (met)' : ' (not met)'}</span>
            </li>
          );
        })}
      </ul>
      <label className="account-field">
        <span>Confirm new password</span>
        <input className="input" type={type} autoComplete="new-password" value={fields.confirm} onChange={(e) => set('confirm')(e.target.value)} aria-invalid={mismatch || undefined} disabled={busy} />
      </label>
      {mismatch && <p className="account-hint error">The new passwords do not match.</p>}
      <label className="account-check">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passwords
      </label>
      <div className="row">
        <Button type="submit" disabled={busy || !fields.current || !fields.next || !fields.confirm}>
          {busy ? 'Changing…' : 'Change password'}
        </Button>
      </div>
      <FormNote note={note} />
    </form>
  );
}
