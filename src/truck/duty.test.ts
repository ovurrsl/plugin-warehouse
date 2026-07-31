import { describe, expect, test } from 'bun:test'
import { TRUCK_MODELS } from '../handling/models'
import { PalletNode } from '../pallet/schema'
import { resetRackIndex } from '../pallet/slot-placement'
import { resetOccupancyIndex, slotDraw } from '../rack/occupancy'
import { PalletRackNode } from '../rack/schema'
import { palletSlotsOf } from '../rack/slots'
import { RouteNode } from '../route/schema'
import { COMMIT_REFUSAL_TEXT, planCommit } from './commit-move'
import { buildCycle, carriesPallet, cycleSeconds, stepAt, TRAVEL_FORK_Y } from './duty'
import { buildTrack } from './route-index'
import { assignmentFor, stationsAlong } from './stations'

const LEVEL = 'level_main'

function track(
  points: Array<[number, number]> = [
    [0, 0],
    [30, 0],
  ],
) {
  const route = RouteNode.parse({
    id: 'route_aisle',
    parentId: LEVEL,
    role: 'vehicle',
    points,
  })
  const built = buildTrack(route)
  if (!built) throw new Error('track kurulamadı')
  return built
}

/** Rotanın 2 m yanında, koridora bakan bir raf. */
function rack(id: string, x: number, z = 2) {
  return PalletRackNode.parse({ id, parentId: LEVEL, position: [x, 0, z], levels: 3 })
}

function scene(...nodes: Array<{ id: string }>): Record<string, unknown> {
  resetRackIndex()
  resetOccupancyIndex()
  return Object.fromEntries(nodes.map((node) => [node.id, node]))
}

const FORKLIFT = TRUCK_MODELS['forklift-1300']
const MPT = TRUCK_MODELS['mpt-680x1150']

describe('istasyon seçimi', () => {
  test('rotanın yanındaki rafın erişilebilir yuvaları istasyon olur, sıralı', () => {
    const nodes = scene(rack('pallet-rack_a', 5), rack('pallet-rack_b', 20))
    const stations = stationsAlong(nodes, track(), FORKLIFT)
    expect(stations.length).toBeGreaterThan(0)
    // Yay parametresine göre sıralı — araç ileri geri zıplamaz.
    for (let i = 1; i < stations.length; i++) {
      expect(stations[i]?.s ?? 0).toBeGreaterThanOrEqual(stations[i - 1]?.s ?? 0)
    }
    expect(new Set(stations.map((s) => s.rackId))).toEqual(
      new Set(['pallet-rack_a', 'pallet-rack_b']),
    )
  })

  test('uzaktaki raf istasyon DEĞİL — erişim yarıçapı gerçek bir sınır', () => {
    const nodes = scene(rack('pallet-rack_far', 5, 40))
    expect(stationsAlong(nodes, track(), FORKLIFT).length).toBe(0)
  })

  test('başka kattaki raf istasyon değil', () => {
    const other = PalletRackNode.parse({
      id: 'pallet-rack_up',
      parentId: 'level_mezzanine',
      position: [5, 0, 2],
    })
    expect(stationsAlong(scene(other), track(), FORKLIFT).length).toBe(0)
  })

  test('transpalet YALNIZ zemin katına hizmet eder — 0.12 m strok', () => {
    // Yayınlanmış veriden çıkan sert olgu: 0.12 m'lik strok paleti yerden
    // kaldırır ama hiçbir kiriş katına ulaşmaz. Kural araca özgüdür ve
    // yuvanın KOTUNDAN çıkar, makinenin adından değil.
    const nodes = scene(rack('pallet-rack_a', 5))
    const byPalletTruck = stationsAlong(nodes, track(), MPT)
    expect(byPalletTruck.length).toBeGreaterThan(0)
    for (const station of byPalletTruck) {
      expect(station.slot.localPosition[1]).toBeCloseTo(0, 9)
    }
    // Forklift aynı sahnede kiriş katlarına da çıkar.
    const byForklift = stationsAlong(nodes, track(), FORKLIFT)
    expect(byForklift.length).toBeGreaterThan(byPalletTruck.length)
    expect(byForklift.some((s) => s.slot.localPosition[1] > 1)).toBe(true)
  })

  test('dolu ve boş yuvalar ayrılır; dolu olan kaynak', () => {
    const r = rack('pallet-rack_a', 5)
    const slots = palletSlotsOf(r)
    const first = slots[0]
    if (!first) throw new Error('yuva yok')
    const pallet = PalletNode.parse({
      id: 'pallet_x',
      parentId: LEVEL,
      slotRackId: r.id,
      slotAddress: first.id,
    })
    const stations = stationsAlong(scene(r, pallet), track(), FORKLIFT)
    const source = stations.find((s) => s.slot.id === first.id)
    expect(source?.occupied).toBe(true)
    expect(stations.some((s) => !s.occupied)).toBe(true)
  })
})

