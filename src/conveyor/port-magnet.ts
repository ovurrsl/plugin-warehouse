import { DEFAULT_UNIT, type LinearUnit, lengthLabel, millimetreLabel } from '../units'
import { isPortMated } from './line-index'
import type { ConveyorModule, ConveyorPortId, PortRole } from './ports'
import {
  asConveyorModule,
  conveyorPorts,
  localPorts,
  toWorldPlan,
  transportHeightAt,
} from './ports'

/**
 * Dragging a module onto the end of a line.
 *
 * The host's alignment guides pull footprint edge to footprint edge, which is
 * the right distance and only inside an 8 cm window; grid snap fights it,
 * because a 6 m bed is not a multiple of any grid step; and Duplicate offsets a
 * copy by a hardcoded metre on world X and Z, ignoring both the bed length and
 * the module's own rotation. So a duplicated module lands askew and there is
 * nothing to pull it home.
 *
 * This is `capabilities.movable.groupMoveSnap` — the host's kind-owned
 * attachment hook, the same one a cabinet uses to settle flush against a wall.
 * It runs in every snapping mode but Off, takes precedence over grid snap, and
 * the host clears the alignment guides when it fires.
 *
 * **Head to tail, never nose to nose.** A discharge mates an infeed; two
 * discharges facing each other is not a joint, it is two lines ending at the
 * same place, and snapping them together would draw a line that cannot run.
 * That rule lives here — in the thing that *creates* joints — rather than in
 * the line index, which only reads them back: a membership test that filtered
 * on direction would make the panel's "this line" a strict subset of what the
 * host actually drags.
 */

/**
 * How close before it clicks on.
 *
 * Half a metre, matching the rack's: it engages when the user is clearly aiming
 * at the end of a line and never when they are laying a second line alongside.
 * Wider than the 8 cm alignment window on purpose, because what it produces is
 * exact rather than approximate.
 */
const MAGNET_RADIUS = 0.5
const MAGNET_RADIUS_SQ = MAGNET_RADIUS * MAGNET_RADIUS

/** Bucket size for the free-end index. Wider than the radius, so a lookup reads
 *  nine cells rather than every module in the building. */
const CELL = 1

type FreeEnd = {
  nodeId: string
  port: ConveyorPortId
  /** What this end does, which is what decides whether another may join it. */
  role: PortRole
  x: number
  z: number
  /** Outward direction in plan, for the head-to-tail test. */
  dx: number
  dz: number
  /** What has to match: the lane a box travels through, and the height it
   *  travels at. Both are the catalogue's own joint rules — R1 and R2, and both
   *  are properties of the **port** rather than of the node: an oblique branch
   *  is a narrower lane than the main line it leaves. */
  lane: number
  height: number
}

/**
 * Whether two ends may join.
 *
 * Head to tail: one has to deliver into the other. `'both'` accepts either
 * side, which is not a loophole — an oblique branch is ordered as a divert or a
 * merge and installed either way round, so refusing it would call half the
 * catalogue's own configurations errors.
 */
function rolesComplement(a: PortRole, b: PortRole): boolean {
  if (a === 'both' || b === 'both') return true
  return a !== b
}

let indexedFrom: unknown = null
let index = new Map<string, FreeEnd[]>()

const cellKey = (x: number, z: number) => `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`

/**
 * Every end a module could be joined to, built once per store write.
 *
 * Ends that already have something on them are left out: mating onto a filled
 * port would put two modules in the same place, which is worse than not
 * snapping at all.
 */
