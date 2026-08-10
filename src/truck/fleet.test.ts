import { describe, expect, test } from 'bun:test'
import { PalletNode } from '../pallet/schema'
import { resetRackIndex } from '../pallet/slot-placement'
import { resetOccupancyIndex } from '../rack/occupancy'
import { PalletRackNode } from '../rack/schema'
import { palletSlotsOf } from '../rack/slots'
import { RouteNode } from '../route/schema'
import { bindTruck, buildFleet, DWELL_S, FLEET_LIMIT, poseOf, stepFleet } from './fleet'
import { claimRoute, ROUTE_CLAIM_M } from './route-binding'
import { buildTrack, sampleTrack } from './route-index'
import { TruckNode } from './schema'

const LEVEL = 'level_main'

function route(overrides: Partial<RouteNode> = {}): RouteNode {
  return RouteNode.parse({
    id: `route_${Math.random().toString(36).slice(2, 10)}`,
    parentId: LEVEL,
    role: 'vehicle',
    width: 3.5,
    ...overrides,
  })
}

function truck(overrides: Partial<TruckNode> = {}): TruckNode {
  return TruckNode.parse({
    id: `truck_${Math.random().toString(36).slice(2, 10)}`,
    parentId: LEVEL,
    duty: 'shuttle',
    ...overrides,
  })
}

function scene(...nodes: Array<{ id: string }>): Record<string, unknown> {
  return Object.fromEntries(nodes.map((node) => [node.id, node]))
}

describe('rota örnekleyici', () => {
  test('doğuya giden segmentte dönüş 0, kuzeye (+Z) gidende −π/2', () => {
    // İleri +X ve three yaw'ı ileriyi (cosθ, 0, −sinθ)'ya götürür — işaret
    // burada kilitli: yanlış işaret 0°'de görünmez, araç rotayı aynada sürer.
    const east = buildTrack(
      route({
        points: [
          [0, 0],
          [10, 0],
        ],
      }),
    )
    const north = buildTrack(
      route({
        points: [
          [0, 0],
          [0, 10],
        ],
      }),
    )
    if (!east || !north) throw new Error('track kurulamadı')
    expect(sampleTrack(east, 5).headingRad).toBeCloseTo(0, 9)
    expect(sampleTrack(north, 5).headingRad).toBeCloseTo(-Math.PI / 2, 9)
  })

  test("örnek, rota origin'ini toplar — poz level çerçevesindedir (T28)", () => {
    const r = route({
      position: [10, 0, 20],
      points: [
        [0, 0],
        [4, 0],
      ],
    })
    const track = buildTrack(r)
    if (!track) throw new Error('track kurulamadı')
    const sample = sampleTrack(track, 2)
    expect(sample.x).toBeCloseTo(12, 9)
    expect(sample.z).toBeCloseTo(20, 9)
  })

  test('s aralık dışıysa kırpılır — koşarken kısalan rota taşırmaz (T30)', () => {
    const track = buildTrack(
      route({
        points: [
          [0, 0],
          [6, 0],
        ],
      }),
    )
    if (!track) throw new Error('track kurulamadı')
    expect(sampleTrack(track, 999).x).toBeCloseTo(6, 9)
    expect(sampleTrack(track, -5).x).toBeCloseTo(0, 9)
  })

  test('yozlaşmış rota null — sessiz NaN yok', () => {
    expect(
      buildTrack(
        route({
          points: [
            [3, 3],
            [3, 3],
          ],
        }),
      ),
    ).toBeNull()
  })
})

