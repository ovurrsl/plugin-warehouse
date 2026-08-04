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
import { colliderProps } from '../collider'
import { useCollective } from '../instancing/use-collective'
import { useStaticTransform } from '../static-transform'
import ExplodedTiers from './exploded-tiers'
import {
  getMezzanineGeometry,
  mezzanineGeometryKey,
  releaseGeometry,
  retainGeometry,
} from './geometry'
import { getMezzanineMaterial } from './materials'
import { footprintDepthM, footprintWidthM, totalHeightM } from './metrics'
import { tierCount } from './parts'
import type { MezzanineNode } from './schema'

const NO_RAYCAST = () => {}

/**
 * Mezzanine — TEK birleşik mesh (rack deseni, telescopic'in bölüm-başına-grup
 * deseni DEĞİL): tier'ler animasyonlu değil, bir düzenleme yalnız panelden
 * gelir, dolayısıyla mutlak Y konumlarını doğrudan vertex'lere yazmanın
 * ekstra karmaşıklığı yok.
 *
 * Faz 1'de LOD tier'i yok — rack'ın LOD'u binlerce tekrardan değer kazanıyor,
 * bir sahnede bir-iki mezzanine için bu maliyet henüz gerekçesiz.
 */
export default function MezzanineRenderer({ node }: { node: MezzanineNode }) {
  const registeredRef = useRef<THREE.Object3D>(null!)
  const meshRef = useRef<THREE.Mesh>(null)
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id as AnyNodeId, node.type, registeredRef)

  const isExporting = useViewer(
    (s) => (s as typeof s & { isExporting?: boolean }).isExporting ?? false,
  )

  /**
   * Patlatılmış görünüm — SİSTEMİ dinliyor.
   *
   * Host'un `levelMode`'u `useViewer`'da yaşıyor ve bina katlarını ayıran şey
   * o. Asma kat da onu okuyup KENDİ katlarını ayırıyor: ayrı bir anahtar
   * olsaydı, kullanıcı patlatmayı açtığında yapının bir kısmı açılır bir kısmı
   * kapalı kalırdı.
   *
   * İhracatta ayrılma YOK: bir PDF/GLB çıktısı yapıyı gerçek hâliyle taşımalı.
   */
  const exploded = useViewer((s) => s.levelMode === 'exploded') && !isExporting
  const tiers = tierCount(node)

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

  const geometry = getMezzanineGeometry(node)
  const appearance = useAppearance()
  const material = getMezzanineMaterial(appearance)

  const selected = useViewer((s) => s.selection.selectedIds.includes(node.id as AnyNodeId))
  const drawsSelf = useCollective({
    nodeId: node.id,
    objectRef: registeredRef,
    geometryFor: () => getMezzanineGeometry(node),
    keyFor: () => mezzanineGeometryKey(node),
    materialFor: () => material,
    materialKeyFor: () => `mezzanine:${appearanceKey(appearance)}`,
    castsShadow: true,
    /**
     * Bu kind'ın LOD'u YOK — ve eşikleri sonsuz yapmak bir ihmal değil, bir
     * düzeltme.
     *
     * `90*90 / 70*70` yazıyordu, ama `geometryFor` ve `keyFor` katmanı hiç
     * okumuyor: iki katman da aynı geometri, aynı anahtar. Sonuç ölçülebilir
     * bir israftı — 70–90 m bandını geçen HER asma kat `evaluateTiers`'a
     * `changed = true` döndürüyor, o da `rebuildPools`'u tetikliyordu. Yani
     * kameranın bir asma katın yanından geçmesi, ekrandaki HİÇBİR şey
     * değişmeden bütün kolektif havuzu (raflar, paletler, konveyörler dâhil)
     * baştan kurduruyordu.
     *
     * Sonsuz eşikle katman `'full'`de sabitlenir: `distSq > Infinity` hiçbir
     * zaman doğru olmaz, dolayısıyla bu kind bir daha yeniden inşa tetiklemez.
     * Asma kata gerçek bir uzak katman yazılırsa eşikler o zaman gerçek
     * sayılara döner.
     */
    farSq: Number.POSITIVE_INFINITY,
    nearSq: Number.POSITIVE_INFINITY,
    /**
     * Patlatma açıkken kolektiften ÇIKIYOR.
     *
     * Havuz, yeniden inşa anında her düğümün dünya matrisini DONDURUYOR
     * (`collective.ts` `scratchMatrix.copy(object.matrixWorld)`), yani her kare
     * yer değiştiren katları taşıyamaz. Alternatif — her karede havuzu yeniden
     * kurdurmak — bütün sahnenin (raflar, paletler, konveyörler) havuzunu
     * lerp süresince kare başına bir kez yeniden inşa etmek olurdu.
     *
     * Bir sahnede bir-iki asma kat var; patlatma açıkken onları kendi çizmek
     * birkaç çizim çağrısı. Doğru kaldıraç bu.
     */
    excluded: selected || exploded || live !== undefined || override !== undefined || isExporting,
  })

  // Havuzun tahliye kuralı görünürken cache'i bilgilendirir — telescopic'in
  // deseni. Yalnız tek katman (Faz 1'de LOD yok).
  useEffect(() => {
    const key = retainGeometry(mezzanineGeometryKey(node))
    return () => releaseGeometry(key)
  }, [node])

  const width = footprintWidthM(node)
  const depth = footprintDepthM(node)
  const height = totalHeightM(node)

  return (
    <group visible={node.visible !== false} {...handlers}>
      <group position={position} ref={registeredRef} rotation={rotation}>
        {!isExporting && (
          <mesh position={[0, height / 2, 0]} {...colliderProps([width, height, depth])} />
        )}
        {/*
          Patlatılmışken kat başına bir grup, kapalıyken tek birleşik mesh —
          ama İKİSİ DE `drawsSelf`in altında, ve bu bir tekrar değil bir
          doğruluk: patlatma `excluded`ı zaten kuruyor, yani o daldayken
          düğüm kendi çiziyor. İki dalı `drawsSelf`in dışına almak, kolektifin
          kapattığı gövdenin ne olduğunu gizlerdi — `instancing/coverage.test`
          tam olarak bunu ölçüyor ve ilk yazımda kaymayı yakaladı.

          `ExplodedTiers` koşullu MOUNT ediliyor: `useFrame` koşullu
          çağrılamaz ama bir bileşen koşullu mount edilebilir, yani patlatma
          kapalıyken ne kare döngüsü ne kat geometrisi var.
        */}
        {drawsSelf &&
          (exploded ? (
            <ExplodedTiers node={node} tierCount={tiers} />
          ) : (
            <mesh
              /**
               * Koşulsuz. `castShadow={isExporting}` idi ve kolektif kayıt
               * `castsShadow: true` diyordu — yani asma kat, KENDİ çizerken
               * (seçili ya da sürükleniyorken) gölge atmıyor, kolektif çizerken
               * atıyordu. Kullanıcının gördüğü: asma katı seçince gölgesi
               * kayboluyor. Gölgeyi host `shadowMap.enabled` üstünden yönetiyor;
               * mesh düzeyinde ikinci bir karar noktası olmamalı.
               */
              castShadow
              dispose={null}
              geometry={geometry}
              material={material}
              raycast={NO_RAYCAST}
              receiveShadow
              ref={meshRef}
            />
          ))}
      </group>
    </group>
  )
}
