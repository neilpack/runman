// Pop-up sticker studio: draw your own sticker for one of the editor's custom slots.
// Strokes are kept as small vector data (see customStickers.ts) and drawn live with the same
// white die-cut edge they'll have on the tape. Escape cancels; Ctrl/⌘+Z undoes.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CustomSticker, CustomStickerStroke } from '@runman/shared';
import { ColorPicker } from './ColorPicker';
import { CUSTOM_VIEWBOX, CustomStickerArt } from './CustomStickerArt';
import { STICKER_COLORS } from './constants';
import { CUSTOM_INK_BUDGET, CUSTOM_STROKE_BUDGET, distanceToStroke, inkUsed, simplifyPoints } from './customStickers';
import '../confirmDialog.css';
import './stickerDraw.css';

const PEN_SIZES = [
  { width: 2.5, label: 'Fine' },
  { width: 5, label: 'Medium' },
  { width: 9, label: 'Bold' },
  { width: 15, label: 'Chunky' },
];

/** Minimum pointer travel (canvas units) before another point is recorded. */
const MIN_STEP = 0.9;
/** Eraser reach beyond a stroke's own half-width, in canvas units. */
const ERASER_REACH = 2.5;

type Tool = 'pen' | 'eraser';

interface StickerDrawDialogProps {
  /** The drawing being edited, or null to draw a new one. */
  art: CustomSticker | null;
  onSave: (strokes: CustomStickerStroke[]) => void;
  onCancel: () => void;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function StickerDrawDialog({ art, onSave, onCancel }: StickerDrawDialogProps) {
  const [strokes, setStrokesState] = useState<CustomStickerStroke[]>(() => structuredClone(art?.strokes ?? []));
  const [past, setPastState] = useState<CustomStickerStroke[][]>([]);
  // Mirrors of the state for pointer/key handlers that fire faster than React re-renders.
  const strokesRef = useRef(strokes);
  const pastRef = useRef(past);
  const setStrokes = (next: CustomStickerStroke[]) => { strokesRef.current = next; setStrokesState(next); };
  const setPast = (next: CustomStickerStroke[][]) => { pastRef.current = next; setPastState(next); };
  const [pending, setPending] = useState<CustomStickerStroke | null>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(() => art?.strokes.at(-1)?.color ?? STICKER_COLORS[0]);
  const [width, setWidth] = useState(PEN_SIZES[1].width);
  const [pickerOpen, setPickerOpen] = useState(false);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const canvasRef = useRef<SVGSVGElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ pointerId: number; points: number[]; erased: boolean } | null>(null);

  const used = inkUsed({ strokes }) + (pending?.points.length ?? 0);
  const inkLeft = Math.max(0, CUSTOM_INK_BUDGET - used);
  const full = inkLeft < 2 || strokes.length >= CUSTOM_STROKE_BUDGET;
  const isCustomColor = !STICKER_COLORS.some((c) => c.toLowerCase() === color.toLowerCase());

  /** Replace the drawing, keeping the previous one for Undo. */
  const commit = (next: CustomStickerStroke[]) => {
    setPast([...pastRef.current.slice(-40), strokesRef.current]);
    setStrokes(next);
  };

