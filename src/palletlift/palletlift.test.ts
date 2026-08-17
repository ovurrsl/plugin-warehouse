import { describe, expect, test } from 'bun:test'
import { CATALOG_ITEMS, CATALOG_SECTIONS } from '../catalog'
import { warehouseCatalogPanel, warehousePlugin } from '../index'
import { DOOR_CLOSE_S, DOOR_OPEN_S, DWELL_LOAD_S, OVERTRAVEL_M, SPEED_MPM } from './catalog'
import { buildLiftCycle, cycleLength, stepAt } from './cycle'
import { palletLiftDefinition } from './definition'
import { palletLiftDoorKey, palletLiftPlatformKey, palletLiftStaticKey } from './geometry'
import { mastHeightM, resolveLift, resolveLiftLevels, riseM } from './levels'
import {
  fallbackEnvelopeHeightM,
  footprintM,
  mastEnvelopeHalfXM,
  mastSectionM,
  platformWidthM,
} from './metrics'
import { palletLiftDoorPanelParts, palletLiftPlatformParts, palletLiftStaticParts } from './parts'
import { PalletLiftNode } from './schema'

const lift = (overrides: Record<string, unknown> = {}) =>
  PalletLiftNode.parse({ id: 'pallet-lift_t', parentId: 'lvl0', ...overrides })

/**
 * Bina + üç kat (karışık ordinal/yükseklik/baseElevation). İstifleme
 * (storey.ts anlamı): lvl0 baseY 0 (yük 4), lvl1 baseY 4+baseElev, lvl2 üstünde.
 */
function scene(
  liftOverrides: Record<string, unknown> = {},
  levelPatch: Record<string, Record<string, unknown>> = {},
): Record<string, unknown> {
  const level = (id: string, ordinal: number, height: number, baseElevation = 0) => ({
    id,
    type: 'level',
    level: ordinal,
    height,
    baseElevation,
    children: id === 'lvl0' ? ['pallet-lift_t'] : [],
    ...(levelPatch[id] ?? {}),
  })
  return {
    b1: { id: 'b1', type: 'building', children: ['lvl2', 'lvl0', 'lvl1'] },
    lvl0: level('lvl0', 0, 4),
    lvl1: level('lvl1', 1, 3),
    lvl2: level('lvl2', 2, 3),
    'pallet-lift_t': lift(liftOverrides),
  }
}

// ── 1. Kat çözümü ────────────────────────────────────────────────────────────

