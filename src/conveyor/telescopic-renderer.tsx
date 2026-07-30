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
import { colliderProps } from '../collider'
import { useStaticTransform } from '../static-transform'
import { useWarehouseStore } from '../store'
import { FLOW_BOX_M } from './flow-simulation'
import type { ConveyorDetail } from './parts'
import { TELESCOPIC_BELT_SPEED_EST_MS } from './telescopic-catalog'
import {
  getTelescopicBaseGeometry,
  getTelescopicSectionGeometry,
  releaseGeometry,
  retainGeometry,
  telescopicBaseKey,
  telescopicSectionKey,
} from './telescopic-geometry'
import {
  boomSections,
  boomTipX,
  currentLengthM,
  footprintCenterX,
  frameWidthM,
  telescopicModelOf,
} from './telescopic-metrics'
import type { ConveyorTelescopicNode } from './telescopic-schema'

const NO_RAYCAST = () => {}

const LOD_FAR_SQ = 55 * 55
const LOD_NEAR_SQ = 42 * 42
const LOD_INTERVAL = 8

const worldPosition = new THREE.Vector3()

function hashPhase(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % LOD_INTERVAL
}

/** Bant üstündeki kutular — ailenin kraft kutusu, paylaşılan tekiller. */
const BOX_GEOMETRY = new THREE.BoxGeometry(...FLOW_BOX_M)
const BOX_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#c8a06a',
  metalness: 0,
  roughness: 0.85,
})

/**
 * Çalışma lambasının merceği — TEK yayıcı materyal, tüm sahne.
 *
 * Ayrı materyal, ayrı çizim çağrısı: makinenin vertex-renkli tek materyali
 * yayıcı olamaz (bütün gövde parlardı). Düğüm başına bir ek çizim, yalnız
 * yakın katmanda — bir tesiste iki üç bom olur, bedeli budur ve yazılıdır.
 */
const LAMP_LENS_GEOMETRY = new THREE.BoxGeometry(0.11, 0.07, 0.02)
const LAMP_LENS_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#fff6d8',
  emissive: new THREE.Color('#ffe9a8'),
  emissiveIntensity: 1.6,
  roughness: 0.4,
})

/** Aynı anda bantta görünen en fazla kutu — C=25 m'de ~2 m arayla yeter. */
const MAX_BOXES = 14
const BOX_GAP_M = 2.1

const boxMatrix = new THREE.Matrix4()

/**
 * Teleskopik bant konveyör. Sabit gövde + uzamayla +X'e kayan bölümler;
 * bölüm vertex'leri dinlenme çerçevesinde, uzama yalnız grup X'i (aracın
 * mast kuralının aynısı — poz cache'e girmez).
 *
 * Kutu animasyonu AİLENİN düğmesine bağlı (`flowRunning`): hız tabloda
 * yayınlanmadığı için adlandırılmış tahminle sürülür ve panel bunu söyler.
 * Export sırasında kutular çizilmez — çıktı her zaman dosyadaki sahnedir.
 */
