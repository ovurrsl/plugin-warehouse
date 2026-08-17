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
import { specOf } from '../pallet/presets'
import { useStaticTransform } from '../static-transform'
import { lodScaleSq, useWarehouseStore } from '../store'
import { ROLLER_DIAMETER_M, SPEED_MPM } from './catalog'
import { buildLiftCycle, cycleLength, stepAt } from './cycle'
import {
  getPalletLiftDoorGeometry,
  getPalletLiftPlatformGeometry,
  getPalletLiftStaticGeometry,
  palletLiftDoorKey,
  palletLiftPlatformKey,
  palletLiftStaticKey,
  releaseGeometry,
  retainGeometry,
} from './geometry'
import { liftLevelFingerprint, resolveLift } from './levels'
import { getPalletLiftEnclosureMaterial, getPalletLiftMaterial } from './materials'
import { doorFaceZ, enclosureXZ, footprintM } from './metrics'
import { doorPanelLiftM } from './parts'
import type { PalletLiftNode } from './schema'

const NO_RAYCAST = () => {}

/**
 * Katman bandı — asansör zemine dik, uzun bir kule: rampanınkiyle aynı
 * (45/34), sarmalınkine yakın. SEÇİLMİŞ VARSAYILAN.
 */
const LOD_FAR_SQ = 45 * 45
const LOD_NEAR_SQ = 34 * 34
const LOD_INTERVAL = 8

const worldPosition = new THREE.Vector3()

/** Muhafaza ve palet stand-in birim kutuları — düğüm başına ölçekli. */
const ENCLOSURE_BOX = new THREE.BoxGeometry(1, 1, 1)
const STANDIN_BOX = new THREE.BoxGeometry(1, 1, 1)

