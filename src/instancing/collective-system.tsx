'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type * as THREE from 'three'
import { kindOf } from '../host-adapter'
import { KIND_PREFIX } from '../plugin-id'
import { rebakeDriftedStaticTransforms } from '../static-transform'
import { useWarehouseStore } from '../store'
import {
  clearPools,
  evaluateTiers,
  instanceGeneration,
  type LevelSignature,
  pollLevelPositions,
  rebuildPools,
  refreshLevelWorldMatrices,
} from './collective'

/**
 * Kolektif sistemin kare önceliği.
 *
 * `LevelSystem` öncelik 5'te `position.y` yazıyor. Daha küçük bir öncelikte
 * koşmak, kat konumunu yazılmadan ÖNCE okumak demekti — her yeniden inşa bir
 * kare geride kalırdı. 6, "kat sistemi işini bitirdikten hemen sonra".
 */
const FRAME_PRIORITY = 6

/**
 * Bu paketin düğümlerinin KİRLİ BAYRAĞINI TÜKET.
 *
 * ## Sözleşmenin bu paketin yerine getirmediği yarısı
 *
 * `<FloorElevationSystem>` (öncelik 1) kirli düğümleri işliyor ama bayrağı
 * yalnız `!(def.geometry || def.system)` olan kind'lar için düşürüyor: geometri
 * ya da sistem bildiren bir kind kendi bayrağını KENDİ tüketmek zorunda, çünkü
 * onu asıl işleyen kendi sistemidir. Host'un yerleşik sistemlerinin hepsi
 * (ceiling, door, window, fence, wall, roof, stair, item, geometry) işini
 * bitirince `clearDirty` çağırıyor. Bu paketin kind'ları `def.system` bildirip
 * hiçbir yerde çağırmıyordu.
 *
 * ## Neden bu, ölçülebilir bir donma
 *
 * Sahne yüklenirken her slab `markNodesOverlappingSlab` taramasını koşuyor ve
 * ayak izine değen her `capabilities.floorPlaced` düğümünü kirletiyor — yani
 * bir depoda RAFLARIN TAMAMI, tek bir kullanıcı eylemi olmadan. Bayrak hiç
 * düşmediği için küme bir daha boşalmıyor.
 *
 * `dirtyNodes.size === 0` on iki host sisteminin ORTAK erken çıkışı. Küme boş
 * kalmayınca hepsi kümenin tamamını her karede geziyor, ve
 * `<FloorElevationSystem>` ayrıca kirli düğüm BAŞINA uzamsal yükseklik çözümü
 * koşuyor. Maliyet raf sayısıyla büyüyor ve kalıcı: sahneyi açıp hiçbir şeye
 * dokunmamak yetiyor.
 *
 * ## Neden öncelik 6, daha erken değil
 *
 * Kaldırma işi öncelik 1'de zaten yapıldı; burada yalnız bayrak düşürülüyor.
 * Daha erken temizlemek, asma kat güvertesine konmuş bir rafın kaldırmasını
 * hiç uygulanmadan iptal eder ve rafı zemine düşürürdü.
 */
function consumeOwnDirtyNodes(): void {
  const state = useScene.getState()
  if (state.dirtyNodes.size === 0) return
  const nodes = state.nodes as Readonly<Record<string, unknown>>
  for (const id of state.dirtyNodes) {
    if (kindOf(nodes[id])?.startsWith(KIND_PREFIX)) state.clearDirty(id as AnyNodeId)
  }
}

/**
 * Sahne başına BİR kolektif çizici.
 *
 * `def.system` kind başına bir kez mount edilir ve bu sistem raf kind'ına
 * asılıdır. Bunun keyfî olduğu açıkça yazılıdır — konveyör ailesinin akış
 * sistemi düz modüle asılı, aynı gerekçeyle: bir tesis rafsız olabilir ama
 * eklenti kuruluysa sistem yine mount edilir (`RegisteredSystems`
 * kayıtlı her kind'ın sistemini kurar, sahnede düğüm olmasa bile).
 *
 * ## Kare bütçesi
 *
 * Kare başına yapılan tek iş: örneklerin 1/8'inin mesafe değerlendirmesi.
 * Matris yazımı YALNIZ sahne ya da katman değişince olur — 10.000 örneğe
 * her kare matris yazmak, kurtardığı çizim çağrısından pahalıya gelirdi ve
 * bu dosyanın var oluş gerekçesini yerdi.
 *
 * ## Kapatılabilir olması bir tercih değil
 *
 * Bu, render yolunun en kritik parçası ve tarayıcıda doğrulanmadan
 * gönderiliyor. `instancingEnabled` kapalıyken her düğüm eskisi gibi kendi
 * mesh'ini çizer — yani bozulursa kullanıcı tek düğmeyle eski davranışa
 * döner ve iki hâli yan yana ölçebilir.
 */