describe('T34 — eşleme deterministik: sahne dosyasının fonksiyonu', () => {
  test('aynı araç aynı sahnede AYNI çevrimi seçer, her seferinde', () => {
    const r = rack('pallet-rack_a', 5)
    const slots = palletSlotsOf(r)
    const pallets = slots.slice(0, 3).map((slot, index) =>
      PalletNode.parse({
        id: `pallet_${index}`,
        parentId: LEVEL,
        slotRackId: r.id,
        slotAddress: slot.id,
      }),
    )
    const nodes = scene(r, ...pallets)
    const stations = stationsAlong(nodes, track(), FORKLIFT)

    const a = assignmentFor('truck_abc', stations)
    const b = assignmentFor('truck_abc', stations)
    expect(a?.source.slot.id).toBe(b?.source.slot.id ?? '')
    expect(a?.target.slot.id).toBe(b?.target.slot.id ?? '')
  })

  test('farklı araçlar farklı çevrim seçebilir; kaynak ile hedef aynı olamaz', () => {
    const r = rack('pallet-rack_a', 5)
    const slots = palletSlotsOf(r)
    const pallets = slots.slice(0, 4).map((slot, index) =>
      PalletNode.parse({
        id: `pallet_${index}`,
        parentId: LEVEL,
        slotRackId: r.id,
        slotAddress: slot.id,
      }),
    )
    const stations = stationsAlong(scene(r, ...pallets), track(), FORKLIFT)
    for (const id of ['truck_a', 'truck_b', 'truck_c']) {
      const assignment = assignmentFor(id, stations)
      if (!assignment) continue
      expect(assignment.source.occupied).toBe(true)
      expect(assignment.target.occupied).toBe(false)
    }
  })

  test('kaynak ya da hedef yoksa çevrim yok — boş sahnede araç park kalır', () => {
    const stations = stationsAlong(scene(rack('pallet-rack_a', 5)), track(), FORKLIFT)
    // Hepsi boş: taşınacak palet yok.
    expect(assignmentFor('truck_a', stations)).toBeNull()
  })
})

