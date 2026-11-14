import { useEffect } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { AuthHeader } from '@/components/AuthHeader';
import { LANDING_PATH, useSession } from '@/hooks/useSession';
import { FlyingStickers, RetroCassetteStage } from '@/components/welcome/RetroCassetteStage';
import { WelcomeSections } from '@/components/welcome/WelcomeSections';
import { scrollToSection } from '@/components/welcome/scrollToSection';
import '@/styles/auth.css';

/**
 * First screen a signed-out visitor sees; /welcome also lets signed-in users revisit it.
 * The hero fills the first screen; About and Contact follow further down the same page.
 */
export function WelcomePage() {
  const session = useSession();
  const { pathname, hash } = useLocation();
  const ready = session.status !== 'checking' && session.status !== 'signingOut';

  // Arriving with #about / #contact (e.g. a header link on the login page) scrolls to it.
  useEffect(() => {
    if (!ready || !hash) return;
    const frame = requestAnimationFrame(() => scrollToSection(decodeURIComponent(hash.slice(1))));
    return () => cancelAnimationFrame(frame);
    // Only on arrival: links on this page scroll by themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (session.status === 'signedIn' && pathname !== '/welcome') return <Navigate to={LANDING_PATH} replace />;
  if (!ready) return <div className="welcome"><AuthHeader /><main className="login-main"><p role="status">Checking your session…</p></main></div>;

  return (
    <div className="welcome-page">
      <div className="welcome">
        <AuthHeader />
        <FlyingStickers />

        <main className="welcome-hero">
          <section className="welcome-copy">
            <h1 className="welcome-title">Your music, everywhere</h1>
            <p className="welcome-subtitle">Your streaming music, but reimagined as a walkman</p>
            <Link to="/login?mode=signup" className="welcome-cta">
              Sign up
            </Link>
          </section>

          <RetroCassetteStage />
        </main>

        <div className="welcome-desk" aria-hidden="true" />
      </div>

      <WelcomeSections />
    </div>
  );
}