  const undo = () => {
    const history = pastRef.current;
    if (!history.length) return;
    setStrokes(history[history.length - 1]);
    setPast(history.slice(0, -1));
  };
  const undoRef = useRef(undo);
  undoRef.current = undo;

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pickerOpen) return; // the colour picker closes itself on Escape
      if (e.key === 'Escape') onCancel();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undoRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, pickerOpen]);

  /** Pointer position in canvas units (0-100), clamped to the sticker area. */
  const toCanvas = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const { min, size } = CUSTOM_VIEWBOX;
    const clamp = (n: number) => round1(Math.min(100, Math.max(0, n)));
    return {
      x: clamp(((e.clientX - r.left) / r.width) * size + min),
      y: clamp(((e.clientY - r.top) / r.height) * size + min),
    };
  };

  const eraseAt = (x: number, y: number, list: CustomStickerStroke[]) =>
    list.filter((s) => distanceToStroke(s.points, x, y) > s.width / 2 + ERASER_REACH);

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || gesture.current) return;
    const p = toCanvas(e);
    if (tool === 'pen' && full) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { pointerId: e.pointerId, points: [p.x, p.y], erased: false };
    if (tool === 'pen') {
      setPending({ color, width, points: [p.x, p.y] });
    } else {
      const next = eraseAt(p.x, p.y, strokesRef.current);
      if (next.length !== strokesRef.current.length) {
        commit(next);
        gesture.current.erased = true;
      }
    }
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const p = toCanvas(e);
    if (tool === 'eraser') {
      // One undo step per eraser drag: snapshot once, then keep filtering the live list.
      const next = eraseAt(p.x, p.y, strokesRef.current);
      if (next.length === strokesRef.current.length) return;
      if (g.erased) setStrokes(next);
      else {
        g.erased = true;
        commit(next);
      }
      return;
    }
    const n = g.points.length;
    if (Math.hypot(p.x - g.points[n - 2], p.y - g.points[n - 1]) < MIN_STEP) return;
    if (inkUsed({ strokes: strokesRef.current }) + n + 2 > CUSTOM_INK_BUDGET) return; // out of ink: the line just stops
    g.points.push(p.x, p.y);
    setPending({ color, width, points: [...g.points] });
  };

  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    if (tool !== 'pen') return;
    setPending(null);
    const points = simplifyPoints(g.points);
    if (inkUsed({ strokes: strokesRef.current }) + points.length > CUSTOM_INK_BUDGET) return;
    commit([...strokesRef.current, { color, width, points }]);
  };

  const clear = () => {
    if (strokesRef.current.length) commit([]);
  };

  const pickColor = (c: string) => {
    setColor(c);
    setTool('pen');
  };

  return (
    <div className="cd-backdrop sd-backdrop">
      <div
        ref={dialogRef}
        className="cd sd"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sd-title"
        tabIndex={-1}
      >
        <h2 id="sd-title">{art ? 'Edit your sticker' : 'Draw a sticker'}</h2>
        <p className="sd-sub">It gets a white die-cut edge, just like the others.</p>

        <div className={`sd-canvas sd-tool-${tool}`}>
          <svg
            ref={canvasRef}
            viewBox={`${CUSTOM_VIEWBOX.min} ${CUSTOM_VIEWBOX.min} ${CUSTOM_VIEWBOX.size} ${CUSTOM_VIEWBOX.size}`}
            className="sd-surface"
            role="img"
            aria-label={strokes.length ? `Your drawing, ${strokes.length} strokes` : 'Empty drawing canvas'}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <rect className="sd-guide" x="0" y="0" width="100" height="100" rx="16" />
          </svg>
          {/* The live die-cut preview sits on top of the guide; pointer events pass to the surface. */}
          <CustomStickerArt art={{ strokes }} pending={pending} className="sd-art" />
          {!strokes.length && !pending && <span className="sd-empty">Draw here</span>}
        </div>

        <div className="sd-tools">
          <div className="seg" role="radiogroup" aria-label="Tool">
            {(['pen', 'eraser'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={tool === t}
                className={tool === t ? 'on' : ''}
                onClick={() => setTool(t)}
              >
                {t === 'pen' ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 20l1-5L16 4l4 4L9 19zM14 6l4 4" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8 20h12M5 15l9-10 6 6-8 9H8z" />
                  </svg>
                )}
                {t === 'pen' ? 'Pen' : 'Eraser'}
              </button>
            ))}
          </div>

          <div className="sd-sizes" role="radiogroup" aria-label="Pen size">
            {PEN_SIZES.map((s) => (
              <button
                key={s.width}
                type="button"
                role="radio"
                aria-checked={width === s.width}
                aria-label={s.label}
                title={s.label}
                className={`sd-size${width === s.width ? ' on' : ''}`}
                onClick={() => {
                  setWidth(s.width);
                  setTool('pen');
                }}
              >
                <span style={{ width: 4 + s.width * 1.1, height: 4 + s.width * 1.1, background: color }} />
              </button>
            ))}
          </div>

          <div className="sd-history">
            <button type="button" className="icon-btn" onClick={undo} disabled={!past.length} aria-label="Undo" title="Undo (Ctrl+Z)">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />
              </svg>
            </button>
            <button type="button" className="icon-btn" onClick={clear} disabled={!strokes.length} aria-label="Clear drawing" title="Clear">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
              </svg>
            </button>
          </div>
        </div>

        <div className="swatches small sd-colors" role="radiogroup" aria-label="Pen colour">
          {STICKER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color.toLowerCase() === c.toLowerCase()}
              aria-label={`Pen colour ${c}`}
              className={`swatch${color.toLowerCase() === c.toLowerCase() ? ' on' : ''}`}
              style={{ background: c }}
              onClick={() => pickColor(c)}
            />
          ))}
          <button
            type="button"
            className={`swatch swatch-custom${isCustomColor ? ' on' : ''}`}
            style={isCustomColor ? ({ '--custom': color } as React.CSSProperties) : undefined}
            title="Custom colour"
            aria-label="Custom pen colour"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((o) => !o)}
          />
          {pickerOpen && <ColorPicker value={color} onChange={pickColor} onClose={closePicker} />}
        </div>

        <div className="sd-ink" aria-label={`Ink left: ${Math.round((inkLeft / CUSTOM_INK_BUDGET) * 100)}%`}>
          <span className="field-label">Ink</span>
          <div className="sd-ink-bar">
            <span style={{ width: `${(inkLeft / CUSTOM_INK_BUDGET) * 100}%` }} />
          </div>
          {full && <span className="sd-ink-note">Out of ink. Undo or erase to keep drawing.</span>}
        </div>

        <div className="cd-actions">
          <button type="button" className="cd-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="cd-btn cd-confirm" disabled={!strokes.length} onClick={() => onSave(strokes)}>
            Save sticker
          </button>
        </div>
      </div>
    </div>
  );
}