function build(nodes: Readonly<Record<string, unknown>>): Map<string, FreeEnd[]> {
  const cells = new Map<string, FreeEnd[]>()

  for (const value of Object.values(nodes)) {
    const module = asConveyorModule(value)
    if (!module) continue
    const locals = new Map(localPorts(module).map((local) => [local.id, local]))

    for (const port of conveyorPorts(module)) {
      const id = port.id as ConveyorPortId
      if (isPortMated(nodes, module.id, id)) continue
      const local = locals.get(id)
      if (!local) continue

      const end: FreeEnd = {
        nodeId: module.id,
        port: id,
        role: local.role,
        x: port.position[0],
        z: port.position[2],
        dx: port.direction[0],
        dz: port.direction[2],
        lane: local.laneMm,
        height: transportHeightAt(module, id),
      }
      const key = cellKey(end.x, end.z)
      const bucket = cells.get(key)
      if (bucket) bucket.push(end)
      else cells.set(key, [end])
    }
  }
  return cells
}

function freeEnds(nodes: Readonly<Record<string, unknown>>): Map<string, FreeEnd[]> {
  if (nodes !== indexedFrom) {
    index = build(nodes)
    indexedFrom = nodes
  }
  return index
}

/** Drops the memo. Only needed so tests do not leak an index between cases. */
export function resetPortMagnet(): void {
  indexedFrom = null
  index = new Map()
}

/**
 * Where this module should click into, or null to leave the drag alone.
 *
 * Returns the module's own position, not the port's: the caller is moving a
 * node, and what it needs is where the node goes so that its end lands on the
 * other's.
 */
/** Bu modülün uçları, verilen aday dönüşümde. */
type PlacedEnd = {
  id: ConveyorPortId
  role: PortRole
  lane: number
  x: number
  z: number
  dx: number
  dz: number
}

function endsAt(
  module: ConveyorModule,
  position: readonly [number, number, number],
  rotationY: number,
): PlacedEnd[] {
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  // Built from the same local list `def.ports` uses, so a bend's ends are on
  // its arc and a junction's third end is where it actually is — rather than on
  // an assumed ±X, the assumption a straight-only magnet was making.
  return localPorts(module).map((local) => {
    const [x, z] = toWorldPlan([local.x, local.z], position, cos, sin)
    const [dx, dz] = toWorldPlan([local.dx, local.dz], [0, 0, 0], cos, sin)
    return { id: local.id, role: local.role, lane: local.laneMm, x, z, dx, dz }
  })
}

/** Hangi kural iki ucun birleşmesini engelliyor — ya da `null`, engel yok. */
export type MateRule = 'role' | 'lane' | 'height' | 'facing'

/**
 * Birleşme kurallarının TEK kaynağı.
 *
 * Hem mıknatıs hem panelin "neden yapışmadı" teşhisi buradan okuyor. İki ayrı
 * yerde yazılsalardı biri değiştiğinde öteki sessizce yalan söylerdi: kullanıcı
 * "kot tutmuyor" uyarısını görüp kotu düzeltir, mıknatıs yine yapışmazdı.
 */
function blockingRule(module: ConveyorModule, end: PlacedEnd, other: FreeEnd): MateRule | null {
  // Head to tail: one end has to deliver into the other.
  if (!rolesComplement(end.role, other.role)) return 'role'
  // R1 — the lane a box travels through has to be the same lane. Read off both
  // ports, because a junction's ends are not all one class.
  if (other.lane !== end.lane) return 'lane'
  // R2 — and it has to be at the same height, with no tolerance. A step between
  // two beds is a step a box falls down.
  if (Math.abs(other.height - transportHeightAt(module, end.id)) > 1e-6) return 'height'
  // Facing each other, not side by side: the two outward directions must be
  // opposed. `-0.99` rather than `-1` leaves room for the float drift in a
  // rotation the user reached through eight 45° steps.
  if (end.dx * other.dx + end.dz * other.dz > -0.99) return 'facing'
  return null
}

