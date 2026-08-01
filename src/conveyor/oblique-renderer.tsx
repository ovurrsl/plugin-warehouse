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
import type { ConveyorDetail } from './geometry-builder'
import { releaseGeometry } from './geometry-builder'
import { hasDownstreamNeighbour } from './line-index'
import { getConveyorMaterial } from './materials'
import { getObliqueGeometry, retainObliqueGeometry } from './oblique-geometry'
import {
  branchCentreLocal,
  branchHeadingRad,
  branchLengthM,
  branchWidthM,
  mainWidthM,
  moduleLengthM,
} from './oblique-metrics'
import type { ConveyorObliqueNode } from './oblique-schema'

const NO_RAYCAST = () => {}

/** Distance band at which a module drops to its silhouette, squared to keep the
 *  per-frame test off the square root. Ten metres of hysteresis so a module on
 *  the threshold does not swap geometry every time the camera breathes. */
const LOD_FAR_SQ = 45 * 45
const LOD_NEAR_SQ = 35 * 35

/** Frames between distance tests, staggered by a per-instance phase. */
const LOD_INTERVAL = 8

const UNIT_COLLIDER = new THREE.BoxGeometry(1, 1, 1)

/**
 * Invisible, and deliberately so. `visible = false` takes a collider out of
 * `WebGLRenderer.projectObject` entirely — no colour pass, no shadow pass —
 * while three's raycaster and R3F's event layer both ignore `visible`.
 */
const COLLIDER_MATERIAL = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })

export default function ConveyorObliqueRenderer({ node }: { node: ConveyorObliqueNode }) {
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

  const abutted = useScene((s) => hasDownstreamNeighbour(s.nodes as Record<string, unknown>, node))

  const detailRef = useRef<ConveyorDetail>('full')
  const geometry = useMemo(
    () => getObliqueGeometry(node, isExporting ? 'full' : detailRef.current, abutted),
    [node, abutted, isExporting],
  )
  const material = getConveyorMaterial()

  useEffect(() => {
    const near = retainObliqueGeometry(node, 'full', abutted)
    const far = retainObliqueGeometry(node, 'simple', abutted)
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
    mesh.geometry = getObliqueGeometry(node, next, abutted)
  })

  /**
   * Two pickers, and the second one is turned.
   *
   * An oblique's steel is a Y, and the rectangle containing it is mostly the
   * wedge between the two beds — which in a real layout is where the line the
   * branch feeds runs. One box would swallow every click aimed at it.
   */
  const colliders = useMemo(() => {
    const [branchX, branchZ] = branchCentreLocal(node)
    return {
      height: Math.max(0.2, node.transportHeight),
      boxes: [
        {
          center: [0, 0] as [number, number],
          size: [moduleLengthM(node), mainWidthM(node)] as [number, number],
          rotationY: 0,
        },
        {
          center: [branchX, branchZ] as [number, number],
          size: [branchLengthM(node), branchWidthM(node)] as [number, number],
          rotationY: branchHeadingRad(node),
        },
      ],
    }
  }, [node])

  return (
    <group visible={node.visible !== false} {...handlers}>
      <group position={position} ref={registeredRef} rotation={rotation}>
        {!isExporting &&
          colliders.boxes.map((box) => (
            <mesh
              dispose={null}
              geometry={UNIT_COLLIDER}
              key={`${box.center[0]}:${box.center[1]}`}
              material={COLLIDER_MATERIAL}
              position={[box.center[0], colliders.height / 2, box.center[1]]}
              rotation={[0, box.rotationY, 0]}
              scale={[box.size[0], colliders.height, box.size[1]]}
              visible={false}
            />
          ))}

        <mesh
          castShadow
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
