// Account settings: profile picture, username, favorite tape, password, and a preview of your
// public profile. Rendered by AuthGate, so it only ever shows a confirmed signed-in session.

import type { AuthUser } from 'aws-amplify/auth';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { AvatarEditor } from '@/components/account/AvatarEditor';
import { FavoriteTapePicker } from '@/components/account/FavoriteTapePicker';
import { PasswordForm } from '@/components/account/PasswordForm';
import { UsernameForm } from '@/components/account/UsernameForm';
import { Avatar } from '@/components/profile/Avatar';
import { ProfileCard } from '@/components/profile/ProfileCard';
import { sessionStore } from '@/auth/session';
import { useAccount } from '@/hooks/useAccount';
import { accountStore } from '@/profile/account';
import './account.css';

export function AccountPage({ user }: { user: AuthUser }) {
  const account = useAccount();
  const profile = account.profile?.userId === user.userId ? account.profile : null;
  const signOut = () => { void sessionStore.signOut(); };

  if (account.status === 'error') {
    return (
      <div className="page account">
        <h1>Your account</h1>
        <Card title="Account unavailable">
          <p className="error" role="alert">{account.error}</p>
          <div className="row">
            <Button onClick={() => accountStore.retry()}>Try again</Button>
            <Button variant="secondary" onClick={signOut}>Sign out</Button>
          </div>
        </Card>
      </div>
    );
  }

  if (!profile) return <p role="status">Loading your account…</p>;

  return (
    <div className="page account">
      <header className="account-header">
        <Avatar src={profile.avatar} name={profile.username} size={72} />
        <div className="account-header-text">
          <h1>@{profile.username}</h1>
          <p className="muted">{profile.email}</p>
        </div>
        <Button variant="secondary" onClick={signOut}>Sign out</Button>
      </header>

      {!profile.hasUsername && (
        <p className="account-banner" role="note">
          Pick a username so other listeners know who made your tapes. Until then you appear as @{profile.username}.
        </p>
      )}

      <div className="account-grid">
        <div className="account-col">
          <Card title="Profile picture">
            <AvatarEditor profile={profile} />
          </Card>
          <Card title="Username">
            <UsernameForm profile={profile} />
          </Card>
          <Card title="Change password">
            <PasswordForm profile={profile} />
          </Card>
        </div>

        <div className="account-col">
          <Card title="Favorite tape">
            <p className="muted account-intro">Show off one tape. Anyone who opens your profile can see and flip it.</p>
            <FavoriteTapePicker profile={profile} />
          </Card>
          <Card title="How others see you">
            <ProfileCard profile={profile} />
          </Card>
        </div>
      </div>
    </div>
  );
}
