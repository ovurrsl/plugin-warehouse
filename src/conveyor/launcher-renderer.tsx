'use client'

import {
  type AnyNodeId,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import type * as THREE from 'three'
import { appearanceKey, useAppearance } from '../appearance'
import { Collider } from '../collider'
import { useFrozenMatrix } from '../frozen-matrix'
import { useAdmitted } from '../instancing/admission'
import { SelfDrawnBody } from '../instancing/self-drawn'
import { useCollective } from '../instancing/use-collective'
import { isSelected } from '../selection'
import { useStaticTransform } from '../static-transform'
import { LNC } from './catalog'
import { releaseGeometry } from './geometry-builder'
import {
  getLauncherGeometry,
  launcherGeometryKey,
  retainLauncherGeometry,
} from './launcher-geometry'
import { frameWidthM, lateralOuterZM, launchSign, moduleLengthM } from './launcher-metrics'
import type { ConveyorLauncherNode } from './launcher-schema'
import { hasDownstreamNeighbour } from './line-index'
import { getConveyorMaterial } from './materials'
import { LOD_FAR_SQ, LOD_NEAR_SQ } from './renderer'

export default function ConveyorLauncherRenderer({ node }: { node: ConveyorLauncherNode }) {
  // Kademeli mount kapısı. Gövde AYRI bileşende olmak ZORUNDA: pahalı iş onun
  // kancalarında (kayıt, olay bağlama, havuza kayıt, geometri tutma) ve kancalar
  // koşullu çağrılamıyor, yani "sıra bende değil" hâli ancak gövdeyi hiç mount
  // etmeyerek karşılanabilir. Gerekçenin tamamı `../instancing/admission`.
  const admitted = useAdmitted(node.id)
  if (!admitted) return null
  return <ConveyorLauncherRendererBody node={node} />
}

function ConveyorLauncherRendererBody({ node }: { node: ConveyorLauncherNode }) {
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

  const abutted = useScene((s) => hasDownstreamNeighbour(s.nodes as Record<string, unknown>, node))

  const appearance = useAppearance()
  const material = getConveyorMaterial(appearance)

  // Kolektif çiziciye katılım ve gerekçesi `./renderer.tsx`'te; eşikler oradan.
  const selected = useViewer((s) => isSelected(s.selection.selectedIds, node.id))
  const drawsSelf = useCollective({
    nodeId: node.id,
    objectRef: registeredRef,
    geometryFor: (tier) => getLauncherGeometry(node, tier, abutted),
    keyFor: (tier) => launcherGeometryKey(node, tier, abutted),
    materialFor: () => material,
    materialKeyFor: () => `conveyor:${appearanceKey(appearance)}`,
    castsShadow: false,
    farSq: LOD_FAR_SQ,
    nearSq: LOD_NEAR_SQ,
    excluded: selected || live !== undefined || override !== undefined || isExporting,
  })

  useEffect(() => {
    const near = retainLauncherGeometry(node, 'full', abutted)
    const far = retainLauncherGeometry(node, 'simple', abutted)
    return () => {
      releaseGeometry(near)
      releaseGeometry(far)
    }
  }, [node, abutted])

  /**
   * Two pickers, not one box round both.
   *
   * A launcher's steel is an L, and the rectangle that contains it is a third
   * empty — the corner opposite the arm. One collider there would swallow clicks
   * aimed at whatever stands in that corner, which on a branch is usually the
   * line the branch feeds.
   */
  const colliders = useMemo(() => {
    const height = Math.max(0.2, node.transportHeight + (node.sideGuide ? node.sideGuideHeight : 0))
    const frame = frameWidthM(node)
    const side = launchSign(node)
    const armDepth = lateralOuterZM(node) - frame / 2
    return {
      height,
      boxes: [
        {
          center: [0, 0] as [number, number],
          size: [moduleLengthM(node), frame] as [number, number],
        },
        {
          center: [0, side * (frame / 2 + armDepth / 2)] as [number, number],
          size: [LNC.boxLengthM, armDepth] as [number, number],
        },
      ],
    }
  }, [node])

  return (
    <group ref={wrapperRef} {...handlers}>
      <group
        position={position}
        ref={registeredRef}
        rotation={rotation}
        visible={node.visible !== false}
      >
        {!isExporting &&
          colliders.boxes.map((box) => (
            <Collider
              key={`${box.center[0]}:${box.center[1]}`}
              position={[box.center[0], colliders.height / 2, box.center[1]]}
              size={[box.size[0], colliders.height, box.size[1]]}
            />
          ))}

        {drawsSelf && (
          <SelfDrawnBody
            farSq={LOD_FAR_SQ}
            geometryFor={(tier) => getLauncherGeometry(node, tier, abutted)}
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
