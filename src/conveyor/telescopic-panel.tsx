'use client'

import { type AnyNodeId, type Issue, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Note } from '../panels/kit'
import { ModuleReadout } from './module-panel'
import { jointProblems, mateBlockers } from './port-magnet'
import { TELESCOPIC_MODELS, TELESCOPIC_UNPUBLISHED_NOTE } from './telescopic-catalog'
import { currentLengthM } from './telescopic-metrics'
import { conveyorTelescopicParametrics } from './telescopic-parametrics'
import type { ConveyorTelescopicNode } from './telescopic-schema'

/**
 * Teleskopik konveyörün okuma paneli: katalog satırı olduğu gibi, anlık
 * zemin kaplaması, ve yayınlanmamışların kaydı KELİMESİ KELİMESİNE.
 *
 * Hüküm yok. Tabloda hız/kapasite/güç olmadığı için panel bunu söyler ve
 * animasyonun bir TAHMİNLE sürüldüğünü aynı cümlede belirtir — kullanıcı
 * ekranda hareket eden bir kutuyu ölçüm sanmasın.
 */

/** Host `trailingSection`'a `node` prop'u geçmiyor — seçimden çözülür. */
function useInspected(provided?: ConveyorTelescopicNode): ConveyorTelescopicNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:conveyor-telescopic') {
    return null
  }
  return selected as unknown as ConveyorTelescopicNode
}

export default function TelescopicPanel({ node: provided }: { node?: ConveyorTelescopicNode }) {
  const node = useInspected(provided)
  // Kancalar koşulsuz çağrılmalı; erken çıkış aşağıda.
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)
  if (!node) return null

  const model = TELESCOPIC_MODELS[node.model]
  const invariantIssues =
    conveyorTelescopicParametrics.invariants?.flatMap((check) => check(node)) ?? []

  /**
   * Neden yapışmadığı — ve neyi düzeltmesi gerektiği.
   *
   * Mıknatıs kuralı çiğneyen bir uca hiç yaklaşmıyor, yani kullanıcıya geri
   * bildirim SESSİZLİK oluyordu. Teleskopikte bu neredeyse kesin: bant
   * genişliği varsayılanı 800 mm (roller ailesi 600), kot ise modele gömülü
   * ve ayarlanamaz. Panel hangi değerin tutmadığını yazıyor; düzeltmeyi
   * kullanıcı yapıyor — burada hiçbir şey kendiliğinden değişmiyor.
   */
  const joint = jointProblems(node, nodes)
  const blockers = mateBlockers(node, node.position ?? [0, 0, 0], node.rotation?.[1] ?? 0, nodes)
  const issues = [
    ...invariantIssues,
    ...[...joint, ...blockers].map(
      (msg): Issue => ({ field: 'position', severity: 'warning', msg }),
    ),
  ]

  return (
    <ModuleReadout
      issues={issues}
      rows={[
        ['Model', model.label],
        ['Sabit gövde · A', `${model.fixedM.toFixed(2)} m`],
        ['Uzama · B', `${model.extensionM.toFixed(2)} m`],
        ['Tam açık · C', `${model.totalM.toFixed(2)} m`],
        ['Şu anki uzunluk', `${currentLengthM(node).toFixed(2)} m`],
        ['Bölüm · bant kotu', `${model.sections} · ${model.heightM.toFixed(2)} m`],
      ]}
      title="Bu teleskopik"
    >
      <Note>
        SZ-Apollo A-serisi teleskopik bant konveyör tablosu, "Fixed Type" — bant kotu modelin
        kendisidir, ayarlanmaz.
      </Note>
      <Note>{TELESCOPIC_UNPUBLISHED_NOTE}</Note>
    </ModuleReadout>
  )
}
