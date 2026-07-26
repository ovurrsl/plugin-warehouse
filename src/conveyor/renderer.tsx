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
import * as THREE from 'three'
import type { ConveyorDetail } from './geometry-builder'
import {
  getConveyorGeometry,
  releaseConveyorGeometry,
  retainConveyorGeometry,
} from './geometry-builder'
import { getConveyorMaterial } from './materials'
import { frameWidthM, moduleLengthM } from './metrics'
import type { ConveyorRollerNode } from './schema'

const NO_RAYCAST = () => {}

/**
 * Distance band at which a module drops to its silhouette, in metres, squared
 * to keep the per-frame test off the square root.
 *
 * The two bounds differ on purpose: a single threshold makes a module sitting
 * exactly on it swap geometry every time the camera breathes, which reads as
 * flicker. Ten metres of hysteresis means it has to travel to change tier.
 */
const LOD_FAR_SQ = 45 * 45
const LOD_NEAR_SQ = 35 * 35

/**
 * Frames between distance tests, and how the modules are spread across them.
 * Staggering by a per-instance phase keeps two hundred modules from all
 * recomputing on the same frame, which is what turns a small cost into a
 * periodic hitch.
 */
const LOD_INTERVAL = 8

/** Shared by every module's picking collider, scaled per node. */
const UNIT_COLLIDER = new THREE.BoxGeometry(1, 1, 1)

/**
 * Invisible, and deliberately so. `visible = false` takes the collider out of
 * `WebGLRenderer.projectObject` entirely — no colour pass, no shadow pass —
 * while three's raycaster and R3F's event layer both ignore `visible` and keep
 * hitting it. A `colorWrite: false` material still costs a draw call per module
 * in both passes, which on two hundred modules is two hundred draws that paint
 * nothing.
 */
const COLLIDER_MATERIAL = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })

/**
 * Mounted through `def.renderer: { kind: 'parametric' }` rather than
 * `def.geometry`, for the reason the rack's renderer gives: `<GeometrySystem>`
 * disposes the previous build's children on every rebuild, and the geometry
 * here is shared by every module of the same shape — so one rebuild anywhere
 * would free the buffer forty other modules are drawing from and blank them all
 * at once.
 */
export default function ConveyorRollerRenderer({ node }: { node: ConveyorRollerNode }) {
  const registeredRef = useRef<THREE.Object3D>(null!)
  const bodyRef = useRef<THREE.Mesh>(null)
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
   * Whether the module standing downstream builds the shared support.
   *
   * Always false until the port index lands — a module with no neighbours
   * builds both its supports, which is correct for a lone module and merely
   * generous for an abutting one. Wiring it is increment 2; the geometry key
   * and the parts list already take it, so nothing here has to change.
   */
  const abutted = false

  /**
   * The tier this module is drawing. Owned by the frame loop below, and the
   * mounted geometry is read *from* it rather than hardcoded — the rack shipped
   * the hardcoded version and the two paths fought: R3F diffs props by
   * reference, so the memo clobbered the imperative swap whenever it produced a
   * different buffer, while the ref still said `simple` and the guard blocked
   * re-demotion until the camera made a full round trip.
   */
  const detailRef = useRef<ConveyorDetail>('full')
  const geometry = useMemo(
    () => getConveyorGeometry(node, isExporting ? 'full' : detailRef.current, abutted),
    [node, abutted, isExporting],
  )
  const material = getConveyorMaterial()

  /**
   * Tell the cache this shape is on screen. The cache is bounded — a slider
   * scrub mints a geometry per step — and eviction must never free a buffer
   * something is drawing. This is the only place that knows.
   */
  useEffect(() => {
    const near = retainConveyorGeometry(node, 'full', abutted)
    const far = retainConveyorGeometry(node, 'simple', abutted)
    return () => {
      releaseConveyorGeometry(near)
      releaseConveyorGeometry(far)
    }
  }, [node, abutted])

  const frameRef = useRef(0)
  const phase = useMemo(() => hashPhase(node.id), [node.id])

  useFrame(({ camera }) => {
    const mesh = bodyRef.current
    if (!mesh || isExporting) return
    frameRef.current += 1
    if ((frameRef.current + phase) % LOD_INTERVAL !== 0) return

    // Straight off the world matrix R3F has already updated this frame.
    // `getWorldPosition` would walk and re-multiply the whole ancestor chain per
    // module per check, which is the actual cost at warehouse scale.
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
    mesh.geometry = getConveyorGeometry(node, next, abutted)
    mesh.castShadow = next === 'full'
  })

  const length = moduleLengthM(node)
  const width = frameWidthM(node)
  // The collider wraps the bed and the space a box travelling on it occupies —
  // not the legs, which is where nobody aims. A conveyor is mostly air, so
  // without one a click lands between the rollers and selects the floor.
  const colliderHeight = Math.max(0.2, node.transportHeight + node.sideGuideHeight)

  return (
    <group visible={node.visible !== false} {...handlers}>
      {!isExporting && (
        <mesh
          dispose={null}
          geometry={UNIT_COLLIDER}
          material={COLLIDER_MATERIAL}
          position={[position[0], position[1] + colliderHeight / 2, position[2]]}
          rotation={rotation}
          scale={[length, colliderHeight, width]}
          visible={false}
        />
      )}

      <group position={position} ref={registeredRef} rotation={rotation}>
        <mesh
          castShadow={isExporting || detailRef.current === 'full'}
          // Never dispose: shared by every module of this shape.
          dispose={null}
          geometry={geometry}
          material={material}
          raycast={NO_RAYCAST}
          ref={bodyRef}
          receiveShadow
        />
      </group>
    </group>
  )
}

const worldPosition = new THREE.Vector3()

/** A stable 0..LOD_INTERVAL-1 bucket for an id. FNV-1a — cheap, and identical
 *  for the same module on every mount, so it survives a remount. */
function hashPhase(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % LOD_INTERVAL
}
