import { beforeEach, describe, expect, test } from 'bun:test'
import type { GeometryContext } from '@pascal-app/core'
import { CATALOG_ITEMS, CATALOG_SECTIONS } from '../catalog'
import { warehouseCatalogPanel, warehousePlugin } from '../index'
import { buildNetwork } from './flow-simulation'
import { clearConveyorGeometryCache } from './geometry-builder'
import { resetLineIndex } from './line-index'
import { moduleLengthM } from './metrics'
import { mateBlockers, resetPortMagnet, snapToLineEnd } from './port-magnet'
import { localPorts, transportHeightAt } from './ports'
import { ConveyorRollerNode } from './schema'
import {
  SPIRAL_MAX_INCLINE_DEG,
  SPIRAL_PALLET_MIN_DIAMETER_MM,
  SPIRAL_UNPUBLISHED_NOTE,
} from './spiral-catalog'
import { conveyorSpiralDefinition } from './spiral-definition'
import { buildSpiralFloorplan } from './spiral-floorplan'
import {
  getSpiralSlatGeometry,
  getSpiralStaticGeometry,
  spiralSlatKey,
  spiralStaticKey,
} from './spiral-geometry'
import {
  beltWidthM,
  cageRadiusM,
  columnRadiusM,
  entryHeightM,
  exitHeightM,
  footprintM,
  handrailRadiusM,
  helixRadiusM,
  inclineRad,
  legRadiusM,
  overallHeightM,
  pitchM,
  portSpanM,
  SPIRAL_MAX_BOXES,
  screwYawPerStep,
  screwYPerStep,
  slatOuterRadiusM,
  spiralBoxCount,
  spiralBoxRateRadPerSec,
  spiralBoxStepRad,
  totalAngleRad,
} from './spiral-metrics'
import { conveyorSpiralParametrics } from './spiral-parametrics'
import { SLAT_MARGIN_COUNT, screwCenter, spiralSlatParts } from './spiral-parts'
import { ConveyorSpiralNode } from './spiral-schema'

const spiral = (overrides: Record<string, unknown> = {}) =>
  ConveyorSpiralNode.parse({ id: 'conveyor-spiral_t', ...overrides })

const CTX_UNSELECTED = {} as GeometryContext
const CTX_SELECTED = {
  viewState: { selected: true, palette: { selectedStroke: '#fff', selectedFill: '#333' } },
} as unknown as GeometryContext

type Shape = 'static' | 'slat'
type Detail = 'full' | 'simple'

const GEOMETRY = {
  static: getSpiralStaticGeometry,
  slat: getSpiralSlatGeometry,
} as const
const KEY = { static: spiralStaticKey, slat: spiralSlatKey } as const

/** Mesh'in ölçülebilir parmak izi: konum + renk tamponu. */
function fingerprint(node: ConveyorSpiralNode, shape: Shape, detail: Detail): string {
  clearConveyorGeometryCache()
  const geometry = GEOMETRY[shape](node, detail)
  const position = geometry.getAttribute('position').array
  const color = geometry.getAttribute('color').array
  return `${Array.from(position).join(',')}|${Array.from(color).join(',')}`
}

// ── 1. Geometri anahtarı: iki yönlü kapsama ──────────────────────────────────

