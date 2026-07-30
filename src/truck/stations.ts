/**
 * İstasyonlar — bir aracın rotasından erişebildiği raf yuvaları.
 *
 * Saf: three yok, React yok, store yazımı yok. Sahneyi YALNIZ okur.
 *
 * Beş adım, hepsi plan §5.5'ten ve her biri mevcut bir indeksten besleniyor
 * (ikinci bir indeks kurmak `slot-placement.ts`'in var oluş gerekçesini
 * bozardı — "bin raf × on bin düğüm"):
 *
 *   1. Rotanın yakınındaki rafları MEVCUT memoize indeksten al.
 *   2. Koridor yüzü rotaya bakanları seç.
 *   3. `palletSlotsOf` → yalnız `directAccess` (çift derin bayın arka
 *      pozisyonu önündekini taşımayı gerektirir, onu simüle etmiyoruz).
 *   4. `occupiedSlots` ile kaynak (dolu) / hedef (boş) ayır.
 *   5. Eşlemeyi araç kimliğinden DETERMİNİSTİK üret — sahne dosyasının bir
 *      fonksiyonudur: yeniden yükleme, export ve undo aynı çevrimi verir.
 */

import type { TruckModel } from '../handling/models'
import { racksNear } from '../pallet/slot-placement'
import { occupiedSlots, slotDraw } from '../rack/occupancy'
import type { PalletRackNode } from '../rack/schema'
import { palletSlotsOf, type Slot } from '../rack/slots'
import { type SlotReading, truckSlotReading } from './reach-rules'
import type { RouteTrack } from './route-index'
import { sampleTrack } from './route-index'

/** Rotanın merkez hattından bir rafın erişilebilir sayıldığı en uzak mesafe. */
export const STATION_REACH_M = 4.5

export type Station = {
  rackId: string
  /** Rafın dünya konumu ve plan dönüşü — aracın duracağı yeri verir. */
  rackX: number
  rackZ: number
  rackRotationY: number
  slot: Slot
  /** Gerçek bir palet düğümü duruyor mu — kaynak olabilmenin şartı. */
  occupied: boolean
  /**
   * Yuva HAYALET stok gösteriyor mu.
   *
   * Hayalet gerçek bir düğüm değildir (taşınamaz), ama ekranda dolu bir
   * yuvadır — hedef seçilirse araç gerçek paleti hayaletin üstüne bırakır
   * ve kullanıcı tek yuvada iki palet görür. Bu yüzden hayaletli yuva ne
   * kaynaktır (taşınacak düğüm yok) ne hedeftir (yeri dolu görünüyor).
   */
  ghosted: boolean
  /** Aracın bu yuvaya park edeceği yay parametresi, metre. */
  s: number
  reading: SlotReading
}

