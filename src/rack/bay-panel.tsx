'use client'

import { Icon } from '@iconify/react'
import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { SegmentedControl } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import type { CSSProperties } from 'react'
import { useWarehouseStore } from '../store'
import RackAutoFields from './auto-fields'
import { deleteBays } from './bay-commands'
import type { PalletRackNode } from './schema'
import {
  type BayOverride,
  bayDecking,
  bayLevelCount,
  bayTunnelLevels,
  fittedLevelCount,
  formatBayAddress,
  isBaySkipped,
} from './slots'

/**
 * The clicked bay, and what can be done to just that bay.
 *
 * Mounted as `parametrics.trailingSection`, so it sits under the rack's own
 * fields in the host inspector rather than replacing them — `customPanel` would
 * short-circuit the auto-derived groups, the actions and the Move/Delete buttons
 * along with them.
 *
 * Which bay it edits comes from the last click on the rack. There is no gesture
 * to learn and no sub-selection mode to enter: the click that selects the rack
 * is the click that lands on a bay, and the host's own snapping and modifier
 * keys stay untouched.
 */

const FG = 'var(--foreground)'
const MUTED = 'var(--muted-foreground)'
const BORDER = 'var(--border)'

const styles = {
  root: { display: 'flex', flexDirection: 'column', gap: '0.625rem', color: FG },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
  },
  title: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
    fontSize: '0.6875rem',
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: MUTED,
  },
  address: {
    borderRadius: '9999px',
    border: `1px solid ${BORDER}`,
    padding: '0.0625rem 0.4375rem',
    fontSize: '0.6875rem',
    fontVariantNumeric: 'tabular-nums',
    color: FG,
  },
  hint: {
    margin: 0,
    borderRadius: '0.5rem',
    border: `1px dashed ${BORDER}`,
    padding: '0.5rem 0.625rem',
    fontSize: '0.6875rem',
    lineHeight: 1.5,
    color: MUTED,
  },
  field: { display: 'flex', flexDirection: 'column', gap: '0.3125rem' },
  label: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    fontSize: '0.6875rem',
    color: MUTED,
  },
  reset: {
    alignSelf: 'flex-start',
    borderRadius: '0.375rem',
    border: `1px solid ${BORDER}`,
    background: 'transparent',
    padding: '0.25rem 0.5rem',
    fontSize: '0.6875rem',
    color: MUTED,
    cursor: 'pointer',
  },
  danger: {
    borderRadius: '0.5rem',
    border: '1px solid color-mix(in oklab, #ef4444 45%, transparent)',
    background: 'color-mix(in oklab, #ef4444 12%, transparent)',
    padding: '0.4375rem 0.625rem',
    fontSize: '0.75rem',
    fontWeight: 500,
    color: '#f87171',
    cursor: 'pointer',
    textAlign: 'center',
  },
} satisfies Record<string, CSSProperties>

/** Merge a patch into one bay's override, dropping the entry entirely when it no
 *  longer says anything — an empty record is what makes the bay uniform again,
 *  and a uniform block is the one that shares its mesh. */
function patchBays(
  rack: PalletRackNode,
  bays: ReadonlyArray<{ row: number; bay: number }>,
  patch: Partial<BayOverride>,
) {
  const next = { ...rack.bayOverrides }
  for (const { row, bay } of bays) {
    const key = formatBayAddress(row, bay)
    const merged: BayOverride = { ...(next[key] ?? {}), ...patch }
    for (const field of Object.keys(merged) as (keyof BayOverride)[]) {
      if (merged[field] === undefined) delete merged[field]
    }
    if (Object.keys(merged).length === 0) delete next[key]
    else next[key] = merged
  }

  // One update for the whole set — one store write, one undo step, however many
  // bays are focused.
  useScene
    .getState()
    .updateNode(rack.id as AnyNodeId, { bayOverrides: next } as unknown as Partial<AnyNode>)
}

