import { Link, Navigate } from 'react-router';
import { AuthHeader } from '@/components/AuthHeader';
import { LANDING_PATH, useSession } from '@/hooks/useSession';
import { FlyingStickers, RetroCassetteStage } from '@/components/welcome/RetroCassetteStage';
import '@/styles/auth.css';

/** First screen a signed-out visitor sees. Signed-in visitors go straight to the landing page. */
export function WelcomePage() {
  const session = useSession();
  if (session.status === 'signedIn') return <Navigate to={LANDING_PATH} replace />;
  if (session.status === 'checking' || session.status === 'signingOut') return <div className="welcome"><AuthHeader /><main className="login-main"><p role="status">Checking your session…</p></main></div>;

  return (
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
  );
}
