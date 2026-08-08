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
import { useEffect, useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'
import { appearanceKey, useAppearance } from '../appearance'
import { Collider } from '../collider'
import { useFrozenMatrix } from '../frozen-matrix'
import { useAdmitted } from '../instancing/admission'
import { SelfDrawnBody } from '../instancing/self-drawn'
import { useCollective } from '../instancing/use-collective'
import { isSelected } from '../selection'
import { useStaticTransform } from '../static-transform'
import { useWarehouseStore } from '../store'
import { MTR_STRIP_STROKE_M } from './constants'
import { isLifting } from './flow-simulation'
import { releaseGeometry } from './geometry-builder'
import { hasDownstreamNeighbour } from './line-index'
import { getConveyorMaterial } from './materials'
import { LOD_FAR_SQ, LOD_NEAR_SQ } from './renderer'
import {
  getTransferGeometry,
  getTransferStripsGeometry,
  retainTransferGeometry,
  retainTransferStripsGeometry,
  transferGeometryKey,
} from './transfer-geometry'
import { frameWidthM, moduleLengthM } from './transfer-metrics'
import type { ConveyorTransferNode } from './transfer-schema'

const NO_RAYCAST = () => {}

/**
 * Mounted through `def.renderer: { kind: 'parametric' }` rather than
 * `def.geometry`: `<GeometrySystem>` disposes the previous build's children on
 * every rebuild, and the geometry here is shared by every module of the same
 * shape — so one rebuild anywhere would free the buffer forty other modules are
 * drawing from and blank them all at once.
 *
 * ## Kolektife giren GÖVDE, şeritler değil
 *
 * Bu ailenin tek istisnası: gövde ailenin geri kalanı gibi kolektife katılıyor,
 * ama şeritler ayrı bir mesh olarak kalıyor çünkü HAREKET EDİYORLAR — kutuyu
 * makara hattından kaldıran mekanizma o. Kolektif havuz dünya matrislerini
 * yeniden inşa anında donduruyor, yani her karede Y'si değişen bir parçayı
 * taşıyamaz; taşısaydı ya şerit hiç kalkmaz ya da havuz her karede yeniden
 * kurulurdu — kurtardığından pahalı.
 *
 * Bir düzende bu tipten avuç içi kadar bulunduğu için, düğüm başına kalan bu
 * tek fazladan draw call ailenin toplam kazancını değiştirmiyor.
 */
export default function ConveyorTransferRenderer({ node }: { node: ConveyorTransferNode }) {
  // Kademeli mount kapısı. Gövde AYRI bileşende olmak ZORUNDA: pahalı iş onun
  // kancalarında (kayıt, olay bağlama, havuza kayıt, geometri tutma) ve kancalar
  // koşullu çağrılamıyor, yani "sıra bende değil" hâli ancak gövdeyi hiç mount
  // etmeyerek karşılanabilir. Gerekçenin tamamı `../instancing/admission`.
  const admitted = useAdmitted(node.id)
  if (!admitted) return null
  return <ConveyorTransferRendererBody node={node} />
}

function ConveyorTransferRendererBody({ node }: { node: ConveyorTransferNode }) {
  const registeredRef = useRef<THREE.Object3D>(null!)
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id as AnyNodeId, node.type, registeredRef)

  // Olay sarmalayıcısı dönüşümsüz, ama auto-update kaldığı sürece bedava
  // değil: her karede kendi `compose`'unu yapıp `force`'u çocuklara yayar ve
  // altındaki donmuş koliderin kazancını geri verir. Bkz. `../frozen-matrix`.
  const wrapperRef = useRef<THREE.Object3D>(null)
  useFrozenMatrix(wrapperRef)

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

  // Duran modül three'nin kare başına matris yeniden hesabından çıkar; canlı
  // sürükleme ya da override varken bayrak three'ye geri döner. `isLive`
  // ifadesi JSX'i süren okumanın AYNISI olmak zorunda — ayrışırsa sürüklenen
  // modül donar (`../static-transform`).
  useStaticTransform(
    registeredRef,
    position,
    rotation,
    live !== undefined || override !== undefined,
  )

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

  const selected = useViewer((s) => isSelected(s.selection.selectedIds, node.id))
  const drawsSelf = useCollective({
    nodeId: node.id,
    objectRef: registeredRef,
    geometryFor: (tier) => getTransferGeometry(node, tier, abutted),
    keyFor: (tier) => transferGeometryKey(node, tier, abutted),
    materialFor: () => material,
    materialKeyFor: () => `conveyor:${appearanceKey(appearance)}`,
    castsShadow: false,
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
    const near = retainTransferGeometry(node, 'full', abutted)
    const far = retainTransferGeometry(node, 'simple', abutted)
    const strips = retainTransferStripsGeometry(node)
    return () => {
      releaseGeometry(near)
      releaseGeometry(far)
      releaseGeometry(strips)
    }
  }, [node, abutted])

  /**
   * The strips, in a mesh of their own so they can rise.
   *
   * The one place in this kind where a shape is two buffers rather than one,
   * and it buys the machine's whole mechanism: without it a box slides sideways
   * for no visible reason. Three boxes and one draw call, on a shape a layout
   * has a handful of.
   */
  const stripsRef = useRef<THREE.Mesh>(null)
  const stripGeometry = useMemo(() => getTransferStripsGeometry(node), [node])

  /**
   * Kare döngüsü akış KOŞARKEN mount ediliyor, ve akış durduktan sonra da
   * şerit yere inene kadar.
   *
   * Önceki hâlinde abonelik koşulsuzdu: akış kapalıyken `isLifting` hep
   * `false`, hedef 0, şerit zaten 0 — yani transfer düğümü başına kare
   * başına bir boş kapanış çağrısı ve etkisiz bir yazım. `self-drawn.tsx`
   * bu deseni ölçüp kaldırmıştı; burası kalan örneğiydi. Teleskopik aynı
   * kapıyı zaten `flowRunning` ile kuruyor.
   *
   * Kancalar koşullu çağrılamaz, bileşen mount'u koşullu olabilir — döngü
   * bu yüzden ayrı bir bileşende. `settling`, akış durduğu anda şeridin
   * yumuşak inişini KAYBETMEMEK için var: kapıyı hemen kapatmak şeridi
   * havada dondururdu.
   */
  const flowRunning = useWarehouseStore((s) => s.flowRunning)
  const [settling, setSettling] = useState(false)
  useEffect(() => {
    if (flowRunning) setSettling(true)
  }, [flowRunning])

  const length = moduleLengthM(node)
  const width = frameWidthM(node)
  // The collider wraps the bed and the space a box travelling on it occupies —
  // not the legs, which is where nobody aims. A conveyor is mostly air, so
  // without one a click lands between the rollers and selects the floor.
  // No guide term: this type has none, because a box leaves by the side and a
  // rail would be in the way of the one thing the machine does.
  const colliderHeight = Math.max(0.2, node.transportHeight)

  return (
    <group ref={wrapperRef} {...handlers}>
      <group
        position={position}
        ref={registeredRef}
        rotation={rotation}
        visible={node.visible !== false}
      >
        {!isExporting && (
          <Collider position={[0, colliderHeight / 2, 0]} size={[length, colliderHeight, width]} />
        )}
        {/* Gölge bayrakları koşulsuz, ailenin geri kalanı gibi: şeritler gerçek
            çelik ve kalktıklarında gövdenin üstünde duruyorlar. Eksik olmaları
            kullanıcının bildirdiği "gölgeler sistem anahtarını izlemeli"
            şikâyetinin bu kind'daki artığıydı. */}
        <mesh
          dispose={null}
          geometry={stripGeometry}
          material={material}
          raycast={NO_RAYCAST}
          receiveShadow
          ref={stripsRef}
        />
        {(flowRunning || settling) && (
          <StripLift nodeId={node.id} onSettled={() => setSettling(false)} stripsRef={stripsRef} />
        )}

        {drawsSelf && (
          <SelfDrawnBody
            farSq={LOD_FAR_SQ}
            geometryFor={(tier) => getTransferGeometry(node, tier, abutted)}
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

/** Şeridin bir kare sonraki Y'si, metre.

 *  Saf, çünkü ölçülecek olan tam bu: eşik ADIMA değil KALANA uygulanmalı.
 *  Adıma uygulanmış bir eşik, yolun ortasındaki şeridi ilk karede hedefe
 *  ışınlar ve kalkış animasyonu diye bir şey kalmaz. */
export function nextStripY(current: number, target: number, delta: number): number {
  const rate = Math.min(1, delta * 12)
  const next = current + (target - current) * rate
  return Math.abs(target - next) < SETTLE_EPSILON_M ? target : next
}

/** Şerit hedefe bu kadar yaklaştığında oturmuş sayılır, metre. Strok 0,04 m
 *  mertebesinde (`MTR_STRIP_STROKE_M`), yani bu değer stroğun binde biri —
 *  gözle ayırt edilemez ama döngüyü kapatmaya yeter. */
const SETTLE_EPSILON_M = 5e-5

/**
 * Şeridi yumuşatarak taşıyan kare döngüsü, KENDİ bileşeninde.
 *
 * Ayrı bileşen olmasının sebebi kanca kuralı: `useFrame` koşullu
 * çağrılamaz, ama bu bileşen koşullu mount edilebilir. Akış kapalı ve
 * şerit yerdeyken hiç mount olmuyor — transfer düğümü başına kare başına
 * bir boş kapanış çağrısı böyle kalkıyor.
 */
function StripLift({
  nodeId,
  onSettled,
  stripsRef,
}: {
  nodeId: string
  onSettled: () => void
  stripsRef: { current: THREE.Mesh | null }
}) {
  useFrame((_, delta) => {
    const strips = stripsRef.current
    if (!strips) return
    const target = isLifting(nodeId) ? MTR_STRIP_STROKE_M : 0
    const next = nextStripY(strips.position.y, target, delta)
    if (next === strips.position.y) {
      // Yerde durmuş ve kaldıran yok: döngünün yapacağı iş bitti.
      if (target === 0) onSettled()
      return
    }
    strips.position.y = next
  })
  return null
}
