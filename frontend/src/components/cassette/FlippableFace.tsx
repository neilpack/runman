// A flat cassette that physically flips over (Y-axis) when `side` changes between A and B.
// Each side renders its own label look (see sides.ts). Sticker editing applies to the visible side.

import { useRef } from 'react';
import type { TapeSide } from '@runman/shared';
import { CassetteFace, type CassetteFaceProps } from './CassetteFace';
import { faceFor, type SidedCassette } from './sides';
import './cassette.css';

type FlippableFaceProps = Omit<CassetteFaceProps, 'side' | 'cassette'> & {
  cassette: SidedCassette;
  side: TapeSide;
};

export function FlippableFace({
  cassette,
  side,
  faceRef,
  onStickerPointerDown,
  selectedStickerId,
  ...face
}: FlippableFaceProps) {
  // Only animate after the first flip, so a tape that mounts on side B doesn't spin on load.
  const initialSide = useRef(side);
  const hasFlipped = useRef(false);
  if (side !== initialSide.current) hasFlipped.current = true;

  const motion = hasFlipped.current ? (side === 'B' ? ' to-b' : ' to-a') : side === 'B' ? ' at-b' : '';

  const sideProps = (s: TapeSide) =>
    s === side ? { faceRef, onStickerPointerDown, selectedStickerId } : { selectedStickerId: null };

  return (
    <div className="flip-card">
      <div className={`flip-inner${motion}`}>
        <div className="flip-front">
          <CassetteFace {...face} {...sideProps('A')} cassette={faceFor(cassette, 'A')} side="A" />
        </div>
        <div className="flip-back">
          <CassetteFace {...face} {...sideProps('B')} cassette={faceFor(cassette, 'B')} side="B" />
        </div>
      </div>
    </div>
  );
}