export function snapToLineEnd(
  module: ConveyorModule,
  candidate: readonly [number, number, number],
  rotationY: number,
  movingIds: readonly string[],
  nodes: Readonly<Record<string, unknown>>,
): [number, number, number] | null {
  const moving = new Set<string>(movingIds)
  moving.add(module.id)

  const cells = freeEnds(nodes)
  const [cx, cy, cz] = candidate
  const mine = endsAt(module, candidate, rotationY)

  let bestDistance = MAGNET_RADIUS_SQ
  let best: { position: [number, number, number] } | null = null

  for (const end of mine) {
    const bx = Math.floor(end.x / CELL)
    const bz = Math.floor(end.z / CELL)
    for (let ix = bx - 1; ix <= bx + 1; ix++) {
      for (let iz = bz - 1; iz <= bz + 1; iz++) {
        for (const other of cells.get(`${ix}:${iz}`) ?? []) {
          if (moving.has(other.nodeId)) continue
          if (blockingRule(module, end, other) !== null) continue

          const distance = (other.x - end.x) ** 2 + (other.z - end.z) ** 2
          if (distance >= bestDistance) continue
          bestDistance = distance
          // Move the node by whatever moves this end onto that one.
          best = { position: [cx + (other.x - end.x), cy, cz + (other.z - end.z)] }
        }
      }
    }
  }

  return best?.position ?? null
}

/**
 * Whether two modules that are joined actually agree.
 *
 * The magnet only ever produces a correct joint, but a line can also be built
 * by hand, by paste, or by MCP — and the host's own 50 mm coincidence tolerance
 * will happily call two mismatched ends one line. So the panel checks what the
 * magnet would have enforced, rather than assuming it did.
 *
 * **The frame widths are deliberately not compared.** A straight is 147 mm over
 * its lane and a bend 111 — two families with differently formed side members —
 * so every straight-to-bend joint in a real layout differs by 36 mm, and the
 * catalogue joins them anyway. Within one family the frame follows from the
 * lane, so the check would have been vacuous where it was right and wrong
 * everywhere else. What has to agree is the lane and the height.
 */
/**
 * Yakındaki bir uca NEDEN yapışmadığını söyler — ve hiçbir şeyi düzeltmez.
 *
 * `jointProblems` yalnız zaten ÇAKIŞMIŞ (5 cm) eklemleri denetliyor. Ama
 * mıknatıs bir kuralı çiğneyen ucu hiç çekmiyor, dolayısıyla kullanıcı
 * modülü yaklaştırıp bırakıyor ve hiçbir şey olmuyor — sessizlik. Sessizlik,
 * "bu ikisi birleşmez"in en kötü anlatımı: kullanıcı ya yanlış bir şey
 * yaptığını sanır ya da özelliğin bozuk olduğunu.
 *
 * Özellikle teleskopik konveyörde bu neredeyse kesin: varsayılan bant
 * genişliği 800 mm, roller ailesininki 600 mm; kot ise modele gömülü
 * (0,80–1,05 m) ve roller varsayılanı 0,75 m. R1 ve R2 sıfır toleranslı
 * olduğu için VARSAYILANLAR ASLA EŞLEŞMEZ.
 *
 * Kullanıcı kararı gereği burası **yalnız haber verir**: hangi değerin
 * tutmadığını ve karşı tarafın ne olduğunu yazar, düzeltmeyi kullanıcıya
 * bırakır. Otomatik eşitleme, elle ayarlanmış bir değeri habersiz değiştirmek
 * olurdu.
 */
