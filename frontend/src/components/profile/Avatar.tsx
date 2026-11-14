import type { CSSProperties } from 'react';
import { isSafeAvatar } from '@/profile/profileModel';
import './profile.css';

interface AvatarProps {
  src: string | null | undefined;
  /** Used for the initials fallback and its colour. */
  name: string;
  size?: number;
  /** Alt text. Leave empty when the name is already shown next to the avatar. */
  label?: string;
  className?: string;
}

function hueFor(name: string): number {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

export function Avatar({ src, name, size = 40, label = '', className = '' }: AvatarProps) {
  const style = { width: size, height: size, fontSize: size * 0.44, '--avatar-hue': hueFor(name) } as CSSProperties;
  if (isSafeAvatar(src)) {
    return <img className={`avatar ${className}`.trim()} src={src} alt={label} width={size} height={size} style={style} />;
  }
  return (
    <span className={`avatar avatar-fallback ${className}`.trim()} style={style} role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true}>
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}
