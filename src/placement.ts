'use client'

import {
  type AlignmentAnchor,
  type AlignmentGuide,
  type AnyNode,
  emitter,
  type GridEvent,
  movingFootprintAnchors,
  resolveAlignment,
  sceneRegistry,
  snapPointToGrid,
} from '@pascal-app/core'
import {
  isAlignmentGuideActive,
  isGridSnapActive,
  isMagneticSnapActive,
  useEditor,
} from '@pascal-app/editor'
import { Vector3 } from 'three'
import { asSlab, type SlabLike, slabAt } from './host-adapter'
import { deckSlabId, mezzanineContains } from './mezzanine/deck-slabs'
import type { MezzanineNode } from './mezzanine/schema'
import { useWarehouseStore } from './store'

/**
 * Placement plumbing, re-derived rather than imported.
 *
 * The host's own `floor-placement` helpers live in `packages/nodes/src/shared/`
 * and are not exported from `@pascal-app/nodes` — its `exports` map only
 * publishes the built bundle. Owning a copy is not a workaround so much as the
 * point: this is the one part of the placement path that cannot break under a
 * host upgrade, because nothing outside this package defines it.
 */

const worldVec = new Vector3()

/**
 * Kinds whose click event must also commit a placement.
 *
 * Listening only to `grid:click` looks correct and quietly loses commits: R3F
 * dispatches a click to the nearest mesh, so a click on what the user reads as
 * "the floor" is usually a slab, and over a placed object it is that object.
 * Mirrors the host's own trigger list, plus this plugin's kinds so a pallet can
 * be placed while the cursor is over another one.
 */
export const CLICK_TRIGGER_KINDS = [
  'grid',
  'shelf',
  'item',
  'slab',
  'ceiling',
  'wall',
  'fence',
  'column',
  'roof',
  'roof-segment',
  'stair',
  'stair-segment',
  'warehouse:pallet',
  // Tezgâhlar sıra hâlinde diziliyor ve sıradaki masa, hizalandığı masanın
  // koliderinin ÜSTÜNDE yerleştiriliyor. Listede olmasa o tıklama yutulur ve
  // ikinci masa hiç konamaz — rafta ve konveyörde ölçülmüş aynı belirti.
  'warehouse:bench',
  // Rampa kapının içine oturuyor ve ikinci bir rampa çoğu zaman komşu
  // kapıya, birincinin koliderine değen bir imleçle konuyor. Listede olmasa
  // o tıklama yutulur.
  'warehouse:dock-leveller',
  // Toplama arabaları sıra hâlinde park ediliyor ve sıradaki araba,
  // hizalandığı arabanın koliderinin üstünde yerleştiriliyor.
  'warehouse:tote-cart',
  // A placed rack's picking collider swallows the click that lands on it, so
  // without this a second rack cannot be placed against the first — the cursor
  // is over the run you are aligning to, and nothing commits.
  'warehouse:pallet-rack',
  // Same reason: a run is built by placing module after module, so the cursor
  // is nearly always over the conveyor you are extending. The five shaped
  // modules join for the same reason — a bend is placed against the straight
  // it continues, and its own hit target is what the cursor is over.
  'warehouse:conveyor-roller',
  'warehouse:conveyor-curve',
  'warehouse:conveyor-launcher',
  'warehouse:conveyor-booster',
  'warehouse:conveyor-transfer',
  'warehouse:conveyor-oblique',
  'warehouse:conveyor-telescopic',
  // Sarmal da bir hat parçası: girişi bir hattın ucuna oturuyor, kendi
  // kolideri imlecin üzerinde durduğu şey. Listede olmasa o tıklama yutulur.
  'warehouse:conveyor-spiral',
  // A route is drawn across a hall that already has paint on it, and its own
  // hit target covers the whole corridor — so without this the second route
  // cannot be started anywhere the first one runs.
  'warehouse:route',
  // Bir filo yan yana park eder: ikinci araç ilkinin kolideri üzerindeyken
  // yerleştirilir.
  'warehouse:truck',
  // İkisi de bu listede YOKTU ve ikisinin de kolideri var: asma katın ya da
  // canlı raf kanalının üzerindeyken yapılan yerleştirme tıklaması yutuluyordu.
  // Asma kat özellikle can alıcı — insanın oraya bir şey koymak için tıkladığı
  // yerin kendisi o.
  'warehouse:mezzanine',
  'warehouse:live-rack',
  // Üç raf kind'ı da EKSİKTİ ve üçünün de seçim kolideri var — gözün içi hava
  // olduğu için raflar arasına nişan alan bir tıklama arkadakini seçmesin diye
  // konmuş, görünmez bir kutu. Kolider tam olarak imlecin üzerinde durduğu şey:
  // bir sıra, göz göze yerleştirilerek kuruluyor, yani ikinci gözü koyarken imleç
  // neredeyse her zaman birincinin üzerinde. Liste dışında kalınca o tıklama
  // yutuluyor ve mıknatısın var olma sebebi olan jest çalışmıyor.
  //
  // `placement.test.ts` artık kaydedilen HER kind'ın burada olmasını istiyor, ki
  // bu üç kez üst üste yapılan atlama dördüncü kez yapılmasın.
  'warehouse:drive-in-rack',
  'warehouse:longspan-rack',
  'warehouse:m3-rack',
] as const

