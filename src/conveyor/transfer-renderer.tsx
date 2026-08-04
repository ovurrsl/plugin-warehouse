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
import { SelfDrawnBody } from '../instancing/self-drawn'
import { useCollective } from '../instancing/use-collective'
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

/** Shared by every module's picking collider, scaled per node. */
const UNIT_COLLIDER = new THREE.BoxGeometry(1, 1, 1)

/**
 * Invisible, and deliberately so. `visible = false` takes the collider out of
 * `WebGLRenderer.projectObject` entirely — no colour pass, no shadow pass —
 * while three's raycaster and R3F's event layer both ignore `visible` and keep
 * hitting it. A `colorWrite: false` material still costs a draw call per module
 * in both passes, which on two hundred modules is two hundred draws that paint
 * nothing.
 */
const COLLIDER_MATERIAL = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })

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

  /**
   * Whether the module standing downstream builds the shared support.
   *
   * The catalogue puts one support at every joint, not two, so a run of modules
   * must not each build one — every seam would carry doubled steel, a doubled
   * shadow and z-fighting on every coincident face.
   */
  const abutted = useScene((s) => hasDownstreamNeighbour(s.nodes as Record<string, unknown>, node))

  const material = getConveyorMaterial()

  const selected = useViewer((s) => s.selection.selectedIds.includes(node.id as AnyNodeId))
  const drawsSelf = useCollective({
    nodeId: node.id,
    objectRef: registeredRef,
    geometryFor: (tier) => getTransferGeometry(node, tier, abutted),
    keyFor: (tier) => transferGeometryKey(node, tier, abutted),
    materialFor: () => material,
    materialKeyFor: () => 'conveyor',
    castsShadow: true,
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
   * Eased rather than switched, because a strip that snapped up in one frame
   * would read as a glitch and not as a lift.
   *
   * Katman döngüsü buradan KALKTI — o iş artık ya kolektif sistemin merkezî
   * `evaluateTiers`'ında ya da `SelfDrawnBody`'nin içinde. Kalan tek kare
   * döngüsü bu, ve gerçekten her karede bir şey yapıyor.
   */
  useFrame((_, delta) => {
    const strips = stripsRef.current
    if (!strips) return
    const target = isLifting(node.id) ? MTR_STRIP_STROKE_M : 0
    const rate = Math.min(1, delta * 12)
    strips.position.y += (target - strips.position.y) * rate
  })

  const length = moduleLengthM(node)
  const width = frameWidthM(node)
  // The collider wraps the bed and the space a box travelling on it occupies —
  // not the legs, which is where nobody aims. A conveyor is mostly air, so
  // without one a click lands between the rollers and selects the floor.
  // No guide term: this type has none, because a box leaves by the side and a
  // rail would be in the way of the one thing the machine does.
  const colliderHeight = Math.max(0.2, node.transportHeight)

  return (
    <group visible={node.visible !== false} {...handlers}>
      <group position={position} ref={registeredRef} rotation={rotation}>
        {!isExporting && (
          <mesh
            dispose={null}
            geometry={UNIT_COLLIDER}
            material={COLLIDER_MATERIAL}
            position={[0, colliderHeight / 2, 0]}
            scale={[length, colliderHeight, width]}
            visible={false}
          />
        )}
        {/* Gölge bayrakları koşulsuz, ailenin geri kalanı gibi: şeritler gerçek
            çelik ve kalktıklarında gövdenin üstünde duruyorlar. Eksik olmaları
            kullanıcının bildirdiği "gölgeler sistem anahtarını izlemeli"
            şikâyetinin bu kind'daki artığıydı. */}
        <mesh
          castShadow
          dispose={null}
          geometry={stripGeometry}
          material={material}
          raycast={NO_RAYCAST}
          receiveShadow
          ref={stripsRef}
        />

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
