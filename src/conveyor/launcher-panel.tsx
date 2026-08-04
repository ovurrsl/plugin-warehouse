'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Note } from '../panels/kit'
import { millimetreLabel, useUnit } from '../units'
import { LNC } from './catalog'
import { describeLine } from './conveyor-panel'
import {
  frameWidthM,
  lateralOuterZM,
  maxThroughputPerHour,
  moduleLengthM,
  rollerCount,
  rollerPitchMm,
  speedMPerSec,
  usefulWidthMm,
} from './launcher-metrics'
import { conveyorLauncherParametrics } from './launcher-parametrics'
import type { ConveyorLauncherNode } from './launcher-schema'
import { jointIssues, ModuleReadout } from './module-panel'
import { jointProblems } from './port-magnet'

/**
 * What the machine is, and the two things about it that are not settings.
 *
 * Mounted as `parametrics.trailingSection`, under the module's own fields rather
 * than instead of them.
 *
 * It renders the descriptor's **invariants**, which nothing else does — the host
 * declares `parametrics.invariants` in its registry types and reads it nowhere.
 */

function useInspectedLauncher(provided?: ConveyorLauncherNode): ConveyorLauncherNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:conveyor-launcher') {
    return null
  }
  return selected as unknown as ConveyorLauncherNode
}

export default function ConveyorLauncherPanel({ node: provided }: { node?: ConveyorLauncherNode }) {
  const node = useInspectedLauncher(provided)
  const unit = useUnit()
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)

  if (!node) return null

  const issues = [
    ...(conveyorLauncherParametrics.invariants?.flatMap((check) => check(node)) ?? []),
    ...jointIssues(jointProblems(node, nodes, unit)),
  ]

  return (
    <ModuleReadout
      issues={issues}
      rows={[
        [
          'Body',
          `${(moduleLengthM(node) * 1000).toFixed(0)} mm fixed · ${rollerCount(node)} rollers @ ${rollerPitchMm(node)} mm`,
        ],
        [
          'Frame',
          `${(frameWidthM(node) * 1000).toFixed(0)} mm over a ${usefulWidthMm(node)} mm lane`,
        ],
        [
          'Launch',
          `${node.launchSide} · reaches ${millimetreLabel(lateralOuterZM(node), unit)} from the centreline`,
        ],
        // Not a field: the type is built at one speed and around one box.
        ['Speed', `${LNC.speedMPerMin} m/min · ${speedMPerSec(node).toFixed(2)} m/s — fixed`],
        [
          'Box',
          `${(LNC.boxLengthM * 1000).toFixed(0)} mm, ≤ ${LNC.loadKg} kg — both fixed by the type`,
        ],
        ['Throughput', `≤ ${maxThroughputPerHour(node).toLocaleString()} boxes/h`],
        ['Line', describeLine(node, nodes, unit)],
      ]}
      title="This launcher"
    >
      <Note>
        Kutu bu makineden, girdiği yöne doksan derece dönmüş olarak çıkar — virajdan ayıran budur ve
        bir sonraki bölümün kutu-boyu sınırlarının artık bir öncekinden türememesi demektir. Boş bir
        ucun yarım metre yakınına sürükleyin, yapışır: baş uca kuyruk, eşleşen şerit, eşleşen kot.
      </Note>
    </ModuleReadout>
  )
}
