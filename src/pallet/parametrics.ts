import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { PALLET_PRESETS, specOf } from './presets'
import type { PalletNode } from './schema'

const PRESET_KEYS = Object.keys(PALLET_PRESETS) as (keyof typeof PALLET_PRESETS)[]

/**
 * Auto-derived inspector fields rather than a `customPanel`.
 *
 * The escape hatch is tempting but it short-circuits `groups`, `actions` *and*
 * `trailingSection` — take it and you own the Move/Duplicate/Delete buttons
 * too. The earlier version did exactly that and ended up hand-rolling position
 * and rotation sliders whose range was recomputed from the current value on
 * every change, so the handle snapped back to the middle of the track mid-drag.
 * Declaring fields gets the host's own editors, which behave correctly and
 * follow its theme.
 */
export const palletParametrics: ParametricDescriptor<PalletNode> = {
  groups: [
    {
      label: 'Pallet',
      fields: [
        { key: 'preset', kind: 'enum', options: PRESET_KEYS, display: 'select' },
        { key: 'loadHeight', kind: 'number', unit: 'm', min: 0, max: 2.4, step: 0.05 },
      ],
    },
    {
      label: 'Transform',
      fields: [
        { key: 'position', kind: 'vec3' },
        { key: 'rotation', kind: 'vec3' },
      ],
    },
  ],

  invariants: [
    (node): Issue[] => {
      const spec = specOf(node.preset)
      const issues: Issue[] = []
      // Advisory, not a hard limit: the figure is the pallet's rated load, and
      // whether a given stack exceeds it depends on what is on it, which the
      // scene does not model. Flagging an implausible stack height is useful;
      // refusing it would be overreach.
      if (node.loadHeight > 2.0) {
        issues.push({
          field: 'loadHeight',
          severity: 'warning',
          msg: `Load is ${node.loadHeight.toFixed(2)} m tall — check clearance to the beam above.`,
        })
      }
      if (node.loadHeight > 0 && !spec.branded && node.preset === 'quarter') {
        issues.push({
          field: 'loadHeight',
          severity: 'warning',
          msg: 'Quarter pallets are rated for 250 kg dynamic; confirm the load suits one.',
        })
      }
      return issues
    },
  ],
}
