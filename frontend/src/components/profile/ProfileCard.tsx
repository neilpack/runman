// A listener's public profile: picture, username, and their favorite tape (click to flip it over).
// Used for the "how others see you" preview, and by Explore once other profiles can be fetched.

import { useState } from 'react';
import type { TapeSide } from '@runman/shared';
import { FlippableFace } from '@/components/cassette/FlippableFace';
import type { PublicProfile } from '@/profile/profileModel';
import { Avatar } from './Avatar';
import './profile.css';

export function ProfileCard({ profile }: { profile: PublicProfile }) {
  const [side, setSide] = useState<TapeSide>('A');
  const tape = profile.favoriteTape;

  return (
    <article className="profile-card">
      <header className="profile-card-head">
        <Avatar src={profile.avatar} name={profile.username} size={56} />
        <h3 className="profile-card-name">@{profile.username}</h3>
      </header>
      <div className="profile-card-fav">
        <span className="profile-kicker">Favorite tape</span>
        {tape ? (
          <>
            <button
              type="button"
              className="profile-card-tape"
              onClick={() => setSide((s) => (s === 'A' ? 'B' : 'A'))}
              aria-label={`${tape.name}, showing side ${side}. Flip the tape.`}
            >
              <FlippableFace cassette={tape} side={side} width="100cqw" />
            </button>
            <p className="profile-card-meta">
              <strong>{tape.name || 'Untitled'}</strong>
              <span className="muted"> · {tape.trackCount} {tape.trackCount === 1 ? 'song' : 'songs'} · tap to flip</span>
            </p>
          </>
        ) : (
          <p className="muted profile-card-empty">No favorite tape picked yet.</p>
        )}
      </div>
    </article>
  );
}