describe('kat çözümü host asansörünü yansıtıyor', () => {
  test('varsayılan tüm katları servis ediyor, ordinal sırasıyla', () => {
    const nodes = scene()
    const stops = resolveLiftLevels(nodes, nodes['pallet-lift_t'] as never)
    expect(stops.map((s) => s.id)).toEqual(['lvl0', 'lvl1', 'lvl2'])
    expect(stops.map((s) => s.label)).toEqual(['0', '1', '2'])
    // lvl0=0, lvl1=4, lvl2=7 (yükler 4/3/3, baseElevation 0).
    expect(stops.map((s) => s.baseY)).toEqual([0, 4, 7])
  })

  test('baseElevation katı VE üstündekileri kaydırıyor (storey.ts anlamı)', () => {
    const nodes = scene({}, { lvl1: { baseElevation: 1 } })
    const stops = resolveLiftLevels(nodes, nodes['pallet-lift_t'] as never)
    // lvl0=0, lvl1=4+1=5, lvl2=5+3=8.
    expect(stops.map((s) => s.baseY)).toEqual([0, 5, 8])
  })

  test('from/to indeks kelepçesi — min/max takasıyla', () => {
    // Ters verilmiş uçlar (üst→alt) yine alt..üst dilimini vermeli.
    const nodes = scene({ fromLevelId: 'lvl2', toLevelId: 'lvl0' })
    const stops = resolveLiftLevels(nodes, nodes['pallet-lift_t'] as never)
    expect(stops.map((s) => s.id)).toEqual(['lvl0', 'lvl1', 'lvl2'])

    const clamped = scene({ fromLevelId: 'lvl0', toLevelId: 'lvl1' })
    expect(resolveLiftLevels(clamped, clamped['pallet-lift_t'] as never).map((s) => s.id)).toEqual([
      'lvl0',
      'lvl1',
    ])
  })

  test('kotlar asansörün KENDİ katına yeniden tabanlanıyor', () => {
    // Asansör orta katta (lvl1); tüm katlar servis. Kendi katı 0 olmalı.
    const nodes = scene({ parentId: 'lvl1' })
    const stops = resolveLiftLevels(nodes, nodes['pallet-lift_t'] as never)
    const own = stops.find((s) => s.id === 'lvl1')
    expect(own?.baseY).toBe(0)
    // lvl0 kendi katının ALTINDA → negatif.
    expect(stops.find((s) => s.id === 'lvl0')?.baseY).toBe(-4)
  })

  test('TUZAK: orta kattan yukarı servis edince en alt DURAK 0 (mutlak değil)', () => {
    // Asansör lvl1'de, lvl1→lvl2 servis. Host grubu zaten lvl1 kotuna koyar;
    // mutlak yayınlarsak (yeniden tabanlamazsak) en alt durak 4 çıkar — çift
    // sayım. Doğru cevap 0.
    const nodes = scene({ parentId: 'lvl1', fromLevelId: 'lvl1', toLevelId: 'lvl2' })
    const stops = resolveLiftLevels(nodes, nodes['pallet-lift_t'] as never)
    expect(stops[0]?.baseY).toBe(0)
    expect(stops[stops.length - 1]?.baseY).toBe(3)
  })

  test('mastYüksekliği = seyahat + aşırı seyahat (1.2)', () => {
    const nodes = scene()
    const node = nodes['pallet-lift_t'] as never
    expect(riseM(nodes, node)).toBe(7)
    expect(mastHeightM(nodes, node)).toBeCloseTo(7 + OVERTRAVEL_M, 9)
    expect(OVERTRAVEL_M).toBeCloseTo(1.2, 9)
  })

  test('bina dışında yedek iki duraklı kuyuya düşüyor', () => {
    const node = lift({ parentId: null, fallbackTravelM: 5 })
    const stops = resolveLiftLevels({ 'pallet-lift_t': node }, node)
    expect(stops.length).toBe(2)
    expect(stops.map((s) => s.baseY)).toEqual([0, 5])
    expect(mastHeightM({ 'pallet-lift_t': node }, node)).toBeCloseTo(5 + OVERTRAVEL_M, 9)
  })

  test('BEKÇİ: asla sıfır kat servis edilmiyor — en az iki durak', () => {
    // Tek katlı sahne bile yedek iki durak vermeli, sessizce boş dönmemeli.
    const single: Record<string, unknown> = {
      b1: { id: 'b1', type: 'building', children: ['only'] },
      only: { id: 'only', type: 'level', level: 0, height: 4, children: ['pallet-lift_t'] },
      'pallet-lift_t': lift({ parentId: 'only' }),
    }
    const stops = resolveLiftLevels(single, single['pallet-lift_t'] as never)
    expect(stops.length).toBeGreaterThanOrEqual(2)
  })
})

// ── 2. Çevrim invariyantları ─────────────────────────────────────────────────

describe('çevrim faz makinesi', () => {
  const stops = [{ baseY: 0 }, { baseY: 4 }, { baseY: 7 }]
  const row = { mpm: SPEED_MPM['1000'].mpm }
  const steps = buildLiftCycle(stops, row)

  test('KİLİT: kapı açık her adımda platform tam o durakta', () => {
    for (const step of steps) {
      if (step.doorOpen === 1) {
        expect(step.doorStopIndex).not.toBeNull()
        const stopY = stops[step.doorStopIndex as number]?.baseY ?? Number.NaN
        expect(step.platformY, `${step.phase} kapısı açık ama platform durakta değil`).toBe(stopY)
      }
    }
  })

  test('seyir süresi = mesafe / yayınlanmış hız', () => {
    const mps = row.mpm / 60
    const firstTravel = steps.find((s) => s.phase === 'travel')
    expect(firstTravel).toBeDefined()
    // Alt duraktan ilk çıkış 0→4.
    expect(firstTravel?.durationS).toBeCloseTo(4 / mps, 9)
  })

  test('kapı/bekleme süreleri katalogdan', () => {
    expect(steps.find((s) => s.phase === 'doors-open')?.durationS).toBe(DOOR_OPEN_S)
    expect(steps.find((s) => s.phase === 'loading')?.durationS).toBe(DWELL_LOAD_S)
    expect(steps.find((s) => s.phase === 'doors-close')?.durationS).toBe(DOOR_CLOSE_S)
  })

  test('çevrim deterministik', () => {
    expect(JSON.stringify(buildLiftCycle(stops, row))).toBe(JSON.stringify(steps))
  })

  test('stepAt çevrimin içini geziyor', () => {
    const total = cycleLength(steps)
    expect(total).toBeGreaterThan(0)
    const at = stepAt(steps, total / 2)
    expect(at).not.toBeNull()
    expect(at?.localT).toBeGreaterThanOrEqual(0)
    expect(at?.localT).toBeLessThanOrEqual(1)
  })

  test('iki duraklı yedek kuyu da geçerli bir çevrim üretiyor', () => {
    const two = buildLiftCycle([{ baseY: 0 }, { baseY: 3 }], row)
    expect(two.length).toBeGreaterThan(0)
    for (const step of two) {
      if (step.doorOpen === 1) {
        expect([0, 3]).toContain(step.platformY)
      }
    }
  })
})

