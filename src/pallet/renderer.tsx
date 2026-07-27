'use client'

import {
  type AnyNodeId,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { Mesh, Object3D } from 'three'
import { Vector3 } from 'three'
import { useStaticTransform } from '../static-transform'
import { FILM_DRAW_DISTANCE_M } from './cargo-constants'
import { getCargoGeometry, releaseCargoGeometry, retainCargoGeometry } from './cargo-geometry'
import { type CargoDetail, cargoInputOf } from './cargo-parts'
import { loadHeightOf, unitLoadHeightOf } from './cargo-types'
import { getFilmGeometry, releaseFilmGeometry, retainFilmGeometry } from './film'
import { getPalletFarGeometry, getPalletGeometry } from './geometry-builder'
import {
  getCargoMaterial,
  getFilmMaterial,
  getPalletFarMaterial,
  getPalletMaterial,
} from './materials'
import { specOf } from './presets'
import type { PalletNode } from './schema'

const NO_RAYCAST = () => {}

/**
 * Where the load drops to its far tier, and where it comes back.
 *
 * Two thresholds rather than one, because a single one at the exact distance a
 * pallet is hovering makes it flicker between tiers on every camera breath. The
 * near figure is set from the acceptance requirement rather than from taste:
 * carton seams have to stay countable at ten to fifteen metres, so the detailed
 * tier has to survive well past that.
 */
const LOD_FAR_SQ = 25 * 25
const LOD_NEAR_SQ = 18 * 18

/**
 * Where the film stops being drawn at all.
 *
 * Fill rate rather than triangles: a blended veil costs its whole silhouette in
 * shaded fragments every frame however few triangles it has, so the only
 * effective control is how many are on screen at once.
 */
const FILM_CUT_SQ = FILM_DRAW_DISTANCE_M * FILM_DRAW_DISTANCE_M

/** Frames between tier checks. Distance to a camera does not change fast enough
 *  to be worth a square root every frame on every pallet in a warehouse. */
const LOD_INTERVAL = 8

const worldPosition = new Vector3()

/** Spreads the tier checks across the interval so a thousand pallets do not all
 *  re-evaluate on the same frame and spike it. */
function hashPhase(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % LOD_INTERVAL
}

/**
 * Mounted through `def.renderer: { kind: 'parametric' }` rather than
 * `def.geometry`, and that choice is load-bearing.
 *
 * `<GeometrySystem>` disposes the previous build's children on every rebuild.
 * The geometry here is a module-level singleton shared by every pallet, so the
 * first rebuild of any one of them — a theme switch is enough — would free the
 * buffer the whole scene is drawing from and blank every pallet at once.
 * Materials are protected from this by `__pascalCachedMaterial`; geometry has
 * no equivalent. Owning the mount and passing `dispose={null}` keeps React from
 * touching the shared buffers at all.
 *
 * This is the same failure the two commits before the rewrite were chasing.
 * They cured it by deleting the caches, which cost a fresh geometry and a fresh
 * 3×1024² atlas per instance — roughly 12 MB of texture memory per pallet.
 */
export default function PalletRenderer({ node }: { node: PalletNode }) {
  const registeredRef = useRef<Object3D>(null!)
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id as AnyNodeId, node.type, registeredRef)

  const isExporting = useViewer(
    (s) => (s as typeof s & { isExporting?: boolean }).isExporting ?? false,
  )

  // Move tools drive the registered object imperatively and mirror the result
  // through `useLiveTransforms`; the rotate and resize gizmos publish through
  // `useLiveNodeOverrides` instead. Folding in both makes the pallet follow the
  // cursor during a drag rather than snapping into place on commit.
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
  // is actually writing this pallet's transform every tick.
  useStaticTransform(
    registeredRef,
    position,
    rotation,
    live !== undefined || override !== undefined,
  )

  const spec = specOf(node.preset)
  const geometry = useMemo(() => getPalletGeometry(node.preset), [node.preset])
  const material = getPalletMaterial()

  /**
   * The deck's own LOD, in the same hysteresis band the cargo uses.
   *
   * The deck was the one mesh in the package drawn at full detail at every
   * distance — invisible at a few hundred pallets, and 228k triangles of
   * sub-pixel boards on a real 3,704-bay scene. Past 25 m it swaps to a single
   * box with a flat wood material; the maps would smear over a box's UVs, so
   * the material swaps with the geometry.
   */
  const deckRef = useRef<Mesh>(null)
  const deckTierRef = useRef<'full' | 'far'>('full')
  const deckFrameRef = useRef(0)
  const deckPhase = useMemo(() => hashPhase(node.id), [node.id])

  useFrame(({ camera }) => {
    const mesh = deckRef.current
    if (!mesh || isExporting) return
    deckFrameRef.current += 1
    if ((deckFrameRef.current + deckPhase) % LOD_INTERVAL !== 0) return

    const { elements } = mesh.matrixWorld
    const distanceSq = camera.position.distanceToSquared(
      worldPosition.set(elements[12] ?? 0, elements[13] ?? 0, elements[14] ?? 0),
    )
    const current = deckTierRef.current
    const next =
      current === 'full'
        ? distanceSq > LOD_FAR_SQ
          ? 'far'
          : 'full'
        : distanceSq < LOD_NEAR_SQ
          ? 'full'
          : 'far'
    if (next === current) return
    deckTierRef.current = next
    if (next === 'far') {
      mesh.geometry = getPalletFarGeometry(node.preset)
      mesh.material = getPalletFarMaterial()
      mesh.castShadow = false
    } else {
      mesh.geometry = getPalletGeometry(node.preset)
      mesh.material = getPalletMaterial()
      mesh.castShadow = true
    }
  })

  // One height, from the one function that knows: a typed load answers with what
  // was typed, a cargo load with what its variant resolved to. The collider and
  // the clash test must not be able to disagree about it.
  const loadHeight = loadHeightOf(node)
  const totalHeight = unitLoadHeightOf(node)

  return (
    <group visible={node.visible !== false} {...handlers}>
      {/* Selection collider. The deck has 41 mm gaps between boards and open
          fork tunnels, so raycasting the real mesh would let clicks fall
          straight through the pallet. An invisible box spanning the unit load
          is what the user is actually aiming at. Kept outside the registered
          group so the selection outline traces the true silhouette. */}
      {!isExporting && (
        <mesh
          position={[position[0], position[1] + totalHeight / 2, position[2]]}
          rotation={rotation}
        >
          <boxGeometry args={[spec.length, totalHeight, spec.width]} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} />
        </mesh>
      )}

      <group position={position} ref={registeredRef} rotation={rotation}>
        <mesh
          castShadow
          // Never dispose: shared across every pallet of this preset.
          dispose={null}
          geometry={geometry}
          material={material}
          raycast={NO_RAYCAST}
          ref={deckRef}
          receiveShadow
        />
        {node.cargo !== 'none' ? (
          <CargoLoad isExporting={isExporting} node={node} y={spec.height} />
        ) : (
          loadHeight > 0 && (
            <PalletLoad
              height={loadHeight}
              length={spec.length}
              width={spec.width}
              y={spec.height}
            />
          )
        )}
      </group>
    </group>
  )
}

