/**
 * Kutu ötesi şekiller — aynı Sink'e, aynı dört attribute'la.
 *
 * "Kutu kutu çizilmiş" eleştirisinin iki kökü var: tekerleğin kutu olması ve
 * gövde hatlarının hep dik kesilmesi. İkisi de burada çözülür — conveyor'ün
 * `Sink` sözleşmesine yazan iki ek emitter: düz-yüzeyli silindir (tekerlek,
 * direksiyon) ve tepesi eğimli kutu (kaput, karşı ağırlık, koltuk sırtı).
 *
 * Attribute paritesi bozulmaz: her emitter `position/normal/color/uv`
 * dördünü de yazar (T19 bunu her gövdede zaten kilitliyor). UV her yerde
 * düz renk bölgesindedir — araçta desen atlası yok.
 */

import type { Sink } from '../conveyor/geometry-builder'

/** Tekerleğin döndüğü eksen: araçta hep Z (enine). Direksiyon için Y. */
export type CylinderAxis = 'y' | 'z'

/**
 * Düz-yüzeyli (flat-shaded) silindir prizması.
 *
 * `segments` katmana göre gelir — §3.2'nin tekerlek kuralı kelimesi
 * kelimesine: "aynı sayı, aynı pozisyon, daha az segment". 12 kenar yakında
 * yuvarlak okunur; 8 kenar uzakta aynı zarfı korur.
 */
export function emitCylinder(
  sink: Sink,
  args: {
    center: readonly [number, number, number]
    radius: number
    length: number
    axis: CylinderAxis
    segments: number
  },
  color: readonly [number, number, number],
): void {
  const { center, radius, length, axis, segments } = args
  const [cx, cy, cz] = center
  const half = length / 2

  // Kesit köşeleri. Yarım-adım açı bir DÜZ KENARI tam alta getirir ve
  // `radius` APOTEM olarak okunur (çevrel yarıçap ona göre büyütülür):
  // böylece tekerleğin altı tam `center.y − radius`'ta yere basar — T26'nın
  // [0, 1 mm] bandı segment sayısından bağımsız tutar.
  const circumradius = radius / Math.cos(Math.PI / segments)
  const ring: Array<[number, number]> = []
  for (let i = 0; i < segments; i++) {
    const a = ((i + 0.5) / segments) * Math.PI * 2
    ring.push([Math.cos(a) * circumradius, Math.sin(a) * circumradius])
  }

  const to3D = (u: number, v: number, w: number): [number, number, number] =>
    axis === 'z' ? [cx + u, cy + v, cz + w] : [cx + u, cy + w, cz + v]

  const pushVertex = (p: [number, number, number], n: [number, number, number]) => {
    sink.positions.push(p[0], p[1], p[2])
    sink.normals.push(n[0], n[1], n[2])
    sink.colors.push(color[0], color[1], color[2])
    sink.uvs.push(0.25, 0) // ATLAS_BLANK bölgesi — düz renk
  }

  // Yan yüzler: segment başına bir quad, düz normal.
  for (let i = 0; i < segments; i++) {
    const [ax, ay] = ring[i] as [number, number]
    const [bx, by] = ring[(i + 1) % segments] as [number, number]
    const nx = (ax + bx) / 2
    const ny = (ay + by) / 2
    const nl = Math.hypot(nx, ny) || 1
    const normal = to3D(nx / nl, ny / nl, 0).map((v, k) => v - [cx, cy, cz][k]!) as [
      number,
      number,
      number,
    ]
    const base = sink.positions.length / 3
    pushVertex(to3D(ax, ay, -half), normal)
    pushVertex(to3D(bx, by, -half), normal)
    pushVertex(to3D(bx, by, half), normal)
    pushVertex(to3D(ax, ay, half), normal)
    if (axis === 'z') sink.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    else sink.indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
  }

  // Kapaklar: yelpaze.
  for (const side of [-1, 1] as const) {
    const w = side * half
    const capNormal = to3D(0, 0, side).map((v, k) => v - [cx, cy, cz][k]!) as [
      number,
      number,
      number,
    ]
    const base = sink.positions.length / 3
    for (const [x, y] of ring) pushVertex(to3D(x, y, w), capNormal)
    for (let i = 1; i < segments - 1; i++) {
      const flip = (axis === 'z' && side === 1) || (axis === 'y' && side === -1)
      if (flip) sink.indices.push(base, base + i, base + i + 1)
      else sink.indices.push(base, base + i + 1, base + i)
    }
  }
}

/**
 * Tepesi bir yöne eğimli kutu — kaputun buruna inişi, karşı ağırlığın arkaya
 * yuvarlanışı, koltuk sırtının yatışı. `drop`: üst yüzün `face` kenarının
 * aşağı inme miktarı; 0'da düz kutudur.
 */
export function emitSlopedBox(
  sink: Sink,
  args: {
    center: readonly [number, number, number]
    size: readonly [number, number, number]
    face: 'front' | 'back'
    drop: number
  },
  color: readonly [number, number, number],
): void {
  const [cx, cy, cz] = args.center
  const [hx, hy, hz] = [args.size[0] / 2, args.size[1] / 2, args.size[2] / 2]
  const drop = Math.min(args.drop, args.size[1])
  const frontTop = cy + hy - (args.face === 'front' ? drop : 0)
  const backTop = cy + hy - (args.face === 'back' ? drop : 0)

  // 8 köşe: alt düzlem sabit, üst düzlem X'e göre eğimli.
  const corners: Record<string, [number, number, number]> = {
    fbl: [cx + hx, cy - hy, cz - hz],
    fbr: [cx + hx, cy - hy, cz + hz],
    bbl: [cx - hx, cy - hy, cz - hz],
    bbr: [cx - hx, cy - hy, cz + hz],
    ftl: [cx + hx, frontTop, cz - hz],
    ftr: [cx + hx, frontTop, cz + hz],
    btl: [cx - hx, backTop, cz - hz],
    btr: [cx - hx, backTop, cz + hz],
  }

  const quad = (
    a: string,
    b: string,
    c: string,
    d: string,
    normal: [number, number, number],
  ): void => {
    const base = sink.positions.length / 3
    for (const key of [a, b, c, d]) {
      const p = corners[key] as [number, number, number]
      sink.positions.push(p[0], p[1], p[2])
      sink.normals.push(normal[0], normal[1], normal[2])
      sink.colors.push(color[0], color[1], color[2])
      sink.uvs.push(0.25, 0)
    }
    sink.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  // Eğimli üst yüzün normali.
  const slopeLen = Math.hypot(2 * hx, frontTop - backTop) || 1
  const topNormal: [number, number, number] = [
    -(frontTop - backTop) / slopeLen,
    (2 * hx) / slopeLen,
    0,
  ]

  quad('bbr', 'fbr', 'ftr', 'btr', [0, 0, 1])
  quad('fbl', 'bbl', 'btl', 'ftl', [0, 0, -1])
  quad('fbr', 'fbl', 'ftl', 'ftr', [1, 0, 0])
  quad('bbl', 'bbr', 'btr', 'btl', [-1, 0, 0])
  quad('btr', 'ftr', 'ftl', 'btl', topNormal)
  quad('bbl', 'fbl', 'fbr', 'bbr', [0, -1, 0])
}
