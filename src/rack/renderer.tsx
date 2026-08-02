'use client'

import {
  type AnyNodeId,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { SelfDrawnBody } from '../instancing/self-drawn'
import { useCollective } from '../instancing/use-collective'
import { getPalletFarGeometry, getPalletGeometry } from '../pallet/geometry-builder'
import { getPalletFarMaterial, getPalletMaterial } from '../pallet/materials'
import { specOf } from '../pallet/presets'
import { useStaticTransform } from '../static-transform'
import {
  getRackGeometry,
  rackGeometryKey,
  releaseRackGeometry,
  retainRackGeometry,
} from './geometry-builder'
import { getRackMaterial } from './materials'
import { hasRightNeighbour } from './neighbours'
import { occupiedSlots, slotDraw } from './occupancy'
import type { PalletRackNode } from './schema'
import { orientedPalletFootprint, palletSlotsOf, totalDepth, totalWidth } from './slots'

const NO_RAYCAST = () => {}

/**
 * Distance band at which a rack drops to its reduced tier, in metres, squared
 * to keep the per-frame test off the square root.
 *
 * The two bounds differ on purpose. A single threshold makes a rack sitting
 * exactly on it swap geometry every time the camera breathes, which reads as
 * flicker; widening the band means a rack must travel a long way to change
 * tier, so no amount of jitter can oscillate it.
 *
 * Both figures moved out from 45/35 m. At 45 m a 250 m building is almost
 * entirely on the far side of the band, so the reduced tier was not a fallback
 * but the normal appearance of a rack — which is why dropping the decks and
 * bracing from it was so visible. The far tier now carries them (see
 * `rackParts`), and the band sits far enough out that the full section detail
 * is reachable by backing off rather than by pressing the camera into the
 * steel.
 */
const LOD_FAR_SQ = 70 * 70
const LOD_NEAR_SQ = 55 * 55

/** Shared by every rack's picking collider, scaled per node. A box geometry per
 *  rack is a thousand allocations that all describe the same cube. */
const UNIT_COLLIDER = new THREE.BoxGeometry(1, 1, 1)

/**
 * Invisible, and deliberately so.
 *
 * `visible = false` takes the collider out of `WebGLRenderer.projectObject`
 * entirely — no colour pass, no shadow pass — while three's raycaster and R3F's
 * event layer both ignore `visible` and keep hitting it. A `colorWrite: false`
 * material still costs a draw call per rack in both passes, which on a thousand
 * racks is a thousand draws that paint nothing.
 */
const COLLIDER_MATERIAL = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })

/**
 * Mounted through `def.renderer: { kind: 'parametric' }` rather than
 * `def.geometry`, for the same reason the pallet is.
 *
 * `<GeometrySystem>` disposes the previous build's children on every rebuild,
 * and the geometry here is shared by every rack of the same shape — so one
 * rebuild anywhere would free the buffer a hundred other racks are drawing
 * from and blank them all at once. Owning the mount and passing `dispose={null}`
 * keeps React away from the shared buffers.
 */