describe('faz makinesi — süre yayınlanmış orandan çıkar', () => {
  function cycleFixture() {
    const r = rack('pallet-rack_a', 5)
    const slots = palletSlotsOf(r)
    const first = slots[0]
    if (!first) throw new Error('yuva yok')
    const pallet = PalletNode.parse({
      id: 'pallet_x',
      parentId: LEVEL,
      slotRackId: r.id,
      slotAddress: first.id,
    })
    const stations = stationsAlong(scene(r, pallet), track(), FORKLIFT)
    const assignment = assignmentFor('truck_a', stations)
    if (!assignment) throw new Error('çevrim kurulamadı')
    return { assignment, steps: buildCycle(FORKLIFT, assignment.source, assignment.target, 0) }
  }

  test('betik bir dizidir ve sıfır süreli faz İÇERMEZ', () => {
    const { steps } = cycleFixture()
    expect(steps.length).toBeGreaterThan(0)
    for (const step of steps) expect(step.durationS).toBeGreaterThan(0)
  })

  test('sürüş süresi mesafe/hız — sabit değil', () => {
    const r = rack('pallet-rack_a', 5)
    const slots = palletSlotsOf(r)
    const first = slots[0]
    if (!first) throw new Error('yuva yok')
    const near = stationsAlong(scene(r), track(), FORKLIFT)[0]
    if (!near) throw new Error('istasyon yok')
    const far = { ...near, s: near.s + 20 }
    const short = buildCycle(FORKLIFT, near, { ...near, s: near.s + 5 }, 0)
    const long = buildCycle(FORKLIFT, near, far, 0)
    const shortTravel = short.find((s) => s.phase === 'travel-to-target')?.durationS ?? 0
    const longTravel = long.find((s) => s.phase === 'travel-to-target')?.durationS ?? 0
    expect(longTravel).toBeCloseTo(shortTravel * 4, 5)
    // 16 km/h = 4.444 m/s; 5 m → 1.125 s.
    expect(shortTravel).toBeCloseTo(5 / ((16 * 1000) / 3600), 6)
  })

  test('stepAt betiği baştan sona gezer ve sonunda son adımda kalır', () => {
    const { steps } = cycleFixture()
    const total = cycleSeconds(steps)
    expect(stepAt(steps, 0)?.index).toBe(0)
    expect(stepAt(steps, total + 10)?.index).toBe(steps.length - 1)
    const mid = stepAt(steps, total / 2)
    expect(mid).not.toBeNull()
    expect(mid?.progress).toBeGreaterThanOrEqual(0)
    expect(mid?.progress).toBeLessThanOrEqual(1)
  })

  test('palet yalnız alma ile bırakma ARASINDA araçta', () => {
    expect(carriesPallet('travel-to-source')).toBe(false)
    expect(carriesPallet('engage')).toBe(false)
    expect(carriesPallet('travel-to-target')).toBe(true)
    expect(carriesPallet('release')).toBe(false)
    expect(carriesPallet('dwell')).toBe(false)
  })

  test('taşıma kotu güvenli yükseklikte, alma kotu yuvanın kendisi', () => {
    const { steps, assignment } = cycleFixture()
    const travel = steps.find((s) => s.phase === 'travel-to-target')
    expect(travel?.forkY).toBe(TRAVEL_FORK_Y)
    const lift = steps.find((s) => s.phase === 'lift-source')
    expect(lift?.forkY).toBeCloseTo(assignment.source.slot.localPosition[1], 9)
  })
})

describe('T33 — taahhüt: hayalet palet üretilemez', () => {
  function fixture() {
    const r = rack('pallet-rack_a', 5)
    const slots = palletSlotsOf(r)
    const first = slots[0]
    const second = slots[1]
    if (!first || !second) throw new Error('yuva yok')
    const pallet = PalletNode.parse({
      id: 'pallet_x',
      parentId: LEVEL,
      slotRackId: r.id,
      slotAddress: first.id,
    })
    const nodes = scene(r, pallet)
    const stations = stationsAlong(nodes, track(), FORKLIFT)
    const source = stations.find((s) => s.slot.id === first.id)
    const target = stations.find((s) => s.slot.id === second.id)
    if (!source || !target) throw new Error('istasyon yok')
    return { nodes, source, target, pallet }
  }

  test('geçerli taşıma yamayı üretir; yuva adresi hedefin adresidir', () => {
    const { nodes, source, target } = fixture()
    const plan = planCommit(nodes, 'pallet_x', source, target)
    if ('refusal' in plan) throw new Error(`beklenmedik ret: ${plan.refusal}`)
    expect(plan.patch.slotAddress).toBe(target.slot.id)
    expect(plan.patch.slotRackId).toBe(target.rackId)
    // Y konvansiyonu: yuva yüzeyinin kendisi — elle yerleştirmeyle aynı.
    expect(plan.patch.position[1]).toBeCloseTo(target.slot.localPosition[1], 9)
  })

  test('hedef bu arada dolduysa REDDEDER — indeks yeniden sorulur', () => {
    const { nodes, source, target } = fixture()
    const blocker = PalletNode.parse({
      id: 'pallet_blocker',
      parentId: LEVEL,
      slotRackId: target.rackId,
      slotAddress: target.slot.id,
    })
    resetOccupancyIndex()
    const busy = { ...nodes, [blocker.id]: blocker }
    const plan = planCommit(busy, 'pallet_x', source, target)
    expect('refusal' in plan && plan.refusal).toBe('target-occupied')
  })

  test('palet elle taşınmışsa REDDEDER — başkasının yerini bozmaz', () => {
    const { nodes, source, target } = fixture()
    const moved = { ...(nodes.pallet_x as object), slotAddress: 'başka' }
    const plan = planCommit({ ...nodes, pallet_x: moved }, 'pallet_x', source, target)
    expect('refusal' in plan && plan.refusal).toBe('source-mismatch')
  })

  test('silinmiş palet REDDEDER', () => {
    const { nodes, source, target } = fixture()
    const { pallet_x, ...without } = nodes
    void pallet_x
    const plan = planCommit(without, 'pallet_x', source, target)
    expect('refusal' in plan && plan.refusal).toBe('pallet-missing')
  })

  test('her ret kodunun kullanıcıya söylenecek bir cümlesi var', () => {
    for (const key of ['pallet-missing', 'target-occupied', 'source-mismatch'] as const) {
      expect(COMMIT_REFUSAL_TEXT[key].length).toBeGreaterThan(20)
    }
  })
})