describe('geometri anahtarı kapsaması — iki yönlü', () => {
  beforeEach(() => {
    clearConveyorGeometryCache()
  })

  /**
   * Her satır bir alanı oynatıyor; test hangi yöne düşeceğini VARSAYMIYOR.
   * Mesh ölçülüyor, anahtarla karşılaştırılıyor: eksik rapor iki sarmalın tek
   * buffer'ı paylaşması, aşırı rapor paylaşımın bedelsiz bölünmesi.
   */
  const VARIANTS: Array<
    [label: string, base: Record<string, unknown>, changed: Record<string, unknown>]
  > = [
    ['dış çap', {}, { outerDiameter: '1800' }],
    ['bant genişliği', {}, { beltWidth: '650' }],
    ['yükseklik', {}, { travelHeight: 6 }],
    ['eğim', {}, { inclineDeg: 8 }],
    ['giriş kotu', {}, { entryHeight: 1.2 }],
    ['kiralite', {}, { handedness: 'cw' }],
    ['korkuluk', {}, { hasHandrail: false }],
    ['gövde rengi', {}, { frameColor: '#112233' }],
    ['ayak rengi', {}, { legColor: '#445566' }],
    // POZ / AKIŞ / SINIF — hiçbiri hiçbir vertex kımıldatmıyor.
    ['akış', {}, { flow: 'down' }],
    ['kafes', {}, { hasCage: false }],
    ['yük sınıfı', {}, { loadClass: 'pallet', outerDiameter: '2400' }],
    ['ad', {}, { name: 'Spiral 2' }],
    ['konum', {}, { position: [4, 0, -2] }],
    ['dönüş', {}, { rotation: [0, Math.PI / 2, 0] }],
  ]

  for (const shape of ['static', 'slat'] as const) {
    for (const detail of ['full', 'simple'] as const) {
      for (const [label, base, changed] of VARIANTS) {
        test(`${shape}/${detail}: ${label} — anahtar ile mesh aynı cevabı veriyor`, () => {
          const before = spiral(base)
          const after = spiral({ ...base, ...changed })

          const meshChanged =
            fingerprint(before, shape, detail) !== fingerprint(after, shape, detail)
          const keyChanged = KEY[shape](before, detail) !== KEY[shape](after, detail)

          expect(
            keyChanged,
            `${shape}/${label}: mesh ${meshChanged ? 'değişti' : 'değişmedi'}`,
          ).toBe(meshChanged)
        })
      }
    }
  }

  test('flow HİÇBİR anahtarda geçmiyor — animasyon yönü bir poz', () => {
    const up = spiral({ flow: 'up' })
    const down = spiral({ flow: 'down' })
    for (const detail of ['full', 'simple'] as const) {
      expect(spiralStaticKey(up, detail)).toBe(spiralStaticKey(down, detail))
      expect(spiralSlatKey(up, detail)).toBe(spiralSlatKey(down, detail))
    }
  })

  test('loadClass anahtarı BÖLMÜYOR — geometriyi yalnız çözülmüş değerleri etkiler', () => {
    // Aynı çap/bantta iki farklı sınıf tek buffer'ı paylaşmalı.
    const light = spiral({ loadClass: 'light', outerDiameter: '2400', beltWidth: '500' })
    const pallet = spiral({ loadClass: 'pallet', outerDiameter: '2400', beltWidth: '500' })
    for (const detail of ['full', 'simple'] as const) {
      expect(spiralStaticKey(light, detail)).toBe(spiralStaticKey(pallet, detail))
      expect(spiralSlatKey(light, detail)).toBe(spiralSlatKey(pallet, detail))
    }
  })

  test('detay katmanı anahtarı böler', () => {
    const node = spiral()
    expect(spiralStaticKey(node, 'full')).not.toBe(spiralStaticKey(node, 'simple'))
    expect(spiralSlatKey(node, 'full')).not.toBe(spiralSlatKey(node, 'simple'))
  })
})

// ── 2. Vida invaryansı ───────────────────────────────────────────────────────

describe('vida invaryansı — slat aralığı helis boyunca DÜZGÜN', () => {
  /**
   * Band SABİT (koliler hareket ediyor), ama slat'ların helis boyunca EŞİT
   * aralıklı olması hâlâ şart: aksi hâlde yüzey sürekli bir band gibi
   * okunmaz, deliklenir. Bu test her slat'ın bir vida hareketiyle (Y dönüşü +
   * Y ötelemesi) TAM olarak bir sonrakine oturduğunu kanıtlıyor — helisin
   * vida simetrisi, yani aralığın t'de düzgünlüğü. Marj slat (kaynak) hariç,
   * ardışık her çift.
   */
  for (const combo of [
    {},
    { handedness: 'cw' as const },
    { inclineDeg: 6 },
    { outerDiameter: '2400' as const, beltWidth: '650' as const },
  ]) {
    test(`combo ${JSON.stringify(combo)}`, () => {
      const node = spiral(combo)
      const slats = spiralSlatParts(node, 'full')
      const yaw = screwYawPerStep(node, 'full')
      const dy = screwYPerStep(node, 'full')
      expect(slats.length).toBeGreaterThan(3)
      for (let k = SLAT_MARGIN_COUNT; k < slats.length - 1; k++) {
        const moved = screwCenter(slats[k]!.center, yaw, dy)
        const next = slats[k + 1]!.center
        expect(moved[0]).toBeCloseTo(next[0], 6)
        expect(moved[1]).toBeCloseTo(next[1], 6)
        expect(moved[2]).toBeCloseTo(next[2], 6)
      }
    })
  }
})

