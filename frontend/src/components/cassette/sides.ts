// Side A / side B helpers. Side A's look lives on the cassette's top-level fields;
// side B overrides live in `cassette.sideB` (see the Cassette type in @runman/shared).

import type { Cassette, SideLook, TapeSide } from '@runman/shared';
import type { CassetteLook } from './CassetteFace';

export type SidedCassette = CassetteLook & { sideB?: Partial<SideLook> };

export function sideLook(c: SidedCassette, side: TapeSide): SideLook {
  const a: SideLook = { labelColor: c.labelColor, inkColor: c.inkColor, penStyle: c.penStyle, stickers: c.stickers };
  if (side === 'A') return a;
  return {
    labelColor: c.sideB?.labelColor ?? a.labelColor,
    inkColor: c.sideB?.inkColor ?? a.inkColor,
    penStyle: c.sideB?.penStyle ?? a.penStyle,
    stickers: c.sideB?.stickers ?? [],
  };
}

/** The flat look to render for one side of the tape. */
export function faceFor(c: SidedCassette, side: TapeSide): CassetteLook {
  return { ...c, ...sideLook(c, side) };
}

/** Store patch that changes one side's look. */
export function patchSide(c: Cassette, side: TapeSide, patch: Partial<SideLook>): Partial<Cassette> {
  return side === 'A' ? patch : { sideB: { ...c.sideB, ...patch } };
}

/** True when side B has its own label colour / ink / pen instead of copying side A. */
export function sideBHasOwnStyle(c: SidedCassette): boolean {
  return Boolean(c.sideB && (c.sideB.labelColor || c.sideB.inkColor || c.sideB.penStyle));
}
