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
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { getCurveGeometry, retainCurveGeometry } from './curve-geometry'
import { colliderSegments } from './curve-metrics'
import type { ConveyorCurveNode } from './curve-schema'
import type { ConveyorDetail } from './geometry-builder'
import { releaseGeometry } from './geometry-builder'
import { hasDownstreamNeighbour } from './line-index'
import { getConveyorMaterial } from './materials'

const NO_RAYCAST = () => {}

/**
 * Distance band at which a module drops to its silhouette, in metres, squared
 * to keep the per-frame test off the square root. Ten metres of hysteresis so a
 * module sitting on the threshold does not swap geometry every time the camera
 * breathes.
 */
const LOD_FAR_SQ = 45 * 45
const LOD_NEAR_SQ = 35 * 35

/** Frames between distance tests, staggered by a per-instance phase so two
 *  hundred modules do not all recompute on the same frame. */
const LOD_INTERVAL = 8

/** Shared by every picking collider, scaled and turned per segment. */
const UNIT_COLLIDER = new THREE.BoxGeometry(1, 1, 1)

/**
 * Invisible, and deliberately so. `visible = false` takes a collider out of
 * `WebGLRenderer.projectObject` entirely — no colour pass, no shadow pass —
 * while three's raycaster and R3F's event layer both ignore `visible` and keep
 * hitting it. A `colorWrite: false` material would still cost a draw call per
 * segment in both passes.
 */
const COLLIDER_MATERIAL = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })

export default function ConveyorCurveRenderer({ node }: { node: ConveyorCurveNode }) {
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

  /** Whether the module standing downstream builds the shared support. One at
   *  every joint, not two — see `../conveyor/parts`. */
  const abutted = useScene((s) => hasDownstreamNeighbour(s.nodes as Record<string, unknown>, node))

  /**
   * The tier this module is drawing. Owned by the frame loop below, and the
   * mounted geometry is read *from* it rather than hardcoded — the rack shipped
   * the hardcoded version and the two paths fought.
   */
  const detailRef = useRef<ConveyorDetail>('full')
  const geometry = useMemo(
    () => getCurveGeometry(node, isExporting ? 'full' : detailRef.current, abutted),
    [node, abutted, isExporting],
  )
  const material = getConveyorMaterial()

  /** Tell the cache this shape is on screen. Eviction must never free a buffer
   *  something is drawing, and this is the only place that knows. */
  useEffect(() => {
    const near = retainCurveGeometry(node, 'full', abutted)
    const far = retainCurveGeometry(node, 'simple', abutted)
    return () => {
      releaseGeometry(near)
      releaseGeometry(far)
    }
  }, [node, abutted])

  const frameRef = useRef(0)
  const phase = useMemo(() => hashPhase(node.id), [node.id])

  useFrame(({ camera }) => {
    const mesh = bodyRef.current
    if (!mesh || isExporting) return
    frameRef.current += 1
    if ((frameRef.current + phase) % LOD_INTERVAL !== 0) return

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
    mesh.geometry = getCurveGeometry(node, next, abutted)
    mesh.castShadow = next === 'full'
  })

  /**
   * The picker follows the arc rather than wrapping it.
   *
   * A bend is mostly air — a click between the rollers would otherwise select
   * the floor — but its bounding box is mostly air *too*, and a single collider
   * would swallow clicks aimed at whatever sits in the corner the bend curls
   * around. These are inside the transformed group, so they inherit the node's
   * position and rotation and only carry their own local offsets.
   */
  const colliders = useMemo(() => colliderSegments(node), [node])
  const colliderHeight = Math.max(0.2, node.transportHeight + node.sideGuideHeight)

  return (
    <group visible={node.visible !== false} {...handlers}>
      <group position={position} ref={registeredRef} rotation={rotation}>
        {!isExporting &&
          colliders.map((segment, index) => (
            <mesh
              dispose={null}
              geometry={UNIT_COLLIDER}
              key={`${segment.rotationY}:${index}`}
              material={COLLIDER_MATERIAL}
              position={[segment.center[0], colliderHeight / 2, segment.center[1]]}
              rotation={[0, segment.rotationY, 0]}
              scale={[segment.size[0], colliderHeight, segment.size[1]]}
              visible={false}
            />
          ))}

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
