// Edit / create a cassette: colours, label text + pen style, shell type, stickers, tracklist.
// Edits persist locally immediately and sync to the account automatically.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Cassette, CustomSticker, CustomStickerStroke, SideLook, Sticker, StickerKind, TapeSide } from '@runman/shared';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Cassette3D } from '@/components/cassette/Cassette3D';
import { CassetteFace } from '@/components/cassette/CassetteFace';
import { ColorPicker } from '@/components/cassette/ColorPicker';
import { CustomStickerArt } from '@/components/cassette/CustomStickerArt';
import { CUSTOM_SLOT_COUNT, customKind, findCustomSticker } from '@/components/cassette/customStickers';
import { FlippableFace } from '@/components/cassette/FlippableFace';
import { StickerDrawDialog } from '@/components/cassette/StickerDrawDialog';
import { StickerIcon } from '@/components/cassette/StickerIcon';
import { TrackList } from '@/components/cassette/TrackList';
import { VisibilitySwitch } from '@/components/cassette/VisibilitySwitch';
import { removePublicContent, snapshotVisibility, syncPublicContent, visibilityOf } from '@/api/publicSync';
import {
  INK_COLORS,
  LABEL_COLORS,
  PEN_STYLES,
  SHELL_COLORS,
  SHELL_TYPES,
  STICKER_COLORS,
  STICKER_KINDS,
  stickerLabel,
} from '@/components/cassette/constants';
import { faceFor, patchSide, sideBHasOwnStyle, sideLook } from '@/components/cassette/sides';
import { cassetteStore, newId, useCassette, useCassetteSync } from '@/hooks/useCassettes';
import { CassetteSaveControls } from '@/components/cassette/CassetteSaveControls';
import { createEditorSaver } from '@/cassettes/editorSaver';
import { useOrbit } from '@/hooks/useOrbit';
import { useAccount } from '@/hooks/useAccount';
import type { LibraryLocationState } from './LibraryPage';
import './editor.css';

