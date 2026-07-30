import { describe, expect, test } from 'bun:test'
import type { GeometryContext } from '@pascal-app/core'
import { CATALOG_ITEMS } from '../catalog'
import { warehouseCatalogPanel, warehousePlugin } from '../index'
import {
  TELESCOPIC_MODEL_IDS,
  TELESCOPIC_MODELS,
  TELESCOPIC_UNPUBLISHED_NOTE,
} from './telescopic-catalog'
import { conveyorTelescopicDefinition } from './telescopic-definition'
import { buildTelescopicFloorplan } from './telescopic-floorplan'
import { telescopicBaseKey, telescopicSectionKey } from './telescopic-geometry'
import {
  boomSections,
  boomTipX,
  currentLengthM,
  footprintCenterX,
  frameWidthM,
} from './telescopic-metrics'
import { conveyorTelescopicParametrics } from './telescopic-parametrics'
import { ConveyorTelescopicNode } from './telescopic-schema'

const CTX_UNSELECTED = {} as GeometryContext
const CTX_SELECTED = {
  viewState: { selected: true, palette: { selectedStroke: '#fff', selectedFill: '#333' } },
} as unknown as GeometryContext

const ALL = TELESCOPIC_MODEL_IDS.map((id) => TELESCOPIC_MODELS[id])

describe('katalog: üreticinin tablosu kendi içinde tutarlı', () => {
  test('C = A + B, on satırın hepsinde', () => {
    // Tablodan kataloğa transkripsiyon hatasının yakalandığı tek yer.
    for (const model of ALL) {
      const residual = model.totalM - (model.fixedM + model.extensionM)
      expect(Math.abs(residual), model.label).toBeLessThanOrEqual(0.0005)
    }
  })

  test('yükseklik bölüm sayısının fonksiyonudur: 3→0.80, 4→0.90, 5→0.95, 6→1.05', () => {
    const bySections: Record<number, number> = { 3: 0.8, 4: 0.9, 5: 0.95, 6: 1.05 }
    for (const model of ALL) {
      expect(model.heightM, model.label).toBeCloseTo(bySections[model.sections] as number, 9)
    }
  })

  test('her satırın uzaması sabit kısmına sığar — bölüm başına pay ≤ A', () => {
    // Fiziksel olgu: kapanan bom gövdenin İÇİNE girer. Bir satır bunu
    // ihlal ediyorsa ya tablo yanlış kopyalandı ya makine öyle çalışmıyor.
    for (const model of ALL) {
      const stride = model.extensionM / (model.sections - 1)
      expect(stride, model.label).toBeLessThanOrEqual(model.fixedM)
    }
  })

  test('on model, kimlikler tabloyla birebir', () => {
    expect(ALL.length).toBe(10)
    for (const model of ALL) {
      expect(model.label.toLowerCase().replace(/\s/g, '')).toBe(model.id)
    }
  })
})

describe('şema: ölçü düğümde tutulmaz', () => {
  test('parse({}) başarılı, gidiş-dönüş kayıpsız', () => {
    const first = ConveyorTelescopicNode.parse({})
    expect(ConveyorTelescopicNode.parse(first)).toEqual(first)
    expect(first.extension).toBe(0)
    expect(first.model).toBe('a4-6+12')
  })

  test('katalog düzeltmesinin propagasyonunu durduracak alan yok', () => {
    const keys = Object.keys(ConveyorTelescopicNode.parse({}))
    for (const banned of ['fixedM', 'totalM', 'extensionM', 'heightM', 'sections', 'length']) {
      expect(keys).not.toContain(banned)
    }
  })
})

