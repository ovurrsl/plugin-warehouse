/**
 * Filo adımlayıcısı — saf: three yok, React yok, host importu yok.
 *
 * Simülasyon SAHNEYE HİÇ YAZMAZ (plan §5.6): bu dosya düğümleri yalnız okur,
 * kendi durumunu (yay parametresi, yön, bekleme) kendi nesnelerinde tutar ve
 * poz üretir. Pozu `useLiveTransforms`'a taşıyan `fleet-system.tsx`'tir;
 * durunca kanal temizlenir ve her araç park pozuna BİR karede döner — bu bir
 * restore'dur, undo değil, çünkü düğüm verisi hiç değişmedi.
 */

import { TRUCK_MODELS, type TruckModelId } from '../handling/models'
import type { RouteNode } from '../route/schema'
import { buildTrack, type RouteTrack, sampleTrack } from './route-index'
import type { TruckNode } from './schema'

/**
 * Aynı anda hareket eden araç tavanı.
 *
 * `useLiveTransforms.set` her çağrıda Map klonlar ve 2B plan katmanı her
 * transform değişiminde yerleşim epoch'unu ilerletir — kanalın ölçülmemiş
 * maliyeti bu. 16, muhafazakâr bir başlangıçtır; tarayıcıda ölçülmeden
 * YÜKSELTİLMEZ. Fazlası park kalır ve panel kaçının koştuğunu söyler.
 */
export const FLEET_LIMIT = 16

/** Bundan uzun bir kare, arka planda kalmış bir sekmedir — gerçek geçen
 *  süreyle ilerletmek her aracı binanın öbür ucuna ışınlar. */
export const MAX_STEP_S = 0.1

/**
 * Tek yönlü rotanın ucundaki bekleme. Yayınlanmış bir figür DEĞİL —
 * operasyonel bir duraklama tahmini; görünmeyen bir dönüş yolu uydurmak
 * yerine araç uçta durur ve başta yeniden belirir (kullanıcı dönüş yolunu
 * çizmemiştir, biz de çizmeyiz).
 */
export const DWELL_S = 3

export type FleetTruck = {
  id: string
  modelId: TruckModelId
  track: RouteTrack
  /** Park kotu — rota origin'i değil aracın kendi Y'si: slab lifti canlı
   *  düğümler için host'un yükseklik sistemi tarafından sürülür. */
  parkedY: number
  /** Yay parametresi, metre. */
  s: number
  dir: 1 | -1
  dwellRemaining: number
  speedMps: number
}

export type Fleet = {
  trucks: FleetTruck[]
  /** Tavan yüzünden park kalan uygun araç sayısı — panel bunu söyler. */
  skipped: number
}

export const EMPTY_FLEET: Fleet = { trucks: [], skipped: 0 }

/** Yüklü hız esas; paket hızları yalnız yüklü yoksa. Hepsi null (mpt: motor
 *  yok) → araç filoya giremez, sessiz 0 km/h asla üretilmez. */
function speedMpsOf(modelId: TruckModelId): number | null {
  const { travelKmh } = TRUCK_MODELS[modelId]
  const kmh = travelKmh.laden ?? travelKmh.efficiency ?? travelKmh.plus
  return kmh === null ? null : (kmh * 1000) / 3600
}

export type FleetRefusal =
  | 'no-route'
  | 'route-missing'
  | 'route-not-vehicle'
  | 'different-parent'
  | 'route-degenerate'
  | 'no-drive'

/**
 * Bir aracın rotasına bağlanma denemesi — filo da panel de AYNI cevabı okur,
 * iki ayrı karar kopyası ayrışamaz.
 */
