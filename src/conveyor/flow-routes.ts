import { angleRad, arcPointLocal, centrelineRadiusM } from './curve-metrics'
import { lateralOuterZM, moduleLengthM as launcherLengthM, launchSign } from './launcher-metrics'
import { branchEndLocal, divergeXM, moduleLengthM as obliqueLengthM } from './oblique-metrics'
import type { ConveyorModule, ConveyorPortId } from './ports'
import {
  isCurveModule,
  isLauncherModule,
  isObliqueModule,
  isTransferModule,
  localPorts,
  moduleRunLengthM,
} from './ports'
import { dischargeSign, frameWidthM as transferWidthM } from './transfer-metrics'

/**
 * The path a box takes through a module, and the ports it enters and leaves by.
 *
 * A route is **the fourth thing derived from a shape**, alongside its parts, its
 * ports and its plan symbol — and it has to come from the same figures as the
 * other three or a box will travel somewhere the steel is not. A curve's route
 * is its centreline arc, a launcher's cross route ends where its arm ends, an
 * oblique's branch route leaves where `divergeXM` says it does.
 *
 * Points stay in the node's own plan frame. Carrying them into world space
 * here would mean re-deriving the module's place in the building — a level's
 * base height, the exploded-view offset, the lift a slab gives it — so the flow
 * system multiplies by the node's own registered world matrix instead. The y is
 * the transport height throughout: every shape in this kind runs level, and the
 * day an incline lands it will be the one thing that changes here.
 */

export type Route = {
  from: ConveyorPortId
  to: ConveyorPortId
  /** Plan points in the node's own frame, first at the entry port. */
  points: Array<[number, number]>
}

/** Enough segments that a bend reads as curved rather than as a chord chain at
 *  the speed a box crosses it. Sixteen over a quarter turn is under a
 *  centimetre of deviation at every radius the schema allows. */
const ARC_STEPS = 16

/**
 * Every path a box can take through this module.
 *
 * A two-ended shape has one; a junction has two, and which one a box takes is
 * the simulation's choice rather than the geometry's. Both are listed here in
 * the direction goods actually travel, so the simulation never has to reason
 * about `flow` again.
 */