describe('hayalet stok ile çakışma — ekranda dolu yuvaya gerçek palet bırakılmaz', () => {
  /** Yarı hayaletli bir raf: yuvaların yaklaşık yarısı stoklu görünür. */
  function ghostedRack(id: string, x: number) {
    return PalletRackNode.parse({
      id,
      parentId: LEVEL,
      position: [x, 0, 2],
      levels: 3,
      ghostFill: 0.5,
    })
  }

  test('hayaletli yuva istasyonda İŞARETLİ ve GhostStock ile aynı eşikten', () => {
    const r = ghostedRack('pallet-rack_g', 5)
    const stations = stationsAlong(scene(r), track(), FORKLIFT)
    expect(stations.length).toBeGreaterThan(0)
    let ghosted = 0
    for (const station of stations) {
      // Panelin/istasyonun kuralı, `GhostStock`'un kuralının birebir aynısı
      // olmak zorunda: iki eşik, ekranda görünenle hesabın ayrışmasıdır.
      const expected = !station.occupied && slotDraw(r.id, station.slot.id) < 0.5
      expect(station.ghosted, station.slot.id).toBe(expected)
      if (station.ghosted) ghosted++
    }
    expect(ghosted).toBeGreaterThan(0) // fikstür gerçekten hayalet üretiyor
  })

  test('hedef ASLA hayaletli yuva olmaz — iki palet üst üste gelmez', () => {
    const r = ghostedRack('pallet-rack_g', 5)
    const slots = palletSlotsOf(r)
    // Birkaç gerçek palet koy ki kaynak bulunsun.
    const pallets = slots.slice(0, 2).map((slot, index) =>
      PalletNode.parse({
        id: `pallet_${index}`,
        parentId: LEVEL,
        slotRackId: r.id,
        slotAddress: slot.id,
      }),
    )
    const stations = stationsAlong(scene(r, ...pallets), track(), FORKLIFT)
    for (const id of ['truck_a', 'truck_b', 'truck_c', 'truck_d', 'truck_e']) {
      const assignment = assignmentFor(id, stations)
      if (!assignment) continue
      expect(assignment.target.ghosted, `${id} hayaletli yuvayı hedef seçti`).toBe(false)
      expect(assignment.target.occupied).toBe(false)
    }
  })

  test('hayaletli yuva kaynak da olamaz — taşınacak gerçek düğüm yok', () => {
    const r = ghostedRack('pallet-rack_g', 5)
    const stations = stationsAlong(scene(r), track(), FORKLIFT)
    // Hiç gerçek palet yok: hayaletler dolu görünse de kaynak üretmez.
    expect(stations.some((s) => s.occupied)).toBe(false)
    expect(assignmentFor('truck_a', stations)).toBeNull()
  })

  test('taşıma sırasında kaynak yuvada hayalet BELİRMEZ — simülasyon sahneye yazmıyor', () => {
    const r = ghostedRack('pallet-rack_g', 5)
    const slots = palletSlotsOf(r)
    const first = slots[0]
    if (!first) throw new Error('yuva yok')
    const pallet = PalletNode.parse({
      id: 'pallet_x',
      parentId: LEVEL,
      slotRackId: r.id,
      slotAddress: first.id,
    })
    const nodes = scene(r, pallet)
    // Araç paleti taşırken düğümün `slotAddress`'i DEĞİŞMEZ, dolayısıyla
    // yuva hâlâ dolu sayılır ve GhostStock oraya hayalet koymaz. Boşluk
    // ancak taahhütten sonra oluşur — ki o da özelliğin kendisidir.
    const stations = stationsAlong(nodes, track(), FORKLIFT)
    const source = stations.find((s) => s.slot.id === first.id)
    expect(source?.occupied).toBe(true)
    expect(source?.ghosted).toBe(false)
  })

  test('hayaletsiz rafta hiçbir istasyon hayaletli değil — özellik kapalıyken kural yok', () => {
    const stations = stationsAlong(scene(rack('pallet-rack_a', 5)), track(), FORKLIFT)
    expect(stations.every((s) => !s.ghosted)).toBe(true)
  })
})

