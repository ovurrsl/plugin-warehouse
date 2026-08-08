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
import * as THREE from 'three'
import { useAppearance } from '../appearance'
import { Collider } from '../collider'
import { useFrozenMatrix } from '../frozen-matrix'
import { useAdmitted } from '../instancing/admission'
import { useStaticTransform } from '../static-transform'
import { lodScaleSq } from '../store'
import { PLATFORM_PLATE_M } from './catalog'
import {
  dockLevellerDeckKey,
  dockLevellerFrameKey,
  dockLevellerLipKey,
  getDockLevellerDeckGeometry,
  getDockLevellerFrameGeometry,
  getDockLevellerLipGeometry,
  releaseGeometry,
  retainGeometry,
} from './geometry'
import { getDockLevellerMaterial } from './materials'
import {
  aboveFloorHeightM,
  deckAngleRad,
  hingedLipAngleRad,
  lipFullLengthM,
  lipReachM,
  platformLengthM,
  widthM,
} from './metrics'
import type { DockLevellerNode } from './schema'

const NO_RAYCAST = () => {}

/**
 * Katman bandı, metre — karekökten kaçınmak için karesi alınmış. Rampa 2–4,5
 * metrelik bir yer kaplıyor ama zemine YATIK: uzaktan bakıldığında bir
 * dikdörtgen. Bant bu yüzden rafınkinden (70/55) yakın, konveyörünkine
 * (55/42) benzer. SEÇİLMİŞ VARSAYILAN: ölçülmedi.
 */
const LOD_FAR_SQ = 45 * 45
const LOD_NEAR_SQ = 34 * 34
const LOD_INTERVAL = 8

const worldPosition = new THREE.Vector3()

function hashPhase(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % LOD_INTERVAL
}

/**
 * Kademeli mount kapısı — ailenin şablonu, aynı gerekçeyle: gövdenin pahalı
 * işi kancalarında ve kancalar koşullu çağrılamaz.
 */
export default function DockLevellerRenderer({ node }: { node: DockLevellerNode }) {
  const admitted = useAdmitted(node.id)
  if (!admitted) return null
  return <DockLevellerBody node={node} />
}

/**
 * Yükleme rampası — üç gövde, üç dönüşüm.
 *
 * ## Neden kolektif havuza girmiyor
 *
 * Havuz düğüm başına TEK bir nesne kaydediyor ve onun dünya matrisini
 * örneğe yazıyor. Burada düğüm başına üç gövde var ve üçü BİRBİRİNE GÖRE
 * hareket ediyor (tabla menteşede, dudak tablanın burnunda) — tek matrisle
 * anlatılamaz. Teleskopik bomun bölümleri de aynı sebeple havuz dışında.
 * Bedeli düşük: rampa kapı başına bir tane, bir depoda onlarca.
 *
 * ## Hareket geometriye GİRMİYOR
 *
 * Eğim ve dudak uzanımı grup dönüşümü; vertex'ler dinlenme çerçevesinde.
 * Aksi hâlde eğim kaydırıcısının her adımı yeni bir merged buffer basardı.
 */