export type PlacementClickEvent = { stopPropagation?: () => void }

/**
 * A physical click reaches this list **twice**, and every tool in this package
 * was placing twice because of it.
 *
 * A rendered node synthesizes `<kind>:click` on `pointerup`
 * (`viewer/hooks/use-node-events.ts`), and the browser's own `click` then fires
 * a moment later and reaches the canvas-level listener that emits `grid:click`
 * (`editor/hooks/use-grid-events.ts`) — which does no hit test at all, so it
 * fires whatever the cursor is over. Subscribing to both, as this does, means
 * one click over a slab appends two vertices or places two pallets.
 *
 * The host hit exactly this and says so in its own words at
 * `nodes/shared/floor-placement.ts`: *"the browser's real `click` fires right
 * after and would re-trigger the same placement through the canvas-level
 * `grid:click` listener, which R3F stopPropagation cannot reach."* It eats the
 * follow-up with a window-capture listener. That helper is not published, so
 * the guard lives here instead.
 *
 * Collapsed on time AND position rather than on time alone: two genuine
 * placements a tenth of a second apart at the *same* point are a double-click,
 * which no tool in this package wants to treat as two.
 */
const DUPLICATE_WINDOW_MS = 200
const SAME_POINT_M = 0.001

let lastFiredAt = 0
let lastPoint: readonly [number, number] | null = null

function isFollowUpOfSameClick(event: PlacementClickEvent): boolean {
  const now = Date.now()
  const position = (event as { position?: [number, number, number] }).position
  const here: readonly [number, number] | null = position ? [position[0], position[2]] : null

  const withinWindow = now - lastFiredAt < DUPLICATE_WINDOW_MS
  const samePlace =
    here === null ||
    lastPoint === null ||
    (Math.abs(here[0] - lastPoint[0]) < SAME_POINT_M &&
      Math.abs(here[1] - lastPoint[1]) < SAME_POINT_M)

  if (withinWindow && samePlace) return true
  lastFiredAt = now
  lastPoint = here
  return false
}

export function subscribePlacementClicks(
  handler: (event: PlacementClickEvent) => void,
): () => void {
  const guarded = (event: PlacementClickEvent) => {
    if (isFollowUpOfSameClick(event)) return
    // Bekleyen hareket ÖNCE işlenir: tıklama, son hareketin bıraktığı konuma
    // yerleştiriyor ve o hareket bu karenin rAF'ını beklemiş olabilir.
    // Boşaltmadan çağırmak, imlecin bir kare geride kalan yerine koyardı.
    flushPendingGridMoves()
    handler(event)
  }
  const events = CLICK_TRIGGER_KINDS.map((kind) => `${kind}:click`)
  for (const name of events) emitter.on(name as never, guarded as never)
  return () => {
    for (const name of events) emitter.off(name as never, guarded as never)
  }
}

/**
 * Clicks from the canvas alone, with the browser's own click `detail`.
 *
 * A multi-point tool needs to tell "add a corner" from "finish", and the only
 * honest source of that distinction is the native event's `detail`: 1 for the
 * first click of a gesture, 2 for the second. The host's own wall tool finishes
 * on `detail >= 2` for exactly this reason.
 *
 * Subscribing to the canvas listener alone rather than to every node kind is
 * also what makes the count reliable — a node-surface click carries the
 * `pointerup` that synthesized it, not the click sequence.
 */