export default function TelescopicRenderer({ node }: { node: ConveyorTelescopicNode }) {
  const registeredRef = useRef<THREE.Object3D>(null!)
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id as AnyNodeId, node.type, registeredRef)

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

  const model = telescopicModelOf(node.model)
  const sections = boomSections(node)
  const material = useMemo(() => {
    // Ailenin paylaşılan materyali atlas ister; teleskopik düz renk çizer —
    // vertexColors'lı tek standart materyal, modül tekili.
    return getSharedMaterial()
  }, [])

  // İki katman da ekranda sayılır: tahliye çizileni boşaltamaz.
  useEffect(() => {
    const keys = [
      retainGeometry(telescopicBaseKey(node, 'full')),
      retainGeometry(telescopicBaseKey(node, 'simple')),
      ...sections.flatMap((section) => [
        retainGeometry(telescopicSectionKey(node, section.index, 'full')),
        retainGeometry(telescopicSectionKey(node, section.index, 'simple')),
      ]),
    ]
    return () => {
      for (const key of keys) releaseGeometry(key)
    }
  }, [node, sections])

  const baseRef = useRef<THREE.Mesh>(null)
  const sectionRefs = useRef<Map<number, THREE.Mesh>>(new Map())
  const detailRef = useRef<ConveyorDetail>('full')
  const frameRef = useRef(0)
  const phase = useMemo(() => hashPhase(node.id), [node.id])

  // Kutu havuzu: TEK InstancedMesh — on dört ayrı mesh, on dört çizim
  // çağrısıydı (ailenin `flow-system`'i bunu altı yüz kutu için zaten
  // çözmüştü; bu onun tek makinelik hâli).
  const boxesRef = useRef<THREE.InstancedMesh>(null)
  const travelRef = useRef(0)

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
        const current = detailRef.current
        const next =
          current === 'full'
            ? distanceSq > LOD_FAR_SQ
              ? 'simple'
              : 'full'
            : distanceSq < LOD_NEAR_SQ
              ? 'full'
              : 'simple'
        if (next !== current) {
          detailRef.current = next
          if (baseRef.current) {
            baseRef.current.geometry = getTelescopicBaseGeometry(node, next)
          }
          for (const section of sections) {
            const mesh = sectionRefs.current.get(section.index)
            if (mesh) mesh.geometry = getTelescopicSectionGeometry(node, section.index, next)
          }
        }
      }
    }

    // ── Kutu akışı ──
    const boxes = boxesRef.current
    if (!boxes) return
    if (!flowRunning || isExporting) {
      // `count = 0` çizim çağrısını tamamen kaldırır; `visible=false` de
      // kaldırırdı ama sayaç sıfırlamak buffer'ı da boşta bırakır.
      boxes.count = 0
      return
    }
    travelRef.current += TELESCOPIC_BELT_SPEED_EST_MS * Math.min(delta, 0.1)
    const length = currentLengthM(node)
    const startX = -model.fixedM / 2 + 0.4
    const endX = boomTipX(node) - 0.2
    const span = Math.max(endX - startX, 0.5)
    const count = Math.min(MAX_BOXES, Math.max(1, Math.floor(span / BOX_GAP_M)))
    const topY = model.heightM + FLOW_BOX_M[1] / 2

    for (let index = 0; index < count; index++) {
      const offset = (travelRef.current + index * BOX_GAP_M) % span
      const x = startX + offset
      // Bom bölümleri kademeli alçalır — kutu üzerinde durduğu bandın kotunu izler.
      let y = topY
      for (const section of sections) {
        if (x > section.centerX - section.lengthM / 2) y = topY - section.dropM
      }
      boxMatrix.makeTranslation(x, y, 0)
      boxes.setMatrixAt(index, boxMatrix)
    }
    boxes.count = count
    boxes.instanceMatrix.needsUpdate = true
    void length
  })

  const height = model.heightM + 0.12
  const width = frameWidthM(node)

  /**
   * Merceğin yeri: en uçtaki bölümün burnu. Parça listesindeki lamba
   * gövdesiyle AYNI aritmetikten çıkar — iki yerde iki formül olsaydı,
   * bom uzayınca mercek gövdesinden ayrılırdı.
   */
  const nose = sections[sections.length - 1]
  const noseLens: [number, number, number] | null = nose
    ? [
        nose.centerX + nose.lengthM / 2 - 0.16,
        model.heightM - nose.dropM + 0.58,
        -nose.widthM / 2 - 0.055,
      ]
    : null

  return (
    <group visible={node.visible !== false} {...handlers}>
      {/* Kolider anlık uzamış zarfı kapsar — bomun ucu da seçilebilir. */}
      {!isExporting && (
        <mesh
          position={[
            position[0] + Math.cos(rotation[1]) * footprintCenterX(node),
            position[1] + height / 2,
            position[2] - Math.sin(rotation[1]) * footprintCenterX(node),
          ]}
          rotation={rotation}
          {...colliderProps([currentLengthM(node), height, width])}
        />
      )}

      <group position={position} ref={registeredRef} rotation={rotation}>
        <mesh
          castShadow
          dispose={null}
          geometry={getTelescopicBaseGeometry(node, 'full')}
          material={material}
          raycast={NO_RAYCAST}
          receiveShadow
          ref={baseRef}
        />
        {sections.map((section) => (
          <mesh
            castShadow
            dispose={null}
            geometry={getTelescopicSectionGeometry(node, section.index, 'full')}
            key={section.index}
            material={material}
            position={[section.centerX, 0, 0]}
            raycast={NO_RAYCAST}
            receiveShadow
            ref={(mesh) => {
              if (mesh) sectionRefs.current.set(section.index, mesh)
              else sectionRefs.current.delete(section.index)
            }}
          />
        ))}
        {/* Kutu havuzu — tek çizim çağrısı, matrisleri kare döngüsü yazar. */}
        <instancedMesh
          args={[BOX_GEOMETRY, BOX_MATERIAL, MAX_BOXES]}
          count={0}
          dispose={null}
          raycast={NO_RAYCAST}
          ref={boxesRef}
        />
        {/* Çalışma lambasının merceği — burun bölümünün ucunda, o bölümün
            uzamasıyla birlikte gider. */}
        {noseLens && (
          <mesh
            dispose={null}
            geometry={LAMP_LENS_GEOMETRY}
            material={LAMP_LENS_MATERIAL}
            position={noseLens}
            raycast={NO_RAYCAST}
          />
        )}
      </group>
    </group>
  )
}

let sharedMaterial: THREE.MeshStandardMaterial | null = null

/** Tek materyal, iki katman — vertex renkleri taşır; araç ailesinin kuralı. */
function getSharedMaterial(): THREE.MeshStandardMaterial {
  if (!sharedMaterial) {
    sharedMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.8,
      metalness: 0.2,
    })
  }
  return sharedMaterial
}
