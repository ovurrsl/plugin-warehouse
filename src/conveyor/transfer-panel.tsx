'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Note } from '../panels/kit'
import { MTR } from './catalog'
import { describeLine } from './conveyor-panel'
import { jointIssues, ModuleReadout } from './module-panel'
import { jointProblems } from './port-magnet'
import {
  frameWidthM,
  laneMm,
  moduleLengthM,
  rollerOffsetsX,
  rollersUnderShortestBox,
  speedMPerMin,
  speedMPerSec,
  stripSpanM,
  widestRollerGapM,
} from './transfer-metrics'
import { conveyorTransferParametrics } from './transfer-parametrics'
import type { ConveyorTransferNode } from './transfer-schema'

/**
 * What the machine is, and where it sits in the range.
 *
 * Mounted as `parametrics.trailingSection`, under the module's own fields rather
 * than instead of them.
 *
 * It renders the descriptor's **invariants**, which nothing else does — the host
 * declares `parametrics.invariants` in its registry types and reads it nowhere.
 */

function useInspectedTransfer(provided?: ConveyorTransferNode): ConveyorTransferNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:conveyor-transfer') {
    return null
  }
  return selected as unknown as ConveyorTransferNode
}

export default function ConveyorTransferPanel({ node: provided }: { node?: ConveyorTransferNode }) {
  const node = useInspectedTransfer(provided)
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)

  if (!node) return null

  const issues = [
    ...(conveyorTransferParametrics.invariants?.flatMap((check) => check(node)) ?? []),
    ...jointIssues(jointProblems(node, nodes)),
  ]

  return (
    <ModuleReadout
      issues={issues}
      rows={[
        [
          'Body',
          `${(moduleLengthM(node) * 1000).toFixed(0)} × ${(frameWidthM(node) * 1000).toFixed(0)} mm — fixed, both ways`,
        ],
        ['Ports', `${laneMm(node)} mm class on all three — the only one this type is built in`],
        [
          'Strips',
          `${node.travel} · ${(stripSpanM(node) * 1000).toFixed(0)} mm of travel, discharging ${node.dischargeSide}`,
        ],
        [
          'Rollers',
          `${rollerOffsetsX(node).length} in the gaps · widest gap ${(widestRollerGapM(node) * 1000).toFixed(0)} mm`,
        ],
        ['Speed', `${speedMPerMin(node)} m/min · ${speedMPerSec(node).toFixed(2)} m/s`],
        [
          'Shortest box',
          `${(node.shortestBox * 1000).toFixed(0)} mm on ${rollersUnderShortestBox(node)} rollers · ≤ ${MTR.loadKg} kg`,
        ],
        ['Line', describeLine(node, nodes)],
      ]}
      title="This transfer"
    >
      <Note>
        Kutu bu makineden, girdiği yöne doksan derece dönmüş olarak çıkar — bant şeritleri onu
        makara hattından kaldırır, döndürmez — yani virajın aksine bir sonraki bölümün kutu-boyu
        sınırları artık bir öncekinden türemez. Boş bir ucun yarım metre yakınına sürükleyin,
        yapışır.
      </Note>
      {/* Information rather than a defect, so it is a note and not a warning:
          every asymmetric build would otherwise be born yellow. */}
      {node.travel === 'asymmetric' && (
        <Note>
          Asimetrik şeritler kutuyu çapraz orta hattın berisinde devrediyor; dar bir tesisatın satın
          aldığı şey budur. Kutuyu devralan şey, bu gövdenin ortasına değil şeritlere göre
          ayarlanmalıdır.
        </Note>
      )}
    </ModuleReadout>
  )
}