// ── 3. Helis matematiği vs yayınlanmış sınırlar ──────────────────────────────

describe('helis matematiği yayınlanmış formül ve sınırlarla', () => {
  test('varsayılan hafif eğim ≤12,5°, palet ≤13°', () => {
    expect(spiral({ loadClass: 'light' }).inclineDeg).toBeLessThanOrEqual(
      SPIRAL_MAX_INCLINE_DEG.light,
    )
    expect(spiral({ loadClass: 'pallet', outerDiameter: '2400' }).inclineDeg).toBeLessThanOrEqual(
      SPIRAL_MAX_INCLINE_DEG.pallet,
    )
  })

  test('pitch = 2π·R·tan(eğim) — spec §3 birebir', () => {
    for (const combo of [{}, { inclineDeg: 6 }, { outerDiameter: '2400' as const }]) {
      const node = spiral(combo)
      const expected = 2 * Math.PI * helixRadiusM(node) * Math.tan(inclineRad(node))
      expect(pitchM(node)).toBeCloseTo(expected, 9)
    }
  })

  test('iki port kotu TAM olarak travelHeight kadar ayrı', () => {
    const node = spiral({ travelHeight: 4, entryHeight: 0.75 })
    const ports = localPorts(node)
    const a = ports.find((p) => p.id === 'a')!
    const b = ports.find((p) => p.id === 'b')!
    expect(b.y - a.y).toBeCloseTo(4, 9)
    expect(transportHeightAt(node, 'a')).toBeCloseTo(entryHeightM(node), 9)
    expect(transportHeightAt(node, 'b')).toBeCloseTo(exitHeightM(node), 9)
  })

  test('R = (dış çap − bant)/2', () => {
    const node = spiral({ outerDiameter: '1500', beltWidth: '500' })
    expect(helixRadiusM(node)).toBeCloseTo((1.5 - 0.5) / 2, 9)
  })
})

// ── 4. Çakışma (interpenetrasyon) ────────────────────────────────────────────

/** Bir slat kutusunun 8 köşesi — emitPart'ın tilt-sonra-yaw matematiğiyle. */
function slatCorners(slat: {
  center: readonly [number, number, number]
  size: readonly [number, number, number]
  rotationY: number
  tiltX: number
}): Array<[number, number, number]> {
  const [cx, cy, cz] = slat.center
  const hx = slat.size[0] / 2
  const hy = slat.size[1] / 2
  const hz = slat.size[2] / 2
  const cos = Math.cos(slat.rotationY)
  const sin = Math.sin(slat.rotationY)
  const cosT = Math.cos(slat.tiltX)
  const sinT = Math.sin(slat.tiltX)
  const pts: Array<[number, number, number]> = []
  for (const ex of [-1, 1]) {
    for (const ey of [-1, 1]) {
      for (const ez of [-1, 1]) {
        const ox = ex * hx
        const ty = ey * hy * cosT - ez * hz * sinT
        const tz = ey * hy * sinT + ez * hz * cosT
        pts.push([cx + ox * cos - tz * sin, cy + ty, cz + ox * sin + tz * cos])
      }
    }
  }
  return pts
}

