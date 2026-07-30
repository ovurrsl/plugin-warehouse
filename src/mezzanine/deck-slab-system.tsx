'use client'

import { type AnyNode, type AnyNodeId, getFloorPlacedElevation, useScene } from '@pascal-app/core'
import { useEffect } from 'react'
import {
  DECK_OWNER_KEY,
  type DeckSlabSpec,
  deckOwnerOf,
  deckSlabSpecs,
  GROUND_SUPPORT_ID,
} from './deck-slabs'
import type { MezzanineNode } from './schema'

/**
 * Mezzanine güvertelerini host `slab` düğümleriyle uzlaştıran sistem.
 *
 * Gerekçenin tamamı `deck-slabs.ts`'in başında. Burada yalnız yaşam
 * döngüsü var: yarat / güncelle / sil.
 *
 * ## Görünmez, ama taşır
 *
 * Slab `visible: false` ile yayınlanıyor. Güverteyi mezzanine ZATEN kendisi
 * çiziyor (`parts.ts` `pushFloorPanels`, döşeme tipine göre kalınlık ve
 * merdiven boşluğu dışlamasıyla); slab da çizseydi iki yüzey üst üste biner
 * ve z-fighting olurdu. Görünmezlik seçimi etkilemez: ne
 * `spatial-grid-sync` ne `spatialGridManager` `visible` alanına bakar,
 * `getPointedSupportSurface` saf poligon matematiğidir.
 *
 * ## Döngü emniyeti
 *
 * Bu sistem store'a yazar ve store'un `nodes`'u bu efektin bağımlılığıdır.
 * Sonsuz döngüyü engelleyen tek şey, İSTENEN durumun mezzanine'lerden
 * deterministik türetilmesi ve yalnız GERÇEK bir fark varken yazılması:
 * ikinci geçiş fark bulamaz, yazmaz, döngü kapanır. Karşılaştırmayı
 * gevşetmek (örneğin poligonu hiç kıyaslamamak) bu emniyeti bozar.
 *
 * Sürükleme sırasında hiç çalışmaz — sürükleme store'a dokunmaz, güverteler
 * bırakma anında yeniden uzlaşır.
 */

/** Kayan nokta kıyası için tolerans — metre. */
const EPSILON = 1e-6

type NodeLike = {
  id: string
  type?: string
  parentId?: string | null
  metadata?: Record<string, unknown>
}

function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON
}

function samePolygon(a: readonly [number, number][], b: readonly [number, number][]): boolean {
  if (a.length !== b.length) return false
  return a.every((point, i) => {
    const other = b[i]
    return other !== undefined && sameNumber(point[0], other[0]) && sameNumber(point[1], other[1])
  })
}

function sameHoles(
  a: readonly (readonly [number, number][])[],
  b: readonly (readonly [number, number][])[],
): boolean {
  if (a.length !== b.length) return false
  return a.every((hole, i) => {
    const other = b[i]
    return other !== undefined && samePolygon(hole, other)
  })
}

/** Var olan slab spec'i karşılıyor mu — hiçbir fark yoksa yazma. */
function matches(existing: unknown, spec: DeckSlabSpec): boolean {
  const slab = existing as {
    polygon?: [number, number][]
    holes?: [number, number][][]
    elevation?: number
    thickness?: number
  }
  return (
    sameNumber(slab.elevation ?? 0, spec.elevation) &&
    sameNumber(slab.thickness ?? 0, spec.thickness) &&
    samePolygon(slab.polygon ?? [], spec.polygon) &&
    sameHoles(slab.holes ?? [], spec.holes)
  )
}

/** Bir düğümün ait olduğu kat — ata zincirini yürüyerek. */
function levelIdOf(node: NodeLike, nodes: Readonly<Record<string, unknown>>): string | null {
  let current: NodeLike | undefined = node
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    if (current.type === 'level') return current.id
    seen.add(current.id)
    current = current.parentId ? (nodes[current.parentId] as NodeLike | undefined) : undefined
  }
  return null
}

export type DeckSlabPlan = {
  creates: { node: unknown; parentId: string }[]
  updates: { id: string; data: Record<string, unknown> }[]
  deletes: string[]
}

/**
 * İstenen güverte kümesi ile mevcut olanı karşılaştır.
 *
 * Saf ve dışa açık — testler store kurmadan planı doğrulayabilsin diye.
 */