export default function CollectiveInstancingSystem() {
  const enabled = useWarehouseStore((s) => s.instancingEnabled)
  const isExporting = useViewer(
    (s) => (s as typeof s & { isExporting?: boolean }).isExporting ?? false,
  )
  // Store her yazışta `nodes`'u değiştirir: sahne değişince yeniden kurulur
  // ve sürükleme sırasında hiç tetiklenmez (sürükleme store'a dokunmaz).
  const nodes = useScene((s) => s.nodes as Record<string, unknown>)

  const rootRef = useRef<THREE.Group>(null)
  const frameRef = useRef(0)
  const generationRef = useRef(-1)
  const dirtyRef = useRef(true)
  /** Kat kimliği → son görülen (Y, katman maskesi). Patlatma katı taşır,
   *  solo alttakileri gizler ve ÜSTTEKİLERİ yalnız-gölgeye damgalar — üçü de
   *  bu imzada görünür. */
  const levelYRef = useRef(new Map<string, LevelSignature>())

  // Sahne değişti: bir sonraki karede havuzlar yeniden kurulur. `nodes`
  // burada OKUNMAZ — kimliği sahne değişiminin ta kendisidir ve tek işi bu
  // efekti tetiklemektir (store her yazışta yeni nesne döndürür).
  useEffect(() => {
    dirtyRef.current = true
  }, [nodes])

  // Kapatıldığında havuzlar sökülür — düğümler kendi mesh'lerini zaten
  // çiziyor olacak, yoksa sahne iki kez çizerdi.
  useEffect(() => {
    if (enabled && !isExporting) return
    clearPools(rootRef.current)
    generationRef.current = -1
    dirtyRef.current = true
  }, [enabled, isExporting])

  /**
   * Unmount temizliği — Canvas yeniden mount edildiğinde ŞART.
   *
   * Havuzlar modül kapsamında, `root` ise bu bileşene ait. Editör ile preview
   * arasında geçiş Canvas'ı komple yeniden kuruyor; temizlik olmadan eski
   * mesh'ler ölü sahnenin çocuğu olarak havuzda kalıyor ve yeni Canvas onları
   * "zaten var" sayıp hiçbir yere eklemiyordu. `rebuildPools` artık bunu tek
   * başına da onarıyor, ama sızıntıyı en baştan bırakmamak daha doğru.
   */
  useEffect(() => {
    const root = rootRef.current
    return () => {
      clearPools(root)
      generationRef.current = -1
      dirtyRef.current = true
      levelYRef.current.clear()
    }
  }, [])

  useFrame(({ camera }) => {
    /**
     * Instancing kapalıyken bile koşar — çünkü düzelttiği şey kolektif
     * çizimle ilgili değil: host'un kayıtlı nesneye doğrudan yazdığı Y
     * (slab lifti) ve imperatif sürükleme, `matrixAutoUpdate = false`
     * tarafından yutuluyordu. Bu, paketteki tek her-kare döngüsü olduğu için
     * kontrol buraya asılı; erken çıkışların ÜSTÜNDE durması bilinçli.
     */
    /**
     * Kaç düğüm yeniden basıldı — havuzun matris tazeliği için de bir sinyal.
     *
     * Rebake, host'un kayıtlı nesneye DOĞRUDAN yazdığı Y'yi (slab lifti) ve
     * imperatif sürüklemeyi yakalıyor: ikisi de sahne store'una dokunmuyor,
     * kat konumunu değiştirmiyor, yani havuzun bildiği hiçbir tetikleyici
     * bunları duymuyor. Sayı sıfırdan büyükse en az bir dünya matrisi kaymış
     * demektir ve havuz o kareyi "matrisler kirli" sayarak yeniden yazmalı.
     */
    const rebaked = rebakeDriftedStaticTransforms()

    /**
     * Erken çıkışların ÜSTÜNDE, `rebake` ile aynı gerekçeyle: kirli bayrağının
     * birikmesi kolektif çizimle ilgili değil. Instancing kapalıyken de,
     * dışa aktarım sırasında da, sahnede tek bir raf bile yokken de — bu
     * paketin herhangi bir düğümü kirli kaldıysa on iki host sistemi her karede
     * onu geziyor.
     */
    consumeOwnDirtyNodes()

    const root = rootRef.current
    if (!root) return
    /**
     * Export sırasında kolektif çizim KAPALI: dışa aktarma her zaman
     * dosyadaki sahnedir ve `isExporting` düğümlere kendi mesh'lerini
     * çizdirir (paletin film kuralının aynısı).
     */
    if (!enabled || isExporting) return

    frameRef.current += 1
    const tierChanged = evaluateTiers(camera.position, frameRef.current)
    const generation = instanceGeneration()
    const levelsMoved = pollLevelPositions(levelYRef.current)

    /**
     * Matrisleri kımıldatabilecek olanlar — ve KATMAN GEÇİŞİ bunlardan değil.
     *
     * Ayrım bu sistemin en pahalı davranışının çaresi. Kamera gezerken eşik
     * küreleri sürekli düğüm kesiyor, yani `tierChanged` neredeyse her kare
     * doğru; ama o karede sahnede hiçbir şey KIMILDAMIYOR — yalnız iki havuzun
     * üyeliği değişiyor. Eskiden bu, her havuzun tam `instanceMatrix`
     * tamponunun baştan yazılıp GPU'ya yeniden yüklenmesi demekti.
     *
     * Kirli değilken `rebuildPools` üyeliği değişmeyen havuza hiç dokunmuyor,
     * ve kat alt ağaçlarının dünya matrisleri de zorlanmıyor: onları tazelemek
     * yalnız gerçekten kımıldadıklarında anlamlı, çünkü R3F zaten her çizimde
     * güncelliyor.
     */
    const matricesDirty =
      levelsMoved || dirtyRef.current || generation !== generationRef.current || rebaked > 0

    if (tierChanged || matricesDirty) {
      generationRef.current = generation
      dirtyRef.current = false
      if (matricesDirty) refreshLevelWorldMatrices()
      rebuildPools(root, matricesDirty)
    }
  }, FRAME_PRIORITY)

  return <group ref={rootRef} />
}