describe('çakışma — çelik birbirinin içine girmiyor', () => {
  const COMBOS = [
    {},
    { outerDiameter: '1800' as const },
    { outerDiameter: '2400' as const },
    { outerDiameter: '2400' as const, beltWidth: '650' as const },
  ]

  test('hiçbir slat köşesi merkez kolonun içinde değil', () => {
    for (const combo of COMBOS) {
      const node = spiral(combo)
      const colR = columnRadiusM(node)
      for (const slat of spiralSlatParts(node, 'full')) {
        for (const [x, , z] of slatCorners(slat)) {
          const distance = Math.hypot(x, z)
          expect(distance, `${JSON.stringify(combo)}: slat kolona giriyor`).toBeGreaterThan(colR)
        }
      }
      // Halka iç kenarı da kolonu geçmeli — temiz değişmez.
      expect(helixRadiusM(node) - beltWidthM(node) / 2).toBeGreaterThan(colR)
    }
  })

  test('ayaklar slat halkasının DIŞINDA', () => {
    for (const combo of COMBOS) {
      const node = spiral(combo)
      expect(legRadiusM(node)).toBeGreaterThan(slatOuterRadiusM(node))
    }
  })

  test('kafes yarıçapı korkuluk ofset yarıçapından büyük', () => {
    for (const combo of COMBOS) {
      const node = spiral(combo)
      expect(cageRadiusM(node)).toBeGreaterThan(handrailRadiusM(node))
    }
  })
})

// ── 5. Mıknatıs — kuyruk kotu birleşmenin şartı ──────────────────────────────

describe('sarmal mıknatısı — port kotu port başına', () => {
  const roller = (overrides: Record<string, unknown> = {}) =>
    ConveyorRollerNode.parse({ id: 'conveyor_roller_line', rollers: 40, ...overrides })
  const scene = (...nodes: Array<{ id: string }>) =>
    Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<string, unknown>

  beforeEach(() => {
    resetLineIndex()
    resetPortMagnet()
  })

  test('şerit ve kot uyunca giriş portu hattın çıkışına oturur (0,75 m)', () => {
    const line = roller({ position: [0, 0, 0], usefulWidth: '400', transportHeight: 0.75 })
    const boom = spiral({
      id: 'conveyor-spiral_s',
      beltWidth: '400',
      entryHeight: 0.75,
      flow: 'up',
    })
    const span = portSpanM(boom)
    const seam = moduleLengthM(line) / 2
    const target = seam + span

    const snapped = snapToLineEnd(boom, [target - 0.08, 0, 0.05], 0, [boom.id], scene(line, boom))
    expect(snapped).not.toBeNull()
    expect(snapped?.[0]).toBeCloseTo(target, 6)
    expect(snapped?.[2]).toBeCloseTo(0, 6)
    expect(mateBlockers(boom, [target, 0, 0], 0, { [line.id]: line })).toEqual([])
  })

  test('uyuşmayan kot REDDEDİLİR — defaults-never-mate tuzağının bekçisi', () => {
    const boom = spiral({
      id: 'conveyor-spiral_s',
      beltWidth: '400',
      entryHeight: 0.75,
      flow: 'up',
    })
    const span = portSpanM(boom)
    // Giriş kotu 0,75; roller 0,95 → basamak, birleşme engeli.
    const line = roller({ position: [0, 0, 0], usefulWidth: '400', transportHeight: 0.95 })
    const seam = moduleLengthM(line) / 2
    const target = seam + span
    const blockers = mateBlockers(boom, [target, 0, 0], 0, { [line.id]: line })
    expect(blockers.length).toBeGreaterThan(0)
    expect(blockers.join(' ')).toContain('kot')
  })
})

// ── 6. Akış ertelemesi belgelenmiş ───────────────────────────────────────────

describe('akış simülasyonu sarmalı ATLIYOR — helis 2D Route ile modellenemiyor', () => {
  const roller = (id: string, position: [number, number, number]) =>
    ConveyorRollerNode.parse({ id, rollers: 40, position })

  test('roller→sarmal→roller sahnesinde sarmal rotası yok', () => {
    const line1 = roller('conveyor_roller_1', [0, 0, 0])
    const s = spiral({ id: 'conveyor-spiral_s', position: [10, 0, 0] })
    const line2 = roller('conveyor_roller_2', [20, 0, 0])
    const nodes = {
      [line1.id]: line1,
      [s.id]: s,
      [line2.id]: line2,
    } as Record<string, unknown>

    const network = buildNetwork(nodes)
    expect(network.modules.has(s.id)).toBe(false)
    expect(network.routes.has(s.id)).toBe(false)
    // Rollerlar ağa GİRİYOR — atlanan yalnız sarmal.
    expect(network.modules.has(line1.id)).toBe(true)
    expect(network.modules.has(line2.id)).toBe(true)
  })
})

// ── 7. Parametrik değişmezler ────────────────────────────────────────────────

