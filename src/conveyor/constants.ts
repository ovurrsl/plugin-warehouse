/**
 * The figures the catalogue does **not** publish.
 *
 * Every value here was read off a render or inferred from a rule of thumb, and
 * every one is a place this model could be wrong. They live in their own file
 * for exactly that reason: `./catalog` is what Mecalux says, this is what we
 * had to decide, and a reviewer can tell which is which without reading either
 * carefully. Changing one of these is a modelling decision; changing one of
 * those is a typo.
 *
 * The ids match the assumption table in the research document
 * (`Konveyor_Sistemi_Plani_v1.md` §8) so the two can be checked against each
 * other by hand.
 *
 * Metres, like everything downstream of `./catalog`.
 */

const mm = (value: number): number => value / 1000

/**
 * **A1 — roller diameter, 50 mm.**
 *
 * The standard for box conveyors and consistent with every catalogue render.
 * Not a field: no layout decision turns on it, and a slider walking it would
 * mint a geometry per step for a difference nobody can see past two metres.
 */
export const ROLLER_DIAMETER_M = mm(50)

/**
 * **A2 — roller pitch, 75 mm default, from a fixed set.**
 *
 * The catalogue gives no pitch, only the rule that a box must always be
 * supported by at least three rollers — so `pitch ≤ shortestBox / 3`. Against
 * the family's 150–800 mm box range that admits 50 (for 150 mm boxes), 75 (for
 * 250 mm and up, the ordinary case) and 100 (for 300 mm and up).
 *
 * **A fixed set rather than a number field, and that is a cache decision as
 * much as a modelling one.** Pitch sets the roller stripe's repeat, so it is in
 * the geometry key; a free slider dragged from 50 to 100 mm mints a buffer at
 * every step it passes through, and MCP or a typed entry could produce 83 mm,
 * which no supplier ships. The rack learned the same lesson the expensive way
 * with `decking`.
 */
export const ROLLER_PITCHES_MM = [50, 75, 100] as const
export type RollerPitch = (typeof ROLLER_PITCHES_MM)[number]
export const DEFAULT_ROLLER_PITCH: RollerPitch = 75

/** The catalogue's own support rule, and the reason the pitch set is what it
 *  is: three rollers under the shortest box, always. */
export const MIN_ROLLERS_UNDER_A_BOX = 3

/**
 * **A4 — support spacing, 1.5 m, plus one at every module joint.**
 *
 * From the renders. The joint rule is the load-bearing half: two abutting
 * modules must share one support rather than each building its own, which is
 * the same doubled-steel problem the rack solved for upright frames.
 */
export const MAX_SUPPORT_SPACING_M = mm(1500)

/**
 * **A5 — side profile depth, 100 mm, top edge flush with the roller top.**
 *
 * From the renders. "Flush with the roller top" is the part that matters: it
 * makes the transport height the top of the profile as well, so a box slides
 * from one module to the next without a lip, and the panel's TOR figure is the
 * one you would measure with a tape.
 */
export const SIDE_PROFILE_DEPTH_M = mm(100)
/** Wall thickness of the formed side profile. */
export const SIDE_PROFILE_THICKNESS_M = mm(3)

/**
 * **A9 — the palette, approximated from catalogue photography.**
 *
 * Colours ride in the vertex-colour attribute, so these cost nothing: the whole
 * conveyor family draws from one material whatever the palette says. They are
 * defaults on the node rather than constants, except the ones no user would
 * ever set.
 */
export const PALETTE = {
  /** Frames and legs. Mecalux blue. */
  frameBlue: '#1e56a0',
  /** Rollers and drums — bright zinc, which is why the material wants a lower
   *  roughness than the rack's powder-coated steel. */
  rollerZinc: '#c9ced3',
  /** Side profiles and curve kerbs. */
  profileGrey: '#e8eaec',
  /** Motor housings and control boxes. */
  boxWhite: '#f4f5f6',
  /** Adjustable feet and base plates. */
  feetGrey: '#70767c',
  /** Drive rollers and lifting frames. */
  accentOrange: '#e87722',
} as const

/**
 * **The overhang behind an oblique's useful widths.**
 *
 * The catalogue publishes only this type's *exterior* widths — 667 main, 467
 * branch — and no useful width at all, so the 600 and 400 classes its ports
 * carry are inferred. Sixty-seven millimetres is the booster's published
 * overhang and the tightest in the family, taken as the nearest published
 * analogue because an oblique's side members are formed the same way.
 *
 * Its own constant rather than a reach into `catalog.ts`: the two are equal
 * today by coincidence of derivation, not by the catalogue saying so, and a
 * republished booster must not silently move this machine's ports.
 */
export const OBLIQUE_FRAME_OVERHANG_M = mm(67)

