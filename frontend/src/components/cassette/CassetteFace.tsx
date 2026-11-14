// Flat (2D) front of a cassette. Used on the 3D body, inside the player window, and in the editor.
// Everything inside is sized in `em`, and the root font-size is width/100, so it scales to any width.

import type { Cassette, Sticker, TapeSide } from '@runman/shared';
import { fitNameSize, penFont } from './constants';
import { findCustomSticker } from './customStickers';
import { StickerIcon } from './StickerIcon';
import './cassette.css';

export type CassetteLook = Pick<
  Cassette,
  'name' | 'shellColor' | 'labelColor' | 'inkColor' | 'shellType' | 'penStyle' | 'stickers' | 'customStickers'
>;

export interface CassetteFaceProps {
  cassette: CassetteLook;
  /** Pixels, or any CSS length (e.g. '86cqw' to fill a container-query container). */
  width: number | string;
  side?: TapeSide;
  spinning?: boolean;
  showStickers?: boolean;
  /** Editor hooks for sticker interaction. */
  selectedStickerId?: string | null;
  onStickerPointerDown?: (e: React.PointerEvent, sticker: Sticker) => void;
  faceRef?: React.Ref<HTMLDivElement>;
  className?: string;
}

export function CassetteFace({
  cassette,
  width,
  side = 'A',
  spinning = false,
  showStickers = true,
  selectedStickerId,
  onStickerPointerDown,
  faceRef,
  className = '',
}: CassetteFaceProps) {
  const style = {
    fontSize: typeof width === 'number' ? `${width / 100}px` : `calc(${width} / 100)`,
    '--shell': cassette.shellColor,
    '--label': cassette.labelColor,
    '--ink': cassette.inkColor,
    '--pen': penFont(cassette.penStyle),
  } as React.CSSProperties;

  return (
    <div
      ref={faceRef}
      className={`cf cf-${cassette.shellType} ${spinning ? 'cf-spinning' : ''} ${className}`}
      style={style}
    >
      <span className="cf-screw" style={{ left: '2.2em', top: '2.2em' }} />
      <span className="cf-screw" style={{ right: '2.2em', top: '2.2em' }} />
      <span className="cf-screw" style={{ left: '2.2em', bottom: '2.2em' }} />
      <span className="cf-screw" style={{ right: '2.2em', bottom: '2.2em' }} />

      <div className="cf-label">
        <div className="cf-label-band">
          <span>HI-FI STEREO</span>
          <span className="cf-side">
            <small>SIDE</small>
            <b>{side}</b>
          </span>
        </div>
        <div className="cf-name" style={{ fontSize: `${fitNameSize(cassette.name, cassette.penStyle)}em` }}>
          <span>{cassette.name || ' '}</span>
        </div>
        <div className="cf-rule" />
        <div className="cf-window">
          <span className="cf-reel" />
          <span className="cf-tape" />
          <span className="cf-reel" />
        </div>
      </div>

      <div className="cf-bridge">
        <span />
        <span />
        <span />
        <span />
      </div>

      {showStickers && (
        <div className="cf-stickers">
          {cassette.stickers.map((s) => (
            <div
              key={s.id}
              className={`cf-sticker${onStickerPointerDown ? ' cf-sticker-edit' : ''}${
                selectedStickerId === s.id ? ' selected' : ''
              }`}
              style={{
                left: `${s.x}%`,
                top: `${s.y}%`,
                transform: `translate(-50%, -50%) rotate(${s.rotation}deg) scale(${s.scale})`,
              }}
              onPointerDown={onStickerPointerDown ? (e) => onStickerPointerDown(e, s) : undefined}
            >
              <StickerIcon kind={s.kind} color={s.color} art={findCustomSticker(cassette.customStickers, s.kind)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
