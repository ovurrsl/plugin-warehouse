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
import { useAppearance } from '../appearance'
import { Collider } from '../collider'
import { useFrozenMatrix } from '../frozen-matrix'
import { useAdmitted } from '../instancing/admission'
import { useStaticTransform } from '../static-transform'
import { lodScaleSq, useWarehouseStore } from '../store'
import type { ConveyorDetail } from './parts'
import {
  getSpiralSlatGeometry,
  getSpiralStaticGeometry,
  releaseGeometry,
  retainGeometry,
  spiralSlatKey,
  spiralStaticKey,
} from './spiral-geometry'
import { getSpiralCageMaterial, getSpiralMaterial } from './spiral-materials'
import {
  beltSpeedMS,
  cageRadiusM,
  columnRadiusM,
  entryHeightM,
  footprintM,
  handednessSign,
  helixRadiusM,
  overallHeightM,
  pitchM,
  slatStepRad,
} from './spiral-metrics'
import type { ConveyorSpiralNode } from './spiral-schema'

const NO_RAYCAST = () => {}

const LOD_FAR_SQ = 55 * 55
const LOD_NEAR_SQ = 42 * 42
const LOD_INTERVAL = 8
const TWO_PI = Math.PI * 2

const worldPosition = new THREE.Vector3()

function hashPhase(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % LOD_INTERVAL
}

/** Merkez kolon ve kafes birim silindir — birleştirilmiş kutu üreticisi
 *  silindir emitleyemiyor, o yüzden düğüm başına ölçekleniyorlar. */
const COLUMN_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 24, 1)
const CAGE_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true)

/**
 * Sarmal konveyör. Statik iskelet + vida hareketiyle dönen slat grubu; merkez
 * kolon ve kafes düğüm başına ölçekli birim silindir.
 *
 * Kolektif havuza GİRMEZ (`instancing/coverage.test.ts`): slat grubu her karede
 * kendi vida pozunu taşıyor, donmuş kolektif matris bunu tutamaz.
 */
export default function SpiralRenderer({ node }: { node: ConveyorSpiralNode }) {
  const admitted = useAdmitted(node.id)
  if (!admitted) return null
  return <SpiralBody node={node} />
}

