import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { CARGO_COLOR_IDS } from './cargo-constants'
import { CARGO_TYPE_IDS } from './cargo-types'
import { PALLET_PRESETS, specOf } from './presets'
import type { PalletNode } from './schema'

const PRESET_KEYS = Object.keys(PALLET_PRESETS) as (keyof typeof PALLET_PRESETS)[]

/** `'none'` first, because it is the default and the state every pallet saved
 *  before cargo existed is in. */
const CARGO_OPTIONS = ['none', ...CARGO_TYPE_IDS] as const

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
        // Only meaningful while the pallet carries the plain block. A typed
        // cargo takes its height from the variant its seed resolves to, and
        // leaving an editable field that silently does nothing is worse than
        // hiding it.
        {
          key: 'loadHeight',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 2.4,
          step: 0.05,
          visibleIf: (node) => node.cargo === 'none',
        },
      ],
    },
    {
      label: 'Load',
      fields: [
        { key: 'cargo', kind: 'enum', options: CARGO_OPTIONS, display: 'select' },
        {
          key: 'cargoColor',
          kind: 'enum',
          options: CARGO_COLOR_IDS,
          display: 'select',
          visibleIf: (node) => node.cargo !== 'none',
        },
        { key: 'strapped', kind: 'boolean', visibleIf: (node) => node.cargo !== 'none' },
        { key: 'labelled', kind: 'boolean', visibleIf: (node) => node.cargo !== 'none' },
        { key: 'wrapped', kind: 'boolean', visibleIf: (node) => node.cargo !== 'none' },
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
