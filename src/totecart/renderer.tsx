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
import {
  getToteCartFrameGeometry,
  getToteGeometry,
  releaseGeometry,
  retainGeometry,
  toteCartFrameKey,
  toteCartToteKey,
} from './geometry'
import { getToteCartMaterial } from './materials'
import { cartLengthM, cartWidthM, loadedTiersOf, overallHeightM, tierYM, tiltRad } from './metrics'
import type { ToteCartNode } from './schema'

const NO_RAYCAST = () => {}

/**
 * Katman bandı, metre — karekökten kaçınmak için karesi alınmış.
 *
 * Araba 0,6 × 0,4 m'lik bir taban izi: paketin en KÜÇÜK yerleştirilebilir
 * nesnesi, paletten bile küçük (25/18). Bant o yüzden dar — uzaktan zaten
 * birkaç piksel. SEÇİLMİŞ VARSAYILAN: ölçülmedi.
 */
const LOD_FAR_SQ = 22 * 22
const LOD_NEAR_SQ = 16 * 16
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

/** Kademeli mount kapısı — ailenin şablonu. */
export default function ToteCartRenderer({ node }: { node: ToteCartNode }) {
  const admitted = useAdmitted(node.id)
  if (!admitted) return null
  return <ToteCartBody node={node} />
}

/**
 * Toplama arabası — bir çerçeve, N kasa.
 *
 * ## Kasalar neden ayrı mesh
 *
 * Hepsi AYNI buffer'ı çiziyor, yalnız Y'leri farklı. Çerçeveye kaynatmak
 * her (kat sayısı × kasa boyu) kombinasyonu için ayrı bir kasa kopyası
 * basardı; ayrı tutmak beş katlı bir arabada beş çizim çağrısı ama TEK
 * buffer demek — ve o buffer sahnedeki her arabayla paylaşılıyor.
 *
 * ## Kolektif havuza girmiyor
 *
 * Havuz düğüm başına tek nesne kaydediyor; burada düğüm başına 1 + N gövde
 * var ve kasa sayısı düğümden düğüme değişiyor.
 */
function ToteCartBody({ node }: { node: ToteCartNode }) {
  const registeredRef = useRef<THREE.Object3D>(null!)
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id as AnyNodeId, node.type, registeredRef)

  // Dönüşümsüz olay sarmalayıcısı: auto-update kaldığı sürece `force`'u
  // çocuklara yayıp altındaki donmuş grupların kazancını geri verir.
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
  const material = getToteCartMaterial(appearance)

  const length = cartLengthM(node)
  const width = cartWidthM(node)
  const height = overallHeightM(node)

  /**
   * Kasaların yeri ve eğimi. Eğim GRUP dönüşümü, vertex değil: eğimi
   * geometriye yazmak eğimli ve düz arabaya iki ayrı kasa buffer'ı
   * bastırırdı, oysa ikisi aynı kasa.
   */
  const tilt = tiltRad(node)
  const totes = useMemo(() => {
    const count = loadedTiersOf(node)
    // Kasa eğik TEPSİNİN üstünde duruyor: ikisi de aynı eksende, aynı açıyla
    // ve aynı kat hattı etrafında dönüyor, yani kasanın tabanı tepsinin
    // yüzeyine birebir oturuyor. Ayrı bir kaldırma gerekmiyor — gerekiyor
    // olsaydı kasa eğik bir rafın üstünde değil havada asılı olurdu.
    return Array.from({ length: count }, (_, index) => ({
      index,
      y: tierYM(node, index),
    }))
  }, [node])

  const frameMeshRef = useRef<THREE.Mesh>(null)
  const toteMeshesRef = useRef<(THREE.Mesh | null)[]>([])
  const detailRef = useRef<ToteDetail>('full')
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
    if (frameMeshRef.current) frameMeshRef.current.geometry = getToteCartFrameGeometry(node, next)
    const toteGeometry = getToteGeometry(node, next)
    for (const mesh of toteMeshesRef.current) {
      if (mesh) mesh.geometry = toteGeometry
    }
  })

  /** Dört şekil de ekranda sayılıyor — tahliye çizilen buffer'ı almamalı. */
  useEffect(() => {
    const keys = [
      retainGeometry(toteCartFrameKey(node, 'full')),
      retainGeometry(toteCartFrameKey(node, 'simple')),
      retainGeometry(toteCartToteKey(node, 'full')),
      retainGeometry(toteCartToteKey(node, 'simple')),
    ]
    return () => {
      for (const key of keys) releaseGeometry(key)
    }
  }, [node])

  return (
    <group ref={wrapperRef} visible={node.visible !== false} {...handlers}>
      <group position={position} ref={registeredRef} rotation={rotation}>
        {/* Seçim kolideri: araba çoğunlukla boşluk — katlar arasına nişan
            alan tıklama çerçevenin arasından geçip arkadakini seçerdi. */}
        {!isExporting && <Collider position={[0, height / 2, 0]} size={[length, height, width]} />}

        {/* Katman `detailRef.current`'tan okunuyor, 'full' sabitinden DEĞİL.
            Sabit yazıldığında sessiz bir hata doğuyor: bir alan değişip
            geometri anahtarı yenilendiğinde React yeni buffer'ı prop olarak
            yazıyor ve mesh uzakta olmasına rağmen tam ayrıntıya dönüyor —
            LOD döngüsünün `if (next === current) return` kapısı da katmanı
            zaten 'simple' saydığı için onu bir daha asla düşürmüyor.
            `truck/renderer.tsx:222` aynı hatayı yaşamış ve aynı çözümü
            yazmış. */}
        <mesh
          dispose={null}
          geometry={getToteCartFrameGeometry(node, isExporting ? 'full' : detailRef.current)}
          material={material}
          raycast={NO_RAYCAST}
          ref={frameMeshRef}
        />

        {totes.map((tote) => (
          <mesh
            dispose={null}
            geometry={getToteGeometry(node, isExporting ? 'full' : detailRef.current)}
            key={tote.index}
            material={material}
            position={[0, tote.y, 0]}
            raycast={NO_RAYCAST}
            ref={(mesh) => {
              toteMeshesRef.current[tote.index] = mesh
            }}
            rotation={[tilt, 0, 0]}
          />
        ))}
      </group>
    </group>
  )
}

type ToteDetail = 'full' | 'simple'
