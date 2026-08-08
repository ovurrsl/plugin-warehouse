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
import { lodScaleSq, useWarehouseStore } from '../store'
import { FLOW_BOX_M } from './flow-simulation'
import { getFlowBoxMaterial, getLampLensMaterial, getTelescopicMaterial } from './materials'
import type { ConveyorDetail } from './parts'
import { TELESCOPIC_BELT_SPEED_EST_MS } from './telescopic-catalog'
import {
  getTelescopicBaseGeometry,
  getTelescopicSectionGeometry,
  releaseGeometry,
  retainGeometry,
  telescopicBaseKey,
  telescopicSectionKey,
} from './telescopic-geometry'
import {
  boomSections,
  boomTipX,
  currentLengthM,
  footprintCenterX,
  frameWidthM,
  LAMP_BEAM_APEX_ALPHA,
  LAMP_BEAM_LENGTH_M,
  LAMP_BEAM_MOUTH_RADIUS_M,
  LAMP_LENS_SIZE_M,
  lampBeamRotationZ,
  noseLamp,
  telescopicModelOf,
  transportHeightM,
} from './telescopic-metrics'
import type { ConveyorTelescopicNode } from './telescopic-schema'

const NO_RAYCAST = () => {}

const LOD_FAR_SQ = 55 * 55
const LOD_NEAR_SQ = 42 * 42
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

/** Bant üstündeki kutular — ailenin kraft kutusu, paylaşılan tekil geometri. */
const BOX_GEOMETRY = new THREE.BoxGeometry(...FLOW_BOX_M)

/** Merceğin gövdesi — ölçüsü de yeri de `telescopic-metrics`'ten. */
const LAMP_LENS_GEOMETRY = new THREE.BoxGeometry(...LAMP_LENS_SIZE_M)

/**
 * Işık hüzmesi — lambanın YANDIĞINI okutan şey.
 *
 * Yedi santimlik bir mercek, yirmi metrelik bir makinenin ucunda, normal
 * kamera mesafesinde birkaç piksel: yanıyor ama görünmüyor. Hüzme o boşluğu
 * kapatıyor ve makinenin ne yaptığını (karanlık dorsenin içini aydınlatmak)
 * tek bakışta söylüyor.
 *
 * GERÇEK bir ışık kaynağı DEĞİL, ve olmamalı: sahneye bir `spotLight`
 * eklemek three'ye bütün materyalleri yeniden derletir ve o materyaller bu
 * paketin tamamı tarafından paylaşılıyor — tek makine için bütün deponun
 * gölgelendirme maliyeti artardı. Hüzme toplamsal harmanlanan, ışık
 * hesabına hiç girmeyen tek bir saydam koni.
 *
 * Ayara BAĞLI DEĞİL, çünkü bir yüzey değil: `appearance` gölgeleme modelini
 * seçiyor, hüzmenin gölgelenecek bir yüzü yok. `MeshBasicMaterial`'in
 * `solid` ile `rendered` arasında değişecek hiçbir alanı yok.
 *
 * Ölçüleri ve yönü `telescopic-metrics`'te — yön oradan geliyor çünkü
 * işaretini ters yazmak hüzmeyi makinenin İÇİNE ve yukarı gönderir, ve bu
 * hiçbir hata vermez. Orada saf bir fonksiyon olarak durunca test edilebilir.
 */
function buildBeamGeometry(): THREE.BufferGeometry {
  // Açık uçlu: kapak, hüzmenin ucunda duran parlak bir disk olurdu.
  const cone = new THREE.ConeGeometry(LAMP_BEAM_MOUTH_RADIUS_M, LAMP_BEAM_LENGTH_M, 16, 1, true)
  // Tepe origin'e çekiliyor: ışık mercekten çıkar, koninin ortasından değil.
  cone.translate(0, -LAMP_BEAM_LENGTH_M / 2, 0)
  const position = cone.getAttribute('position')
  // Dört bileşenli renk: alfa vertex'te sönüyor. Sabit opaklıktaki bir koni
  // ışık gibi değil, dumandan bir külah gibi durur.
  const colors = new Float32Array(position.count * 4)
  for (let index = 0; index < position.count; index++) {
    const along = -position.getY(index) / LAMP_BEAM_LENGTH_M
    const alpha = LAMP_BEAM_APEX_ALPHA * (1 - along) ** 2
    colors[index * 4] = 1
    colors[index * 4 + 1] = 0.94
    colors[index * 4 + 2] = 0.72
    colors[index * 4 + 3] = alpha
  }
  cone.setAttribute('color', new THREE.BufferAttribute(colors, 4))
  return cone
}