/** FNV-1a — `occupancy.slotDraw` ve `pallet/renderer.hashPhase` ile aynı. */
function hash(value: string): number {
  let h = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    h ^= value.charCodeAt(index)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Rotanın hangi yay parametresinde bir noktaya en yakın olduğu.
 *
 * Yarım metrelik adımlarla; bir aracın raf önünde duracağı yer için
 * milimetrik hassasiyet gerekmiyor ve bu fonksiyon istasyon başına bir kez,
 * filo kurulurken koşuyor.
 */
function nearestS(track: RouteTrack, x: number, z: number): number {
  let bestS = 0
  let best = Number.POSITIVE_INFINITY
  const steps = Math.max(2, Math.ceil(track.lengthM / 0.5))
  for (let i = 0; i <= steps; i++) {
    const s = (i / steps) * track.lengthM
    const sample = sampleTrack(track, s)
    const d = Math.hypot(sample.x - x, sample.z - z)
    if (d < best) {
      best = d
      bestS = s
    }
  }
  return bestS
}

/** Yuvanın dünya konumu — rafın yerel çerçevesinden döndürülerek. */
function slotWorld(
  rack: { x: number; z: number; rotationY: number },
  slot: Slot,
): { x: number; z: number } {
  const [lx, , lz] = slot.localPosition
  const cos = Math.cos(rack.rotationY)
  const sin = Math.sin(rack.rotationY)
  // three'nin +Y dönüşü: (x, z) → (x·cos + z·sin, −x·sin + z·cos).
  return { x: rack.x + lx * cos + lz * sin, z: rack.z - lx * sin + lz * cos }
}

/**
 * Aracın rotası boyunca erişebildiği istasyonlar.
 *
 * Sonuç yay parametresine göre sıralı — araç rotayı sürerken istasyonları
 * geldikleri sırada görür ve ileri geri zıplamaz.
 */
export function stationsAlong(
  nodes: Readonly<Record<string, unknown>>,
  track: RouteTrack,
  model: TruckModel,
): Station[] {
  const stations: Station[] = []
  // Rotanın birkaç noktasından tarayıp rafları birleştir: `racksNear` zaten
  // memoize indeksten okuyor, tekrar tarama maliyeti yok.
  const seen = new Set<string>()
  const probes = Math.max(2, Math.ceil(track.lengthM / STATION_REACH_M))
  for (let i = 0; i <= probes; i++) {
    const sample = sampleTrack(track, (i / probes) * track.lengthM)
    for (const near of racksNear(nodes, sample.x, sample.z, STATION_REACH_M)) {
      if (seen.has(near.id)) continue
      if ((near.parentId ?? null) !== track.parentId) continue
      seen.add(near.id)
      collectRack(nodes, track, model, near, stations)
    }
  }
  return stations.sort((a, b) => a.s - b.s)
}

function collectRack(
  nodes: Readonly<Record<string, unknown>>,
  track: RouteTrack,
  model: TruckModel,
  near: { id: string; rack: PalletRackNode; x: number; z: number; rotationY: number },
  out: Station[],
): void {
  const occupied = occupiedSlots(nodes, near.id)
  for (const slot of palletSlotsOf(near.rack)) {
    // Çift derin bayın arka pozisyonu önündekini taşımayı gerektirir ve
    // bunu simüle etmiyoruz — erişilemez yuva istasyon değildir.
    if (!slot.directAccess) continue
    const world = slotWorld(near, slot)
    const s = nearestS(track, world.x, world.z)
    const sample = sampleTrack(track, s)
    const distance = Math.hypot(sample.x - world.x, sample.z - world.z)
    if (distance > STATION_REACH_M) continue
    const reading = truckSlotReading(model, slot)
    // Yayınlanmış veriden çıkan SERT olgu: yuva yüzeyi aracın kaldırma
    // tavanının üstündeyse o yuvaya hizmet edilemez. Transpaletin 0.12 m
    // stroku hiçbir raf katına yetmez ve bu bir hüküm değil, ölçüdür.
    if (!reading.reachable) continue
    const isOccupied = occupied.has(slot.id)
    out.push({
      rackId: near.id,
      rackX: near.x,
      rackZ: near.z,
      rackRotationY: near.rotationY,
      slot,
      occupied: isOccupied,
      // `GhostStock`'un kendi kuralının AYNISI — iki yerde iki eşik olsaydı
      // ekranda hayalet görünen bir yuva burada boş sayılırdı.
      ghosted: !isOccupied && slotDraw(near.id, slot.id) < near.rack.ghostFill,
      s,
      reading,
    })
  }
}

export type Assignment = {
  source: Station
  target: Station
}

/**
 * Kaynak–hedef eşlemesi, araç kimliğinden deterministik.
 *
 * `Math.random` YOK: sahne dosyasının bir fonksiyonu olmak zorunda, yoksa
 * her yeniden yükleme farklı bir çevrim üretir ve kullanıcı aynı sahneyi
 * ikinci kez açtığında araç başka bir paleti taşır (T34).
 */
export function assignmentFor(truckId: string, stations: readonly Station[]): Assignment | null {
  const sources = stations.filter((station) => station.occupied)
  // Hayaletli yuva hedef DEĞİL: ekranda dolu görünüyor ve oraya gerçek bir
  // palet bırakmak, tek yuvada iki palet demek.
  const targets = stations.filter((station) => !station.occupied && !station.ghosted)
  if (sources.length === 0 || targets.length === 0) return null
  const seed = hash(truckId)
  const source = sources[seed % sources.length]
  const target = targets[(seed >>> 8) % targets.length]
  if (!source || !target) return null
  // Aynı yuvaya taşımak bir çevrim değildir.
  if (source.rackId === target.rackId && source.slot.id === target.slot.id) return null
  return { source, target }
}
