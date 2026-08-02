'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { PanelSection } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { IssueList } from '../panels/issue-list'
import { Figures, Note } from '../panels/kit'
import {
  bayPitch,
  fittedLevels,
  hangingLengthM,
  levelElevation,
  levelNeedsZtam,
  shelfAreaM2,
  usesMsCentreBeam,
} from './levels'
import { longspanParametrics } from './parametrics'
import type { LongspanNode } from './schema'
import { BEAM_PROFILES, nearestBayLength, SHELF_KINDS, UPRIGHT_PROFILES } from './standards'

/**
 * What the bay offers, and where each figure comes from.
 *
 * The provenance column is the point of the second section. Half of what this
 * kind knows is printed in the catalogue and half is corroborated from a
 * reseller or chosen by us — and a user reading "22 mm chipboard" off a panel
 * deserves to know which of those it is before ordering against it.
 */

function useInspected(provided?: LongspanNode): LongspanNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:longspan') return null
  return selected as unknown as LongspanNode
}

export default function LongspanPanel({ node: provided }: { node?: LongspanNode }) {
  const node = useInspected(provided)
  if (!node) return null

  const issues = longspanParametrics.invariants?.flatMap((check) => check(node)) ?? []
  const levels = fittedLevels(node)
  const upright = UPRIGHT_PROFILES[node.uprightProfile]
  const beam = BEAM_PROFILES[node.beamProfile]
  const nearest = nearestBayLength(node.bayLength)
  const ztamLevels = levels.filter((level) => levelNeedsZtam(node, level)).length
  const msLevels = levels.filter((level) => usesMsCentreBeam(node, level)).length

  return (
    <>
      <IssueList issues={issues} />

      <PanelSection title="Bu göz">
        <Figures
          rows={[
            ['Kat', `${levels.length}`],
            ['Raf alanı', `${shelfAreaM2(node).toFixed(2)} m²`],
            hangingLengthM(node) > 0 && ['Askı boyu', `${hangingLengthM(node).toFixed(2)} m`],
            ['Göz adımı', `${bayPitch(node).toFixed(3)} m`],
            [
              'Katalog boyu',
              Math.abs(nearest - node.bayLength) < 1e-6
                ? `${(nearest * 1000).toFixed(0)} mm — seride`
                : `en yakın ${(nearest * 1000).toFixed(0)} mm`,
            ],
          ]}
        />
        <Note>
          Bir sıra, bu düğümlerden oluşur ve yan yana gözler çerçeve PAYLAŞIR: N göz N+1 çerçevede
          durur. Sürüklerken mıknatıs yarım metre içinde tam göz adımına yapıştırır.
        </Note>
      </PanelSection>

      <PanelSection title="Katlar">
        <Figures
          rows={levels.map(
            (level, index) =>
              [
                `#${index + 1} · ${levelElevation(level).toFixed(3)} m`,
                level.structure === 'beam-only'
                  ? 'yalnız kiriş'
                  : level.structure === 'hanging'
                    ? 'askılı'
                    : `${SHELF_KINDS[level.shelfKind].label}${level.panels > 1 ? ` × ${level.panels}` : ''}`,
              ] as const,
          )}
        />
        {ztamLevels > 0 && (
          <Note>
            {ztamLevels} katta Z-TAM kelepçesi var — 1.9 m ve üstü sunta rafın katalog kuralı,
            alandan değil boydan türetiliyor.
          </Note>
        )}
        {msLevels > 0 && (
          <Note>
            {msLevels} katta ortada MS-65 kirişi var: çift derinlikli sunta rafın iki levhası onun
            düz üstünde birleşir (KATALOG).
          </Note>
        )}
      </PanelSection>

      <PanelSection defaultExpanded={false} title="Kaynak ve güvenilirlik">
        {/*
          Bu bölüm bu kind'a özgü ve bilerek var: M7 verisinin yarısı katalogda
          basılı, yarısı bayiden doğrulanmış ya da bizim seçtiğimiz. Panelden
          "22 mm sunta" okuyan biri, sipariş vermeden önce hangisi olduğunu
          bilmeyi hak ediyor.
        */}
        <Figures
          rows={[
            [`Dikme ${upright.label}`, upright.provenance],
            [`Kiriş ${beam.label}`, beam.provenance],
            [
              `Raf ${SHELF_KINDS[levels[0]?.shelfKind ?? 'chipboard'].label}`,
              SHELF_KINDS[levels[0]?.shelfKind ?? 'chipboard'].provenance,
            ],
            ['Yuva aralığı 50 / 25 mm', 'CATALOG'],
            ['Kiriş kesiti 30 mm', 'RESEARCHED'],
          ]}
        />
        <Note>
          CATALOG = Mecalux M7 kataloğunda basılı. RESEARCHED = adlı bayiden ya da ABD Wide Span
          eşdeğerinden metriğe çevrilerek doğrulandı. ASSUMPTION = bizim seçimimiz; kodda gerekçesi
          yazılı.
        </Note>
        <Note>{upright.note ?? 'Kesit katalogda basılı.'}</Note>
      </PanelSection>
    </>
  )
}