export function subscribeGridClicks(
  handler: (event: GridEvent, detail: number) => void,
): () => void {
  const onClick = (event: GridEvent) => {
    // `subscribePlacementClicks` ile aynı sebeple: çok noktalı araçlar köşeyi
    // son hareketin bıraktığı imleçten okuyor.
    flushPendingGridMoves()
    const native = event.nativeEvent as unknown as { detail?: number } | undefined
    handler(event, native?.detail ?? 1)
  }
  emitter.on('grid:click', onClick)
  return () => emitter.off('grid:click', onClick)
}

/**
 * Snap a planar position when grid snapping is the active mode.
 *
 * `isGridSnapActive()` is the host's own choke point: it resolves the snapping
 * mode for whatever context is active, which for an armed tool comes from the
 * kind's `snapProfile`. Reading it rather than the underlying store fields
 * means the four modes (grid / lines / angles / off) keep behaving correctly
 * here even if the host rearranges how they are stored — an earlier version
 * poked at `snappingModeByContext.item` directly and would have silently
 * reverted to always-on grid snap the moment that shape changed.
 */
export function snapXZ(x: number, z: number): readonly [number, number] {
  if (!isGridSnapActive()) return [x, z]
  return snapPointToGrid([x, z], useEditor.getState().gridSnapStep)
}

/**
 * Figma-style alignment threshold in metres, matching the host's own move tool.
 * 8 cm pulls without fighting grid snap.
 */
export const ALIGNMENT_THRESHOLD_M = 0.08

export type AlignedPlacement = {
  position: [number, number, number]
  guides: AlignmentGuide[]
}

/**
 * Grid snap, then alignment against every other object on the level.
 *
 * The host has this exact routine — `resolveAlignedFloorPlacement` in
 * `packages/nodes/src/shared/floor-placement` — but that module is internal to
 * `@pascal-app/nodes` and not published, so the composition is re-derived here
 * from the three primitives that *are* public. Those primitives are the load
 * bearing part: `movingFootprintAnchors` reads this kind's declared footprint
 * through the registry, so the guides stay correct for every pallet preset
 * without listing dimensions twice.
 *
 * Display and pull are deliberately separate, matching the host: guides are
 * drawn in every mode except when no snap context is active, but the magnetic
 * delta is applied only in `lines` mode. So the user always sees what the
 * pallet lines up with, and only gets pulled onto it when they asked for it.
 */
export function resolveAlignedPlacement({
  candidates,
  centerOffset,
  node,
  rawX,
  rawZ,
  rotationY,
}: {
  candidates: readonly AlignmentAnchor[]
  /**
   * World-space vector from the cursor to the node's centre.
   *
   * For a kind that grows from an edge rather than about its middle. Applied
   * after the grid quantize and before alignment, which is the only order that
   * behaves: the cursor is what the user is aiming, so that is what lands on the
   * grid line, while alignment compares the footprint — which is centred — with
   * its neighbours.
   */
  centerOffset?: readonly [number, number]
  node: AnyNode
  rawX: number
  rawZ: number
  rotationY: number
}): AlignedPlacement {
  const [snappedX, snappedZ] = snapXZ(rawX, rawZ)
  const x = snappedX + (centerOffset?.[0] ?? 0)
  const z = snappedZ + (centerOffset?.[1] ?? 0)
  if (!isAlignmentGuideActive() || candidates.length === 0) {
    return { position: [x, 0, z], guides: [] }
  }

  const moving = movingFootprintAnchors(node, x, z, rotationY)
  if (moving.length === 0) return { position: [x, 0, z], guides: [] }

  const result = resolveAlignment({
    moving,
    candidates: candidates as AlignmentAnchor[],
    threshold: ALIGNMENT_THRESHOLD_M,
  })
  if (result.snap && isMagneticSnapActive()) {
    return {
      position: [x + result.snap.dx, 0, z + result.snap.dz],
      guides: result.guides,
    }
  }
  return { position: [x, 0, z], guides: result.guides }
}

/** Convert a world-space grid hit into the active level's local frame, which is
 * how the host stores node positions. */
