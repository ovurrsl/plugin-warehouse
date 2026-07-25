'use client'

import {
  type AnyNodeId,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useMemo, useRef } from 'react'
import type { Object3D } from 'three'
import { getPalletGeometry } from './geometry-builder'
import { getPalletMaterial } from './materials'
import { specOf } from './presets'
import type { PalletNode } from './schema'

const NO_RAYCAST = () => {}

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

  const spec = specOf(node.preset)
  const geometry = useMemo(() => getPalletGeometry(node.preset), [node.preset])
  const material = getPalletMaterial()

  const loadHeight = Math.max(0, node.loadHeight ?? 0)
  const totalHeight = spec.height + loadHeight

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
          receiveShadow
        />
        {loadHeight > 0 && (
          <PalletLoad height={loadHeight} length={spec.length} y={spec.height} width={spec.width} />
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
    <mesh castShadow position={[0, y + height / 2, 0]} raycast={NO_RAYCAST} receiveShadow>
      <boxGeometry args={[length - inset, height, width - inset]} />
      <meshStandardMaterial color="#c8b394" metalness={0} roughness={0.85} />
    </mesh>
  )
}
