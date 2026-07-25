import type { Issue, ParametricDescriptor } from '@pascal-app/core'
import { PALLET_PRESETS } from '../pallet/presets'
import { exceedsPartBudget, fullPartCount, PART_BUDGET } from './parts'
import type { PalletRackNode } from './schema'
import {
  autoPalletsPerLevel,
  fittedLevelCount,
  hasUnsupportedPallets,
  levelSurfaceY,
  strandedRowsPerGroup,
  usesAisle,
  usesSpineGap,
} from './slots'
import { en15620Clearance } from './standards'

const PRESET_KEYS = Object.keys(PALLET_PRESETS) as (keyof typeof PALLET_PRESETS)[]

/** A turret truck works the narrowest aisle of anything that serves a pallet
 *  rack — roughly 1.6 m. Below that nothing can turn a pallet into the bay. */
const NARROWEST_WORKING_AISLE = 1.6

/**
 * Auto-derived inspector fields rather than a `customPanel`, for the reason the
 * pallet's descriptor gives: the escape hatch short-circuits `groups`,
 * `actions` *and* `trailingSection`, so taking it means owning the
 * Move/Duplicate/Delete buttons too.
 *
 * The invariants are where most of this file's value is. A rack has enough
 * interacting dimensions that a plausible-looking set of numbers can describe
 * something nobody could build, and the failures are quiet: levels that do not
 * fit simply stop being counted, and a rack turned long-side-out without
 * support bars looks completely normal.
 */
