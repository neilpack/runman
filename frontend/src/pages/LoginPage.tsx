import { useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { AuthHeader } from '@/components/AuthHeader';
import { LANDING_PATH, useIsSignedIn } from '@/hooks/useSession';
import '@/styles/auth.css';

type Mode = 'login' | 'signup';

/** Log in / sign up form. `?mode=signup` opens it in sign-up mode. */
export function LoginPage() {
  const signedIn = useIsSignedIn();
  const [params] = useSearchParams();
  const mode: Mode = params.get('mode') === 'signup' ? 'signup' : 'login';
  const [notice, setNotice] = useState<string | null>(null);

  if (signedIn) return <Navigate to={LANDING_PATH} replace />;

  const isSignup = mode === 'signup';

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // TODO(auth): call Amplify signIn / signUp here once Cognito is configured,
    // then navigate(LANDING_PATH, { replace: true }).
    setNotice('Accounts are coming soon. Sign-in is not connected yet.');
  }

  return (
    <div className="welcome">
      <AuthHeader />

      <main className="login-main">
        <form className="login-card" onSubmit={handleSubmit}>
          <h1 className="login-title">{isSignup ? 'Create your account' : 'Welcome back'}</h1>
          <p className="login-subtitle">
            {isSignup ? 'Start your mixtape in seconds.' : 'Log in to pick up where you left off.'}
          </p>

          <label className="login-field">
            <span>Email</span>
            <input
              className="login-input"
              type="email"
              name="email"
              autoComplete="email"
              required
            />
          </label>

          <label className="login-field">
            <span>Password</span>
            <input
              className="login-input"
              type="password"
              name="password"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              minLength={8}
              required
            />
          </label>

          {notice && (
            <p className="login-notice" role="status">
              {notice}
            </p>
          )}

          <button type="submit" className="login-submit">
            {isSignup ? 'Sign up' : 'Log in'}
          </button>

          <p className="login-switch">
            {isSignup ? 'Already have an account? ' : 'New to RUNMAN? '}
            <Link
              to={isSignup ? '/login' : '/login?mode=signup'}
              onClick={() => setNotice(null)}
            >
              {isSignup ? 'Log in' : 'Sign up'}
            </Link>
          </p>
        </form>
      </main>

      <div className="welcome-desk" aria-hidden="true" />
    </div>
  );
}
