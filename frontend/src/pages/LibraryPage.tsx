// Main page: the cassette "studio". Pick a tape from the library drawer, play with it in 3D,
// then drop it into the RunMan deck to load it, or onto the Edit pad to customize it.
//
// Interaction model (mouse, pen and touch all use pointer events):
//   drag the cassette ............ pick it up and move it (it tilts with your motion)
//   drag empty space / right-drag  rotate it to look around
//   double-click ................. flip to the other side
//   drop on deck / edit pad / drawer  load / edit / put away

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TapeSide } from '@runman/shared';
import { Link, useNavigate } from 'react-router';
import { Cassette3D, CASSETTE_ASPECT } from '@/components/cassette/Cassette3D';
import { CassetteDrawer } from '@/components/cassette/CassetteDrawer';
import { CassettePlayer, type DeckControl } from '@/components/cassette/CassettePlayer';
import { cassetteStore, useCassettes, useCassetteSync } from '@/hooks/useCassettes';
import { CassetteCloudPanel } from '@/components/cassette/CassetteCloudPanel';
import { useSession } from '@/hooks/useSession';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { playSfx } from '@/audio/sfx';
import './library.css';

type Zone = 'player' | 'edit' | 'drawer' | null;
type DragMode = 'move' | 'rotate';

interface DragState {
  mode: DragMode;
  /** Cassette being moved (null while rotating). */
  id: string | null;
  offsetX: number;
  offsetY: number;
  lastX: number;
  lastY: number;
  lastT: number;
  startX: number;
  startY: number;
}

const REST_ROTATION = { x: -14, y: 22 };

/**
 * Library backdrop. 'welcome' uses the welcome page's dark gradient and twinkling starfield;
 * 'studio' is the original plain dark studio. Flip this to compare.
 */
const BACKDROP: 'welcome' | 'studio' = 'welcome';
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const CONTROL_LABEL: Record<DeckControl, string> = {
  pause: '❚❚ PAUSE',
  play: '▶ PLAY',
  rewind: '◀◀ REWIND',
  fastForward: '▶▶ FAST FWD',
  stop: '■ STOP',
  record: '● REC',
  flip: '⟲ FLIP',
  eject: '⏏ EJECT',
};

function inside(el: Element | null, x: number, y: number, pad = 0) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}

export function LibraryPage() {
  const sync = useCassetteSync();
  const session = useSession();
  if (sync.status === 'hidden') return (
    <div className="studio editor"><div className="editor-missing">
      <p role="status">{session.status === 'checking' || session.status === 'signingOut' ? 'Checking your account…' : 'Your account session is unavailable.'}</p>
      {session.error && <p role="alert">{session.error}</p>}
      <Link to="/login" className="studio-btn">Sign in</Link>
    </div></div>
  );
  return <LibraryStudio key={sync.context} />;
}

