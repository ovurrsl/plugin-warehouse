'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { IssueList } from '../panels/issue-list'
import { palletParametrics } from './parametrics'
import type { PalletNode } from './schema'

/**
 * The pallet's warnings, which nothing else draws.
 *
 * Mounted as `parametrics.trailingSection`, under the node's own fields rather
 * than instead of them — a `customPanel` would short-circuit `groups`, the
 * actions and the Move/Duplicate/Delete buttons along with them.
 *
 * Until this existed the descriptor's invariants ran on every render and went
 * nowhere. The one that mattered is at `severity: 'error'`: a drum whose
 * diameter exceeds the deck is not drawn at all, so the user picked a cargo
 * type, got a bare pallet, and was told nothing. See `../panels/issue-list`.
 */

/**
 * The host does not pass a `node` prop to `trailingSection`, so reading the
 * prop alone throws on the first property access. Resolved the way the
 * inspector resolves it — whatever is selected — while still preferring a
 * provided node, which costs nothing and keeps this working if the contract is
 * ever repaired.
 */
function useInspectedPallet(provided?: PalletNode): PalletNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:pallet') return null
  return selected as unknown as PalletNode
}

export default function PalletPanel({ node: provided }: { node?: PalletNode }) {
  const node = useInspectedPallet(provided)
  if (!node) return null

  const issues = palletParametrics.invariants?.flatMap((check) => check(node)) ?? []
  return <IssueList issues={issues} />
}
