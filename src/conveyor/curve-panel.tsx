'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Note } from '../panels/kit'
import { describeLine } from './conveyor-panel'
import {
  angleDeg,
  centrelineLengthM,
  frameWidthM,
  laneWidthM,
  longestBoxThroughBendM,
  outerRadiusM,
  rollerCount,
  speedMPerMin,
  speedMPerSec,
  supportAngles,
  usefulWidthMm,
} from './curve-metrics'
import { conveyorCurveParametrics } from './curve-parametrics'
import type { ConveyorCurveNode } from './curve-schema'
import { jointIssues, ModuleReadout } from './module-panel'
import { jointProblems } from './port-magnet'

/**
 * What the bend is, and the one number nobody else can tell you.
 *
 * Mounted as `parametrics.trailingSection`, under the bend's own fields rather
 * than instead of them.
 *
 * Two jobs, the same two the straight's panel has. It renders the descriptor's
 * **invariants**, which nothing else does — the host declares
 * `parametrics.invariants` in its registry types and reads it nowhere, so a
 * kind's own warnings are computed and dropped unless it draws them itself. And
 * it reports **the longest box that gets round**, which is a property of the
 * radius rather than of the drive and is the figure that decides whether a line
 * carrying long cartons can turn this corner at all. Said before the bend is
 * drawn rather than after it is built.
 */

function useInspectedCurve(provided?: ConveyorCurveNode): ConveyorCurveNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:conveyor-curve') return null
  return selected as unknown as ConveyorCurveNode
}

export default function ConveyorCurvePanel({ node: provided }: { node?: ConveyorCurveNode }) {
  const node = useInspectedCurve(provided)
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)

  if (!node) return null

  // The descriptor's own warnings, plus the ones that only exist once a bend has
  // a neighbour — a joint is between two nodes, so no single node's invariants
  // can see it.
  const issues = [
    ...(conveyorCurveParametrics.invariants?.flatMap((check) => check(node)) ?? []),
    ...jointIssues(jointProblems(node, nodes)),
  ]

  const lane = laneWidthM(node)
  const longest = longestBoxThroughBendM(node)

  return (
    <ModuleReadout
      issues={issues}
      rows={[
        ['Arc', `${angleDeg(node)}° ${node.handed} · ${centrelineLengthM(node).toFixed(2)} m`],
        [
          'Radius',
          `${(node.innerRadius * 1000).toFixed(0)} mm inner · ${(outerRadiusM(node) * 1000).toFixed(0)} mm outer`,
        ],
        [
          'Frame',
          `${(frameWidthM(node) * 1000).toFixed(0)} mm over a ${usefulWidthMm(node)} mm lane`,
        ],
        ['Rollers', `${rollerCount(node)} tapered · ${supportAngles(node).length} supports`],
        ['Speed', `${speedMPerMin(node)} m/min · ${speedMPerSec(node).toFixed(2)} m/s`],
        // The figure a bend exists to be checked against, and the one a straight
        // has no equivalent of.
        [
          'Longest box',
          `${(longest * 1000).toFixed(0)} mm at full ${(lane * 1000).toFixed(0)} mm width`,
        ],
        ['Line', describeLine(node, nodes)],
      ]}
      title="This bend"
    >
      <Note>
        Bir viraj kutunun yönünü korur — çıkan, girdiği yöne bakar. Transferden ayıran budur ve bir
        sonraki bölümün kutu-boyu sınırlarının hâlâ geçerli olmasının sebebi de budur. Boş bir ucun
        yarım metre yakınına sürükleyin, yapışır: baş uca kuyruk, eşleşen şerit, eşleşen kot.
      </Note>
    </ModuleReadout>
  )
}
