import { BaseNode, nodeType } from '@pascal-app/core'
import { z } from 'zod'
import { migratedObjectId } from '../ids'

/**
 * An oblique box transfer — **one module**, and the piece a dense line branches
 * at without stopping.
 *
 * Catalogue: Mecalux "Conveyor Systems for Boxes" (MK-00200042-09/22), type
 * CNV-OBQ. The main line runs through a fixed 1500 mm body; a narrower lane
 * leaves it at an angle, taken by short angled rollers in the merge triangle.
 * Used for entry and exit branches and for inducting boxes onto a high-speed
 * line.
 *
 * **The branch is a narrower class than the main line** — 467 mm outside
 * against 667 — and that is the catalogue's geometry rather than a compromise.
 * It is also the shape that forced a port in this package to carry its own lane:
 * read off the node, this machine would report its own branch as a width
 * mismatch against itself, and every oblique ever placed would be yellow.
 *
 * **It does not change a box's orientation.** A curve preserves it and so does
 * this; what a branch changes is which line the box is on, not how it faces.
 * That is the difference from the launcher and the mixed transfer, and it means
 * the next section's box-length limits still follow from the last one's.
 *
 * Every dimension is metres; the branch angle is degrees, because that is how a
 * branch is ordered.
 */
export const ConveyorObliqueNode = BaseNode.extend({
  id: migratedObjectId('conveyor-oblique', 'conveyor_oblique'),
  type: nodeType('warehouse:conveyor-oblique'),

  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  // ── The branch ────────────────────────────────────────────────────────────

  /**
   * How far the branch leaves the main line by.
   *
   * **Not a catalogue figure.** Mecalux does not publish it; 30 and 45 are read
   * off the renders (assumption A6) and both are built. It is the field that
   * decides how much floor the branch takes: a shallower branch runs further
   * before it clears the main frame, which is exactly the trade a dense
   * installation makes.
   */
  angle: z.enum(['30', '45']).default('30'),

  /** Which side the branch leaves by, seen from above as goods travel the main
   *  line. A mirror rather than a rotation: turning the module round would also
   *  swap which end is the infeed. */
  branchSide: z.enum(['left', 'right']).default('left'),

  /**
   * What the branch is for.
   *
   * The catalogue ships this port bidirectional — the same machine is ordered as
   * a divert or as a merge and installed either way round — so `both` is the
   * default and the two narrower settings exist because a *drawing* usually
   * knows which one it is. The port's role follows this, which is what stops the
   * magnet mating a divert onto another divert.
   */
  branchMode: z.enum(['divert', 'merge', 'both']).default('both'),

  // ── The bed ───────────────────────────────────────────────────────────────

  /** Roller pitch on both beds. */
  rollerPitch: z.enum(['50', '75', '100']).default('75'),

  /** Top of roller: the datum every drawing and neighbouring machine uses. */
  transportHeight: z.number().min(0.37).max(3).default(0.75),

  // ── Drive ─────────────────────────────────────────────────────────────────

  speed: z.enum(['25', '45', '60']).default('45'),

  /** Which way boxes travel along the main line, in the module's own local +X. */
  flow: z.enum(['forward', 'reverse']).default('forward'),

  // ── Load ──────────────────────────────────────────────────────────────────

  /** The shortest box this branch is expected to carry. */
  shortestBox: z.number().min(0.15).max(0.8).default(0.3),

  // ── Finish ────────────────────────────────────────────────────────────────

  frameColor: z.string().default('#1e56a0'),
  rollerColor: z.string().default('#c9ced3'),
  /** The angled rollers in the merge triangle — the part that does the diverting
   *  and the part a fitter recognises the machine by. */
  diverterColor: z.string().default('#e87722'),

  supportSlabId: z.string().nullable().default(null),
})

export type ConveyorObliqueNode = z.infer<typeof ConveyorObliqueNode>