export function EditCassettePage() {
  const { id } = useParams();
  const cassette = useCassette(id);
  const sync = useCassetteSync();
  const navigate = useNavigate();
  const [requested, setRequested] = useState<string | null>(null);
  const requestKey = `${sync.context}:${id}`;
  useEffect(() => {
    if (id && sync.status === 'authenticated') { setRequested(requestKey); void cassetteStore.ensureLoaded(id); }
  }, [id, sync.status, sync.context, requestKey]);

  if (sync.status === 'hidden') return <div className="studio editor"><p role="status">Checking your account…</p></div>;

  if (!cassette) {
    const loading = sync.loading || Boolean(id && sync.tapes[id]?.reloading) || (sync.status === 'authenticated' && requested !== requestKey);
    return (
      <div className="studio editor">
        <div className="editor-missing">
          <h1>{loading ? 'Loading tape…' : 'Tape not found'}</h1>
          <p className="studio-muted" role="status">{loading ? 'Checking your saved library.' : id && sync.tapes[id]?.error ? sync.tapes[id].error : sync.listError ?? 'It may have been deleted or belong to another account.'}</p>
          {sync.status === 'authenticated' && id && <button type="button" className="studio-btn" disabled={loading} onClick={() => void cassetteStore.reload(id)}>Retry loading</button>}
          <Link to="/library" className="studio-btn primary">
            Back to library
          </Link>
        </div>
      </div>
    );
  }

  // The library puts this tape on the pedestal when it opens (if it still exists).
  const backToLibrary = (cassetteSaved = false) => navigate('/library', { state: { focusId: cassette.id, cassetteSaved } satisfies LibraryLocationState });
  // Keyed per account context and tape so each tape gets its own editor (and its own on-exit public sync).
  return <Editor key={`${sync.context}:${cassette.id}`} cassette={cassette} onDone={backToLibrary} />;
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

function Editor({ cassette, onDone }: { cassette: Cassette; onDone: (cassetteSaved?: boolean) => void }) {
  const sync = useCassetteSync();
  const tapeSync = sync.tapes[cassette.id];
  const busy = Boolean(tapeSync?.saving || tapeSync?.deleting || tapeSync?.reloading);
  const [finishing, setFinishing] = useState(false);
  const [saver] = useState(() => createEditorSaver(cassetteStore, cassette.id, sync.context));
  useEffect(() => {
    if (sync.status !== 'authenticated' || !tapeSync?.dirty || tapeSync.error || tapeSync.conflict || tapeSync.cloudMissing) return;
    const timer = window.setTimeout(() => { void saver(); }, 600);
    return () => window.clearTimeout(timer);
  }, [cassette, sync.status, tapeSync?.dirty, tapeSync?.error, tapeSync?.conflict, tapeSync?.cloudMissing, saver]);
  const finish = async () => {
    setFinishing(true);
    const saved = await saver();
    setFinishing(false);
    if (saved && cassetteStore.getSync().context === sync.context) onDone(true);
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [side, setSide] = useState<TapeSide>('A');
  const account = useAccount();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const cancelDelete = useCallback(() => setConfirmingDelete(false), []);
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

  const currentContext = () => cassetteStore.getSync().context === sync.context;
  const update = (patch: Partial<Cassette>) => { if (currentContext()) cassetteStore.update(cassette.id, patch); };

  // ---- Public sharing: pushed to AWS once, when the editor closes ----
  // However the listener leaves (Done, ← Library, the nav bar, browser back), the editor unmounts
  // and syncPublicContent() uploads anything now public and takes down anything made private.
  const latest = useRef(cassette);
  latest.current = cassette;
  const openedWith = useRef(snapshotVisibility(cassette));
  const deleted = useRef(false);
  const exitTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    // StrictMode (dev) unmounts and remounts straight away; cancel that fake exit's sync.
    window.clearTimeout(exitTimer.current);
    return () => {
      exitTimer.current = window.setTimeout(() => {
        if (deleted.current) return;
        void syncPublicContent(openedWith.current, latest.current);
      }, 0);
    };
  }, []);

  // Label colour, ink, pen style and stickers belong to the side currently shown.
  const look = sideLook(cassette, side);
  const updateLook = (patch: Partial<SideLook>) => {
    if (currentContext()) cassetteStore.update(cassette.id, (c) => patchSide(c, side, patch));
  };
  const updateStickers = (fn: (stickers: Sticker[]) => Sticker[]) => {
    if (currentContext()) cassetteStore.update(cassette.id, (c) => patchSide(c, side, { stickers: fn(sideLook(c, side).stickers) }));
  };
  const updateSticker = (sid: string, patch: Partial<Sticker>) =>
    updateStickers((list) => list.map((s) => (s.id === sid ? { ...s, ...patch } : s)));
  const removeSticker = (sid: string) => {
    updateStickers((list) => list.filter((s) => s.id !== sid));
    setSelectedId(null);
  };

  const selected = look.stickers.find((s) => s.id === selectedId);

  // ---- Custom (hand-drawn) stickers: 5 slots shared by both sides ----
  const customs = cassette.customStickers ?? [];
  const [drawing, setDrawing] = useState<{ slot: number; art: CustomSticker | null } | null>(null);
  const [slotMenu, setSlotMenu] = useState<number | null>(null);
  const [removingCustom, setRemovingCustom] = useState<CustomSticker | null>(null);
  const closeDrawing = useCallback(() => setDrawing(null), []);
  const cancelRemoveCustom = useCallback(() => setRemovingCustom(null), []);

  const openDrawing = (slot: number, art: CustomSticker | null) => {
    setSlotMenu(null);
    setSelectedId(null);
    setDrawing({ slot, art });
  };

  /** How many times a drawing is stuck on the tape, across both sides. */
  const timesPlaced = (art: CustomSticker) => {
    const kind = customKind(art.id);
    return [...cassette.stickers, ...(cassette.sideB?.stickers ?? [])].filter((s) => s.kind === kind).length;
  };

  const saveDrawing = (strokes: CustomStickerStroke[]) => {
    const target = drawing;
    setDrawing(null);
    if (!target || !currentContext()) return;
    cassetteStore.update(cassette.id, (c) => {
      const list = c.customStickers ?? [];
      const id = target.art?.id;
      if (id && list.some((a) => a.id === id)) {
        // Editing: every copy already on the tape picks up the new drawing.
        return { customStickers: list.map((a) => (a.id === id ? { ...a, strokes } : a)) };
      }
      if (list.some((a) => a.slot === target.slot)) return {};
      const next = [...list, { id: id ?? newId(), slot: target.slot, strokes }];
      return { customStickers: next.sort((a, b) => a.slot - b.slot) };
    });
  };

  const removeCustom = (art: CustomSticker) => {
    setRemovingCustom(null);
    setSelectedId(null);
    if (!currentContext()) return;
    const kind = customKind(art.id);
    // Peel off every placed copy too, so neither side points at a missing drawing.
    cassetteStore.update(cassette.id, (c) => ({
      customStickers: (c.customStickers ?? []).filter((a) => a.id !== art.id),
      stickers: c.stickers.filter((s) => s.kind !== kind),
      ...(c.sideB?.stickers ? { sideB: { ...c.sideB, stickers: c.sideB.stickers.filter((s) => s.kind !== kind) } } : {}),
    }));
  };

  const requestRemoveCustom = (art: CustomSticker) => {
    setSlotMenu(null);
    if (timesPlaced(art)) setRemovingCustom(art);
    else removeCustom(art);
  };

  // The slot menu closes on any press outside its slot, or on Escape.
  useEffect(() => {
    if (slotMenu === null) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element && e.target.closest('.custom-slot-wrap.open'))) setSlotMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSlotMenu(null);
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [slotMenu]);

  const switchSide = (next: TapeSide) => {
    setSide(next);
    setSelectedId(null);
  };

  const addSticker = (kind: StickerKind, at?: { x: number; y: number }) => {
    const s: Sticker = {
      id: newId(),
      kind,
      x: at ? Math.min(100, Math.max(0, at.x)) : 20 + Math.random() * 60,
      y: at ? Math.min(100, Math.max(0, at.y)) : 25 + Math.random() * 30,
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

  // ---- Drag a sticker from the tray onto the tape (a plain click still adds it at random) ----
  const trayDrag = useRef<{ kind: StickerKind; startX: number; startY: number; pointerId: number; dragging: boolean } | null>(
    null,
  );
  const suppressTrayClick = useRef(false);
  const [ghost, setGhost] = useState<{ kind: StickerKind; x: number; y: number; over: boolean } | null>(null);

  const overFace = (x: number, y: number) => {
    const r = faceRef.current?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  const onTrayDown = (e: React.PointerEvent<HTMLButtonElement>, kind: StickerKind) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    trayDrag.current = { kind, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, dragging: false };
  };

  const onTrayMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = trayDrag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.dragging && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;
    if (!d.dragging) {
      document.documentElement.classList.add('dragging-sticker');
      setSlotMenu(null);
    }
    d.dragging = true;
    setGhost({ kind: d.kind, x: e.clientX, y: e.clientY, over: overFace(e.clientX, e.clientY) });
  };

  const endTrayDrag = (e: React.PointerEvent<HTMLButtonElement>, drop: boolean) => {
    const d = trayDrag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    trayDrag.current = null;
    document.documentElement.classList.remove('dragging-sticker');
    if (!d.dragging) return; // a plain click: onClick adds it
    setGhost(null);
    // The browser may still fire a click for this press; ignore that one.
    suppressTrayClick.current = true;
    window.setTimeout(() => (suppressTrayClick.current = false), 0);
    if (drop && overFace(e.clientX, e.clientY)) addSticker(d.kind, facePercent(e.clientX, e.clientY));
  };

  // Never leave the page stuck on the grabbing cursor if the editor unmounts mid-drag.
  useEffect(() => () => document.documentElement.classList.remove('dragging-sticker'), []);

  const ghostSize = ghost?.over && faceRef.current ? faceRef.current.getBoundingClientRect().width * 0.14 : 56;

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

  const deleteCassette = async () => {
    const context = sync.context;
    if (cassetteStore.getSync().context !== context) return;
    setConfirmingDelete(false);
    const id = cassette.id;
    // Set before removing: a successful remove unmounts the editor, and its on-exit
    // public sync must not re-publish the tape we're deleting.
    deleted.current = true;
    const removed = await cassetteStore.remove(id);
    if (!removed) {
      // Delete failed (e.g. cloud error) — the editor stays open, so keep the on-exit sync.
      deleted.current = false;
      return;
    }
    // Only what was public when the editor opened has reached AWS; take that down.
    void removePublicContent(id, openedWith.current);
    if (cassetteStore.getSync().context === context) onDone();
  };

  return (
    <div className="studio editor workbench">
      <div className="editor-top">
        <button type="button" className="studio-btn" disabled={finishing || Boolean(tapeSync?.deleting || tapeSync?.reloading)} onClick={() => void finish()}>
          ← Library
        </button>
        <div className="row">
          <button type="button" className="studio-btn danger" disabled={busy} onClick={() => setConfirmingDelete(true)}>
            Delete
          </button>
          <button type="button" className="studio-btn primary" disabled={finishing || Boolean(tapeSync?.deleting || tapeSync?.reloading)} onClick={() => void finish()}>
            {finishing ? 'Saving...' : 'Done'}
          </button>
        </div>
      </div>

      <CassetteSaveControls id={cassette.id} />

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
              sideBHasOwnStyle(cassette) ? (
                <div className="sync-card">
                  <div className="sync-text">
                    <strong>Side B has its own style</strong>
                    <span>Copy side A's label colour, ink and pen. Stickers stay.</span>
                  </div>
                  <button
                    type="button"
                    className="sync-btn"
                    onClick={() => update({ sideB: { stickers: cassette.sideB?.stickers } })}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 9a8 8 0 0 1 14-3l2 2M20 4v4h-4M20 15a8 8 0 0 1-14 3l-2-2M4 20v-4h4" />
                    </svg>
                    Sync with side A
                  </button>
                </div>
              ) : (
                <div className="sync-card synced">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                  <div className="sync-text">
                    <strong>Synced with side A</strong>
                    <span>Change any colour or pen below to give side B its own look.</span>
                  </div>
                </div>
              )
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
              <span className="field-label">Stickers · click or drag onto side {side}</span>
              <div className="sticker-tray">
                {STICKER_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className="sticker-btn"
                    onClick={() => {
                      if (suppressTrayClick.current) return;
                      addSticker(k);
                    }}
                    onPointerDown={(e) => onTrayDown(e, k)}
                    onPointerMove={onTrayMove}
                    onPointerUp={(e) => endTrayDrag(e, true)}
                    onPointerCancel={(e) => endTrayDrag(e, false)}
                    aria-label={`Add ${stickerLabel(k)} sticker`}
                    title={stickerLabel(k)}
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

              {/* ---- Your own drawings ---- */}
              <div className="custom-stickers">
                <div className="custom-stickers-head">
                  <span className="field-label">Custom stickers</span>
                  <span className="studio-muted">
                    {customs.length ? `Click to edit · drag onto side ${side}` : 'Press + to draw your own'}
                  </span>
                </div>
                <div className="sticker-tray custom-tray">
                  {Array.from({ length: CUSTOM_SLOT_COUNT }, (_, slot) => {
                    const art = customs.find((a) => a.slot === slot);
                    if (!art) {
                      return (
                        <button
                          key={slot}
                          type="button"
                          className="sticker-btn custom-slot empty"
                          aria-label={`Draw custom sticker ${slot + 1}`}
                          title="Draw a sticker"
                          onClick={() => openDrawing(slot, null)}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                        </button>
                      );
                    }
                    const kind = customKind(art.id);
                    const open = slotMenu === slot;
                    const align = slot === 0 ? ' align-start' : slot === CUSTOM_SLOT_COUNT - 1 ? ' align-end' : '';
                    return (
                      <div key={slot} className={`custom-slot-wrap${open ? ' open' : ''}`}>
                        <button
                          type="button"
                          className="sticker-btn custom-slot"
                          aria-haspopup="menu"
                          aria-expanded={open}
                          aria-label={`Custom sticker ${slot + 1}: options, or drag onto side ${side}`}
                          title="Click to edit or remove · drag onto the tape"
                          onClick={() => {
                            if (suppressTrayClick.current) return;
                            setSlotMenu(open ? null : slot);
                          }}
                          onPointerDown={(e) => onTrayDown(e, kind)}
                          onPointerMove={onTrayMove}
                          onPointerUp={(e) => endTrayDrag(e, true)}
                          onPointerCancel={(e) => endTrayDrag(e, false)}
                        >
                          <CustomStickerArt art={art} />
                        </button>
                        {open && (
                          <div className={`slot-menu${align}`} role="menu" aria-label={`Custom sticker ${slot + 1}`}>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setSlotMenu(null);
                                addSticker(kind);
                              }}
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M12 5v14M5 12h14" />
                              </svg>
                              Stick on side {side}
                            </button>
                            <button type="button" role="menuitem" onClick={() => openDrawing(slot, art)}>
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M4 20l1-5L16 4l4 4L9 19zM14 6l4 4" />
                              </svg>
                              Edit drawing
                            </button>
                            <button type="button" role="menuitem" className="danger" onClick={() => requestRemoveCustom(art)}>
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
                              </svg>
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ---- Cassette settings: who can see this tape ---- */}
          <div className="side-block settings-block">
            <div className="side-block-head">
              <span>Cassette settings</span>
            </div>
            <div className="field">
              <span className="field-label">Visibility</span>
              <VisibilitySwitch
                label="Cassette visibility"
                value={visibilityOf(cassette)}
                onChange={(visibility) => update({ visibility })}
              />
              <p className="settings-note studio-muted">
                {visibilityOf(cassette) === 'public'
                  ? 'Anyone can view and play this whole tape on Explore, including your uploads and recordings, and add it to their library'
                  : 'Only you can see this tape'}{' '}
                {/* Marking a song public as well lists it on its own under Explore → Songs. */}
              </p>
              {visibilityOf(cassette) === 'public' && account.status === 'ready' && !account.profile?.hasUsername && (
                <p className="settings-note" role="note">
                  Pick a username on your <Link to="/account">Account page</Link> first, or this tape won't appear on Explore.
                </p>
              )}
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

          <div className={`preview-frame${ghost?.over ? ' drop-target' : ''}`} onPointerDown={() => setSelectedId(null)}>
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

        {/* ---------------- Tracklist (right pane) ---------------- */}
        <TrackList cassette={cassette} side={side} onSideChange={setSide} onChange={(tracks) => update({ tracks })} />
      </div>

      {ghost && (
        <div
          className={`sticker-ghost${ghost.over ? ' over' : ''}`}
          style={{ left: ghost.x, top: ghost.y, width: ghostSize, height: ghostSize }}
          aria-hidden="true"
        >
          <StickerIcon kind={ghost.kind} color={stickerColor} art={findCustomSticker(customs, ghost.kind)} />
        </div>
      )}

      {drawing && <StickerDrawDialog art={drawing.art} onSave={saveDrawing} onCancel={closeDrawing} />}

      <ConfirmDialog
        open={removingCustom !== null}
        danger
        title="Peel off this sticker?"
        message={
          removingCustom && (
            <>
              It's stuck on this tape {timesPlaced(removingCustom) === 1 ? 'once' : `${timesPlaced(removingCustom)} times`}.
              Removing the drawing peels those copies off too.
            </>
          )
        }
        confirmLabel="Remove sticker"
        cancelLabel="Keep it"
        onConfirm={() => removingCustom && removeCustom(removingCustom)}
        onCancel={cancelRemoveCustom}
      >
        {removingCustom && (
          <div className="custom-remove-visual">
            <CustomStickerArt art={removingCustom} />
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmingDelete}
        danger
        title="Toss this tape?"
        message={
          <>
            <strong>{cassette.name || 'Untitled'}</strong> and its tracklist will be deleted from {tapeSync?.revision ? 'your account and this device' : 'this device'}. This
            can't be undone. Audio files are not deleted.
          </>
        }
        confirmLabel="Delete tape"
        cancelLabel="Keep it"
        onConfirm={deleteCassette}
        onCancel={cancelDelete}
      >
        <CassetteFace cassette={faceFor(cassette, 'A')} width={200} />
      </ConfirmDialog>
    </div>
  );
}
