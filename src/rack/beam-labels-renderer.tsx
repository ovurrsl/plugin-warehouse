import { useFrame } from '@react-three/fiber'
import React, { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import {
  ATLAS_COLS,
  ATLAS_ROWS,
  getMasterLabelAtlas,
  MasterLabelAtlas,
} from './beam-label-atlas'
import { createBeamLipLabelMaterial } from './beam-label-material'
import type { PalletRackNode } from './schema'
import { levelBeamHeight, levelSurfaceY, palletSlotsOf } from './slots'

export const LABEL_WIDTH = 0.15
export const LABEL_HEIGHT = 0.04
export const CULL_DISTANCE_FAR = 25
export const CULL_DISTANCE_NEAR = 20

const scratchMatrix = new THREE.Matrix4()
const scratchPosition = new THREE.Vector3()
const scratchQuaternion = new THREE.Quaternion()
const scratchScale = new THREE.Vector3(1, 1, 1)
const scratchZeroScale = new THREE.Vector3(0, 0, 0)
const scratchCameraPos = new THREE.Vector3()
const rackWorldPos = new THREE.Vector3()
export const ROTATION_180_Y = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 1, 0),
  Math.PI,
)

export interface BeamLipLabelMeshProps {
  nodes: PalletRackNode[]
  atlas?: MasterLabelAtlas
  visible?: boolean
  cullingDistance?: number
  coordinateSpace?: 'local' | 'world'
}

// Module-level scratch map for distance culling in multi-node world mode (eliminates per-frame GC allocations)
const scratchRackDistances = new Map<string, number>()

interface SlotInstanceRecord {
  rackId: string
  rackPos: [number, number, number]
  worldMatrix: THREE.Matrix4
  instanceIndex: number
}