export function toLevelLocal(
  levelId: string,
  world: [number, number, number],
): [number, number, number] {
  const levelObject = sceneRegistry.nodes.get(levelId)
  if (!levelObject) return [world[0], 0, world[2]]
  worldVec.set(world[0], world[1], world[2])
  levelObject.updateWorldMatrix(true, false)
  levelObject.worldToLocal(worldVec)
  return [worldVec.x, 0, worldVec.z]
}

/**
 * Elect the slab a level-local point stands on, so the node can persist it.
 *
 * Storing the answer at commit time turns "which racks are on this slab" into a
 * field comparison for the stats panel. The alternative — testing polygons on
 * every recompute — is both slower and less stable, since a node nudged a
 * centimetre past a slab edge would silently leave the count.
 *
 * Reads host slabs through the adapter, so a change to the slab schema costs
 * the node its `supportSlabId` and nothing more.
 */
export function electSupportSlab(
  nodes: Readonly<Record<string, unknown>>,
  levelId: string,
  x: number,
  z: number,
): string | null {
  /**
   * Açıkça seçilmiş bir mezzanine güvertesi her şeyin ÖNÜNDE gelir.
   *
   * Nişan alarak seçilemiyor: `getPointedSupportSurface` ışının kestiği en
   * küçük pozitif t'yi alıyor, yukarıdan bakan bir kamerada bu her zaman en
   * üstteki güverte. Üst üste iki güverte varsa alttakine hiçbir açıdan
   * nişan alınamaz. Bu yüzden hedef kat açıkça seçiliyor.
   *
   * Kapsama şartı olmadan, binanın öbür ucuna konan bir palet de güverteye
   * uçardı — seçim yalnız o mezzanine'in taban izinde geçerli.
   */
  const active = useWarehouseStore.getState().activeDeck
  if (active) {
    const owner = nodes[active.mezzanineId] as MezzanineNode | undefined
    if (
      (owner as { type?: string } | undefined)?.type === 'warehouse:mezzanine' &&
      mezzanineContains(owner as MezzanineNode, x, z)
    ) {
      return deckSlabId(active.mezzanineId, active.tierIndex)
    }
  }

  return slabAt(collectSlabs(nodes, levelId), x, z)?.id ?? null
}

/**
 * The level's slabs, once.
 *
 * Split out of `electSupportSlab` because that function walks **every child of
 * the level** to find them, and a level's children are mostly not slabs — in a
 * finished warehouse they are the two thousand racks. Electing per node
 * therefore costs placed × children, which is quadratic in exactly the thing
 * this kind is built to have a lot of: laying a 2,000-bay run into a level that
 * already holds 2,000 racks is four million lookups inside one click.
 *
 * Anything placing more than one node collects once and calls `slabAt` per
 * position, which is placed + children.
 */
export function collectSlabs(
  nodes: Readonly<Record<string, unknown>>,
  levelId: string,
): SlabLike[] {
  const level = nodes[levelId] as { children?: unknown } | undefined
  const childIds = Array.isArray(level?.children) ? level.children : []
  const slabs: SlabLike[] = []
  for (const id of childIds) {
    if (typeof id !== 'string') continue
    const slab = asSlab(nodes[id])
    if (slab) slabs.push(slab)
  }
  return slabs
}

export type GridMoveHandler = (rawLevelLocal: [number, number, number], event: GridEvent) => void

/**
 * Aynı noktayı iki kez bildirmemek için eşik, metre.
 *
 * Onda bir milimetre: yerleştirme kutusunun çizimini hiçbir ekranda
 * değiştiremez, ama ızgaraya oturmuş bir imleç için ardışık karelerin
 * çoğunda "değişmedi" cevabı verir — ve o cevap bir React render'ını
 * tamamen atlatır.
 */
const CURSOR_SETTLED_M = 1e-4

/**
 * İki yerleştirme noktası görünür biçimde aynı mı.
 *
 * `setState`'e her harekette TAZE bir dizi vermek, React'in kaçamayacağı bir
 * render demek: dizi kimliği hep yeni olduğu için eşitlik kontrolü hep
 * başarısız. Izgara açıkken imleç çoğu karede aynı hücrede duruyor, yani o
 * render'ların çoğu birebir aynı kareyi üretiyordu.
 */