// ── 3. Önbellek anahtarı — iki yönlü ─────────────────────────────────────────

describe('geometri anahtarı kapsaması', () => {
  test('bir kat YÜKSEKLİĞİ değişince statik anahtar değişiyor', () => {
    const a = scene()
    const b = scene({}, { lvl1: { height: 5 } })
    const nodeA = a['pallet-lift_t'] as never
    const nodeB = b['pallet-lift_t'] as never
    const keyA = palletLiftStaticKey(nodeA, 'full', resolveLift(a, nodeA))
    const keyB = palletLiftStaticKey(nodeB, 'full', resolveLift(b, nodeB))
    expect(keyA).not.toBe(keyB)
  })

  test('YALNIZ fromLevelId, aynı durak kümesine çözülürse anahtar AYNI', () => {
    // Varsayılan (from/to null) tüm katları servis eder → [0,4,7].
    // fromLevelId=lvl0 de aynı kümeyi verir. Kimlik anahtara girmez, sonuç girer.
    const a = scene()
    const b = scene({ fromLevelId: 'lvl0' })
    const nodeA = a['pallet-lift_t'] as never
    const nodeB = b['pallet-lift_t'] as never
    expect(resolveLift(a, nodeA).stops.map((s) => s.baseY)).toEqual(
      resolveLift(b, nodeB).stops.map((s) => s.baseY),
    )
    const keyA = palletLiftStaticKey(nodeA, 'full', resolveLift(a, nodeA))
    const keyB = palletLiftStaticKey(nodeB, 'full', resolveLift(b, nodeB))
    expect(keyA).toBe(keyB)
  })

  test('platform pozu HİÇBİR anahtarda yok — konum/dönüş anahtarı değiştirmiyor', () => {
    const a = scene()
    const b = scene({ position: [4, 0, -2], rotation: [0, Math.PI / 2, 0] })
    const nodeA = a['pallet-lift_t'] as never
    const nodeB = b['pallet-lift_t'] as never
    const rA = resolveLift(a, nodeA)
    const rB = resolveLift(b, nodeB)
    expect(palletLiftStaticKey(nodeA, 'full', rA)).toBe(palletLiftStaticKey(nodeB, 'full', rB))
    expect(palletLiftPlatformKey(nodeA, 'full')).toBe(palletLiftPlatformKey(nodeB, 'full'))
    expect(palletLiftDoorKey(nodeA)).toBe(palletLiftDoorKey(nodeB))
  })

  test('capacityClass çözülüyor: aynı platform, farklı mast → statik ayrı, platform ortak', () => {
    const a = scene({ capacityClass: '1000', mastCount: '2' })
    const b = scene({ capacityClass: '1500', mastCount: '2' })
    const nodeA = a['pallet-lift_t'] as never
    const nodeB = b['pallet-lift_t'] as never
    // Mast kesiti sınıfla değişir → statik anahtar ayrışır.
    expect(mastSectionM(nodeA)).not.toBe(mastSectionM(nodeB))
    expect(palletLiftStaticKey(nodeA, 'full', resolveLift(a, nodeA))).not.toBe(
      palletLiftStaticKey(nodeB, 'full', resolveLift(b, nodeB)),
    )
    // Platform ölçüsü palet presetinden (sınıftan değil) → platform anahtarı aynı.
    expect(palletLiftPlatformKey(nodeA, 'full')).toBe(palletLiftPlatformKey(nodeB, 'full'))
  })
})

// ── 4. İç içe geçme (AABB) ───────────────────────────────────────────────────

type Box = { center: readonly [number, number, number]; size: readonly [number, number, number] }
function overlaps(a: Box, b: Box, slack = 1e-9): boolean {
  for (const axis of [0, 1, 2] as const) {
    const aMin = a.center[axis] - a.size[axis] / 2
    const aMax = a.center[axis] + a.size[axis] / 2
    const bMin = b.center[axis] - b.size[axis] / 2
    const bMax = b.center[axis] + b.size[axis] / 2
    if (aMax <= bMin + slack || bMax <= aMin + slack) return false
  }
  return true
}
function translate(box: Box, dy: number): Box {
  return { center: [box.center[0], box.center[1] + dy, box.center[2]], size: box.size }
}

