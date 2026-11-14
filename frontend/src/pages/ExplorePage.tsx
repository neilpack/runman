// Explore: browse other listeners' profiles and favorite tapes.
// Placeholder until a profiles API exists. Profiles render with <ProfileCard>.

import { Link } from 'react-router';
import { Card } from '@/components/Card';
import { ProfileCard } from '@/components/profile/ProfileCard';
import { useAccount } from '@/hooks/useAccount';
import './account.css';

export function ExplorePage() {
  const { profile } = useAccount();

  return (
    <div className="page">
      <header>
        <h1>Explore</h1>
        <p className="muted">Discover other listeners and the tapes they're proudest of.</p>
      </header>
      <Card title="Coming soon">
        <p className="muted">
          Soon you'll be able to browse other listeners' profiles here and flip through their favorite tapes.
        </p>
      </Card>
      {profile ? (
        <section className="explore-you" aria-label="Your profile card">
          <h2 className="card-title">This is how you'll appear</h2>
          <ProfileCard profile={profile} />
          <p className="muted">
            <Link to="/account">Edit your profile</Link>
          </p>
        </section>
      ) : (
        <p className="muted">
          <Link to="/login">Log in</Link> to set up your profile.
        </p>
      )}
    </div>
  );
}
