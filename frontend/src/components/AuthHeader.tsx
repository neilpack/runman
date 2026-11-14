import { Link } from 'react-router';

// Routes for these pages don't exist yet; they fall through to NotFound until someone builds them.
const NAV_LINKS = [
  { to: '/about', label: 'About Us' },
  { to: '/chat', label: 'Chat with Us' },
];

/** Top bar for the signed-out screens (welcome + login): links left, wordmark centered, log in right. */
export function AuthHeader() {
  return (
    <header className="welcome-header">
      <nav className="welcome-nav" aria-label="Site">
        {NAV_LINKS.map((link) => (
          <Link key={link.to} to={link.to} className="welcome-nav-link">
            {link.label}
          </Link>
        ))}
      </nav>
      <Link to="/" className="welcome-brand" aria-label="RUNMAN home">
        RUNMAN
      </Link>
      <div className="welcome-actions">
        <Link to="/login" className="welcome-login">
          Log in
        </Link>
      </div>
    </header>
  );
}
