'use client'

import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useWarehouseStore } from '../store'
import {
  buildNetwork,
  FLOW_BOX_M,
  type FlowBox,
  poseOf,
  publishLifting,
  step,
} from './flow-simulation'

/**
 * Every box on every conveyor in the scene, in one draw call.
 *
 * Mounted through `def.system`, which the host renders **once per kind** rather
 * than once per node (`registered-systems.tsx`) — so this is a scene-wide
 * singleton, and there is exactly one of it however many conveyors are placed.
 * That is the only place in the plugin contract where a whole-scene simulation
 * can live, and it is the reason boxes can be simulated at all without a
 * `plugin.systems` extension the v1 surface does not have.
 *
 * The host documents this pattern itself — a collective `InstancedMesh` driven
 * by a system, with per-node meshes reduced to invisible proxies — and keeps
 * `isExporting` for it, so a bake pass can be told to emit real geometry. Boxes
 * are the opposite case: they are *not* part of the model, so they are hidden
 * during an export rather than materialised.
 *
 * Plain `THREE.InstancedMesh`, not a third-party instancing package: six
 * hundred identical boxes need one geometry, one material and one matrix
 * buffer, and nothing here needs per-instance LOD or sorting.
 */

/** Matches `MAX_BOXES` in the simulation: the buffer is allocated once and its
 *  `count` moved, never reallocated per frame. */
const CAPACITY = 600

/** A frame longer than this is a tab that was in the background. Advancing by
 *  the real elapsed time would teleport every box across the building. */
const MAX_STEP_S = 0.1

export default function ConveyorFlowSystem() {
  const running = useWarehouseStore((s) => s.flowRunning)
  const isExporting = useViewer(
    (s) => (s as typeof s & { isExporting?: boolean }).isExporting ?? false,
  )
  // The store replaces `nodes` on every write, so this re-runs exactly when the
  // modules change — and never during a drag, which does not touch the store.
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)
  const network = useMemo(() => buildNetwork(nodes), [nodes])

  const meshRef = useRef<THREE.InstancedMesh>(null)
  const boxesRef = useRef<FlowBox[]>([])
  const seedRef = useRef(1)

  const geometry = useMemo(() => new THREE.BoxGeometry(...FLOW_BOX_M), [])
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        // Kraft, so a box reads as goods rather than as machinery — the whole
        // conveyor family is blue steel and zinc.
        color: '#c8a06a',
        metalness: 0,
        roughness: 0.85,
      }),
    [],
  )

  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  // A network with nothing to release into is a network with no boxes; drop
  // them rather than leaving the last frame's stranded on deleted modules.
  useEffect(() => {
    if (!running) boxesRef.current = []
  }, [running])

  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh) return

    if (!running || isExporting) {
      mesh.count = 0
      publishLifting(network, [])
      return
    }

    boxesRef.current = step(network, boxesRef.current, Math.min(delta, MAX_STEP_S), () => {
      seedRef.current += 1
      return seedRef.current
    })

    publishLifting(network, boxesRef.current)

    let index = 0
    for (const box of boxesRef.current) {
      if (index >= CAPACITY) break
      const pose = poseOf(network, box)
      if (!pose) continue
      matrix.compose(
        position.set(pose.position[0], pose.position[1], pose.position[2]),
        quaternion.setFromAxisAngle(UP, pose.heading),
        SCALE,
      )
      mesh.setMatrixAt(index, matrix)
      index += 1
    }

    mesh.count = index
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      args={[geometry, material, CAPACITY]}
      castShadow
      // Boxes are a simulation, not scene content: they must never be pickable,
      // or a click meant for the conveyor under them lands on a box that will
      // not be there next frame.
      raycast={NO_RAYCAST}
      ref={meshRef}
    />
  )
}

const NO_RAYCAST = () => {}
const UP = new THREE.Vector3(0, 1, 0)
const SCALE = new THREE.Vector3(1, 1, 1)
const matrix = new THREE.Matrix4()
const position = new THREE.Vector3()
const quaternion = new THREE.Quaternion()