describe('parametrik değişmezler — sınıf kuralları', () => {
  const invariant = conveyorSpiralParametrics.invariants?.[0]
  if (!invariant) throw new Error('invariant bekleniyordu')

  test('palet sınıfı < 2400 mm dış çap → HATA', () => {
    const issues = invariant(spiral({ loadClass: 'pallet', outerDiameter: '1500' }))
    const err = issues.find((i) => i.field === 'outerDiameter' && i.severity === 'error')
    expect(err).toBeDefined()
    expect(err?.msg).toContain(String(SPIRAL_PALLET_MIN_DIAMETER_MM))
  })

  test('hafif sınıf > 12,5° eğim → UYARI', () => {
    const issues = invariant(spiral({ loadClass: 'light', inclineDeg: 13 }))
    expect(issues.some((i) => i.field === 'inclineDeg' && i.severity === 'warning')).toBe(true)
  })

  test('palet 13° eğimde hafif-sınıf uyarısı YOK', () => {
    const issues = invariant(spiral({ loadClass: 'pallet', inclineDeg: 13, outerDiameter: '2400' }))
    expect(issues.some((i) => i.field === 'inclineDeg')).toBe(false)
  })

  test('uyarı metinleri boş değil', () => {
    for (const issue of invariant(spiral({ loadClass: 'pallet', outerDiameter: '1500' }))) {
      expect(issue.msg.length).toBeGreaterThan(20)
    }
  })
})

// ── Plan sembolü ─────────────────────────────────────────────────────────────

describe('plan sembolü', () => {
  test('seçiliyken çap + tur etiketi çizilir, hiçbir dolgu fill: none değil', () => {
    const plan = buildSpiralFloorplan(spiral(), CTX_SELECTED)
    if (plan?.kind !== 'group') throw new Error('grup bekleniyordu')
    for (const child of plan.children) {
      if ('fill' in child) expect(child.fill).not.toBe('none')
    }
    const label = plan.children.find((child) => child.kind === 'dimension-label')
    expect(label).toBeDefined()
  })

  test('seçili değilken etiket yok', () => {
    const plan = buildSpiralFloorplan(spiral(), CTX_UNSELECTED)
    if (plan?.kind !== 'group') throw new Error('grup bekleniyordu')
    expect(plan.children.some((child) => child.kind === 'dimension-label')).toBe(false)
  })
})

// ── Tanım ve manifest ────────────────────────────────────────────────────────

