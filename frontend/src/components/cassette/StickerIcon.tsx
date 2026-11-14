import type { StickerKind } from '@runman/shared';

interface StickerIconProps {
  kind: StickerKind;
  color: string;
  className?: string;
}

const DARK = '#1f1f23';
const OUTLINE = {
  stroke: '#fff',
  strokeWidth: 2,
  strokeLinejoin: 'round' as const,
  paintOrder: 'stroke' as const,
};

/** Die-cut style vector sticker (white outline + colour fill). */
export function StickerIcon({ kind, color, className }: StickerIconProps) {
  let body: React.ReactNode;
  switch (kind) {
    case 'heart':
      body = (
        <path
          {...OUTLINE}
          fill={color}
          d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.6.7-1.4 2.2-2.6 4.3-2.6 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z"
        />
      );
      break;
    case 'star':
      body = (
        <path {...OUTLINE} fill={color} d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" />
      );
      break;
    case 'note':
      body = (
        <path
          {...OUTLINE}
          fill={color}
          d="M9 17.5a3.2 3.2 0 1 1-2-2.95V5.2L19 2.6v12.4a3.2 3.2 0 1 1-2-2.95V7.1L9 8.9z"
        />
      );
      break;
    case 'smiley':
      body = (
        <g>
          <circle {...OUTLINE} cx="12" cy="12" r="9.5" fill={color} />
          <circle cx="8.8" cy="10" r="1.3" fill={DARK} />
          <circle cx="15.2" cy="10" r="1.3" fill={DARK} />
          <path
            d="M7.8 13.6c1 2 2.4 3 4.2 3s3.2-1 4.2-3"
            fill="none"
            stroke={DARK}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </g>
      );
      break;
    case 'bolt':
      body = <path {...OUTLINE} fill={color} d="M13.5 2L4 13.5h6.5L9.5 22 20 9.5h-6.6z" />;
      break;
    case 'disc':
      body = (
        <g>
          <circle {...OUTLINE} cx="12" cy="12" r="9.5" fill={DARK} />
          <circle cx="12" cy="12" r="6.5" fill="none" stroke="#ffffff33" />
          <circle cx="12" cy="12" r="3.6" fill={color} />
          <circle cx="12" cy="12" r="0.9" fill={DARK} />
        </g>
      );
      break;
    case 'flower':
      body = (
        <g {...OUTLINE}>
          {[0, 72, 144, 216, 288].map((a) => (
            <circle key={a} cx="12" cy="6.3" r="4" fill={color} transform={`rotate(${a} 12 12)`} />
          ))}
          <circle cx="12" cy="12" r="3.2" fill="#fde047" stroke="none" />
        </g>
      );
      break;
    case 'sparkle':
      body = (
        <g {...OUTLINE} fill={color}>
          <path d="M11 2c.7 5.2 2.4 6.9 7.6 7.6-5.2.7-6.9 2.4-7.6 7.6-.7-5.2-2.4-6.9-7.6-7.6C8.6 8.9 10.3 7.2 11 2z" />
          <path d="M18.5 14.5c.3 2.2 1 2.9 3.2 3.2-2.2.3-2.9 1-3.2 3.2-.3-2.2-1-2.9-3.2-3.2 2.2-.3 2.9-1 3.2-3.2z" />
        </g>
      );
      break;
  }
  return (
    <svg viewBox="-2 -2 28 28" className={className} aria-hidden="true">
      {body}
    </svg>
  );
}
