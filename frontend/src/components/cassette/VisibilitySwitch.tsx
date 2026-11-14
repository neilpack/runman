// Private ←→ Public slider, styled like the Side A / Side B switch. The orange thumb slides
// between the two halves; click either half (or use ←/→) to change it.

import type { Visibility } from '@runman/shared';

const OPTIONS: { id: Visibility; label: string; icon: string }[] = [
  // Padlock
  { id: 'private', label: 'Private', icon: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3' },
  // Globe
  { id: 'public', label: 'Public', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.5 5.6 3.5 9s-1 6.4-3.5 9c-2.5-2.6-3.5-5.6-3.5-9s1-6.4 3.5-9z' },
];

export function VisibilitySwitch({
  value,
  onChange,
  label,
}: {
  value: Visibility;
  onChange: (v: Visibility) => void;
  label: string;
}) {
  return (
    <div
      className={`visibility-switch${value === 'public' ? ' is-public' : ''}`}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        const next = e.key === 'ArrowLeft' ? 'private' : e.key === 'ArrowRight' ? 'public' : null;
        if (!next) return;
        e.preventDefault();
        onChange(next);
        e.currentTarget.querySelector<HTMLElement>(`[data-id="${next}"]`)?.focus();
      }}
    >
      <span className="visibility-thumb" aria-hidden="true" />
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          data-id={o.id}
          aria-checked={value === o.id}
          tabIndex={value === o.id ? 0 : -1}
          className={value === o.id ? 'on' : ''}
          onClick={() => onChange(o.id)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={o.icon} />
          </svg>
          {o.label}
        </button>
      ))}
    </div>
  );
}
