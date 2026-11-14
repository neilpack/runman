import { useState } from 'react';
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import { signOut, type AuthUser } from 'aws-amplify/auth';
import type { AuthSetup } from '@/auth/configuration';
import { SessionGuard } from '@/auth/SessionGuard';
import { DashboardPage } from '@/pages/DashboardPage';
import { Button } from './Button';
import { Card } from './Card';
import '@aws-amplify/ui-react/styles.css';

function AccountSession({ user }: { user: AuthUser }) {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState(false);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setError(false);
    try {
      // Amplify emits signedOut; Authenticator removes the session and shows sign-in.
      await signOut();
    } catch {
      setError(true);
      setSigningOut(false);
    }
  }

  return (
    <div className="page">
      <div className="session-actions">
        <span className="muted">{user.signInDetails?.loginId ?? 'Your account'}</span>
        <Button variant="secondary" onClick={handleSignOut} disabled={signingOut}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
      {error && <p className="error" role="alert">Sign-out failed. Please try again.</p>}
      {signingOut
        ? <p role="status">Signing out…</p>
        : <DashboardPage user={user} />}
    </div>
  );
}

function AuthenticatedSession() {
  const { authStatus, route, user } = useAuthenticator((context) => [
    context.authStatus, context.route, context.user,
  ]);
  return (
    <SessionGuard authStatus={authStatus} route={route} userId={user?.userId}>
      {user && <AccountSession user={user} />}
    </SessionGuard>
  );
}

export function AuthGate({ setup }: { setup: AuthSetup }) {
  if (!setup.ready) {
    return (
      <div className="page">
        <h1>Dashboard</h1>
        <Card title="Sign-in unavailable">
          <p>Sign-in is not configured for this build. Ask the project team to connect the shared backend, then reload.</p>
          <p className="muted">You can still visit Home and About.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="identity-flow">
      <Authenticator loginMechanisms={['email']} signUpAttributes={['email']}>
        <AuthenticatedSession />
      </Authenticator>
    </div>
  );
}
