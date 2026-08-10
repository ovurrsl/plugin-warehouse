import { specOf } from '../pallet/presets'
import type { PalletRackNode } from './schema'

/**
 * Pure slot geometry for a pallet racking run.
 *
 * Everything the renderer draws, the capacity panel counts, and the floorplan
 * outlines is derived here, from the node alone. No Three.js, no scene reads,
 * no host imports — which is what makes it testable, and what stops the
 * reported capacity and the drawn pallets from ever disagreeing. The version
 * this replaces computed positions inline in the renderer with a hardcoded two
 * pallets per bay, so the figure a panel would have reported and the figure you
 * could count on screen were unrelated numbers.
 */

export type SlotAddress = {
  /** Always 1. A bay is a node, so a node has one row — kept in the address for
   *  the reason `formatSlotAddress` gives. */
  row: number
  /** Always 1, for the same reason. */
  bay: number
  /** 0 is the floor inside the bay; 1..n are the beam levels. */
  level: number
  /** 1-based across the bay, left to right in the rack's local +X. */
  position: number
  /** 1-based into the bay from the aisle. 1 is the front, 2 the rear of a
   *  double-deep bay. */
  depth: number
}

export type Slot = SlotAddress & {
  id: string
  /** Centre of the pallet footprint in the rack's local frame, metres. */
  localPosition: [number, number, number]
  /** Footprint the slot accepts, `[x, z]` metres, already oriented. */
  footprint: [number, number]
  /** Clear height above the slot surface before the next beam. */
  clearHeight: number
  /**
   * Whether a truck can reach this pallet without first moving another.
   *
   * False only for the rear position of a double-deep bay. Worth carrying on
   * the slot rather than recomputing: "how many locations, and how many of them
   * directly accessible" is the pair of numbers that actually describes a
   * high-density layout, and reporting only the total flatters it.
   */
  directAccess: boolean
}

/**
 * `R1-B2-L3-P1-D1`.
 *
 * Row and bay are now always 1 — a bay is a node — and the form is kept anyway.
 * Shortening it to `L3-P1-D1` would break silently rather than loudly: every
 * pallet already standing in a rack carries a `slotAddress` in the long form,
 * `occupiedSlots` would stop matching them, and `GhostStock` would start drawing
 * phantom pallets straight through the real ones. The saving is five characters.
 *
 * A single-deep bay is depth 1 for the same reason: raising `depthPositions`
 * must not change what an already-stored address means.
 */
export function formatSlotAddress({ row, bay, level, position, depth }: SlotAddress): string {
  return `R${row}-B${bay}-L${level}-P${position}-D${depth}`
}

const ADDRESS_PATTERN = /^R(\d+)-B(\d+)-L(\d+)-P(\d+)-D(\d+)$/

export function parseSlotAddress(address: string): SlotAddress | null {
  const match = ADDRESS_PATTERN.exec(address)
  if (!match) return null
  const [, row, bay, level, position, depth] = match
  if (!row || !bay || !level || !position || !depth) return null
  return {
    row: Number(row),
    bay: Number(bay),
    level: Number(level),
    position: Number(position),
    depth: Number(depth),
  }
}

// ── Bay geometry ────────────────────────────────────────────────────────────

/**
 * Centre-to-centre distance between the bay's two upright frames — and, because
 * bays share their frames, the spacing at which two bays abut.
 *
 * One number doing both jobs is the point: a sibling laid down at exactly this
 * pitch lands its left frame where its neighbour's right frame would have been,
 * which is what lets the neighbour omit that frame and the two show one post.
 */
export function bayPitch(rack: PalletRackNode): number {
  return rack.bayClearWidth + rack.uprightWidth
}

/**
 * Outer width over the two upright faces — the bay with both its frames.
 *
 * Wider than `bayPitch` by one upright, which is the half-post each side that a
 * neighbour would have shared. The collision footprint is the *pitch*, not
 * this, so abutting bays touch exactly instead of overlapping by a post; the
 * geometry simply overhangs its footprint by half an upright each side, the way
 * the footplates already do.
 */
