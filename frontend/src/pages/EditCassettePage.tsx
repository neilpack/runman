// Edit / create a cassette: colours, label text + pen style, shell type, stickers, tracklist.
// Every change is saved immediately to the cassette store.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Cassette, SideLook, Sticker, StickerKind, TapeSide } from '@runman/shared';
import { Cassette3D } from '@/components/cassette/Cassette3D';
import { ColorPicker } from '@/components/cassette/ColorPicker';
import { FlippableFace } from '@/components/cassette/FlippableFace';
import { StickerIcon } from '@/components/cassette/StickerIcon';
import { TrackList } from '@/components/cassette/TrackList';
import {
  INK_COLORS,
  LABEL_COLORS,
  PEN_STYLES,
  SHELL_COLORS,
  SHELL_TYPES,
  STICKER_COLORS,
  STICKER_KINDS,
} from '@/components/cassette/constants';
import { patchSide, sideBHasOwnStyle, sideLook } from '@/components/cassette/sides';
import { cassetteStore, newId, useCassette } from '@/hooks/useCassettes';
import { useOrbit } from '@/hooks/useOrbit';
import './editor.css';

export function EditCassettePage() {
  const { id } = useParams();
  const cassette = useCassette(id);
  const navigate = useNavigate();

  if (!cassette) {
    return (
      <div className="studio editor">
        <div className="editor-missing">
          <h1>Tape not found</h1>
          <p className="studio-muted">It may have been deleted.</p>
          <Link to="/" className="studio-btn primary">
            Back to library
          </Link>
        </div>
      </div>
    );
  }

  return <Editor cassette={cassette} onDone={() => navigate('/')} />;
}

function Swatches({
  colors,
  value,
  onPick,
  label,
}: {
  colors: string[];
  value: string;
  onPick: (c: string) => void;
  label: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const isCustom = !colors.some((c) => c.toLowerCase() === value.toLowerCase());

  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value.toLowerCase() === c.toLowerCase()}
          aria-label={c}
          className={`swatch${value.toLowerCase() === c.toLowerCase() ? ' on' : ''}`}
          style={{ background: c }}
          onClick={() => onPick(c)}
        />
      ))}
      <button
        type="button"
        className={`swatch swatch-custom${isCustom ? ' on' : ''}`}
        style={isCustom ? { '--custom': value } as React.CSSProperties : undefined}
        title="Custom colour"
        aria-label={`Custom ${label}`}
        aria-expanded={pickerOpen}
        onClick={() => setPickerOpen((o) => !o)}
      />
      {pickerOpen && <ColorPicker value={value} onChange={onPick} onClose={closePicker} />}
    </div>
  );
}

