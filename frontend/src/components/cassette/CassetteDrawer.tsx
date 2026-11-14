// The tape library as a wooden cabinet drawer sliding out from the right edge.
// Open/close it by clicking the drawer front, or grab the front (or the drawer's header) and
// drag it: it follows your hand and snaps open/closed on release (a quick flick counts too).
// Click a tape spine to put that tape on the stage, or drag it straight out of the drawer.

import { useRef, useState } from 'react';
import type { Cassette } from '@runman/shared';
import { penFont } from './constants';
import './drawer.css';

interface CassetteDrawerProps {
  cassettes: Cassette[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeId: string | null;
  loadedId: string | null;
  /** Spine clicked without dragging. */
  onSelect: (id: string) => void;
  /** Spine dragged past the threshold: caller takes over the drag from here. */
  onDragOut: (id: string, clientX: number, clientY: number) => void;
  onEdit: (id: string) => void;
  onCreate: () => void;
  /** Highlights the drawer as a "put it back" drop target. */
  dropHover?: boolean;
  panelRef?: React.RefObject<HTMLElement | null>;
}

const DRAG_THRESHOLD = 8;
const PULL_THRESHOLD = 5;
const FLICK_SPEED = 0.5; // px per ms

interface PullState {
  pointerId: number;
  startX: number;
  base: number; // translateX when the drag started (0 = open, width = closed)
  width: number;
  x: number;
  moved: boolean;
  lastX: number;
  lastT: number;
  velocity: number;
}

export function CassetteDrawer({
  cassettes,
  open,
  onOpenChange,
  activeId,
  loadedId,
  onSelect,
  onDragOut,
  onEdit,
  onCreate,
  dropHover,
  panelRef,
}: CassetteDrawerProps) {
  const ownRef = useRef<HTMLElement | null>(null);
  const pending = useRef<{ id: string; x: number; y: number; pointerId: number } | null>(null);
  const pull = useRef<PullState | null>(null);
  const [dragX, setDragX] = useState<number | null>(null);

  const setRefs = (el: HTMLElement | null) => {
    ownRef.current = el;
    if (panelRef) panelRef.current = el;
  };

  // ---- Pulling the drawer itself ----
  const onPullDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !ownRef.current) return;
    if ((e.target as HTMLElement).closest('button, .spine')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const width = ownRef.current.offsetWidth;
    const base = open ? 0 : width;
    pull.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      base,
      width,
      x: base,
      moved: false,
      lastX: e.clientX,
      lastT: performance.now(),
      velocity: 0,
    };
  };

  const onPullMove = (e: React.PointerEvent<HTMLElement>) => {
    const p = pull.current;
    if (!p || p.pointerId !== e.pointerId) return;
    const dx = e.clientX - p.startX;
    if (!p.moved && Math.abs(dx) < PULL_THRESHOLD) return;
    p.moved = true;
    const now = performance.now();
    p.velocity = (e.clientX - p.lastX) / Math.max(1, now - p.lastT);
    p.lastX = e.clientX;
    p.lastT = now;
    // Stay on the rail: never further open than fully open, never further shut than shut.
    p.x = Math.min(p.width, Math.max(0, p.base + dx));
    setDragX(p.x);
  };

  /** Snap open/shut from wherever the drag ended. */
  const settle = (p: PullState) => {
    pull.current = null;
    setDragX(null);
    if (!p.moved) return;
    const next = Math.abs(p.velocity) > FLICK_SPEED ? p.velocity < 0 : p.x < p.width / 2;
    onOpenChange(next);
  };

  const onPullUp = (e: React.PointerEvent<HTMLElement>) => {
    const p = pull.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (!p.moved) {
      pull.current = null;
      if ((e.target as HTMLElement).closest('.drawer-front')) onOpenChange(!open);
      return;
    }
    settle(p);
  };

  // If the release happens outside the page (e.g. over VS Code's browser chrome) we never get
  // pointerup, only lost capture / cancel. Settle anyway so the drawer can't freeze halfway.
  const onPullAbort = (e: React.PointerEvent<HTMLElement>) => {
    const p = pull.current;
    if (p && p.pointerId === e.pointerId) settle(p);
  };

  const pullHandlers = {
    onPointerDown: onPullDown,
    onPointerMove: onPullMove,
    onPointerUp: onPullUp,
    onPointerCancel: onPullAbort,
    onLostPointerCapture: onPullAbort,
  };

  // ---- Pulling a tape out of the drawer ----
  const onSpineDown = (e: React.PointerEvent<HTMLLIElement>, id: string) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    pending.current = { id, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    // Keep receiving moves even if the pointer leaves the spine in one big jump.
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onSpineMove = (e: React.PointerEvent<HTMLLIElement>) => {
    const p = pending.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_THRESHOLD) {
      pending.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
      onDragOut(p.id, e.clientX, e.clientY);
    }
  };

  const onSpineUp = (e: React.PointerEvent<HTMLLIElement>) => {
    const p = pending.current;
    if (!p || p.pointerId !== e.pointerId) return;
    pending.current = null;
    onSelect(p.id);
  };

  return (
    <aside
      ref={setRefs}
      className={`drawer${open ? ' open' : ''}${dragX !== null ? ' pulling' : ''}${dropHover ? ' drop-hover' : ''}`}
      style={dragX !== null ? { transform: `translateX(${dragX}px)` } : undefined}
    >
      {/* Drawer front: click to open/close, or grab and drag */}
      <div
        className="drawer-front"
        role="button"
        tabIndex={0}
        aria-label={open ? 'Close library drawer' : 'Open library drawer'}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenChange(!open);
          }
        }}
        {...pullHandlers}
      >
        <span className="drawer-front-label">LIBRARY</span>
        <span className="drawer-pull" aria-hidden="true">
          <span />
        </span>
        <span className="drawer-front-count">{cassettes.length}</span>
      </div>

      <div className="drawer-box">
        <header className="drawer-head" {...pullHandlers}>
          <h2>Library</h2>
          <span>{cassettes.length} tapes</span>
        </header>

        {dropHover && <div className="drawer-drop-note">Release to put it back</div>}

        <ul className="drawer-list">
          {cassettes.map((c) => (
            <li
              key={c.id}
              className={`spine${activeId === c.id ? ' on-stage' : ''}`}
              style={{ '--shell': c.shellColor, '--label': c.labelColor, '--ink': c.inkColor } as React.CSSProperties}
              onPointerDown={(e) => onSpineDown(e, c.id)}
              onPointerMove={onSpineMove}
              onPointerUp={onSpineUp}
              onPointerCancel={() => (pending.current = null)}
              title="Click or drag out to pick up"
            >
              <span className="spine-label" style={{ fontFamily: penFont(c.penStyle) }}>
                {c.name || 'Untitled'}
              </span>
              {loadedId === c.id && <span className="spine-badge">IN DECK</span>}
              {activeId === c.id && <span className="spine-badge">OUT</span>}
              <button type="button" className="spine-edit" onClick={() => onEdit(c.id)} aria-label={`Edit ${c.name}`}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />
                </svg>
              </button>
            </li>
          ))}
        </ul>

        <button type="button" className="drawer-create" onClick={onCreate}>
          <span>+</span> New cassette
        </button>
      </div>
    </aside>
  );
}