export function totalWidth(rack: PalletRackNode): number {
  return bayPitch(rack) + rack.uprightWidth
}

/** Depth of the bay, including its rear position when double-deep. */
export function rowDepth(rack: PalletRackNode): number {
  return rack.depthPositions * rack.depth + (rack.depthPositions - 1) * rack.depthGap
}

/** Outer depth. Kept as its own name because the floorplan, the collider and
 *  the footprint all read "how deep is this thing" rather than "how deep is a
 *  row", and a bay is one row. */
export function totalDepth(rack: PalletRackNode): number {
  return rowDepth(rack)
}

/** Local X of the two upright frame centrelines, left then right. */
export function frameCentersX(rack: PalletRackNode): [number, number] {
  const half = bayPitch(rack) / 2
  return [-half, half]
}

/** Local X of the bay's centre. Always zero — kept as a name so the geometry
 *  reads as "at the bay centre" rather than as a bare literal. */
export function bayCenterX(): number {
  return 0
}

/**
 * Local Z of a depth position's centre.
 *
 * Depth 1 is the aisle side. Two bays standing back to back are two nodes
 * rotated half a turn from each other, so a bay only ever numbers its positions
 * from its own front — which is why this no longer needs to know about rows.
 */
export function depthPositionZ(rack: PalletRackNode, depth: number): number {
  const fromAisle = (depth - 0.5) * rack.depth + (depth - 1) * rack.depthGap
  return rowDepth(rack) / 2 - fromAisle
}

/**
 * Storage levels the bay actually builds.
 *
 * A tunnel opens the lowest N levels as a walkway: the frames stay because they
 * carry what is above, and everything that would have sat below is omitted.
 */
export function storageLevelsPresent(rack: PalletRackNode): number[] {
  return storageLevels(rack).filter((level) => level >= rack.tunnelLevels)
}

// ── Levels ──────────────────────────────────────────────────────────────────

export type LevelType = 'pallet' | 'picking'

/**
 * What a level holds. Level 0 is the floor inside the bay.
 *
 * The explicit `levelTypes` list wins when present; otherwise the lowest
 * `pickingLevels` levels are picked by hand and everything above them holds
 * pallets, which is how a mixed rack is actually arranged.
 */
export function levelTypeOf(rack: PalletRackNode, level: number): LevelType {
  const explicit = rack.levelTypes?.[level]
  if (explicit) return explicit
  return level < rack.pickingLevels ? 'picking' : 'pallet'
}

/**
 * Bir katın tipini değiştirdikten sonraki `levelTypes` — ve türetilmiş desene
 * dönüldüyse `null`.
 *
 * ## Neden `null`a dönmek şart
 *
 * Şemanın kendi uyarısı: açık bir `levelTypes` listesi rafın geometrisini
 * BENZERSİZ yapıyor, yani "elli rafın paylaştığı tek mesh elli mesh olur".
 * Paneldeki eski yazım diziyi her dokunuşta baştan sona dolduruyordu, dolayısıyla
 * tek bir tıklama geri dönüşsüzdü: `pickingLevels` bir daha hiçbir şeyi
 * sürmüyor, raf bir daha hiçbir komşusuyla mesh paylaşmıyordu.
 *
 * Burada dizinin türetilmiş desenle birebir aynı olup olmadığı sınanıyor;
 * aynıysa alan yok sayılıyor. Yani her satırı kendi türetilmiş tipine geri
 * getirmek, rafı hiç dokunulmamış hâline — ve paylaşımlı mesh'e — döndürüyor.
 *
 * Saf fonksiyon: paneldeki kopyası test edilemezdi, ve test edilemeyen yerde
 * duran bir kural, ihlal edildiğinde kimseye haber vermez.
 */
