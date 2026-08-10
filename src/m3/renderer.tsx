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
import { getRackMaterial } from '../rack/materials'
import { isSelected } from '../selection'
import { useStaticTransform } from '../static-transform'
import { totalDepth, totalWidth } from './bays'
import {
  getM3Geometry,
  m3GeometryKey,
  releaseM3Geometry,
  retainM3Geometry,
} from './geometry-builder'
import { hasRightNeighbour } from './neighbours'
import type { M3ShelvingNode } from './schema'

/**
 * The same distance band as the other three racking kinds, deliberately.
 *
 * An M3 run usually stands in the same picking area as selective racking and
 * M7 bays, and four kinds swapping tier at four distances would draw visible
 * lines across the building where one family went plain and the others did not.
 */
const LOD_FAR_SQ = 70 * 70
const LOD_NEAR_SQ = 55 * 55

/**
 * Mounted through `def.renderer` rather than `def.geometry`: `<GeometrySystem>`
 * disposes the previous build's children on every rebuild, and the geometry
 * here is shared by every bay of the same shape.
 *
 * The material is the **rack's**. M3 steel reads the same punched-slot atlas,
 * and a second material would mean a second shader compile and a second draw
 * call in every scene holding both.
 */
export default function M3Renderer({ node }: { node: M3ShelvingNode }) {
  // Kademeli mount kapısı. Gövde AYRI bileşende olmak ZORUNDA: pahalı iş onun
  // kancalarında (kayıt, olay bağlama, havuza kayıt, geometri tutma) ve kancalar
  // koşullu çağrılamıyor, yani "sıra bende değil" hâli ancak gövdeyi hiç mount
  // etmeyerek karşılanabilir. Gerekçenin tamamı `../instancing/admission`.
  const admitted = useAdmitted(node.id)
  if (!admitted) return null
  return <M3RendererBody node={node} />
}

function M3RendererBody({ node }: { node: M3ShelvingNode }) {
  const registeredRef = useRef<THREE.Object3D>(null!)
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id as AnyNodeId, node.type, registeredRef)

  // Olay sarmalayıcısı: dönüşümsüz, ama auto-update açık kaldığı sürece bedava
  // değil — her karede kendi `compose`'unu yapıp `force`'u çocuklara yayar ve
  // altındaki donmuş çarpıştırıcı ile kayıtlı grubun kazandığını geri verir.
  // Bkz. `../frozen-matrix`.
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

  useStaticTransform(
    registeredRef,
    position,
    rotation,
    live !== undefined || override !== undefined,
  )

  const abutted = useScene((s) => hasRightNeighbour(s.nodes as Record<string, unknown>, node.id))
  const omission = useMemo(() => ({ omitRight: abutted }), [abutted])

  const appearance = useAppearance()
  const material = getRackMaterial(appearance)

  const selected = useViewer((s) => isSelected(s.selection.selectedIds, node.id))
  const drawsSelf = useCollective({
    nodeId: node.id,
    objectRef: registeredRef,
    geometryFor: (tier) => getM3Geometry(node, tier, omission),
    keyFor: (tier) => m3GeometryKey(node, tier, omission),
    materialFor: () => material,
    // The same pool as the other racking kinds: identical material, and
    // splitting them would double the draw calls of a mixed scene.
    materialKeyFor: () => `rack:${appearanceKey(appearance)}`,
    farSq: LOD_FAR_SQ,
    nearSq: LOD_NEAR_SQ,
    excluded: selected || live !== undefined || override !== undefined || isExporting,
  })

  useEffect(() => {
    const near = retainM3Geometry(node, 'full', omission)
    const far = retainM3Geometry(node, 'simple', omission)
    return () => {
      releaseM3Geometry(near)
      releaseM3Geometry(far)
    }
  }, [node, omission])

  const width = totalWidth(node)
  const depth = totalDepth(node)

  /**
   * Havuz bu bayı çiziyorken alt ağaç render gezinişinden tümden DÜŞER:
   * `_projectObject` özyinelemeyi `visible === false`'ta, çocuklara hiç inmeden
   * kesiyor. Ölçüm ve tam gerekçe rafın renderer'ında — kaybedilen bir şey yok,
   * çünkü ne three'nin ışın testi ne de gölge frustum'unun
   * `Box3.expandByObject` birleşimi `visible`'a bakıyor.
   *
   * `drawsSelf` true olduğunda — seçili, sürükleniyor, dışa aktarım ya da toplu
   * çizim kapalı — grup yeniden görünür olmak ZORUNDA, yoksa o hâlde hiç
   * çizilmez.
   */

  return (
    <group {...handlers} ref={wrapperRef}>
      {/* Seçim çarpıştırıcısı — bir bay çoğunlukla hava, ona nişan alan tıklama
          rafların arasından geçip arkadakini vurur. Kayıtlı grubun İÇİNDE:
          dışarıda dururken havuz açıkken grubun içi boş kaldığı için bay gölge
          frustum'u birleşimine hiç katkı vermiyordu; ölçümü
          `rack/renderer.tsx`'te. */}
      <group
        position={position}
        ref={registeredRef}
        rotation={rotation}
        visible={node.visible !== false}
      >
        {!isExporting && (
          <Collider
            position={[0, node.frameHeight / 2, 0]}
            size={[width, node.frameHeight, depth]}
          />
        )}
        {drawsSelf && (
          <SelfDrawnBody
            farSq={LOD_FAR_SQ}
            geometryFor={(tier) => getM3Geometry(node, tier, omission)}
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
