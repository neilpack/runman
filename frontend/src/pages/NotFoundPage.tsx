import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="page">
      <h1>Page not found</h1>
      <p className="muted">
        <Link to="/">Go home</Link>
      </p>
    </div>
  );
}
