'use client'

import {
  type AnyNodeId,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { appearanceKey, useAppearance } from '../appearance'
import { useAdmitted } from '../instancing/admission'
import { SelfDrawnBody } from '../instancing/self-drawn'
import { useCollective } from '../instancing/use-collective'
import { getRackMaterial } from '../rack/materials'
import { useStaticTransform } from '../static-transform'
import {
  driveInGeometryKey,
  getDriveInGeometry,
  releaseDriveInGeometry,
  retainDriveInGeometry,
} from './geometry-builder'
import { totalDepth, totalWidth } from './lanes'
import { hasRightNeighbour } from './neighbours'
import type { DriveInRackNode } from './schema'

/**
 * Distance band at which a lane drops to its reduced tier, squared to keep the
 * per-frame test off the square root.
 *
 * The selective rack's figures, deliberately: a drive-in block usually stands
 * against a wall of selective racking, and two kinds swapping tier at different
 * distances would show a visible line across the building where one family went
 * plain and the other did not.
 */
const LOD_FAR_SQ = 70 * 70
const LOD_NEAR_SQ = 55 * 55

/** Shared by every lane's picking collider, scaled per node. */
const UNIT_COLLIDER = new THREE.BoxGeometry(1, 1, 1)

/**
 * Invisible, and deliberately so. `visible = false` takes the collider out of
 * `WebGLRenderer.projectObject` entirely — no colour pass, no shadow pass —
 * while three's raycaster and R3F's event layer both ignore `visible` and keep
 * hitting it.
 */
const COLLIDER_MATERIAL = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })

/**
 * Mounted through `def.renderer` rather than `def.geometry`, for the reason the
 * selective rack's renderer gives: `<GeometrySystem>` disposes the previous
 * build's children on every rebuild, and the geometry here is shared by every
 * lane of the same shape — so one rebuild anywhere would free the buffer a
 * whole block is drawing from and blank all of it at once.
 *
 * The material is the **rack's**, not a new one. Drive-in steel is the same
 * family reading the same punched-slot atlas, and a second material would mean
 * a second shader compile and a second draw call for every scene that holds
 * both kinds — which is every scene that holds this one.
 */
export default function DriveInRackRenderer({ node }: { node: DriveInRackNode }) {
  // Kademeli mount kapısı. Gövde AYRI bileşende olmak ZORUNDA: pahalı iş onun
  // kancalarında (kayıt, olay bağlama, havuza kayıt, geometri tutma) ve kancalar
  // koşullu çağrılamıyor, yani "sıra bende değil" hâli ancak gövdeyi hiç mount
  // etmeyerek karşılanabilir. Gerekçenin tamamı `../instancing/admission`.
  const admitted = useAdmitted(node.id)
  if (!admitted) return null
  return <DriveInRackRendererBody node={node} />
}

function DriveInRackRendererBody({ node }: { node: DriveInRackNode }) {
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
  // thousands of these doing nothing.
  useStaticTransform(
    registeredRef,
    position,
    rotation,
    live !== undefined || override !== undefined,
  )

  /**
   * Whether the lane on this one's right builds the shared frame line.
   *
   * The index behind this is built once per store write and shared by every
   * lane; the selector narrows it to one boolean, so a lane re-renders only
   * when its *own* answer changes rather than on every scene edit.
   */
  const abutted = useScene((s) => hasRightNeighbour(s.nodes as Record<string, unknown>, node.id))
  const omission = useMemo(() => ({ omitRight: abutted }), [abutted])

  const appearance = useAppearance()
  const material = getRackMaterial(appearance)

  const selected = useViewer((s) => s.selection.selectedIds.includes(node.id as AnyNodeId))
  const drawsSelf = useCollective({
    nodeId: node.id,
    objectRef: registeredRef,
    geometryFor: (tier) => getDriveInGeometry(node, tier, omission),
    keyFor: (tier) => driveInGeometryKey(node, tier, omission),
    materialFor: () => material,
    // The same pool as the selective rack: identical material, and splitting
    // them would double the draw calls of a scene holding both.
    materialKeyFor: () => `rack:${appearanceKey(appearance)}`,
    castsShadow: true,
    farSq: LOD_FAR_SQ,
    nearSq: LOD_NEAR_SQ,
    excluded: selected || live !== undefined || override !== undefined || isExporting,
  })

  /**
   * Tell the cache both tiers are on screen. Eviction must never free a buffer
   * something is drawing, and a tier switch must not have to build one.
   */
  useEffect(() => {
    const near = retainDriveInGeometry(node, 'full', omission)
    const far = retainDriveInGeometry(node, 'simple', omission)
    return () => {
      releaseDriveInGeometry(near)
      releaseDriveInGeometry(far)
    }
  }, [node, omission])

  const width = totalWidth(node)
  const depth = totalDepth(node)

  return (
    <group visible={node.visible !== false} {...handlers}>
      {/* Selection collider. A lane is mostly air — a click aimed at it falls
          between the rails and hits whatever is behind. Outside the registered
          group so the selection outline still traces the real silhouette. */}
      <group position={position} ref={registeredRef} rotation={rotation}>
        {!isExporting && (
          <mesh
            dispose={null}
            geometry={UNIT_COLLIDER}
            material={COLLIDER_MATERIAL}
            position={[0, node.uprightHeight / 2, 0]}
            scale={[width, node.uprightHeight, depth]}
            visible={false}
          />
        )}
        {drawsSelf && (
          <SelfDrawnBody
            farSq={LOD_FAR_SQ}
            geometryFor={(tier) => getDriveInGeometry(node, tier, omission)}
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