function DockLevellerBody({ node }: { node: DockLevellerNode }) {
  const registeredRef = useRef<THREE.Object3D>(null!)
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id as AnyNodeId, node.type, registeredRef)

  // Dönüşümsüz olay sarmalayıcısı: auto-update kaldığı sürece her karede
  // kendi `compose`'unu yapıp `force`'u çocuklara yayar ve altındaki donmuş
  // grupların kazancını geri verir. Bkz. `../frozen-matrix`.
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

  const appearance = useAppearance()
  const material = getDockLevellerMaterial(appearance)

  const length = platformLengthM(node)
  const width = widthM(node)
  const height = aboveFloorHeightM(node)

  // Tablanın menteşedeki pozu ve dudağın tabladaki pozu — ikisi de KOŞULSUZ
  // donuyor. Düğüm sürüklenirken bile doğru: sürüklenen şey ATA grubu, ve
  // three atanın `force`'unu bütün alt ağaca yayıyor, yani donmuş yerel
  // matris yine de doğru dünya matrisini üretiyor. Hareket eden tek şey
  // grupların KENDİ dönüşümü olsaydı bu yanlış olurdu; onlar da yalnız
  // düğüm verisi değişince değişiyor.
  const deckRef = useRef<THREE.Object3D>(null)
  const deckAngle = deckAngleRad(node)
  const deckPosition = useMemo((): [number, number, number] => [-length / 2, 0, 0], [length])
  const deckRotation = useMemo((): [number, number, number] => [0, 0, deckAngle], [deckAngle])
  useStaticTransform(deckRef, deckPosition, deckRotation, false)

  /**
   * Dudağın tabladaki yeri — iki dudak tipi iki AYRI hareket.
   *
   * Menteşeli dudak burunda katlanıyor: yeri sabit (`x = L`), açısı değişiyor.
   * Teleskopik dudak katlanmıyor, tablanın altındaki cepten KAYARAK çıkıyor:
   * açısı sabit, yeri değişiyor — ve çekili kısmı tablanın altında kalsın
   * diye bir tabla sacı kadar aşağıda duruyor. Bu, dorseye inen yüzeyde
   * 12 mm'lik bir basamak bırakıyor; gerçek makinede de öyle, dudak sacı
   * tablanın altından çıkıyor.
   */
  const lipRef = useRef<THREE.Object3D>(null)
  const telescopic = node.lip === 'telescopic'
  const hidden = lipFullLengthM(node) - lipReachM(node)
  const lipPosition = useMemo(
    (): [number, number, number] =>
      telescopic ? [length - hidden, -PLATFORM_PLATE_M, 0] : [length, 0, 0],
    [telescopic, length, hidden],
  )
  const lipAngle = telescopic ? 0 : hingedLipAngleRad(node)
  const lipRotation = useMemo((): [number, number, number] => [0, 0, lipAngle], [lipAngle])
  useStaticTransform(lipRef, lipPosition, lipRotation, false)

  const frameMeshRef = useRef<THREE.Mesh>(null)
  const deckMeshRef = useRef<THREE.Mesh>(null)
  const lipMeshRef = useRef<THREE.Mesh>(null)
  const detailRef = useRef<'full' | 'simple'>('full')
  const frameCountRef = useRef(0)
  const phase = useMemo(() => hashPhase(node.id), [node.id])

  useFrame(({ camera }) => {
    const root = registeredRef.current
    if (!root || isExporting) return
    frameCountRef.current += 1
    if ((frameCountRef.current + phase) % LOD_INTERVAL !== 0) return

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
    if (next === current) return
    detailRef.current = next
    if (frameMeshRef.current) {
      frameMeshRef.current.geometry = getDockLevellerFrameGeometry(node, next)
    }
    if (deckMeshRef.current) deckMeshRef.current.geometry = getDockLevellerDeckGeometry(node, next)
    if (lipMeshRef.current) lipMeshRef.current.geometry = getDockLevellerLipGeometry(node, next)
  })

  /**
   * Altı şekil de ekranda sayılıyor: tahliye çizilen bir buffer'ı asla
   * serbest bırakmamalı, ve LOD her an öteki katmana geçebilir.
   */
  useEffect(() => {
    const keys = [
      retainGeometry(dockLevellerFrameKey(node, 'full')),
      retainGeometry(dockLevellerFrameKey(node, 'simple')),
      retainGeometry(dockLevellerDeckKey(node, 'full')),
      retainGeometry(dockLevellerDeckKey(node, 'simple')),
      retainGeometry(dockLevellerLipKey(node, 'full')),
      retainGeometry(dockLevellerLipKey(node, 'simple')),
    ]
    return () => {
      for (const key of keys) releaseGeometry(key)
    }
  }, [node])

  return (
    <group ref={wrapperRef} visible={node.visible !== false} {...handlers}>
      <group position={position} ref={registeredRef} rotation={rotation}>
        {/* Seçim kolideri: dinlenmede rampa zeminle aynı kotta, yani hacmi
            tabla sacı kadar ince. Yine de tıklanabilir — ışın üstten geliyor
            ve kutunun ÜST yüzü bütün izi kaplıyor. Kalkınca zarf onunla
            birlikte büyüyor. */}
        {!isExporting && <Collider position={[0, height / 2, 0]} size={[length, height, width]} />}

        <mesh
          dispose={null}
          geometry={getDockLevellerFrameGeometry(node, 'full')}
          material={material}
          raycast={NO_RAYCAST}
          receiveShadow
          ref={frameMeshRef}
        />

        <group ref={deckRef}>
          <mesh
            dispose={null}
            geometry={getDockLevellerDeckGeometry(node, 'full')}
            material={material}
            raycast={NO_RAYCAST}
            receiveShadow
            ref={deckMeshRef}
          />
          <group ref={lipRef}>
            <mesh
              dispose={null}
              geometry={getDockLevellerLipGeometry(node, 'full')}
              material={material}
              raycast={NO_RAYCAST}
              receiveShadow
              ref={lipMeshRef}
            />
          </group>
        </group>
      </group>
    </group>
  )
}