export function nextLevelTypes(
  rack: PalletRackNode,
  level: number,
  type: LevelType,
): LevelType[] | null {
  // Zemin açıklığı da bir satır, o yüzden `levels + 1`.
  const rows = rack.levels + 1
  const next = Array.from({ length: rows }, (_, index) =>
    index === level ? type : (rack.levelTypes?.[index] ?? levelTypeOf(rack, index)),
  )
  const derived = (index: number): LevelType => (index < rack.pickingLevels ? 'picking' : 'pallet')
  return next.every((value, index) => value === derived(index)) ? null : next
}

/** Beam profile carrying a level. Picking levels ride a shallower section. */
export function levelBeamHeight(rack: PalletRackNode, level: number): number {
  return levelTypeOf(rack, level) === 'picking' ? rack.pickingBeamHeight : rack.beamHeight
}

/**
 * Clear opening above a level's surface, before the next beam.
 *
 * Level 0 takes `firstLevelClear` when it holds pallets, because the ground
 * opening is usually set by the truck rather than by the goods. A ground
 * picking level takes the picking opening instead — otherwise setting
 * `pickingLevels` would leave the bottom level sized for a pallet it will never
 * hold, and quietly cost a level's worth of height up the whole frame.
 */
export function levelClearOpening(rack: PalletRackNode, level: number): number {
  // Kat başına açık geçersiz kılma her varsayılanı yener — kullanıcı o katı
  // adıyla ayarladı; tip kuralları kalanlar içindir.
  const override = rack.levelClears?.[level]
  if (override != null) return override
  const type = levelTypeOf(rack, level)
  if (type === 'picking') return rack.pickingLevelClear
  return level <= 0 ? rack.firstLevelClear : rack.levelClear
}

/**
 * Surface height goods rest on. Level 0 is the floor; levels above it return
 * the top of that level's beam pair.
 *
 * Accumulated rather than multiplied. A uniform pitch is only correct while
 * every level is the same kind — as soon as a rack mixes picking and pallet
 * levels the openings and the beam sections both differ per level, and a
 * `first + (n-1) × step` formula puts every level above the mix at the wrong
 * height.
 */
export function levelSurfaceY(rack: PalletRackNode, level: number): number {
  if (level <= 0) return 0
  let y = 0
  for (let index = 1; index <= level; index++) {
    y += levelClearOpening(rack, index - 1) + levelBeamHeight(rack, index)
  }
  return y
}

/** Underside of a beam level, which is where its clear opening starts. */
export function beamUndersideY(rack: PalletRackNode, level: number): number {
  return levelSurfaceY(rack, level) - levelBeamHeight(rack, level)
}

/**
 * Beam levels that actually fit inside `uprightHeight`.
 *
 * The schema lets `levels` be set independently of the height, so this is the
 * value the geometry and the capacity count both use. Asking for ten levels on
 * a 5 m upright silently yields the number that fit rather than beams poking
 * out of the top of the frame.
 */
export function fittedLevelCount(rack: PalletRackNode): number {
  let fitted = 0
  for (let level = 1; level <= rack.levels; level++) {
    if (levelSurfaceY(rack, level) > rack.uprightHeight) break
    fitted++
  }
  return fitted
}

/** Storage levels present, floor first when it is enabled. */
export function storageLevels(rack: PalletRackNode): number[] {
  const beams = Array.from({ length: fittedLevelCount(rack) }, (_, index) => index + 1)
  return rack.groundLevelStorage ? [0, ...beams] : beams
}

/**
 * Usable height above a storage level before the next obstruction.
 *
 * The topmost level is bounded by the upright rather than by a beam, which is
 * the case that decides whether a tall unit load fits on the top position.
 */
export function levelClearHeight(rack: PalletRackNode, level: number): number {
  const fitted = fittedLevelCount(rack)
  const surface = levelSurfaceY(rack, level)
  if (level >= fitted) return Math.max(0, rack.uprightHeight - surface)
  return Math.max(0, beamUndersideY(rack, level + 1) - surface)
}