describe('yuva sabitleme — kullanıcı kurayı geçersiz kılar (plan §6.1)', () => {
  function pinFixture() {
    const r = rack('pallet-rack_a', 5)
    const slots = palletSlotsOf(r)
    const pallets = slots.slice(0, 3).map((slot, index) =>
      PalletNode.parse({
        id: `pallet_${index}`,
        parentId: LEVEL,
        slotRackId: r.id,
        slotAddress: slot.id,
      }),
    )
    const stations = stationsAlong(scene(r, ...pallets), track(), FORKLIFT)
    return { rackId: r.id, stations }
  }

  test('sabitlenen kaynak ve hedef kurayı yener', () => {
    const { rackId, stations } = pinFixture()
    const occupied = stations.filter((s) => s.occupied)
    const empty = stations.filter((s) => !s.occupied && !s.ghosted)
    const pick = occupied[occupied.length - 1]
    const drop = empty[empty.length - 1]
    if (!pick || !drop) throw new Error('fikstür yetersiz')

    const pinned = assignmentFor('truck_abc', stations, {
      pick: { rackId, address: pick.slot.id },
      drop: { rackId, address: drop.slot.id },
    })
    expect(pinned?.source.slot.id).toBe(pick.slot.id)
    expect(pinned?.target.slot.id).toBe(drop.slot.id)
  })

  test('ROLE uymayan sabit yok sayılır: boş yuva kaynak olamaz', () => {
    const { rackId, stations } = pinFixture()
    const empty = stations.find((s) => !s.occupied && !s.ghosted)
    if (!empty) throw new Error('boş yuva yok')
    // Boş yuvayı KAYNAK sabitle: araç olmayan paleti almaya gitmemeli.
    const assignment = assignmentFor('truck_abc', stations, {
      pick: { rackId, address: empty.slot.id },
    })
    expect(assignment?.source.occupied).toBe(true)
    expect(assignment?.source.slot.id).not.toBe(empty.slot.id)
  })

  test('silinmiş rafın sabiti sessizce kuraya düşer', () => {
    const { stations } = pinFixture()
    const withDeadPin = assignmentFor('truck_abc', stations, {
      pick: { rackId: 'pallet-rack_deleted', address: 'R1-B1-L1-P1-D1' },
    })
    const unpinned = assignmentFor('truck_abc', stations)
    // Ölü sabit kurayı DEĞİŞTİRMEZ — davranış sabitsiz hâlin aynısı.
    expect(withDeadPin?.source.slot.id).toBe(unpinned?.source.slot.id ?? '')
  })

  test('sabit de deterministik: aynı sahne + aynı sabit = aynı çevrim', () => {
    const { rackId, stations } = pinFixture()
    const occupied = stations.find((s) => s.occupied)
    if (!occupied) throw new Error('dolu yuva yok')
    const pins = { pick: { rackId, address: occupied.slot.id } }
    const a = assignmentFor('truck_abc', stations, pins)
    const b = assignmentFor('truck_abc', stations, pins)
    expect(a?.source.slot.id).toBe(b?.source.slot.id ?? '')
    expect(a?.target.slot.id).toBe(b?.target.slot.id ?? '')
  })
})
