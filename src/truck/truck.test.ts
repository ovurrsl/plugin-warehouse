import { describe, expect, test } from 'bun:test'
import type { GeometryContext } from '@pascal-app/core'
import { CATALOG_ITEMS } from '../catalog'
import { MAST_ROWS } from '../handling/masts'
import { TRUCK_MODEL_ID_LIST, TRUCK_MODELS } from '../handling/models'
import { warehouseCatalogPanel, warehousePlugin } from '../index'
import { truckDefinition } from './definition'
import { buildTruckFloorplan } from './floorplan'
import {
  clearTruckGeometryCache,
  getTruckGeometry,
  truckGeometryCacheSize,
  truckGeometryKey,
} from './geometry'
import { mastPose, mastTopY } from './kinematics'
import * as materials from './materials'
import { forkFaceX, forkTipX, overallHeightM, planWidthM, waPivotLocalX } from './metrics'
import { bodiesOf } from './parts'
import { TruckNode } from './schema'

const CTX_UNSELECTED = {} as GeometryContext
const CTX_SELECTED = {
  viewState: { selected: true, palette: { selectedStroke: '#fff', selectedFill: '#333' } },
} as unknown as GeometryContext

const EFG_ROW = MAST_ROWS.find((r) => r.id === 'efg-a-zt-3000')
if (!EFG_ROW) throw new Error('efg-a-zt-3000 katalogdan düşmüş')

describe('T15 — şema: varsayılansız alan yok, gidiş-dönüş kayıpsız', () => {
  test('parse({}) başarılı ve ikinci geçiş birinciyle aynı', () => {
    const first = TruckNode.parse({})
    const second = TruckNode.parse(first)
    expect(second).toEqual(first)
    expect(first.model).toBe('forklift-1300')
    expect(first.duty).toBe('parked')
    expect(first.mastRowId).toBeNull()
  })
})

describe('T16 — düğümde hiçbir ölçü anahtarı yok', () => {
  test('katalog düzeltmesinin propagasyonunu durduracak alan yok', () => {
    const keys = Object.keys(TruckNode.parse({}))
    for (const banned of ['l1', 'l2', 'b1', 'b2', 'ast', 'Ast', 'Wa', 'Q', 'y', 'x', 'variant']) {
      expect(keys).not.toContain(banned)
    }
  })
})

describe('T17 — manifest kapanışı', () => {
  test('plugin.nodes ↔ panel.kinds ↔ CATALOG_ITEMS kapalı küme', () => {
    const registered = new Set(warehousePlugin.nodes?.map((def) => def.kind))
    expect(registered.has('warehouse:truck')).toBe(true)
    // Panel listesi kayıtlıların TAM kümesi — `warehouse:route` boşluğu bu
    // değişiklikte kapandı ve bir daha açılamaz.
    expect([...registered].sort()).toEqual([...(warehouseCatalogPanel.kinds ?? [])].sort())
    for (const item of CATALOG_ITEMS) {
      expect(registered.has(item.kind), `${item.id} kayıtsız kind'a işaret ediyor`).toBe(true)
    }
  })

  test('beş makinenin beşi de katalogda, İngilizce adlarıyla', () => {
    const truckTiles = CATALOG_ITEMS.filter((item) => item.kind === 'warehouse:truck')
    expect(truckTiles.map((t) => t.label).sort()).toEqual([
      'Electric forklift',
      'Electric pallet truck',
      'Hand pallet truck',
      'Reach truck',
      'Turret truck',
    ])
    const models = truckTiles.map((t) => (t.brush as { model: string }).model).sort()
    expect(models).toEqual([...TRUCK_MODEL_ID_LIST].sort())
  })
})

