import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GeometryContext } from '@pascal-app/core'
import { CATALOG_ITEMS } from '../catalog'
import { warehouseCatalogPanel, warehousePlugin } from '../index'
import { resetLineIndex } from './line-index'
import { moduleLengthM } from './metrics'
import { mateBlockers, resetPortMagnet, snapToLineEnd } from './port-magnet'
import { localPorts, transportHeightAt } from './ports'
import { ConveyorRollerNode } from './schema'
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
  LAMP_BEAM_LENGTH_M,
  LAMP_HOUSING_SIZE_M,
  LAMP_LENS_SIZE_M,
  lampBeamDirection,
  noseLamp,
  transportHeightM,
} from './telescopic-metrics'
import { conveyorTelescopicParametrics } from './telescopic-parametrics'
import { telescopicSectionParts } from './telescopic-parts'
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

describe('burun donanımı: sensör ve platform panelden kapatılabilir', () => {
  test('varsayılan açık — burun bölümünde sensor ve platform rolleri var', () => {
    const node = ConveyorTelescopicNode.parse({ model: 'a4-6+12' })
    const model = { sections: 4 } // a4-6+12: son bölüm indeksi 3
    const nose = telescopicSectionParts(node, model.sections - 1, 'full')
    expect(nose.some((part) => part.role === 'sensor')).toBe(true)
    expect(nose.some((part) => part.role === 'platform')).toBe(true)
  })

  test('kapatılınca ilgili parçalar hiç üretilmez', () => {
    const node = ConveyorTelescopicNode.parse({
      model: 'a4-6+12',
      hasSensor: false,
      hasPlatform: false,
    })
    const nose = telescopicSectionParts(node, 3, 'full')
    const on = telescopicSectionParts(ConveyorTelescopicNode.parse({ model: 'a4-6+12' }), 3, 'full')
    expect(nose.some((part) => part.role === 'sensor')).toBe(false)
    expect(nose.some((part) => part.role === 'platform')).toBe(false)
    // Platform kapanınca onu taşıyan braket/korkuluk da gitmeli — yarım
    // platform (havada asılı braket) fiziksel olarak anlamsız. Bölümün
    // KENDİ yan korkulukları (`rail`, her bölümde) kalmalı — yalnız
    // platformun korkuluğu (1 bar + 2 direk = 3 parça) düşer.
    const railsOn = on.filter((part) => part.role === 'rail').length
    const railsOff = nose.filter((part) => part.role === 'rail').length
    expect(railsOn - railsOff).toBe(3)
    expect(railsOff).toBeGreaterThan(0)
  })

  test("bayraklar geometri anahtarına girer — kapatmak eski buffer'ı göstermez", () => {
    const on = ConveyorTelescopicNode.parse({ model: 'a4-6+12' })
    const off = ConveyorTelescopicNode.parse({
      model: 'a4-6+12',
      hasSensor: false,
      hasPlatform: false,
    })
    expect(telescopicSectionKey(on, 3, 'full')).not.toBe(telescopicSectionKey(off, 3, 'full'))
  })
})