export function planDeckSlabs(nodes: Readonly<Record<string, unknown>>): DeckSlabPlan {
  const plan: DeckSlabPlan = { creates: [], updates: [], deletes: [] }

  const desired = new Map<string, { spec: DeckSlabSpec; levelId: string; mezzanineId: string }>()

  for (const candidate of Object.values(nodes)) {
    const node = candidate as NodeLike
    if (node?.type !== 'warehouse:mezzanine') continue
    const mezzanine = candidate as MezzanineNode
    const levelId = levelIdOf(node, nodes)
    if (!levelId) continue

    /**
     * İkinci emniyet katmanı: mezzanine KENDİ güvertesine tutunamaz.
     *
     * Yerleştirme aracı zaten zemine çiviliyor, ama taşıma sürüklemesi
     * kalıcı sahibi atlar (`maxElevation` verildiğinde imleç karar verir)
     * ve bırakma anında kendi eski güvertesini sahip olarak yazabilir.
     * Kural dar tutuldu — yalnız KENDİ güvertesi reddediliyor; BAŞKA bir
     * mezzanine'in güvertesinde durmak tamamen meşru.
     */
    const rawSupport = mezzanine.supportSlabId ?? null
    const selfHosted =
      rawSupport !== null && deckOwnerOf(nodes[rawSupport])?.mezzanineId === node.id
    if (selfHosted) {
      plan.updates.push({ id: node.id, data: { supportSlabId: GROUND_SUPPORT_ID } })
    }

    // Mezzanine'in kendi tabanının kat-yerel kotu. Host hesaplar, biz
    // sormakla yetiniriz — arazi biçimlendirilmişse düz zemin varsaymak
    // güverteyi zeminin altına ya da üstüne kaydırırdı.
    const base = getFloorPlacedElevation({
      node: (selfHosted
        ? { ...(candidate as object), supportSlabId: GROUND_SUPPORT_ID }
        : candidate) as AnyNode,
      nodes: nodes as Record<string, AnyNode>,
      position: mezzanine.position ?? [0, 0, 0],
      rotation: mezzanine.rotation,
      levelId,
    })

    for (const spec of deckSlabSpecs(mezzanine, base)) {
      desired.set(spec.id, { spec, levelId, mezzanineId: mezzanine.id })
    }
  }

  for (const [id, candidate] of Object.entries(nodes)) {
    if (!deckOwnerOf(candidate)) continue
    const target = desired.get(id)
    if (!target) {
      // Sahibi silinmiş ya da o tier artık yok.
      plan.deletes.push(id)
      continue
    }
    if (!matches(candidate, target.spec)) {
      plan.updates.push({
        id,
        data: {
          polygon: target.spec.polygon,
          holes: target.spec.holes,
          elevation: target.spec.elevation,
          thickness: target.spec.thickness,
        },
      })
    }
    desired.delete(id)
  }

  for (const [id, { spec, levelId, mezzanineId }] of desired) {
    plan.creates.push({
      node: {
        object: 'node',
        id,
        type: 'slab',
        parentId: levelId,
        name: `Mezzanine deck ${spec.tierIndex + 1}`,
        // Görünmez: güverteyi mezzanine'in kendi geometrisi çiziyor.
        visible: false,
        polygon: spec.polygon,
        holes: spec.holes,
        holeMetadata: [],
        elevation: spec.elevation,
        thickness: spec.thickness,
        recessed: false,
        autoFromWalls: false,
        metadata: {
          [DECK_OWNER_KEY]: { mezzanineId, tierIndex: spec.tierIndex },
        },
      },
      parentId: levelId,
    })
  }

  return plan
}

export default function MezzanineDeckSlabSystem() {
  const nodes = useScene((s) => s.nodes as Readonly<Record<string, unknown>>)

  useEffect(() => {
    const plan = planDeckSlabs(nodes)
    if (!plan.creates.length && !plan.updates.length && !plan.deletes.length) return

    const store = useScene.getState()
    if (plan.deletes.length) store.deleteNodes(plan.deletes as AnyNodeId[])
    if (plan.updates.length) {
      store.updateNodes(
        plan.updates.map((entry) => ({
          id: entry.id as AnyNodeId,
          data: entry.data as Partial<AnyNode>,
        })),
      )
    }
    if (plan.creates.length) {
      store.createNodes(
        plan.creates.map((entry) => ({
          node: entry.node as AnyNode,
          parentId: entry.parentId as AnyNodeId,
        })),
      )
    }
  }, [nodes])

  return null
}