describe('çelik iç içe geçmiyor', () => {
  const nodes = scene()
  const node = nodes['pallet-lift_t'] as never
  const resolved = resolveLift(nodes, node)
  const staticParts = palletLiftStaticParts(node, 'full', resolved.stops, resolved.mastHeight)
  const platformParts = palletLiftPlatformParts(node, 'full')
  const masts = staticParts.filter((p) => p.role === 'mast')
  const doorFrames = staticParts.filter((p) => p.role === 'door-frame')

  test('platform her durakta mastları ve kapı çerçevelerini temizliyor', () => {
    for (const stop of resolved.stops) {
      for (const platform of platformParts) {
        const moved = translate(platform, stop.baseY)
        for (const mast of masts) {
          expect(overlaps(moved, mast), `platform mast'a giriyor @${stop.baseY}`).toBe(false)
        }
        for (const frame of doorFrames) {
          expect(overlaps(moved, frame), `platform kapı çerçevesine giriyor @${stop.baseY}`).toBe(
            false,
          )
        }
      }
    }
  })

  test('muhafaza mastların DIŞINDA', () => {
    const encHalfX = mastEnvelopeHalfXM(node) + 1e-9
    for (const mast of masts) {
      const outerX = Math.abs(mast.center[0]) + mast.size[0] / 2
      expect(outerX).toBeLessThanOrEqual(encHalfX)
    }
  })

  test('kapı paneli kendi çerçevesinin içinde', () => {
    const panel = palletLiftDoorPanelParts(node)[0]
    if (!panel) throw new Error('kapı paneli bekleniyordu')
    // Panel X genişliği açıklıktan (platformWidth) dar.
    expect(panel.size[0]).toBeLessThan(platformWidthM(node))
    // Panel çerçeve söveleri arasında — söveler ±(width/2 + frame/2).
    const jambInner = doorFrames
      .filter((f) => f.size[1] > f.size[0]) // dikey söveler
      .map((f) => Math.abs(f.center[0]) - f.size[0] / 2)
    const innermost = Math.min(...jambInner)
    expect(panel.size[0] / 2).toBeLessThanOrEqual(innermost + 1e-9)
  })
})

// ── 5. Tanım ve manifest ─────────────────────────────────────────────────────

describe('tanım ve manifest', () => {
  test('varsayılanlar şemadan geliyor, sabit ad yok', () => {
    const defaults = palletLiftDefinition.defaults() as Record<string, unknown>
    expect('name' in defaults).toBe(false)
    expect(defaults.capacityClass).toBe('1000')
    expect(defaults.mastCount).toBe('2')
  })

  test('manifest kind’ı taşıyor', () => {
    const kinds = (warehousePlugin.nodes ?? []).map((n) => (n as { kind: string }).kind)
    expect(kinds).toContain('warehouse:pallet-lift')
  })

  test('panel kind listesi manifestle aynı fikirde', () => {
    expect(warehouseCatalogPanel.kinds).toContain('warehouse:pallet-lift')
  })

  test('katalog fişleri var ve bölümleri gerçek', () => {
    const tiles = CATALOG_ITEMS.filter((item) => item.kind === 'warehouse:pallet-lift')
    expect(tiles.length).toBe(2)
    const sections = new Set(CATALOG_SECTIONS.map((section) => section.id))
    for (const tile of tiles) expect(sections.has(tile.sectionId)).toBe(true)
    // İki fiş de AYNI alan kümesini yazıyor (fırça-yapışkanlık).
    for (const tile of tiles) {
      expect(tile.brush?.kind).toBe('pallet-lift')
      const patch = (tile.brush as { patch: Record<string, unknown> }).patch
      expect(Object.keys(patch).sort()).toEqual(['capacityClass', 'mastCount'])
    }
  })

  test('dönüş adımı 90°', () => {
    const angles = palletLiftDefinition.capabilities.rotatable.snapAngles
    expect(angles.length).toBe(4)
    expect(angles[1]).toBeCloseTo(Math.PI / 2, 9)
  })

  test('ağaç etiketi kapasiteyle dinamik', () => {
    const node = lift()
    expect(palletLiftDefinition.tree.label(node as never)).toBe('Pallet Lift · 1000 kg')
    expect(palletLiftDefinition.tree.label(lift({ name: 'Asansör A' }) as never)).toBe('Asansör A')
  })

  test('floorPlaced izi tam zarf, yüksekliği mast yüksekliği tahmini', () => {
    const node = lift() as never
    const fp = palletLiftDefinition.capabilities.floorPlaced.footprint(node)
    const foot = footprintM(node)
    expect(fp.dimensions[0]).toBeCloseTo(foot[0], 9)
    expect(fp.dimensions[2]).toBeCloseTo(foot[1], 9)
    expect(fp.dimensions[1]).toBeCloseTo(fallbackEnvelopeHeightM(node), 9)
    // collides kapalı — 3B doğruluk clash.ts'te.
    expect(palletLiftDefinition.capabilities.floorPlaced.collides).toBe(false)
  })
})
