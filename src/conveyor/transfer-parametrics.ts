import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { millimetreLabel, unitNow } from '../units'
import { MTR, SPEEDS_M_PER_MIN, STANDARD_TRANSPORT_HEIGHTS_M } from './catalog'
import { MIN_ROLLERS_UNDER_A_BOX } from './constants'
import {
  carriesCatalogueBox,
  carriesShortestBox,
  rollersUnderShortestBox,
  speedMPerMin,
  widestRollerGapM,
} from './transfer-metrics'
import type { ConveyorTransferNode } from './transfer-schema'

/**
 * Auto-derived inspector fields, for the reason every other descriptor here
 * gives: a `customPanel` short-circuits `groups`, `actions` *and*
 * `trailingSection`, so taking it means owning the Move/Duplicate/Delete
 * buttons too.
 *
 * The panel is short because the machine is: a transfer's body, lane and pitch
 * are all fixed by the type, so what is left to choose is which way it turns the
 * box, how far the strips carry it, and the height it works at.
 */
export const conveyorTransferParametrics: ParametricDescriptor<ConveyorTransferNode> = {
  groups: [
    {
      label: 'Transfer',
      fields: [
        { key: 'dischargeSide', kind: 'enum', options: ['left', 'right'], display: 'select' },
        {
          key: 'travel',
          kind: 'enum',
          options: ['symmetric', 'asymmetric'],
          display: 'select',
        },
        { key: 'flow', kind: 'enum', options: ['forward', 'reverse'], display: 'select' },
      ],
    },
    {
      label: 'Bed',
      fields: [
        {
          key: 'transportHeight',
          kind: 'number',
          unit: 'm',
          // The floor is 500 here, not the family's 370: the lift mechanism
          // lives under the bed.
          min: 0.5,
          max: 3,
          step: 0.01,
        },
        { key: 'speed', kind: 'enum', options: ['25', '45'], display: 'select' },
      ],
    },
    {
      label: 'Load',
      fields: [
        {
          key: 'shortestBox',
          kind: 'number',
          unit: 'm',
          min: 0.25,
          max: 0.6,
          step: 0.05,
        },
      ],
    },
    {
      label: 'Finish',
      fields: [
        { key: 'frameColor', kind: 'color' },
        { key: 'rollerColor', kind: 'color' },
        { key: 'stripColor', kind: 'color' },
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

  trailingSection: () => import('./transfer-panel'),

  invariants: [
    (node): Issue[] => {
      const issues: Issue[] = []
      const unit = unitNow()

      // R11 against the **widest** gap, which has to be measured rather than
      // assumed on this shape: the rollers sit in the gaps the strips leave, so
      // their spacing is not uniform and the binding case is the largest one.
      if (!carriesShortestBox(node)) {
        issues.push({
          field: 'shortestBox',
          severity: 'warning',
          msg: `A ${millimetreLabel(node.shortestBox, unit)} box spans ${rollersUnderShortestBox(node)} rollers across the widest ${millimetreLabel(widestRollerGapM(node), unit)} gap; the catalogue asks for ${MIN_ROLLERS_UNDER_A_BOX}. The strips set that spacing, so the box is what has to change.`,
        })
      }

      if (!carriesCatalogueBox(node)) {
        issues.push({
          field: 'shortestBox',
          severity: 'warning',
          msg: `This type handles boxes from ${(MTR.boxLengthRollerDirRangeM[0] * 1000).toFixed(0)} to ${(MTR.boxLengthRollerDirRangeM[1] * 1000).toFixed(0)} mm along the roller direction.`,
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

      // Two speeds on this type where the family has three. A value from
      // elsewhere means a scene edited by hand or by MCP.
      if (!(MTR.speedsMPerMin as readonly number[]).includes(speedMPerMin(node))) {
        issues.push({
          field: 'speed',
          severity: 'warning',
          msg: `${speedMPerMin(node)} m/min is not one of this type's speeds (${MTR.speedsMPerMin.join(' / ')}). The family reaches ${Math.max(...SPEEDS_M_PER_MIN)}, but a transfer lifts and sets down rather than carrying past.`,
        })
      }

      return issues
    },
  ],
}