function hashPhase(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % LOD_INTERVAL
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Kademeli mount kapısı — ailenin şablonu: gövdenin pahalı işi kancalarında ve
 * kancalar koşullu çağrılamaz.
 */
export default function PalletLiftRenderer({ node }: { node: PalletLiftNode }) {
  const admitted = useAdmitted(node.id)
  if (!admitted) return null
  return <PalletLiftBody node={node} />
}

/**
 * Palet asansörü — statik iskelet + dikey hareket eden platform grubu + durak
 * başına kayar kapı paneli.
 *
 * ## Neden kolektif havuza girmiyor
 *
 * Platform ve kapı grupları her karede KENDİ pozlarını taşıyor (her düğüm kendi
 * çevrim saatinden sürülüyor). Kolektif havuz düğüm başına TEK dünya matrisini
 * yeniden inşa anında donduruyor — her kare değişen bu pozları tutamaz.
 * Teleskopik/sarmal girdisinin aynı gerekçesi (`instancing/coverage.test.ts`).
 *
 * ## Yayın renderer-YEREL
 *
 * Platform pozunu dışarıdan tüketen yok (2D plan çizmiyor, kolider tam statik
 * mast zarfı), o yüzden `useLiveTransforms` DEĞİL yerel ref'ler. Çevrim kapısı
 * `flowRunning`: asansör de sarmal gibi birim yükü kendi ayak izinde taşıyor ve
 * "hat çalışıyor mu?" sorusunun parçası; `fleetRunning`'in ayrılması araçların
 * zemin boyunca sürmesindendi.
 */
function PalletLiftBody({ node }: { node: PalletLiftNode }) {
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
  const material = getPalletLiftMaterial(appearance)
  const enclosureMaterial = getPalletLiftEnclosureMaterial(appearance)

  /**
   * Kotlar bir STRING PARMAK İZİ seçicisiyle: bir kat yüksekliği/kotu değişince
   * dizge değişir, `resolveLift` yeniden çözer, yeni statik anahtar doğar, eski
   * buffer süpürme ile serbest kalır (elle dispose YOK). Host-reaktivite budur.
   */
  const levelFingerprint = useScene((s) =>
    liftLevelFingerprint(s.nodes as Record<string, unknown>, node),
  )
  const resolved = useMemo(
    () => resolveLift(useScene.getState().nodes as Record<string, unknown>, node),
    [levelFingerprint, node],
  )
  const resolvedRef = useRef(resolved)
  resolvedRef.current = resolved

  const steps = useMemo(
    () => buildLiftCycle(resolved.stops, { mpm: SPEED_MPM[node.capacityClass].mpm }),
    [resolved, node.capacityClass],
  )
  const stepsRef = useRef(steps)
  stepsRef.current = steps
  const cycleLen = useMemo(() => cycleLength(steps), [steps])
  const cycleLenRef = useRef(cycleLen)
  cycleLenRef.current = cycleLen

  const footprint = footprintM(node)
  const enclosure = enclosureXZ(node)
  const faceZ = doorFaceZ(node)
  const pallet = specOf(node.palletPreset)

  const staticMeshRef = useRef<THREE.Mesh>(null)
  const platformMeshRef = useRef<THREE.Mesh>(null)
  const platformGroupRef = useRef<THREE.Group>(null)
  const standInRef = useRef<THREE.Mesh>(null)
  const enclosureRef = useRef<THREE.Mesh>(null)
  const doorGroupRefs = useRef<Array<THREE.Group | null>>([])
  const detailRef = useRef<'full' | 'simple'>('full')
  const frameCountRef = useRef(0)
  const clockRef = useRef(0)
  const phase = useMemo(() => hashPhase(node.id), [node.id])

  // Üç buffer'ın da İKİ katmanını tut; `resolved` bağımlılıkta, kat değişince
  // eski statik anahtarlar bırakılıp yenileri tutuluyor (eskiler süpürülür).
  useEffect(() => {
    const r = resolvedRef.current
    const keys = [
      retainGeometry(palletLiftStaticKey(node, 'full', r)),
      retainGeometry(palletLiftStaticKey(node, 'simple', r)),
      retainGeometry(palletLiftPlatformKey(node, 'full')),
      retainGeometry(palletLiftPlatformKey(node, 'simple')),
      retainGeometry(palletLiftDoorKey(node)),
    ]
    return () => {
      for (const key of keys) releaseGeometry(key)
    }
  }, [node, resolved])

  useFrame(({ camera }, delta) => {
    const root = registeredRef.current
    if (!root) return

    // ── LOD ──
    if (!isExporting) {
      frameCountRef.current += 1
      if ((frameCountRef.current + phase) % LOD_INTERVAL === 0) {
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
          if (staticMeshRef.current) {
            staticMeshRef.current.geometry = getPalletLiftStaticGeometry(
              node,
              next,
              resolvedRef.current,
            )
          }
          if (platformMeshRef.current) {
            platformMeshRef.current.geometry = getPalletLiftPlatformGeometry(node, next)
          }
          if (enclosureRef.current) {
            enclosureRef.current.visible = node.hasEnclosure && next !== 'simple'
          }
        }
      }
    }

    // ── Çevrim saati ──
    const platformGroup = platformGroupRef.current
    if (!platformGroup) return
    const cycleSteps = stepsRef.current
    const stops = resolvedRef.current.stops
    const bottom = stops[0]?.baseY ?? 0

    if (!flowRunning || isExporting || cycleSteps.length === 0 || cycleLenRef.current <= 0) {
      // Donmuş: platform alt durakta, kapılar kapalı, stand-in gizli.
      platformGroup.position.y = bottom
      for (let i = 0; i < doorGroupRefs.current.length; i++) {
        const g = doorGroupRefs.current[i]
        if (g) g.position.y = stops[i]?.baseY ?? 0
      }
      if (standInRef.current) standInRef.current.visible = false
      return
    }

    clockRef.current = (clockRef.current + Math.min(delta, 0.1)) % cycleLenRef.current
    const at = stepAt(cycleSteps, clockRef.current)
    if (!at) return
    const { step, index, localT } = at

    const prevY =
      index > 0
        ? (cycleSteps[index - 1]?.platformY ?? bottom)
        : (cycleSteps[cycleSteps.length - 1]?.platformY ?? bottom)
    platformGroup.position.y =
      step.phase === 'travel' ? lerp(prevY, step.platformY, localT) : step.platformY

    const doorFrac =
      step.phase === 'doors-open'
        ? localT
        : step.phase === 'loading'
          ? 1
          : step.phase === 'doors-close'
            ? 1 - localT
            : 0
    const lift = doorPanelLiftM()
    for (let i = 0; i < doorGroupRefs.current.length; i++) {
      const g = doorGroupRefs.current[i]
      if (!g) continue
      const base = stops[i]?.baseY ?? 0
      g.position.y = base + (step.doorStopIndex === i ? doorFrac : 0) * lift
    }

    // Stand-in palet: çevrim boyunca platformda taşınıyor (stand-in kutu).
    if (standInRef.current) standInRef.current.visible = true
  })

  return (
    <group ref={wrapperRef} visible={node.visible !== false} {...handlers}>
      <group position={position} ref={registeredRef} rotation={rotation}>
        {/* Kolider TAM mast zarfı: platform nerede olursa olsun sarar (statik). */}
        {!isExporting && (
          <Collider
            position={[0, resolved.mastHeight / 2, 0]}
            size={[footprint[0], resolved.mastHeight, footprint[1]]}
          />
        )}

        {/* Statik iskelet — mastlar, tahrik, taban, kontrol, kapı çerçeveleri. */}
        <mesh
          dispose={null}
          geometry={getPalletLiftStaticGeometry(
            node,
            isExporting ? 'full' : detailRef.current,
            resolved,
          )}
          material={material}
          raycast={NO_RAYCAST}
          receiveShadow
          ref={staticMeshRef}
        />

        {/* Platform grubu — dinlenme çerçevesinde çizilir, dikey seyahat grup Y'si. */}
        <group ref={platformGroupRef} position={[0, resolved.stops[0]?.baseY ?? 0, 0]}>
          <mesh
            dispose={null}
            geometry={getPalletLiftPlatformGeometry(node, isExporting ? 'full' : detailRef.current)}
            material={material}
            raycast={NO_RAYCAST}
            receiveShadow
            ref={platformMeshRef}
          />
          {/* Palet STAND-IN — gerçek palet düğümü değil, çevrim boyunca taşınan
              yer tutucu bir kutu. */}
          <mesh
            dispose={null}
            geometry={STANDIN_BOX}
            material={material}
            position={[0, ROLLER_DIAMETER_M + pallet.height / 2, 0]}
            raycast={NO_RAYCAST}
            ref={standInRef}
            scale={[pallet.length, pallet.height, pallet.width]}
            visible={false}
          />
        </group>

        {/* Kapı panelleri — durak başına bir grup, tek geometri paylaşılır. */}
        {node.hasDoors &&
          resolved.stops.map((stop, i) => (
            <group
              key={stop.id}
              position={[0, stop.baseY, faceZ]}
              ref={(el) => {
                doorGroupRefs.current[i] = el
              }}
            >
              <mesh
                dispose={null}
                geometry={getPalletLiftDoorGeometry(node)}
                material={material}
                raycast={NO_RAYCAST}
                receiveShadow
              />
            </group>
          ))}

        {/* Güvenlik muhafazası — AYRI yarı saydam mesh, birleştirilmiş buffer'da
            değil. Yalnız yakın katmanda. */}
        {node.hasEnclosure && (
          <mesh
            dispose={null}
            geometry={ENCLOSURE_BOX}
            material={enclosureMaterial}
            position={[0, resolved.mastHeight / 2, 0]}
            raycast={NO_RAYCAST}
            ref={enclosureRef}
            scale={[enclosure[0], resolved.mastHeight, enclosure[1]]}
          />
        )}
      </group>
    </group>
  )
}
