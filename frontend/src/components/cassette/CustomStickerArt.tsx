// Renders a hand-drawn sticker: the listener's pen strokes over a thick white die-cut edge,
// so it sits on the tape like the built-in doodles. Pure vector data → SVG (no injected markup).

import type { CustomSticker, CustomStickerStroke } from '@runman/shared';
import { strokePath } from './customStickers';

/** Extra width of the white die-cut edge, in canvas units. */
const EDGE = 7;
/** Canvas is 0-100; the margin leaves room for the edge around strokes near the border. */
export const CUSTOM_VIEWBOX = { min: -6, size: 112 } as const;

interface CustomStickerArtProps {
  art: Pick<CustomSticker, 'strokes'>;
  /** A stroke still being drawn (editor only). */
  pending?: CustomStickerStroke | null;
  className?: string;
}

export function CustomStickerArt({ art, pending, className }: CustomStickerArtProps) {
  const strokes = pending ? [...art.strokes, pending] : art.strokes;
  const paths = strokes.map((s) => ({ d: strokePath(s.points), color: s.color, width: s.width }));
  const { min, size } = CUSTOM_VIEWBOX;
  return (
    <svg
      viewBox={`${min} ${min} ${size} ${size}`}
      className={`custom-sticker-art${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g stroke="#fff">
        {paths.map((p, i) => (
          <path key={i} d={p.d} strokeWidth={p.width + EDGE} />
        ))}
      </g>
      {paths.map((p, i) => (
        <path key={i} d={p.d} stroke={p.color} strokeWidth={p.width} />
      ))}
    </svg>
  );
}