describe('çalışma lambası: mercek gövdesinin üstünde durur', () => {
  /**
   * Bu bölümün tuttuğu hata SESSİZDİ ve aylarca ekrandaydı.
   *
   * Gövde parça listesinde `+widthM/2 − 0.08`'de, mercek renderer'da
   * `−widthM/2 − 0.055`'te duruyordu: parlayan yüzey bomun ÖTEKİ yanında,
   * havada. Hiçbir şey hata vermiyor — ekranda bir şey yanıyor, ve o şeyin
   * lambanın kendisi olmadığını ancak makineye yakından bakan biri görüyor.
   *
   * Testler `noseLamp`'i kilitliyor çünkü artık iki dosyanın da okuduğu tek
   * kaynak o; ayrıca renderer'ın gerçekten onu okuduğunu kaynak üzerinden
   * doğruluyorlar — fonksiyon doğru olup çağıran yanlış hesaplarsa hata aynı
   * hatadır.
   */
  const NODE = ConveyorTelescopicNode.parse({ model: 'a4-6+12' })
  const NOSE = boomSections(NODE)[boomSections(NODE).length - 1]
  if (!NOSE) throw new Error('burun bölümü bekleniyordu')

  test('mercek gövdeyle AYNI yanda ve gövdenin +X yüzüne yapışık', () => {
    const lamp = noseLamp(NODE, NOSE)
    // Y ve Z birebir aynı: mercek gövdenin yüzü, komşusu değil.
    expect(lamp.lens[1]).toBeCloseTo(lamp.housing[1], 9)
    expect(lamp.lens[2]).toBeCloseTo(lamp.housing[2], 9)
    // X'te tam olarak iki yarı kalınlık kadar ileri — ne gövdenin içine
    // gömülü ne de havada.
    expect(lamp.lens[0] - lamp.housing[0]).toBeCloseTo(
      LAMP_HOUSING_SIZE_M[0] / 2 + LAMP_LENS_SIZE_M[0] / 2,
      9,
    )
  })

  test('mercek bomun içinde — ESKİ hatanın kendisi', () => {
    const lamp = noseLamp(NODE, NOSE)
    // Eski değer `−widthM/2 − 0.055` idi: hem ters işaretli hem çerçevenin
    // dışında. İkisini de ayrı ayrı reddet.
    expect(Math.sign(lamp.lens[2])).toBe(Math.sign(lamp.housing[2]))
    expect(Math.abs(lamp.lens[2])).toBeLessThan(NOSE.widthM / 2)
  })

  test('mercek +X’e bakıyor — ince eksen X', () => {
    // Yana bakan bir far dorseyi aydınlatmaz. İnce eksenin X olması,
    // merceğin yüzünün ileri baktığının tek makine-okunur ifadesi.
    expect(LAMP_LENS_SIZE_M[0]).toBeLessThan(LAMP_LENS_SIZE_M[1])
    expect(LAMP_LENS_SIZE_M[0]).toBeLessThan(LAMP_LENS_SIZE_M[2])
  })

  test('uzamadan bağımsız — bom uzarken mercek gövdeden kaymaz', () => {
    // Parça listesi bölümü dinlenme pozunda (`extension: 0`) kuruyor,
    // renderer anlık uzamada. İkisi aynı sonucu vermezse mercek uzama
    // sürüklendikçe gövdeden ayrılır.
    for (const extension of [0, 0.37, 1]) {
      const node = ConveyorTelescopicNode.parse({ model: 'a4-6+12', extension })
      const sections = boomSections(node)
      const nose = sections[sections.length - 1]
      if (!nose) throw new Error('burun bölümü bekleniyordu')
      expect(noseLamp(node, nose)).toEqual(noseLamp(NODE, NOSE))
    }
  })

  test('parça listesindeki gövde `noseLamp` ile aynı yerde', () => {
    const parts = telescopicSectionParts(NODE, 3, 'full')
    const housing = parts.find((part) => part.role === 'lamp-housing')
    if (!housing) throw new Error('lamba gövdesi bekleniyordu')
    expect([...housing.center]).toEqual([...noseLamp(NODE, NOSE).housing])
    expect([...housing.size]).toEqual([...LAMP_HOUSING_SIZE_M])
  })

  test('kot değişince lamba da yükselir', () => {
    const raised = ConveyorTelescopicNode.parse({ model: 'a4-6+12', transportHeight: 1.4 })
    const sections = boomSections(raised)
    const nose = sections[sections.length - 1]
    if (!nose) throw new Error('burun bölümü bekleniyordu')
    const delta = transportHeightM(raised) - transportHeightM(NODE)
    expect(noseLamp(raised, nose).lens[1] - noseLamp(NODE, NOSE).lens[1]).toBeCloseTo(delta, 9)
  })

  test('hüzme İLERİ ve AŞAĞI gidiyor', () => {
    // Koninin dinlenmedeki gövdesi −Y'de; dönüşün işaretini ters yazmak onu
    // makinenin içine ve yukarı gönderir. Ekranda garip, konsolda sessiz.
    const [forward, vertical] = lampBeamDirection()
    expect(forward).toBeGreaterThan(0.9)
    expect(vertical).toBeLessThan(0)
    // Eğim makul: dik inen bir hüzme dorseyi değil zemini aydınlatırdı.
    expect(Math.abs(vertical)).toBeLessThan(0.4)
  })

  test('hüzme bomun ucunu AŞIYOR — dorsenin içine giriyor', () => {
    // İçeri değil dışarı bakması gereken tek parça bu: hüzme boyunca bom
    // tipinden ileri gitmezse makinenin kendi gövdesini aydınlatır.
    const lamp = noseLamp(NODE, NOSE)
    const reach = lamp.lens[0] + LAMP_BEAM_LENGTH_M * lampBeamDirection()[0]
    expect(reach).toBeGreaterThan(NOSE.lengthM / 2)
  })

  test('renderer merceği elle DEĞİL `noseLamp` ile yerleştiriyor', () => {
    const source = readFileSync(join(import.meta.dir, 'telescopic-renderer.tsx'), 'utf8')
    expect(source).toContain('noseLamp(node, nose)')
    // Eski elle hesap ve onun imzası olan ters işaret bir daha girmesin.
    expect(source).not.toContain('-nose.widthM / 2')
    expect(source).not.toContain('nose.widthM / 2')
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

  /**
   * Bu test bir zamanlar `expect('ports' in def).toBe(false)` idi ve o hâliyle
   * bir KARARI kilitliyordu: "teleskopik bir hat parçası değil, portu yok."
   * Karar kullanıcı tarafından geri alındı — makinenin kuyruğu gerçekte bir
   * hatta beslenir. Yeni kural, kararın yerini alan asimetri: **kuyruk port,
   * bom ucu değil.**
   */
  test('kuyruk portu bildirir — hatta bağlanabilmesinin şartı', () => {
    expect(conveyorTelescopicDefinition.ports).toBeDefined()
    const node = ConveyorTelescopicNode.parse({ model: 'a4-6+12' })
    const ports = localPorts(node)
    expect(ports).toHaveLength(1)
    expect(ports[0]?.id).toBe('a')
  })

  test('kuyruk ucu uzamadan ETKİLENMEZ, bom ucu port DEĞİL', () => {
    const closed = ConveyorTelescopicNode.parse({ model: 'a4-6+12', extension: 0 })
    const open = ConveyorTelescopicNode.parse({ model: 'a4-6+12', extension: 1 })
    // Kuyruk sabit kısmın arkasında: −A/2, uzamadan bağımsız. Bir hatta
    // yapıştıktan sonra bomu açmak eklemi bozmamalı.
    expect(localPorts(closed)[0]?.x).toBeCloseTo(-3, 9)
    expect(localPorts(open)[0]?.x).toBeCloseTo(-3, 9)
    // Bom ucu 6 m ilerledi ama port listesine hiç girmedi.
    expect(boomTipX(open) - boomTipX(closed)).toBeCloseTo(12, 9)
    expect(localPorts(open)).toHaveLength(1)
  })

  test('kuyruk rolü akıştan gelir: yükleme girdi, boşaltma çıktı', () => {
    const loading = ConveyorTelescopicNode.parse({ flow: 'forward' })
    const unloading = ConveyorTelescopicNode.parse({ flow: 'reverse' })
    expect(localPorts(loading)[0]?.role).toBe('in')
    expect(localPorts(unloading)[0]?.role).toBe('out')
  })

  test('kot MODELDEN okunur — alan yok, ve NaN sessizliği olmamalı', () => {
    const node = ConveyorTelescopicNode.parse({ model: 'a4-6+12' })
    const height = transportHeightAt(node, 'a')
    expect(Number.isNaN(height)).toBe(false)
    expect(height).toBe(TELESCOPIC_MODELS['a4-6+12'].heightM)
    expect(localPorts(node)[0]?.y).toBe(height)
  })

  test('şerit portun kendi bant genişliği — R1 bunu karşılaştırıyor', () => {
    const wide = ConveyorTelescopicNode.parse({ beltWidth: '1000' })
    expect(localPorts(wide)[0]?.laneMm).toBe(1000)
  })

  test('port mıknatısı bağlı — kanca olmadan host hizalama dalına hiç girmez', () => {
    expect(conveyorTelescopicDefinition.capabilities.movable?.groupMoveSnap).toBeDefined()
  })

  test('distributionRole YOK — bağlı hat sürüklenince yerinde kalır', () => {
    expect('distributionRole' in conveyorTelescopicDefinition).toBe(false)
  })
})

/**
 * Mıknatıs ve "neden yapışmadı" teşhisi.
 *
 * Buradaki en önemli olgu bir HATA değil, bir ÖLÇÜ: varsayılan teleskopik ile
 * varsayılan roller asla eşleşmez (800 ⨯ 600 mm şerit, 0,90 ⨯ 0,75 m kot; iki
 * kural da sıfır toleranslı). Kullanıcı kararı gereği sistem bunu düzeltmiyor,
 * SÖYLÜYOR — ve bu testler söylediğini kilitliyor.
 */
describe('teleskopik mıknatısı — kuyruktan hatta', () => {
  const A4 = TELESCOPIC_MODELS['a4-6+12']
  const roller = (id: string, overrides: Record<string, unknown> = {}) =>
    ConveyorRollerNode.parse({ id: `conveyor_roller_${id}`, rollers: 40, ...overrides })
  const tele = (id: string, overrides: Record<string, unknown> = {}) =>
    ConveyorTelescopicNode.parse({ id: `conveyor-telescopic_${id}`, ...overrides })
  const scene = (...nodes: Array<{ id: string }>) =>
    Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<string, unknown>

  beforeEach(() => {
    resetLineIndex()
    resetPortMagnet()
  })

  test('şerit ve kot uyunca kuyruk hattın çıkışına TAM oturur', () => {
    // Roller'ı teleskopiğe uydur: 600 mm şerit, modelin kotu.
    const line = roller('line', {
      position: [0, 0, 0],
      usefulWidth: '600',
      transportHeight: A4.heightM,
    })
    const lineLength = moduleLengthM(line)
    const boom = tele('boom', { beltWidth: '600', position: [40, 0, 40] })

    // Kuyruk `-A/2`'de; hattın çıkışına oturması için gövde merkezi
    // `lineLength/2 + A/2` olmalı. Elle 9 cm ıskalanmış bir bırakma.
    const target = lineLength / 2 + A4.fixedM / 2
    const snapped = snapToLineEnd(boom, [target - 0.09, 0, 0.06], 0, [boom.id], scene(line, boom))
    expect(snapped).not.toBeNull()
    expect(snapped?.[0]).toBeCloseTo(target, 9)
    expect(snapped?.[2]).toBeCloseTo(0, 9)
  })

  test('VARSAYILANLAR eşleşmez — ve panel bunu sessizce geçmez', () => {
    const line = roller('line', { position: [0, 0, 0] }) // 600 mm, 0.75 m
    const target = moduleLengthM(line) / 2 + A4.fixedM / 2
    const boom = tele('boom', { position: [target, 0, 0] }) // 800 mm, 0.90 m

    const nodes = scene(line, boom)
    // Mıknatıs çekmiyor…
    expect(snapToLineEnd(boom, [target - 0.05, 0, 0], 0, [boom.id], nodes)).toBeNull()
    // …ama sebebi yazılı. Sessizlik en kötü anlatım olurdu.
    const blockers = mateBlockers(boom, [target, 0, 0], 0, nodes)
    expect(blockers.length).toBeGreaterThan(0)
    expect(blockers.join(' ')).toContain('şerit')
  })

  test('şerit düzelince sıra kota gelir — kullanıcı adım adım görür', () => {
    const line = roller('line', { position: [0, 0, 0], usefulWidth: '600' })
    const target = moduleLengthM(line) / 2 + A4.fixedM / 2
    const boom = tele('boom', { beltWidth: '600', position: [target, 0, 0] })
    const blockers = mateBlockers(boom, [target, 0, 0], 0, scene(line, boom))
    expect(blockers.join(' ')).toContain('kot')
    // Ve teleskopiğin kotu ALANDAN değil modelden geldiği için mesajda o değer
    // geçmeli — kullanıcı hangi tarafı düzelteceğini bilsin.
    expect(blockers.join(' ')).toContain(A4.heightM.toFixed(3))
  })

  test('uzakta hiçbir uyarı üretmez — gürültü yapmaz', () => {
    const line = roller('line', { position: [0, 0, 0], usefulWidth: '600' })
    const boom = tele('boom', { position: [60, 0, 60] })
    expect(mateBlockers(boom, [60, 0, 60], 0, scene(line, boom))).toHaveLength(0)
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

describe('kuyruk kotu ayarlanabilir — makinenin birleşebilmesinin şartı', () => {
  const tele = (overrides: Record<string, unknown> = {}) =>
    ConveyorTelescopicNode.parse({ id: 'conveyor-telescopic_t', ...overrides })
  const roller = (overrides: Record<string, unknown> = {}) =>
    ConveyorRollerNode.parse({ id: 'conveyor_roller_t', rollers: 40, ...overrides })

  beforeEach(() => {
    resetLineIndex()
    resetPortMagnet()
  })

  test('alan boşken kot modelin KATALOG değeri', () => {
    // Sabit bir varsayılan yazmak katalogdaki dört kottan üçünü sessizce
    // yanlışlardı; alan bu yüzden opsiyonel.
    for (const model of ALL) {
      expect(transportHeightM(tele({ model: model.id })), model.label).toBeCloseTo(model.heightM, 9)
    }
  })

  test('kot ayarlandığında port O kotu bildiriyor', () => {
    const node = tele({ transportHeight: 0.75 })
    expect(transportHeightAt(node, 'a')).toBeCloseTo(0.75, 9)
  })

  test('şerit ve kot eşleşince teleskopik bir makara hattına BİRLEŞİYOR', () => {
    /**
     * Bildirilen eksik: "teleskopik diğer konveyör ürünleri ile
     * birleşebilmeli." Birleşemiyordu ve sebebi iki katmanlıydı — şerit
     * sınıfı (600/800/1000'e karşı 400/600) ve bant kotu (modelden sabit
     * 0,80–1,05 m'ye karşı ailenin 0,75 m'si). Mıknatıs ikisinde de sıfır
     * tolerans istiyor, ve kotu ayarlayacak alan hiç yoktu.
     *
     * Test iki ucu da eşitleyip mıknatısın gerçekten engel bildirmediğini
     * ölçüyor. Kot alanı geri alınırsa 'kot' engeli yeniden çıkar.
     */
    const line = roller({ position: [0, 0, 0], usefulWidth: '600', transportHeight: 0.75 })
    const boom = tele({ beltWidth: '600', transportHeight: 0.75, flow: 'forward' })

    // Bomun kuyruğu −X'e bakıyor; hattın çıkışına kuyruk kotunda dayanıyor.
    const tail = localPorts(boom).find((port) => port.id === 'a')
    if (!tail) throw new Error('kuyruk portu yok')
    const seam = moduleLengthM(line) / 2
    const at: [number, number, number] = [seam - tail.x, 0, 0]

    const blockers = mateBlockers(boom, at, 0, { [line.id]: line })
    expect(blockers).toEqual([])
    expect(snapToLineEnd(boom, at, 0, [], { [line.id]: line })).not.toBeNull()
  })

  test('kot AYRIŞTIĞINDA mıknatıs hâlâ engelliyor — kural gevşetilmedi', () => {
    // Kotu ayarlanabilir yapmak, basamaklı bir eki serbest bırakmak değil:
    // iki yatak arasındaki basamak kutunun takılacağı yer ve kural yerinde.
    const line = roller({ position: [0, 0, 0], usefulWidth: '600', transportHeight: 0.75 })
    const boom = tele({ beltWidth: '600', transportHeight: 0.95 })

    const tail = localPorts(boom).find((port) => port.id === 'a')
    if (!tail) throw new Error('kuyruk portu yok')
    const at: [number, number, number] = [moduleLengthM(line) / 2 - tail.x, 0, 0]

    expect(mateBlockers(boom, at, 0, { [line.id]: line }).length).toBeGreaterThan(0)
  })

  test('kot geometri anahtarına giriyor — iki kot tek buffer’ı paylaşmaz', () => {
    // Kot bütün yüksekliği sürüyor (gövde kirişi, bacaklar, kademeler). Anahtarda
    // olmasaydı farklı kottaki iki bom aynı mesh'i paylaşır ve biri yanlış
    // yükseklikte çizilirdi — ekranda hata yok, yalnız makine yerde değil.
    const low = tele({ transportHeight: 0.75 })
    const high = tele({ transportHeight: 1.2 })

    expect(telescopicBaseKey(low, 'full')).not.toBe(telescopicBaseKey(high, 'full'))
    expect(telescopicSectionKey(low, 1, 'full')).not.toBe(telescopicSectionKey(high, 1, 'full'))
  })
})