function SpiralBody({ node }: { node: ConveyorSpiralNode }) {
  const registeredRef = useRef<THREE.Object3D>(null!)
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id as AnyNodeId, node.type, registeredRef)

  const wrapperRef = useRef<THREE.Object3D>(null)
  useFrozenMatrix(wrapperRef)

  const isExporting = useViewer(
    (s) => (s as typeof s & { isExporting?: boolean }).isExporting ?? false,
  )
  const flowRunning = useWarehouseStore((s) => s.flowRunning)

  const live = useLiveTransforms((s) => s.get(node.id))
  const override = useLiveNodeOverrides((s) => s.overrides.get(node.id))
  const overridePosition = override?.position as [number, number, number] | undefined
  const overrideRotation = override?.rotation as [number, number, number] | undefined

  const position = live?.position ?? overridePosition ?? node.position ?? [0, 0, 0]
  const baseRotation = overrideRotation ?? node.rotation ?? [0, 0, 0]
  const rotation: [number, number, number] = live
    ? [baseRotation[0], live.rotation, baseRotation[2]]
    : baseRotation

  useStaticTransform(
    registeredRef,
    position,
    rotation,
    live !== undefined || override !== undefined,
  )

  const appearance = useAppearance()
  const material = getSpiralMaterial(appearance)
  const cageMaterial = getSpiralCageMaterial(appearance)

  // İki katman da ekranda sayılır: tahliye çizileni boşaltamaz.
  useEffect(() => {
    const keys = [
      retainGeometry(spiralStaticKey(node, 'full')),
      retainGeometry(spiralStaticKey(node, 'simple')),
      retainGeometry(spiralSlatKey(node, 'full')),
      retainGeometry(spiralSlatKey(node, 'simple')),
    ]
    return () => {
      for (const key of keys) releaseGeometry(key)
    }
  }, [node])

  const staticRef = useRef<THREE.Mesh>(null)
  const slatMeshRef = useRef<THREE.Mesh>(null)
  const slatGroupRef = useRef<THREE.Group>(null)
  const cageRef = useRef<THREE.Mesh>(null)
  const detailRef = useRef<ConveyorDetail>('full')
  const frameRef = useRef(0)
  const phaseRef = useRef(0)
  const phase = useMemo(() => hashPhase(node.id), [node.id])

  const entry = entryHeightM(node)
  const overall = overallHeightM(node)
  const footprint = footprintM(node)
  const colR = columnRadiusM(node)
  const cageR = cageRadiusM(node)
  const travel = node.travelHeight

  useFrame(({ camera }, delta) => {
    const root = registeredRef.current
    if (!root) return

    // ── LOD ──
    if (!isExporting) {
      frameRef.current += 1
      if ((frameRef.current + phase) % LOD_INTERVAL === 0) {
        const { elements } = root.matrixWorld
        const distanceSq = camera.position.distanceToSquared(
          worldPosition.set(elements[12] ?? 0, elements[13] ?? 0, elements[14] ?? 0),
        )
        const scaleSq = lodScaleSq()
        const current = detailRef.current
        const next =
          current === 'full'
            ? distanceSq > LOD_FAR_SQ * scaleSq
              ? 'simple'
              : 'full'
            : distanceSq < LOD_NEAR_SQ * scaleSq
              ? 'full'
              : 'simple'
        if (next !== current) {
          detailRef.current = next
          if (staticRef.current) staticRef.current.geometry = getSpiralStaticGeometry(node, next)
          if (slatMeshRef.current) slatMeshRef.current.geometry = getSpiralSlatGeometry(node, next)
          // Kafes yalnız yakın katmanda: uzakta zaten birkaç piksel.
          if (cageRef.current) cageRef.current.visible = node.hasCage && next !== 'simple'
        }
      }
    }

    // ── Vida hareketi ──
    const group = slatGroupRef.current
    if (!group) return
    if (!flowRunning || isExporting) return // donmuş: slat grubu son pozunda kalır
    const r = helixRadiusM(node)
    const pitch = pitchM(node)
    const s = handednessSign(node)
    // Açısal hız = çizgisel hız / R; işaret akış × kiralite.
    const rate = (beltSpeedMS(node) / Math.max(r, 1e-3)) * (node.flow === 'up' ? 1 : -1) * s
    const step = slatStepRad('full')
    let theta = phaseRef.current + rate * Math.min(delta, 0.1)
    // Adımda sarılır: tam bir slat adımı helisi kendi üstüne oturtur (marj
    // slat dikişi gizliyor), yani sıçrama görünmez.
    theta = ((theta % step) + step) % step
    phaseRef.current = theta
    // Vida: grup −s·θ döner ve (pitch/2π)·θ yükselir; taban `entryHeight`.
    group.rotation.y = -s * theta
    group.position.y = entry + (pitch / TWO_PI) * theta
  })

  return (
    <group ref={wrapperRef} visible={node.visible !== false} {...handlers}>
      <group position={position} ref={registeredRef} rotation={rotation}>
        {!isExporting && (
          <Collider position={[0, overall / 2, 0]} size={[footprint, overall, footprint]} />
        )}
        {/* Statik iskelet. */}
        <mesh
          dispose={null}
          geometry={getSpiralStaticGeometry(node, isExporting ? 'full' : detailRef.current)}
          material={material}
          raycast={NO_RAYCAST}
          receiveShadow
          ref={staticRef}
        />
        {/* Merkez kolon — birim silindir, düğüm başına ölçekli. */}
        <mesh
          dispose={null}
          geometry={COLUMN_GEOMETRY}
          material={material}
          position={[0, overall / 2, 0]}
          raycast={NO_RAYCAST}
          receiveShadow
          scale={[colR, overall, colR]}
        />
        {/* Slat grubu — vida hareketiyle döner/yükselir; taban kotu entryHeight. */}
        <group position={[0, entry, 0]} ref={slatGroupRef}>
          <mesh
            dispose={null}
            geometry={getSpiralSlatGeometry(node, isExporting ? 'full' : detailRef.current)}
            material={material}
            raycast={NO_RAYCAST}
            ref={slatMeshRef}
          />
        </group>
        {/* Güvenlik kafesi — açık uçlu silindir, yarı saydam sarı materyal. */}
        {node.hasCage && (
          <mesh
            dispose={null}
            geometry={CAGE_GEOMETRY}
            material={cageMaterial}
            position={[0, entry + travel / 2, 0]}
            raycast={NO_RAYCAST}
            ref={cageRef}
            scale={[cageR, travel, cageR]}
          />
        )}
      </group>
    </group>
  )
}