describe('tanım ve manifest', () => {
  test('parse({}) başarılı, gidiş-dönüş kayıpsız, sabit ad yok', () => {
    const first = ConveyorSpiralNode.parse({})
    expect(ConveyorSpiralNode.parse(first)).toEqual(first)
    expect(first.entryHeight).toBe(0.75)
    expect(first.inclineDeg).toBe(11)
    const defaults = conveyorSpiralDefinition.defaults() as Record<string, unknown>
    expect('name' in defaults).toBe(false)
    expect('id' in defaults).toBe(false)
  })

  test('kayıtlı, panelde listeli, katalogda İKİ tile var', () => {
    const registered = new Set(warehousePlugin.nodes?.map((def) => def.kind))
    expect(registered.has('warehouse:conveyor-spiral')).toBe(true)
    expect([...registered].sort()).toEqual([...(warehouseCatalogPanel.kinds ?? [])].sort())

    const tiles = CATALOG_ITEMS.filter((item) => item.kind === 'warehouse:conveyor-spiral')
    expect(tiles.length).toBe(2)
    const sections = new Set(CATALOG_SECTIONS.map((section) => section.id))
    for (const tile of tiles) expect(sections.has(tile.sectionId)).toBe(true)
    // İki fiş de AYNI alan kümesini yazıyor (fırça-yapışkanlık).
    const carton = tiles.find((t) => t.id === 'conveyor-spiral-carton')
    const pallet = tiles.find((t) => t.id === 'conveyor-spiral-pallet')
    expect(carton?.brush).toEqual({
      kind: 'conveyor-spiral',
      patch: { loadClass: 'light', outerDiameter: '1500', beltWidth: '500' },
    })
    expect(pallet?.brush).toEqual({
      kind: 'conveyor-spiral',
      patch: { loadClass: 'pallet', outerDiameter: '2400', beltWidth: '500' },
    })
  })

  test('sarmal ve tüm konveyör ailesi host paletinden GİZLİ', () => {
    // Konveyörler eklentinin kendi katalog panelinden yerleştirilir; host'un
    // genel furnish paletinde de görünürlerse tek tık İKİ düğüm oluşturur
    // (host varsayılanı + eklenti aracı). Sarmal bunu bir kez yaşadı — bu
    // bekçi aileden herhangi birinin `hidden`'ı unutmasını yakalar.
    const conveyorDefs = (warehousePlugin.nodes ?? []).filter((def) =>
      def.kind.startsWith('warehouse:conveyor-'),
    )
    expect(conveyorDefs.length).toBeGreaterThanOrEqual(8)
    for (const def of conveyorDefs) {
      expect(
        (def as { presentation?: { hidden?: boolean } }).presentation?.hidden,
        `${def.kind} host paletinden gizli olmalı`,
      ).toBe(true)
    }
  })

  test('dönüş adımı 45° — sekiz açı', () => {
    const angles = conveyorSpiralDefinition.capabilities.rotatable.snapAngles
    expect(angles.length).toBe(8)
    expect(angles[1]).toBeCloseTo(Math.PI / 4, 9)
  })

  test('ağaç etiketi DİNAMİK — yükseklikle değişir', () => {
    const label = conveyorSpiralDefinition.tree?.label
    if (typeof label !== 'function') throw new Error('dinamik etiket bekleniyordu')
    const a = label(spiral({ travelHeight: 4 }) as never)
    const b = label(spiral({ travelHeight: 6 }) as never)
    expect(a).not.toBe(b)
  })

  test('taban izi kolider boyutları metrikten', () => {
    const resolver = conveyorSpiralDefinition.capabilities.floorPlaced?.footprint
    if (!resolver) throw new Error('footprint yok')
    const node = spiral({ outerDiameter: '2400' })
    const dims = resolver(node as never).dimensions
    expect(dims[0]).toBeCloseTo(footprintM(node), 9)
    expect(dims[1]).toBeCloseTo(overallHeightM(node), 9)
    expect(dims[2]).toBeCloseTo(footprintM(node), 9)
  })

  test('yayınlanmamışlar notu hem tahmini hem sınırını söyler', () => {
    expect(SPIRAL_UNPUBLISHED_NOTE.toLowerCase()).toContain('ölçüm değildir')
    expect(SPIRAL_UNPUBLISHED_NOTE).toContain('5 m/dak')
  })

  // ── Taşınan koliler (band değil koliler hareket eder) ────────────────────
  describe('koli akışı', () => {
    test('koli sayısı en az 1 ve tavanı aşmıyor', () => {
      for (const th of [1, 4, 8, 15]) {
        const count = spiralBoxCount(spiral({ travelHeight: th }) as never)
        expect(count).toBeGreaterThanOrEqual(1)
        expect(count).toBeLessThanOrEqual(SPIRAL_MAX_BOXES)
      }
    })

    test('daha yüksek kule daha çok koli taşır (sabit çap/eğim)', () => {
      const few = spiralBoxCount(spiral({ travelHeight: 2 }) as never)
      const many = spiralBoxCount(spiral({ travelHeight: 10 }) as never)
      expect(many).toBeGreaterThan(few)
    })

    test('koli adımı × sayısı toplam açıyı aşmıyor (kuyruk taşmaz)', () => {
      const node = spiral({ travelHeight: 6 }) as never
      expect(spiralBoxStepRad(node) * spiralBoxCount(node)).toBeLessThanOrEqual(
        totalAngleRad(node) + 1e-9,
      )
    })

    test('ilerleme hızı çizgisel bant hızını yay üzerinde koruyor', () => {
      // rate (rad/s) × yay/radyan = çizgisel hız (m/s). Palet sınıfı 5 m/dak.
      const node = spiral({ loadClass: 'pallet', outerDiameter: '2400' }) as never
      const r = helixRadiusM(node)
      const c = pitchM(node) / (Math.PI * 2)
      const arcPerRad = Math.hypot(r, c)
      expect(spiralBoxRateRadPerSec(node) * arcPerRad).toBeCloseTo(5 / 60, 6)
    })
  })
})
