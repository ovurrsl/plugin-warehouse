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
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { getPalletGeometry } from '../pallet/geometry-builder'
import { getPalletMaterial } from '../pallet/materials'
import { specOf } from '../pallet/presets'
import { getRackGeometry, type RackDetail } from './geometry-builder'
import { getRackMaterial } from './materials'
import { hasRightNeighbour } from './neighbours'
import { occupiedSlots, slotDraw } from './occupancy'
import type { PalletRackNode } from './schema'
import { palletSlotsOf, totalDepth, totalWidth } from './slots'

const NO_RAYCAST = () => {}

/**
 * Distance band at which a rack drops to its silhouette, in metres, squared to
 * keep the per-frame test off the square root.
 *
 * The two bounds differ on purpose. A single threshold makes a rack sitting
 * exactly on it swap geometry every time the camera breathes, which reads as
 * flicker; widening the band means a rack must travel ten metres to change
 * tier, so no amount of jitter can oscillate it.
 */
const LOD_FAR_SQ = 45 * 45
const LOD_NEAR_SQ = 35 * 35

/**
 * Frames between distance tests, and how the racks are spread across them.
 *
 * The test is cheap but there is one per rack per frame, and a warehouse has
 * thousands. Testing every eighth frame is imperceptible at ten metres of
 * hysteresis — a camera would have to cross the band in under a tenth of a
 * second — and staggering by a per-instance phase keeps a thousand racks from
 * all recomputing on the same frame, which is what turns a small cost into a
 * periodic hitch.
 */
const LOD_INTERVAL = 8

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
  const steelRef = useRef<THREE.Mesh>(null)
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

  /**
   * Whether the bay standing on this one's right builds the shared frame.
   *
   * The index behind this is built once per store write and shared by every
   * rack; the selector narrows it to one boolean, so a rack re-renders only when
   * its *own* answer changes rather than on every scene edit. See
   * `./neighbours`.
   */
  const abutted = useScene((s) => hasRightNeighbour(s.nodes as Record<string, unknown>, node.id))

  /**
   * The tier this rack is drawing. Owned by the frame loop below — and the
   * mounted geometry has to be read *from* it, not hardcoded.
   *
   * It was hardcoded to `'full'`, and the two paths fought. R3F diffs props by
   * reference, so the memo only clobbered the imperative swap when it produced a
   * different buffer — which is exactly what happens when `abutted` flips. So a
   * distant rack that had dropped to its silhouette was handed the full mesh
   * back the moment a bay was placed against it, while `detailRef` still said
   * `'simple'` and the `next === current` guard blocked re-demotion until the
   * camera made a full round trip through the hysteresis band. Multiplying a run
   * walked bay after bay into the full tier, and LOD is the only thing paying
   * for two thousand nodes.
   *
   * Exporting must not bake a distance-dependent tier into the file, so it pins
   * the full mesh and the swap below is skipped.
   */
  const detailRef = useRef<RackDetail>('full')
  const geometry = useMemo(
    () => getRackGeometry(node, isExporting ? 'full' : detailRef.current, abutted),
    [node, abutted, isExporting],
  )
  const material = getRackMaterial()

  const frameRef = useRef(0)
  // Spread the checks across the interval so the racks do not all land on the
  // same frame. Derived from the id rather than counted, so it survives a
  // remount and needs no shared state.
  const phase = useMemo(() => hashPhase(node.id), [node.id])

  useFrame(({ camera }) => {
    const mesh = steelRef.current
    if (!mesh || isExporting) return
    frameRef.current += 1
    if ((frameRef.current + phase) % LOD_INTERVAL !== 0) return

    // Straight off the world matrix R3F has already updated this frame.
    // `getWorldPosition` would walk and re-multiply the whole ancestor chain
    // per rack per check, which is the actual cost at warehouse scale.
    const { elements } = mesh.matrixWorld
    const distanceSq = camera.position.distanceToSquared(
      worldPosition.set(elements[12] ?? 0, elements[13] ?? 0, elements[14] ?? 0),
    )
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
    mesh.geometry = getRackGeometry(node, next, abutted)
    // A rack far enough away to lose its bracing is far enough that its shadow
    // is a smudge, and every caster is a second draw call in the shadow pass.
    mesh.castShadow = next === 'full'
  })

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
        <mesh
          // Derived from the same tier as the geometry, for the same reason: a
          // hardcoded `castShadow` re-promoted a demoted rack to a caster on the
          // next re-render, and every caster is a second draw in the shadow pass.
          castShadow={isExporting || detailRef.current === 'full'}
          // Never dispose: shared by every rack of this shape.
          dispose={null}
          geometry={geometry}
          material={material}
          raycast={NO_RAYCAST}
          ref={steelRef}
          receiveShadow
        />
        {node.ghostFill > 0 && <GhostStock node={node} />}
      </group>
    </group>
  )
}

const worldPosition = new THREE.Vector3()

/** A stable 0..LOD_INTERVAL-1 bucket for an id. FNV-1a, the same hash the ghost
 *  fill uses — cheap, and identical for the same rack on every mount. */
function hashPhase(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % LOD_INTERVAL
}

/**
 * Illustrative stock in slots no real pallet occupies.
 *
 * Instanced, because a filled 10-bay rack is a few hundred pallets and drawing
 * them individually would undo everything the merged steel geometry bought.
 * Both meshes reuse the pallet node's own cached geometry and material, so a
 * scene holding real pallets *and* ghost stock still compiles one pallet shader.
 */
function GhostStock({ node }: { node: PalletRackNode }) {
  const palletRef = useRef<THREE.InstancedMesh>(null)
  const loadRef = useRef<THREE.InstancedMesh>(null)

  // One shared index for the whole scene rather than a scan per rack — see
  // `occupancy.ts`. Selecting the set here keeps this rack re-rendering only
  // when its own occupancy changes.
  const occupied = useScene((s) => occupiedSlots(s.nodes as Record<string, unknown>, node.id))

  const spec = specOf(node.palletPreset)
  const geometry = useMemo(() => getPalletGeometry(node.palletPreset), [node.palletPreset])
  const material = getPalletMaterial()

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
    placements.forEach((placement, index) => {
      const [x, y, z] = placement.position
      matrix.makeTranslation(x, y, z)
      pallets.setMatrixAt(index, matrix)
      matrix.makeTranslation(x, y + spec.height + placement.load / 2, z)
      matrix.scale(new THREE.Vector3(spec.length - 0.04, placement.load, spec.width - 0.04))
      loads.setMatrixAt(index, matrix)
    })
    pallets.instanceMatrix.needsUpdate = true
    loads.instanceMatrix.needsUpdate = true
  }, [placements, spec.height, spec.length, spec.width])

  if (placements.length === 0) return null

  return (
    <>
      <instancedMesh
        args={[geometry, material, placements.length]}
        castShadow
        dispose={null}
        // Remounted when the count changes: an InstancedMesh fixes its buffer
        // size at construction, so reusing one across a different count would
        // silently draw the wrong number of pallets.
        key={`pallets-${placements.length}`}
        raycast={NO_RAYCAST}
        ref={palletRef}
      />
      <instancedMesh
        args={[UNIT_BOX, LOAD_MATERIAL, placements.length]}
        castShadow
        dispose={null}
        key={`loads-${placements.length}`}
        raycast={NO_RAYCAST}
        ref={loadRef}
      />
    </>
  )
}

/** Unit cube scaled per instance, so every ghost load shares one buffer. */
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)
const LOAD_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#c8b394',
  metalness: 0,
  roughness: 0.85,
})
