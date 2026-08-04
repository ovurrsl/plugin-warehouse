'use client'

import {
  type AnyNodeId,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { appearanceKey, useAppearance } from '../appearance'
import { SelfDrawnBody } from '../instancing/self-drawn'
import { useCollective } from '../instancing/use-collective'
import { boosterGeometryKey, getBoosterGeometry, retainBoosterGeometry } from './booster-geometry'
import { frameWidthM, moduleLengthM } from './booster-metrics'
import type { ConveyorBoosterNode } from './booster-schema'
import { releaseGeometry } from './geometry-builder'
import { hasDownstreamNeighbour } from './line-index'
import { getConveyorMaterial } from './materials'
import { LOD_FAR_SQ, LOD_NEAR_SQ } from './renderer'

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
 * `def.geometry`: `<GeometrySystem>` disposes the previous build's children on
 * every rebuild, and the geometry here is shared by every module of the same
 * shape — so one rebuild anywhere would free the buffer forty other modules are
 * drawing from and blank them all at once.
 *
 * Kolektif çiziciye katılım ve gerekçesi `./renderer.tsx`'te; bu aile aynı
 * deseni izliyor ve LOD eşiklerini oradan paylaşıyor — iki modülün aynı
 * mesafede farklı katmana düşmesi, bir hattın ortasında görünür bir dikiş
 * demek olurdu.
 */
export default function ConveyorBoosterRenderer({ node }: { node: ConveyorBoosterNode }) {
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

  /**
   * Whether the module standing downstream builds the shared support.
   *
   * The catalogue puts one support at every joint, not two, so a run of modules
   * must not each build one — every seam would carry doubled steel, a doubled
   * shadow and z-fighting on every coincident face.
   */
  const abutted = useScene((s) => hasDownstreamNeighbour(s.nodes as Record<string, unknown>, node))

  const appearance = useAppearance()
  const material = getConveyorMaterial(appearance)

  const selected = useViewer((s) => s.selection.selectedIds.includes(node.id as AnyNodeId))
  const drawsSelf = useCollective({
    nodeId: node.id,
    objectRef: registeredRef,
    geometryFor: (tier) => getBoosterGeometry(node, tier, abutted),
    keyFor: (tier) => boosterGeometryKey(node, tier, abutted),
    materialFor: () => material,
    materialKeyFor: () => `conveyor:${appearanceKey(appearance)}`,
    castsShadow: true,
    farSq: LOD_FAR_SQ,
    nearSq: LOD_NEAR_SQ,
    excluded: selected || live !== undefined || override !== undefined || isExporting,
  })

  /**
   * Tell the cache this shape is on screen. The cache is bounded — a slider
   * scrub mints a geometry per step — and eviction must never free a buffer
   * something is drawing. This is the only place that knows.
   */
  useEffect(() => {
    const near = retainBoosterGeometry(node, 'full', abutted)
    const far = retainBoosterGeometry(node, 'simple', abutted)
    return () => {
      releaseGeometry(near)
      releaseGeometry(far)
    }
  }, [node, abutted])

  const length = moduleLengthM(node)
  const width = frameWidthM(node)
  // The collider wraps the bed and the space a box travelling on it occupies —
  // not the legs, which is where nobody aims. A conveyor is mostly air, so
  // without one a click lands between the rollers and selects the floor.
  const colliderHeight = Math.max(0.2, node.transportHeight + node.sideGuideHeight)

  return (
    <group visible={node.visible !== false} {...handlers}>
      <group position={position} ref={registeredRef} rotation={rotation}>
        {!isExporting && (
          <mesh
            dispose={null}
            geometry={UNIT_COLLIDER}
            material={COLLIDER_MATERIAL}
            position={[0, colliderHeight / 2, 0]}
            scale={[length, colliderHeight, width]}
            visible={false}
          />
        )}
        {drawsSelf && (
          <SelfDrawnBody
            farSq={LOD_FAR_SQ}
            geometryFor={(tier) => getBoosterGeometry(node, tier, abutted)}
            isExporting={isExporting}
            materialFor={() => material}
            nearSq={LOD_NEAR_SQ}
            nodeId={node.id}
          />
        )}
      </group>
    </group>
  )
}
