import { channelPitchM } from './metrics'
import { placeKey, shapeKeyOf } from './neighbours'
import type { LiveRackingNode } from './schema'

/**
 * Bir kanalı bloğun yanına sürüklemek.
 *
 * Kanallar dikme hatlarını **tam olarak** bir aralıkta paylaşıyor —
 * `neighbours.ts` yarım milimetreye kadar çalışıyor, çünkü daha gevşeği gözle
 * ayrı duran dikmeleri birleştirirdi. Kullanıcının elle tutturabileceği bir
 * sayı değil bu:
 *
 * - Hizalama kılavuzları yaklaştırıp bırakıyor: ayak izi kenarını ayak izi
 *   kenarına çekiyorlar — doğru mesafe — ama yalnız 8 cm'lik bir pencerede ve
 *   ancak kullanıcı zaten 8 cm içine girdikten sonra.
 * - Izgara yapışması karşı çalışıyor: EPAL kanalın aralığı 0,870 m ve bu hiçbir
 *   ızgara adımının katı değil.
 * - Çoğalt da kurtarmıyor: host kopyayı dünya X ve Z'de sabit bir metre öteliyor,
 *   ne aralığı ne düğümün dönüşünü görüyor.
 *
 * Mıknatıs `capabilities.movable.groupMoveSnap`'e bağlı — selective rafın,
 * drive-in koridorunun ve konveyör ailesinin kullandığı kancanın aynısı, yani
 * ızgara yapışmasının önüne geçiyor ve host ateşlendiğinde hizalama
 * kılavuzlarını temizliyor.
 *
 * ## Neden drive-in'in mıknatısı bir başka aralıkla kullanılmıyor
 *
 * Çünkü şekil anahtarı kindʼler arasında EŞLEŞMEMELİ. Aynı aralıkta duran bir
 * drive-in koridoru ile bir canlı raf kanalının dikmeleri farklı derinliklerde;
 * birbirlerine mıknatıslanmalarına izin vermek, hiçbir üreticinin
 * birleştirmeyeceği bir ek yeri üretir ve kullanıcı birkaç santim arayla iki
 * sıra dikme görür, sebebini söyleyen hiçbir şey olmadan.
 */

/**
 * Bir kanal ek yerine tıklamadan önce ne kadar yaklaşıyor.
 *
 * Yarım metre — selective rafın ve drive-in'in kullandığı sayı, aynı gerekçeyle:
 * kanal aralığının kabaca yarısı, yani kullanıcı belli ki bloğun yanını
 * hedeflerken devreye giriyor, bir sonraki koridora kanal koyarken hiç girmiyor.
 */
const MAGNET_RADIUS = 0.5
const MAGNET_RADIUS_SQ = MAGNET_RADIUS * MAGNET_RADIUS

/** Ek yeri indeksinin göz boyu. Bir metre — mıknatıs yarıçapından geniş, yani
 *  bir arama yalnız imlecin çevresindeki dokuz gözü okuyor. */
const CELL = 1

type Seam = { x: number; z: number; shape: string; owner: string }

type SeamIndex = {
  cells: Map<string, Seam[]>
  byPlace: Map<string, string>
}

function cellKey(x: number, z: number): string {
  return `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`
}

let indexedFrom: unknown = null
let index: SeamIndex = { cells: new Map(), byPlace: new Map() }

function build(nodes: Readonly<Record<string, unknown>>): SeamIndex {
  const cells = new Map<string, Seam[]>()
  const byPlace = new Map<string, string>()

  for (const value of Object.values(nodes)) {
    const shape = shapeKeyOf(value)
    if (shape === null) continue
    const channel = value as LiveRackingNode
    const [x, , z] = channel.position
    const rotationY = channel.rotation?.[1] ?? 0
    const pitch = channelPitchM(channel)
    byPlace.set(placeKey(x, z), channel.id)

    // Yerel +X dünyada (cos, −sin)'e düşüyor — komşuluk testinin ve yerleştirme
    // aracının uzlaşımı. Tersi kanalı komşusunun yanlış tarafına mıknatıslar ve
    // neredeyse doğru görünür.
    const dx = pitch * Math.cos(rotationY)
    const dz = -pitch * Math.sin(rotationY)

    for (const side of [1, -1] as const) {
      const seam: Seam = { x: x + side * dx, z: z + side * dz, shape, owner: channel.id }
      const key = cellKey(seam.x, seam.z)
      const bucket = cells.get(key)
      if (bucket) bucket.push(seam)
      else cells.set(key, [seam])
    }
  }

  return { cells, byPlace }
}

function seamIndex(nodes: Readonly<Record<string, unknown>>): SeamIndex {
  if (nodes !== indexedFrom) {
    index = build(nodes)
    indexedFrom = nodes
  }
  return index
}

/** Memo'yu düşürür. Yalnız testler arasında indeks sızmasın diye gerekli. */
export function resetSeamIndex(): void {
  indexedFrom = null
  index = { cells: new Map(), byPlace: new Map() }
}

/**
 * Bu kanalın tıklaması gereken ek yeri, ya da sürüklemeye karışmamak için null.
 *
 * Şekil uyuşmak ZORUNDA — aynı bay genişliği, aynı kanal derinliği, aynı çerçeve
 * yüksekliği, aynı yön — çünkü iki dikme hattının gerçekten çakışıp
 * çakışmadığına karar veren şey bu. Kullanılan yüklem, çerçeveyi kuran kodun
 * kullandığının AYNISI (`shapeKeyOf`), yani mıknatıs bir kanalı, üreticinin
 * sonra paylaşmayı reddedeceği bir ek yerine çekemiyor.
 */
export function snapToNeighbourSeam(
  channel: LiveRackingNode,
  candidate: readonly [number, number, number],
  movingIds: readonly string[],
  nodes: Readonly<Record<string, unknown>>,
): [number, number, number] | null {
  const shape = shapeKeyOf(channel)
  if (shape === null) return null

  const moving = new Set<string>(movingIds)
  moving.add(channel.id)

  const [x, y, z] = candidate
  const { cells, byPlace } = seamIndex(nodes)

  let best: Seam | null = null
  let bestDistance = MAGNET_RADIUS_SQ

  const cx = Math.floor(x / CELL)
  const cz = Math.floor(z / CELL)
  for (let ix = cx - 1; ix <= cx + 1; ix++) {
    for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const bucket = cells.get(`${ix}:${iz}`)
      if (!bucket) continue
      for (const seam of bucket) {
        if (seam.shape !== shape) continue
        // Bir kanal kendi ek yerine, ya da kendisiyle birlikte taşınan bir
        // şeyin ek yerine mıknatıslanmaz — yoksa bir bloğu sürüklerken her
        // kanal ötekini çeker ve hiçbir şey kımıldamaz.
        if (moving.has(seam.owner)) continue
        // Başka bir kanalın zaten durduğu yere de. Bloğun ortasından çekilip
        // çıkarılan bir kanal bu bakımdan "orada duruyor" sayılmıyor, yani
        // bıraktığı boşluk geri konabilir kalıyor.
        const occupant = byPlace.get(placeKey(seam.x, seam.z))
        if (occupant !== undefined && !moving.has(occupant)) continue

        const distance = (seam.x - x) ** 2 + (seam.z - z) ** 2
        if (distance >= bestDistance) continue
        bestDistance = distance
        best = seam
      }
    }
  }

  return best ? [best.x, y, best.z] : null
}