/**
 * Levels of each kind that are actually present.
 *
 * Split rather than combined because the two are counted in different units —
 * a picking level holds containers, not pallets — and a single "levels" figure
 * would invite adding them together.
 */
export function palletLevels(rack: PalletRackNode): number[] {
  return storageLevels(rack).filter((level) => levelTypeOf(rack, level) === 'pallet')
}

export function pickingLevelsOf(rack: PalletRackNode): number[] {
  return storageLevels(rack).filter((level) => levelTypeOf(rack, level) === 'picking')
}

/**
 * Levels that carry a beam pair.
 *
 * The floor is a storage level but normally carries no beam, so this is not the
 * same list as `storageLevels`. Shared by the geometry builder and its cache key
 * so the two can never disagree about which levels exist — a key derived from
 * the wider list reports a difference the mesh does not have, and splits the
 * cache between racks whose geometry is byte-identical.
 */
export function beamedLevels(rack: PalletRackNode): number[] {
  return storageLevels(rack).filter((level) => level > 0 || rack.hasGroundBeam)
}

/**
 * The levels the builder actually draws: beamed, and not opened up by a tunnel.
 *
 * The one list the mesh, the cache key and the inspector's `visibleIf`
 * predicates must all read. Each of them had its own near-miss version, and each
 * near-miss was a bug: the key gated the picking profiles on one list while the
 * panel gated their controls on another, so `pickingLevels: 1` on a rack with no
 * ground beam showed two profile fields that moved nothing — the level they
 * describe is the floor, and the floor carries no beam.
 */
export function drawnLevels(rack: PalletRackNode): number[] {
  const present = new Set(storageLevelsPresent(rack))
  return beamedLevels(rack).filter((level) => present.has(level))
}

/** Drawn levels that are picked by hand. The predicate behind every picking
 *  control and the picking half of the cache key. */
export function drawnPickingLevels(rack: PalletRackNode): number[] {
  return drawnLevels(rack).filter((level) => levelTypeOf(rack, level) === 'picking')
}

/** A picking level always carries a shelf — containers cannot sit on beams. */
export function levelHasShelf(rack: PalletRackNode, level: number): boolean {
  if (level <= 0) return false
  return levelTypeOf(rack, level) === 'picking' || rack.decking !== 'open'
}

/**
 * What the panel over a level actually is.
 *
 * A picking level's shelf is a shelf — a solid panel sized to hold containers —
 * and it is *not* the pallet deck the `decking` field describes. Keeping the two
 * apart is what stops a picking shelf from turning brown when the pallet levels
 * above it are given chipboard decks.
 *
 * Shared by the builder and the geometry cache key, so the key can never
 * disagree with the mesh about which finishes a rack actually emits.
 */
export type DeckFinish = PalletRackNode['decking'] | 'picking'

export function deckFinishOf(rack: PalletRackNode, level: number): DeckFinish | null {
  if (!levelHasShelf(rack, level)) return null
  return levelTypeOf(rack, level) === 'picking' ? 'picking' : rack.decking
}

// ── Pallet fit ──────────────────────────────────────────────────────────────

/**
 * Pallet footprint as the rack sees it, `[alongRun, intoDepth]`.
 *
 * Derived from min/max rather than from the preset's `length` / `width` names,
 * because those are not consistently ordered across standards — EPAL 3 is
 * 1.0 × 1.2, the other way round from EPAL 1. Using the names directly would
 * silently turn one preset's orientation inside out.
 */
export function orientedPalletFootprint(rack: PalletRackNode): [number, number] {
  const spec = specOf(rack.palletPreset)
  const short = Math.min(spec.length, spec.width)
  const long = Math.max(spec.length, spec.width)
  return rack.palletOrientation === 'short-side-out' ? [short, long] : [long, short]
}

