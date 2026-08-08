'use client'

import {
  type AnyNodeId,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type * as THREE from 'three'
import { appearanceKey, useAppearance } from '../appearance'
import { Collider } from '../collider'
import { useFrozenMatrix } from '../frozen-matrix'
import { useAdmitted } from '../instancing/admission'
import { HIDDEN_FOR_COLLECTIVE } from '../instancing/collective'
import { SelfDrawnBody } from '../instancing/self-drawn'
import { useCollective } from '../instancing/use-collective'
import { isSelected } from '../selection'
import { useStaticTransform } from '../static-transform'
import { curveGeometryKey, getCurveGeometry, retainCurveGeometry } from './curve-geometry'
import { colliderSegments } from './curve-metrics'
import type { ConveyorCurveNode } from './curve-schema'
import { releaseGeometry } from './geometry-builder'
import { hasDownstreamNeighbour } from './line-index'
import { getConveyorMaterial } from './materials'
import { LOD_FAR_SQ, LOD_NEAR_SQ } from './renderer'

export default function ConveyorCurveRenderer({ node }: { node: ConveyorCurveNode }) {
  // Kademeli mount kapısı. Gövde AYRI bileşende olmak ZORUNDA: pahalı iş onun
  // kancalarında (kayıt, olay bağlama, havuza kayıt, geometri tutma) ve kancalar
  // koşullu çağrılamıyor, yani "sıra bende değil" hâli ancak gövdeyi hiç mount
  // etmeyerek karşılanabilir. Gerekçenin tamamı `../instancing/admission`.
  const admitted = useAdmitted(node.id)
  if (!admitted) return null
  return <ConveyorCurveRendererBody node={node} />
}

function ConveyorCurveRendererBody({ node }: { node: ConveyorCurveNode }) {
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

  /** Whether the module standing downstream builds the shared support. One at
   *  every joint, not two — see `../conveyor/parts`. */
  const abutted = useScene((s) => hasDownstreamNeighbour(s.nodes as Record<string, unknown>, node))

  const appearance = useAppearance()
  const material = getConveyorMaterial(appearance)

  // Kolektif çiziciye katılım ve gerekçesi `./renderer.tsx`'te; eşikler de
  // oradan, çünkü bir hattın ortasında iki komşunun farklı katmana düşmesi
  // görünür bir dikiş demek olurdu.
  const selected = useViewer((s) => isSelected(s.selection.selectedIds, node.id))
  const drawsSelf = useCollective({
    nodeId: node.id,
    objectRef: registeredRef,
    geometryFor: (tier) => getCurveGeometry(node, tier, abutted),
    keyFor: (tier) => curveGeometryKey(node, tier, abutted),
    materialFor: () => material,
    materialKeyFor: () => `conveyor:${appearanceKey(appearance)}`,
    castsShadow: false,
    farSq: LOD_FAR_SQ,
    nearSq: LOD_NEAR_SQ,
    excluded: selected || live !== undefined || override !== undefined || isExporting,
  })

  /** Tell the cache this shape is on screen. Eviction must never free a buffer
   *  something is drawing, and this is the only place that knows. */
  useEffect(() => {
    const near = retainCurveGeometry(node, 'full', abutted)
    const far = retainCurveGeometry(node, 'simple', abutted)
    return () => {
      releaseGeometry(near)
      releaseGeometry(far)
    }
  }, [node, abutted])

  /**
   * The picker follows the arc rather than wrapping it.
   *
   * A bend is mostly air — a click between the rollers would otherwise select
   * the floor — but its bounding box is mostly air *too*, and a single collider
   * would swallow clicks aimed at whatever sits in the corner the bend curls
   * around. These are inside the transformed group, so they inherit the node's
   * position and rotation and only carry their own local offsets.
   */
  const colliders = useMemo(() => colliderSegments(node), [node])
  const colliderHeight = Math.max(0.2, node.transportHeight + node.sideGuideHeight)

  /**
   * Havuz çizerken bu alt ağaç ekranda hiçbir şey yapmıyor ama three onu her
   * karede renk ve gölge geçidinde geziyor. `visible = false` onu
   * `projectObject`'ten tamamen düşürüyor; seçim ve gölge sınırları
   * etkilenmiyor (raycaster ve `Box3.expandByObject` `visible`'a bakmıyor).
   *
   * Bayrak ŞART: havuzun görünürlük taraması (`isEffectivelyVisible`) onsuz
   * "kolektif gizledi"yi "kullanıcı gizledi"den ayıramaz ve bütün aileyi
   * havuzdan düşürür — ekranda tek modül kalmaz. JSX `userData` prop'u
   * olarak yazılamaz: R3F nesnenin tamamını değiştirip host'un yazdığı
   * anahtarları siler.
   */
  const hidden = !drawsSelf
  const userHidden = node.visible === false
  useLayoutEffect(() => {
    const object = registeredRef.current
    if (object) object.userData[HIDDEN_FOR_COLLECTIVE] = hidden && !userHidden
  }, [hidden, userHidden])

  return (
    <group ref={wrapperRef} {...handlers}>
      <group
        position={position}
        ref={registeredRef}
        rotation={rotation}
        visible={!userHidden && !hidden}
      >
        {!isExporting &&
          colliders.map((segment, index) => (
            <Collider
              key={`${segment.rotationY}:${index}`}
              position={[segment.center[0], colliderHeight / 2, segment.center[1]]}
              rotation={[0, segment.rotationY, 0]}
              size={[segment.size[0], colliderHeight, segment.size[1]]}
            />
          ))}

        {drawsSelf && (
          <SelfDrawnBody
            farSq={LOD_FAR_SQ}
            geometryFor={(tier) => getCurveGeometry(node, tier, abutted)}
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