describe('T18 — her şema alanı ya bir grupta ya bilinçli gizli', () => {
  /** Filo sisteminin yazdığı / yerleştirmenin seçtiği alanlar — panelde
   *  eli olmayan veri. Buradan çıkarılan her alan ya bir gruba girer ya da
   *  bu test kırılır. */
  const DELIBERATELY_HIDDEN = [
    'routeId',
    'routeAnchor',
    'pickSlot',
    'dropSlot',
    'carryingPalletId',
    'supportSlabId',
  ]
  const BASE_FIELDS = ['object', 'id', 'type', 'name', 'parentId', 'visible', 'metadata', 'camera']

  test('kapsam iki yönlü', () => {
    const covered = new Set(
      truckDefinition.parametrics.groups.flatMap((group) =>
        group.fields.map((field) => String(field.key)),
      ),
    )
    const schemaKeys = Object.keys(TruckNode.parse({})).filter((key) => !BASE_FIELDS.includes(key))
    for (const key of schemaKeys) {
      const reachable = covered.has(key) || DELIBERATELY_HIDDEN.includes(key)
      expect(reachable, `${key} panelden erişilemez ve gizli listesinde de yok`).toBe(true)
    }
    for (const key of DELIBERATELY_HIDDEN) {
      expect(covered.has(key), `${key} hem gizli hem grupta`).toBe(false)
    }
  })

  test('trailingSection tanımlı — yoksa invariants çöpe gider', () => {
    expect(truckDefinition.parametrics.trailingSection).toBeDefined()
    expect(truckDefinition.parametrics.invariants?.length).toBeGreaterThan(0)
  })
})

describe('T19 — attribute paritesi yapısaldır', () => {
  test('her model × her gövde × iki katman aynı attribute kümesini yazar', () => {
    for (const id of TRUCK_MODEL_ID_LIST) {
      const model = TRUCK_MODELS[id]
      for (const body of bodiesOf(model)) {
        for (const detail of ['full', 'simple'] as const) {
          const geometry = getTruckGeometry(id, null, body, detail)
          expect(Object.keys(geometry.attributes).sort()).toEqual([
            'color',
            'normal',
            'position',
            'uv',
          ])
        }
      }
    }
  })

  test('tek materyal, iki katman — uzak katman materyali yok', () => {
    expect(materials.getTruckMaterial()).toBe(materials.getTruckMaterial())
    expect(Object.keys(materials).sort()).toEqual(['getTruckMaterial', 'getTruckPreviewMaterial'])
  })
})

describe('T20 — uzak katman iskelet değil, zarf aynı', () => {
  test('beş ailenin beşinde: katman zarf genişliğini korur, üçgenleri bandın içinde azaltır', () => {
    for (const id of TRUCK_MODEL_ID_LIST) {
      let fullTris = 0
      let simpleTris = 0
      for (const body of bodiesOf(TRUCK_MODELS[id])) {
        const full = getTruckGeometry(id, null, body, 'full')
        const simple = getTruckGeometry(id, null, body, 'simple')
        full.computeBoundingBox()
        simple.computeBoundingBox()
        const fullBox = full.boundingBox
        const simpleBox = simple.boundingBox
        if (!fullBox || !simpleBox) throw new Error('bbox yok')
        // Zarf genişliği katmanla DEĞİŞMEZ — LOD geçişinde pop yok.
        expect(simpleBox.max.z - simpleBox.min.z, `${id}/${body}`).toBeCloseTo(
          fullBox.max.z - fullBox.min.z,
          2,
        )
        fullTris += (full.index?.count ?? 0) / 3
        simpleTris += (simple.index?.count ?? 0) / 3
      }
      const ratio = simpleTris / fullTris
      // Plan bandı %35–60; tekerlekler artık silindir olduğu ve iki katmanda
      // da durduğu için (yalnız kenar sayısı düşüyor) tavan biraz geniş.
      expect(ratio, id).toBeGreaterThan(0.3)
      expect(ratio, id).toBeLessThan(0.72)
    }
  })
})

