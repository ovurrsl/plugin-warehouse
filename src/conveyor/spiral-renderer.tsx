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
import { useAppearance } from '../appearance'
import { Collider } from '../collider'
import { useFrozenMatrix } from '../frozen-matrix'
import { useAdmitted } from '../instancing/admission'
import { useStaticTransform } from '../static-transform'
import { lodScaleSq, useWarehouseStore } from '../store'
import { FLOW_BOX_M } from './flow-simulation'
import { getFlowBoxMaterial } from './materials'
import type { ConveyorDetail } from './parts'
import {
  getSpiralSlatGeometry,
  getSpiralStaticGeometry,
  releaseGeometry,
  retainGeometry,
  spiralSlatKey,
  spiralStaticKey,
} from './spiral-geometry'
import { resolveSpiralRise, spiralLevelFingerprint } from './spiral-levels'
import { getSpiralCageMaterial, getSpiralMaterial } from './spiral-materials'
import {
  cageRadiusM,
  columnRadiusM,
  entryHeightM,
  footprintM,
  handednessSign,
  helixPoint,
  overallHeightM,
  SPIRAL_MAX_BOXES,
  spiralBoxCount,
  spiralBoxRateRadPerSec,
  spiralBoxStepRad,
  totalAngleRad,
  travelHeightM,
} from './spiral-metrics'
import { SLAT_THICKNESS_M } from './spiral-parts'
import type { ConveyorSpiralNode } from './spiral-schema'

const NO_RAYCAST = () => {}

const LOD_FAR_SQ = 55 * 55
const LOD_NEAR_SQ = 42 * 42
const LOD_INTERVAL = 8

const worldPosition = new THREE.Vector3()

/** Taşınan koli — ailenin kraft kutusu, paylaşılan tekil geometri. */
const BOX_GEOMETRY = new THREE.BoxGeometry(...FLOW_BOX_M)
const boxMatrix = new THREE.Matrix4()
const boxQuaternion = new THREE.Quaternion()
const boxPosition = new THREE.Vector3()
const boxScale = new THREE.Vector3(1, 1, 1)
const yAxis = new THREE.Vector3(0, 1, 0)

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
 * Sarmal konveyör. TAMAMEN statik iskelet + slat yüzeyi; hareket eden şey
 * helis yolunu takip eden ayrı koli instance'ları (kullanıcı kararı: band
 * değil koliler hareket eder — spec §5'in "yük nesneleri ayrı instance'lar"
 * satırı). Merkez kolon ve kafes düğüm başına ölçekli birim silindir.
 *
 * Kolektif havuza GİRMEZ (`instancing/coverage.test.ts`): koli havuzu her karede
 * matrisini yazıyor, donmuş kolektif matris bunu tutamaz.
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
  const boxMaterial = getFlowBoxMaterial(appearance)

  const levelFingerprint = useScene((s) =>
    spiralLevelFingerprint(s.nodes as Record<string, unknown>, node),
  )
  const resolvedRise = useMemo(
    () => resolveSpiralRise(useScene.getState().nodes as Record<string, unknown>, node),
    [levelFingerprint, node],
  )

  // İki katman da ekranda sayılır: tahliye çizileni boşaltamaz.
  useEffect(() => {
    const keys = [
      retainGeometry(spiralStaticKey(node, 'full', resolvedRise)),
      retainGeometry(spiralStaticKey(node, 'simple', resolvedRise)),
      retainGeometry(spiralSlatKey(node, 'full', resolvedRise)),
      retainGeometry(spiralSlatKey(node, 'simple', resolvedRise)),
    ]
    return () => {
      for (const key of keys) releaseGeometry(key)
    }
  }, [node, resolvedRise])

  const staticRef = useRef<THREE.Mesh>(null)
  const slatMeshRef = useRef<THREE.Mesh>(null)
  const cageRef = useRef<THREE.Mesh>(null)
  const boxesRef = useRef<THREE.InstancedMesh>(null)
  const detailRef = useRef<ConveyorDetail>('full')
  const frameRef = useRef(0)
  const travelRef = useRef(0)
  const phase = useMemo(() => hashPhase(node.id), [node.id])

  const entry = entryHeightM(node)
  const overall = overallHeightM(node, resolvedRise)
  const footprint = footprintM(node)
  const colR = columnRadiusM(node)
  const cageR = cageRadiusM(node)
  const travel = travelHeightM(node, resolvedRise)
  /** Kolinin bindiği kot: slat üst yüzeyi (helisY + slat/2) + koli yarısı. */
  const boxRideY = SLAT_THICKNESS_M / 2 + FLOW_BOX_M[1] / 2

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
          if (staticRef.current)
            staticRef.current.geometry = getSpiralStaticGeometry(node, next, resolvedRise)
          if (slatMeshRef.current)
            slatMeshRef.current.geometry = getSpiralSlatGeometry(node, next, resolvedRise)
          // Kafes yalnız yakın katmanda: uzakta zaten birkaç piksel.
          if (cageRef.current) cageRef.current.visible = node.hasCage && next !== 'simple'
        }
      }
    }

    // ── Koli akışı ──
    const boxes = boxesRef.current
    if (!boxes) return
    if (!flowRunning || isExporting) {
      // `count = 0` çizim çağrısını tamamen kaldırır (band + iskelet zaten statik).
      boxes.count = 0
      return
    }
    const s = handednessSign(node)
    const total = totalAngleRad(node, resolvedRise)
    const step = spiralBoxStepRad(node)
    const count = spiralBoxCount(node, resolvedRise)
    // İlerleme: akış `up` → `t` artar (tırmanır), `down` → azalır.
    travelRef.current += spiralBoxRateRadPerSec(node) * (node.flow === 'up' ? 1 : -1) * delta
    for (let i = 0; i < count; i++) {
      // `t` daima [0, total] içinde: koli tepeye varınca tabana sarar.
      const t = (((travelRef.current + i * step) % total) + total) % total
      const [x, y, z] = helixPoint(node, t)
      boxPosition.set(x, entry + y + boxRideY, z)
      // Koli, slat'la aynı radyal çerçeveye döner.
      boxQuaternion.setFromAxisAngle(yAxis, -(Math.PI + s * t))
      boxMatrix.compose(boxPosition, boxQuaternion, boxScale)
      boxes.setMatrixAt(i, boxMatrix)
    }
    boxes.count = count
    boxes.instanceMatrix.needsUpdate = true
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
          geometry={getSpiralStaticGeometry(
            node,
            isExporting ? 'full' : detailRef.current,
            resolvedRise,
          )}
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
        {/* Slat yüzeyi — SABİT (hareket eden koliler); taban kotu entryHeight. */}
        <mesh
          dispose={null}
          geometry={getSpiralSlatGeometry(
            node,
            isExporting ? 'full' : detailRef.current,
            resolvedRise,
          )}
          material={material}
          position={[0, entry, 0]}
          raycast={NO_RAYCAST}
          ref={slatMeshRef}
        />
        {/* Taşınan koliler — tek InstancedMesh, matrisleri kare döngüsü yazar.
            `frustumCulled={false}`: matrisler her kare değişir, sınır küresi ilk
            testteki hâline saplanır (`flow-system.tsx`'in kuralı). */}
        <instancedMesh
          args={[BOX_GEOMETRY, boxMaterial, SPIRAL_MAX_BOXES]}
          count={0}
          dispose={null}
          frustumCulled={false}
          raycast={NO_RAYCAST}
          ref={boxesRef}
        />
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