export const palletRackParametrics: ParametricDescriptor<PalletRackNode> = {
  groups: [
    {
      label: 'Run',
      fields: [
        { key: 'bayCount', kind: 'number', min: 1, max: 40, step: 1 },
        { key: 'bayClearWidth', kind: 'number', unit: 'm', min: 0.6, max: 6, step: 0.05 },
        { key: 'depth', kind: 'number', unit: 'm', min: 0.4, max: 2.5, step: 0.05 },
        { key: 'uprightHeight', kind: 'number', unit: 'm', min: 1, max: 20, step: 0.1 },
      ],
    },
    {
      label: 'Levels',
      fields: [
        { key: 'levels', kind: 'number', min: 0, max: 15, step: 1 },
        { key: 'firstLevelClear', kind: 'number', unit: 'm', min: 0.2, max: 6, step: 0.05 },
        { key: 'levelClear', kind: 'number', unit: 'm', min: 0.2, max: 6, step: 0.05 },
        { key: 'groundLevelStorage', kind: 'boolean' },
        { key: 'hasGroundBeam', kind: 'boolean' },
        { key: 'levelCapacity', kind: 'number', unit: 'kg', min: 0, max: 20_000, step: 100 },
      ],
    },
    {
      label: 'Rows',
      fields: [
        { key: 'rowCount', kind: 'number', min: 1, max: 20, step: 1 },
        { key: 'backToBack', kind: 'number', min: 1, max: 6, step: 1 },
        {
          key: 'backToBackGap',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 1.5,
          step: 0.05,
          // Nothing stands spine to spine until a group holds two rows, so the
          // field would otherwise read as a dimension that does nothing.
          visibleIf: (node) => usesSpineGap(node),
        },
        {
          key: 'aisleWidth',
          kind: 'number',
          unit: 'm',
          min: 0.8,
          max: 8,
          step: 0.1,
          visibleIf: (node) => usesAisle(node),
        },
      ],
    },
    {
      label: 'Depth',
      fields: [
        { key: 'depthPositions', kind: 'number', min: 1, max: 2, step: 1 },
        { key: 'depthGap', kind: 'number', unit: 'm', min: 0, max: 0.5, step: 0.01 },
      ],
    },
    {
      label: 'Growth',
      fields: [
        { key: 'bayAnchor', kind: 'enum', options: ['left', 'center', 'right'], display: 'select' },
        { key: 'rowAnchor', kind: 'enum', options: ['front', 'center', 'back'], display: 'select' },
      ],
    },
    {
      label: 'Pallets',
      fields: [
        { key: 'palletPreset', kind: 'enum', options: PRESET_KEYS, display: 'select' },
        {
          key: 'palletOrientation',
          kind: 'enum',
          options: ['short-side-out', 'long-side-out'],
          display: 'select',
        },
        { key: 'palletsPerLevel', kind: 'number', min: 1, max: 12, step: 1 },
        { key: 'palletSupportBars', kind: 'number', min: 0, max: 3, step: 1 },
        { key: 'clearanceToUpright', kind: 'number', unit: 'm', min: 0, max: 0.4, step: 0.005 },
        {
          key: 'clearanceBetweenPallets',
          kind: 'number',
          unit: 'm',
          min: 0,
          max: 0.4,
          step: 0.005,
        },
      ],
    },
    {
      label: 'Picking',
      fields: [
        { key: 'pickingLevels', kind: 'number', min: 0, max: 15, step: 1 },
        { key: 'pickingLevelClear', kind: 'number', unit: 'm', min: 0.15, max: 3, step: 0.05 },
        { key: 'pickingBoxWidth', kind: 'number', unit: 'm', min: 0.1, max: 1.5, step: 0.05 },
        { key: 'pickingBoxDepth', kind: 'number', unit: 'm', min: 0.1, max: 1.5, step: 0.05 },
        { key: 'pickingBoxHeight', kind: 'number', unit: 'm', min: 0.05, max: 1, step: 0.02 },
      ],
    },
    {
      label: 'Steel',
      fields: [
        { key: 'uprightWidth', kind: 'number', unit: 'm', min: 0.05, max: 0.25, step: 0.001 },
        { key: 'uprightDepth', kind: 'number', unit: 'm', min: 0.05, max: 0.25, step: 0.001 },
        { key: 'beamHeight', kind: 'number', unit: 'm', min: 0.06, max: 0.25, step: 0.01 },
        { key: 'beamThickness', kind: 'number', unit: 'm', min: 0.02, max: 0.15, step: 0.005 },
        {
          key: 'bracing',
          kind: 'enum',
          options: ['z-bracing', 'x-bracing', 'open'],
          display: 'select',
        },
        {
          key: 'decking',
          kind: 'enum',
          options: ['wire-mesh', 'steel', 'timber', 'open'],
          display: 'select',
        },
        { key: 'uprightColor', kind: 'color' },
        { key: 'beamColor', kind: 'color' },
      ],
    },
    {
      label: 'Stock',
      fields: [{ key: 'ghostFill', kind: 'number', min: 0, max: 1, step: 0.05 }],
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
      const issues: Issue[] = []

      // Levels silently stop existing when they do not fit the upright, and
      // nothing on screen says so — the rack just has fewer shelves than the
      // number in the field.
      const fitted = fittedLevelCount(node)
      if (fitted < node.levels) {
        issues.push({
          field: 'levels',
          severity: 'warning',
          msg: `Only ${fitted} of ${node.levels} levels fit a ${node.uprightHeight.toFixed(2)} m upright. Raise the height or reduce the clear openings.`,
        })
      }

      // Turned long-side-out, a Euro pallet's bottom boards lie along the beams
      // instead of across them, so the middle of the pallet is unsupported.
      if (hasUnsupportedPallets(node)) {
        issues.push({
          field: 'palletSupportBars',
          severity: 'warning',
          msg: 'Pallets are turned long-side-out with no support bars. Their bottom deckboards run along the beams, leaving the middle unsupported.',
        })
      }

      // A declared count above what the bay geometrically holds is legitimate
      // to model but worth naming, because the pallets will visibly touch.
      const auto = autoPalletsPerLevel(node)
      if (node.palletsPerLevel !== null && node.palletsPerLevel > auto) {
        issues.push({
          field: 'palletsPerLevel',
          severity: 'warning',
          msg: `${node.palletsPerLevel} pallets per level exceeds the ${auto} this bay fits at the declared clearances.`,
        })
      }

      // A block big enough to blow the merge budget still draws, but only as
      // its silhouette — so say so here rather than leaving the user to notice
      // that the bracing and the decking stopped appearing.
      if (exceedsPartBudget(node)) {
        issues.push({
          field: 'rowCount',
          severity: 'warning',
          msg: `This block is ${fullPartCount(node).toLocaleString()} parts, past the ${PART_BUDGET.toLocaleString()} one mesh holds, so it draws as posts and beams only. Split it into separate blocks to keep the detail.`,
        })
      }

      // Selective racking reaches one row deep from each aisle, so a group of
      // three or more strands everything between its first and last row. The
      // capacity figure keeps counting those pallets, which is the whole problem
      // — the block reads as denser storage rather than as unreachable stock.
      const stranded = strandedRowsPerGroup(node)
      if (stranded > 0) {
        issues.push({
          field: 'backToBack',
          severity: 'warning',
          msg: `${node.backToBack} rows back to back leaves ${stranded} of them with no aisle face — a truck can only reach the first and the last. Real blocks deeper than two rows are drive-in or push-back systems, which this rack does not model.`,
        })
      }

      // An aisle narrower than the truck cannot be worked, and the figure that
      // decides which truck is the aisle rather than anything about the rack.
      if (usesAisle(node) && node.aisleWidth < NARROWEST_WORKING_AISLE) {
        issues.push({
          field: 'aisleWidth',
          severity: 'warning',
          msg: `A ${node.aisleWidth.toFixed(2)} m aisle is below the ${NARROWEST_WORKING_AISLE.toFixed(2)} m a turret truck needs — the narrowest truck that works a pallet rack. Anything less is a walkway, not an aisle.`,
        })
      }

      // EN 15620 widens the required clearance with height, and the top level
      // is the one that runs out of room first.
      const top = levelSurfaceY(node, fitted)
      const required = en15620Clearance(top, '400')
      if (required && node.levelClear < required.y) {
        issues.push({
          field: 'levelClear',
          severity: 'warning',
          msg: `EN 15620 asks for at least ${(required.y * 1000).toFixed(0)} mm above the load at ${top.toFixed(1)} m for counterbalanced and reach trucks.`,
        })
      }
      if (!required && top > 0) {
        issues.push({
          field: 'uprightHeight',
          severity: 'warning',
          msg: `At ${top.toFixed(1)} m the top level is above the range EN 15620 rates for forklifts; it needs a turret truck or a crane.`,
        })
      }

      return issues
    },
  ],
}
