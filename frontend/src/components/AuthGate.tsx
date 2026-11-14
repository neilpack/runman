import { Navigate } from 'react-router';
import { sessionStore } from '@/auth/session';
import { SessionGuard } from '@/auth/SessionGuard';
import { useSession } from '@/hooks/useSession';
import { AccountPage } from '@/pages/AccountPage';
import { Button } from './Button';
import { Card } from './Card';

export function AuthGate() {
  const session = useSession();
  if (session.status === 'signedOut') return <Navigate to="/login" replace />;
  if (session.status === 'unavailable' || session.status === 'error') {
    return <Card title="Sign-in unavailable"><p>{session.error ?? 'Sign-in is not configured for this build.'}</p>{session.status === 'error' && <Button onClick={() => { void sessionStore.signOut(); }}>Clear session</Button>}</Card>;
  }
  return (
    <SessionGuard authStatus={session.status === 'signedIn' ? 'authenticated' : session.status} route={session.status === 'signedIn' ? 'authenticated' : session.status} userId={session.user?.userId}>
      {session.user && (
        <div className="page" key={session.user.userId}>
          {session.error && <p className="error" role="alert">{session.error}</p>}
          <AccountPage user={session.user} />
        </div>
      )}
    </SessionGuard>
  );
}
