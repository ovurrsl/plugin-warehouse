import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { lengthLabel, millimetreLabel, unitNow } from '../units'
import { SPEEDS_M_PER_MIN, STANDARD_TRANSPORT_HEIGHTS_M } from './catalog'
import { MIN_ROLLERS_UNDER_A_BOX, ROLLER_PITCHES_MM } from './constants'
import {
  angleDeg,
  boxClearsTheBend,
  carriesShortestBox,
  centrelineLengthM,
  laneWidthM,
  longestBoxThroughBendM,
  rollerCount,
  rollerPitchMm,
  rollersUnderShortestBox,
  speedMPerMin,
  zoneCount,
} from './curve-metrics'
import type { ConveyorCurveNode } from './curve-schema'

/**
 * Auto-derived inspector fields, for the reason the straight's descriptor
 * gives: a `customPanel` short-circuits `groups`, `actions` *and*
 * `trailingSection`, so taking it means owning the Move/Duplicate/Delete
 * buttons too.
 *
 * The invariants are where most of this file's value is, and a bend brings two
 * the straight cannot have. **A curve has a maximum box length**, set by the
 * radius rather than by the drive, and no amount of power fixes a carton that
 * jams against the outer kerb. And a bend throws a box outward, so the *outer*
 * guide is the one that does the work — a bend fitted with only the inner rail
 * is a bend boxes leave sideways.
 *
 * `invariants` has no consumer in the host — it is declared in the registry's
 * types and read by nothing — so the trailing section renders them itself.
 */
export const conveyorCurveParametrics: ParametricDescriptor<ConveyorCurveNode> = {
  groups: [
    {
      label: 'Arc',
      fields: [
        { key: 'angle', kind: 'enum', options: ['45', '90', '180'], display: 'select' },
        {
          key: 'innerRadius',
          kind: 'number',
          unit: 'm',
          min: 0.4,
          max: 2.5,
          step: 0.05,
        },
        { key: 'handed', kind: 'enum', options: ['left', 'right'], display: 'select' },
      ],
    },
    {
      label: 'Bed',
      fields: [
        {
          key: 'usefulWidth',
          kind: 'enum',
          // The curve family stops at 600 where the accumulator reaches 800.
          options: ['400', '600'],
          display: 'select',
        },
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
        { key: 'zones', kind: 'enum', options: ['0', '1', '2'], display: 'select' },
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
          options: ['none', 'inner', 'outer', 'both'],
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

  trailingSection: () => import('./curve-panel'),

  invariants: [
    (node): Issue[] => {
      const issues: Issue[] = []
      const unit = unitNow()
      const lane = laneWidthM(node)

      // The one a straight cannot have. A rigid box's outer corners swing wider
      // than its centre by an amount growing with the square of its length, so
      // a bend has a maximum box length set by the radius — and a carton that
      // jams against the outer kerb stops the line, it does not squeeze through.
      const longest = longestBoxThroughBendM(node)
      if (!boxClearsTheBend(node, lane)) {
        issues.push({
          field: 'innerRadius',
          severity: 'warning',
          msg: `A full-width ${(lane * 1000).toFixed(0)} mm box gets round only up to ${millimetreLabel(longest, unit)} long. Widen the radius or accept shorter cartons.`,
        })
      }

      // R11 — read at the outer radius, where the pitch is widest and the fewest
      // rollers sit under a box. That is also the edge a bend throws it towards.
      if (!carriesShortestBox(node)) {
        issues.push({
          field: 'rollerPitch',
          severity: 'warning',
          msg: `A ${millimetreLabel(node.shortestBox, unit)} box sits on ${rollersUnderShortestBox(node)} rollers at the outer radius; the catalogue asks for ${MIN_ROLLERS_UNDER_A_BOX}. Drop the pitch or widen the bend.`,
        })
      }

      // A bend throws a box outward — that is what a curve does to a load — so
      // the outer rail is the one turning it. The inner rail alone is a bend
      // boxes leave sideways.
      if (node.sideGuide === 'none' || node.sideGuide === 'inner') {
        issues.push({
          field: 'sideGuide',
          severity: 'warning',
          msg: 'No outer guide. A box on a bend travels outward, and the outer rail is what turns it — the inner one carries almost nothing.',
        })
      }

      // A zone has to be long enough to hold a box in. Two zones on a 45° bend
      // is two zones shorter than the cartons they accumulate.
      const zones = zoneCount(node)
      if (zones > 0) {
        const perZone = centrelineLengthM(node) / zones
        if (perZone < node.shortestBox * 2) {
          issues.push({
            field: 'zones',
            severity: 'warning',
            msg: `${zones} zone${zones > 1 ? 's' : ''} over ${lengthLabel(centrelineLengthM(node), unit)} leaves ${millimetreLabel(perZone, unit)} each — less than two of the ${millimetreLabel(node.shortestBox, unit)} boxes this line carries. A zone needs length to accumulate in.`,
          })
        }
      }

      // The transport height is the datum every neighbouring machine is
      // dimensioned to, and joints need it to match exactly. Standing off the
      // two catalogue standards is legitimate — the supports adjust — but it is
      // the field that silently stops a line joining.
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

      // R6 — the three speeds are what the type is ordered at. A value from
      // elsewhere means a scene edited by hand or by MCP.
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

      // The rollers must reach both ends of the arc. Cheap to assert, and it
      // catches a future edit that decouples the count from the step.
      if (rollerCount(node) < 2) {
        issues.push({
          field: 'angle',
          severity: 'error',
          msg: `A ${angleDeg(node)}° bend at this pitch resolves to fewer than two rollers — there is no bed to carry a box on.`,
        })
      }

      return issues
    },
  ],
}
