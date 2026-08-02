'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Note } from '../panels/kit'
import { CAR } from './catalog'
import { hasDownstreamNeighbour, hasUpstreamNeighbour, lineOf } from './line-index'
import {
  frameWidthM,
  maxThroughputPerHour,
  moduleLengthM,
  ratedLoadKg,
  rollerPitchMm,
  speedMPerMin,
  speedMPerSec,
  supportOffsetsX,
  usefulWidthMm,
} from './metrics'
import { jointIssues, ModuleReadout } from './module-panel'
import { conveyorRollerParametrics } from './parametrics'
import { jointProblems } from './port-magnet'
import type { ConveyorModule } from './ports'
import { asConveyorModule, moduleRunLengthM } from './ports'
import type { ConveyorRollerNode } from './schema'

/**
 * What the module is.
 *
 * Mounted as `parametrics.trailingSection`, under the module's own fields
 * rather than instead of them.
 *
 * It renders the descriptor's **invariants**, which nothing else does — the
 * host declares `parametrics.invariants` in its registry types and reads it
 * nowhere, so a kind's own warnings are computed and dropped unless it draws
 * them itself.
 *
 * Uzunluk kutusu **buradan kaldırıldı**. Metre cinsinden yatak uzunluğu artık
 * `Bed` grubundaki `BedLengthField`, yani ait olduğu yerde ve tek nüsha —
 * öncesinde aynı sayı burada metre, grupta adet olarak iki kez ayarlanıyordu.
 */

function useInspectedConveyor(provided?: ConveyorRollerNode): ConveyorRollerNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:conveyor-roller') return null
  return selected as unknown as ConveyorRollerNode
}

export default function ConveyorPanel({ node: provided }: { node?: ConveyorRollerNode }) {
  const node = useInspectedConveyor(provided)
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)

  if (!node) return null

  // The descriptor's own warnings, plus the ones that only exist once a module
  // has a neighbour — a joint is between two nodes, so no single node's
  // invariants can see it.
  const issues = [
    ...(conveyorRollerParametrics.invariants?.flatMap((check) => check(node)) ?? []),
    ...jointIssues(jointProblems(node, nodes)),
  ]

  return (
    <ModuleReadout issues={issues} rows={rowsFor(node, nodes)} title="This module">
      <Note>
        Her modül kendi nesnesi; ayrı ayrı seçilir, taşınır, kopyalanır, silinir. Araç kuşanmışken{' '}
        <strong>[</strong> ve <strong>]</strong> ile bir hat döşeyin, ya da bir modülü başka birinin
        boş ucunun yarım metre yakınına sürükleyin — baş uca kuyruk, eşleşen şerit, eşleşen kot.
        Bağlı bir modülü sürüklerseniz hattın tamamı gelir.
      </Note>
    </ModuleReadout>
  )
}

function rowsFor(
  node: ConveyorRollerNode,
  nodes: Record<string, unknown>,
): ReadonlyArray<readonly [string, string]> {
  return [
    [
      'Bed',
      `${moduleLengthM(node).toFixed(3)} m · ${node.rollers} rollers @ ${rollerPitchMm(node)} mm`,
    ],
    ['Frame', `${(frameWidthM(node) * 1000).toFixed(0)} mm over a ${usefulWidthMm(node)} mm lane`],
    ['Supports', `${supportOffsetsX(node).length} stations`],
    ['Speed', `${speedMPerMin(node)} m/min · ${speedMPerSec(node).toFixed(2)} m/s`],
    [
      'Throughput',
      `≤ ${maxThroughputPerHour(node).toLocaleString()} boxes/h at ${(node.shortestBox * 1000).toFixed(0)} mm`,
    ],
    ['Rated load', `${CAR.loadKgPerMetre} kg/m · ${ratedLoadKg(node).toFixed(0)} kg on this bed`],
    // What a joint bought. A line is not stored anywhere — it is the set of
    // modules whose ends meet, read back from their ports — so this figure
    // cannot disagree with what is drawn.
    ['Line', describeLine(node, nodes)],
  ]
}

/**
 * The line this module belongs to, in a phrase.
 *
 * Computed from the ports rather than stored, so it is never stale: a module
 * deleted out of the middle splits the line the instant the store writes, with
 * nothing to heal.
 */
export function describeLine(node: ConveyorModule, nodes: Record<string, unknown>): string {
  const line = lineOf(nodes, node.id)
  if (line.length <= 1) return 'on its own'

  // Summed through the family-level length, because a line is not all straights:
  // a bend contributes the arc a box actually travels, not its footprint.
  let length = 0
  for (const id of line) {
    const member = asConveyorModule(nodes[id])
    if (member) length += moduleRunLengthM(member)
  }
  const ends: string[] = []
  if (!hasUpstreamNeighbour(nodes, node)) ends.push('head')
  if (!hasDownstreamNeighbour(nodes, node)) ends.push('tail')
  const place = ends.length === 2 ? 'alone' : ends.length ? `at the ${ends[0]}` : 'mid-line'
  return `${line.length} modules · ${length.toFixed(2)} m · this one ${place}`
}