/** How many pallets the clear width fits at the declared clearances. */
export function autoPalletsPerLevel(rack: PalletRackNode): number {
  const [alongRun] = orientedPalletFootprint(rack)
  const { bayClearWidth, clearanceToUpright: toUpright, clearanceBetweenPallets: between } = rack
  const usable = bayClearWidth - 2 * toUpright + between
  const step = alongRun + between
  if (step <= 0) return 0
  // The canonical bay divides exactly — 2.625 / 0.875 is 3 — and binary
  // floating point lands that quotient a hair either side of the integer
  // depending on the operand order. Without the epsilon a bay that fits three
  // pallets on paper reports two, and the error is invisible because every
  // figure downstream stays self-consistent.
  return Math.max(0, Math.floor(usable / step + 1e-9))
}

/** Declared count when the override is set, otherwise the geometric fit. */
export function palletsPerLevel(rack: PalletRackNode): number {
  return rack.palletsPerLevel ?? autoPalletsPerLevel(rack)
}

/**
 * Slot centres across a bay, local X relative to the bay centre.
 *
 * Leftover width is distributed back into the clearances in proportion, so a
 * bay never renders its pallets bunched to one side with a visible gap at the
 * end. Straight from the rack spec's clearance-scaling rule.
 */
/**
 * Centres of `count` items of `size` laid across `span`, symmetric about zero.
 *
 * Shared by pallets across a bay and containers across a picking shelf, so both
 * absorb leftover space the same way and neither can bunch to one end. Split
 * out when picking arrived rather than copied — a second copy would be a second
 * place for the clearance-scaling rule to have to be corrected.
 */
export function distributeAcross({
  betweenGap,
  count,
  edgeGap,
  size,
  span,
}: {
  betweenGap: number
  count: number
  edgeGap: number
  size: number
  span: number
}): number[] {
  if (count <= 0) return []
  const minClearance = 2 * edgeGap + (count - 1) * betweenGap
  const leftover = span - count * size
  // A manual override can ask for more items than fit; keep the declared count
  // and let them touch rather than scaling the clearance negative, which would
  // order the offsets backwards and mirror the row about the centre.
  const scale = minClearance > 0 ? Math.max(0, leftover / minClearance) : 0
  const start = -span / 2 + edgeGap * scale + size / 2
  return Array.from({ length: count }, (_, index) => start + index * (size + betweenGap * scale))
}

/** How many items of `size` fit across `span` at the declared clearances. */
export function fitAcross({
  betweenGap,
  edgeGap,
  size,
  span,
}: {
  betweenGap: number
  edgeGap: number
  size: number
  span: number
}): number {
  const step = size + betweenGap
  if (step <= 0) return 0
  // Epsilon because the catalogue cases divide exactly — 2.625 / 0.875 is 3 —
  // and binary floating point lands such quotients either side of the integer
  // depending on operand order. Losing one is invisible, because every figure
  // downstream stays self-consistent.
  return Math.max(0, Math.floor((span - 2 * edgeGap + betweenGap) / step + 1e-9))
}

export function slotOffsetsX(rack: PalletRackNode): number[] {
  const [alongRun] = orientedPalletFootprint(rack)
  return distributeAcross({
    betweenGap: rack.clearanceBetweenPallets,
    count: palletsPerLevel(rack),
    edgeGap: rack.clearanceToUpright,
    size: alongRun,
    span: rack.bayClearWidth,
  })
}

// ── Picking containers ──────────────────────────────────────────────────────

/** Containers across the shelf width at the declared gaps. */
export function autoPickingBoxesAcross(rack: PalletRackNode): number {
  return fitAcross({
    betweenGap: rack.pickingBoxGap,
    edgeGap: rack.pickingBoxGap,
    size: rack.pickingBoxWidth,
    span: rack.bayClearWidth,
  })
}

/** Containers into the shelf depth at the declared gaps. */
export function autoPickingBoxesDeep(rack: PalletRackNode): number {
  return fitAcross({
    betweenGap: rack.pickingBoxGap,
    edgeGap: rack.pickingBoxGap,
    size: rack.pickingBoxDepth,
    span: rack.depth,
  })
}