const BEAM_GEOMETRY = buildBeamGeometry()
const BEAM_MATERIAL = new THREE.MeshBasicMaterial({
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
  // Ton eşlemesi hüzmeyi sahnenin pozlamasına bağlar; ışık kaynağı olarak
  // değil, çizilmiş bir efekt olarak duruyor.
  toneMapped: false,
  transparent: true,
  vertexColors: true,
})

/** Aynı anda bantta görünen en fazla kutu — C=25 m'de ~2 m arayla yeter. */
const MAX_BOXES = 14
const BOX_GAP_M = 2.1

const boxMatrix = new THREE.Matrix4()

/**
 * Teleskopik bant konveyör. Sabit gövde + uzamayla +X'e kayan bölümler;
 * bölüm vertex'leri dinlenme çerçevesinde, uzama yalnız grup X'i (aracın
 * mast kuralının aynısı — poz cache'e girmez).
 *
 * Kutu animasyonu AİLENİN düğmesine bağlı (`flowRunning`): hız tabloda
 * yayınlanmadığı için adlandırılmış tahminle sürülür ve panel bunu söyler.
 * Export sırasında kutular çizilmez — çıktı her zaman dosyadaki sahnedir.
 */
/**
 * Kademeli mount kapısı — rack'in şablonu (`rack/renderer.tsx`), aynı
 * gerekçeyle: gövdenin pahalı işi kancalarında ve kancalar koşullu
 * çağrılamaz; "sıra bende değil" hâli ancak gövdeyi hiç mount etmeyerek
 * karşılanır. Bu kind düşük adetli, tavan (512) sayesinde normal sahnede
 * tek karede mount olur — kapı, dev sahnede yükleme dalgasına katılmak
 * ve "kolektif çizen her kind kapılı" kapsamını tamamlamak için.
 */
export default function TelescopicRenderer({ node }: { node: ConveyorTelescopicNode }) {
  const admitted = useAdmitted(node.id)
  if (!admitted) return null
  return <TelescopicBody node={node} />
}