/**
 * **A6 — the angle an oblique branch leaves at.**
 *
 * Measured off the catalogue's render. Thirty and forty-five are both built, so
 * it is a field rather than a constant — and it is the field that decides how
 * much floor the branch takes: a shallower branch runs further before it clears
 * the main frame, which is exactly the trade a dense installation makes.
 */
export const OBLIQUE_BRANCH_ANGLES_DEG = ['30', '45'] as const

/**
 * **A10 — how far a mixed transfer's belt strip rises above the roller line.**
 *
 * Eight millimetres, from the catalogue imagery. **Animation only.** It changes
 * no clearance and no port, so it must never reach a geometry cache key: a strip
 * at rest and a strip lifted are the same module, and keying on it would put two
 * buffers behind every transfer in the building.
 */
export const MTR_STRIP_STROKE_M = mm(8)

/**
 * **The belt strips that carry the box across a mixed transfer.**
 *
 * Three of them, and each is a box rather than a painted stripe. The atlas
 * exists for repeated detail — hundreds of rollers on one bed — and three strips
 * are not that; more decisively, a strip *rises*, and a painted line cannot.
 * Thirty-six triangles a machine is the whole cost.
 */
export const MTR_STRIP_COUNT = 3
export const MTR_STRIP_WIDTH_M = mm(40)

/** Rollers in each gap the strips leave. Two, from the imagery: a 147 mm gap
 *  takes a pair at the family's usual spacing and the bed reads as continuous. */
export const MTR_ROLLERS_PER_GAP = 2

/**
 * **Oblique'in saptırma makaralarının ana yataktan yüksekliği.**
 *
 * SEÇİLMİŞ VARSAYILAN — katalog bir kot farkı yayınlamıyor. Ama sıfır olamaz:
 * saptırıcı, kutuyu ana hattan alıp dala çevirmek için onun ALTINA girmek
 * zorunda, yani makara sırası ana hattın makara sırasından yüksek durur.
 *
 * Kodda sıfırdı ve parça ana yatağın diliminin tamamen İÇİNDE kalıyordu:
 * `diverter` y ∈ [0,7025 , 0,7475], yatak y ∈ [0,7000 , 0,7500]. Üstten
 * bakışta plan izdüşümünün tamamı yatağın altında, yani `diverterColor`
 * hiçbir pikselde görünmüyor — makine düz gri bir Y olarak çiziliyordu ve
 * şemanın "the part a fitter recognises the machine by" dediği parça,
 * kendine ayrılmış renk alanıyla birlikte, ölü bir kontroldü.
 *
 * `MTR_STRIP_STROKE_M` ile aynı büyüklük sınıfı ve aynı gerekçe: bir
 * yüzeyin öbürünün üstünde olduğunu göstermenin en ucuz yolu.
 */
export const OBLIQUE_DIVERTER_PROUD_M = mm(8)

/**
 * **How far a launcher's lateral bed reaches past the main line.**
 *
 * Not published. Read off the render, where the stub is about one box deep —
 * which is also what it must be for the launched box to sit clear of the main
 * line before the next one arrives, so the estimate has a reason as well as a
 * measurement. The catalogue fixes this type's box at 400 mm, so that is the
 * reach.
 */
export const LAUNCHER_LATERAL_REACH_M = mm(400)

/** Leg section, from the renders. Square tube. */
export const LEG_SECTION_M = mm(60)
/** Base plate under each leg, and how far it overhangs the tube. */
export const FOOTPLATE_THICKNESS_M = mm(8)
export const FOOTPLATE_OVERHANG_M = mm(25)
/** Crossbar tying the two legs of a support station together. */
export const CROSSBAR_SECTION_M = mm(40)
/** Height of the crossbar above the floor, so a pallet truck can pass under a
 *  line standing at the 750 mm transport height. */
export const CROSSBAR_CLEARANCE_M = mm(200)

/** Side guide rail: the profile that stops a box walking off the edge. */
export const SIDE_GUIDE_SECTION_M = mm(40)
export const SIDE_GUIDE_THICKNESS_M = mm(15)
/** Standard guide height above the roller top. */
export const DEFAULT_SIDE_GUIDE_HEIGHT_M = mm(68)

/** Motor block at the head of a driven line — one per line, not per module,
 *  which is what distinguishes CAR from the zoned accumulator. */
export const MOTOR_BLOCK_M: readonly [number, number, number] = [mm(300), mm(220), mm(180)]

/**
 * **A11 — the control box, 400 × 250 × 500 mm.**
 *
 * From the catalogue photography. A booster carries its drive *under* the bed
 * rather than in a housing off the side, which is the whole reason its frame is
 * 67 mm over the lane where a straight's is 147 — there is nothing beside the
 * bed to make room for.
 */
export const CONTROL_BOX_M: readonly [number, number, number] = [mm(400), mm(250), mm(500)]
