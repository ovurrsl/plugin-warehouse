/**
 * Kat çözümü — host asansör kind'ının davranışını AYNADAN yansıtır.
 *
 * Kaynak (IMPORT EDİLMEZ, yalnız referans): editör deposundaki
 * `packages/core/src/systems/elevator/elevator-service.ts`
 * (`resolveElevatorBuildingLevels`, `resolveElevatorServiceLevels`) ve
 * `services/storey.ts getLevelElevations`. Eklenti host şemasını yalnız
 * `host-adapter.ts` üzerinden okur; istifleme orada yerel olarak yeniden
 * yazıldı.
 *
 * ## Y'nin YENİDEN TABANLANMASI — sessiz tuzak
 *
 * Host, asansör grubunu KENDİ katının kotuna yerleştiriyor. Kat kotlarını
 * MUTLAK yayınlarsak (bina zemininden), asansörün kendi katı bir kez host
 * yerleşiminde bir kez de burada sayılır — çift sayım. Bu yüzden her `baseY`,
 * asansörün OTURDUĞU katın kotundan yeniden tabanlanıyor: alt servis katı 0
 * olur, üstündekiler ondan yükselir. Test bu tuzağı (mutlak-vs-göreli) tutuyor.
 */

import {
  asLevel,
  buildingOfLevel,
  levelElevationsOfBuilding,
  levelsOfBuilding,
  parentLevelIdOf,
} from '../host-adapter'
import { OVERTRAVEL_M } from './catalog'
import type { PalletLiftNode } from './schema'

export type LiftStop = {
  id: string
  /** Kat sıra numarasının string hâli — plan/etiket için. */
  label: string
  /** Asansörün kendi katına GÖRE kot, metre (kendi katı = 0). */
  baseY: number
}

/**
 * Servis edilen durakları çözer, host asansörünün yaptığı gibi.
 *
 * `fromLevelId`/`toLevelId` set edilmişse aralık indekslerine kelepçelenir
 * (min/max takası — `elevator-service.ts:70-71`); ikisi de null ise binanın
 * bütün istifi. İki kattan azı çözülürse (bina dışı / tek katlı) yedek iki
 * duraklı sentetik bir kuyu döner.
 */
export function resolveLiftLevels(
  nodes: Readonly<Record<string, unknown>>,
  lift: PalletLiftNode,
): LiftStop[] {
  const parentLevelId = parentLevelIdOf(nodes, lift)
  const buildingId = buildingOfLevel(nodes, parentLevelId)
  const entries = levelElevationsOfBuilding(nodes, buildingId)

  const fallbackTravel = lift.travelHeight ?? lift.fallbackTravelM ?? 3
  const fallback = (): LiftStop[] => [
    { id: '__base', baseY: 0, label: '0' },
    { id: '__top', baseY: fallbackTravel, label: '1' },
  ]

  if (entries.length < 2) return fallback()

  // Sıra numaraları — etiket için (levelElevationsOfBuilding yalnız kot veriyor).
  const ordinalOf = new Map(levelsOfBuilding(nodes, buildingId).map((l) => [l.id, l.level]))

  // Servis aralığı kelepçesi — host asansör deseni, min/max takasıyla.
  const fromLevelId = lift.fromLevelId ?? lift.baseLevelId ?? null
  const toLevelId = lift.toLevelId ?? lift.topLevelId ?? null
  let slice = entries
  if (fromLevelId !== null || toLevelId !== null) {
    const fromIndex = entries.findIndex((e) => e.id === fromLevelId)
    const toIndex = entries.findIndex((e) => e.id === toLevelId)
    const from = fromIndex >= 0 ? fromIndex : 0
    const to = toIndex >= 0 ? toIndex : entries.length - 1
    slice = entries.slice(Math.min(from, to), Math.max(from, to) + 1)
  }

  if (slice.length < 2) return fallback()

  // Asansörün oturduğu katın kotu — herkesi buna göre yeniden tabanla.
  const own = entries.find((e) => e.id === parentLevelId)
  const ownBaseY = own?.baseY ?? slice[0]?.baseY ?? 0

  return slice.map((entry) => ({
    id: entry.id,
    label: String(ordinalOf.get(entry.id) ?? 0),
    baseY: entry.baseY - ownBaseY,
  }))
}

/** Çözülmüş asansör — duraklar, mast yüksekliği ve geometri önbelleği için
 *  durak parmak izi bir arada. Renderer bunu tek çağrıda kurar. */
export type ResolvedLift = {
  stops: LiftStop[]
  mastHeight: number
  /** Yeniden tabanlanmış kotların + mast yüksekliğinin mm hassasiyetli izi —
   *  statik geometri anahtarına giren tek "kat" bilgisi. */
  fingerprint: string
}

