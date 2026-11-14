import { Link, useLocation, useNavigate } from 'react-router';
import { WELCOME_SECTIONS, scrollToSection } from '@/components/welcome/scrollToSection';

const WELCOME_PATHS = ['/', '/welcome'];

/** Top bar for the signed-out screens (welcome + login): links left, wordmark centered, log in right. */
export function AuthHeader() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const onWelcome = WELCOME_PATHS.includes(pathname);
  // About / Contact live further down the welcome page. From the login page the links open the
  // welcome page at that section; on the welcome page they just scroll there.
  const base = onWelcome ? pathname : '/';

  return (
    <header className="welcome-header">
      <nav className="welcome-nav" aria-label="Site">
        {WELCOME_SECTIONS.map((section) => (
          <Link
            key={section.id}
            to={{ pathname: base, hash: `#${section.id}` }}
            className="welcome-nav-link"
            onClick={(e) => {
              if (!onWelcome || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              // Keep the address bar in step (shareable link), without React Router's own jump.
              navigate({ pathname, hash: `#${section.id}` }, { replace: true, preventScrollReset: true });
              scrollToSection(section.id);
            }}
          >
            {section.label}
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