export function BeamLipLabelMesh({
  nodes,
  atlas = getMasterLabelAtlas(),
  visible = true,
  cullingDistance = CULL_DISTANCE_FAR,
  coordinateSpace = 'local',
}: BeamLipLabelMeshProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const slotRecordsRef = useRef<SlotInstanceRecord[]>([])
  const culledRef = useRef<boolean[]>([])

  // 1. Total slot capacity
  const totalSlotCapacity = useMemo(() => {
    let count = 0
    for (const node of nodes) {
      count += palletSlotsOf(node).length
    }
    return Math.max(1, count)
  }, [nodes])

  // 2. Base geometry with UV offset attribute
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(LABEL_WIDTH, LABEL_HEIGHT)
    const uvOffsets = new Float32Array(totalSlotCapacity * 2)
    geo.setAttribute('aUvOffset', new THREE.InstancedBufferAttribute(uvOffsets, 2))
    return geo
  }, [totalSlotCapacity])

  // 3. Atlas material
  const material = useMemo(() => {
    return createBeamLipLabelMaterial(atlas.texture, ATLAS_COLS, ATLAS_ROWS)
  }, [atlas])

  // 4. Populate instance matrices and UV offsets
  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return

    const uvAttribute = geometry.getAttribute('aUvOffset') as THREE.InstancedBufferAttribute
    const uvArray = uvAttribute.array as Float32Array

    let instanceIdx = 0
    const records: SlotInstanceRecord[] = []

    for (const node of nodes) {
      const slots = palletSlotsOf(node)
      const rackPos = node.position ?? [0, 0, 0]
      const rackRot = node.rotation ?? [0, 0, 0]

      const rackMatrix =
        coordinateSpace === 'world'
          ? scratchMatrix
              .makeRotationFromEuler(new THREE.Euler(rackRot[0], rackRot[1], rackRot[2]))
              .setPosition(rackPos[0], rackPos[1], rackPos[2])
          : null

      for (const slot of slots) {
        const cellIdx = atlas.getOrCreateCell({
          address: slot.id,
          levelLetter: slot.levelLetter ?? 'A',
        })
        const [uOffset, vOffset] = atlas.getCellUvOffset(cellIdx)

        uvArray[instanceIdx * 2] = uOffset
        uvArray[instanceIdx * 2 + 1] = vOffset

        const beamH = levelBeamHeight(node, slot.level)
        const beamY =
          slot.level === 0 ? 0.08 : levelSurfaceY(node, slot.level) - beamH / 2
        const isRear = slot.bayDepth === 2 && node.accessMode === 'dual-facing'

        const localX = slot.localPosition[0]
        const localY = beamY
        const localZ = isRear
          ? slot.localPosition[2] - node.depth / 2 - 0.001
          : slot.localPosition[2] + node.depth / 2 + 0.001

        scratchPosition.set(localX, localY, localZ)
        scratchQuaternion.set(0, 0, 0, 1)
        if (isRear) scratchQuaternion.multiply(ROTATION_180_Y)

        const instanceMatrix = new THREE.Matrix4().compose(
          scratchPosition,
          scratchQuaternion,
          scratchScale,
        )
        if (rackMatrix) {
          instanceMatrix.premultiply(rackMatrix)
        }

        mesh.setMatrixAt(instanceIdx, instanceMatrix)

        records.push({
          rackId: node.id,
          rackPos: [rackPos[0], rackPos[1], rackPos[2]],
          worldMatrix: instanceMatrix.clone(),
          instanceIndex: instanceIdx,
        })

        instanceIdx++
      }
    }

    mesh.count = instanceIdx
    mesh.instanceMatrix.needsUpdate = true
    uvAttribute.needsUpdate = true
    mesh.computeBoundingSphere()
    slotRecordsRef.current = records
    culledRef.current = new Array(instanceIdx).fill(false)
  }, [nodes, atlas, geometry, coordinateSpace])

  const rackHash = useMemo(() => {
    const firstId = nodes[0]?.id ?? ''
    let hash = 0
    for (let i = 0; i < firstId.length; i++) {
      hash = ((hash << 5) - hash) + firstId.charCodeAt(i)
      hash |= 0
    }
    return Math.abs(hash)
  }, [nodes])

  // 5. Distance culling loop (hysteresis 20-25m, staggered 1 in 8 frames for massive CPU relief)
  useFrame(({ camera, clock }) => {
    const mesh = meshRef.current
    if (!mesh || !visible) return

    const records = slotRecordsRef.current
    if (records.length === 0) return

    const tick = Math.floor(clock.elapsedTime * 60)
    if ((tick + rackHash) % 8 !== 0) return

    scratchCameraPos.copy(camera.position)
    const cullDistSq = cullingDistance * cullingDistance
    const nearDistSq = CULL_DISTANCE_NEAR * CULL_DISTANCE_NEAR

    // FAST PATH FOR LOCAL SINGLE-RACK MOUNTING:
    // When mounted inside a rack's group, all slots share the same rack position.
    // Toggle mesh.visible directly: 0 GC allocations, 0 instance matrix writes, 0 PCIe traffic!
    if (coordinateSpace === 'local') {
      const firstRecord = records[0]
      if (!firstRecord) return
      rackWorldPos.set(
        firstRecord.rackPos[0],
        firstRecord.rackPos[1],
        firstRecord.rackPos[2],
      )
      const dSq = scratchCameraPos.distanceToSquared(rackWorldPos)
      if (mesh.visible && dSq > cullDistSq) {
        mesh.visible = false
      } else if (!mesh.visible && dSq < nearDistSq) {
        mesh.visible = true
      }
      return
    }

    // MULTI-RACK WORLD SPACE PATH:
    // Uses persistent scratchRackDistances map instead of allocating new Map() per frame
    let matrixNeedsUpdate = false
    scratchRackDistances.clear()

    for (let i = 0; i < records.length; i++) {
      const record = records[i]!
      let dSq = scratchRackDistances.get(record.rackId)
      if (dSq === undefined) {
        rackWorldPos.set(record.rackPos[0], record.rackPos[1], record.rackPos[2])
        dSq = scratchCameraPos.distanceToSquared(rackWorldPos)
        scratchRackDistances.set(record.rackId, dSq)
      }

      const isCulled = culledRef.current?.[record.instanceIndex] ?? false
      // Hysteresis threshold
      if (!isCulled && dSq > cullDistSq) {
        // Cull: scale to 0
        scratchMatrix.copy(record.worldMatrix).scale(scratchZeroScale)
        mesh.setMatrixAt(record.instanceIndex, scratchMatrix)
        if (culledRef.current) culledRef.current[record.instanceIndex] = true
        matrixNeedsUpdate = true
      } else if (isCulled && dSq < nearDistSq) {
        // Uncull: restore original worldMatrix
        mesh.setMatrixAt(record.instanceIndex, record.worldMatrix)
        if (culledRef.current) culledRef.current[record.instanceIndex] = false
        matrixNeedsUpdate = true
      }
    }

    if (matrixNeedsUpdate) {
      mesh.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, totalSlotCapacity]}
      frustumCulled={true}
      visible={visible}
    />
  )
}

/**
 * Component mountable on an individual PalletRack node.
 * Uses the shared MasterLabelAtlas to batch all slots for that rack into a single InstancedMesh.
 */
export function BeamLipBarcodeLabels({
  node,
  visible = true,
}: {
  node: PalletRackNode
  visible?: boolean
}) {
  const nodes = useMemo(() => [node], [node])
  return <BeamLipLabelMesh coordinateSpace="local" nodes={nodes} visible={visible} />
}
