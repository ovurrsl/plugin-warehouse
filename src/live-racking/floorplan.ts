import type { FloorplanGeometry, GeometryContext } from '@pascal-app/core'
import { PALETTE } from './catalog'
import {
  bayWidthM,
  channelDepthM,
  hasBrakeRollers,
  palletRunDepthM,
  rollerLengthM,
} from './metrics'
import type { LiveRackingNode } from './schema'

/**
 * Plan sembolü — selective raftan GÖRSEL OLARAK ayrılmak zorunda.
 *
 * İki raf tipi planda aynı dikdörtgen olsaydı, bir yerleşimi okuyan kişi
 * yerçekimi kanalını sıradan bir gözle karıştırırdı; ikisi bambaşka
 * çalışıyor (biri iki koridor ve tek SKU ister, öteki her gözden erişilir).
 * Ayrımı iki şey taşıyor:
 *
 *   1. **Makara taraması** — akışa dik kısa çizgiler. Selective'de yok.
 *   2. **Akış oku** — çıkış ucuna bakan üçgen. FIFO'da tek yön; LIFO
 *      push-back'te aynı uçta çift baş, çünkü yükleme ve alma aynı yerden.
 *
 * Ölçüler 3B ile AYNI fonksiyonlardan (`bayWidthM`, `channelDepthM`,
 * `rollerLengthM`) — ikinci bir konum hesabı sessizce ayrışacak bir kopya.
 */
export function buildLiveRackingFloorplan(
  node: LiveRackingNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const width = bayWidthM(node)
  const depth = channelDepthM(node)
  const view = ctx.viewState
  const selected = view?.selected ?? false

  const stroke = selected ? (view?.palette.selectedStroke ?? '#e69a47') : PALETTE.upright
  const fill = selected ? (view?.palette.selectedFill ?? '#fce8cc') : '#dbe4f0'
  const hatch = selected ? stroke : '#8d99a6'
  const flow = selected ? stroke : PALETTE.beam

  const halfWidth = width / 2
  const halfDepth = depth / 2

  const children: FloorplanGeometry[] = [
    {
      kind: 'rect',
      x: -halfWidth,
      y: -halfDepth,
      width,
      height: depth,
      fill,
      stroke,
      strokeWidth: 0.03,
    },
  ]

  // ── Makara taraması ────────────────────────────────────────────────────
  // Gerçek makara aralığı 75 mm; planda o sıklıkta çizmek dikdörtgeni
  // doldurup kapatırdı. Palet adımında çiziliyor: okunan bilgi "burası
  // makaralı bir kanal" ve "kaç palet derin", ikisi de bu adımda görünür.
  const rollerHalf = rollerLengthM(node) / 2
  const step = palletRunDepthM(node)
  const marks = Math.max(1, Math.round(depth / step))
  for (let i = 1; i < marks; i++) {
    const z = -halfDepth + (i / marks) * depth
    children.push({
      kind: 'rect',
      x: -rollerHalf,
      y: z - 0.012,
      width: rollerHalf * 2,
      height: 0.024,
      fill: hatch,
      stroke: hatch,
      strokeWidth: 0.004,
    })
  }

  // ── Akış oku ───────────────────────────────────────────────────────────
  // Çıkış ucu −Z (alçak). Ok gövdesi kanalın ortasında, başı çıkışa bakıyor.
  const shaftFrom = halfDepth * 0.55
  const shaftTo = -halfDepth * 0.55
  children.push({
    kind: 'rect',
    x: -0.025,
    y: shaftTo,
    width: 0.05,
    height: shaftFrom - shaftTo,
    fill: flow,
    stroke: flow,
    strokeWidth: 0.006,
  })
  children.push({
    kind: 'polygon',
    points: [
      [-halfWidth * 0.22, shaftTo + 0.35],
      [0, shaftTo],
      [halfWidth * 0.22, shaftTo + 0.35],
    ],
    fill: flow,
    stroke: flow,
    strokeWidth: 0.01,
  })
  if (node.variant === 'LIFO') {
    // Push-back: aynı uçtan yükle ve al. İkinci baş ters yöne bakar ve
    // sembol "bu kanal tek koridorlu" demiş olur.
    children.push({
      kind: 'polygon',
      points: [
        [-halfWidth * 0.22, shaftFrom - 0.35],
        [0, shaftFrom],
        [halfWidth * 0.22, shaftFrom - 0.35],
      ],
      fill: flow,
      stroke: flow,
      strokeWidth: 0.01,
    })
  }

  // ── Giriş / çıkış uç işaretleri ────────────────────────────────────────
  // Giriş (+Z) yüksek uç: kalın bant. Çıkış (−Z): fren/durdurucu rengi.
  children.push({
    kind: 'rect',
    x: -halfWidth,
    y: halfDepth - 0.06,
    width,
    height: 0.06,
    fill: hatch,
    stroke: hatch,
    strokeWidth: 0.004,
  })
  children.push({
    kind: 'rect',
    x: -halfWidth,
    y: -halfDepth,
    width,
    height: 0.06,
    fill: hasBrakeRollers(node) ? PALETTE.brake : PALETTE.stop,
    stroke: stroke,
    strokeWidth: 0.004,
  })

  if (selected) {
    children.push({
      kind: 'dimension-label',
      cx: 0,
      cy: -halfDepth - 0.6,
      text: `${node.variant} · ${node.levels}×${node.palletsDeep} palet · E ${(width * 1000).toFixed(0)} mm · X ${depth.toFixed(2)} m`,
      angle: 0,
      screenUpright: true,
    })
  }

  const rotation = Array.isArray(node.rotation) ? (node.rotation[1] ?? 0) : 0

  return {
    kind: 'group',
    children,
    transform: {
      translate: [node.position?.[0] ?? 0, node.position?.[2] ?? 0],
      rotate: -rotation,
    },
  }
}
