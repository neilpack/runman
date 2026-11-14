// Studio-styled colour picker popover (replaces the browser's native <input type="color">).
// Saturation/brightness square + hue strip + hex field. Mouse, pen and touch friendly.

import { useEffect, useRef, useState } from 'react';
import './colorPicker.css';

interface HSV {
  h: number; // 0-360
  s: number; // 0-1
  v: number; // 0-1
}

function hexToHsv(hex: string): HSV {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

function hsvToHex({ h, s, v }: HSV): string {
  const f = (k: number) => {
    const kk = (k + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(kk, 4 - kk, 1));
  };
  return (
    '#' +
    [f(5), f(3), f(1)]
      .map((x) =>
        Math.round(x * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  onClose: () => void;
}

export function ColorPicker({ value, onChange, onClose }: ColorPickerProps) {
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(value));
  const [hexText, setHexText] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);

  const commit = (next: HSV) => {
    setHsv(next);
    const hex = hsvToHex(next);
    setHexText(hex);
    onChange(hex);
  };

  // Close on outside click / Escape.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // Defer so the click that opened the picker doesn't immediately close it.
    const t = window.setTimeout(() => document.addEventListener('pointerdown', onDown));
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  /** Pointer-drag helper: calls `fn` with the pointer position as 0-1 fractions of the element. */
  const dragger = (fn: (fx: number, fy: number) => void) => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const r = e.currentTarget.getBoundingClientRect();
      fn(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height));
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const r = e.currentTarget.getBoundingClientRect();
      fn(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height));
    },
  });

  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  const current = hsvToHex(hsv);

  return (
    <div ref={rootRef} className="cp" role="dialog" aria-label="Custom colour">
      <div
        className="cp-sv"
        style={{ background: hueColor }}
        {...dragger((fx, fy) => commit({ ...hsv, s: fx, v: 1 - fy }))}
      >
        <span className="cp-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: current }} />
      </div>

      <div className="cp-hue" {...dragger((fx) => commit({ ...hsv, h: Math.min(359.9, fx * 360) }))}>
        <span className="cp-thumb" style={{ left: `${(hsv.h / 360) * 100}%`, top: '50%', background: hueColor }} />
      </div>

      <div className="cp-row">
        <span className="cp-preview" style={{ background: current }} />
        <input
          className="cp-hex"
          value={hexText}
          maxLength={7}
          spellCheck={false}
          aria-label="Hex colour"
          onChange={(e) => {
            const t = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
            setHexText(t);
            if (/^#[0-9a-f]{6}$/i.test(t)) {
              setHsv(hexToHsv(t));
              onChange(t.toLowerCase());
            }
          }}
        />
        <button type="button" className="cp-done" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
