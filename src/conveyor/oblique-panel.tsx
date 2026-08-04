'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Note } from '../panels/kit'
import { millimetreLabel, useUnit } from '../units'
import { OBQ } from './catalog'
import { describeLine } from './conveyor-panel'
import { jointIssues, ModuleReadout } from './module-panel'
import {
  angleDeg,
  branchBoxWidthM,
  branchLengthM,
  divergeXM,
  mainLaneMm,
  mainWidthM,
  moduleLengthM,
  rollerPitchMm,
  speedMPerMin,
  speedMPerSec,
} from './oblique-metrics'
import { conveyorObliqueParametrics } from './oblique-parametrics'
import type { ConveyorObliqueNode } from './oblique-schema'
import { jointProblems } from './port-magnet'

/**
 * What the machine is, and where its branch actually leaves.
 *
 * Mounted as `parametrics.trailingSection`, under the module's own fields rather
 * than instead of them.
 *
 * It renders the descriptor's **invariants**, which nothing else does — the host
 * declares `parametrics.invariants` in its registry types and reads it nowhere.
 */

function useInspectedOblique(provided?: ConveyorObliqueNode): ConveyorObliqueNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:conveyor-oblique') {
    return null
  }
  return selected as unknown as ConveyorObliqueNode
}

export default function ConveyorObliquePanel({ node: provided }: { node?: ConveyorObliqueNode }) {
  const node = useInspectedOblique(provided)
  const unit = useUnit()
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)

  if (!node) return null

  const issues = [
    ...(conveyorObliqueParametrics.invariants?.flatMap((check) => check(node)) ?? []),
    ...jointIssues(jointProblems(node, nodes, unit)),
  ]

  return (
    <ModuleReadout
      issues={issues}
      rows={[
        [
          'Body',
          `${(moduleLengthM(node) * 1000).toFixed(0)} mm fixed · rollers @ ${rollerPitchMm(node)} mm`,
        ],
        // The two lanes, side by side, because the narrower one is what a box
        // crossing this module actually has to fit.
        [
          'Lanes',
          `${mainLaneMm(node)} mm main · ${(branchBoxWidthM(node) * 1000).toFixed(0)} mm branch`,
        ],
        [
          'Branch',
          `${angleDeg(node)}° ${node.branchSide} · ${node.branchMode} · ${millimetreLabel(branchLengthM(node), unit)} of bed`,
        ],
        // Derived, and nothing else on screen says it.
        [
          'Splits at',
          `${millimetreLabel(divergeXM(node), unit)} from the middle — set by the angle`,
        ],
        ['Speed', `${speedMPerMin(node)} m/min · ${speedMPerSec(node).toFixed(2)} m/s`],
        [
          'Rated',
          `≤ ${OBQ.loadKg} kg per box · ${(mainWidthM(node) * 1000).toFixed(0)} mm main frame`,
        ],
        ['Line', describeLine(node, nodes, unit)],
      ]}
      title="This branch"
    >
      <Note>
        Bir fırlatıcının ya da karma transferin aksine bu modül kutuyu <strong>döndürmez</strong> —
        bir dal, kutunun hangi hatta olduğunu değiştirir, nasıl baktığını değil; bir sonraki bölümün
        kutu-boyu sınırları hâlâ bir öncekinden türer. Dal portu, mod daraltmadıkça iki yönde de
        eklem kabul eder.
      </Note>
      {node.branchMode !== 'merge' && (
        <Note>
          Ayırıcı bir dalın arkasında bir karar gerekir — kutunun hangi yöne gideceğini seçen bir
          barkod okuması. Bu pakette henüz onun için bir nesne yok, o yüzden plan sembolü boşluğu
          sessiz bırakmak yerine nerede durması gerektiğini işaretliyor.
        </Note>
      )}
    </ModuleReadout>
  )
}