export function pickingBoxesAcross(rack: PalletRackNode): number {
  return rack.pickingBoxesAcross ?? autoPickingBoxesAcross(rack)
}

export function pickingBoxesDeep(rack: PalletRackNode): number {
  return rack.pickingBoxesDeep ?? autoPickingBoxesDeep(rack)
}

export function pickingOffsetsX(rack: PalletRackNode): number[] {
  return distributeAcross({
    betweenGap: rack.pickingBoxGap,
    count: pickingBoxesAcross(rack),
    edgeGap: rack.pickingBoxGap,
    size: rack.pickingBoxWidth,
    span: rack.bayClearWidth,
  })
}

/** Container centres into the depth, relative to the shelf centre. Index 0 is
 *  the aisle side. */
export function pickingOffsetsZ(rack: PalletRackNode): number[] {
  return distributeAcross({
    betweenGap: rack.pickingBoxGap,
    count: pickingBoxesDeep(rack),
    edgeGap: rack.pickingBoxGap,
    size: rack.pickingBoxDepth,
    span: rack.depth,
  })
}

// ── Slot enumeration ────────────────────────────────────────────────────────

/**
 * Every pallet position in the bay, in a stable order. Picking levels hold
 * containers instead and are enumerated by `pickingSlotsOf`.
 *
 * `row` and `bay` are always 1 now that a node is one bay, but they stay in the
 * address. Shortening the form to `L3-P1-D1` would break silently and
 * invisibly: a pallet saved at `R1-B1-L3-P1-D1` keeps its `slotRackId`, the
 * parser returns null for the new short form, the occupancy index goes on
 * holding the old string, and `GhostStock` draws a ghost straight through the
 * real pallet because it cannot match them.
 */
/**
 * Yuva enumerasyonu, düğüm nesnesine memoize.
 *
 * `palletSlotsOf` yuva başına bir `Slot` nesnesi ve bir adres dizgesi
 * ayırıyor, ve dört ayrı yerden çağrılıyor: sahne istatistikleri, filo
 * istasyon kurulumu, palet aracının FARE HAREKETİ başına koşan hedef
 * araması (`pallet/slot-placement.ts`) ve raf paneli — panel tek renderda
 * üç enumerasyon yapıyor. `stats.ts` maliyeti ölçüp kendi `WeakMap`'ini
 * kurmuştu ("iki bin gözlük bir depoda bir sürükleme tıkı yaklaşık yirmi
 * dört bin dizge ayırıyordu"), ama önbellek oraya özeldi; kalan üç çağıran
 * ham yola düşüyordu.
 *
 * Dayandığı değişmez `geometry-key-memo.ts`'inkiyle aynı: host store düğümü
 * YERİNDE değiştirmiyor, yenisiyle değiştiriyor. Yerinde değiştirilen bir
 * düğüm bayat liste döndürür.
 *
 * Dönen dizi artık PAYLAŞILIYOR. `readonly` dönüş tipi bunu çağıranlara
 * söylüyor: listeyi sıralayan ya da eleyen biri, aynı düğümü okuyan
 * herkesin cevabını değiştirirdi.
 */
const slotCache = new WeakMap<object, readonly Slot[]>()
const pickingSlotCache = new WeakMap<object, readonly Slot[]>()

export function palletSlotsOf(rack: PalletRackNode): readonly Slot[] {
  const hit = slotCache.get(rack)
  if (hit) return hit
  const slots = buildPalletSlots(rack)
  slotCache.set(rack, slots)
  return slots
}

export function pickingSlotsOf(rack: PalletRackNode): readonly Slot[] {
  const hit = pickingSlotCache.get(rack)
  if (hit) return hit
  const slots = buildPickingSlots(rack)
  pickingSlotCache.set(rack, slots)
  return slots
}