export function routesOf(module: ConveyorModule): Route[] {
  const ports = localPorts(module)
  /**
   * **Every** end goods can arrive by, not the first one found.
   *
   * An oblique ordered as a merge has two: its main infeed and its branch. Built
   * from one inlet only, no route in the network started at the branch, so every
   * box a feeder line delivered there was dropped on arrival — silently, because
   * a box with nowhere to go simply stops being in the list. `'both'` counts as
   * an entry too: a bidirectional branch is one goods can come in by.
   */
  const inlets = ports.filter((port) => port.role === 'in' || port.role === 'both')
  const outlets = ports.filter((port) => port.role === 'out' || port.role === 'both')
  // A module whose ends are all outlets, or all inlets, carries nothing. That
  // is a real configuration — two discharges facing each other — and the joint
  // checker already reports it; here it simply has no route.
  if (inlets.length === 0 || outlets.length === 0) return []
  const inlet = ports.find((port) => port.role === 'in') ?? inlets[0]
  if (!inlet) return []

  if (isCurveModule(module)) {
    const sweep = angleRad(module)
    const radius = centrelineRadiusM(module)
    const points: Array<[number, number]> = Array.from({ length: ARC_STEPS + 1 }, (_, index) =>
      arcPointLocal(module, radius, (index / ARC_STEPS) * sweep),
    )
    // Traced from `a` to `b`; reversed when the flow runs the other way.
    return [{ from: inlet.id, to: inlet.id === 'a' ? 'b' : 'a', points: order(points, inlet.id) }]
  }

  if (isLauncherModule(module)) {
    const half = launcherLengthM(module) / 2
    const side = launchSign(module)
    const main: Array<[number, number]> = [
      [-half, 0],
      [half, 0],
    ]
    // The launch: straight along the bed to the middle, then out at a right
    // angle. Two segments and not a curve, because that is what the machine
    // does — the box is pushed sideways, not steered.
    const launch: Array<[number, number]> = [
      [inlet.id === 'a' ? -half : half, 0],
      [0, 0],
      [0, side * lateralOuterZM(module)],
    ]
    return [
      { from: inlet.id, to: inlet.id === 'a' ? 'b' : 'a', points: order(main, inlet.id) },
      { from: inlet.id, to: 'c', points: launch },
    ]
  }

  if (isTransferModule(module)) {
    const half = moduleRunLengthM(module) / 2
    const side = dischargeSign(module)
    const main: Array<[number, number]> = [
      [-half, 0],
      [half, 0],
    ]
    const cross: Array<[number, number]> = [
      [inlet.id === 'a' ? -half : half, 0],
      [0, 0],
      [0, (side * transferWidthM(module)) / 2],
    ]
    return [
      { from: inlet.id, to: inlet.id === 'a' ? 'b' : 'a', points: order(main, inlet.id) },
      { from: inlet.id, to: 'c', points: cross },
    ]
  }

  if (isObliqueModule(module)) {
    const half = obliqueLengthM(module) / 2
    const main: Array<[number, number]> = [
      [-half, 0],
      [half, 0],
    ]
    // The branch leaves where the geometry says it does, which is the whole
    // point of deriving that figure rather than placing it.
    const branch: Array<[number, number]> = [
      [inlet.id === 'a' ? -half : half, 0],
      [divergeXM(module), 0],
      branchEndLocal(module),
    ]
    const outlet: ConveyorPortId = inlet.id === 'a' ? 'b' : 'a'
    const routes: Route[] = [{ from: inlet.id, to: outlet, points: order(main, inlet.id) }]
    // Out by the branch, when the branch is one goods can leave by.
    if (module.branchMode !== 'merge') routes.push({ from: inlet.id, to: 'c', points: branch })
    // **And in by it**, when it is one goods can arrive by. Without this the
    // branch is an end boxes reach and vanish at, which is the whole of what a
    // merge is for.
    if (module.branchMode !== 'divert') {
      routes.push({ from: 'c', to: outlet, points: [...branch].reverse() })
    }
    return routes
  }

  // Straights and boosters: one line, end to end.
  const half = moduleRunLengthM(module) / 2
  const line: Array<[number, number]> = [
    [-half, 0],
    [half, 0],
  ]
  return [{ from: inlet.id, to: inlet.id === 'a' ? 'b' : 'a', points: order(line, inlet.id) }]
}

/** Traced from the `a` end; reversed when goods enter by `b` instead. */
function order(points: Array<[number, number]>, from: ConveyorPortId): Array<[number, number]> {
  return from === 'a' ? points : [...points].reverse()
}

/** Total length of a route, which is what a box's progress is measured against. */
export function routeLengthM(route: Route): number {
  let total = 0
  for (let index = 1; index < route.points.length; index++) {
    const [ax, az] = route.points[index - 1] ?? [0, 0]
    const [bx, bz] = route.points[index] ?? [0, 0]
    total += Math.hypot(bx - ax, bz - az)
  }
  return total
}

/**
 * A point and a heading at a distance along a route, in the node's own frame.
 *
 * The heading is what turns the box: a curve's route bends, so a box crossing
 * one really does come out facing ninety degrees from how it went in — which is
 * exactly what the catalogue says a curve does and a transfer does not. The
 * simulation gets that for free by following the route rather than by carrying
 * an orientation flag.
 */
export function sampleRoute(
  route: Route,
  distance: number,
): { x: number; z: number; heading: number } {
  const points = route.points
  let travelled = 0

  for (let index = 1; index < points.length; index++) {
    const [ax, az] = points[index - 1] ?? [0, 0]
    const [bx, bz] = points[index] ?? [0, 0]
    const segment = Math.hypot(bx - ax, bz - az)
    if (segment <= 0) continue

    if (travelled + segment >= distance || index === points.length - 1) {
      const t = Math.max(0, Math.min(1, (distance - travelled) / segment))
      return {
        x: ax + (bx - ax) * t,
        z: az + (bz - az) * t,
        // Local +X carries onto world (cos, −sin), so a heading measured this
        // way turns the box the same way the module's own rotation does.
        heading: Math.atan2(-(bz - az), bx - ax),
      }
    }
    travelled += segment
  }

  const [x, z] = points[points.length - 1] ?? [0, 0]
  return { x, z, heading: 0 }
}