function Editor({ cassette, onDone }: { cassette: Cassette; onDone: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [side, setSide] = useState<TapeSide>('A');
  const [stickerColor, setStickerColor] = useState(STICKER_COLORS[0]);
  const orbit = useOrbit({ x: -10, y: 25 });
  const faceRef = useRef<HTMLDivElement>(null);
  const stickerDrag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const [draggingSticker, setDraggingSticker] = useState(false);

  // Spin the 3D preview round to whichever side is being edited.
  const { setRotation } = orbit;
  useEffect(() => {
    setRotation({ x: -10, y: side === 'B' ? 205 : 25 });
  }, [side, setRotation]);

  const update = (patch: Partial<Cassette>) => cassetteStore.update(cassette.id, patch);

  // Label colour, ink, pen style and stickers belong to the side currently shown.
  const look = sideLook(cassette, side);
  const updateLook = (patch: Partial<SideLook>) =>
    cassetteStore.update(cassette.id, (c) => patchSide(c, side, patch));
  const updateStickers = (fn: (stickers: Sticker[]) => Sticker[]) =>
    cassetteStore.update(cassette.id, (c) => patchSide(c, side, { stickers: fn(sideLook(c, side).stickers) }));
  const updateSticker = (sid: string, patch: Partial<Sticker>) =>
    updateStickers((list) => list.map((s) => (s.id === sid ? { ...s, ...patch } : s)));
  const removeSticker = (sid: string) => {
    updateStickers((list) => list.filter((s) => s.id !== sid));
    setSelectedId(null);
  };

  const selected = look.stickers.find((s) => s.id === selectedId);

  const switchSide = (next: TapeSide) => {
    setSide(next);
    setSelectedId(null);
  };

  const addSticker = (kind: StickerKind) => {
    const s: Sticker = {
      id: newId(),
      kind,
      x: 20 + Math.random() * 60,
      y: 25 + Math.random() * 30,
      rotation: Math.round(Math.random() * 40 - 20),
      scale: 1,
      color: stickerColor,
    };
    updateStickers((list) => [...list, s]);
    setSelectedId(s.id);
  };

  const facePercent = (clientX: number, clientY: number) => {
    const r = faceRef.current!.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * 100, y: ((clientY - r.top) / r.height) * 100 };
  };

  const onStickerPointerDown = (e: React.PointerEvent, s: Sticker) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(s.id);
    setStickerColor(s.color);
    const p = facePercent(e.clientX, e.clientY);
    stickerDrag.current = { id: s.id, dx: p.x - s.x, dy: p.y - s.y };
    setDraggingSticker(true);
  };

  useEffect(() => {
    if (!draggingSticker) return;
    const onMove = (e: PointerEvent) => {
      const d = stickerDrag.current;
      if (!d) return;
      const p = facePercent(e.clientX, e.clientY);
      updateSticker(d.id, {
        x: Math.min(100, Math.max(0, p.x - d.dx)),
        y: Math.min(100, Math.max(0, p.y - d.dy)),
      });
    };
    const onUp = () => {
      stickerDrag.current = null;
      setDraggingSticker(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [draggingSticker, side]);

  // Delete / Backspace removes the selected sticker (unless typing in a field).
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeSticker(selectedId);
      }
      if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  const deleteCassette = () => {
    if (window.confirm(`Delete "${cassette.name}"? This can't be undone.`)) {
      cassetteStore.remove(cassette.id);
      onDone();
    }
  };

  return (
    <div className="studio editor">
      <div className="editor-top">
        <Link to="/" className="studio-btn">
          ← Library
        </Link>
        <span className="studio-muted editor-saved">Changes save automatically</span>
        <div className="row">
          <button type="button" className="studio-btn danger" onClick={deleteCassette}>
            Delete
          </button>
          <button type="button" className="studio-btn primary" onClick={onDone}>
            Done
          </button>
        </div>
      </div>

      <div className="editor-grid">
        {/* ---------------- Customization deck ---------------- */}
        <section className="panel custom-deck">
          <header className="panel-head">
            <h2>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6" />
              </svg>
              Customization deck
            </h2>
          </header>

          <label className="field">
            <span className="field-label">Tape name</span>
            <input
              className="studio-input"
              value={cassette.name}
              maxLength={28}
              placeholder="Name your mix"
              onChange={(e) => update({ name: e.target.value })}
            />
          </label>

          <div className="field">
            <span className="field-label">Shell colour · both sides</span>
            <Swatches label="shell colour" colors={SHELL_COLORS} value={cassette.shellColor} onPick={(c) => update({ shellColor: c })} />
          </div>

          <div className="field">
            <span className="field-label">Shell type · both sides</span>
            <div className="seg">
              {SHELL_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={cassette.shellType === t.id ? 'on' : ''}
                  onClick={() => update({ shellType: t.id })}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>


          {/* ---- Per-side label design ---- */}
          <div className="side-block">
            <div className="side-block-head">
              <span>Label design</span>
              <div className="side-mini" role="radiogroup" aria-label="Side to edit">
                {(['A', 'B'] as const).map((sd) => (
                  <button
                    key={sd}
                    type="button"
                    role="radio"
                    aria-checked={side === sd}
                    className={side === sd ? 'on' : ''}
                    onClick={() => switchSide(sd)}
                  >
                    Side {sd}
                  </button>
                ))}
              </div>
            </div>
            {side === 'B' && (
              <p className="side-block-note studio-muted">
                {sideBHasOwnStyle(cassette)
                  ? 'Side B has its own label style.'
                  : 'Side B copies side A until you change it.'}
                {sideBHasOwnStyle(cassette) && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => update({ sideB: { stickers: cassette.sideB?.stickers } })}
                  >
                    Match side A
                  </button>
                )}
              </p>
            )}

            <div className="field-row">
              <div className="field">
                <span className="field-label">Label</span>
                <Swatches
                  label="label colour"
                  colors={LABEL_COLORS}
                  value={look.labelColor}
                  onPick={(c) => updateLook({ labelColor: c })}
                />
              </div>
              <div className="field">
                <span className="field-label">Ink</span>
                <Swatches
                  label="ink colour"
                  colors={INK_COLORS}
                  value={look.inkColor}
                  onPick={(c) => updateLook({ inkColor: c })}
                />
              </div>
            </div>

            <div className="field">
              <span className="field-label">Pen style</span>
              <div className="seg seg-wrap">
                {PEN_STYLES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={look.penStyle === p.id ? 'on' : ''}
                    style={{ fontFamily: p.font }}
                    onClick={() => updateLook({ penStyle: p.id })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <span className="field-label">Doodle stickers · click to add to side {side}, drag on the tape to place</span>
              <div className="sticker-tray">
                {STICKER_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className="sticker-btn"
                    onClick={() => addSticker(k)}
                    aria-label={`Add ${k} sticker`}
                  >
                    <StickerIcon kind={k} color={stickerColor} />
                  </button>
                ))}
              </div>
              <div className="swatches small">
                {STICKER_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Sticker colour ${c}`}
                    className={`swatch${stickerColor === c ? ' on' : ''}`}
                    style={{ background: c }}
                    onClick={() => {
                      setStickerColor(c);
                      if (selected) updateSticker(selected.id, { color: c });
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- Preview ---------------- */}
        <section className="panel preview">
          <div className="side-switch" role="radiogroup" aria-label="Tape side">
            {(['A', 'B'] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={side === s}
                className={side === s ? 'on' : ''}
                onClick={() => switchSide(s)}
              >
                Side {s}
              </button>
            ))}
            <span className="side-switch-hint studio-muted">
              {side === 'A' ? 'Front of the tape' : 'Back of the tape'}
            </span>
          </div>

          <div className="preview-frame" onPointerDown={() => setSelectedId(null)}>
            <div className="preview-face">
              <FlippableFace
                cassette={cassette}
                side={side}
                width="100cqw"
                faceRef={faceRef}
                selectedStickerId={selectedId}
                onStickerPointerDown={onStickerPointerDown}
              />
            </div>
          </div>

          {selected ? (
            <div className="sticker-tools">
              <label>
                <span className="field-label">Rotate</span>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  value={selected.rotation}
                  onChange={(e) => updateSticker(selected.id, { rotation: Number(e.target.value) })}
                />
              </label>
              <label>
                <span className="field-label">Size</span>
                <input
                  type="range"
                  min={0.5}
                  max={2.5}
                  step={0.05}
                  value={selected.scale}
                  onChange={(e) => updateSticker(selected.id, { scale: Number(e.target.value) })}
                />
              </label>
              <button type="button" className="studio-btn danger" onClick={() => removeSticker(selected.id)}>
                Remove sticker
              </button>
            </div>
          ) : (
            <p className="studio-muted preview-hint">
              Tip: click a sticker to rotate, resize or remove it.
            </p>
          )}

          <div className="preview-3d" {...orbit.bind} onContextMenu={(e) => e.preventDefault()}>
            <div className="preview-3d-scene">
              <Cassette3D cassette={cassette} width={190} rotateX={orbit.rotation.x} rotateY={orbit.rotation.y} animate={!orbit.orbiting} />
            </div>
            <span className="studio-muted">Drag to spin</span>
          </div>
        </section>
      </div>

      <div className="editor-tracks">
        <TrackList cassette={cassette} side={side} onSideChange={setSide} onChange={(tracks) => update({ tracks })} />
      </div>
    </div>
  );
}