function buildPalletSlots(rack: PalletRackNode): Slot[] {
  const offsets = slotOffsetsX(rack)
  const present = new Set(storageLevelsPresent(rack))
  const footprint = orientedPalletFootprint(rack)
  const slots: Slot[] = []

  for (const level of palletLevels(rack)) {
    // A tunnel's open levels hold nothing — counting them would report capacity
    // the bay does not have.
    if (!present.has(level)) continue
    const y = levelSurfaceY(rack, level)
    const clearHeight = levelClearHeight(rack, level)
    for (let depth = 1; depth <= rack.depthPositions; depth++) {
      const z = depthPositionZ(rack, depth)
      offsets.forEach((offset, index) => {
        const address = { row: 1, bay: 1, level, position: index + 1, depth }
        slots.push({
          ...address,
          id: formatSlotAddress(address),
          localPosition: [bayCenterX() + offset, y, z],
          footprint,
          clearHeight,
          directAccess: depth === 1,
        })
      })
    }
  }
  return slots
}

/** Total pallet positions — the denominator of every pallet occupancy figure. */
export function palletSlotCount(rack: PalletRackNode): number {
  // Counted from the enumeration rather than multiplied out. The moment bays
  // can differ — a skip here, a tunnel there — a product of totals stops
  // describing the rack, and it fails silently: the figure stays plausible.
  return palletSlotsOf(rack).length
}

/**
 * Pallet positions a truck can reach without relocating another pallet.
 *
 * Reported alongside the total because a double-deep layout buys capacity by
 * spending accessibility, and a single "locations" figure hides the trade
 * entirely.
 */
export function directAccessSlotCount(rack: PalletRackNode): number {
  return palletSlotCount(rack) / rack.depthPositions
}

/**
 * Every container position on the bay's picking levels.
 *
 * Addresses share the pallet format, and the components keep their meaning: P
 * still counts across the bay, D still counts into the depth. Only the unit
 * changes with the level's type, which is why a single address parser serves
 * both and a stored location never has to say which kind it was.
 */
function buildPickingSlots(rack: PalletRackNode): Slot[] {
  const offsetsX = pickingOffsetsX(rack)
  const offsetsZ = pickingOffsetsZ(rack)
  const present = new Set(storageLevelsPresent(rack))
  const footprint: [number, number] = [rack.pickingBoxWidth, rack.pickingBoxDepth]
  const slots: Slot[] = []

  for (const level of pickingLevelsOf(rack)) {
    if (!present.has(level)) continue
    // Containers stand on the shelf panel, not on the beam top.
    const y = levelSurfaceY(rack, level) + (level > 0 ? rack.pickingShelfThickness : 0)
    const clearHeight = levelClearHeight(rack, level)
    for (let depth = 1; depth <= offsetsZ.length; depth++) {
      // Index 1 is the aisle side — the same convention pallet depth positions
      // use, so "D1 is the one you reach first" holds throughout.
      const offsetZ = offsetsZ[offsetsZ.length - depth] ?? 0
      offsetsX.forEach((offset, index) => {
        const address = { row: 1, bay: 1, level, position: index + 1, depth }
        slots.push({
          ...address,
          id: formatSlotAddress(address),
          localPosition: [bayCenterX() + offset, y, offsetZ],
          footprint,
          clearHeight,
          directAccess: depth === 1,
        })
      })
    }
  }
  return slots
}

/** Total container positions across every picking level. */
export function pickingSlotCount(rack: PalletRackNode): number {
  return pickingSlotsOf(rack).length
}

// ── Pallet support bars ─────────────────────────────────────────────────────

/**
 * Whether the pallets need bars under them to sit safely on the beams.
 *
 * A Euro pallet's three bottom deckboards run along its 1200 mm length. Stored
 * narrow-side-out those boards cross the beams and carry the load. Turned
 * long-side-out they lie *along* the beams, so the pallet is supported only at
 * its two outer boards with nothing under the middle — which is why the
 * catalogue makes support bars a requirement for that orientation rather than
 * an accessory.
 */
export function requiresPalletSupportBars(rack: PalletRackNode): boolean {
  return rack.palletOrientation === 'long-side-out'
}

