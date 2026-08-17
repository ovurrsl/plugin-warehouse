/**
 * Palet asansörü geometrisi — ailenin ORTAK havuzunda, ÜÇ birleştirilmiş
 * buffer: STATİK (iskelet + kapı çerçeveleri), PLATFORM (döşeme + rulolar +
 * takozlar) ve KAPI PANELİ (tek panel, N mesh olarak paylaşılır).
 *
 * ## Anahtarda NE YOK, ve neden (dockleveller/geometry.ts başlığının aynısı)
 *
 * - **platform Y / kapı fraksiyonu / çevrim fazı** — hepsi renderer'ın grup
 *   dönüşümü. Hiçbir buffer'a girmez; girselerdi çevrim saatinin her karesi
 *   yeni bir merged buffer bastırırdı.
 * - **`fromLevelId` / `toLevelId` KİMLİK olarak** — anahtara ID'leri değil,
 *   ÇÖZÜLMÜŞ sonuçları (durak listesi) giriyor. Aynı binada, aynı durak
 *   kümesine çözülen iki asansör tek çeliği paylaşır: `stops` parmak izi
 *   anahtarda, kimlikler değil.
 * - **`capacityClass`** — mast KESİTİNE ve platform ölçüsüne çözülür; ham enum
 *   değeri değil o çözülmüş ölçüler anahtarda (`mastSection`, platform dims).
 * - **`hasEnclosure`** — muhafaza AYRI yarı saydam mesh (birleştirilmiş
 *   buffer'da değil), o yüzden statik anahtarda YOK: hiçbir vertex kımıldatmaz,
 *   girmesi paylaşımı bedelsiz bölerdi.
 * - **`platformColor`** — yalnız PLATFORM buffer'ında; `mastColor` yalnız
 *   STATİK'te; `doorColor` STATİK (çerçeve) ve KAPI (panel) buffer'larında.
 *
 * `palletlift.test.ts` iki yönü de (eksik ve aşırı rapor) ölçüyor.
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
import type { ResolvedLift } from './levels'
import { mastSectionM, platformDepthM, platformWidthM, rollerCount } from './metrics'
import {
  colorOf,
  type PalletLiftDetail,
  type PalletLiftPart,
  palletLiftDoorPanelParts,
  palletLiftPlatformParts,
  palletLiftStaticParts,
} from './parts'
import type { PalletLiftNode } from './schema'

function buildParts(node: PalletLiftNode, parts: readonly PalletLiftPart[]): THREE.BufferGeometry {
  const sink: Sink = { positions: [], normals: [], colors: [], uvs: [], indices: [] }
  for (const part of parts) {
    emitPart(sink, part, toLinear(colorOf(node, part.role)), 0)
  }
  return finish(sink)
}

function buildStaticKey(
  node: PalletLiftNode,
  detail: PalletLiftDetail,
  resolved: ResolvedLift,
): string {
  return [
    'pl-static',
    platformWidthM(node).toFixed(3),
    platformDepthM(node).toFixed(3),
    node.mastCount,
    mastSectionM(node).toFixed(3),
    resolved.mastHeight.toFixed(3),
    // Çözülmüş, yeniden tabanlanmış durak kotları — iki lift aynı binada aynı
    // duraklara çözülürse çelik paylaşılır (kimlikler değil, sonuç önemli).
    node.hasDoors ? resolved.stops.map((s) => Math.round(s.baseY * 1000)).join(',') : '-',
    // Kontrol panosu gövdesi statik buffer'da; yalnız tam katmanda stand ekliyor.
    node.hasControlPanel ? `c${detail}` : '-',
    node.mastColor,
    node.hasDoors ? node.doorColor : '-',
    detail,
  ].join('|')
}

function buildPlatformKey(node: PalletLiftNode, detail: PalletLiftDetail): string {
  return [
    'pl-platform',
    platformWidthM(node).toFixed(3),
    platformDepthM(node).toFixed(3),
    rollerCount(node),
    node.platformColor,
    detail,
  ].join('|')
}

function buildDoorKey(node: PalletLiftNode): string {
  // Kapı paneli katmandan bağımsız (tek kutu): detail anahtara girmez.
  return ['pl-door', platformWidthM(node).toFixed(3), node.doorColor].join('|')
}

export function getPalletLiftStaticGeometry(
  node: PalletLiftNode,
  detail: PalletLiftDetail,
  resolved: ResolvedLift,
): THREE.BufferGeometry {
  return getCachedGeometry(palletLiftStaticKey(node, detail, resolved), () =>
    buildParts(node, palletLiftStaticParts(node, detail, resolved.stops, resolved.mastHeight)),
  )
}

export function getPalletLiftPlatformGeometry(
  node: PalletLiftNode,
  detail: PalletLiftDetail,
): THREE.BufferGeometry {
  return getCachedGeometry(palletLiftPlatformKey(node, detail), () =>
    buildParts(node, palletLiftPlatformParts(node, detail)),
  )
}

export function getPalletLiftDoorGeometry(node: PalletLiftNode): THREE.BufferGeometry {
  return getCachedGeometry(palletLiftDoorKey(node), () =>
    buildParts(node, palletLiftDoorPanelParts(node)),
  )
}

export { releaseGeometry, retainGeometry }

/** Düğüm-nesnesine memoize — bkz. `geometry-key-memo.ts`. */
export const palletLiftStaticKey = memoiseGeometryKey(
  buildStaticKey,
  (detail, resolved) => `s:${detail}:${(resolved as ResolvedLift).fingerprint}`,
)
export const palletLiftPlatformKey = memoiseGeometryKey(buildPlatformKey, (detail) => `p:${detail}`)
export const palletLiftDoorKey = memoiseGeometryKey(buildDoorKey, () => 'd')
