import { useLayoutEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import * as auth from 'aws-amplify/auth';
import { AuthHeader } from '@/components/AuthHeader';
import { createAuthFlow, type AuthMode } from '@/auth/authFlow';
import { sessionStore } from '@/auth/session';
import { LANDING_PATH, useSession } from '@/hooks/useSession';
import '@/styles/auth.css';

const headings: Record<AuthMode, [string, string, string]> = {
  login: ['Welcome back', 'Log in to pick up where you left off.', 'Log in'],
  signup: ['Create your account', 'Start your mixtape in seconds.', 'Sign up'],
  confirmSignup: ['Check your email', 'Enter your confirmation code to finish signing up.', 'Confirm email'],
  requestReset: ['Reset your password', 'Request a reset code at your account email.', 'Send reset code'],
  confirmReset: ['Choose a new password', 'Enter your reset code and a new password.', 'Reset password'],
};

function LoginForm({ initialMode }: { initialMode: AuthMode }) {
  const session = useSession();
  const [flow] = useState(() => createAuthFlow(auth, sessionStore, initialMode));
  const state = useSyncExternalStore(flow.subscribe, flow.getSnapshot, flow.getSnapshot);
  useLayoutEffect(() => { flow.activate(); return () => flow.dispose(); }, [flow]);
  const [title, subtitle, submitText] = headings[state.mode];
  const hasCode = state.mode === 'confirmSignup' || state.mode === 'confirmReset';
  const hasPassword = state.mode === 'login' || state.mode === 'signup' || state.mode === 'confirmReset';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void flow.submit({
      email: String(fields.get('email') ?? state.email),
      password: String(fields.get('password') ?? ''),
      code: String(fields.get('code') ?? ''),
    });
  }

  return (
    <div className="welcome">
      <AuthHeader />
      <main className="login-main">
        {session.status === 'unavailable' ? (
          <section className="login-card"><h1 className="login-title">Sign-in unavailable</h1><p>Sign-in is not configured for this build. Please contact the team.</p></section>
        ) : (session.status === 'checking' && !state.pending) || session.status === 'signingOut' ? (
          <section className="login-card"><p role="status">Checking your session…</p></section>
        ) : (
          <form key={state.mode} className="login-card" onSubmit={submit} aria-busy={state.pending}>
            <h1 className="login-title">{title}</h1>
            <p className="login-subtitle">{subtitle}</p>
            <fieldset className="login-fields" disabled={state.pending}>
              {!hasCode ? (
                <label className="login-field"><span>Email</span>
                  <input className="login-input" type="email" name="email" autoComplete="username" defaultValue={state.email} required />
                </label>
              ) : <p className="login-account">{state.email}</p>}
              {hasCode && (
                <label className="login-field"><span>{state.mode === 'confirmReset' ? 'Reset code' : 'Confirmation code'}</span>
                  <input className="login-input" type="text" inputMode="numeric" name="code" autoComplete="one-time-code" required />
                </label>
              )}
              {hasPassword && (
                <label className="login-field"><span>{state.mode === 'confirmReset' ? 'New password' : 'Password'}</span>
                  <input className="login-input" type="password" name="password" autoComplete={state.mode === 'login' ? 'current-password' : 'new-password'} minLength={state.mode === 'login' ? undefined : 8} required aria-describedby={state.mode === 'login' ? undefined : 'password-help'} />
                </label>
              )}
              {hasPassword && state.mode !== 'login' && <p id="password-help" className="login-help">At least 8 characters: uppercase, lowercase, number, and symbol.</p>}
              {state.error && <p className="login-notice" role="alert">{state.error}</p>}
              {state.message && <p className="login-notice" role="status">{state.message}</p>}
              {session.error && <p className="login-notice" role="alert">{session.error}</p>}
              {state.pending && <p role="status">Please wait…</p>}
              <button type="submit" className="login-submit">{state.pending ? 'Please wait…' : submitText}</button>
              {hasCode && <button type="button" className="login-link" onClick={() => { void flow.submit({ email: state.email, password: '', code: '' }, true); }}>Resend code</button>}
              {state.mode === 'login' && <button type="button" className="login-link" onClick={() => flow.setMode('requestReset')}>Forgot password?</button>}
              <p className="login-switch">
                {state.mode === 'login' ? 'New to RUNMAN? ' : 'Already have an account? '}
                <button type="button" className="login-link" onClick={() => flow.setMode(state.mode === 'login' ? 'signup' : 'login')}>{state.mode === 'login' ? 'Sign up' : 'Back to log in'}</button>
              </p>
              {session.status === 'error' && <button type="button" className="login-link" onClick={() => { void sessionStore.signOut(); }}>Clear session and retry</button>}
            </fieldset>
          </form>
        )}
      </main>
      <div className="welcome-desk" aria-hidden="true" />
    </div>
  );
}

export function LoginPage() {
  const session = useSession();
  const [params] = useSearchParams();
  const mode = params.get('mode') === 'signup' ? 'signup' : 'login';
  if (session.status === 'signedIn') return <Navigate to={LANDING_PATH} replace />;
  return <LoginForm key={mode} initialMode={mode} />;
}