/** Durakları, mast yüksekliğini ve önbellek parmak izini tek çağrıda çözer. */
export function resolveLift(
  nodes: Readonly<Record<string, unknown>>,
  lift: PalletLiftNode,
): ResolvedLift {
  const stops = resolveLiftLevels(nodes, lift)
  const rise = (stops[stops.length - 1]?.baseY ?? 0) - (stops[0]?.baseY ?? 0)
  const mastHeight = rise + OVERTRAVEL_M
  const fingerprint = `${stops.map((s) => Math.round(s.baseY * 1000)).join(',')}|${Math.round(mastHeight * 1000)}`
  return { stops, mastHeight, fingerprint }
}

/**
 * PROJECT.md sözleşmesi arayüzü:
 * Asansör duraklarını, kuyu tabanı/tepesini, toplam mast yüksekliğini ve
 * servis edilen katları çözer.
 */
export function resolvePalletLiftLevels(
  node: PalletLiftNode,
  nodes: Readonly<Record<string, unknown>>,
): {
  baseY: number
  topY: number
  totalHeight: number
  servedLevels: Array<{ id: string; name: string; elevation: number }>
} {
  const resolved = resolveLift(nodes, node)
  const stops = resolved.stops
  const firstStop = stops[0]
  const lastStop = stops[stops.length - 1]
  const baseY = firstStop?.baseY ?? 0
  const topY = lastStop?.baseY ?? node.travelHeight ?? node.fallbackTravelM ?? 3
  const totalHeight = resolved.mastHeight

  const servedLevels = stops.map((stop) => {
    const levelNode = asLevel(nodes[stop.id])
    return {
      id: stop.id,
      name: levelNode?.name ?? `Level ${stop.label}`,
      elevation: stop.baseY,
    }
  })

  return {
    baseY,
    topY,
    totalHeight,
    servedLevels,
  }
}

/**
 * Kuyunun dikey aralığı — kat döşemelerini delmek için, asansörün kendi katına
 * göre. Gerçek kat çözülemediğinde `null`.
 *
 * `resolveLiftLevels` iki kattan azı çözülünce SENTETİK bir yedek duraklar
 * çifti döner (`fallbackTravelM` kadar bir kuyu). O yedek çizimi ayakta tutmak
 * içindir; DELİK açmak için değil. Bina dışına konmuş ya da tek kata
 * kelepçelenmiş bir asansör, altından geçmediği döşemeleri kesmemeli — sentetik
 * duraklar gerçek bir kata karşılık gelmediği için burada `null` dönüyor.
 */
export function liftOpeningSpan(
  nodes: Readonly<Record<string, unknown>>,
  lift: PalletLiftNode,
): { bottom: number; top: number } | null {
  const stops = resolveLiftLevels(nodes, lift)
  if (stops.length < 2) return null
  const bottom = stops[0]!
  const top = stops[stops.length - 1]!
  // Sentetik yedek: kimlikler hiçbir gerçek kata çözülmez.
  if (!asLevel(nodes[bottom.id]) || !asLevel(nodes[top.id])) return null
  return { bottom: bottom.baseY, top: top.baseY }
}

/** En üst ile en alt servis durağı arası kot farkı, metre. */
export function riseM(nodes: Readonly<Record<string, unknown>>, lift: PalletLiftNode): number {
  const stops = resolveLiftLevels(nodes, lift)
  if (stops.length === 0) return 0
  const top = stops[stops.length - 1]?.baseY ?? 0
  const bottom = stops[0]?.baseY ?? 0
  return top - bottom
}

/** Mast yüksekliği = seyahat + aşırı seyahat payı (spec §3), metre. */
export function mastHeightM(
  nodes: Readonly<Record<string, unknown>>,
  lift: PalletLiftNode,
): number {
  return riseM(nodes, lift) + OVERTRAVEL_M
}

/**
 * Bina katlarının parmak izi — renderer bunu bir `useScene` seçicisinde okuyup
 * kat yüksekliği değişince yeniden çözüm/yeni statik anahtar üretir.
 *
 * `buildingId|id:ordinal:height:baseElevation|...` — bir kat yüksekliği ya da
 * kotu değişince dizge değişir, yani host-reaktivite mekanizması.
 */
export function liftLevelFingerprint(
  nodes: Readonly<Record<string, unknown>>,
  lift: PalletLiftNode,
): string {
  const parentLevelId = parentLevelIdOf(nodes, lift)
  const buildingId = buildingOfLevel(nodes, parentLevelId)
  const levels = levelsOfBuilding(nodes, buildingId)
  const parts = levels.map((l) => `${l.id}:${l.level}:${l.height ?? ''}:${l.baseElevation ?? ''}`)
  return [
    buildingId ?? '-',
    parentLevelId ?? '-',
    lift.fromLevelId ?? lift.baseLevelId ?? '-',
    lift.toLevelId ?? lift.topLevelId ?? '-',
    lift.travelHeight ?? lift.fallbackTravelM ?? 3,
    lift.defaultLevelId ?? '-',
    (lift.disabledLevelIds ?? []).join(','),
    (lift.serviceOnlyLevelIds ?? []).join(','),
    ...parts,
  ].join('|')
}
