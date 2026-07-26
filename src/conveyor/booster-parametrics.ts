import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import {
  carriesCatalogueBox,
  carriesShortestBox,
  moduleLengthM,
  rollerPitchM,
  rollerPitchMm,
  rollersUnderShortestBox,
  speedMPerMin,
  withinCatalogueLength,
} from './booster-metrics'
import type { ConveyorBoosterNode } from './booster-schema'
import { BST, SPEEDS_M_PER_MIN, STANDARD_TRANSPORT_HEIGHTS_M } from './catalog'
import { MIN_ROLLERS_UNDER_A_BOX, ROLLER_PITCHES_MM } from './constants'

/**
 * Auto-derived inspector fields, for the reason the straight's descriptor
 * gives: a `customPanel` short-circuits `groups`, `actions` *and*
 * `trailingSection`, so taking it means owning the Move/Duplicate/Delete
 * buttons too.
 *
 * The invariant worth reading first is the length one. `rollers` has bounds wide
 * enough to cover the catalogue range at *every* pitch, which means a count
 * inside the bounds can still land outside the range — seven at 100 mm is a
 * 700 mm booster, seven at 50 mm is a 350 mm nothing. The field cannot express
 * that and the product can, so the check lives here rather than in the schema.
 */
export const conveyorBoosterParametrics: ParametricDescriptor<ConveyorBoosterNode> = {
  groups: [
    {
      label: 'Bed',
      fields: [
        {
          key: 'usefulWidth',
          kind: 'enum',
          options: ['400', '600'],
          display: 'select',
        },
        { key: 'rollers', kind: 'number', min: 7, max: 21, step: 1 },
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
      label: 'Guides',
      fields: [
        {
          key: 'sideGuide',
          kind: 'enum',
          options: ['none', 'left', 'right', 'both'],
          display: 'select',
        },
        {
          key: 'sideGuideHeight',
          kind: 'number',
          unit: 'm',
          min: 0.035,
          max: 0.12,
          step: 0.005,
          // A height for a rail that is not fitted moves nothing.
          visibleIf: (node) => node.sideGuide !== 'none',
        },
      ],
    },
    {
      label: 'Finish',
      fields: [
        { key: 'frameColor', kind: 'color' },
        { key: 'rollerColor', kind: 'color' },
        { key: 'profileColor', kind: 'color' },
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

  trailingSection: () => import('./booster-panel'),

  invariants: [
    (node): Issue[] => {
      const issues: Issue[] = []
      const length = moduleLengthM(node)

      // The one the bounds on `rollers` cannot express: the range is a length,
      // and the length is the count times a pitch the user also chooses.
      if (!withinCatalogueLength(node)) {
        issues.push({
          field: 'rollers',
          severity: 'warning',
          msg: `${(length * 1000).toFixed(0)} mm is outside the ${(BST.lengthRangeM[0] * 1000).toFixed(0)}–${(BST.lengthRangeM[1] * 1000).toFixed(0)} mm this type is built in. ${length < BST.lengthRangeM[0] ? 'Add rollers or coarsen the pitch' : 'Drop rollers, or use a straight section'}.`,
        })
      }

      // R11 — a box must always sit on at least three rollers. Fewer and it
      // drops between them, which is the failure a drawing cannot show.
      if (!carriesShortestBox(node)) {
        issues.push({
          field: 'rollerPitch',
          severity: 'warning',
          msg: `A ${(node.shortestBox * 1000).toFixed(0)} mm box sits on ${rollersUnderShortestBox(node)} rollers at ${rollerPitchMm(node)} mm pitch; the catalogue asks for ${MIN_ROLLERS_UNDER_A_BOX}. Drop the pitch or raise the shortest box.`,
        })
      }

      if (!carriesCatalogueBox(node)) {
        issues.push({
          field: 'shortestBox',
          severity: 'warning',
          msg: `This type carries boxes from ${(BST.boxLengthRangeM[0] * 1000).toFixed(0)} to ${(BST.boxLengthRangeM[1] * 1000).toFixed(0)} mm.`,
        })
      }

      // The transport height is the datum every neighbouring machine is
      // dimensioned to, and joints need it to match exactly.
      const standard = STANDARD_TRANSPORT_HEIGHTS_M.some(
        (height) => Math.abs(height - node.transportHeight) < 1e-6,
      )
      if (!standard) {
        issues.push({
          field: 'transportHeight',
          severity: 'warning',
          msg: `${(node.transportHeight * 1000).toFixed(0)} mm is not a catalogue standard (${STANDARD_TRANSPORT_HEIGHTS_M.map((h) => (h * 1000).toFixed(0)).join(' / ')} mm). Anything it joins must match it exactly.`,
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

      // The drawn rollers and the numbers must agree. Cheap to assert, and it
      // catches a future edit that decouples the two.
      if (Math.abs(rollerPitchM(node) * node.rollers - length) > 1e-9) {
        issues.push({
          field: 'rollers',
          severity: 'error',
          msg: 'Bed length and roller count disagree — the drawn rollers are not where the numbers say.',
        })
      }

      return issues
    },
  ],
}