describe('T21 — cache anahtarı: poz asla girmez, tüketilen her girdi girer', () => {
  test('anahtar iki yönlü', () => {
    const base = truckGeometryKey('forklift-1300', 'efg-a-zt-3000', 'chassis', 'full')
    expect(truckGeometryKey('rt-1800', 'efg-a-zt-3000', 'chassis', 'full')).not.toBe(base)
    expect(truckGeometryKey('forklift-1300', null, 'chassis', 'full')).not.toBe(base)
    expect(truckGeometryKey('forklift-1300', 'efg-a-zt-3000', 'mast', 'full')).not.toBe(base)
    expect(truckGeometryKey('forklift-1300', 'efg-a-zt-3000', 'chassis', 'simple')).not.toBe(base)
  })

  test('aynı şekil aynı buffer — çatal kotu ve poz cache’i bölmez', () => {
    clearTruckGeometryCache()
    const a = getTruckGeometry('forklift-1300', null, 'carriage', 'full')
    const b = getTruckGeometry('forklift-1300', null, 'carriage', 'full')
    expect(a).toBe(b)
    // forkHeight anahtar fonksiyonunun imzasında bile yok — poz matristir.
    expect(truckGeometryKey.length).toBe(4)
    expect(truckGeometryCacheSize()).toBe(1)
  })
})

describe('T22 — plan zarfı = footprint = katalog', () => {
  test('footprint boyutları katalogdan okunur ve rotasyonu düğümden alır', () => {
    const node = TruckNode.parse({ rotation: [0, Math.PI / 2, 0] })
    const resolver = truckDefinition.capabilities.floorPlaced?.footprint
    if (!resolver) throw new Error('floorPlaced.footprint yok')
    const footprint = resolver(node as never)
    const model = TRUCK_MODELS[node.model]
    expect(footprint.dimensions[0]).toBeCloseTo(model.l1, 9)
    expect(footprint.dimensions[2]).toBeCloseTo(planWidthM(model), 9)
    expect(footprint.rotation).toEqual([0, Math.PI / 2, 0])
  })

  test('çatal ucu tam +l1/2 — zincirin geometriye indiği yer', () => {
    for (const id of TRUCK_MODEL_ID_LIST) {
      const model = TRUCK_MODELS[id]
      if (model.variant === 'turret') continue // jenerik zincir bu aileye uygulanmaz
      expect(forkFaceX(model) + model.fork.length, id).toBeCloseTo(forkTipX(model), 9)
    }
  })

  test('plan sembolünün X aralığı tam [−l1/2, +l1/2]', () => {
    const node = TruckNode.parse({})
    const model = TRUCK_MODELS[node.model]
    const plan = buildTruckFloorplan(node, CTX_UNSELECTED)
    if (plan?.kind !== 'group') throw new Error('grup bekleniyordu')
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    for (const child of plan.children) {
      if (child.kind === 'rect') {
        minX = Math.min(minX, child.x)
        maxX = Math.max(maxX, child.x + child.width)
      } else if (child.kind === 'polygon') {
        for (const [px] of child.points) {
          minX = Math.min(minX, px)
          maxX = Math.max(maxX, px)
        }
      }
    }
    expect(minX).toBeCloseTo(-model.l1 / 2, 9)
    expect(maxX).toBeCloseTo(model.l1 / 2, 9)
  })
})

describe('T23 — Wa pivotunun işareti', () => {
  test('forklift pivotu zarf merkezinin ARKASINDA: −0.0275', () => {
    // Ters işaret 0°'de görünmez ve yayı 55 mm yanlış yere oturtur.
    expect(waPivotLocalX(TRUCK_MODELS['forklift-1300'])).toBeCloseTo(-0.0275, 4)
  })

  test('tt pivotu öndedir, transpaletlerde pivot yoktur', () => {
    expect(waPivotLocalX(TRUCK_MODELS['tt-1600'])).toBeCloseTo(2.502 - 4.045 / 2, 4)
    expect(waPivotLocalX(TRUCK_MODELS['mpt-680x1150'])).toBeNull()
    expect(waPivotLocalX(TRUCK_MODELS['ept-2500'])).toBeNull()
  })
})

