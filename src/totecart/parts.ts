/**
 * Toplama arabasının parçaları — İKİ liste, iki gövde.
 *
 * Çerçeve ile kasalar ayrı: kasa sayısı ve kasa boyu değişse bile çerçeve
 * aynı kalabiliyor, ve eğimli tepside kasa DÖNÜYOR, çerçeve dönmüyor.
 * Ayrıca kısmen dolu bir araba (`loadedTiers`) yalnız kasa listesini
 * değiştiriyor — çerçevenin buffer'ı paylaşılmaya devam ediyor.
 *
 * Bütün parçalar DÜĞÜM çerçevesinde: origin taban izinin ortası, zemin
 * kotunda; +X itme yönünün tersi (kol −X'te), Z en.
 */

import {
  DECK_LIP_M,
  DECK_PLATE_M,
  FRAME_M,
  HANDLE_TUBE_M,
  TOTE_RIM_M,
  TOTE_WALL_M,
} from './catalog'
import {
  castorCentres,
  castorOf,
  deckM,
  familyOf,
  footprintM,
  handleYM,
  tierYM,
  tiltRad,
  toteSizeOf,
} from './metrics'
import type { ToteCartNode } from './schema'

export type ToteCartDetail = 'full' | 'simple'

export type ToteCartPartRole = 'frame' | 'deck' | 'tote' | 'tote-inner' | 'tyre' | 'hub' | 'joint'

export type ToteCartPart = {
  role: ToteCartPartRole
  center: readonly [number, number, number]
  size: readonly [number, number, number]
  /**
   * X ekseni etrafında eğim, radyan. YALNIZ eğimli arabanın tepsileri
   * kullanıyor: gerçek ürün TEPSİYİ eğiyor, kasayı değil — kasa eğik bir
   * rafın üstünde durur, havada asılı durmaz. Eğim geometriye giriyor
   * çünkü tepsiler çerçevenin parçası ve çerçeve tek bir gövde.
   */
  tiltX?: number
}

/**
 * Çerçeve: dört köşe dikmesi, kat başına tepsi, tekerlekler, itme kolu.
 */
export function toteCartFrameParts(node: ToteCartNode, detail: ToteCartDetail): ToteCartPart[] {
  const [length, width] = footprintM(node)
  const [deckLength, deckWidth] = deckM(node)
  const castor = castorOf(node)
  const parts: ToteCartPart[] = []

  const frameFootX = length / 2 - FRAME_M / 2
  const frameFootZ = width / 2 - FRAME_M / 2
  const frameBottom = castor.buildHeightM
  // Kol YOKSA dikmeler kol kotuna kadar çıkmıyor. Çıksaydı kolsuz araba
  // hiçbir işe yaramayan dört çıplak direk taşırdı — ve zarf da onları
  // saymadığı için direkler çarpışma kutusunun dışında kalırdı.
  const topTier = tierYM(node, node.tiers - 1)
  const frameTop = node.hasHandle ? Math.max(topTier, handleYM()) : topTier

  // ── Köşe dikmeleri ────────────────────────────────────────────────────
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      parts.push({
        role: 'frame',
        center: [sx * frameFootX, (frameBottom + frameTop) / 2, sz * frameFootZ],
        size: [FRAME_M, frameTop - frameBottom, FRAME_M],
      })
    }
  }

  // ── Alt çevre kuşağı — dikmeleri bağlayan ve tekerleği taşıyan şase ───
  for (const sz of [-1, 1] as const) {
    parts.push({
      role: 'frame',
      center: [0, frameBottom + FRAME_M / 2, sz * frameFootZ],
      size: [length, FRAME_M, FRAME_M],
    })
  }
  for (const sx of [-1, 1] as const) {
    parts.push({
      role: 'frame',
      center: [sx * frameFootX, frameBottom + FRAME_M / 2, 0],
      size: [FRAME_M, FRAME_M, width - 2 * FRAME_M],
    })
  }

  // ── Tepsiler ──────────────────────────────────────────────────────────
  const tilt = tiltRad(node)
  for (let tier = 0; tier < node.tiers; tier++) {
    const y = tierYM(node, tier)
    parts.push({
      role: 'deck',
      center: [0, y - DECK_PLATE_M / 2, 0],
      size: [deckLength, DECK_PLATE_M, deckWidth],
      tiltX: tilt,
    })
    if (detail === 'full') {
      // Bordür: kasayı tutan kenar. BITO'nun yayımladığı 12 mm. Eğimli
      // arabada tepsiyle birlikte dönüyor — dönmezse eğik kasayı tutan
      // kenar düz kalır ve kasa kayar.
      for (const sz of [-1, 1] as const) {
        parts.push({
          role: 'deck',
          center: [0, y + DECK_LIP_M / 2, sz * (deckWidth / 2 - DECK_PLATE_M)],
          size: [deckLength, DECK_LIP_M, DECK_PLATE_M * 2],
          tiltX: tilt,
        })
      }
      // Arka bordür yalnız −X'te: ön (+X) taraf kasanın çekilebilmesi için
      // açık kalıyor, gerçek toplama arabalarındaki gibi.
      parts.push({
        role: 'deck',
        center: [-deckLength / 2 + DECK_PLATE_M, y + DECK_LIP_M / 2, 0],
        size: [DECK_PLATE_M * 2, DECK_LIP_M, deckWidth],
        tiltX: tilt,
      })
    }
  }

  // ── Tekerlekler ───────────────────────────────────────────────────────
  const radius = castor.diameterM / 2
  for (const [cx, cz] of castorCentres(node)) {
    // Lastik: kare kutu olarak çiziliyor ve bu bilinçli — ailenin bütün
    // geometrisi kutu; silindir eklemek tek bir tekerlek için ayrı bir
    // emitter demekti. Uzaktan ayırt edilmiyor, yakından yuvarlatılmış
    // köşe eksikliği kabul edilmiş bir sadeleştirme.
    parts.push({
      role: 'tyre',
      center: [cx, radius, cz],
      size: [castor.diameterM, castor.diameterM, castor.treadM],
    })
    if (detail === 'full') {
      parts.push({
        role: 'hub',
        center: [cx, radius, cz],
        size: [castor.diameterM * 0.45, castor.diameterM * 0.45, castor.treadM + 0.004],
      })
      // Döner mafsal ve bağlantı plakası.
      parts.push({
        role: 'joint',
        center: [cx, castor.buildHeightM - 0.02, cz],
        size: [0.08, 0.04, 0.07],
      })
      // Çatal bacakları.
      for (const sz of [-1, 1] as const) {
        parts.push({
          role: 'joint',
          center: [cx, radius + 0.02, cz + sz * (castor.treadM / 2 + 0.006)],
          size: [0.012, castor.diameterM * 0.7, 0.008],
        })
      }
    }
  }

  // Fren pedalı: DÖRT tekerleğin ikisinde, kolun olduğu uçta. Topstore /
  // BiGDUG'un tepsili tote arabası tam olarak böyle — dördü de döner,
  // ikisi frenli. (Avrupa raf arabalarının 2 döner + 2 sabit düzeni BAŞKA
  // bir sınıf; bu araba o sınıfta değil.)
  if (detail === 'full') {
    // Pedal TEKERLEĞİN kendisinde, çerçeve köşesinde değil: tekerlekler
    // köşeden içeri kaçık ve köşeye konan bir pedal frenleyeceği tekerleğin
    // yanında durmuyordu.
    for (const [cx, cz] of castorCentres(node)) {
      if (cx > 0) continue
      parts.push({
        role: 'joint',
        center: [cx - castor.treadM, radius * 0.55, cz],
        size: [0.045, 0.01, 0.02],
      })
    }
  }

  // ── İtme kolu ─────────────────────────────────────────────────────────
  if (node.hasHandle) {
    const y = handleYM()
    parts.push({
      role: 'frame',
      center: [-frameFootX, y, 0],
      size: [HANDLE_TUBE_M, HANDLE_TUBE_M, width - 2 * FRAME_M],
    })
    if (detail === 'full') {
      // Kolu dikmeye bağlayan iki dirsek.
      for (const sz of [-1, 1] as const) {
        parts.push({
          role: 'joint',
          center: [-frameFootX, y, sz * (width / 2 - FRAME_M)],
          size: [HANDLE_TUBE_M + 0.006, HANDLE_TUBE_M + 0.006, 0.03],
        })
      }
    }
  }

  return parts
}

