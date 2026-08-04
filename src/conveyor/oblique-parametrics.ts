import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { millimetreLabel, unitNow } from '../units'
import { OBQ, SPEEDS_M_PER_MIN, STANDARD_TRANSPORT_HEIGHTS_M } from './catalog'
import { MIN_ROLLERS_UNDER_A_BOX, OBLIQUE_BRANCH_ANGLES_DEG, ROLLER_PITCHES_MM } from './constants'
import {
  branchBoxWidthM,
  carriesShortestBox,
  divergeXM,
  moduleLengthM,
  rollerPitchMm,
  rollersUnderShortestBox,
  speedMPerMin,
} from './oblique-metrics'
import type { ConveyorObliqueNode } from './oblique-schema'

/**
 * Auto-derived inspector fields, for the reason every other descriptor here
 * gives: a `customPanel` short-circuits `groups`, `actions` *and*
 * `trailingSection`, so taking it means owning the Move/Duplicate/Delete
 * buttons too.
 *
 * The invariant that only this shape can have is the divergence one. A 1500 mm
 * body and a shallow angle are not independent: at some angle the branch would
 * have to start before the module does to clear the main frame by the end, and
 * the geometry says so rather than quietly drawing a branch that overlaps the
 * line it just left.
 */
export const conveyorObliqueParametrics: ParametricDescriptor<ConveyorObliqueNode> = {
  groups: [
    {
      label: 'Branch',
      fields: [
        {
          key: 'angle',
          kind: 'enum',
          options: [...OBLIQUE_BRANCH_ANGLES_DEG],
          display: 'select',
        },
        { key: 'branchSide', kind: 'enum', options: ['left', 'right'], display: 'select' },
        {
          key: 'branchMode',
          kind: 'enum',
          options: ['divert', 'merge', 'both'],
          display: 'select',
        },
      ],
    },
    {
      label: 'Bed',
      fields: [
        {
          key: 'rollerPitch',
          kind: 'enum',
          options: ROLLER_PITCHES_MM.map(String),
          display: 'select',
        },
        {
          key: 'transportHeight',
          kind: 'number',
          unit: 'm',
          min: 0.37,
          max: 3,
          step: 0.01,
        },
      ],
    },
    {
      label: 'Drive',
      fields: [
        { key: 'speed', kind: 'enum', options: SPEEDS_M_PER_MIN.map(String), display: 'select' },
        { key: 'flow', kind: 'enum', options: ['forward', 'reverse'], display: 'select' },
      ],
    },
    {
      label: 'Load',
      fields: [
        {
          key: 'shortestBox',
          kind: 'number',
          unit: 'm',
          min: 0.15,
          max: 0.8,
          step: 0.05,
        },
      ],
    },
    {
      label: 'Finish',
      fields: [
        { key: 'frameColor', kind: 'color' },
        { key: 'rollerColor', kind: 'color' },
        { key: 'diverterColor', kind: 'color' },
      ],
    },
    {
      label: 'Placement',
      fields: [
        { key: 'position', kind: 'vec3' },
        { key: 'rotation', kind: 'vec3' },
      ],
    },
  ],

  trailingSection: () => import('./oblique-panel'),

  invariants: [
    (node): Issue[] => {
      const issues: Issue[] = []
      const unit = unitNow()

      // The one only this shape can have: a shallow branch has to start further
      // back to clear the main frame by the module's end, and the body is fixed.
      const diverge = divergeXM(node)
      const half = moduleLengthM(node) / 2
      if (diverge < -half) {
        issues.push({
          field: 'angle',
          severity: 'warning',
          msg: `At ${node.angle}° the branch would have to leave ${millimetreLabel(-diverge - half, unit)} before this ${millimetreLabel(moduleLengthM(node), unit)} body starts to clear the main frame by its end. Steepen the branch.`,
        })
      }

      // R11 — a box must always sit on at least three rollers.
      if (!carriesShortestBox(node)) {
        issues.push({
          field: 'rollerPitch',
          severity: 'warning',
          msg: `A ${millimetreLabel(node.shortestBox, unit)} box sits on ${rollersUnderShortestBox(node)} rollers at ${rollerPitchMm(node)} mm pitch; the catalogue asks for ${MIN_ROLLERS_UNDER_A_BOX}. Drop the pitch or raise the shortest box.`,
        })
      }

      // R11 again, in the form this machine is the cause of: the branch is a
      // narrower class than the main line, so a box that crosses the whole
      // module has to fit the branch, not the line it arrived on.
      if (node.shortestBox > branchBoxWidthM(node)) {
        issues.push({
          field: 'shortestBox',
          severity: 'warning',
          msg: `The branch is a ${(branchBoxWidthM(node) * 1000).toFixed(0)} mm lane against the main line's ${((OBQ.mainExteriorWidthM - 0.067) * 1000).toFixed(0)} mm — a box that has to take the branch cannot be wider than the narrower of the two.`,
        })
      }

      const standard = STANDARD_TRANSPORT_HEIGHTS_M.some(
        (height) => Math.abs(height - node.transportHeight) < 1e-6,
      )
      if (!standard) {
        issues.push({
          field: 'transportHeight',
          severity: 'warning',
          msg: `${millimetreLabel(node.transportHeight, unit)} is not a catalogue standard (${STANDARD_TRANSPORT_HEIGHTS_M.map((h) => (h * 1000).toFixed(0)).join(' / ')} mm). Anything it joins must match it exactly.`,
        })
      }

      if (!(SPEEDS_M_PER_MIN as readonly number[]).includes(speedMPerMin(node))) {
        issues.push({
          field: 'speed',
          severity: 'warning',
          msg: `${speedMPerMin(node)} m/min is not one of the catalogue speeds (${SPEEDS_M_PER_MIN.join(' / ')}).`,
        })
      }

      if (!(ROLLER_PITCHES_MM as readonly number[]).includes(rollerPitchMm(node))) {
        issues.push({
          field: 'rollerPitch',
          severity: 'warning',
          msg: `${rollerPitchMm(node)} mm is not one of the pitches this model builds (${ROLLER_PITCHES_MM.join(' / ')} mm).`,
        })
      }

      return issues
    },
  ],
}
