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
import {
  driveInGeometryKey,
  getDriveInGeometry,
  releaseDriveInGeometry,
  retainDriveInGeometry,
} from './geometry-builder'
import { frameTopY, totalDepth, totalWidth } from './lanes'
import { hasRightNeighbour } from './neighbours'
import type { DriveInRackNode } from './schema'

/**
 * Distance band at which a lane drops to its reduced tier, squared to keep the
 * per-frame test off the square root.
 *
 * The selective rack's figures, deliberately: a drive-in block usually stands
 * against a wall of selective racking, and two kinds swapping tier at different
 * distances would show a visible line across the building where one family went
 * plain and the other did not.
 */
const LOD_FAR_SQ = 70 * 70
const LOD_NEAR_SQ = 55 * 55

/**
 * Mounted through `def.renderer` rather than `def.geometry`, for the reason the
 * selective rack's renderer gives: `<GeometrySystem>` disposes the previous
 * build's children on every rebuild, and the geometry here is shared by every
 * lane of the same shape — so one rebuild anywhere would free the buffer a
 * whole block is drawing from and blank all of it at once.
 *
 * The material is the **rack's**, not a new one. Drive-in steel is the same
 * family reading the same punched-slot atlas, and a second material would mean
 * a second shader compile and a second draw call for every scene that holds
 * both kinds — which is every scene that holds this one.
 */
export default function DriveInRackRenderer({ node }: { node: DriveInRackNode }) {
  // Kademeli mount kapısı. Gövde AYRI bileşende olmak ZORUNDA: pahalı iş onun
  // kancalarında (kayıt, olay bağlama, havuza kayıt, geometri tutma) ve kancalar
  // koşullu çağrılamıyor, yani "sıra bende değil" hâli ancak gövdeyi hiç mount
  // etmeyerek karşılanabilir. Gerekçenin tamamı `../instancing/admission`.
  const admitted = useAdmitted(node.id)
  if (!admitted) return null
  return <DriveInRackRendererBody node={node} />
}

function DriveInRackRendererBody({ node }: { node: DriveInRackNode }) {
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

  // See `useStaticTransform`: three recomposes every registered group's local
  // matrix on every frame unless told otherwise, and a warehouse at rest has
  // thousands of these doing nothing.
  useStaticTransform(
    registeredRef,
    position,
    rotation,
    live !== undefined || override !== undefined,
  )

  /**
   * Whether the lane on this one's right builds the shared frame line.
   *
   * The index behind this is built once per store write and shared by every
   * lane; the selector narrows it to one boolean, so a lane re-renders only
   * when its *own* answer changes rather than on every scene edit.
   */
  const abutted = useScene((s) => hasRightNeighbour(s.nodes as Record<string, unknown>, node.id))
  const omission = useMemo(() => ({ omitRight: abutted }), [abutted])

  const appearance = useAppearance()
  const material = getRackMaterial(appearance)

  const selected = useViewer((s) => isSelected(s.selection.selectedIds, node.id))
  const drawsSelf = useCollective({
    nodeId: node.id,
    objectRef: registeredRef,
    geometryFor: (tier) => getDriveInGeometry(node, tier, omission),
    keyFor: (tier) => driveInGeometryKey(node, tier, omission),
    materialFor: () => material,
    // The same pool as the selective rack: identical material, and splitting
    // them would double the draw calls of a scene holding both.
    materialKeyFor: () => `rack:${appearanceKey(appearance)}`,
    farSq: LOD_FAR_SQ,
    nearSq: LOD_NEAR_SQ,
    excluded: selected || live !== undefined || override !== undefined || isExporting,
  })

  /**
   * Tell the cache both tiers are on screen. Eviction must never free a buffer
   * something is drawing, and a tier switch must not have to build one.
   */
  useEffect(() => {
    const near = retainDriveInGeometry(node, 'full', omission)
    const far = retainDriveInGeometry(node, 'simple', omission)
    return () => {
      releaseDriveInGeometry(near)
      releaseDriveInGeometry(far)
    }
  }, [node, omission])

  const width = totalWidth(node)
  const depth = totalDepth(node)

  /**
   * Havuz bu şeridi çiziyorken alt ağaç render gezinişinden tümden DÜŞER:
   * `_projectObject` özyinelemeyi `visible === false`'ta, çocuklara hiç
   * inmeden kesiyor. Ölçüm ve tam gerekçe rafın renderer'ında — kaybedilen bir
   * şey yok, çünkü ne three'nin ışın testi ne de gölge frustum'unun
   * `Box3.expandByObject` birleşimi `visible`'a bakıyor.
   *
   * `drawsSelf` true olduğunda — seçili, sürükleniyor, dışa aktarım ya da
   * toplu çizim kapalı — grup yeniden görünür olmak ZORUNDA, yoksa o hâlde
   * hiç çizilmez.
   */

  return (
    <group {...handlers} ref={wrapperRef}>
      {/* Seçim çarpıştırıcısı — bir şerit çoğunlukla hava, ona nişan alan
          tıklama rayların arasından geçip arkadakini vurur. Kayıtlı grubun
          İÇİNDE: dışarıda dururken havuz açıkken grubun içi boş kaldığı için
          şerit gölge frustum'u birleşimine hiç katkı vermiyordu; ölçümü
          `rack/renderer.tsx`'te. */}
      <group
        position={position}
        ref={registeredRef}
        rotation={rotation}
        visible={node.visible !== false}
      >
        {!isExporting && (
          <Collider position={[0, frameTopY(node) / 2, 0]} size={[width, frameTopY(node), depth]} />
        )}
        {drawsSelf && (
          <SelfDrawnBody
            farSq={LOD_FAR_SQ}
            geometryFor={(tier) => getDriveInGeometry(node, tier, omission)}
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
