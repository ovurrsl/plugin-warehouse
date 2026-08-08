'use client'

import {
  type AnyNodeId,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import type * as THREE from 'three'
import { appearanceKey, useAppearance } from '../appearance'
import { Collider } from '../collider'
import { useFrozenMatrix } from '../frozen-matrix'
import { useAdmitted } from '../instancing/admission'
import { SelfDrawnBody } from '../instancing/self-drawn'
import { useCollective } from '../instancing/use-collective'
import { isSelected } from '../selection'
import { useStaticTransform } from '../static-transform'
import { benchGeometryKey, getBenchGeometry, releaseGeometry, retainGeometry } from './geometry'
import { getBenchMaterial } from './materials'
import { depthM, overallHeightM, widthM } from './metrics'
import type { BenchNode } from './schema'

/**
 * Katman bandı, metre — karekökten kaçınmak için karesi alınmış.
 *
 * Rafın 70/55'i ile paletin 25/18'i arasında ve palete yakın: bir tezgâh
 * 1,2–2 m'lik bir mobilya, rafın 6 m'lik iskeleti değil. Bandın GENİŞ olması
 * (8 m histerezis) tek eşiğin ürettiği titremeyi imkânsız kılıyor — tam
 * eşikte duran bir masa her kamera nefesinde katman değiştirirdi.
 *
 * SEÇİLMİŞ VARSAYILAN: ölçülmedi, ailenin ölçeğine bakarak seçildi.
 */
const LOD_FAR_SQ = 30 * 30
const LOD_NEAR_SQ = 22 * 22

/**
 * Paketleme / işleme tezgâhı — altı varyantın tek renderer'ı.
 *
 * `def.renderer: { kind: 'parametric' }` ile mount ediliyor, `def.geometry`
 * ile değil: `<GeometrySystem>` her yeniden inşada bir önceki yapının
 * çocuklarını dispose ediyor, ve buradaki geometri aynı şekle çözülen her
 * tezgâhla PAYLAŞILIYOR — bir yerdeki yeniden inşa kırk masanın çizdiği
 * buffer'ı serbest bırakır ve hepsini aynı anda karartırdı.
 */
export default function BenchRenderer({ node }: { node: BenchNode }) {
  // Kademeli mount kapısı. Gövde AYRI bileşende olmak ZORUNDA: pahalı iş
  // onun kancalarında ve kancalar koşullu çağrılamıyor, yani "sıra bende
  // değil" hâli ancak gövdeyi hiç mount etmeyerek karşılanabilir.
  const admitted = useAdmitted(node.id)
  if (!admitted) return null
  return <BenchRendererBody node={node} />
}

function BenchRendererBody({ node }: { node: BenchNode }) {
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

  // Duran tezgâh three'nin kare başına matris yeniden hesabından çıkar; canlı
  // sürükleme ya da override varken bayrak three'ye geri döner. `isLive`
  // ifadesi JSX'i süren okumanın AYNISI olmak zorunda — ayrışırsa sürüklenen
  // masa donar (`../static-transform`).
  useStaticTransform(
    registeredRef,
    position,
    rotation,
    live !== undefined || override !== undefined,
  )

  const appearance = useAppearance()
  const material = getBenchMaterial(appearance)

  /**
   * Seçili ya da sürükleniyorsa kendi çizer: sürüklenen bir düğümün matrisi
   * her kare değişiyor ve havuzu her kare yeniden kurmak, kurtardığından
   * pahalıya gelir.
   */
  const selected = useViewer((s) => isSelected(s.selection.selectedIds, node.id))
  const drawsSelf = useCollective({
    nodeId: node.id,
    objectRef: registeredRef,
    geometryFor: (tier) => getBenchGeometry(node, tier),
    keyFor: (tier) => benchGeometryKey(node, tier),
    materialFor: () => material,
    materialKeyFor: () => `bench:${appearanceKey(appearance)}`,
    // Ailenin kararı: eklenti nesneleri gölge düşürmüyor (515b47b).
    castsShadow: false,
    farSq: LOD_FAR_SQ,
    nearSq: LOD_NEAR_SQ,
    excluded: selected || live !== undefined || override !== undefined || isExporting,
  })

  /**
   * Şeklin ekranda olduğunu önbelleğe söyle. Havuz sınırlı — bir kaydırıcı
   * sürtmesi adım başına bir geometri basıyor — ve tahliye çizilen bir
   * buffer'ı asla serbest bırakmamalı. Bunu bilen tek yer burası.
   */
  useEffect(() => {
    const near = retainGeometry(benchGeometryKey(node, 'full'))
    const far = retainGeometry(benchGeometryKey(node, 'simple'))
    return () => {
      releaseGeometry(near)
      releaseGeometry(far)
    }
  }, [node])

  const width = widthM(node)
  const depth = depthM(node)
  const height = overallHeightM(node)

  return (
    <group ref={wrapperRef} {...handlers}>
      <group
        position={position}
        ref={registeredRef}
        rotation={rotation}
        visible={node.visible !== false}
      >
        {/* Seçim kolideri: bir tezgâh çoğunlukla boşluk — tabla ile zemin
            arasına nişan alan tıklama ayakların arasından geçip arkadaki
            şeyi seçerdi. Zarf `overallHeightM`, üst rafı da kapsıyor. */}
        {!isExporting && <Collider position={[0, height / 2, 0]} size={[width, height, depth]} />}

        {/* Kolektif kapalıyken ya da bu düğüm seçili/sürükleniyorken kendi
            mesh'ini çizer; açıkken tek `InstancedMesh` onun yerine çizer ve
            burası boş kalır. İkisi birden çizerse z-savaşı olur. */}
        {drawsSelf && (
          <SelfDrawnBody
            farSq={LOD_FAR_SQ}
            geometryFor={(tier) => getBenchGeometry(node, tier)}
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