describe('T28 — bağlanma kuralları', () => {
  test('farklı ebeveyndeki rota reddedilir: asma kattaki araç zemin rotasında süremez', () => {
    const r = route({ parentId: 'level_mezzanine' })
    const t = truck({ routeId: r.id })
    const bound = bindTruck(t, scene(r, t))
    expect('refusal' in bound && bound.refusal).toBe('different-parent')
  })

  test('yaya yolu reddedilir; silinmiş rota reddedilir; motorsuz makine reddedilir', () => {
    const walkway = route({ role: 'pedestrian' })
    const t1 = truck({ routeId: walkway.id })
    expect('refusal' in bindTruck(t1, scene(walkway, t1))).toBe(true)

    const t2 = truck({ routeId: 'route_deleted' })
    const b2 = bindTruck(t2, scene(t2))
    expect('refusal' in b2 && b2.refusal).toBe('route-missing')

    const r = route()
    const manual = truck({ routeId: r.id, model: 'mpt-680x1150' })
    const b3 = bindTruck(manual, scene(r, manual))
    expect('refusal' in b3 && b3.refusal).toBe('no-drive')
  })

  test('park görevi filoya girmez', () => {
    const r = route()
    const parked = truck({ routeId: r.id, duty: 'parked' })
    const fleet = buildFleet(scene(r, parked))
    expect(fleet.trucks.length).toBe(0)
  })
})

describe('T27 — simülasyon sahneye yazmaz', () => {
  test('200 raf + 100 palet + 20 araç: 600 adım, düğümler bayt bayt aynı; tavan 16', () => {
    const r = route({
      points: [
        [0, 0],
        [50, 0],
      ],
    })
    const nodes: Record<string, unknown> = { [r.id]: r }
    for (let i = 0; i < 200; i++) {
      const rack = PalletRackNode.parse({ position: [i * 3, 0, 10] })
      nodes[rack.id] = rack
    }
    for (let i = 0; i < 100; i++) {
      const pallet = PalletNode.parse({ position: [i * 2, 0, 20] })
      nodes[pallet.id] = pallet
    }
    for (let i = 0; i < 20; i++) {
      const t = truck({ routeId: r.id, routeAnchor: i / 20 })
      nodes[t.id] = t
    }

    const before = JSON.stringify(nodes)
    const fleet = buildFleet(nodes)
    // Boş sahne bunu gizlerdi: uygun 20 araçtan 16'sı koşar, 4'ü park kalır
    // ve panel bunu söyleyebilsin diye sayı dışarı verilir.
    expect(fleet.trucks.length).toBe(FLEET_LIMIT)
    expect(fleet.skipped).toBe(4)

    for (let i = 0; i < 600; i++) stepFleet(fleet, 0.05)
    for (const t of fleet.trucks) poseOf(t)
    expect(JSON.stringify(nodes)).toBe(before)
  })

  test('deterministik sıra: filo seçimi id sırasıyla, karedeki nesne kimlikleri sabit', () => {
    const r = route()
    const t1 = truck({ routeId: r.id })
    const t2 = truck({ routeId: r.id })
    const nodes = scene(r, t1, t2)
    const a = buildFleet(nodes)
    const b = buildFleet(nodes)
    expect(a.trucks.map((t) => t.id)).toEqual(b.trucks.map((t) => t.id))
  })
})

describe('istasyon listesi filo kaydında taşınır', () => {
  /**
   * Sessiz hata: `stations` boş kalırsa panelin sabitleme listeleri boşalır ve
   * çevrim koşarken bile kullanıcı kaynak/hedef seçemez — hiçbir yerde hata
   * çıkmaz, yalnız iki açılır liste "kura (otomatik)"tan ibaret kalır.
   */
  test('çevrimi olan aracın istasyonları boş değil ve kaynağıyla hedefini içerir', () => {
    resetRackIndex()
    resetOccupancyIndex()
    const r = route({
      position: [0, 0, 0],
      points: [
        [0, 0],
        [30, 0],
      ],
    })
    const rack = PalletRackNode.parse({
      id: 'pallet-rack_a',
      parentId: LEVEL,
      position: [5, 0, 2],
      levels: 3,
    })
    // Yuvaların bir kısmı dolu: kaynak da hedef de bulunabilsin.
    const pallets = palletSlotsOf(rack)
      .slice(0, 3)
      .map((slot, index) =>
        PalletNode.parse({
          id: `pallet_${index}`,
          parentId: LEVEL,
          slotRackId: rack.id,
          slotAddress: slot.id,
        }),
      )
    const t = truck({ routeId: r.id })
    const fleet = buildFleet(scene(r, rack, t, ...pallets))
    const driver = fleet.trucks[0]
    if (!driver?.cycle) throw new Error('çevrim kurulmadı')

    expect(driver.stations.length).toBeGreaterThan(0)
    const addresses = driver.stations.map((station) => `${station.rackId}/${station.slot.id}`)
    const { source, target } = driver.cycle.assignment
    expect(addresses).toContain(`${source.rackId}/${source.slot.id}`)
    expect(addresses).toContain(`${target.rackId}/${target.slot.id}`)
  })
})

