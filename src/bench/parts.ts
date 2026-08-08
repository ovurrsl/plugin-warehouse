/**
 * Tezgâh parçaları — ailenin `role + center + size` kutu listesi deseni.
 *
 * Kutulardan kurulu olması bir eksiklik değil, bu ailenin gerçek biçimi:
 * bir tezgâh kare kutu profil ayak, düz tabla, düz raf ve düz çekmece
 * yüzünden ibaret. Silindir olan tek şey makara ve teker; ikisi de
 * `pattern`/oran ile değil, kendi kutularıyla temsil ediliyor çünkü bu
 * mesafede silindir ile prizma arasındaki fark bir pikselin altında kalıyor
 * ve üçgen bütçesi tabla makaralarında ciddi (2 m'lik masada 22 makara).
 *
 * Uzak katman (`simple`) ailenin geri kalanıyla aynı sözleşmede: siluet
 * korunuyor, iç donanım düşüyor. Bir tezgâhın 40 m'den okunan şekli tabla,
 * dört ayak ve varsa üst raf — çekmece yüzleri, makaralar ve teker göbekleri
 * o mesafede tek piksel bile etmiyor.
 */

import {
  APRON_HEIGHT_M,
  APRON_THICKNESS_M,
  CASTOR_DIAMETER_M,
  CASTOR_INSET_M,
  DRAWER_COUNT,
  DRAWER_GAP_M,
  DRAWER_HEIGHT_M,
  LEG_M,
  MONITOR_HEIGHT_M,
  MONITOR_POST_M,
  MONITOR_SCREEN_M,
  OVERHEAD_POST_M,
  ROLLER_DIAMETER_M,
  ROLLER_PITCH_M,
  SCALE_PLATFORM_M,
  SCALE_RECESS_M,
  SHELF_THICKNESS_M,
  TOOLBOARD_THICKNESS_M,
  TOP_THICKNESS_M,
  UNDER_SHELF_Y_M,
} from './catalog'
import {
  depthM,
  hasCastors,
  hasMonitorStand,
  legHeightM,
  overheadOf,
  overheadShelfDepthM,
  overheadShelfYM,
  topKindOf,
  underOf,
  widthM,
  worktopYM,
} from './metrics'
import type { BenchNode } from './schema'

export type BenchDetail = 'full' | 'simple'

export type BenchPartRole =
  | 'leg'
  | 'apron'
  | 'top'
  | 'shelf'
  | 'drawer'
  | 'roller'
  | 'scale'
  | 'post'
  | 'toolboard'
  | 'castor'
  | 'screen'

export type BenchPart = {
  role: BenchPartRole
  center: readonly [number, number, number]
  size: readonly [number, number, number]
}

/**
 * Bütün parçalar tablanın merkezine göre, yerel çerçevede: +X genişlik, +Z
 * derinlik, Y zeminden yukarı. Düğümün kendi dönüşü grubun matrisinde —
 * burada hiçbir şey dönmüyor.
 */