export function bindTruck(
  truck: TruckNode,
  nodes: Readonly<Record<string, unknown>>,
): { track: RouteTrack; speedMps: number } | { refusal: FleetRefusal } {
  if (truck.duty !== 'shuttle' || !truck.routeId) return { refusal: 'no-route' }
  const route = nodes[truck.routeId] as RouteNode | undefined
  if (!route || (route as { type?: string }).type !== 'warehouse:route') {
    // Sarkan referans doğrulanmış bir gerçektir: host plugin kind'ları için
    // referans temizliği yapmaz. Rotası silinen araç HAREKET ETMEZ ve panel
    // söyler; hiçbir kod yolu undefined.points okumaz (T30).
    return { refusal: 'route-missing' }
  }
  if (route.role !== 'vehicle') return { refusal: 'route-not-vehicle' }
  // Poz rota-yerel çerçevede üretilir; farklı ebeveyn bir Matrix4 zinciri
  // ister ve o zincir çeyrek-tur hata sınıfının kapısıdır. Reddet, söyle.
  if ((truck.parentId ?? null) !== (route.parentId ?? null)) {
    return { refusal: 'different-parent' }
  }
  const track = buildTrack(route)
  if (!track) return { refusal: 'route-degenerate' }
  const speedMps = speedMpsOf(truck.model)
  if (speedMps === null) return { refusal: 'no-drive' }
  return { track, speedMps }
}

/**
 * Sahnedeki sürülebilir filo. Düğümler YALNIZ OKUNUR; sıra deterministiktir
 * (id sıralı) ki tavan her karede aynı araçları seçsin — kamera açısına göre
 * araç değiştiren bir filo, kullanıcının altından değişen bir sahnedir.
 */
export function buildFleet(nodes: Readonly<Record<string, unknown>>): Fleet {
  const candidates: FleetTruck[] = []
  const ids = Object.keys(nodes).sort()
  for (const id of ids) {
    const node = nodes[id] as TruckNode
    if ((node as { type?: string }).type !== 'warehouse:truck') continue
    const bound = bindTruck(node, nodes)
    if ('refusal' in bound) continue
    candidates.push({
      id,
      modelId: node.model,
      track: bound.track,
      parkedY: node.position?.[1] ?? 0,
      s: Math.min(Math.max(node.routeAnchor, 0), 1) * bound.track.lengthM,
      dir: 1,
      dwellRemaining: 0,
      speedMps: bound.speedMps,
    })
  }
  const trucks = candidates.slice(0, FLEET_LIMIT)
  return { trucks, skipped: candidates.length - trucks.length }
}

/**
 * Bir kare. Filonun KENDİ durumunu ilerletir; düğümlere dokunmaz.
 *
 * `two-way` uçta yön çevirir; `one-way` uçta `DWELL_S` bekler ve başta
 * yeniden belirir. Uç aşımı bir sonraki segmente TAŞINIR (kalan mesafe
 * yutulmaz) — yutulsaydı kısa rotalarda hız, kare hızına bağlı yavaşlardı.
 */
export function stepFleet(fleet: Fleet, dt: number): void {
  const clamped = Math.min(dt, MAX_STEP_S)
  for (const truck of fleet.trucks) {
    if (truck.dwellRemaining > 0) {
      truck.dwellRemaining -= clamped
      if (truck.dwellRemaining > 0) continue
      truck.s = 0
      truck.dwellRemaining = 0
      continue
    }
    let remaining = truck.speedMps * clamped
    while (remaining > 0) {
      const target = truck.dir === 1 ? truck.track.lengthM : 0
      const distance = Math.abs(target - truck.s)
      if (remaining < distance) {
        truck.s += truck.dir * remaining
        break
      }
      remaining -= distance
      truck.s = target
      if (truck.track.traffic === 'two-way') {
        truck.dir = truck.dir === 1 ? -1 : 1
      } else {
        truck.dwellRemaining = DWELL_S
        break
      }
    }
  }
}

/** Aracın şu anki pozu, level-yerel. `useLiveTransforms`'un sözlüğünde. */
export function poseOf(truck: FleetTruck): {
  position: [number, number, number]
  rotation: number
} {
  const sample = sampleTrack(truck.track, truck.s)
  // Tek yönlü rota geriye örneklenmez; iki yönlüde dönüş, burnu çevirmektir.
  const heading = truck.dir === 1 ? sample.headingRad : sample.headingRad + Math.PI
  return { position: [sample.x, truck.parkedY, sample.z], rotation: heading }
}
