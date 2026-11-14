// Drives a Y-axis-only spin that the user can push around: sweeping the cursor across the target
// flicks it faster (or backwards), pressing and dragging grabs it directly, and on release it keeps
// its momentum before easing back to the idle auto-spin. The transform is written straight to the
// element every frame so React never re-renders during the animation.

import { useCallback, useEffect, useRef } from 'react';

interface FlickSpinOptions {
  /** Fixed tilt towards the viewer, in degrees. Never changes. */
  tiltX: number;
  /** Idle spin speed in deg/s (negative = front face moves right-to-left). */
  idleSpeed: number;
  /** Starting rotateY, in degrees. */
  startAngle?: number;
}

/** Spin speed added per pixel of cursor movement while hovering. */
const HOVER_GAIN = 4;
/** Degrees turned per pixel while the tape is grabbed. */
const DRAG_GAIN = 0.6;
/** How quickly a flick decays back to the idle speed (higher = sooner). */
const SETTLE_RATE = 1.6;
/** Upper bound so a wild flick still reads as spinning, not strobing. */
const MAX_SPEED = 1080;

export function useFlickSpin<T extends HTMLElement>({ tiltX, idleSpeed, startAngle = 0 }: FlickSpinOptions) {
  const targetRef = useRef<T>(null);
  const angle = useRef(startAngle);
  const speed = useRef(idleSpeed);
  const idle = useRef(idleSpeed);
  const lastX = useRef<number | null>(null);
  const drag = useRef<{ id: number; x: number; t: number; v: number } | null>(null);

  idle.current = idleSpeed;

  useEffect(() => {
    let frame = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      // Clamp so a backgrounded tab doesn't jump on return.
      const dt = Math.min((now - prev) / 1000, 0.05);
      prev = now;
      if (!drag.current) {
        speed.current += (idle.current - speed.current) * (1 - Math.exp(-SETTLE_RATE * dt));
        angle.current = (angle.current + speed.current * dt) % 360;
      }
      const el = targetRef.current;
      if (el) el.style.transform = `rotateX(${tiltX}deg) rotateY(${angle.current}deg)`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [tiltX]);

  const clampSpeed = (v: number) => Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v));

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, t: e.timeStamp, v: 0 };
    speed.current = 0;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (d && d.id === e.pointerId) {
      // Grabbed: the tape follows the pointer; remember how fast for the throw.
      const dx = e.clientX - d.x;
      const dt = Math.max((e.timeStamp - d.t) / 1000, 1 / 240);
      angle.current += dx * DRAG_GAIN;
      d.v = d.v * 0.6 + ((dx * DRAG_GAIN) / dt) * 0.4;
      d.x = e.clientX;
      d.t = e.timeStamp;
      return;
    }
    if (e.pointerType !== 'mouse') return;
    // Hovering: each sweep of the cursor nudges the spin in that direction.
    if (lastX.current !== null) {
      speed.current = clampSpeed(speed.current + (e.clientX - lastX.current) * HOVER_GAIN);
    }
    lastX.current = e.clientX;
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    // A pause before letting go means no throw.
    speed.current = e.timeStamp - d.t > 80 ? 0 : clampSpeed(d.v);
    drag.current = null;
    lastX.current = e.clientX;
  }, []);

  const onPointerLeave = useCallback(() => {
    lastX.current = null;
  }, []);

  return {
    targetRef,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onPointerLeave,
    },
  };
}
