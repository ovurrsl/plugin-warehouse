/**
 * Tezgâh geometrisi — ailenin ORTAK havuzunda (`getCachedGeometry`).
 *
 * Anahtar, şekli belirleyen her girdiyi taşır ve YALNIZ onları. İki yön de
 * pahalı: mesh'i değiştiren bir alan anahtarda değilse iki farklı tezgâh tek
 * buffer'ı paylaşır ve biri yanlış çizilir; hiçbir vertex kımıldatmayan bir
 * alan anahtardaysa paylaşım bedelsiz bölünür. `bench.test.ts` iki yönü de
 * ölçüyor.
 *
 * Dikkat edilen üç nokta:
 *
 *  - Ölçü alanları OPSİYONEL, yani anahtara ham `node.width` yazmak yanlış
 *    olurdu: `undefined` ile varyantın kendi genişliği aynı mesh'i üretir ve
 *    ikisi aynı anahtara çözülmeli. Anahtar bu yüzden ÇÖZÜLMÜŞ ölçüleri
 *    yazıyor.
 *  - `overhead`/`under` de aynı sebeple çözülmüş hâlleriyle giriyor.
 *  - Yalnız yakın katmanda üretilen donanım (çekmece, makara, teker, ekran)
 *    anahtara katmana KAPILI giriyor: uzak katmanda o alanlar hiçbir vertex
 *    kımıldatmıyor.
 */

import type * as THREE from 'three'
import {
  emitPart,
  finish,
  getCachedGeometry,
  releaseGeometry,
  retainGeometry,
  type Sink,
  toLinear,
} from '../conveyor/geometry-builder'
import { memoiseGeometryKey } from '../geometry-key-memo'
import { PALETTE } from './catalog'
import {
  depthM,
  hasCastors,
  hasMonitorStand,
  overheadOf,
  topKindOf,
  underOf,
  widthM,
  worktopYM,
} from './metrics'
import { type BenchDetail, type BenchPart, benchParts } from './parts'
import type { BenchNode } from './schema'

function colorOf(node: BenchNode, role: BenchPart['role']): string {
  switch (role) {
    case 'leg':
    case 'apron':
    case 'post':
    // Makara yatağı ahşap değil boyalı sac: tablanın yerine geçen bir
    // çerçeve parçası, ve rengi de çerçevenin.
    case 'bed':
      return node.frameColor
    case 'top':
    case 'shelf':
    case 'toolboard':
      return node.timberColor
    case 'drawer':
      return PALETTE.drawer
    case 'roller':
      return PALETTE.steel
    case 'scale':
      return PALETTE.scale
    case 'castor':
      return PALETTE.tyre
    case 'screen':
      return PALETTE.screen
  }
}

function buildParts(node: BenchNode, parts: readonly BenchPart[]): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  for (const part of parts) {
    emitPart(sink, part, toLinear(colorOf(node, part.role)), 0, 0, 0)
  }
  return finish(sink)
}

function buildBenchGeometryKey(node: BenchNode, detail: BenchDetail): string {
  const full = detail === 'full'
  const under = underOf(node)
  const top = topKindOf(node)
  return [
    'bench',
    // Çözülmüş ölçüler, ham alanlar değil: boş bırakılmış genişlik ile
    // varyantın genişliğini elle yazmak aynı mesh'i üretiyor.
    widthM(node).toFixed(4),
    worktopYM(node).toFixed(4),
    depthM(node).toFixed(4),
    overheadOf(node),
    // ETKİN alt donanım, ham alan değil. `drawers` yalnız yakın katmanda
    // parça üretiyor, yani uzak katmanda `drawers` ile `none` birebir aynı
    // mesh'e çözülüyor ve tek buffer'ı paylaşmalılar. Ham alanı yazmak,
    // hiçbir farkı olmayan iki masa için iki mesh üretirdi — kapsama testi
    // bunu ilk koşuda yakaladı.
    under === 'shelf' ? 'shelf' : full ? under : 'bare',
    top,
    // Varyantın kendisi anahtarda YOK ve bilerek: iki varyant aynı zarfa ve
    // aynı donanıma çözülürse mesh'leri birebir aynıdır ve buffer'ı
    // paylaşmalılar. Varyant kimliğini yazmak, hiçbir farkı olmayan iki masa
    // için iki mesh üretirdi.
    //
    // Teker ve ekran varyanttan geliyor ama mesh'i değiştiriyorlar, o yüzden
    // ETKİN değerleriyle giriyorlar. Katmana KAPILI DEĞİLLER ve bu bu turda
    // değişti: ikisi de artık iki katmanda da çiziliyor. Eskiden `full &&`
    // yazılıydı ve uzak katmanda teker bayrağı anahtardan tamamen düşüyordu —
    // aynı zarftaki tekerlekli ve tekerleksiz iki tezgâh BİREBİR aynı anahtara
    // çözülüyor ama farklı mesh üretiyordu; önbelleğe ilk giren kazanıyor,
    // öteki masa 100 mm havada ya da tekersiz çiziliyordu.
    hasCastors(node),
    hasMonitorStand(node),
    detail,
    node.frameColor,
    node.timberColor,
  ].join('|')
}

export function getBenchGeometry(node: BenchNode, detail: BenchDetail): THREE.BufferGeometry {
  return getCachedGeometry(benchGeometryKey(node, detail), () =>
    buildParts(node, benchParts(node, detail)),
  )
}

export { releaseGeometry, retainGeometry }

/** Düğüm-nesnesine memoize — bkz. `geometry-key-memo.ts`; çıplak üretici: `buildBenchGeometryKey`. */
export const benchGeometryKey = memoiseGeometryKey(buildBenchGeometryKey, (detail) => detail)