describe('T24/T25 — plan bütçesi ve tıklama hijyeni', () => {
  test('seçilmemiş sembol ≤ 14 primitif ve hiçbir dolgu "none" değil', () => {
    for (const id of TRUCK_MODEL_ID_LIST) {
      const node = TruckNode.parse({ model: id })
      const plan = buildTruckFloorplan(node, CTX_UNSELECTED)
      if (plan?.kind !== 'group') throw new Error('grup bekleniyordu')
      expect(plan.children.length, id).toBeLessThanOrEqual(14)
      for (const child of plan.children) {
        if ('fill' in child) expect(child.fill, id).not.toBe('none')
      }
    }
  })

  test('seçiliyken Ast bandı ve Wa yayı tıklama yutmaz', () => {
    const node = TruckNode.parse({}) // forklift: ast + pivot ikisi de var
    const plan = buildTruckFloorplan(node, CTX_SELECTED)
    if (plan?.kind !== 'group') throw new Error('grup bekleniyordu')
    const band = plan.children.find(
      (child) => child.kind === 'rect' && 'fillOpacity' in child && child.fillOpacity !== undefined,
    )
    const arc = plan.children.find((child) => child.kind === 'path')
    if (!band || !arc) throw new Error('bant/yay çizilmedi')
    expect('pointerEvents' in band && band.pointerEvents).toBe('none')
    expect('pointerEvents' in arc && arc.pointerEvents).toBe('none')
  })

  test('Ast bandı yalnız yayınlandığı yerde: tt sembolünde bant yok', () => {
    const node = TruckNode.parse({ model: 'tt-1600' })
    const plan = buildTruckFloorplan(node, CTX_SELECTED)
    if (plan?.kind !== 'group') throw new Error('grup bekleniyordu')
    const bands = plan.children.filter(
      (child) => child.kind === 'rect' && 'fillOpacity' in child && child.fillOpacity !== undefined,
    )
    expect(bands.length).toBe(0)
  })
})

describe('T26 — dinlenme pozu zeminde', () => {
  test('her modelin en alçak vertex’i [0, 1 mm] bandında', () => {
    for (const id of TRUCK_MODEL_ID_LIST) {
      const model = TRUCK_MODELS[id]
      let minY = Number.POSITIVE_INFINITY
      for (const body of bodiesOf(model)) {
        const geometry = getTruckGeometry(id, null, body, 'full')
        const positions = geometry.getAttribute('position')
        // stage1/carriage dinlenmede offset 0'dadır (forkHeight 0).
        for (let i = 0; i < positions.count; i++) {
          minY = Math.min(minY, positions.getY(i))
        }
      }
      expect(minY, id).toBeGreaterThanOrEqual(0)
      expect(minY, id).toBeLessThanOrEqual(0.001)
    }
  })
})

describe('kinematik uçları yayınlanmış figürlere oturur', () => {
  test('mainY=0 → tam h1, mainY=h3 → tam h4', () => {
    expect(mastTopY(EFG_ROW, 0)).toBe(EFG_ROW.h1)
    expect(mastTopY(EFG_ROW, EFG_ROW.h3)).toBeCloseTo(EFG_ROW.h4, 9)
  })

  test('poz toplamı çatal kotudur ve satırsız kademe kımıldamaz', () => {
    const pose = mastPose(EFG_ROW, 2.0)
    expect(pose.stage1Y + pose.carriageY).toBeCloseTo(2.0, 9)
    const rowless = mastPose(null, 1.2)
    expect(rowless.stage1Y).toBe(0)
    expect(rowless.carriageY).toBeCloseTo(1.2, 9)
  })

  test('serbest kaldırma bölgesinde mast tepesi kımıldamaz', () => {
    expect(mastTopY(EFG_ROW, EFG_ROW.h2)).toBe(EFG_ROW.h1)
    expect(mastPose(EFG_ROW, EFG_ROW.h2 / 2).stage1Y).toBe(0)
  })

  test('zarf yüksekliği: mast satırı varsa h1, tt için h12', () => {
    const forklift = TRUCK_MODELS['forklift-1300']
    expect(overallHeightM(forklift, EFG_ROW)).toBeCloseTo(2.06, 9)
    expect(overallHeightM(forklift, null)).toBeCloseTo(2.04, 9)
    expect(overallHeightM(TRUCK_MODELS['tt-1600'], null)).toBeCloseTo(3.93, 9)
  })
})