/**
 * TEK bir kasa — kendi çerçevesinde, tabanı `y = 0`, merkezi origin'de.
 *
 * Kat başına ayrı bir liste değil tek bir kasa: bütün kasalar aynı şekil,
 * ve renderer onları kat kat yerleştiriyor. Bir arabada beş kasa varsa beş
 * mesh çiziliyor ama TEK buffer paylaşılıyor — ve kısmen dolu bir araba
 * ötekiyle aynı kasa buffer'ını kullanıyor.
 */
export function toteParts(node: ToteCartNode, detail: ToteCartDetail): ToteCartPart[] {
  const family = familyOf(node)
  const size = toteSizeOf(node)
  const length = family.lengthM
  const width = family.widthM
  const height = size.heightM
  const inner = size.innerHeightM
  const parts: ToteCartPart[] = []

  // Taban.
  const floor = height - inner
  parts.push({
    role: 'tote-inner',
    center: [0, floor / 2, 0],
    size: [length, floor, width],
  })

  // Dört duvar. Kutu olarak — içi boş bir kasa, dolu bir blok değil:
  // toplama arabasının kasaları açıktır ve kapalı bir blok çizmek onları
  // ambalaj kutusuna çevirirdi.
  for (const sx of [-1, 1] as const) {
    parts.push({
      role: 'tote',
      center: [sx * (length / 2 - TOTE_WALL_M / 2), floor + inner / 2, 0],
      size: [TOTE_WALL_M, inner, width],
    })
  }
  for (const sz of [-1, 1] as const) {
    parts.push({
      role: 'tote',
      center: [0, floor + inner / 2, sz * (width / 2 - TOTE_WALL_M / 2)],
      size: [length - 2 * TOTE_WALL_M, inner, TOTE_WALL_M],
    })
  }

  if (detail === 'full') {
    // Kenar bileziği — istiflenebilen bir kasanın en tanınır ayrıntısı.
    for (const sx of [-1, 1] as const) {
      parts.push({
        role: 'tote',
        center: [sx * (length / 2 - TOTE_RIM_M / 2), height - TOTE_RIM_M / 2, 0],
        size: [TOTE_RIM_M, TOTE_RIM_M, width],
      })
    }
    for (const sz of [-1, 1] as const) {
      parts.push({
        role: 'tote',
        center: [0, height - TOTE_RIM_M / 2, sz * (width / 2 - TOTE_RIM_M / 2)],
        size: [length - 2 * TOTE_RIM_M, TOTE_RIM_M, TOTE_RIM_M],
      })
    }
    // Kısa kenarlardaki el tutamağı boşluğu — duvarın üstünde bir kesik
    // olarak DEĞİL, iki yandan yaklaşan iki blokla. Boşluk çıkarmak bu
    // emitter'ın yapamayacağı bir şey; iki blok aynı silueti veriyor.
    // (Ayrıntı yalnız yakın katmanda.)
  }

  return parts
}
