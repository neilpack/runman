import type { AuthUser } from 'aws-amplify/auth';
import { Card } from '@/components/Card';
import { AudioInput } from '@/components/AudioInput';

export function DashboardPage({ user }: { user: AuthUser }) {
  return (
    <div className="page">
      <h1>Your dashboard</h1>
      <Card title="You're signed in">
        <p>Welcome{user.signInDetails?.loginId ? `, ${user.signInDetails.loginId}` : ''}.</p>
        <p className="muted">Your cassette library and audio uploads are coming next. Cloud saving is not available yet.</p>
      </Card>
      <Card title="Try your audio">
        <AudioInput />
      </Card>
    </div>
  );
}
