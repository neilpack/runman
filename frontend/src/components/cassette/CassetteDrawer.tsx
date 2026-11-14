// Slide-out drawer listing the user's cassette library as tape "spines".
// Click a spine to put that tape on the stage, or drag it straight out of the drawer.

import { useRef } from 'react';
import type { Cassette } from '@runman/shared';
import { penFont } from './constants';
import './drawer.css';

interface CassetteDrawerProps {
  cassettes: Cassette[];
  open: boolean;
  onToggle: () => void;
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
  panelRef?: React.Ref<HTMLElement>;
}

const DRAG_THRESHOLD = 8;

export function CassetteDrawer({
  cassettes,
  open,
  onToggle,
  activeId,
  loadedId,
  onSelect,
  onDragOut,
  onEdit,
  onCreate,
  dropHover,
  panelRef,
}: CassetteDrawerProps) {
  const pending = useRef<{ id: string; x: number; y: number; pointerId: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLLIElement>, id: string) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    pending.current = { id, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    // Keep receiving moves even if the pointer leaves the spine in one big jump.
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLLIElement>) => {
    const p = pending.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG_THRESHOLD) {
      pending.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
      onDragOut(p.id, e.clientX, e.clientY);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLLIElement>) => {
    const p = pending.current;
    if (!p || p.pointerId !== e.pointerId) return;
    pending.current = null;
    onSelect(p.id);
  };

  return (
    <aside ref={panelRef} className={`drawer${open ? ' open' : ''}${dropHover ? ' drop-hover' : ''}`}>
      <button
        type="button"
        className="drawer-handle"
        onClick={onToggle}
        aria-label={open ? 'Close library' : 'Open library'}
        aria-expanded={open}
      >
        <svg viewBox="0 0 40 24" aria-hidden="true">
          <path d="M2 12l7-7v4h22V5l7 7-7 7v-4H9v4z" />
          <path d="M20 5l7 7-7 7-7-7z" className="drawer-handle-gem" />
        </svg>
      </button>

      <header className="drawer-head">
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
            onPointerDown={(e) => onPointerDown(e, c.id)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
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
    </aside>
  );
}