export default function PalletRackRenderer({ node }: { node: PalletRackNode }) {
  const registeredRef = useRef<THREE.Object3D>(null!)
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id as AnyNodeId, node.type, registeredRef)

  const isExporting = useViewer(
    (s) => (s as typeof s & { isExporting?: boolean }).isExporting ?? false,
  )

  const live = useLiveTransforms((s) => s.get(node.id))
  const override = useLiveNodeOverrides((s) => s.overrides.get(node.id))
  const overridePosition = override?.position as [number, number, number] | undefined
  const overrideRotation = override?.rotation as [number, number, number] | undefined

  const position = live?.position ?? overridePosition ?? node.position ?? [0, 0, 0]
  const baseRotation = overrideRotation ?? node.rotation ?? [0, 0, 0]
  const rotation: [number, number, number] = live
    ? [baseRotation[0], live.rotation, baseRotation[2]]
    : baseRotation

  // See `useStaticTransform`: three recomposes every registered group's local
  // matrix on every frame unless told otherwise, and a warehouse at rest has
  // thousands of these doing nothing. Live for exactly the window something
  // is actually writing this rack's transform every tick.
  useStaticTransform(
    registeredRef,
    position,
    rotation,
    live !== undefined || override !== undefined,
  )

  /**
   * Whether the bay standing on this one's right builds the shared frame.
   *
   * The index behind this is built once per store write and shared by every
   * rack; the selector narrows it to one boolean, so a rack re-renders only when
   * its *own* answer changes rather than on every scene edit. See
   * `./neighbours`.
   */
  const abutted = useScene((s) => hasRightNeighbour(s.nodes as Record<string, unknown>, node.id))

  const material = getRackMaterial()

  /**
   * Kolektif çizici — bu düğümü havuza kaydeder ve kendi mesh'ini çizip
   * çizmeyeceğini söyler.
   *
   * Seçili ya da sürükleniyorsa kendi çizer: ana hat geçişi yalnız GÖRÜNÜR
   * mesh'leri tarıyor, ve sürüklenen bir düğümün matrisi her kare değişiyor
   * (havuzu her kare yeniden kurmak, kurtardığından pahalıya gelir).
   */
  const selected = useViewer((s) => s.selection.selectedIds.includes(node.id as AnyNodeId))
  const drawsSelf = useCollective({
    nodeId: node.id,
    objectRef: registeredRef,
    geometryFor: (tier) => getRackGeometry(node, tier, abutted),
    keyFor: (tier) => rackGeometryKey(node, tier, abutted),
    materialFor: () => material,
    materialKeyFor: () => 'rack',
    castsShadow: true,
    farSq: LOD_FAR_SQ,
    nearSq: LOD_NEAR_SQ,
    excluded: selected || live !== undefined || override !== undefined || isExporting,
  })

  /**
   * Tell the cache this shape is on screen.
   *
   * The cache is bounded now — a slider scrub mints a geometry per step and
   * would otherwise leave hundreds behind — and eviction must never free a
   * buffer something is drawing. This is the only place that knows.
   *
   * Deliberately keyed on the *full* tier rather than the current one: the LOD
   * swaps between them at frame rate, and re-registering on every swap would be
   * churn for nothing. The two tiers of one shape are minted together and are
   * both worth keeping while the rack exists.
   */
  useEffect(() => {
    const key = retainRackGeometry(node, 'full', abutted)
    const far = retainRackGeometry(node, 'simple', abutted)
    return () => {
      releaseRackGeometry(key)
      releaseRackGeometry(far)
    }
  }, [node, abutted])

  const width = totalWidth(node)
  const depth = totalDepth(node)

  return (
    <group visible={node.visible !== false} {...handlers}>
      {/* Selection collider. A rack is mostly air — clicks aimed at it fall
          between the beams and hit whatever is behind. An invisible box over
          the whole frame is what the user is actually pointing at. Outside the
          registered group so the selection outline still traces the real
          silhouette rather than this box. */}
      {!isExporting && (
        <mesh
          dispose={null}
          geometry={UNIT_COLLIDER}
          material={COLLIDER_MATERIAL}
          position={[position[0], position[1] + node.uprightHeight / 2, position[2]]}
          rotation={rotation}
          scale={[width, node.uprightHeight, depth]}
          visible={false}
        />
      )}

      <group position={position} ref={registeredRef} rotation={rotation}>
        {/* Kolektif çizici kapalıyken ya da bu düğüm seçili/sürükleniyorken
            kendi mesh'ini çizer; açıkken tek `InstancedMesh` onun yerine
            çizer ve bu boş kalır. İkisi birden çizerse z-savaşı olur. */}
        {drawsSelf && (
          <SelfDrawnBody
            farSq={LOD_FAR_SQ}
            geometryFor={(tier) => getRackGeometry(node, tier, abutted)}
            isExporting={isExporting}
            materialFor={() => material}
            nearSq={LOD_NEAR_SQ}
            nodeId={node.id}
          />
        )}
        {node.ghostFill > 0 && <GhostStock node={node} />}
      </group>
    </group>
  )
}

/**
 * Katman döngüsü ve fazlama artık `../instancing/self-drawn`'da.
 *
 * Buradaki kopya, kolektif çizici AÇIKKEN bile R3F'in abonelik listesinde
 * duruyordu: `steelRef.current` `null` olduğu için ilk satırda dönüyor, ama
 * kare başına bir kez çağrılıyordu. İki bin raflık bir sahnede kare başına iki
 * bin boş kapanış — ve aynı işi kolektif sistem zaten tek merkezî döngüde
 * yapıyor. `SelfDrawnBody` yalnız düğüm kendi çizerken mount olduğu için
 * abonelik o hâlde hiç kurulmuyor.
 */

/**
 * Illustrative stock in slots no real pallet occupies.
 *
 * Instanced, because a filled 10-bay rack is a few hundred pallets and drawing
 * them individually would undo everything the merged steel geometry bought.
 * Both meshes reuse the pallet node's own cached geometry and material, so a
 * scene holding real pallets *and* ghost stock still compiles one pallet shader.
 */
