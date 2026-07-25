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

  // Exporting must not bake a distance-dependent tier into the file, so the
  // full mesh is the one that mounts and the swap below is skipped.
  const detailRef = useRef<RackDetail>('full')
  const geometry = useMemo(() => getRackGeometry(node, 'full'), [node])
  const material = getRackMaterial()

  useFrame(({ camera }) => {
    const mesh = steelRef.current
    if (!mesh || isExporting) return
    const distanceSq = camera.position.distanceToSquared(mesh.getWorldPosition(worldPosition))
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
    mesh.geometry = getRackGeometry(node, next)
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
          position={[position[0], position[1] + node.uprightHeight / 2, position[2]]}
          rotation={rotation}
        >
          <boxGeometry args={[width, node.uprightHeight, depth]} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} />
        </mesh>
      )}

      <group position={position} ref={registeredRef} rotation={rotation}>
        <mesh
          castShadow
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
      if (slotDraw(slot.id) >= node.ghostFill) continue
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
