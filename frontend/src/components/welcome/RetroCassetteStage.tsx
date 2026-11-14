// Welcome-page hero art: a floating 3D cassette that spins right-to-left in front of a neon
// synthwave sun, swapping colour + stickers every few seconds, with stickers flying across the screen.

import { useEffect, useState } from 'react';
import { Cassette3D } from '@/components/cassette/Cassette3D';
import { StickerIcon } from '@/components/cassette/StickerIcon';
import { useFlickSpin } from '@/hooks/useFlickSpin';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { FLYING_STICKERS, RETRO_LOOKS } from './retroLooks';
import './retroStage.css';

/** How long each look stays on the tape. */
const LOOK_MS = 5000;
/** Stickers peel off this long before the next look slaps on. */
const PEEL_MS = 450;

function useCassetteWidth(): number {
  const phone = useMediaQuery('(max-width: 600px)');
  const tablet = useMediaQuery('(max-width: 1024px)');
  if (phone) return 220;
  if (tablet) return 320;
  return 400;
}

export function RetroCassetteStage() {
  const width = useCassetteWidth();
  const [index, setIndex] = useState(0);
  const [peeling, setPeeling] = useState(false);
  const look = RETRO_LOOKS[index];
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  // Same axis and tilt as before (one turn per 8s); the user can flick or drag it around.
  const { targetRef, handlers } = useFlickSpin<HTMLDivElement>({
    tiltX: -14,
    idleSpeed: reduceMotion ? 0 : -360 / 8,
    startAngle: reduceMotion ? -24 : 0,
  });

  useEffect(() => {
    setPeeling(false);
    const peel = window.setTimeout(() => setPeeling(true), LOOK_MS - PEEL_MS);
    const next = window.setTimeout(() => setIndex((i) => (i + 1) % RETRO_LOOKS.length), LOOK_MS);
    return () => {
      window.clearTimeout(peel);
      window.clearTimeout(next);
    };
  }, [index]);

  const vars = { '--wc-glow': look.shellColor, '--wc-w': `${width}px` } as React.CSSProperties;

  return (
    <div className="wc-stage" style={vars} aria-hidden="true">
      <div className="wc-sun">
        <span />
      </div>
      <div className="wc-rings">
        <span />
        <span />
        <span />
      </div>
      {/* Keyed so the neon flash replays on every look change. */}
      <div key={`burst-${index}`} className="wc-burst" />

      <div className="wc-sparkles">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className={`wc-sparkle wc-sparkle-${i}`}>
            ✦
          </span>
        ))}
      </div>

      <div className="wc-float">
        <div ref={targetRef} className="wc-spin">
          {/* Keyed so each new look pops in and its stickers slap on one by one. */}
          <div key={index} className={`wc-pop${peeling ? ' wc-peeling' : ''}`}>
            <Cassette3D cassette={look} width={width} rotateX={0} rotateY={0} spinning />
          </div>
        </div>
      </div>
      <div className="wc-shadow" />
      {/* Invisible, steady hit area: the tape itself turns edge-on, so it can't be the target. */}
      <div className="wc-grab" {...handlers} />
    </div>
  );
}

/** Stickers drifting across the whole screen, left to right, fading in and out. */
export function FlyingStickers() {
  return (
    <div className="wc-flyers" aria-hidden="true">
      {FLYING_STICKERS.map((s, i) => {
        const duration = 14 + ((i * 7) % 9); // 14-22s per crossing
        const style = {
          '--fly-top': `${6 + ((i * 37) % 66)}%`,
          '--fly-size': `${34 + ((i * 13) % 30)}px`,
          '--fly-dur': `${duration}s`,
          // Negative delays so the screen is already populated on first paint.
          '--fly-delay': `${-((i * duration) / FLYING_STICKERS.length) * 1.7}s`,
          '--fly-spin': `${6 + (i % 5) * 2}s`,
          '--fly-dir': i % 2 ? 'reverse' : 'normal',
          '--fly-color': s.color,
        } as React.CSSProperties;
        return (
          <div key={i} className="wc-flyer" style={style}>
            <div className="wc-flyer-bob">
              {s.type === 'icon' ? (
                <div className="wc-flyer-spin">
                  <StickerIcon kind={s.kind} color={s.color} />
                </div>
              ) : (
                <span className="wc-flyer-text">{s.text}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