/**
 * The goods on the deck. Deliberately plain — a stretch-wrapped block inset
 * slightly from the deck edge. At the two-to-twenty metre range a layout tool
 * is read at, silhouette and height carry the information; modelling individual
 * cartons would cost draw calls for detail nobody sees.
 */
function PalletLoad({
  length,
  width,
  height,
  y,
}: {
  length: number
  width: number
  height: number
  y: number
}) {
  const inset = 0.02
  return (
    <mesh
      castShadow
      // The far-deck material doubles as the plain block's: both are "wood at a
      // glance", and the inline material this replaces minted one instance per
      // mounted pallet — 192 uniform uploads on a real scene, for one colour.
      material={getPalletFarMaterial()}
      position={[0, y + height / 2, 0]}
      raycast={NO_RAYCAST}
      receiveShadow
    >
      <boxGeometry args={[length - inset, height, width - inset]} />
    </mesh>
  )
}

/**
 * The goods, when the pallet carries a type rather than a plain block.
 *
 * Mounted as its own mesh beside the pallet's, not merged into it: the deck is
 * one shared buffer per preset and there are eight of those, where a load is one
 * per distinct type, layout, fill, colour and tier. Merging the two would
 * multiply the pallet's eight by every load in the building.
 */
function CargoLoad({
  node,
  y,
  isExporting,
}: {
  node: PalletNode
  y: number
  isExporting: boolean
}) {
  const meshRef = useRef<Mesh>(null)
  const filmRef = useRef<Mesh>(null)
  /**
   * The tier this load is drawing. Owned by the frame loop, and the mounted
   * geometry is read *from* it rather than hardcoded — the rack shipped the
   * hardcoded version and the two paths fought over which tier was current.
   */
  const detailRef = useRef<CargoDetail>('full')

  const input = useMemo(
    () => cargoInputOf(node, isExporting ? 'full' : detailRef.current),
    [node, isExporting],
  )
  const geometry = useMemo(() => (input ? getCargoGeometry(input) : null), [input])
  // One sleeve fits both tiers: `loadExtent` reads type, preset and variant and
  // never the tier, so the far tier's single box has exactly the near tier's
  // extent.
  const wrapped = node.wrapped && node.cargo !== 'none'
  const filmGeometry = useMemo(
    () => (input && wrapped ? getFilmGeometry(input) : null),
    [input, wrapped],
  )

  // Tell the cache both tiers are on screen. Eviction must never free a buffer
  // something is drawing, and a tier switch must not have to build one.
  useEffect(() => {
    const near = cargoInputOf(node, 'full')
    const far = cargoInputOf(node, 'simple')
    if (!near || !far) return
    const nearKey = retainCargoGeometry(near)
    const farKey = retainCargoGeometry(far)
    const filmKey = wrapped ? retainFilmGeometry(near) : null
    return () => {
      releaseCargoGeometry(nearKey)
      releaseCargoGeometry(farKey)
      if (filmKey) releaseFilmGeometry(filmKey)
    }
  }, [node, wrapped])

  const frameRef = useRef(0)
  const phase = useMemo(() => hashPhase(node.id), [node.id])

  useFrame(({ camera }) => {
    const mesh = meshRef.current
    if (!mesh || isExporting) return
    frameRef.current += 1
    if ((frameRef.current + phase) % LOD_INTERVAL !== 0) return

    const { elements } = mesh.matrixWorld
    const distanceSq = camera.position.distanceToSquared(
      worldPosition.set(elements[12] ?? 0, elements[13] ?? 0, elements[14] ?? 0),
    )

    // Same distance, both decisions. A second frame loop would compute the same
    // number again on every pallet in the building.
    const film = filmRef.current
    if (film) film.visible = distanceSq <= FILM_CUT_SQ

    const current = detailRef.current
    const next =
      current === 'full'
        ? distanceSq > LOD_FAR_SQ
          ? 'simple'
          : 'full'
        : distanceSq < LOD_NEAR_SQ
          ? 'full'
          : 'simple'
    if (next === current) return
    detailRef.current = next
    const swapped = cargoInputOf(node, next)
    if (!swapped) return
    mesh.geometry = getCargoGeometry(swapped)
    mesh.castShadow = next === 'full'
  })

  if (!geometry) return null

  return (
    <>
      <mesh
        castShadow
        // Never dispose: shared by every pallet that resolved to the same load.
        dispose={null}
        geometry={geometry}
        material={getCargoMaterial()}
        position={[0, y, 0]}
        raycast={NO_RAYCAST}
        receiveShadow
        ref={meshRef}
      />
      {filmGeometry && (
        <mesh
          /**
           * Casts no shadow, and could not cast a correct one if it wanted to:
           * this host's shadow pass sets `scene.overrideMaterial` to one shared
           * material that reads nothing off the object's own, so a transparent
           * caster would lay down a fully solid shadow. Adding `alphaTest` or an
           * `alphaMap` would not save it either — worth writing down, because
           * that is the obvious thing to reach for next.
           */
          castShadow={false}
          dispose={null}
          geometry={filmGeometry}
          material={getFilmMaterial()}
          position={[0, y, 0]}
          raycast={NO_RAYCAST}
          receiveShadow={false}
          ref={filmRef}
          // After every default-0 opaque, so a blended veil is sorted and drawn
          // against a depth buffer that has already been laid down.
          renderOrder={1}
          // Off until the frame loop has judged the distance. Mounted visible,
          // a pallet placed at forty metres would draw a full sleeve for up to
          // eight frames — and an export, which never runs the loop, would draw
          // one at any distance.
          visible={isExporting}
        />
      )}
    </>
  )
}