export function mateBlockers(
  module: ConveyorModule,
  position: readonly [number, number, number],
  rotationY: number,
  nodes: Readonly<Record<string, unknown>>,
  /** Yalnız mesajları etkiler; mıknatısın kendisi metre ile çalışır. */
  unit: LinearUnit = DEFAULT_UNIT,
): string[] {
  const cells = freeEnds(nodes)
  const mine = endsAt(module, position, rotationY)
  const seen = new Set<MateRule>()
  const messages: string[] = []

  for (const end of mine) {
    const bx = Math.floor(end.x / CELL)
    const bz = Math.floor(end.z / CELL)
    for (let ix = bx - 1; ix <= bx + 1; ix++) {
      for (let iz = bz - 1; iz <= bz + 1; iz++) {
        for (const other of cells.get(`${ix}:${iz}`) ?? []) {
          if (other.nodeId === module.id) continue
          const distance = (other.x - end.x) ** 2 + (other.z - end.z) ** 2
          if (distance >= MAGNET_RADIUS_SQ) continue
          const rule = blockingRule(module, end, other)
          // Yönü tutmayan bir uç yalnızca "henüz döndürmedin" demek olabilir;
          // kullanıcı zaten döndürerek çözer, uyarı gürültü olurdu.
          if (rule === null || rule === 'facing' || seen.has(rule)) continue
          seen.add(rule)
          const mineHeight = transportHeightAt(module, end.id)
          if (rule === 'lane') {
            messages.push(
              `Yakındaki uç ${other.lane} mm şeritli, bu makine ${end.lane} mm — ` +
                'şerit sınıfları eşit olmadan birleşmezler.',
            )
          } else if (rule === 'height') {
            messages.push(
              `Yakındaki ucun bant kotu ${lengthLabel(other.height, unit, 3)}, bu makinenin ` +
                `${lengthLabel(mineHeight, unit, 3)} — aradaki basamak kutunun takılacağı yerdir.`,
            )
          } else {
            messages.push(
              'Yakındaki uç da aynı yöne besliyor: biri diğerine mal vermeli ' +
                '(akış yönünü ters çevirin ya da öbür ucu kullanın).',
            )
          }
        }
      }
    }
  }
  return messages
}

export function jointProblems(
  module: ConveyorModule,
  nodes: Readonly<Record<string, unknown>>,
  /** Yalnız mesajları etkiler; teşhisin kendisi metre ile çalışır. */
  unit: LinearUnit = DEFAULT_UNIT,
): string[] {
  const problems: string[] = []
  const mineLocal = new Map(localPorts(module).map((local) => [local.id, local]))

  for (const port of conveyorPorts(module)) {
    const id = port.id as ConveyorPortId
    if (!isPortMated(nodes, module.id, id)) continue
    const local = mineLocal.get(id)
    if (!local) continue

    for (const value of Object.values(nodes)) {
      const other = asConveyorModule(value)
      if (!other || other.id === module.id) continue
      const theirLocal = new Map(localPorts(other).map((entry) => [entry.id, entry]))

      for (const theirs of conveyorPorts(other)) {
        const dx = theirs.position[0] - port.position[0]
        const dy = theirs.position[1] - port.position[1]
        const dz = theirs.position[2] - port.position[2]
        if (dx * dx + dy * dy + dz * dz > 0.05 * 0.05) continue

        const theirId = theirs.id as ConveyorPortId
        const theirPort = theirLocal.get(theirId)
        if (!theirPort) continue

        if (!rolesComplement(local.role, theirPort.role)) {
          problems.push(
            local.role === 'out'
              ? 'Two discharges meet here — nothing feeds either line.'
              : 'Two infeeds meet — no line delivers into this joint.',
          )
        }
        // R1, read off the two **ports**. An oblique branch is a narrower lane
        // than its own main line, so comparing the nodes would report every
        // oblique as a mismatch against itself.
        if (theirPort.laneMm !== local.laneMm) {
          problems.push(
            // Şerit ölçüsü bir SINIF adı (400/600/800) ve öyle kalıyor —
            // yukarıdaki `mateBlockers` mesajı da sınıfları karşılaştırıyor.
            // Geçiş sınırı ise bu ekin bu birleşme için HESAPLADIĞI bir
            // açıklık ve kullanıcının kendi kolileri hakkında bir iddia:
            // inç'le çalışan biri kolisini inç'le ölçüyor.
            `Joined to a ${theirPort.laneMm} mm lane; a box wider than ${millimetreLabel(Math.min(theirPort.laneMm, local.laneMm) / 1000, unit)} cannot cross.`,
          )
        }
        const step = Math.abs(transportHeightAt(other, theirId) - transportHeightAt(module, id))
        if (step > 1e-6) {
          problems.push(
            `A ${millimetreLabel(step, unit)} step at the joint — boxes need an inclined belt or a lift, not a butt joint.`,
          )
        }
      }
    }
  }
  return [...new Set(problems)]
}
