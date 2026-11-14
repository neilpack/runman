export interface Note {
  kind: 'ok' | 'error';
  text: string;
}

/** Inline result message under an account form. Errors are announced immediately. */
export function FormNote({ note }: { note: Note | null }) {
  if (!note) return <p className="account-note" role="status" aria-live="polite" />;
  return note.kind === 'error' ? (
    <p className="account-note error" role="alert">{note.text}</p>
  ) : (
    <p className="account-note account-note-ok" role="status" aria-live="polite">{note.text}</p>
  );
}
