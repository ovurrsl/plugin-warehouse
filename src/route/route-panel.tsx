'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { IssueList } from '../panels/issue-list'
import { routeParametrics } from './parametrics'
import type { RouteNode } from './schema'

/**
 * The route's readings, which nothing else draws.
 *
 * Mounted as `parametrics.trailingSection`, under the node's own fields rather
 * than instead of them.
 *
 * This kind loses more than the others did by having no panel, because the
 * reading *is* the feature: the aisle band a manufacturer publishes for the
 * selected truck, the margin in millimetres, and — for a pedestrian walkway —
 * the note saying the only published width in the survey is German and this
 * one is an estimate. All of it was computed and discarded. The descriptor's
 * rule still governs what appears here: every message is a measurement or a
 * citation, never a verdict. See `../panels/issue-list`.
 */

/** The host passes no `node` prop to `trailingSection`; see the pallet panel. */
function useInspectedRoute(provided?: RouteNode): RouteNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:route') return null
  return selected as unknown as RouteNode
}

export default function RoutePanel({ node: provided }: { node?: RouteNode }) {
  const node = useInspectedRoute(provided)
  if (!node) return null

  const issues = routeParametrics.invariants?.flatMap((check) => check(node)) ?? []
  return <IssueList issues={issues} />
}