function TelescopicBody({ node }: { node: ConveyorTelescopicNode }) {
  const registeredRef = useRef<THREE.Object3D>(null!)
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id as AnyNodeId, node.type, registeredRef)

  // Dönüşümsüz olay sarmalayıcısı: auto-update kaldığı sürece her karede
  // kendi `compose`'unu yapıp `force`'u çocuklara yayar ve altındaki donmuş
  // kayıtlı grubun kazancını geri verir. Bkz. `../frozen-matrix`.
  const wrapperRef = useRef<THREE.Object3D>(null)
  useFrozenMatrix(wrapperRef)

  const isExporting = useViewer(
    (s) => (s as typeof s & { isExporting?: boolean }).isExporting ?? false,
  )
  const flowRunning = useWarehouseStore((s) => s.flowRunning)

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

  const model = telescopicModelOf(node.model)
  const sections = boomSections(node)

  // Üç materyal de aile × ayar başına TEK örnek (`../appearance`): modül
  // tekili olmakla ayar duyarlı olmak birbirini dışlamıyor, ve tekilliği
  // elde tutmak Display menüsünü sağır bırakmanın bahanesi değildi.
  const appearance = useAppearance()
  const material = getTelescopicMaterial(appearance)
  const lensMaterial = getLampLensMaterial(appearance)
  const boxMaterial = getFlowBoxMaterial(appearance)

  // İki katman da ekranda sayılır: tahliye çizileni boşaltamaz.
  useEffect(() => {
    const keys = [
      retainGeometry(telescopicBaseKey(node, 'full')),
      retainGeometry(telescopicBaseKey(node, 'simple')),
      ...sections.flatMap((section) => [
        retainGeometry(telescopicSectionKey(node, section.index, 'full')),
        retainGeometry(telescopicSectionKey(node, section.index, 'simple')),
      ]),
    ]
    return () => {
      for (const key of keys) releaseGeometry(key)
    }
  }, [node, sections])

  const baseRef = useRef<THREE.Mesh>(null)
  const sectionRefs = useRef<Map<number, THREE.Mesh>>(new Map())
  const detailRef = useRef<ConveyorDetail>('full')
  const frameRef = useRef(0)
  const phase = useMemo(() => hashPhase(node.id), [node.id])

  // Kutu havuzu: TEK InstancedMesh — on dört ayrı mesh, on dört çizim
  // çağrısıydı (ailenin `flow-system`'i bunu altı yüz kutu için zaten
  // çözmüştü; bu onun tek makinelik hâli).
  const boxesRef = useRef<THREE.InstancedMesh>(null)
  const travelRef = useRef(0)

  useFrame(({ camera }, delta) => {
    const root = registeredRef.current
    if (!root) return

    // ── LOD ──
    if (!isExporting) {
      frameRef.current += 1
      if ((frameRef.current + phase) % LOD_INTERVAL === 0) {
        const { elements } = root.matrixWorld
        const distanceSq = camera.position.distanceToSquared(
          worldPosition.set(elements[12] ?? 0, elements[13] ?? 0, elements[14] ?? 0),
        )
        // Bantlar kullanıcının detay kolundan ölçekli — depoda bu kolu
        // almayan tek kind buydu, yani yan yana duran bom ile makara hattı
        // farklı mesafede katman değiştiriyordu ve kol "tek bir şeyi
        // ayarlıyorum" iddiasını kaybediyordu. Ölçek kare başına değil,
        // değerlendirme başına okunuyor (rafın yaptığı gibi).
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
        if (next !== current) {
          detailRef.current = next
          if (baseRef.current) {
            baseRef.current.geometry = getTelescopicBaseGeometry(node, next)
          }
          for (const section of sections) {
            const mesh = sectionRefs.current.get(section.index)
            if (mesh) mesh.geometry = getTelescopicSectionGeometry(node, section.index, next)
          }
        }
      }
    }

    // ── Kutu akışı ──
    const boxes = boxesRef.current
    if (!boxes) return
    if (!flowRunning || isExporting) {
      // `count = 0` çizim çağrısını tamamen kaldırır; `visible=false` de
      // kaldırırdı ama sayaç sıfırlamak buffer'ı da boşta bırakır.
      boxes.count = 0
      return
    }
    travelRef.current += TELESCOPIC_BELT_SPEED_EST_MS * Math.min(delta, 0.1)
    const length = currentLengthM(node)
    const startX = -model.fixedM / 2 + 0.4
    const endX = boomTipX(node) - 0.2
    const span = Math.max(endX - startX, 0.5)
    const count = Math.min(MAX_BOXES, Math.max(1, Math.floor(span / BOX_GAP_M)))
    const topY = transportHeightM(node) + FLOW_BOX_M[1] / 2

    for (let index = 0; index < count; index++) {
      const offset = (travelRef.current + index * BOX_GAP_M) % span
      const x = startX + offset
      // Bom bölümleri kademeli alçalır — kutu üzerinde durduğu bandın kotunu izler.
      let y = topY
      for (const section of sections) {
        if (x > section.centerX - section.lengthM / 2) y = topY - section.dropM
      }
      boxMatrix.makeTranslation(x, y, 0)
      boxes.setMatrixAt(index, boxMatrix)
    }
    boxes.count = count
    boxes.instanceMatrix.needsUpdate = true
    void length
  })

  const height = transportHeightM(node) + 0.12
  const width = frameWidthM(node)

  /**
   * Merceğin yeri: parça listesindeki lamba gövdesiyle AYNI fonksiyondan
   * (`noseLamp`). Yerel X bölüm çerçevesinde döndüğü için düğüm çerçevesine
   * `centerX` eklenerek taşınıyor — bölüm grubunun tek ötelemesi o.
   */
  const nose = sections[sections.length - 1]
  const lamp = nose ? noseLamp(node, nose) : null
  const lensCenter: [number, number, number] | null =
    nose && lamp ? [nose.centerX + lamp.lens[0], lamp.lens[1], lamp.lens[2]] : null

  return (
    <group ref={wrapperRef} visible={node.visible !== false} {...handlers}>
      <group position={position} ref={registeredRef} rotation={rotation}>
        {/* Kolider anlık uzamış zarfı kapsar — bomun ucu da seçilebilir.
            Kayıtlı grubun İÇİNDE ve yerel koordinatta: dışarıdayken dünya
            yerleşimini elle kuruyordu (`position[0] + cos(rotation[1]) * …`),
            yani yalnız Y dönüşünü hesaba katıyor ve grubun bedava yapacağı
            işi tekrarlıyordu. Pakette grubunun dışında duran tek kolider
            buydu. */}
        {!isExporting && (
          <Collider
            position={[footprintCenterX(node), height / 2, 0]}
            size={[currentLengthM(node), height, width]}
          />
        )}
        <mesh
          dispose={null}
          geometry={getTelescopicBaseGeometry(node, isExporting ? 'full' : detailRef.current)}
          material={material}
          raycast={NO_RAYCAST}
          receiveShadow
          ref={baseRef}
        />
        {sections.map((section) => (
          <mesh
            dispose={null}
            geometry={getTelescopicSectionGeometry(
              node,
              section.index,
              isExporting ? 'full' : detailRef.current,
            )}
            key={section.index}
            material={material}
            position={[section.centerX, 0, 0]}
            raycast={NO_RAYCAST}
            receiveShadow
            ref={(mesh) => {
              if (mesh) sectionRefs.current.set(section.index, mesh)
              else sectionRefs.current.delete(section.index)
            }}
          />
        ))}
        {/* Kutu havuzu — tek çizim çağrısı, matrisleri kare döngüsü yazar.
            `frustumCulled={false}`: matrisler her kare değiştiği için sınır
            küresi ilk frustum testindeki hâline saplanır (`setMatrixAt` onu
            geçersiz kılmaz) — `flow-system.tsx`'in uzun uzun anlattığı kural
            burada da geçerli, çünkü kutular bomun ucuna kadar yürüyor. */}
        <instancedMesh
          args={[BOX_GEOMETRY, boxMaterial, MAX_BOXES]}
          count={0}
          dispose={null}
          frustumCulled={false}
          raycast={NO_RAYCAST}
          ref={boxesRef}
        />
        {/* Çalışma lambasının merceği — burun bölümünün ucunda, o bölümün
            uzamasıyla birlikte gider. */}
        {lensCenter && (
          <mesh
            dispose={null}
            geometry={LAMP_LENS_GEOMETRY}
            material={lensMaterial}
            position={lensCenter}
            raycast={NO_RAYCAST}
          />
        )}
        {/* Hüzme YALNIZ makine çalışırken. Ailenin Çalıştır düğmesi
            "hat iş görüyor" demek, ve bir çalışma lambası tam olarak o zaman
            yakılıyor — duran bir sahnede yanan hüzme, olmayan bir işi
            resmetmek olurdu. Dışa aktarımda da yok: çıktı dosyadaki sahnedir,
            bir efekt değil. */}
        {lensCenter && flowRunning && !isExporting && (
          <mesh
            dispose={null}
            geometry={BEAM_GEOMETRY}
            material={BEAM_MATERIAL}
            position={lensCenter}
            raycast={NO_RAYCAST}
            rotation={[0, 0, lampBeamRotationZ()]}
          />
        )}
      </group>
    </group>
  )
}
