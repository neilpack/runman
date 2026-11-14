import './explore.css';

export function LoadError({ what, error, onRetry }: { what: string; error: Error; onRetry: () => void }) {
  return (
    <div className="ex-empty" role="alert">
      <p>
        <strong>Couldn't load {what}.</strong>
      </p>
      <p className="muted">{error.message.replace(/\.$/, '')}. Check that the backend is running (npm run dev).</p>
      <button type="button" className="btn btn-secondary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
