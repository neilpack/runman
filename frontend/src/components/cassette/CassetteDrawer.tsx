// The tape library as a wooden cabinet drawer sliding out from the right edge.
// Open/close it by clicking the drawer front, or grab the front (or the drawer's header) and
// drag it: it follows your hand and snaps open/closed on release (a quick flick counts too).
// Click a tape spine to put that tape on the stage, or drag it straight out of the drawer.
// In "My order" (the default sort) each spine has a grip on its left: drag it up/down, or focus
// it and use the arrow keys, to arrange the library however you like.

import { useEffect, useRef, useState } from 'react';
import type { Cassette } from '@runman/shared';
import { SHELL_TYPES, penFont } from './constants';
import {
  COLOR_FAMILIES,
  DEFAULT_FILTER,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  activeFilterCount,
  filterTapes,
  isFiltering,
  type TapeFilter,
} from './libraryFilter';
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
  /** New arrangement of the whole library, as tape ids in order. */
  onReorder: (ids: string[]) => void;
  /** Highlights the drawer as a "put it back" drop target. */
  dropHover?: boolean;
  panelRef?: React.RefObject<HTMLElement | null>;
}

const DRAG_THRESHOLD = 8;
const PULL_THRESHOLD = 5;
const FLICK_SPEED = 0.5; // px per ms

interface ArrangeState {
  pointerId: number;
  id: string;
  startY: number;
  startIndex: number;
  /** Distance from one spine's top to the next (spine height + gap). */
  pitch: number;
  order: string[];
  /** Slot the tape would land in if released now. */
  target: number;
}

