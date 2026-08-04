import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { millimetreLabel, unitNow } from '../units'
import { LNC, STANDARD_TRANSPORT_HEIGHTS_M } from './catalog'
import { ROLLER_PITCHES_MM } from './constants'
import { rollerPitchMm, usefulWidthMm } from './launcher-metrics'
import type { ConveyorLauncherNode } from './launcher-schema'

/**
 * Auto-derived inspector fields, for the reason the straight's descriptor gives:
 * a `customPanel` short-circuits `groups`, `actions` *and* `trailingSection`, so
 * taking it means owning the Move/Duplicate/Delete buttons too.
 *
 * **There are three invariants here, not eight, and that is the point.** Most of
 * this type's circuit rules cannot fire against anything the schema holds: the
 * 50 kg unit load has no box weight to check against until goods exist, the
 * three-roller rule cannot fail against a fixed 400 mm box at any pitch this
 * model builds, and the speed and inclination are not fields at all. A rule that
 * cannot fire is worse than no rule — it reads as coverage. What is left is what
 * a person can actually get wrong, and the panel states the rest as figures.
 */
export const conveyorLauncherParametrics: ParametricDescriptor<ConveyorLauncherNode> = {
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
      label: 'Launch',
      fields: [
        { key: 'launchSide', kind: 'enum', options: ['left', 'right'], display: 'select' },
        { key: 'flow', kind: 'enum', options: ['forward', 'reverse'], display: 'select' },
      ],
    },
    {
      label: 'Guides',
      fields: [
        { key: 'sideGuide', kind: 'boolean' },
        {
          key: 'sideGuideHeight',
          kind: 'number',
          unit: 'm',
          min: 0.035,
          max: 0.12,
          step: 0.005,
          // A height for a rail that is not fitted moves nothing.
          visibleIf: (node) => node.sideGuide,
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

  trailingSection: () => import('./launcher-panel'),

  invariants: [
    (node): Issue[] => {
      const issues: Issue[] = []
      const unit = unitNow()

      // The rail on the far side is what the launch pushes the box *against*
      // before it clears. Without it the box has nothing to stop it leaving by
      // the side it came from — a failure a drawing cannot show and a running
      // line finds once.
      if (!node.sideGuide) {
        issues.push({
          field: 'sideGuide',
          severity: 'warning',
          msg: 'No rail on the far side. The launch pushes the box across the bed, and the far rail is what stops it leaving by the wrong side.',
        })
      }

      // The machine is dimensioned around a fixed 400 mm box. A 400 mm lane
      // gives it no clearance at all to be pushed across.
      if (usefulWidthMm(node) <= LNC.boxLengthM * 1000) {
        issues.push({
          field: 'usefulWidth',
          severity: 'warning',
          msg: `A ${usefulWidthMm(node)} mm lane leaves nothing around the ${(LNC.boxLengthM * 1000).toFixed(0)} mm box this type launches. The catalogue builds it up to 600.`,
        })
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
