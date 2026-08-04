'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Note } from '../panels/kit'
import { millimetreLabel, useUnit } from '../units'
import {
  frameWidthM,
  moduleLengthM,
  rollerPitchMm,
  rollersUnderShortestBox,
  speedMPerMin,
  speedMPerSec,
  supportOffsetsX,
  usefulWidthMm,
} from './booster-metrics'
import { conveyorBoosterParametrics } from './booster-parametrics'
import type { ConveyorBoosterNode } from './booster-schema'
import { BST } from './catalog'
import { describeLine } from './conveyor-panel'
import { jointIssues, ModuleReadout } from './module-panel'
import { jointProblems } from './port-magnet'

/**
 * What the machine is, and where it sits in the range.
 *
 * Mounted as `parametrics.trailingSection`, under the module's own fields rather
 * than instead of them.
 *
 * It renders the descriptor's **invariants**, which nothing else does — the host
 * declares `parametrics.invariants` in its registry types and reads it nowhere.
 * The readout leads with the bed length against the catalogue range, because
 * that is the figure a person is most likely to walk out of without noticing:
 * the roller count is a control and the range is a length.
 */

/**
 * The booster this panel is editing.
 *
 * `ParametricDescriptor.trailingSection` is typed `ComponentType<{ node: N }>`
 * but the host renders `<TrailingSection />` with no props at all, so a declared
 * `node` arrives `undefined` and the first property read throws. The node is
 * read the way the inspector itself reads it: whatever is selected.
 */
function useInspectedBooster(provided?: ConveyorBoosterNode): ConveyorBoosterNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:conveyor-booster') {
    return null
  }
  return selected as unknown as ConveyorBoosterNode
}

export default function ConveyorBoosterPanel({ node: provided }: { node?: ConveyorBoosterNode }) {
  const node = useInspectedBooster(provided)
  const unit = useUnit()
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)

  if (!node) return null

  const issues = [
    ...(conveyorBoosterParametrics.invariants?.flatMap((check) => check(node)) ?? []),
    ...jointIssues(jointProblems(node, nodes, unit)),
  ]

  return (
    <ModuleReadout
      issues={issues}
      rows={[
        [
          'Bed',
          `${millimetreLabel(moduleLengthM(node), unit)} · ${node.rollers} rollers @ ${rollerPitchMm(node)} mm`,
        ],
        [
          'Range',
          `${(BST.lengthRangeM[0] * 1000).toFixed(0)}–${(BST.lengthRangeM[1] * 1000).toFixed(0)} mm for this type`,
        ],
        [
          'Frame',
          `${(frameWidthM(node) * 1000).toFixed(0)} mm over a ${usefulWidthMm(node)} mm lane — 67 mm, the tightest in the family`,
        ],
        ['Supports', `${supportOffsetsX(node).length} stations`],
        ['Speed', `${speedMPerMin(node)} m/min · ${speedMPerSec(node).toFixed(2)} m/s`],
        [
          'Shortest box',
          `${millimetreLabel(node.shortestBox, unit)} on ${rollersUnderShortestBox(node)} rollers · ≤ ${BST.loadKg} kg`,
        ],
        ['Line', describeLine(node, nodes, unit)],
      ]}
      title="This booster"
    >
      <Note>
        Bir hızlandırıcı yükü taşımaz, geçişini düzenler — çevrimin sıkılaşması gereken yere konur
        ve tahriki yatağın yanında değil altında yaşar; ailenin en dar kesiti bu yüzdendir. Boş bir
        ucun yarım metre yakınına sürükleyin, yapışır: baş uca kuyruk, eşleşen şerit, eşleşen kot.
      </Note>
    </ModuleReadout>
  )
}