export function benchParts(node: BenchNode, detail: BenchDetail): BenchPart[] {
  const width = widthM(node)
  const depth = depthM(node)
  const worktop = worktopYM(node)
  const legHeight = legHeightM(node)
  const castors = hasCastors(node)
  const castorY = castors ? CASTOR_DIAMETER_M : 0
  const parts: BenchPart[] = []

  // ── Tabla ──────────────────────────────────────────────────────────────
  parts.push({
    role: 'top',
    center: [0, worktop - TOP_THICKNESS_M / 2, 0],
    size: [width, TOP_THICKNESS_M, depth],
  })

  // ── Ayaklar ────────────────────────────────────────────────────────────
  // Köşelerden yarım profil içeride: ayak yüzü tablanın kenarıyla hizalı
  // olurdu ve masa kenarına oturan her şey ayağa çarpardı.
  const legX = width / 2 - LEG_M / 2
  const legZ = depth / 2 - LEG_M / 2
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({
        role: 'leg',
        center: [sx * legX, castorY + legHeight / 2, sz * legZ],
        size: [LEG_M, legHeight, LEG_M],
      })
      if (castors && detail === 'full') {
        parts.push({
          role: 'castor',
          center: [
            sx * (width / 2 - CASTOR_INSET_M),
            CASTOR_DIAMETER_M / 2,
            sz * (depth / 2 - CASTOR_INSET_M),
          ],
          size: [CASTOR_DIAMETER_M * 0.35, CASTOR_DIAMETER_M, CASTOR_DIAMETER_M],
        })
      }
    }
  }

  // ── Tabla altı çevre kirişi ────────────────────────────────────────────
  // Siluete girer: tablanın altındaki gölge bandı masayı "tabla + dört çubuk"
  // olmaktan çıkaran şey. Bu yüzden uzak katmanda da duruyor.
  const apronY = worktop - TOP_THICKNESS_M - APRON_HEIGHT_M / 2
  for (const sz of [-1, 1]) {
    parts.push({
      role: 'apron',
      center: [0, apronY, sz * (depth / 2 - APRON_THICKNESS_M / 2)],
      size: [width - 2 * LEG_M, APRON_HEIGHT_M, APRON_THICKNESS_M],
    })
  }
  for (const sx of [-1, 1]) {
    parts.push({
      role: 'apron',
      center: [sx * (width / 2 - APRON_THICKNESS_M / 2), apronY, 0],
      size: [APRON_THICKNESS_M, APRON_HEIGHT_M, depth - 2 * LEG_M],
    })
  }

  // ── Alt donanım ────────────────────────────────────────────────────────
  const under = underOf(node)
  if (under === 'shelf') {
    parts.push({
      role: 'shelf',
      center: [0, castorY + UNDER_SHELF_Y_M, 0],
      size: [width - 2 * LEG_M, SHELF_THICKNESS_M, depth - 2 * LEG_M],
    })
  } else if (under === 'drawers' && detail === 'full') {
    // Çekmece bloğu masanın SOL yarısında: sağ taraf diz boşluğu olarak
    // kalıyor, çünkü tam genişlik çekmece bir tezgâhı dolap yapar.
    const blockWidth = Math.min(width / 2 - LEG_M, 0.5)
    const blockX = -width / 4
    for (let index = 0; index < DRAWER_COUNT; index++) {
      const y = apronY - APRON_HEIGHT_M / 2 - (index + 0.5) * (DRAWER_HEIGHT_M + DRAWER_GAP_M)
      if (y - DRAWER_HEIGHT_M / 2 < castorY) break
      parts.push({
        role: 'drawer',
        center: [blockX, y, depth / 2 - APRON_THICKNESS_M],
        size: [blockWidth, DRAWER_HEIGHT_M, APRON_THICKNESS_M * 1.5],
      })
    }
  }

  // ── Tabla yüzeyi donanımı ──────────────────────────────────────────────
  const top = topKindOf(node)
  if (top === 'rollers' && detail === 'full') {
    // Makaralar tablanın ÜSTÜNDE, derinlik boyunca uzanır ve genişlik boyunca
    // dizilir — mal masanın uzun kenarı boyunca kayar.
    const span = width - 2 * LEG_M
    const count = Math.max(2, Math.floor(span / ROLLER_PITCH_M))
    const first = -((count - 1) * ROLLER_PITCH_M) / 2
    for (let index = 0; index < count; index++) {
      parts.push({
        role: 'roller',
        center: [first + index * ROLLER_PITCH_M, worktop + ROLLER_DIAMETER_M / 2, 0],
        size: [ROLLER_DIAMETER_M * 0.8, ROLLER_DIAMETER_M, depth - 2 * LEG_M],
      })
    }
  } else if (top === 'scale') {
    // Gömme platform: tablanın içine oturuyor, üstüne değil. Uzak katmanda da
    // duruyor çünkü tablanın ortasındaki açık renk kare bu masanın kimliği.
    parts.push({
      role: 'scale',
      center: [0, worktop - SCALE_RECESS_M / 2, 0],
      size: [SCALE_PLATFORM_M, SCALE_RECESS_M, SCALE_PLATFORM_M],
    })
  }

  // ── Üst yapı ───────────────────────────────────────────────────────────
  const overhead = overheadOf(node)
  if (overhead !== 'none') {
    const shelfY = overheadShelfYM(node)
    const postZ = depth / 2 - OVERHEAD_POST_M / 2
    for (const sx of [-1, 1]) {
      parts.push({
        role: 'post',
        center: [sx * (width / 2 - OVERHEAD_POST_M / 2), worktop + (shelfY - worktop) / 2, -postZ],
        size: [OVERHEAD_POST_M, shelfY - worktop, OVERHEAD_POST_M],
      })
    }
    if (overhead === 'shelf') {
      const shelfDepth = overheadShelfDepthM(node)
      parts.push({
        role: 'shelf',
        center: [0, shelfY + SHELF_THICKNESS_M / 2, -(depth / 2 - shelfDepth / 2)],
        size: [width, SHELF_THICKNESS_M, shelfDepth],
      })
    } else {
      // Alet panosu: dikmelerin arasını dolduran dikey levha.
      parts.push({
        role: 'toolboard',
        center: [0, worktop + (shelfY - worktop) / 2, -(depth / 2 - TOOLBOARD_THICKNESS_M / 2)],
        size: [width - 2 * OVERHEAD_POST_M, shelfY - worktop, TOOLBOARD_THICKNESS_M],
      })
    }
  }

  // ── Terazi ekranı ──────────────────────────────────────────────────────
  if (hasMonitorStand(node) && detail === 'full') {
    const standX = width / 2 - 0.2
    parts.push({
      role: 'post',
      center: [standX, worktop + MONITOR_HEIGHT_M / 2, -(depth / 2 - 0.1)],
      size: [MONITOR_POST_M, MONITOR_HEIGHT_M, MONITOR_POST_M],
    })
    parts.push({
      role: 'screen',
      center: [standX, worktop + MONITOR_HEIGHT_M + MONITOR_SCREEN_M[1] / 2, -(depth / 2 - 0.1)],
      size: MONITOR_SCREEN_M,
    })
  }

  return parts
}