describe('uzama: taban izi büyür, geometri anahtarı büyümez', () => {
  test('anlık boy A → C arasında doğrusal', () => {
    const closed = ConveyorTelescopicNode.parse({ model: 'a4-6+12', extension: 0 })
    const half = ConveyorTelescopicNode.parse({ model: 'a4-6+12', extension: 0.5 })
    const open = ConveyorTelescopicNode.parse({ model: 'a4-6+12', extension: 1 })
    expect(currentLengthM(closed)).toBeCloseTo(6, 9)
    expect(currentLengthM(half)).toBeCloseTo(12, 9)
    expect(currentLengthM(open)).toBeCloseTo(18, 9)
  })

  test('taban izi ÖNE kayar: merkez B·e/2, uç A/2 + B·e', () => {
    const open = ConveyorTelescopicNode.parse({ model: 'a4-6+12', extension: 1 })
    expect(footprintCenterX(open)).toBeCloseTo(6, 9)
    expect(boomTipX(open)).toBeCloseTo(3 + 12, 9)
    // Ucun izin arka yüzünden uzaklığı tam anlık boy kadar.
    expect(boomTipX(open) + 3).toBeCloseTo(currentLengthM(open), 9)
  })

  test('cache anahtarı uzamayı İÇERMEZ — bir uzama sürüklemesi buffer basmaz', () => {
    const a = ConveyorTelescopicNode.parse({ extension: 0 })
    const b = ConveyorTelescopicNode.parse({ extension: 0.75 })
    expect(telescopicBaseKey(a, 'full')).toBe(telescopicBaseKey(b, 'full'))
    expect(telescopicSectionKey(a, 1, 'full')).toBe(telescopicSectionKey(b, 1, 'full'))
    // Ama şekli GERÇEKTEN değiştiren her girdi anahtarda.
    const other = ConveyorTelescopicNode.parse({ model: 'a6-5+16' })
    expect(telescopicBaseKey(other, 'full')).not.toBe(telescopicBaseKey(a, 'full'))
    const wider = ConveyorTelescopicNode.parse({ beltWidth: '1000' })
    expect(telescopicBaseKey(wider, 'full')).not.toBe(telescopicBaseKey(a, 'full'))
    expect(telescopicBaseKey(a, 'simple')).not.toBe(telescopicBaseKey(a, 'full'))
  })

  test('bölüm sayısı = sections − 1; kapalıyken hepsi gövdenin içinde', () => {
    for (const id of TELESCOPIC_MODEL_IDS) {
      const model = TELESCOPIC_MODELS[id]
      const closed = ConveyorTelescopicNode.parse({ model: id, extension: 0 })
      const sections = boomSections(closed)
      expect(sections.length, id).toBe(model.sections - 1)
      // Kapalıyken hiçbir bölüm gövde ucunu geçmez.
      for (const section of sections) {
        expect(section.tipX, `${id}/${section.index}`).toBeCloseTo(model.fixedM / 2, 9)
      }
    }
  })

  test('kademeler daralarak sıralanır — düz tek prizma değil', () => {
    const open = ConveyorTelescopicNode.parse({ model: 'a6-5+16', extension: 1 })
    const sections = boomSections(open)
    for (let i = 1; i < sections.length; i++) {
      const prev = sections[i - 1]
      const current = sections[i]
      if (!prev || !current) throw new Error('bölüm eksik')
      expect(current.widthM).toBeLessThan(prev.widthM)
      expect(current.tipX).toBeGreaterThan(prev.tipX)
    }
  })
})

