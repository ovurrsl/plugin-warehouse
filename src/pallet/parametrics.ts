import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { CARGO_COLOR_IDS } from './cargo-constants'
import { CARGO_TYPE_IDS, CARGO_TYPES, fitsOnDeck, loadHeightOf } from './cargo-types'
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
        // There is deliberately no height field here. The one that used to sit
        // in this slot was visible only while `cargo` was `'none'` — a height
        // control that appeared exactly when the pallet was empty — and what it
        // produced was a wood-coloured block on an otherwise bare deck. A load
        // has a height because it is a load; an empty pallet has none.
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

  // The invariants below, under the node's own fields rather than instead of
  // them. Without this they are computed on every render and dropped: the host
  // declares `parametrics.invariants` and reads it nowhere, so a kind that does
  // not draw its own list has none. That silenced a `severity: 'error'` — a
  // drum too wide for the deck is not drawn, and nothing said why.
  trailingSection: () => import('./pallet-panel'),

  invariants: [
    (node): Issue[] => {
      const spec = specOf(node.preset)
      const issues: Issue[] = []

      // A unit larger than the deck fits none of it. Said here rather than
      // drawn smaller or drawn overhanging: the footprint and the clash box are
      // both built from the pallet's own dimensions, so an overhanging load
      // would pass straight through collision.
      if (node.cargo !== 'none' && !fitsOnDeck(CARGO_TYPES[node.cargo], node.preset)) {
        issues.push({
          field: 'cargo',
          severity: 'error',
          msg: `A ${CARGO_TYPES[node.cargo].label.toLowerCase().replace(/s$/, '')} does not fit a ${spec.label} — nothing is drawn.`,
        })
      }
      // Measured off the derived height rather than a typed field — the field
      // is gone, and this is the number the renderer and the collider both use.
      const loadHeight = loadHeightOf(node)

      // Advisory, not a hard limit: the figure is the pallet's rated load, and
      // whether a given stack exceeds it depends on what is on it, which the
      // scene does not model. Flagging an implausible stack height is useful;
      // refusing it would be overreach.
      if (loadHeight > 2.0) {
        issues.push({
          field: 'cargo',
          severity: 'warning',
          msg: `Load is ${loadHeight.toFixed(2)} m tall — check clearance to the beam above.`,
        })
      }
      if (loadHeight > 0 && !spec.branded && node.preset === 'quarter') {
        issues.push({
          field: 'preset',
          severity: 'warning',
          msg: 'Quarter pallets are rated for 250 kg dynamic; confirm the load suits one.',
        })
      }
      return issues
    },
  ],
}