describe('uç davranışı — çizilmemiş yol uydurulmaz', () => {
  test('two-way uçta yön çevirir ve aşan mesafe taşınır', () => {
    const r = route({
      points: [
        [0, 0],
        [10, 0],
      ],
      traffic: 'two-way',
    })
    const t = truck({ routeId: r.id })
    const fleet = buildFleet(scene(r, t))
    const driver = fleet.trucks[0]
    if (!driver) throw new Error('araç filoya girmedi')
    driver.s = 9.9
    // forklift 16 km/h ≈ 4.44 m/s; 0.1 s'te ~0.444 m → ucu 0.1 m'de aşar,
    // kalan 0.344 geri yönde sürülür — yutulmaz.
    stepFleet(fleet, 0.1)
    expect(driver.dir).toBe(-1)
    expect(driver.s).toBeCloseTo(10 - (0.444 - 0.1), 1)
  })

  test('one-way uçta DWELL_S bekler, sonra başta yeniden belirir', () => {
    const r = route({
      points: [
        [0, 0],
        [5, 0],
      ],
      traffic: 'one-way',
    })
    const t = truck({ routeId: r.id })
    const fleet = buildFleet(scene(r, t))
    const driver = fleet.trucks[0]
    if (!driver) throw new Error('araç filoya girmedi')
    driver.s = 4.99
    stepFleet(fleet, 0.1)
    expect(driver.s).toBe(5)
    expect(driver.dwellRemaining).toBeGreaterThan(0)
    for (let i = 0; i < Math.ceil(DWELL_S / 0.1) + 2; i++) stepFleet(fleet, 0.1)
    expect(driver.s).toBeLessThan(1)
    expect(driver.dir).toBe(1)
  })

  test('geri yönde burun döner: poz açısı π kayar', () => {
    const r = route({
      points: [
        [0, 0],
        [10, 0],
      ],
      traffic: 'two-way',
    })
    const t = truck({ routeId: r.id })
    const fleet = buildFleet(scene(r, t))
    const driver = fleet.trucks[0]
    if (!driver) throw new Error('araç filoya girmedi')
    driver.s = 5
    expect(poseOf(driver).rotation).toBeCloseTo(0, 9)
    driver.dir = -1
    expect(poseOf(driver).rotation).toBeCloseTo(Math.PI, 9)
  })
})

describe("rota talebi — commit'te bir kez", () => {
  test('eşik içindeki en yakın vehicle rota; yaya yolu asla', () => {
    const aisle = route({
      position: [0, 0, 0],
      points: [
        [0, 0],
        [20, 0],
      ],
    })
    const walkway = route({
      role: 'pedestrian',
      position: [0, 0, 0.5],
      points: [
        [0, 0],
        [20, 0],
      ],
    })
    const nodes = scene(aisle, walkway)
    expect(claimRoute(nodes, LEVEL, 10, 1.0)).toBe(aisle.id)
    expect(claimRoute(nodes, LEVEL, 10, 0.6)).toBe(aisle.id)
    expect(claimRoute(nodes, LEVEL, 10, ROUTE_CLAIM_M + 2)).toBeNull()
  })

  test("başka level'ın rotası talep edilmez", () => {
    const other = route({ parentId: 'level_mezzanine' })
    expect(claimRoute(scene(other), LEVEL, 0, 0)).toBeNull()
  })
})