export function samePlacementPoint(
  previous: readonly [number, number, number] | null,
  next: readonly [number, number, number],
): boolean {
  if (!previous) return false
  return (
    Math.abs(previous[0] - next[0]) <= CURSOR_SETTLED_M &&
    Math.abs(previous[1] - next[1]) <= CURSOR_SETTLED_M &&
    Math.abs(previous[2] - next[2]) <= CURSOR_SETTLED_M
  )
}

/**
 * Bekleyen hareketleri şimdi işleyen kapanışlar — her etkin abonelik için bir
 * tane. Tıklama yolları bunu senkron çağırıyor.
 */
const pendingFlushes = new Set<() => void>()

/**
 * Bu karede birikmiş hareketleri hemen işler.
 *
 * Yerleştirme tıklaması, imleci son hareketin bıraktığı yerden okuyor. Hareket
 * bir sonraki kareye ertelendiği için, boşaltma olmadan tıklama bir kare eski
 * konuma yerleştirirdi — hızlı bir "sürükle ve bırak"ta gözle görülür.
 */
export function flushPendingGridMoves(): void {
  for (const flush of pendingFlushes) flush()
}

/**
 * Subscribe to cursor movement over the grid, **unsnapped**.
 *
 * Snapping is left to the caller because grid quantize and alignment have to be
 * applied in that order against the same point — snapping here would hand the
 * alignment resolver an already-quantized cursor and the two would fight,
 * showing a guide the pallet never actually reaches.
 *
 * Commits elsewhere use the position from the last move rather than the click
 * event's own: a click reports the ray's hit point, which on a vertical face is
 * somewhere up a wall rather than on the floor the user was aiming at.
 *
 * ## Kare başına bir kez — ve neden bu tek değişiklik on altı aracı birden
 * ilgilendiriyor
 *
 * Host `grid:move`'u ham `pointermove` dinleyicisinden yayınlıyor, düğme
 * koşulu olmadan: yani fare tuval üzerinde GEZİNİRKEN bile akıyor. Bir oyun
 * faresi saniyede 1000 olay üretir, ekran 50 kare çizer. Her olay tam
 * yerleştirme hattını koşturuyordu — hizalama çözümü, şema ayrıştırma, host'un
 * ızgara sorgusu, paketin üç boyutlu çakışma taraması ve birkaç React
 * `setState`'i — yani işin yirmide on dokuzu, çizilmeyen bir kare için.
 *
 * Bu, masaüstü ile dokunmatik arasındaki en keskin fark: iPhone parmak değene
 * kadar tek bir `pointermove` üretmez, üstelik sürüklerken de 60 Hz'i geçmez.
 * Aynı hat orada hiç koşmuyordu.
 *
 * Son olay kazanır, çünkü on altı abonenin hepsi imleci TAKİP ediyor — hiçbiri
 * ara noktaları biriktirmiyor. Tek görünür yan etki, hızlı bir harekette
 * atlanan ızgara-tık sesleri; kare başına birden fazlası zaten duyulmuyordu.
 */
export function subscribeGridMove(handler: GridMoveHandler): () => void {
  let pending: { position: [number, number, number]; event: GridEvent } | null = null
  let frame: number | null = null

  const flush = () => {
    if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    frame = null
    const latest = pending
    pending = null
    if (latest) handler(latest.position, latest.event)
  }

  const onMove = (event: GridEvent) => {
    const [lx, , lz] = event.localPosition
    pending = { position: [lx, 0, lz], event }
    // Sunucu ön-render'ında `requestAnimationFrame` yok; orada eski davranış
    // (senkron) doğru olanı, çünkü ertelenecek bir kare de yok.
    if (typeof requestAnimationFrame !== 'function') {
      flush()
      return
    }
    if (frame === null) frame = requestAnimationFrame(flush)
  }

  emitter.on('grid:move', onMove)
  pendingFlushes.add(flush)
  return () => {
    emitter.off('grid:move', onMove)
    pendingFlushes.delete(flush)
    if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    frame = null
    // Araç sökülürken bekleyen hareket ÇALIŞTIRILMAZ: kapanış artık var olmayan
    // bir aracın state'ine yazardı.
    pending = null
  }
}
