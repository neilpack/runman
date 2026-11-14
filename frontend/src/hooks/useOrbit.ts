// Drag-to-rotate for 3D objects. Works with mouse, pen and touch (pointer events).

import { useCallback, useRef, useState } from 'react';

export interface Rotation {
  x: number;
  y: number;
}

export function useOrbit(initial: Rotation = { x: -12, y: 18 }, sensitivity = 0.5) {
  const [rotation, setRotation] = useState<Rotation>(initial);
  const [orbiting, setOrbiting] = useState(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = { x: e.clientX, y: e.clientY };
    setOrbiting(true);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!last.current) return;
      const dx = e.clientX - last.current.x;
      const dy = e.clientY - last.current.y;
      last.current = { x: e.clientX, y: e.clientY };
      setRotation((r) => ({
        x: Math.max(-80, Math.min(80, r.x - dy * sensitivity)),
        y: r.y + dx * sensitivity,
      }));
    },
    [sensitivity],
  );

  const onPointerUp = useCallback(() => {
    last.current = null;
    setOrbiting(false);
  }, []);

  return {
    rotation,
    setRotation,
    orbiting,
    bind: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}