/** Move `id` to `to` within `ids`. */
function moveTo(ids: string[], id: string, to: number): string[] {
  const next = ids.filter((x) => x !== id);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, id);
  return next;
}

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
  onReorder,
  dropHover,
  panelRef,
}: CassetteDrawerProps) {
  const ownRef = useRef<HTMLElement | null>(null);
  const pending = useRef<{ id: string; x: number; y: number; pointerId: number } | null>(null);
  const pull = useRef<PullState | null>(null);
  const [dragX, setDragX] = useState<number | null>(null);
  const [filter, setFilter] = useState<TapeFilter>(DEFAULT_FILTER);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const arrange = useRef<ArrangeState | null>(null);
  /**
   * While arranging. The list's DOM order stays put during the drag (moving the node under the
   * pointer would drop its pointer capture and end the drag); tapes only slide visually.
   */
  const [arranging, setArranging] = useState<{ id: string; dy: number; from: number; to: number; pitch: number } | null>(
    null,
  );

  /** One frame with transitions off after a drop, so tapes don't replay their slide from the old slot. */
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    if (!settling) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => (inner = requestAnimationFrame(() => setSettling(false))));
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [settling]);

  const filtering = isFiltering(filter);
  // Your own order only makes sense on the full, unsorted list.
  const canArrange = filter.sort === 'custom' && !filtering;
  const shown = filterTapes(cassettes, filter, loadedId);

  /** Visual offset of the spine at index i while a tape is being arranged. */
  const arrangeShift = (i: number, id: string): number => {
    if (!arranging) return 0;
    const { from, to, pitch } = arranging;
    if (id === arranging.id) return arranging.dy;
    if (from < to && i > from && i <= to) return -pitch;
    if (to < from && i >= to && i < from) return pitch;
    return 0;
  };
  const filterCount = activeFilterCount(filter);
  const patchFilter = (patch: Partial<TapeFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const toggleIn = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const setRefs = (el: HTMLElement | null) => {
    ownRef.current = el;
    if (panelRef) panelRef.current = el;
  };

  // ---- Pulling the drawer itself ----
  const onPullDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !ownRef.current) return;
    if ((e.target as HTMLElement).closest('button, input, select, .spine, .drawer-tools, .drawer-filters')) return;
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
    if ((e.target as HTMLElement).closest('button, .spine-grip')) return;
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

  // ---- Arranging tapes by their grip ----
  const onGripDown = (e: React.PointerEvent<HTMLSpanElement>, id: string) => {
    if (e.button !== 0 || !canArrange || !listRef.current) return;
    e.preventDefault();
    e.stopPropagation(); // Not a pick-up: the spine's own drag-out handler stays out of it.
    const items = [...listRef.current.querySelectorAll<HTMLElement>(':scope > .spine')];
    const order = shown.map((c) => c.id);
    const startIndex = order.indexOf(id);
    const pitch =
      items.length > 1
        ? items[1].getBoundingClientRect().top - items[0].getBoundingClientRect().top
        : items[0]?.getBoundingClientRect().height || 58;
    e.currentTarget.setPointerCapture(e.pointerId);
    arrange.current = { pointerId: e.pointerId, id, startY: e.clientY, startIndex, pitch, order, target: startIndex };
    setArranging({ id, dy: 0, from: startIndex, to: startIndex, pitch });
  };

  const onGripMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    const a = arrange.current;
    if (!a || a.pointerId !== e.pointerId) return;
    const dy = e.clientY - a.startY;
    // Keep the tape within the list.
    const clamped = Math.max(-a.startIndex * a.pitch, Math.min((a.order.length - 1 - a.startIndex) * a.pitch, dy));
    a.target = a.startIndex + Math.round(clamped / a.pitch);
    // The tape follows the pointer; the others slide aside to open its new slot.
    setArranging({ id: a.id, dy: clamped, from: a.startIndex, to: a.target, pitch: a.pitch });
  };

  const endArrange = (e: React.PointerEvent<HTMLSpanElement>) => {
    const a = arrange.current;
    if (!a || a.pointerId !== e.pointerId) return;
    arrange.current = null;
    setArranging(null);
    setSettling(true);
    if (a.target !== a.startIndex) onReorder(moveTo(a.order, a.id, a.target));
  };

  const onGripKey = (e: React.KeyboardEvent<HTMLSpanElement>, id: string) => {
    if (!canArrange) return;
    const order = shown.map((c) => c.id);
    const i = order.indexOf(id);
    const to =
      e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? order.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    if (to < 0 || to >= order.length || to === i) return;
    onReorder(moveTo(order, id, to));
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

        {/* ---- Search + filters ---- */}
        <div className="drawer-tools">
          <label className="drawer-search">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4.5 4.5" />
            </svg>
            <input
              ref={searchRef}
              type="search"
              placeholder="Search tapes, songs, artists"
              value={filter.query}
              onChange={(e) => patchFilter({ query: e.target.value })}
              onKeyDown={(e) => e.key === 'Escape' && patchFilter({ query: '' })}
              aria-label="Search your tapes"
            />
            {filter.query && (
              <button
                type="button"
                className="drawer-search-clear"
                onClick={() => {
                  patchFilter({ query: '' });
                  searchRef.current?.focus();
                }}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </label>
          <button
            type="button"
            className={`drawer-filter-btn${filtersOpen || filterCount ? ' on' : ''}`}
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            aria-label="Filters"
            title="Filter and sort"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            {filterCount > 0 && <span className="drawer-filter-badge">{filterCount}</span>}
          </button>
        </div>

        {filtersOpen && (
          <div className="drawer-filters">
            <div className="df-group" role="radiogroup" aria-label="Show">
              {STATUS_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={filter.status === o.id}
                  className={`df-chip${filter.status === o.id ? ' on' : ''}`}
                  onClick={() => patchFilter({ status: o.id })}
                >
                  {o.label}
                </button>
              ))}
            </div>

            <div className="df-row">
              <span className="df-label">Shell</span>
              <div className="df-group">
                {SHELL_TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={filter.shellTypes.includes(t.id)}
                    className={`df-chip${filter.shellTypes.includes(t.id) ? ' on' : ''}`}
                    onClick={() => patchFilter({ shellTypes: toggleIn(filter.shellTypes, t.id) })}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="df-row">
              <span className="df-label">Colour</span>
              <div className="df-group">
                {COLOR_FAMILIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={filter.colors.includes(c.id)}
                    aria-label={c.id}
                    title={c.id}
                    className={`df-dot${filter.colors.includes(c.id) ? ' on' : ''}`}
                    style={{ background: c.swatch }}
                    onClick={() => patchFilter({ colors: toggleIn(filter.colors, c.id) })}
                  />
                ))}
              </div>
            </div>

            <div className="df-row">
              <label className="df-label" htmlFor="drawer-sort">
                Sort
              </label>
              <select
                id="drawer-sort"
                className="df-select"
                value={filter.sort}
                onChange={(e) => patchFilter({ sort: e.target.value as TapeFilter['sort'] })}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {filtering && (
          <p className="drawer-count">
            Showing {shown.length} of {cassettes.length}
            <button type="button" className="drawer-reset" onClick={() => setFilter((f) => ({ ...DEFAULT_FILTER, sort: f.sort }))}>
              Clear
            </button>
          </p>
        )}

        {dropHover && <div className="drawer-drop-note">Release to put it back</div>}

        {shown.length === 0 && cassettes.length > 0 && (
          <div className="drawer-empty">
            <p>No tapes match.</p>
            <button type="button" className="drawer-reset" onClick={() => setFilter((f) => ({ ...DEFAULT_FILTER, sort: f.sort }))}>
              Clear search and filters
            </button>
          </div>
        )}

        <ul ref={listRef} className={`drawer-list${arranging ? ' arranging' : ''}${settling ? ' settling' : ''}`}>
          {shown.map((c, i) => (
            <li
              key={c.id}
              className={`spine${activeId === c.id ? ' on-stage' : ''}${arranging?.id === c.id ? ' lifted' : ''}`}
              style={
                {
                  '--shell': c.shellColor,
                  '--label': c.labelColor,
                  '--ink': c.inkColor,
                  ...(arranging
                    ? {
                        transform:
                          arranging.id === c.id
                            ? `translate(-10px, ${arrangeShift(i, c.id)}px) rotate(-1.5deg)`
                            : `translateY(${arrangeShift(i, c.id)}px)`,
                      }
                    : {}),
                } as React.CSSProperties
              }
              onPointerDown={(e) => onSpineDown(e, c.id)}
              onPointerMove={onSpineMove}
              onPointerUp={onSpineUp}
              onPointerCancel={() => (pending.current = null)}
              title="Click or drag out to pick up"
            >
              {canArrange && (
                <span
                  className="spine-grip"
                  role="button"
                  tabIndex={0}
                  aria-label={`Move ${c.name || 'Untitled'}, position ${i + 1} of ${shown.length}. Use arrow keys.`}
                  title="Drag to rearrange (or use the arrow keys)"
                  onPointerDown={(e) => onGripDown(e, c.id)}
                  onPointerMove={onGripMove}
                  onPointerUp={endArrange}
                  onPointerCancel={endArrange}
                  onLostPointerCapture={endArrange}
                  onKeyDown={(e) => onGripKey(e, c.id)}
                >
                  <svg viewBox="0 0 10 16" aria-hidden="true">
                    {[3, 8, 13].flatMap((y) => [<circle key={`a${y}`} cx="2.5" cy={y} r="1.4" />, <circle key={`b${y}`} cx="7.5" cy={y} r="1.4" />])}
                  </svg>
                </span>
              )}
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
