import { beforeEach, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConveyorCurveNode } from './curve-schema'
import {
  hasDownstreamNeighbour,
  hasUpstreamNeighbour,
  isPortMated,
  lineOf,
  resetLineIndex,
} from './line-index'
import { moduleLengthM } from './metrics'
import {
  jointProblems,
  resetPortMagnet,
  snapPlacementToLineEnd,
  snapToLineEnd,
} from './port-magnet'
import { conveyorPorts, inletPort, localPorts, outletPort } from './ports'
import { ConveyorRollerNode } from './schema'
import { ConveyorTransferNode } from './transfer-schema'

const conveyor = (id: string, overrides: Record<string, unknown> = {}) =>
  ConveyorRollerNode.parse({ id: `conveyor_roller_${id}`, rollers: 40, ...overrides })

const scene = (...nodes: Array<{ id: string }>) =>
  Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<string, unknown>

/** The default bed: 40 rollers at 75 mm. */
const LENGTH = moduleLengthM(conveyor('probe'))

/** Açıyı (−π, π] aralığına indirger — 0 ile 2π'yi aynı saymak için. */
const wrap = (angle: number) =>
  ((((angle + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI

describe('ports are geometric, and they point out of the body', () => {
  beforeEach(() => {
    resetLineIndex()
    resetPortMagnet()
  })

  test('the ids are ends, not roles — flow never renames them', () => {
    // The host snapshots port ids when a drag begins, so a `flow` flipped
    // mid-drag would rename the ports underneath a live snapshot and the
    // connectivity solver would mate the wrong pair.
    const forward = conveyor('f')
    const reverse = conveyor('r', { flow: 'reverse' })
    expect(conveyorPorts(forward).map((port) => port.id)).toEqual(['a', 'b'])
    expect(conveyorPorts(reverse).map((port) => port.id)).toEqual(['a', 'b'])
    // What flow decides is which end is the discharge, read off the node.
    expect(outletPort(forward)).toBe('b')
    expect(outletPort(reverse)).toBe('a')
    expect(inletPort(forward)).toBe('a')
  })

  test('they sit at the bed ends, at the transport height, facing outward', () => {
    const node = conveyor('a', { position: [4, 0, -2], transportHeight: 0.75 })
    const [a, b] = conveyorPorts(node)
    expect(a?.position[0]).toBeCloseTo(4 - LENGTH / 2, 9)
    expect(b?.position[0]).toBeCloseTo(4 + LENGTH / 2, 9)
    for (const port of [a, b]) {
      expect(port?.position[1]).toBeCloseTo(0.75, 9)
      expect(port?.position[2]).toBeCloseTo(-2, 9)
      expect(port?.system).toBe('conveyor')
    }
    // Opposed, so two mated ports face each other.
    expect((a?.direction[0] ?? 0) + (b?.direction[0] ?? 0)).toBeCloseTo(0, 9)
  })

  test('a turned module carries its ports round with it', () => {
    const node = conveyor('a', { position: [0, 0, 0], rotation: [0, Math.PI / 2, 0] })
    const [, b] = conveyorPorts(node)
    expect(b?.position[0]).toBeCloseTo(0, 9)
    expect(b?.position[2]).toBeCloseTo(-LENGTH / 2, 9)
  })
})

describe('a line is read back from the ports, never stored', () => {
  beforeEach(() => {
    resetLineIndex()
    resetPortMagnet()
  })

  /** N modules butted end to end from the origin. */
  const run = (count: number, overrides: Record<string, unknown> = {}) =>
    Array.from({ length: count }, (_, index) =>
      conveyor(`m${index}`, { position: [index * LENGTH, 0, 0], ...overrides }),
    )

  test('modules that meet are one line, and a lone module is a line of one', () => {
    const line = run(4)
    const nodes = scene(...line)
    for (const module of line) {
      expect(lineOf(nodes, module.id).sort()).toEqual(line.map((m) => m.id).sort())
    }

    resetLineIndex()
    const lone = conveyor('lone', { position: [40, 0, 40] })
    expect(lineOf(scene(lone), lone.id)).toEqual([lone.id])
  })

  test('a gap splits it, with nothing to heal', () => {
    // The whole reason the line is derived rather than stored: a module deleted
    // or dragged out of the middle splits the line the instant the store
    // writes, and no field can be left pointing at a run that no longer exists.
    const line = run(4)
    const broken = [
      line[0],
      line[1],
      conveyor('m2', { position: [3 * LENGTH + 2, 0, 0] }),
    ] as Array<{
      id: string
    }>
    const nodes = scene(...(broken as never[]))
    expect(lineOf(nodes, 'conveyor_roller_m0').sort()).toEqual([
      'conveyor_roller_m0',
      'conveyor_roller_m1',
    ])
    expect(lineOf(nodes, 'conveyor_roller_m2')).toEqual(['conveyor_roller_m2'])
  })

  test('the ends of a run are free and the middles are not', () => {
    const line = run(3)
    const nodes = scene(...line)
    const [head, middle, tail] = line as [
      ReturnType<typeof conveyor>,
      ReturnType<typeof conveyor>,
      ReturnType<typeof conveyor>,
    ]
    expect(hasUpstreamNeighbour(nodes, head)).toBe(false)
    expect(hasDownstreamNeighbour(nodes, head)).toBe(true)
    expect(hasUpstreamNeighbour(nodes, middle)).toBe(true)
    expect(hasDownstreamNeighbour(nodes, middle)).toBe(true)
    expect(hasDownstreamNeighbour(nodes, tail)).toBe(false)
  })

  test('abutment is what drops the doubled support at a seam', () => {
    // The catalogue puts one support at every joint, not two. This is the bit
    // the geometry key reads, so a seam carries one leg pair rather than two in
    // the same place, z-fighting.
    const line = run(2)
    const nodes = scene(...line)
    const [head, tail] = line as [ReturnType<typeof conveyor>, ReturnType<typeof conveyor>]
    expect(hasDownstreamNeighbour(nodes, head)).toBe(true)
    expect(hasDownstreamNeighbour(nodes, tail)).toBe(false)
  })

  test('a module never mates with itself', () => {
    const lone = conveyor('lone')
    expect(isPortMated(scene(lone), lone.id, 'a')).toBe(false)
    expect(isPortMated(scene(lone), lone.id, 'b')).toBe(false)
  })
})

describe('the magnet joins head to tail and nothing else', () => {
  beforeEach(() => {
    resetLineIndex()
    resetPortMagnet()
  })

  test('a module dropped near a free discharge clicks onto it exactly', () => {
    const standing = conveyor('standing', { position: [0, 0, 0] })
    const dragged = conveyor('dragged', { position: [40, 0, 40] })
    const nodes = scene(standing, dragged)

    // 12 cm short and 7 cm off line — the sort of miss a hand drag makes.
    const snapped = snapToLineEnd(dragged, [LENGTH - 0.12, 0, 0.07], 0, [dragged.id], nodes)
    expect(snapped).not.toBeNull()
    expect(snapped?.[0]).toBeCloseTo(LENGTH, 9)
    expect(snapped?.[2]).toBeCloseTo(0, 9)

    // And what it produced is a joint the line index agrees with, to its own
    // tolerance. A magnet that lands a module *near* the seam is worse than
    // none: the line would look joined and the geometry would still draw two
    // supports.
    resetLineIndex()
    const landed = conveyor('dragged', { position: snapped as [number, number, number] })
    expect(lineOf(scene(standing, landed), standing.id)).toHaveLength(2)
  })

  test('two discharges are never mated nose to nose', () => {
    // Not a joint: two lines ending at the same place. Snapping them together
    // would draw a line that cannot run.
    const standing = conveyor('standing', { position: [0, 0, 0], flow: 'forward' })
    const dragged = conveyor('dragged', { position: [40, 0, 40], flow: 'reverse' })
    // `standing` discharges at +X and `dragged`, reversed, also discharges at
    // its −X end, so approaching from +X puts discharge against discharge.
    expect(
      snapToLineEnd(dragged, [LENGTH - 0.1, 0, 0], 0, [dragged.id], scene(standing, dragged)),
    ).toBeNull()
  })

  test('a different lane is refused — R1', () => {
    const standing = conveyor('standing', { position: [0, 0, 0], usefulWidth: '600' })
    const dragged = conveyor('dragged', { position: [40, 0, 40], usefulWidth: '400' })
    expect(
      snapToLineEnd(dragged, [LENGTH - 0.1, 0, 0], 0, [dragged.id], scene(standing, dragged)),
    ).toBeNull()
  })

  test('a different transport height is refused — R2, and with no tolerance', () => {
    // A step between two beds is a step a box falls down.
    const standing = conveyor('standing', { position: [0, 0, 0], transportHeight: 0.75 })
    const dragged = conveyor('dragged', { position: [40, 0, 40], transportHeight: 0.57 })
    expect(
      snapToLineEnd(dragged, [LENGTH - 0.1, 0, 0], 0, [dragged.id], scene(standing, dragged)),
    ).toBeNull()
  })

  test('a module at right angles is refused — the ends have to face each other', () => {
    const standing = conveyor('standing', { position: [0, 0, 0] })
    const dragged = conveyor('dragged', { position: [40, 0, 40] })
    expect(
      snapToLineEnd(
        dragged,
        [LENGTH - 0.1, 0, 0],
        Math.PI / 2,
        [dragged.id],
        scene(standing, dragged),
      ),
    ).toBeNull()
  })

  test('an end that already has something on it is not offered', () => {
    // Mating onto a filled port would put two modules in the same place.
    const first = conveyor('first', { position: [0, 0, 0] })
    const second = conveyor('second', { position: [LENGTH, 0, 0] })
    const dragged = conveyor('dragged', { position: [40, 0, 40] })
    const nodes = scene(first, second, dragged)
    // Aiming at the filled seam gets nothing...
    expect(snapToLineEnd(dragged, [LENGTH + 0.05, 0, 0], 0, [dragged.id], nodes)).toBeNull()
    // ...but the free end of the run still takes it.
    resetPortMagnet()
    const end = snapToLineEnd(dragged, [2 * LENGTH - 0.1, 0, 0], 0, [dragged.id], nodes)
    expect(end?.[0]).toBeCloseTo(2 * LENGTH, 9)
  })

  test('it lets go outside half a metre', () => {
    const standing = conveyor('standing', { position: [0, 0, 0] })
    const dragged = conveyor('dragged', { position: [40, 0, 40] })
    expect(
      snapToLineEnd(dragged, [LENGTH - 0.8, 0, 0], 0, [dragged.id], scene(standing, dragged)),
    ).toBeNull()
  })

  test('a whole line dragged together does not fight itself', () => {
    const line = [0, 1, 2].map((index) =>
      conveyor(`m${index}`, { position: [index * LENGTH, 0, 0] }),
    )
    const nodes = scene(...line)
    const movingIds = line.map((module) => module.id)
    const head = line[0] as ReturnType<typeof conveyor>
    expect(snapToLineEnd(head, [LENGTH - 0.05, 0, 0], 0, movingIds, nodes)).toBeNull()
  })
})

describe('a joint built by hand is checked, because the magnet is not the only way to make one', () => {
  beforeEach(() => {
    resetLineIndex()
    resetPortMagnet()
  })

  test('a mismatched lane is reported once the two are joined', () => {
    // The host calls two ends within 50 mm one line whatever they are, so a
    // line built by paste or by MCP can be joined and wrong at the same time.
    const wide = conveyor('wide', { position: [0, 0, 0], usefulWidth: '600' })
    const narrow = conveyor('narrow', { position: [LENGTH, 0, 0], usefulWidth: '400' })
    const problems = jointProblems(wide, scene(wide, narrow))
    expect(problems.some((problem) => problem.includes('400 mm'))).toBe(true)
  })

  test('a step at the joint is reported in millimetres', () => {
    const low = conveyor('low', { position: [0, 0, 0], transportHeight: 0.75 })
    // Within the 50 mm the host calls one joint, and still a step.
    const high = conveyor('high', { position: [LENGTH, 0, 0], transportHeight: 0.78 })
    const problems = jointProblems(low, scene(low, high))
    expect(problems.some((problem) => problem.includes('30 mm step'))).toBe(true)
  })

  test('a clean joint reports nothing', () => {
    const first = conveyor('first', { position: [0, 0, 0] })
    const second = conveyor('second', { position: [LENGTH, 0, 0] })
    expect(jointProblems(first, scene(first, second))).toEqual([])
  })

  test('a lone module reports nothing', () => {
    const lone = conveyor('lone')
    expect(jointProblems(lone, scene(lone))).toEqual([])
  })
})

describe('a port carries what a joint is judged on, and carries it per port', () => {
  const straight = (overrides: Record<string, unknown> = {}) =>
    ConveyorRollerNode.parse({ id: 'conveyor_roller_p', ...overrides })
  const bend = (overrides: Record<string, unknown> = {}) =>
    ConveyorCurveNode.parse({ id: 'conveyor_curve_p', ...overrides })

  test('the role follows the flow on a two-ended shape, because the hardware runs either way', () => {
    // Not declared, and that is the point: `flow` is a per-instance field on a
    // straight and a bend — the same machine installed the other way round — so
    // a table of roles per kind would be wrong for half the instances.
    for (const make of [straight, bend]) {
      const forward = localPorts(make({ flow: 'forward' }))
      const reverse = localPorts(make({ flow: 'reverse' }))
      expect(forward.map((p) => `${p.id}:${p.role}`)).toEqual(['a:in', 'b:out'])
      expect(reverse.map((p) => `${p.id}:${p.role}`)).toEqual(['a:out', 'b:in'])
    }
  })

  test('every port names its own lane and its own frame', () => {
    // Forced by the oblique branch, which is a 400 mm lane leaving a 600 mm main
    // line. A two-ended shape's ports agree with each other — but they agree
    // because they are computed, not because anything assumes they must.
    for (const [module, lane, frame] of [
      [straight({ usefulWidth: '400' }), 400, 0.547],
      [straight({ usefulWidth: '600' }), 600, 0.747],
      [bend({ usefulWidth: '400' }), 400, 0.511],
      [bend({ usefulWidth: '600' }), 600, 0.711],
    ] as const) {
      for (const port of localPorts(module)) {
        expect({ id: port.id, lane: port.laneMm, frame: port.frameWidthM }).toEqual({
          id: port.id,
          lane,
          frame: expect.closeTo(frame, 9),
        })
      }
    }
  })

  test('the host-facing cross-section is the port’s, not the node’s', () => {
    // `NodePort.height` is the collar's vertical face and the host sizes a
    // joining run from it. Read off the node it would report an oblique branch
    // as its main line's frame — 200 mm of opening that is not there.
    const module = straight({ usefulWidth: '600' })
    const locals = new Map(localPorts(module).map((local) => [local.id, local]))
    for (const port of conveyorPorts(module)) {
      const local = locals.get(port.id as 'a' | 'b' | 'c')
      if (!local) throw new Error(`no local port ${port.id}`)
      expect(port.width).toBeCloseTo((local.laneMm / 1000) * 39.3701, 6)
      expect(port.height).toBeCloseTo(local.frameWidthM * 39.3701, 6)
    }
  })

  test('a third port is a shape’s to declare, and neither shipped shape declares one', () => {
    // The widening is real — `ConveyorPortId` admits 'c' — but nothing that
    // exists today grows an end because of it. This is the line that fails the
    // day a junction accidentally reaches the straight's local port list.
    expect(localPorts(straight()).map((p) => p.id)).toEqual(['a', 'b'])
    expect(localPorts(bend()).map((p) => p.id)).toEqual(['a', 'b'])
  })
})

describe("jointProblems — kimlik memo'su bayat cevap vermiyor", () => {
  beforeEach(() => {
    resetLineIndex()
    resetPortMagnet()
  })

  test('aynı girdi üçlüsü ikinci kez taranmıyor', () => {
    // Memo'nun dışarıdan gözlemlenebilir tek kanıtı dönüş kimliği: yedi
    // panel bu fonksiyonu her store yazımında çağırıyor ve tarama eşleşmiş
    // port başına tüm sözlüğü geziyor.
    const wide = conveyor('wide', { position: [0, 0, 0], usefulWidth: '600' })
    const narrow = conveyor('narrow', { position: [LENGTH, 0, 0], usefulWidth: '400' })
    const nodes = scene(wide, narrow)

    expect(jointProblems(wide, nodes)).toBe(jointProblems(wide, nodes))
  })

  test('sözlük değişince cevap YENİDEN hesaplanıyor', () => {
    /**
     * Asıl tehlike bu yönde: memo sözlük kimliğini gözetmezse, kullanıcı
     * komşu modülün şeridini değiştirdikten sonra panel eski uyarıyı
     * göstermeye devam eder — ya da hiç göstermez. Hiçbir yerde hata
     * çıkmaz, yalnız panel yalan söyler.
     */
    const wide = conveyor('wide', { position: [0, 0, 0], usefulWidth: '600' })
    const narrow = conveyor('narrow', { position: [LENGTH, 0, 0], usefulWidth: '400' })
    expect(jointProblems(wide, scene(wide, narrow)).length).toBeGreaterThan(0)

    // Host düğümü yerinde değiştirmiyor, YENİSİYLE değiştiriyor — memo'nun
    // dayandığı değişmez bu.
    const matched = conveyor('narrow', { position: [LENGTH, 0, 0], usefulWidth: '600' })
    expect(jointProblems(wide, scene(wide, matched))).toEqual([])
  })

  test('birim değişince mesaj yeniden üretiliyor', () => {
    // Ölçü birimi yalnız METNİ etkiliyor; üçlünün parçası olmasaydı inç'e
    // geçen kullanıcı milimetreyle yazılmış eski mesajı görürdü.
    const low = conveyor('low', { position: [0, 0, 0], transportHeight: 0.75 })
    const high = conveyor('high', { position: [LENGTH, 0, 0], transportHeight: 0.78 })
    const nodes = scene(low, high)

    const metric = jointProblems(low, nodes, 'metric')
    const imperial = jointProblems(low, nodes, 'imperial')
    expect(imperial).not.toEqual(metric)
  })
})

describe('yerleştirme mıknatısı modülü ÇEVİREREK de oturtuyor', () => {
  beforeEach(() => {
    resetLineIndex()
    resetPortMagnet()
  })

  /**
   * `groupMoveSnap` host kancası yalnız bir KONUM döndürebiliyor, yani sürükleme
   * mıknatısı modül zaten doğru açıya çevrilmişse yardım ediyor. Yerleştirme
   * aracında dönüşün sahibi araç — bu blok, oradaki mıknatısın açıyı komşudan
   * çözdüğünü kilitliyor. Tuttuğu hata sessiz: eski hâlde hayalet hiç kımıldamaz
   * ve kullanıcı özelliğin bozuk olduğunu sanar.
   */
  test('düz modül, açısı 90° yanlışken bile hattın ucuna kareleniyor', () => {
    const standing = conveyor('standing', { position: [0, 0, 0] })
    const nodes = scene(standing)
    const fresh = conveyor('fresh')

    /**
     * Kullanıcı hayaleti çeyrek tur çevrilmiş hâlde getiriyor ve UCUNU hattın
     * ucuna nişanlıyor — imleç modülün ortasında olduğu için gövde yana uzanıyor.
     * Yakınlık ölçüsü portun kendisi: kullanıcının baktığı yer orası.
     */
    const half = LENGTH / 2
    const snap = snapPlacementToLineEnd(fresh, [half - 0.1, 0, -half + 0.05], Math.PI / 2, nodes)
    expect(snap).not.toBeNull()
    if (!snap) return

    expect(Math.abs(wrap(snap.rotationY))).toBeCloseTo(0, 9)
    expect(snap.position[0]).toBeCloseTo(LENGTH, 9)
    expect(snap.position[2]).toBeCloseTo(0, 9)
    expect(snap.target).toEqual({ nodeId: standing.id, port: 'b' })

    // Ve ürettiği şey hattın kendi toleransına göre GERÇEK bir eklem.
    resetLineIndex()
    const landed = conveyor('fresh', { position: snap.position, rotation: [0, snap.rotationY, 0] })
    expect(lineOf(scene(standing, landed), standing.id)).toHaveLength(2)
  })

  test('dirsek de kareleniyor — ucu kendi yayında, ±X’te değil', () => {
    // Dirseğin girişi yerel +Z'ye bakıyor; düz bir hattın ucuna takmak için
    // çeyrek tur dönmesi ŞART. Eski mıknatıs bunu hiç yapamıyordu.
    const standing = conveyor('standing', { position: [0, 0, 0] })
    const nodes = scene(standing)
    const bend = ConveyorCurveNode.parse({ id: 'conveyor-curve_fresh' })

    // Dirseğin girişi yerel (0.40, 0.756)'da; imleci öyle koy ki o giriş
    // hattın çıkışının (+L/2, 0) yanına düşsün.
    const snap = snapPlacementToLineEnd(bend, [LENGTH / 2 - 0.4, 0, -0.756 + 0.06], 0, nodes)
    expect(snap).not.toBeNull()
    if (!snap) return

    resetLineIndex()
    const landed = ConveyorCurveNode.parse({
      id: 'conveyor-curve_fresh',
      position: snap.position,
      rotation: [0, snap.rotationY, 0],
    })
    expect(lineOf(scene(standing, landed), standing.id)).toHaveLength(2)
  })

  test('kural tutmuyorsa hayalet KIMILDAMIYOR — kullanıcının açısı korunur', () => {
    /**
     * Şerit sınıfı tutmayan bir uca çevirerek oturtmak, kurulamayacak bir hattı
     * kurmak olurdu. Mıknatısın çekemediği eklemi yerleştirme de kuramaz —
     * kural tek kaynaktan (`blockingRule`) okunuyor.
     */
    const standing = conveyor('standing', { position: [0, 0, 0] })
    const nodes = scene(standing)
    const narrow = ConveyorTransferNode.parse({ id: 'conveyor-transfer_fresh' })
    expect(snapPlacementToLineEnd(narrow, [LENGTH / 2 + 0.1, 0, 0], 0, nodes)).toBeNull()
  })

  test('menzil dışında hiç ateşlemiyor', () => {
    const standing = conveyor('standing', { position: [0, 0, 0] })
    const nodes = scene(standing)
    const fresh = conveyor('fresh')
    /**
     * 90 cm — hücre ızgarasının İÇİNDE ama yarım metrelik menzilin dışında.
     * Uzağa (metrelerce) koymak menzili değil, dokuz hücrelik pencereyi
     * sınardı: mesafe eşiği kaldırılsa bile o test yeşil kalır ve bekçi
     * hiçbir şey tutmaz.
     */
    expect(
      snapPlacementToLineEnd(fresh, [LENGTH / 2 + LENGTH / 2 + 0.9, 0, 0], 0, nodes),
    ).toBeNull()
    // Ve besbelli uzakta da, doğal olarak.
    expect(snapPlacementToLineEnd(fresh, [LENGTH + 6, 0, 0], 0, nodes)).toBeNull()
  })

  test('dolu bir uca yapışmıyor — iki modül aynı yere binmez', () => {
    const a = conveyor('a', { position: [0, 0, 0] })
    const b = conveyor('b', { position: [LENGTH, 0, 0] })
    const nodes = scene(a, b)
    const fresh = conveyor('fresh')
    // a'nın çıkışı b ile dolu; kalan boş uçlar a'nın girişi (−X) ve b'nin
    // çıkışı (+X). Dolu eklemin tam üstüne nişan alan hayalet oraya oturmamalı.
    const snap = snapPlacementToLineEnd(fresh, [LENGTH, 0, 0], 0, nodes)
    expect(snap).toBeNull()
  })

  test('açı zaten doğruysa hayalet dönmüyor', () => {
    /**
     * Kullanıcının kendi açısına saygı: hizada yaklaşan bir modül yalnız
     * ötelenmeli. Dönüşü her seferinde yeniden yazan bir mıknatıs, 180°
     * simetrik bir modülü kullanıcı ne yaparsa yapsın öbür yöne çevirebilir.
     */
    const standing = conveyor('standing', { position: [0, 0, 0] })
    const nodes = scene(standing)
    const fresh = conveyor('fresh')

    // Girişi (yerel −L/2) hattın çıkışının (+L/2) 10 cm berisinde.
    const snap = snapPlacementToLineEnd(fresh, [LENGTH - 0.1, 0, 0.04], 0, nodes)
    expect(snap).not.toBeNull()
    expect(wrap(snap?.rotationY ?? 99)).toBeCloseTo(0, 9)
    expect(snap?.position[0]).toBeCloseTo(LENGTH, 9)
    expect(snap?.position[2]).toBeCloseTo(0, 9)
  })
})

describe('yerleştirme araçlarının hepsi mıknatısı okuyor', () => {
  /**
   * Kaynak düzeyinde bekçi, çünkü kusur çalışma zamanında sessiz: bir araç
   * `placementPose`'u çağırmayı unutursa o kind hâlâ yerleşir, hâlâ hizalama
   * kılavuzu alır, yalnız hattın ucuna oturmaz. Yedi araç var ve yenisi
   * eklenirken atlanacak tek satır tam olarak bu.
   */
  const TOOLS = [
    'tool.tsx',
    'curve-tool.tsx',
    'booster-tool.tsx',
    'launcher-tool.tsx',
    'transfer-tool.tsx',
    'oblique-tool.tsx',
    'telescopic-tool.tsx',
  ]

  for (const file of TOOLS) {
    test(`${file} mıknatısı çağırıyor ve çizilen açıyı ayrı tutuyor`, () => {
      const source = readFileSync(join(import.meta.dir, file), 'utf8')
      expect(source, `${file}: placementPose çağrısı yok`).toContain('placementPose(')
      // Kullanıcının açısı ile çizilen açı ayrı ref'lerde: birleştirilirse
      // mıknatıs bir kez ateşledikten sonra kullanıcının R/T açısı kaybolur.
      expect(source, `${file}: poseRotationRef yok`).toContain('poseRotationRef')
      // Ve düğüm ÇİZİLEN açıyla kuruluyor — kullanıcının ham açısıyla değil.
      expect(source, `${file}: düğüm ham açıyla kuruluyor`).not.toContain(
        'rotation: [0, rotationRef.current, 0]',
      )
    })
  }

  test('araç listesi gerçekten eksiksiz — dosya sistemi sayıyor', () => {
    // Bekçinin kendini kandırma biçimi: yeni bir araç eklenip listeye
    // yazılmaması. Klasördeki `*-tool.tsx` sayısı listeyle uyuşmalı.
    const found = readdirSync(import.meta.dir).filter(
      (name) => name === 'tool.tsx' || name.endsWith('-tool.tsx'),
    )
    expect(found.sort()).toEqual([...TOOLS].sort())
  })
})
