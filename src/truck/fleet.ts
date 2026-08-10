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
import { buildCycle, carriesPallet, cycleSeconds, type PhaseStep, stepAt } from './duty'
import { buildTrack, type RouteTrack, sampleTrack } from './route-index'
import type { TruckNode } from './schema'
import { type Assignment, assignmentFor, type Station, stationsAlong } from './stations'

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
  /**
   * Alma–bırakma çevrimi, ya da `null` (mekik: rotayı boyunca sürer).
   *
   * Çevrim varsa araç `s`'i kendi hızıyla değil BETİKTEN alır: faz süreleri
   * yayınlanmış oranlardan hesaplandığı için "çevrim 47 s" ölçülebilir bir
   * sayıdır ve serbest sürüşle karışmaz.
   */
  cycle: {
    assignment: Assignment
    steps: PhaseStep[]
    totalS: number
    t: number
    /** Kaynak yuvadaki paletin düğüm kimliği — çevrimin taşıdığı şey. */
    palletId: string
  } | null
  /** Park hâlindeki çatal kotu — çevrim bunu sürer. */
  forkY: number
  /**
   * Bu aracın rotasından erişilebilen yuvalar — `buildFleet`'in çevrimi
   * kurarken ZATEN taradığı liste.
   *
   * Dışarı verilmesinin sebebi paneldi: `truck-panel.tsx` sabitleme
   * listelerini doldurmak için `stationsAlong`'u ikinci kez koşuyordu, yani
   * her store yazımında aynı raf taraması iki kez ödeniyordu. Filo kaydı
   * kural olarak canlı durum taşır, konfigürasyon değil — bu alan da
   * konfigürasyon değil, o karede yapılmış taramanın sonucu.
   */
  stations: Station[]
  /** Taşınan paletin DÜĞÜM kimliği, ya da null. Sahneye YAZILMAZ —
   *  yalnız canlı transform kanalına yazılır. */
  carryingPalletId: string | null
}

export type Fleet = {
  trucks: FleetTruck[]
  /** Tavan yüzünden park kalan uygun araç sayısı — panel bunu söyler. */
  skipped: number
}

export const EMPTY_FLEET: Fleet = { trucks: [], skipped: 0 }

/** Verilen yuvada duran paletin düğüm kimliği. */
function palletInSlot(
  nodes: Readonly<Record<string, unknown>>,
  rackId: string,
  address: string,
): string | null {
  for (const [id, value] of Object.entries(nodes)) {
    const pallet = value as { type?: string; slotRackId?: string; slotAddress?: string }
    if (pallet?.type !== 'warehouse:pallet') continue
    if (pallet.slotRackId === rackId && pallet.slotAddress === address) return id
  }
  return null
}

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
      cycle: null,
      forkY: node.forkHeight,
      stations: [],
      carryingPalletId: null,
    })
  }
  const trucks = candidates.slice(0, FLEET_LIMIT)

  /**
   * Çevrim ataması — filo kurulurken BİR kez, deterministik.
   *
   * Kare döngüsünde yapılsaydı her karede sahne taranırdı; burada yapılınca
   * yalnız sahne değiştiğinde yenilenir ve `assignmentFor` araç kimliğinden
   * türediği için aynı sahne aynı çevrimi verir (T34).
   */
  for (const truck of trucks) {
    const model = TRUCK_MODELS[truck.modelId]
    const stations = stationsAlong(nodes, truck.track, model)
    truck.stations = stations
    // Kullanıcının sabitlediği yuvalar kurayı geçersiz kılar — düğümden
    // burada okunuyor, FleetTruck'a kopyalanmıyor: sabit sahne verisi ve
    // filo kaydı canlı durum taşır, konfigürasyon değil.
    const node = nodes[truck.id] as TruckNode | undefined
    const assignment = assignmentFor(truck.id, stations, {
      pick: node?.pickSlot,
      drop: node?.dropSlot,
    })
    if (!assignment) continue
    const steps = buildCycle(model, assignment.source, assignment.target, truck.s)
    if (steps.length === 0) continue
    // Kaynak yuvadaki paletin kimliği: çevrimin taşıyacağı düğüm. Yoksa
    // çevrim kurulmaz — hayalet bir palet taşımak, olmayan stoku hareket
    // ettirmektir.
    const palletId = palletInSlot(nodes, assignment.source.rackId, assignment.source.slot.id)
    if (!palletId) continue
    truck.cycle = { assignment, steps, totalS: cycleSeconds(steps), t: 0, palletId }
  }

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
    // ── Görev çevrimi: betik sürüşü devralır ──
    if (truck.cycle) {
      const cycle = truck.cycle
      cycle.t = (cycle.t + clamped) % cycle.totalS
      const at = stepAt(cycle.steps, cycle.t)
      if (at) {
        // Faz içinde doğrusal ilerleme: `s` bir önceki fazın hedefinden
        // bu fazınkine, çatal kotu da öyle. Fazın kendi süresi mesafeden
        // türediği için sonuç yayınlanmış hızda hareket eder.
        const previous = cycle.steps[at.index - 1]
        const fromS = previous?.s ?? truck.s
        const toS = at.step.s ?? fromS
        truck.s = fromS + (toS - fromS) * at.progress
        const fromY = previous?.forkY ?? truck.forkY
        truck.forkY = fromY + (at.step.forkY - fromY) * at.progress
        truck.carryingPalletId = carriesPallet(at.step.phase) ? cycle.palletId : null
      }
      continue
    }

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

/** Aracın aktif fazı — panelin okuduğu tek yer. */
export function phaseOf(truck: FleetTruck): string | null {
  if (!truck.cycle) return null
  return stepAt(truck.cycle.steps, truck.cycle.t)?.step.phase ?? null
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
