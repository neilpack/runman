// A cassette as a real 3D box built from CSS transforms (no WebGL needed).
// Front/back are full CassetteFace renders, the four edges are shaded strips.

import { CassetteFace } from './CassetteFace';
import { faceFor, type SidedCassette } from './sides';
import './cassette.css';

interface Cassette3DProps {
  cassette: SidedCassette;
  width: number;
  rotateX: number;
  rotateY: number;
  spinning?: boolean;
  /** Smoothly animate rotation changes (turn off while the user is actively dragging). */
  animate?: boolean;
}

export const CASSETTE_ASPECT = 0.63;

export function Cassette3D({ cassette, width, rotateX, rotateY, spinning, animate }: Cassette3DProps) {
  const h = width * CASSETTE_ASPECT;
  const d = width * 0.12;
  const r = width * 0.035; // matches .cf border-radius (3.5em)
  // Stacked rounded slabs give the body smooth rounded corners all the way through its depth.
  const slabs = Math.max(6, Math.round(d / 2));
  const vars = {
    width,
    height: h,
    '--w': `${width}px`,
    '--h': `${h}px`,
    '--d': `${d}px`,
    '--r': `${r}px`,
    '--shell': cassette.shellColor,
  } as React.CSSProperties;

  return (
    <div className="c3d" style={vars}>
      <div
        className={`c3d-body${animate ? ' c3d-animate' : ''}`}
        style={{ transform: `rotateX(${rotateX}deg) rotateY(${rotateY}deg)` }}
      >
        <div className="c3d-face c3d-front">
          <CassetteFace cassette={faceFor(cassette, 'A')} width={width} spinning={spinning} />
        </div>
        <div className="c3d-face c3d-back">
          <CassetteFace cassette={faceFor(cassette, 'B')} width={width} side="B" spinning={spinning} />
        </div>
        {Array.from({ length: slabs }, (_, i) => (
          <div
            key={i}
            className="c3d-slab"
            style={{ transform: `translateZ(${-d / 2 + (d * (i + 0.5)) / slabs}px)` }}
          />
        ))}
        <div className="c3d-edge c3d-top" />
        <div className="c3d-edge c3d-bottom" />
        <div className="c3d-edge c3d-left" />
        <div className="c3d-edge c3d-right" />
      </div>
    </div>
  );
}