/**
 * The rack this panel is editing.
 *
 * `ParametricDescriptor.trailingSection` is typed `ComponentType<{ node: N }>`,
 * but `parametric-inspector.tsx` renders `<TrailingSection />` with no props at
 * all — so the declared `node` arrives `undefined` and the first property read
 * throws. The type is the thing that is wrong, not the call site's intent, and
 * a plugin cannot patch the host.
 *
 * So the node is read the way the inspector itself reads it: whatever is
 * selected. The prop is still preferred when a host does pass one, which costs
 * nothing and means this keeps working if the contract is repaired.
 */
function useInspectedRack(provided?: PalletRackNode): PalletRackNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:pallet-rack') return null
  return selected as unknown as PalletRackNode
}

export default function RackBayPanel({ node: provided }: { node?: PalletRackNode }) {
  const allFocused = useWarehouseStore((s) => s.focusedBays)
  const node = useInspectedRack(provided)

  // The inspector is open for something that is not a rack — or for nothing.
  // Rendering the empty-state hint here would put a "click a bay" prompt under
  // an unrelated node's fields.
  if (!node) return null

  const bays = allFocused
    .filter(
      (entry) =>
        entry.rackId === node.id &&
        entry.row >= 1 &&
        entry.row <= node.rowCount &&
        entry.bay >= 1 &&
        entry.bay <= node.bayCount,
    )
    .map(({ row, bay }) => ({ row, bay }))

  if (bays.length === 0) {
    return (
      <div style={styles.root}>
        <RackAutoFields node={node} />
        <span style={styles.title}>
          <Icon height={13} icon="lucide:square-mouse-pointer" width={13} />
          Bay
        </span>
        <p style={styles.hint}>
          Click a bay in the 3D view to configure just that one — Shift+click to add more. Leave a
          bay out for a column, open a walkway through it, or stop it short of the others.
        </p>
      </div>
    )
  }

  // Values shown come from the first focused bay; edits go to all of them.
  // Showing a merged "mixed" state per control would be more precise and much
  // harder to read — and the first bay is always the one clicked first.
  const { row, bay } = bays[0] as { row: number; bay: number }
  const skipped = isBaySkipped(node, row, bay)
  const tunnel = bayTunnelLevels(node, row, bay)
  const fitted = fittedLevelCount(node)
  const levels = bayLevelCount(node, row, bay)
  const override = node.bayOverrides[formatBayAddress(row, bay)]
  const patch = (change: Partial<BayOverride>) => patchBays(node, bays, change)

  return (
    <div style={styles.root}>
      <RackAutoFields node={node} />

      <div style={styles.header}>
        <span style={styles.title}>
          <Icon height={13} icon="lucide:square-mouse-pointer" width={13} />
          {bays.length === 1 ? 'Bay' : `${bays.length} bays`}
        </span>
        <span style={styles.address}>
          {bays
            .slice(0, 4)
            .map((entry) => formatBayAddress(entry.row, entry.bay))
            .join(' ')}
          {bays.length > 4 ? ` +${bays.length - 4}` : ''}
        </span>
      </div>

      <div style={styles.field}>
        <span style={styles.label}>
          <span>Built</span>
          <span style={{ opacity: 0.7 }}>{skipped ? 'left out' : 'in the run'}</span>
        </span>
        <SegmentedControl
          onChange={(value: string) => patch({ skipped: value === 'skip' ? true : undefined })}
          options={[
            { label: 'Built', value: 'built' },
            { label: 'Leave out', value: 'skip' },
          ]}
          value={skipped ? 'skip' : 'built'}
        />
      </div>

      {skipped ? (
        <p style={styles.hint}>
          The run keeps its length — a left-out bay is a deliberate gap for a column or a doorway,
          not a shortening. Its frames stay unless it is the last bay.
        </p>
      ) : (
        <>
          <div style={styles.field}>
            <span style={styles.label}>
              <span>Walkway through</span>
              <span style={{ opacity: 0.7 }}>
                {tunnel === 0 ? 'none' : `lowest ${tunnel} level${tunnel === 1 ? '' : 's'}`}
              </span>
            </span>
            <SegmentedControl
              onChange={(value: string) =>
                patch({
                  tunnelLevels: value === '0' ? undefined : Number(value),
                })
              }
              // Derived from the levels this frame actually carries, not a
              // fixed 1–3. A tunnel through every level is a legitimate thing
              // to ask for — it is the shape a fire route takes through a tall
              // block — and a hardcoded ceiling both hid that and misreported
              // an existing deeper tunnel as 3.
              options={[
                { label: 'None', value: '0' },
                ...Array.from({ length: fitted }, (_, index) => ({
                  label: index === 0 ? '1 level' : String(index + 1),
                  value: String(index + 1),
                })),
              ]}
              value={String(Math.min(fitted, tunnel))}
            />
          </div>

          <div style={styles.field}>
            <span style={styles.label}>
              <span>Levels</span>
              <span style={{ opacity: 0.7 }}>
                {levels === fitted ? `same as the run (${fitted})` : `${levels} of ${fitted}`}
              </span>
            </span>
            <SegmentedControl
              onChange={(value: string) =>
                patch({
                  levels: value === 'run' ? undefined : Number(value),
                })
              }
              options={[
                { label: 'Run', value: 'run' },
                ...Array.from({ length: Math.min(3, fitted) }, (_, index) => ({
                  label: String(fitted - index),
                  value: String(fitted - index),
                })),
              ]}
              value={override?.levels === undefined ? 'run' : String(override.levels)}
            />
          </div>

          <div style={styles.field}>
            <span style={styles.label}>
              <span>Decking</span>
              <span style={{ opacity: 0.7 }}>
                {override?.decking === undefined ? 'same as the run' : 'this bay only'}
              </span>
            </span>
            <SegmentedControl
              onChange={(value: string) =>
                patch({
                  decking: value === 'run' ? undefined : (value as BayOverride['decking']),
                })
              }
              options={[
                { label: 'Run', value: 'run' },
                { label: 'Mesh', value: 'wire-mesh' },
                { label: 'Steel', value: 'steel' },
                { label: 'Open', value: 'open' },
              ]}
              value={override?.decking ?? 'run'}
            />
          </div>
        </>
      )}

      {override ? (
        <button
          onClick={() =>
            patch({
              skipped: undefined,
              tunnelLevels: undefined,
              levels: undefined,
              decking: undefined,
            })
          }
          style={styles.reset}
          type="button"
        >
          Match the run
        </button>
      ) : null}

      <div style={styles.field}>
        <span style={styles.label}>
          <span>Remove</span>
          <span style={{ opacity: 0.7 }}>Del</span>
        </span>
        <button
          onClick={() =>
            deleteBays(
              node,
              bays.map((entry) => entry.bay),
            )
          }
          style={styles.danger}
          type="button"
        >
          {removalLabel(node, bays)}
        </button>
      </div>

      <p style={styles.hint}>
        Bays that match the run cost nothing. A bay that differs makes this rack's shape unique, so
        a line of identical racks that shared one mesh becomes one mesh each —{' '}
        {bayDecking(node, row, bay)} decking, {levels} level{levels === 1 ? '' : 's'}.
      </p>
    </div>
  )
}

/**
 * Say what the button will actually do before it does it.
 *
 * Removing bays has quite different outcomes depending on where they sit, and
 * the one that surprises people is the middle: a run cannot lose an interior
 * bay and stay one run without dragging half of itself across the other half,
 * so it splits. Naming that on the button is cheaper than explaining it after.
 */
function removalLabel(node: PalletRackNode, bays: ReadonlyArray<{ bay: number }>): string {
  const removed = new Set(bays.map((entry) => entry.bay))
  if (removed.size >= node.bayCount) return 'Delete this rack'
  // The run splits when any surviving stretch is bounded by removals on both
  // sides — i.e. some removed bay has kept bays both left and right of it.
  const splits = [...removed].some(
    (cut) =>
      [...Array(cut - 1)].some((_, i) => !removed.has(i + 1)) &&
      [...Array(node.bayCount - cut)].some((_, i) => !removed.has(cut + i + 1)),
  )
  const what = removed.size === 1 ? 'this bay' : `${removed.size} bays`
  return splits ? `Remove ${what} — splits the run` : `Remove ${what}`
}