/** Bars per pallet when the schema leaves it to be derived. */
export function autoPalletSupportBars(rack: PalletRackNode): number {
  return requiresPalletSupportBars(rack) ? 2 : 0
}

/** Declared bar count when set, otherwise the derived one. */
export function palletSupportBarCount(rack: PalletRackNode): number {
  return rack.palletSupportBars ?? autoPalletSupportBars(rack)
}

/**
 * Levels that actually carry support bars: a beamed level the bay still has,
 * with no panel over it.
 *
 * A decked level never gets bars — the two mount in the same six millimetres and
 * the deck already carries the pallet whichever way round it sits. But "decked"
 * is per level, not per rack: a **ground beam** carries no shelf at any decking
 * setting (`levelHasShelf` is false below level 1), so a wire-decked rack with
 * `hasGroundBeam` really does grow bars down there. Testing `decking === 'open'`
 * at rack level missed exactly that case, and the geometry cache key inherited
 * the miss — two racks differing only in bar count shared one mesh.
 */
export function barLevels(rack: PalletRackNode): number[] {
  if (palletSupportBarCount(rack) === 0) return []
  return barCapableLevels(rack)
}

/**
 * Çubuk TAŞIYABİLECEK katlar — sayı sıfır olsa bile.
 *
 * `barLevels`'tan tek farkı sayıya bakmaması, ve fark tam olarak panelin
 * ihtiyacı olan şey: kontrol, çubuk *çizilebiliyorsa* görünmeli, ancak
 * çizildiyse değil. Sıfırdan bir'e çıkarmanın yolu kontrolün kendisi olduğu
 * için `barLevels` üzerinden görünürlük vermek kilitli bir kapı olurdu.
 */
function barCapableLevels(rack: PalletRackNode): number[] {
  const present = new Set(storageLevelsPresent(rack))
  return beamedLevels(rack).filter((level) => present.has(level) && !levelHasShelf(rack, level))
}

/** Whether any bar is actually built. */
export function palletSupportBarsDrawn(rack: PalletRackNode): boolean {
  return barLevels(rack).length > 0
}

/**
 * Çubuk kontrolünün görünme koşulu — ÖLÇÜLMÜŞ bir "görünür ama etkisiz" alan.
 *
 * Önceki koşul `palletSupportBarsDrawn(node) || requiresPalletSupportBars(node)`
 * idi ve ikinci şık kontrolü tam da hiçbir şey yapamayacağı yerde açıyordu:
 * varsayılan tel döşemeli bir rafı `long-side-out`'a çevirmek
 * `requiresPalletSupportBars`'ı doğru yapıyor, ama her kiriş katının üstünde
 * panel olduğu için `barLevels` boş kalıyor — kullanıcı 0'dan 3'e kadar
 * sürüklüyor ve rafta hiçbir şey değişmiyor.
 *
 * `parametrics.ts`'in kendi kuralı bunu yasaklıyor: "bir kontrol asla görünür,
 * ayarlanabilir ve etkisiz olamaz." Doğru koşul çubuğun *çizilebilirliği*.
 */
export function palletSupportBarsPossible(rack: PalletRackNode): boolean {
  return barCapableLevels(rack).length > 0
}

/**
 * A rack turned long-side-out with nothing under the pallet.
 *
 * Decking answers the same problem the bars do — it carries the pallet whichever
 * way round it sits — so a decked rack is not unsupported however many bars it
 * declares. Reporting it as unsupported would push the user to add bars that the
 * geometry then refuses to draw, because bars and decking mount in the same
 * place. Surfaced rather than silently corrected when it is real: the user may
 * be modelling a rack that really is built that way.
 */
export function hasUnsupportedPallets(rack: PalletRackNode): boolean {
  if (rack.decking !== 'open') return false
  return requiresPalletSupportBars(rack) && palletSupportBarCount(rack) === 0
}

export function slotById(rack: PalletRackNode, address: string): Slot | null {
  return palletSlotsOf(rack).find((slot) => slot.id === address) ?? null
}
