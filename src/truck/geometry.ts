/**
 * Araç geometri havuzu — gövde başına bir birleşik buffer, sahne genelinde
 * paylaşımlı.
 *
 * `emitPart` / `finish` / `toLinear` conveyor'den İTHAL edilir, kopyalanmaz
 * (§3.3): dört attribute'u da (`position/normal/color/uv`) tek emitter yazar,
 * ikinci bir builder yoktur — attribute paritesi disiplin değil, yapıdır.
 * Pallet'in kıl payı kurtardığı hata burada mümkün değildir: uzak katman
 * materyali YOKTUR ve stok `BoxGeometry` YOKTUR.
 *
 * Havuz kendi sınırını taşır (`CACHE_LIMIT = 96`), conveyor'ünkini paylaşmaz:
 * paylaşmak iki kind'ı birbirinin tavanına bağlar ve birinin limitini
 * değiştirmek öbürünü de değiştirir. `evict` semantiği conveyor'den birebir —
 * o kare inşa edilen giriş asla tahliye adayı değildir, çünkü retain effect'i
 * render'dan SONRA koşar ve aradaki pencerede girişi korumasız bırakır.
 *
 * Tavan aşıldığında tahliye tutulan girişleri serbest bırakamaz ve bellek
 * büyür — yanlış buffer dönmez, araç boşalmaz. Sahip olunması gereken onurlu
 * bozulma budur.
 */

import type * as THREE from 'three'
import { emitPart, finish, type Sink, toLinear } from '../conveyor/geometry-builder'
import type { MastRow } from '../handling/masts'
import type { TruckModel, TruckModelId } from '../handling/models'
import { emitCylinder, emitSlopedBox } from './emitters'
import { forkSpreadM, mastRowOf, modelOf } from './metrics'
import { partColorOf, type TruckBody, type TruckDetail, truckParts } from './parts'

/**
 * Bir gövde şeklinin kimliği.
 *
 * Anahtarda KASTEN olmayanlar: id, isim, pozisyon, rotasyon, `forkHeight`,
 * eğim, swivel, reach stroku. Hepsi matristir, hiçbiri vertex değildir —
 * poz asla cache anahtarına girmez, yoksa bir kot sürüklemesi her adımda
 * bir daha çizilmeyecek bir buffer basar.
 */
export function truckGeometryKey(
  modelId: TruckModelId,
  mastRowId: string | null,
  body: TruckBody,
  detail: TruckDetail,
): string {
  const model = modelOf(modelId)
  return [
    modelId,
    mastRowId ?? '-',
    body,
    detail,
    model.fork.length.toFixed(4),
    forkSpreadM(model).toFixed(4),
  ].join('|')
}

const cache = new Map<string, THREE.BufferGeometry>()
const retained = new Map<string, number>()

const CACHE_LIMIT = 96

function buildBody(
  model: TruckModel,
  mastRow: MastRow | null,
  body: TruckBody,
  detail: TruckDetail,
): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  for (const part of truckParts(model, mastRow, body, detail)) {
    const color = toLinear(partColorOf(model.variant, part.role))
    if (part.kind === 'cyl') emitCylinder(sink, part, color)
    else if (part.kind === 'sloped') emitSlopedBox(sink, part, color)
    else emitPart(sink, part, color, 0)
  }
  return finish(sink)
}

export function getTruckGeometry(
  modelId: TruckModelId,
  mastRowId: string | null,
  body: TruckBody,
  detail: TruckDetail,
): THREE.BufferGeometry {
  const key = truckGeometryKey(modelId, mastRowId, body, detail)
  const cached = cache.get(key)
  if (cached) return cached
  const geometry = buildBody(modelOf(modelId), mastRowOf(mastRowId), body, detail)
  cache.set(key, geometry)
  evict(key)
  return geometry
}

function evict(justBuilt: string): void {
  if (cache.size <= CACHE_LIMIT) return
  for (const [key, geometry] of cache) {
    if (cache.size <= CACHE_LIMIT) return
    if (key === justBuilt) continue
    if ((retained.get(key) ?? 0) > 0) continue
    cache.delete(key)
    geometry.dispose()
  }
}

/** Mount edilen her araç, her gövdesinin İKİ katmanını da tutar — tahliye
 *  çizilmekte olanı asla boşaltamaz ve katman geçişi inşa beklemez. */
export function retainTruckGeometry(
  modelId: TruckModelId,
  mastRowId: string | null,
  body: TruckBody,
  detail: TruckDetail,
): string {
  const key = truckGeometryKey(modelId, mastRowId, body, detail)
  retained.set(key, (retained.get(key) ?? 0) + 1)
  return key
}

export function releaseTruckGeometry(key: string): void {
  const count = (retained.get(key) ?? 0) - 1
  if (count > 0) retained.set(key, count)
  else retained.delete(key)
}

/** Test ve teşhis kancası — paylaşımın gerçekten olduğunun tek kanıtı. */
export function truckGeometryCacheSize(): number {
  return cache.size
}

export function clearTruckGeometryCache(): void {
  for (const geometry of new Set(cache.values())) geometry.dispose()
  cache.clear()
  retained.clear()
}
