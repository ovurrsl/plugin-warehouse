import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { CAR, SPEEDS_M_PER_MIN, STANDARD_TRANSPORT_HEIGHTS_M } from './catalog'
import { MIN_ROLLERS_UNDER_A_BOX, ROLLER_PITCHES_MM } from './constants'
import {
  carriesShortestBox,
  isCatalogueSpeed,
  moduleLengthM,
  rollerPitchM,
  rollersUnderShortestBox,
  withinCatalogueLength,
} from './metrics'
import type { ConveyorRollerNode } from './schema'

/**
 * Auto-derived inspector fields, for the reason the rack's descriptor gives: a
 * `customPanel` short-circuits `groups`, `actions` *and* `trailingSection`, so
 * taking it means owning the Move/Duplicate/Delete buttons too.
 *
 * The invariants are where most of this file's value is, and they are the
 * catalogue's own circuit rules rather than opinions. A conveyor described by a
 * plausible set of numbers can be one nobody would ship, and every one of those
 * failures is quiet: a pitch too coarse for the boxes drops them between the
 * rollers, a length outside the range is simply not a thing the supplier cuts.
 *
 * `invariants` has no consumer in the host — it is declared in the registry's
 * types and read by nothing — so the trailing section renders them itself.
 */
export const conveyorRollerParametrics: ParametricDescriptor<ConveyorRollerNode> = {
  groups: [
    {
      label: 'Bed',
      fields: [
        {
          key: 'usefulWidth',
          kind: 'enum',
          // The catalogue's classes for this type. It is what two conveyors
          // must agree on to be joined, so it is a class rather than a length.
          options: ['400', '600'],
          display: 'select',
        },
        {
          key: 'rollers',
          kind: 'number',
          min: 27,
          max: 200,
          step: 1,
          // Length is this times the pitch and is never stored. The trailing
          // section offers the metres and converts.
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
        { key: 'hasDrive', kind: 'boolean' },
        {
          key: 'inclination',
          kind: 'number',
          unit: '°',
          min: -6,
          max: 6,
          step: 0.5,
        },
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

  trailingSection: () => import('./conveyor-panel'),

  invariants: [
    (node): Issue[] => {
      const issues: Issue[] = []
      const length = moduleLengthM(node)

      // R11 — the catalogue's rule is that a box always sits on at least three
      // rollers. Fewer and it drops between them, which is the failure a
      // drawing cannot show and a simulation would only find at run time.
      if (!carriesShortestBox(node)) {
        issues.push({
          field: 'rollerPitch',
          severity: 'warning',
          msg: `A ${(node.shortestBox * 1000).toFixed(0)} mm box sits on ${rollersUnderShortestBox(node)} rollers at ${node.rollerPitch} mm pitch; the catalogue asks for ${MIN_ROLLERS_UNDER_A_BOX}. Drop the pitch or raise the shortest box.`,
        })
      }

      // The catalogue ships this type between 2.025 m and 15 m. Outside that it
      // is not a module, it is two modules or none.
      if (!withinCatalogueLength(node)) {
        issues.push({
          field: 'rollers',
          severity: 'warning',
          msg: `${length.toFixed(3)} m is outside the ${CAR.lengthRangeM[0].toFixed(3)}–${CAR.lengthRangeM[1].toFixed(0)} m this type is built in. ${length < CAR.lengthRangeM[0] ? 'Add rollers' : 'Split it into two modules'}.`,
        })
      }

      // R3 — a continuously activated roller conveyor takes a slight fall and
      // no more; past that the catalogue moves you to a belt.
      if (Math.abs(node.inclination) > CAR.maxInclinationDeg) {
        issues.push({
          field: 'inclination',
          severity: 'warning',
          msg: `${node.inclination}° exceeds the ${CAR.maxInclinationDeg}° this type allows. A steeper run needs an inclined belt.`,
        })
      }

      // R6 — the three speeds are what the type is ordered at. A value from
      // elsewhere means a scene edited by hand or by MCP.
      if (!isCatalogueSpeed(node)) {
        issues.push({
          field: 'speed',
          severity: 'warning',
          msg: `${node.speed} m/min is not one of the catalogue speeds (${SPEEDS_M_PER_MIN.join(' / ')}).`,
        })
      }

      // A driven line has one motor. A module that is part of a run and also
      // claims the drive is a second motor on the same line — worth naming, and
      // properly checkable once the line index lands.
      if (node.hasDrive && node.rollerPitch > 0 && length < 1) {
        issues.push({
          field: 'hasDrive',
          severity: 'warning',
          msg: 'A module this short carrying the line drive is unusual; the motor block is nearly as long as the bed.',
        })
      }

      // The transport height is the datum every neighbouring machine is
      // dimensioned to, and joints need it to match exactly. Standing off the
      // two catalogue standards is legitimate — the supports adjust — but it is
      // worth saying, because it is the field that silently stops a line
      // joining.
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

      // Pitch is stored in millimetres so a joint is an equality; a value from
      // outside the set means the geometry cache is being split on a shape no
      // supplier ships.
      if (!(ROLLER_PITCHES_MM as readonly number[]).includes(node.rollerPitch)) {
        issues.push({
          field: 'rollerPitch',
          severity: 'warning',
          msg: `${node.rollerPitch} mm is not one of the pitches this model builds (${ROLLER_PITCHES_MM.join(' / ')} mm).`,
        })
      }

      // A bed whose rollers are further apart than the pitch the geometry paints
      // would be a mesh that disagrees with the numbers. Cheap to assert, and
      // it catches a future edit that decouples the two.
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