describe('plan sembolü', () => {
  test('kapalıyken izin X aralığı [−A/2, +A/2]', () => {
    const node = ConveyorTelescopicNode.parse({ model: 'a4-6+12', extension: 0 })
    const plan = buildTelescopicFloorplan(node, CTX_UNSELECTED)
    if (plan?.kind !== 'group') throw new Error('grup bekleniyordu')
    let maxX = Number.NEGATIVE_INFINITY
    for (const child of plan.children) {
      if (child.kind === 'rect') maxX = Math.max(maxX, child.x + child.width)
    }
    // Ok başı gövdenin ucunda; dikdörtgenler A'yı aşmaz.
    expect(maxX).toBeCloseTo(3, 2)
  })

  test('seçiliyken tam açılım zarfı çizilir ve tıklama yutmaz', () => {
    const node = ConveyorTelescopicNode.parse({ model: 'a4-6+12', extension: 0 })
    const plan = buildTelescopicFloorplan(node, CTX_SELECTED)
    if (plan?.kind !== 'group') throw new Error('grup bekleniyordu')
    const envelope = plan.children.find(
      (child) => child.kind === 'rect' && 'strokeDasharray' in child && !!child.strokeDasharray,
    )
    if (envelope?.kind !== 'rect') throw new Error('zarf çizilmedi')
    expect(envelope.width).toBeCloseTo(18, 9)
    expect('pointerEvents' in envelope && envelope.pointerEvents).toBe('none')
  })

  test('hiçbir dolgulu primitif fill: none taşımaz — sembol seçilebilir kalır', () => {
    for (const id of TELESCOPIC_MODEL_IDS) {
      const plan = buildTelescopicFloorplan(
        ConveyorTelescopicNode.parse({ model: id }),
        CTX_UNSELECTED,
      )
      if (plan?.kind !== 'group') throw new Error('grup bekleniyordu')
      for (const child of plan.children) {
        if ('fill' in child) expect(child.fill, id).not.toBe('none')
      }
    }
  })
})

describe('tanım ve manifest', () => {
  test('kayıtlı, panelde listeli, katalogda tile var', () => {
    const registered = new Set(warehousePlugin.nodes?.map((def) => def.kind))
    expect(registered.has('warehouse:conveyor-telescopic')).toBe(true)
    expect([...registered].sort()).toEqual([...(warehouseCatalogPanel.kinds ?? [])].sort())
    const tile = CATALOG_ITEMS.find((item) => item.kind === 'warehouse:conveyor-telescopic')
    expect(tile?.brush).toEqual({ kind: 'telescopic', model: 'a4-6+12' })
  })

  test('taban izi anlık boyu okur — uzayan bom daha çok yer kaplar', () => {
    const resolver = conveyorTelescopicDefinition.capabilities.floorPlaced?.footprint
    if (!resolver) throw new Error('footprint yok')
    const closed = ConveyorTelescopicNode.parse({ model: 'a4-6+12', extension: 0 })
    const open = ConveyorTelescopicNode.parse({ model: 'a4-6+12', extension: 1 })
    expect(resolver(closed as never).dimensions[0]).toBeCloseTo(6, 9)
    expect(resolver(open as never).dimensions[0]).toBeCloseTo(18, 9)
    expect(resolver(open as never).dimensions[2]).toBeCloseTo(frameWidthM(open), 9)
  })

  test('hat parçası DEĞİL: port bildirmez', () => {
    expect('ports' in conveyorTelescopicDefinition).toBe(false)
  })

  test('trailingSection tanımlı — yoksa invariants çöpe gider', () => {
    expect(conveyorTelescopicParametrics.trailingSection).toBeDefined()
    expect(conveyorTelescopicParametrics.invariants?.length).toBeGreaterThan(0)
  })

  test('her şema alanı ya bir grupta ya bilinçli gizli', () => {
    const BASE = ['object', 'id', 'type', 'name', 'parentId', 'visible', 'metadata', 'camera']
    const HIDDEN = ['supportSlabId'] // yerleştirmede seçilir
    const covered = new Set(
      conveyorTelescopicParametrics.groups.flatMap((group) =>
        group.fields.map((field) => String(field.key)),
      ),
    )
    for (const key of Object.keys(ConveyorTelescopicNode.parse({}))) {
      if (BASE.includes(key)) continue
      expect(covered.has(key) || HIDDEN.includes(key), `${key} erişilemez`).toBe(true)
    }
  })
})

describe('yayınlanmamışlar kayıtlı', () => {
  test('hız/kapasite/güç notu hem tahmini hem sınırını söyler', () => {
    expect(TELESCOPIC_UNPUBLISHED_NOTE).toContain('yayınlanmamış')
    expect(TELESCOPIC_UNPUBLISHED_NOTE).toContain('0.4 m/s')
    expect(TELESCOPIC_UNPUBLISHED_NOTE.toLowerCase()).toContain('ölçüm değildir')
  })
})