/**
 * Hayalet güvertenin katman bandı — paletin KENDİ bandıyla aynı.
 *
 * Ayrı sayılar yazmak, gerçek bir paletin kutuya düştüğü mesafede yanındaki
 * hayaletin hâlâ tam tahta çizmesi (ya da tersi) demek olurdu; ikisi yan yana
 * duruyor ve fark görünür.
 */
const GHOST_FAR_SQ = 25 * 25
const GHOST_NEAR_SQ = 18 * 18
const GHOST_LOD_INTERVAL = 8
const ghostWorldPosition = new THREE.Vector3()

function GhostStock({ node }: { node: PalletRackNode }) {
  const palletRef = useRef<THREE.InstancedMesh>(null)
  const loadRef = useRef<THREE.InstancedMesh>(null)
  const ghostTierRef = useRef<'full' | 'far'>('full')
  const ghostFrameRef = useRef(0)
  const ghostPhase = useMemo(() => {
    let hash = 0x811c9dc5
    for (let index = 0; index < node.id.length; index++) {
      hash ^= node.id.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0) % GHOST_LOD_INTERVAL
  }, [node.id])

  // One shared index for the whole scene rather than a scan per rack — see
  // `occupancy.ts`. Selecting the set here keeps this rack re-rendering only
  // when its own occupancy changes.
  const occupied = useScene((s) => occupiedSlots(s.nodes as Record<string, unknown>, node.id))

  const spec = specOf(node.palletPreset)
  const geometry = useMemo(() => getPalletGeometry(node.palletPreset), [node.palletPreset])
  const material = getPalletMaterial()

  /**
   * The pallet mesh is built with its **length along local X**, and the slot
   * does not have to want it that way.
   *
   * `palletOrientation` is a property of the rack — how it is loaded — and
   * `orientedPalletFootprint` already reports the slot's extents accordingly.
   * The geometry knows none of that, and nothing here turned it, so on the
   * default `short-side-out` rack every ghost pallet was drawn a quarter turn
   * out: 1.2 m along a run whose slots are pitched 0.875 m apart, so each pallet
   * overlapped both neighbours by 325 mm, and only 0.8 m into a 1.1 m frame, so
   * its bottom boards ran *along* the beams with nothing underneath. That is not
   * a pallet loaded badly; it is a pallet that would fall through the rack.
   */
  const [alongRun, intoDepth] = orientedPalletFootprint(node)
  const turned = Math.abs(alongRun - spec.length) > 1e-9

  /**
   * Tampon tavanı: rafın TÜM palet yuvaları.
   *
   * `ghostFill` 0→1 gezinirken yerleşim sayısı değişir ama tavan değişmez,
   * dolayısıyla mesh bir kez kurulur ve kaydırıcı boyunca aynı kalır.
   * Yalnız rafın şekli değişince (yuva sayısı) yeniden kurulur.
   */
  const capacity = useMemo(() => Math.max(1, palletSlotsOf(node).length), [node])

  const placements = useMemo(() => {
    const result: Array<{ position: [number, number, number]; load: number }> = []
    for (const slot of palletSlotsOf(node)) {
      if (occupied.has(slot.id)) continue
      if (slotDraw(node.id, slot.id) >= node.ghostFill) continue
      // Leave the top of the opening clear rather than filling it exactly: a
      // unit load that touches the beam above reads as a modelling error.
      const load = Math.max(0, Math.min(1.2, slot.clearHeight - spec.height - 0.15))
      result.push({ position: slot.localPosition, load })
    }
    return result
  }, [node, occupied, spec.height])

  useLayoutEffect(() => {
    const pallets = palletRef.current
    const loads = loadRef.current
    if (!pallets || !loads) return
    const matrix = new THREE.Matrix4()
    const loadSize = new THREE.Vector3()
    placements.forEach((placement, index) => {
      const [x, y, z] = placement.position
      matrix.makeTranslation(x, y, z)
      // A quarter turn about Y when the slot wants the other face out. The
      // pallet is not symmetric — its bottom boards run along its length, which
      // is exactly what decides whether it lands across the beams or along them.
      if (turned) matrix.multiply(QUARTER_TURN)
      pallets.setMatrixAt(index, matrix)

      // The load is a plain box with no grain, so it takes the oriented
      // footprint straight rather than a rotation.
      matrix.makeTranslation(x, y + spec.height + placement.load / 2, z)
      matrix.scale(loadSize.set(alongRun - 0.04, placement.load, intoDepth - 0.04))
      loads.setMatrixAt(index, matrix)
    })
    pallets.instanceMatrix.needsUpdate = true
    loads.instanceMatrix.needsUpdate = true
  }, [placements, spec.height, turned, alongRun, intoDepth])

  /**
   * Hayalet güvertelerin katmanı — ölçülmüş, bildirilmemiş bir maliyet.
   *
   * Bu `InstancedMesh` `getPalletGeometry`'yi HER MESAFEDE kullanıyordu, yani
   * palet düğümünün kendisi için özellikle yazılmış uzak katman burada hiç
   * devreye girmiyordu. Rakam palet renderer'ının kendi yorumundan: tam güverte
   * 228 bin üçgen, ve `ghostFill: 1` olan on gözlük bir raf birkaç yüz kopya
   * demek — gerçek paletler 25 m'de tek kutuya düşerken, onların yanındaki
   * hayaletler tam tahtayla çizilmeye devam ediyordu.
   *
   * Örnek matrisleri korunuyor: yalnız `geometry` ve `material` takas ediliyor,
   * `instanceMatrix` aynı tampon olarak kalıyor.
   *
   * Bu döngü ÖLÜ DEĞİL — `GhostStock` yalnız `ghostFill > 0` iken mount
   * ediliyor ve mount olduğunda mesh gerçekten ekranda.
   */
  useFrame(({ camera }) => {
    const pallets = palletRef.current
    if (!pallets) return
    ghostFrameRef.current += 1
    if ((ghostFrameRef.current + ghostPhase) % GHOST_LOD_INTERVAL !== 0) return

    const { elements } = pallets.matrixWorld
    const distanceSq = camera.position.distanceToSquared(
      ghostWorldPosition.set(elements[12] ?? 0, elements[13] ?? 0, elements[14] ?? 0),
    )
    const current = ghostTierRef.current
    const next =
      current === 'full'
        ? distanceSq > GHOST_FAR_SQ
          ? 'far'
          : 'full'
        : distanceSq < GHOST_NEAR_SQ
          ? 'full'
          : 'far'
    if (next === current) return
    ghostTierRef.current = next
    pallets.geometry =
      next === 'far'
        ? getPalletFarGeometry(node.palletPreset)
        : getPalletGeometry(node.palletPreset)
    pallets.material = next === 'far' ? getPalletFarMaterial() : getPalletMaterial()
  })

  if (placements.length === 0) return null

  return (
    <>
      {/*
        Kapasite SABİT, çizilen sayı `count` ile ayarlanır.
        
        Önceki hâl `key`'i sayıya bağlayıp her değişimde mesh'i yeniden
        mount ediyordu — ve `dispose={null}` (paylaşılan geometri/materyal
        atılmasın diye, ki o kısmı doğru) eski mesh'in KENDİ sahip olduğu
        `instanceMatrix` tamponunu da GPU'da bırakıyordu. ghostFill
        kaydırıcısını bir uçtan öbürüne sürüklemek, raf başına onlarca
        yetim tampon demekti.
        
        Sabit kapasite ikisini birden çözüyor: yeniden mount yok, dolayısıyla
        yetim tampon da yok — ve `count` yanlış sayıda palet çizilmesini
        `key`'in yaptığı gibi ama bedelsiz engelliyor.
      */}
      {/*
        `frustumCulled={false}` ŞART — kuralı bu paket başka bir dosyasında
        zaten yazmış (`conveyor/flow-system.tsx`): three bir `InstancedMesh`'in
        sınır küresini İLK frustum testinde bir kez hesaplar ve `setMatrixAt`
        onu geçersiz kılmaz. Yerleşimler `ghostFill`, doluluk ve kat düzeni
        değiştikçe yeniden yazılıyor; küre ilk hâline saplanıp kalıyor ve
        hayalet paletler görüş alanındayken kırpılıyordu.
      */}
      <instancedMesh
        args={[geometry, material, capacity]}
        castShadow
        count={placements.length}
        dispose={null}
        frustumCulled={false}
        raycast={NO_RAYCAST}
        ref={palletRef}
      />
      <instancedMesh
        args={[UNIT_BOX, LOAD_MATERIAL, capacity]}
        castShadow
        count={placements.length}
        dispose={null}
        frustumCulled={false}
        raycast={NO_RAYCAST}
        ref={loadRef}
      />
    </>
  )
}

/** One shared quarter turn about Y, for the pallets a slot wants the other way
 *  round. A matrix per instance per frame is an allocation for a constant. */
const QUARTER_TURN = new THREE.Matrix4().makeRotationY(Math.PI / 2)

/** Unit cube scaled per instance, so every ghost load shares one buffer. */
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)
const LOAD_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#c8b394',
  metalness: 0,
  roughness: 0.85,
})
