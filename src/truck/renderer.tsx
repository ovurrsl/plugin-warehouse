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
import type { Mesh, Object3D } from 'three'
import { Vector3 } from 'three'
import { useAppearance } from '../appearance'
import { colliderProps } from '../collider'
import { useAdmitted } from '../instancing/admission'
import { useStaticTransform } from '../static-transform'
import { getTruckGeometry, releaseTruckGeometry, retainTruckGeometry } from './geometry'
import { mastPose } from './kinematics'
import { getTruckMaterial } from './materials'
import { mastRowOf, modelOf, overallHeightM, planLengthM, planWidthM } from './metrics'
import { bodiesOf, type TruckDetail } from './parts'
import type { TruckNode } from './schema'

const NO_RAYCAST = () => {}

/**
 * Rafın 70/55'i ile paletin 25/18'i arasında: araç raf kadar büyük değil ama
 * palet gibi yüzlerce de değil. Histerezis bandı aynı gerekçeyle var — tek
 * eşik, tam o mesafede duran araca her kamera nefesinde katman değiştirtir.
 */
const LOD_FAR_SQ = 45 * 45
const LOD_NEAR_SQ = 35 * 35
const LOD_INTERVAL = 8

const worldPosition = new Vector3()

function hashPhase(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % LOD_INTERVAL
}

/**
 * Pallet'in deseninde kayıtlı grup + paylaşımlı buffer'lar: geometri modül
 * seviyesi tekil olduğu için mount `def.renderer` üzerinden, `dispose={null}`
 * ile — `<GeometrySystem>` bir yeniden inşada paylaşılan buffer'ı serbest
 * bırakır ve bütün filo aynı anda kaybolurdu.
 *
 * Gövde grupları: `stage1` ve `carriage` kinematiğin verdiği Y'de durur;
 * vertex'ler dinlenme pozunda yazıldı, poz yalnız matristedir. Park hâlinde
 * bu ötelemeler sabittir ve React prop'u olarak bir kez uygulanır; filo
 * (dilim 6) aynı gruplara kare döngüsünden yazacak.
 */
/**
 * Kademeli mount kapısı — rack'in şablonu (`rack/renderer.tsx`), aynı
 * gerekçeyle: gövdenin pahalı işi kancalarında ve kancalar koşullu
 * çağrılamaz; "sıra bende değil" hâli ancak gövdeyi hiç mount etmeyerek
 * karşılanır. Bu kind düşük adetli, tavan (512) sayesinde normal sahnede
 * tek karede mount olur — kapı, dev sahnede yükleme dalgasına katılmak
 * ve "kolektif çizen her kind kapılı" kapsamını tamamlamak için.
 */
export default function TruckRenderer({ node }: { node: TruckNode }) {
  const admitted = useAdmitted(node.id)
  if (!admitted) return null
  return <TruckBody node={node} />
}

function TruckBody({ node }: { node: TruckNode }) {
  const registeredRef = useRef<Object3D>(null!)
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

  // Park hâlindeki araç matris yeniden hesabından çıkar; filo çalışırken
  // `live` tanımlı olur ve bayrak kendiliğinden `true` düşer (§3.6) —
  // donmuş araç da, boşa optimizasyon da yapısal olarak imkânsız.
  useStaticTransform(
    registeredRef,
    position,
    rotation,
    live !== undefined || override !== undefined,
  )

  const model = modelOf(node.model)
  const mastRow = mastRowOf(node.mastRowId)
  /**
   * Memoize, ve sebep tahsis değil: `bodiesOf` her çağrıda taze dizi döndürür
   * ve aşağıdaki retain efektinin dep'i. Taze kimlik, efekti HER render'da
   * söküp kuruyordu — render başına ~10 retain + 10 release, ve release
   * tahliye sayacını sıfıra düşürdüğü için geometri o pencerede tahliyeye
   * açık kalıyordu. Filo sürerken render ≈ kare demek.
   */
  const bodies = useMemo(() => bodiesOf(model), [model])
  const pose = mastPose(mastRow, node.forkHeight)

  const meshRefs = useRef<Map<string, Mesh>>(new Map())
  const detailRef = useRef<TruckDetail>('full')
  const frameRef = useRef(0)
  const phase = useMemo(() => hashPhase(node.id), [node.id])
  const appearance = useAppearance()
  const material = getTruckMaterial(appearance)

  // Her gövdenin İKİ katmanı da ekranda sayılır: tahliye çizileni boşaltamaz
  // ve katman geçişi inşa beklemez.
  useEffect(() => {
    const keys = bodies.flatMap((body) => [
      retainTruckGeometry(node.model, node.mastRowId, body, 'full'),
      retainTruckGeometry(node.model, node.mastRowId, body, 'simple'),
    ])
    return () => {
      for (const key of keys) releaseTruckGeometry(key)
    }
  }, [node.model, node.mastRowId, bodies])

  useFrame(({ camera }) => {
    const root = registeredRef.current
    if (!root || isExporting) return
    frameRef.current += 1
    if ((frameRef.current + phase) % LOD_INTERVAL !== 0) return

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
    if (next === current) return
    detailRef.current = next
    for (const body of bodies) {
      const mesh = meshRefs.current.get(body)
      if (!mesh) continue
      mesh.geometry = getTruckGeometry(node.model, node.mastRowId, body, next)
    }
  })

  const height = overallHeightM(model, mastRow)
  const length = planLengthM(model)
  const width = planWidthM(model)

  return (
    <group visible={node.visible !== false} {...handlers}>
      {/* Seçim kolideri: gövdeler arasında boşluk çok (mast rayları, çatal
          araları) — kullanıcının nişan aldığı şey zarfın kendisi. */}
      {!isExporting && (
        <mesh
          {...colliderProps([length, height, width])}
          position={[position[0], position[1] + height / 2, position[2]]}
          rotation={rotation}
        />
      )}

      <group position={position} ref={registeredRef} rotation={rotation}>
        {bodies.map((body) => {
          const offsetY =
            body === 'stage1'
              ? pose.stage1Y
              : body === 'carriage'
                ? pose.stage1Y + pose.carriageY
                : 0
          return (
            <group key={body} position={[0, offsetY, 0]}>
              <mesh
                dispose={null}
                /**
                 * Katman `detailRef`'ten okunur, SABİTLENMEZ.
                 *
                 * `'full'` yazılıydı ve rack'ın aynı hatayı düzeltirken
                 * anlattığı şey burada da geçerliydi: R3F prop'ları referansla
                 * karşılaştırıyor, yani memo yalnız farklı bir buffer
                 * ürettiğinde imperatif takası eziyor — ama eziyor. Uzaktaki
                 * bir araç, herhangi bir yeniden render'da (seçim, panel
                 * düzenlemesi) tam mesh'e geri dönüyor, `detailRef` hâlâ
                 * `'simple'` dediği için de `next === current` koruması
                 * kameranın histerezis bandını baştan sona geçmesine kadar
                 * yeniden düşürmeyi engelliyordu.
                 *
                 * Dışa aktarım mesafeye bağlı bir katmanı dosyaya pişirmemeli.
                 */
                geometry={getTruckGeometry(
                  node.model,
                  node.mastRowId,
                  body,
                  isExporting ? 'full' : detailRef.current,
                )}
                material={material}
                raycast={NO_RAYCAST}
                receiveShadow
                ref={(mesh) => {
                  if (mesh) meshRefs.current.set(body, mesh)
                  else meshRefs.current.delete(body)
                }}
              />
            </group>
          )
        })}
      </group>
    </group>
  )
}