function LibraryStudio() {
  const sync = useCassetteSync();
  const cassettes = useCassettes();
  const navigate = useNavigate();
  const small = useMediaQuery('(max-width: 760px)');
  const width = small ? 170 : 230;
  const height = width * CASSETTE_ASPECT;

  const [drawerOpen, setDrawerOpen] = useState(() => window.innerWidth > 760);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [side, setSide] = useState<TapeSide>('A');
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [rot, setRot] = useState(REST_ROTATION);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [dragMode, setDragMode] = useState<DragMode | null>(null);
  const [zone, setZone] = useState<Zone>(null);
  const [animateRot, setAnimateRot] = useState(false);
  const [landKey, setLandKey] = useState(0);
  const [lcd, setLcd] = useState<string | undefined>();

  const stageRef = useRef<HTMLDivElement>(null);
  const pedestalRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const drag = useRef<DragState | null>(null);
  const zoneRef = useRef<Zone>(null);
  const initiallyPlaced = useRef(false);
  const tiltTimer = useRef<number | undefined>(undefined);
  const lcdTimer = useRef<number | undefined>(undefined);

  const active = cassettes.find((c) => c.id === activeId);
  const loaded = cassettes.find((c) => c.id === loadedId);

  const toStage = useCallback((cx: number, cy: number) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  }, []);

  const pedestalCenter = useCallback(() => {
    const s = stageRef.current!.getBoundingClientRect();
    const p = pedestalRef.current!.getBoundingClientRect();
    return { x: p.left + p.width / 2 - s.left, y: p.top + p.height / 2 - s.top };
  }, []);

  const placeOnStage = useCallback(
    (id: string) => {
      setActiveId(id);
      setLoadedId((l) => (l === id ? null : l));
      setPos(pedestalCenter());
      setAnimateRot(false);
      setRot(REST_ROTATION);
      setLandKey((k) => k + 1);
    },
    [pedestalCenter],
  );

  const hitZone = useCallback(
    (x: number, y: number): Zone => {
      if (inside(slotRef.current, x, y, 40)) return 'player';
      if (inside(editRef.current, x, y, 10)) return 'edit';
      if (drawerOpen && inside(drawerRef.current, x, y)) return 'drawer';
      return null;
    },
    [drawerOpen],
  );

  const beginMove = useCallback(
    (id: string, cx: number, cy: number, offset = { x: 0, y: 0 }) => {
      setActiveId(id);
      setLoadedId((l) => (l === id ? null : l));
      const p = toStage(cx, cy);
      setPos({ x: p.x - offset.x, y: p.y - offset.y });
      setAnimateRot(false);
      drag.current = {
        mode: 'move',
        id,
        offsetX: offset.x,
        offsetY: offset.y,
        lastX: cx,
        lastY: cy,
        lastT: performance.now(),
        startX: cx,
        startY: cy,
      };
      zoneRef.current = hitZone(cx, cy);
      setZone(zoneRef.current);
      setDragMode('move');
    },
    [toStage, hitZone],
  );

  const beginRotate = (cx: number, cy: number) => {
    setAnimateRot(false);
    drag.current = {
      mode: 'rotate',
      id: null,
      offsetX: 0,
      offsetY: 0,
      lastX: cx,
      lastY: cy,
      lastT: performance.now(),
      startX: cx,
      startY: cy,
    };
    setDragMode('rotate');
  };

  // Show the first tape on the pedestal when the page opens.
  useEffect(() => {
    const first = cassettes[0];
    if (!initiallyPlaced.current && first) { initiallyPlaced.current = true; placeOnStage(first.id); }
  }, [placeOnStage, cassettes]);

  // Window-level pointer tracking. The listeners are attached once and always delegate to the
  // latest handlers, so a fast drag whose pointerup lands before React re-renders isn't lost.
  const handlers = useRef<{ move: (e: PointerEvent) => void; up: () => void } | null>(null);
  useLayoutEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const now = performance.now();
      const dx = e.clientX - d.lastX;
      const dy = e.clientY - d.lastY;
      const dt = Math.max(8, now - d.lastT);
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      d.lastT = now;

      if (d.mode === 'move') {
        const p = toStage(e.clientX, e.clientY);
        setPos({ x: p.x - d.offsetX, y: p.y - d.offsetY });
        // Wobble in the direction of travel, then spring back when the hand stops.
        setTilt({ x: clamp((-dy / dt) * 18, -35, 35), y: clamp((dx / dt) * 18, -40, 40) });
        window.clearTimeout(tiltTimer.current);
        tiltTimer.current = window.setTimeout(() => setTilt({ x: 0, y: 0 }), 90);
        const z = hitZone(e.clientX, e.clientY);
        if (z !== zoneRef.current) {
          zoneRef.current = z;
          setZone(z);
        }
      } else {
        setRot((r) => ({ x: clamp(r.x - dy * 0.5, -85, 85), y: r.y + dx * 0.5 }));
      }
    };

    const onUp = () => {
      const d = drag.current;
      drag.current = null;
      setDragMode(null);
      setTilt({ x: 0, y: 0 });
      setZone(null);
      if (d?.mode !== 'move' || !d.id) return;

      const z = zoneRef.current;
      zoneRef.current = null;
      if (z === 'player') {
        playSfx('insert');
        setLoadedId(d.id);
        setSide('A');
        setActiveId(null);
      } else if (z === 'edit') {
        navigate(`/cassettes/${d.id}/edit`);
      } else if (z === 'drawer') {
        setActiveId(null);
      } else {
        const s = stageRef.current!.getBoundingClientRect();
        setPos((p) => ({
          x: clamp(p.x, width / 2, s.width - width / 2),
          y: clamp(p.y, height / 2 + 10, s.height - height / 2 - 10),
        }));
        // Squash-and-stretch landing, but not for a plain click.
        if (Math.hypot(d.lastX - d.startX, d.lastY - d.startY) > 4) setLandKey((k) => k + 1);
      }
    };

    handlers.current = { move: onMove, up: onUp };
  });

  useEffect(() => {
    const onMove = (e: PointerEvent) => drag.current && handlers.current?.move(e);
    const onUp = () => drag.current && handlers.current?.up();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(tiltTimer.current);
      window.clearTimeout(lcdTimer.current);
    },
    [],
  );

  // Keep a resting tape inside the free area when the drawer opens/closes or the window resizes.
  useEffect(() => {
    const keepInView = () => {
      if (drag.current || !stageRef.current) return;
      const s = stageRef.current.getBoundingClientRect();
      const freeRight = s.width - (drawerOpen && !small ? 290 : 0);
      setPos((p) => ({
        x: clamp(p.x, width / 2 + 8, Math.max(width / 2 + 8, freeRight - width / 2 - 16)),
        y: clamp(p.y, height / 2 + 10, s.height - height / 2 - 10),
      }));
    };
    const t = window.setTimeout(keepInView, 460);
    window.addEventListener('resize', keepInView);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', keepInView);
    };
  }, [drawerOpen, small, width, height]);

  // If the active/loaded cassette was deleted elsewhere, drop the reference.
  useEffect(() => {
    if (activeId && !active) setActiveId(null);
    if (loadedId && !loaded) setLoadedId(null);
  }, [activeId, active, loadedId, loaded]);

  const onCassettePointerDown = (e: React.PointerEvent) => {
    if (!activeId) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.button === 2 || e.shiftKey) {
      beginRotate(e.clientX, e.clientY);
      return;
    }
    if (e.button !== 0) return;
    const p = toStage(e.clientX, e.clientY);
    beginMove(activeId, e.clientX, e.clientY, { x: p.x - pos.x, y: p.y - pos.y });
  };

  const onStagePointerDown = (e: React.PointerEvent) => {
    if (!activeId) return;
    if ((e.target as HTMLElement).closest('.deck, .drawer, .edit-pad, button, a')) return;
    e.preventDefault();
    beginRotate(e.clientX, e.clientY);
  };

  const flip = () => {
    setAnimateRot(true);
    setRot((r) => ({ x: 0, y: Math.round((r.y + 180) / 180) * 180 }));
  };

  const onControl = (control: DeckControl) => {
    if (control === 'eject') {
      if (!loadedId) return;
      const id = loadedId;
      setLoadedId(null);
      if (!activeId) placeOnStage(id);
      return;
    }
    if (control === 'flip') {
      setSide((s) => (s === 'A' ? 'B' : 'A'));
      return;
    }
    // Playback isn't implemented yet: just echo the key on the LCD.
    // The playback dev should replace this with real transport logic.
    setLcd(CONTROL_LABEL[control]);
    window.clearTimeout(lcdTimer.current);
    lcdTimer.current = window.setTimeout(() => setLcd(undefined), 1200);
  };

  const create = () => {
    if (cassetteStore.getSync().context !== sync.context) return;
    const c = cassetteStore.create();
    navigate(`/cassettes/${c.id}/edit`);
  };

  const held = dragMode === 'move';

  return (
    <div className={`studio library${BACKDROP === 'welcome' ? ' library-welcome' : ''}`}>
      <CassetteCloudPanel onCreate={create} />
      <div
        ref={stageRef}
        className={`stage${dragMode === 'rotate' ? ' rotating' : ''}${drawerOpen ? ' drawer-open' : ''}`}
        onPointerDown={onStagePointerDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        {BACKDROP === 'welcome' && <div className="library-stars" aria-hidden="true" />}

        <p className="stage-hint">
          {active
            ? 'Drag to move · drag empty space to spin · double-click to flip · drop it in the deck to load'
            : 'Pick a tape from your library'}
        </p>

        <div className="stage-grid">
          <CassettePlayer
            loaded={loaded}
            side={side}
            slotRef={slotRef}
            dropHover={zone === 'player'}
            onControl={onControl}
            display={lcd}
          />
          <div ref={pedestalRef} className={`pedestal${active ? ' occupied' : ''}`}>
            <span className="pedestal-ring" />
          </div>
        </div>

        {/* The anchor never moves, so hit-testing works even while the pad is still sliding in. */}
        <div ref={editRef} className="edit-anchor">
          <div className={`edit-pad${held ? ' visible' : ''}${zone === 'edit' ? ' hover' : ''}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />
            </svg>
            <span>Drop on the workbench to customize</span>
          </div>
        </div>

        {active && (
          <>
            <div
              className={`floater-shadow${held ? ' lifted' : ''}`}
              style={{ left: pos.x, top: pos.y + height * 0.72, width: width * 0.9 }}
            />
            <div
              className={`floater${held ? ' held' : ''}`}
              style={{ left: pos.x, top: pos.y, width, height }}
              onPointerDown={onCassettePointerDown}
              onDoubleClick={flip}
            >
              <div className={`floater-bob${held ? '' : ' bobbing'}`}>
                <div className="floater-land" key={landKey}>
                  <div className="floater-tilt" style={{ transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}>
                    <Cassette3D cassette={active} width={width} rotateX={rot.x} rotateY={rot.y} animate={animateRot} />
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        <CassetteDrawer
          cassettes={cassettes}
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          activeId={activeId}
          loadedId={loadedId}
          onSelect={placeOnStage}
          onDragOut={(id, x, y) => beginMove(id, x, y)}
          onEdit={(id) => navigate(`/cassettes/${id}/edit`)}
          onCreate={create}
          dropHover={zone === 'drawer'}
          panelRef={drawerRef}
        />
      </div>
    </div>
  );
}
