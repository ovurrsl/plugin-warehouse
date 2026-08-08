import { beforeEach, describe, expect, test } from 'bun:test'
import { useLiveTransforms } from '@pascal-app/core'
import { RouteNode } from '../route/schema'
import { buildFleet, FLEET_LIMIT, type Fleet } from './fleet'
import { publishFleetPoses, releaseFleetPoses } from './live-poses'
import { TruckNode } from './schema'

const LEVEL = 'level_main'

/** Kimliğin kanaldaki bir yabancısı — host'un sürüklediği düğümün yerine
 *  duruyor. Filo onu ne yazmalı ne silmeli. */
const FOREIGN = 'node_dragged_by_user'

function fleetOf(truckCount: number): Fleet {
  const route = RouteNode.parse({
    id: 'route_main',
    parentId: LEVEL,
    role: 'vehicle',
    points: [
      [0, 0],
      [60, 0],
    ],
  })
  const nodes: Record<string, unknown> = { [route.id]: route }
  for (let i = 0; i < truckCount; i++) {
    const truck = TruckNode.parse({
      id: `truck_${String(i).padStart(3, '0')}`,
      parentId: LEVEL,
      duty: 'shuttle',
      routeId: route.id,
      routeAnchor: i / truckCount,
    })
    nodes[truck.id] = truck
  }
  return buildFleet(nodes)
}

/** Kanala yapılan yazım sayısı: zustand her `setState`'te bütün aboneleri
 *  uyandırıyor, yani dinleyici çağrısı = kare başına ödenen bedel. */
function countWrites(run: () => void): number {
  let writes = 0
  const off = useLiveTransforms.subscribe(() => {
    writes++
  })
  try {
    run()
  } finally {
    off()
  }
  return writes
}

beforeEach(() => {
  useLiveTransforms.getState().clearAll()
})

describe('canlı poz kanalı — kare başına tek yazım', () => {
  test('16 araç + taşınan paletler: kare başına 1 yazım, 16 yazım değil', () => {
    const fleet = fleetOf(FLEET_LIMIT)
    expect(fleet.trucks.length).toBe(FLEET_LIMIT)
    // Yarısı palet taşıyor: araç başına İKİ `set` çağıran eski yol burada
    // 24 uyandırma ederdi.
    fleet.trucks.forEach((truck, index) => {
      if (index % 2 === 0) truck.carryingPalletId = `pallet_${index}`
    })

    const driven = new Set<string>()
    const writes = countWrites(() => publishFleetPoses(fleet, new Map(), driven))

    expect(writes).toBe(1)
    expect(driven.size).toBe(FLEET_LIMIT + FLEET_LIMIT / 2)
    // Tek yazım "tek poz" olmasın: hepsi gerçekten kanalda.
    const { transforms } = useLiveTransforms.getState()
    expect(transforms.size).toBe(driven.size)
    for (const id of driven) expect(transforms.has(id)).toBe(true)
  })

  test('store eylemleri yerinde kalır — kısmî setState, replace değil', () => {
    const fleet = fleetOf(2)
    publishFleetPoses(fleet, new Map(), new Set())
    const state = useLiveTransforms.getState()
    // `replace: true` ile yazılsaydı kanal eylemsiz kalır ve host'un
    // sürükleme yolu sessizce çalışmayı bırakırdı.
    expect(typeof state.set).toBe('function')
    expect(typeof state.clear).toBe('function')
    expect(typeof state.clearAll).toBe('function')
  })

  test('yabancı kayıt hem yazımda hem bırakmada hayatta kalır', () => {
    // `clearAll()` ya da sıfırdan kurulmuş bir Map bu kaydı sessizce silerdi:
    // kullanıcının elindeki düğüm, filo koşarken park pozuna atlardı.
    useLiveTransforms.getState().set(FOREIGN, { position: [1, 2, 3], rotation: 0.5 })

    const fleet = fleetOf(3)
    const driven = new Set<string>()
    publishFleetPoses(fleet, new Map(), driven)
    expect(useLiveTransforms.getState().transforms.get(FOREIGN)?.position).toEqual([1, 2, 3])

    releaseFleetPoses(driven)
    const { transforms } = useLiveTransforms.getState()
    expect(transforms.get(FOREIGN)?.position).toEqual([1, 2, 3])
    expect(transforms.size).toBe(1)
  })

  test("yazacak bir şey yoksa store'a hiç dokunulmaz", () => {
    const fleet = fleetOf(4)
    // Dördü de kullanıcının elinde: değişmemiş bir klonu yazmak da tam bir
    // abone uyandırmasıdır.
    const overrides = new Map(fleet.trucks.map((truck) => [truck.id, {}]))
    const driven = new Set<string>()

    expect(countWrites(() => publishFleetPoses(fleet, overrides, driven))).toBe(0)
    expect(driven.size).toBe(0)
    // Boş bırakma da sessiz: durdurma efekti her `running` değişiminde koşuyor.
    expect(countWrites(() => releaseFleetPoses(driven))).toBe(0)
  })

  test('bırakma tek yazım; `keep` verilenler kanalda kalır', () => {
    const fleet = fleetOf(6)
    const driven = new Set<string>()
    publishFleetPoses(fleet, new Map(), driven)

    const keep = new Set([fleet.trucks[0]?.id ?? '', fleet.trucks[1]?.id ?? ''])
    const writes = countWrites(() => releaseFleetPoses(driven, keep))

    expect(writes).toBe(1)
    const { transforms } = useLiveTransforms.getState()
    expect(transforms.size).toBe(2)
    for (const id of keep) expect(transforms.has(id)).toBe(true)
    // Borç defteri de küçülmeli: kalanlar hâlâ bu sistemin sorumluluğunda.
    expect([...driven].sort()).toEqual([...keep].sort())
  })
})
