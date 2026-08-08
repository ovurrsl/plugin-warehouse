'use client'

import {
  type AnyNodeId,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { BufferGeometry, Camera, Mesh, Object3D } from 'three'
import { Vector3 } from 'three'
import { appearanceKey, useAppearance } from '../appearance'
import { Collider } from '../collider'
import { useFrozenMatrix } from '../frozen-matrix'
import { useAdmitted } from '../instancing/admission'
import { registerGhostLod } from '../instancing/ghost-lod'
import { SelfDrawnBody } from '../instancing/self-drawn'
import { useCollective } from '../instancing/use-collective'
import { isSelected } from '../selection'
import { useStaticTransform } from '../static-transform'
import { lodScaleSq } from '../store'
import { FILM_DRAW_DISTANCE_M } from './cargo-constants'
import {
  cargoCacheKey,
  getCargoGeometry,
  releaseCargoGeometry,
  retainCargoGeometry,
} from './cargo-geometry'
import { type CargoDetail, type CargoInput, cargoInputOf } from './cargo-parts'
import { unitLoadHeightOf } from './cargo-types'
import { getFilmGeometry, releaseFilmGeometry, retainFilmGeometry } from './film'
import { getPalletFarGeometry, getPalletGeometry } from './geometry-builder'
import {
  getCargoMaterial,
  getFilmMaterial,
  getPalletFarMaterial,
  getPalletMaterial,
} from './materials'
import { specOf } from './presets'
import type { PalletNode } from './schema'

const NO_RAYCAST = () => {}

/**
 * Where the load drops to its far tier, and where it comes back.
 *
 * Two thresholds rather than one, because a single one at the exact distance a
 * pallet is hovering makes it flicker between tiers on every camera breath. The
 * near figure is set from the acceptance requirement rather than from taste:
 * carton seams have to stay countable at ten to fifteen metres, so the detailed
 * tier has to survive well past that.
 */
const LOD_FAR_SQ = 25 * 25
const LOD_NEAR_SQ = 18 * 18

/**
 * Where the film stops being drawn at all.
 *
 * Fill rate rather than triangles: a blended veil costs its whole silhouette in
 * shaded fragments every frame however few triangles it has, so the only
 * effective control is how many are on screen at once.
 *
 * Detay kolu (`lodScaleSq`) buna da uygulanıyor, katman bantlarına uygulandığı
 * gibi: kol tek bir kalite ekseni, ve film kesimini onun dışında bırakmak
 * "yakın" konumunda yükün kutuya düştüğü ama streçin hâlâ tam mesafede
 * çizildiği bir hâl bırakırdı — kolun kıstığı en pahalı kalemin dışarıda
 * kalması.
 */
const FILM_CUT_SQ = FILM_DRAW_DISTANCE_M * FILM_DRAW_DISTANCE_M

const worldPosition = new Vector3()

/** Yükün çapasının dönüşü hep sıfır. Modül kapsamında, çünkü aksi hâlde her
 *  render'da düğüm başına bir dizi ayrılırdı ve `useStaticTransform`'un tek tek
 *  sayı olan bağımlılıkları o diziyi zaten okumuyor. */
const ZERO_ROTATION: readonly [number, number, number] = [0, 0, 0]

/**
 * Mounted through `def.renderer: { kind: 'parametric' }` rather than
 * `def.geometry`, and that choice is load-bearing.
 *
 * `<GeometrySystem>` disposes the previous build's children on every rebuild.
 * The geometry here is a module-level singleton shared by every pallet, so the
 * first rebuild of any one of them — a theme switch is enough — would free the
 * buffer the whole scene is drawing from and blank every pallet at once.
 * Materials are protected from this by `__pascalCachedMaterial`; geometry has
 * no equivalent. Owning the mount and passing `dispose={null}` keeps React from
 * touching the shared buffers at all.
 *
 * This is the same failure the two commits before the rewrite were chasing.
 * They cured it by deleting the caches, which cost a fresh geometry and a fresh
 * 3×1024² atlas per instance — roughly 12 MB of texture memory per pallet.
 */
export default function PalletRenderer({ node }: { node: PalletNode }) {
  // Kademeli mount kapısı. Gövde AYRI bileşende olmak ZORUNDA: pahalı iş onun
  // kancalarında (kayıt, olay bağlama, havuza kayıt, geometri tutma) ve kancalar
  // koşullu çağrılamıyor, yani "sıra bende değil" hâli ancak gövdeyi hiç mount
  // etmeyerek karşılanabilir. Gerekçenin tamamı `../instancing/admission`.
  const admitted = useAdmitted(node.id)
  if (!admitted) return null
  return <PalletRendererBody node={node} />
}

function PalletRendererBody({ node }: { node: PalletNode }) {
  const wrapperRef = useRef<Object3D>(null)
  const registeredRef = useRef<Object3D>(null!)
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id as AnyNodeId, node.type, registeredRef)

  /**
   * Dönüşümsüz dış sarmalayıcı da donuyor — ve donmazsa altındakilerin donmuş
   * olması yarı yarıya boşa gidiyor.
   *
   * `matrixAutoUpdate` açık bir grup her karede kendi `compose`'unu yapıyor VE
   * çıkarken `force` bayrağını çocuklarına yayıyor; bayrak gelen çocuk, kendi
   * bayrağı kapalı olsa bile `multiplyMatrices`'i yapmak zorunda. Yani bu
   * sarmalayıcı açık kaldığı sürece altındaki kayıtlı grup ve çarpıştırıcı
   * `compose`'tan kurtuluyor ama dünya çarpımından kurtulmuyor. Satır satır
   * mekanizma: `../frozen-matrix`.
   *
   * Burada güvenli olmasının sebebi sarmalayıcının hiç kımıldamaması: konum,
   * dönüş, ölçek prop'u yok — yalnız `visible` ve olay işleyicileri var.
   */
  useFrozenMatrix(wrapperRef)

  const isExporting = useViewer(
    (s) => (s as typeof s & { isExporting?: boolean }).isExporting ?? false,
  )

  // Move tools drive the registered object imperatively and mirror the result
  // through `useLiveTransforms`; the rotate and resize gizmos publish through
  // `useLiveNodeOverrides` instead. Folding in both makes the pallet follow the
  // cursor during a drag rather than snapping into place on commit.
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
  // thousands of these doing nothing. Live for exactly the window something
  // is actually writing this pallet's transform every tick.
  useStaticTransform(
    registeredRef,
    position,
    rotation,
    live !== undefined || override !== undefined,
  )

  const spec = specOf(node.preset)

  /**
   * Güverte kolektif çiziciye girer — sahnedeki en kalabalık mesh bu.
   *
   * Uzak katman materyali FARKLI (`getPalletFarMaterial`) — bu yüzden
   * materyal anahtarı katmanla değişir ve havuz ikiye ayrılır; ikisi
   * karışırsa uzak paletler ahşap dokusunu kaybeder.
   *
   * **Yük de girer** (`CargoLoad`), film girmez. Burada bir zamanlar ikisinin
   * de dışarıda kaldığı ve gerekçesinin "düğüm başına farklı, havuz başına tek
   * örnek düşer" olduğu yazıyordu. Yükün girdisi öyle değil: `cargoCacheKey`
   * tipi, yerleşimi, rengi ve katmanı okuyor — varyantı DEĞİL, çünkü varyant
   * zaten bir kat sayısına yuvarlanıyor. İki tip, altı renk ve bir avuç
   * yerleşim, gerçekçi bir depoda onlarca anahtar eder, binlerce değil; yani
   * yük havuza girmediği sürece sahnedeki en kalabalık ÇİZİM ÇAĞRISI kaynağıydı.
   *
   * Film gerçekten dışarıda kalır ve sebebi sayı değil: saydam, kendi sıralama
   * düzenini istiyor ve görünürlüğü düğüm başına mesafeyle açılıp kapanıyor —
   * bir örnek tamponunda ifade edilemeyecek üç şey.
   */
  const selected = useViewer((s) => isSelected(s.selection.selectedIds, node.id))
  /**
   * Havuzdan çıkma koşulu — güverte ve yük İÇİN AYNI ifade, tek yerde.
   *
   * İkisi ayrı yazıldığında ayrışabilirlerdi, ve ayrıştıkları hâl görünür:
   * seçili bir palet güvertesini kendi çizerken yükünü havuza bırakırsa,
   * sürüklerken yük geride kalır.
   */
  const excluded = selected || live !== undefined || override !== undefined || isExporting
  const appearance = useAppearance()
  const drawsSelf = useCollective({
    nodeId: node.id,
    objectRef: registeredRef,
    geometryFor: (tier) =>
      tier === 'full' ? getPalletGeometry(node.preset) : getPalletFarGeometry(node.preset),
    keyFor: (tier) => `pallet-deck:${node.preset}:${tier}`,
    materialFor: (tier) =>
      tier === 'full' ? getPalletMaterial(appearance) : getPalletFarMaterial(appearance),
    materialKeyFor: (tier) => `pallet-deck:${tier}:${appearanceKey(appearance)}`,
    castsShadow: false,
    farSq: LOD_FAR_SQ,
    nearSq: LOD_NEAR_SQ,
    excluded,
  })

  /**
   * Yükün iki katmanlık girdisi — ve yükün ÇİZİLİP çizilmeyeceği kararı.
   *
   * `cargoInputOf` güverteye sığmayan bir yükü reddediyor, ve o reddin katmanla
   * hiçbir ilgisi yok (`fitsOnDeck` tipi ve preseti okuyor, detayı değil). Yani
   * bu bir MOUNT kararı, `CargoLoad`'un kancalarını çalıştırdıktan sonra
   * keşfedeceği bir şey değil — ve mount sınırına çekilmesi, aşağıdaki bileşenin
   * her yerde `null` kontrolü taşımadan kolektif çiziciye kaydolmasını sağlıyor.
   */
  const cargo = useMemo(() => {
    const full = cargoInputOf(node, 'full')
    const simple = cargoInputOf(node, 'simple')
    return full && simple ? { full, simple } : null
  }, [node])

  /**
   * Streç çizilecek mi — kararı `CargoLoad` değil BURASI veriyor.
   *
   * Aşağıdaki görünürlük kapısı bu cevaba dayanıyor, yani iki yerde ayrı ayrı
   * kurulan iki kopya ayrışabilseydi ayrıştıkları hâl sessiz olurdu: kapı "film
   * yok" derken filmin mount edilmesi, bütün streçlerin gizli bir alt ağaçta
   * hiç çizilmemesi demek. Tek ifade, tek yer.
   */
  const filmed = cargo !== null && node.wrapped && node.cargo !== 'none'

  const _hidden = !drawsSelf && !filmed

  /**
   * Havuzun görünürlük taraması bu bayrakla "kolektif gizledi"yi "kullanıcı
   * gizledi"den ayırıyor; ayıramazsa hata iki yönde de sessiz — bayrak
   * okunmazsa her palet havuzdan düşer ve sahne boşalır, fazla geniş okunursa
   * gizlenen palet çizilmeye devam eder. Bkz. `collective.ts`.
   *
   * Tarama ATA zincirini yürüdüğü için bayrağın `visible = false` yazılan
   * nesnede olması şart: burada dış sarmalayıcıda, çünkü geziniş orada kesiliyor
   * ve kayıtlı grup ile yükün çapası onun altında kalıyor.
   *
   * JSX prop'u olarak değil elle: `userData={{...}}` her renderda yeni bir nesne
   * ayırır ve R3F onu olduğu gibi yerine koyar. `useLayoutEffect` kolektif
   * sistemin `useFrame`'inden önce koştuğu için havuz bayrağı hep güncel okuyor.
   */

  /**
   * Güvertenin katman döngüsü `SelfDrawnBody`'ye taşındı.
   *
   * Güverte, paketteki her mesafede tam detay çizilen tek mesh'ti — birkaç yüz
   * palette görünmez, gerçek bir 3.704 gözlük sahnede 228 bin üçgenlik piksel
   * altı tahta. Uzakta tek bir kutuya ve düz ahşap materyaline düşüyor;
   * haritalar bir kutunun UV'lerine yayılacağı için materyal geometriyle
   * birlikte takas ediliyor.
   *
   * Döngünün burada durmasının bedeli ölçülebilirdi: kolektif çizici AÇIKKEN
   * güverte mesh'i hiç mount edilmiyor, yani ref `null` kalıyor ve döngü ilk
   * satırda dönüyordu — ama sahnedeki HER palet için, HER karede bir kez
   * çağrılıyordu. `SelfDrawnBody` yalnız düğüm kendi çizerken mount olduğu için
   * o abonelik artık hiç kurulmuyor.
   */

  // One height, from the one function that knows: a cargo load answers with
  // what its variant resolved to, an empty pallet with nothing. The collider
  // and the clash test must not be able to disagree about it.
  const totalHeight = unitLoadHeightOf(node)

  return (
    <group {...handlers} ref={wrapperRef} visible={node.visible !== false}>
      <group position={position} ref={registeredRef} rotation={rotation}>
        {/* Selection collider. The deck has 41 mm gaps between boards and open
            fork tunnels, so raycasting the real mesh would let clicks fall
            straight through the pallet. An invisible box spanning the unit load
            is what the user is actually aiming at.

            Kayıtlı grubun İÇİNDE — gerekçesi `rack/renderer.tsx`'te uzun uzun
            yazılı: kolektif çizici açıkken bu grubun içi boş kalıyor ve host
            gölge frustum'unu kayıtlı düğümlerin birleşimine oturttuğu için
            depo ekipmanı gölge sınırlarına hiç katkı vermiyordu. Görünmez bir
            kutu `projectObject`'te elendiği için ne renk ne gölge geçidine
            çizim ekliyor, ama `Box3.expandByObject` görünürlüğe bakmadığı için
            düğümün gerçek zarfını bildiriyor. */}
        {!isExporting && (
          <Collider
            position={[0, totalHeight / 2, 0]}
            size={[spec.length, totalHeight, spec.width]}
          />
        )}
        {/* Kolektif kapalıyken ya da bu palet seçili/sürükleniyorken kendi
            güvertesini çizer; açıkken tek `InstancedMesh` preset başına
            hepsini birden çizer. */}
        {drawsSelf && (
          <SelfDrawnBody
            farSq={LOD_FAR_SQ}
            geometryFor={(tier) =>
              tier === 'full' ? getPalletGeometry(node.preset) : getPalletFarGeometry(node.preset)
            }
            isExporting={isExporting}
            /**
             * Uzak katmanda materyal DE değişiyor: EPAL atlası çıplak bir
             * kutunun UV'lerine yayılınca tahta dokusu leke oluyor. Kolektif
             * yolun `materialFor`'uyla birebir aynı ifade — iki yolun farklı
             * görünmesi imkânsız olsun diye.
             */
            materialFor={(tier) =>
              tier === 'full' ? getPalletMaterial(appearance) : getPalletFarMaterial(appearance)
            }
            nearSq={LOD_NEAR_SQ}
            nodeId={node.id}
          />
        )}
        {/* Cargo or nothing. There is no third branch: the plain block that
            used to be drawn when `cargo` was `'none'` and a typed height was
            non-zero is gone, and with it the empty pallets that carried what
            looked like cartons. */}
        {cargo && (
          <CargoLoad
            cargo={cargo}
            excluded={excluded}
            filmed={filmed}
            isExporting={isExporting}
            node={node}
            y={spec.height}
          />
        )}
      </group>
    </group>
  )
}

/**
 * The goods.
 *
 * Mounted as its own mesh beside the pallet's, not merged into it: the deck is
 * one shared buffer per preset and there are eight of those, where a load is one
 * per distinct type, layout, fill, colour and tier. Merging the two would
 * multiply the pallet's eight by every load in the building.
 */
/**
 * Yükün havuz kimliği — paletin kendi kimliğinden AYRI olmak zorunda.
 *
 * Güverte `node.id` altında kayıtlı; yük aynı kimliği kullansaydı ikisinden
 * biri ötekinin kaydını ezerdi ve sahnede ya yükler ya güverteler kaybolurdu.
 */
const CARGO_INSTANCE_SUFFIX = ':cargo'

function CargoLoad({
  cargo,
  excluded,
  filmed,
  node,
  y,
  isExporting,
}: {
  /** İki katmanın girdisi, mount sınırında `null` olmadığı doğrulanmış. */
  cargo: Record<CargoDetail, CargoInput>
  excluded: boolean
  /** Streç çizilecek mi — kararı görünürlük kapısıyla PAYLAŞILIYOR, bkz.
   *  `PalletRendererBody`. Burada yeniden kurmak ikisini ayrıştırırdı. */
  filmed: boolean
  node: PalletNode
  y: number
  isExporting: boolean
}) {
  /**
   * Yükün çapası — ve kolektif havuzun yükü hiçbir sözleşme değişikliği
   * olmadan taşıyabilmesinin sebebi.
   *
   * Havuz kayıtlı nesnenin `matrixWorld`'ünü OLDUĞU GİBİ kopyalıyor; yük ise
   * paletin kökünde değil, güvertenin üstünde duruyor. Kayıt için paletin
   * grubunu verip aradaki yükseklik farkını havuza bir ofset alanı olarak
   * eklemek olurdu — ama üç'ün kendisi bu işi zaten yapıyor: `[0, y, 0]`'da
   * duran boş bir grubun `matrixWorld`'ü tam olarak `paletin dünyası × öteleme`.
   * Döndürülmüş ya da yatırılmış bir palette bile doğru, çünkü hesabı biz
   * yapmıyoruz.
   *
   * Grup, yük havuzda çizilirken bile mount kalıyor: matrisin kaynağı o.
   */
  const anchorRef = useRef<Object3D>(null)
  const appearance = useAppearance()

  const drawsSelf = useCollective({
    nodeId: `${node.id}${CARGO_INSTANCE_SUFFIX}`,
    objectRef: anchorRef,
    geometryFor: (tier) => getCargoGeometry(cargo[tier]),
    // Havuz anahtarı geometri önbelleğinin anahtarının TA KENDİSİ: aynı tampona
    // çözülen iki yük aynı havuza düşer, farklı çözülenler düşmez. İkinci bir
    // anahtar yazmak, ikisinin ayrışabileceği bir yer daha açardı.
    keyFor: (tier) => cargoCacheKey(cargo[tier]),
    materialFor: () => getCargoMaterial(appearance),
    // Tek paylaşımlı materyal — renk atlastan ve köşe renklerinden geliyor.
    materialKeyFor: () => `cargo:${appearanceKey(appearance)}`,
    castsShadow: false,
    farSq: LOD_FAR_SQ,
    nearSq: LOD_NEAR_SQ,
    excluded,
  })

  /**
   * Çapanın yerel dönüşümü de donuyor.
   *
   * Bu grup kayıtlı grubun ÇOCUĞU ve `matrixAutoUpdate` açık kaldığı sürece her
   * karede kendi `compose`'unu yapıyor — yüklü palet başına iki matris işlemi,
   * ve yüklü palet sahnedeki en kalabalık düğüm. `useStaticTransform` bunu tek
   * seferlik basıma indiriyor.
   *
   * `isLive` her zaman `false`, ve bu bir ihmal değil: çapayı kımıldatan hiçbir
   * şey yok. Paleti sürükleyen de, host'un slab liftini yazan da ÜSTTEKİ kayıtlı
   * gruba yazıyor, three de `force` bayrağını çocuklara yaydığı için bu grubun
   * dünya matrisi donmuş hâlde bile tazeleniyor. (Havuz yükün matrisini tam
   * buradan okuyor.)
   */
  const anchorPosition = useMemo<[number, number, number]>(() => [0, y, 0], [y])
  useStaticTransform(anchorRef, anchorPosition, ZERO_ROTATION, false)

  // One sleeve fits both tiers: `loadExtent` reads type, preset and variant and
  // never the tier, so the far tier's single box has exactly the near tier's
  // extent.
  const filmGeometry = useMemo(() => (filmed ? getFilmGeometry(cargo.full) : null), [cargo, filmed])

  // Tell the cache both tiers are on screen. Eviction must never free a buffer
  // something is drawing, and a tier switch must not have to build one. Havuz
  // da bu tutamağa güveniyor: kolektif mesh geometriyi doğrudan tutuyor ve
  // altından tahliye edilmesi onu boş çizdirirdi.
  useEffect(() => {
    const nearKey = retainCargoGeometry(cargo.full)
    const farKey = retainCargoGeometry(cargo.simple)
    const filmKey = filmed ? retainFilmGeometry(cargo.full) : null
    return () => {
      releaseCargoGeometry(nearKey)
      releaseCargoGeometry(farKey)
      if (filmKey) releaseFilmGeometry(filmKey)
    }
  }, [cargo, filmed])

  return (
    // Konum prop'u YOK: `useStaticTransform` yazıyor ve bayrak kapalıyken
    // R3F'in yazdığı `position` yerel matrise zaten işlemezdi — iki kaynak
    // olması, biri sessizce yok sayılan iki kaynak olurdu.
    <group ref={anchorRef}>
      {/* Kolektif kapalıyken ya da bu palet seçili/sürükleniyorken yükünü
          kendi çizer; açıkken aynı yüke çözülen bütün paletleri tek
          `InstancedMesh` çiziyor. */}
      {drawsSelf && (
        <SelfDrawnBody
          farSq={LOD_FAR_SQ}
          geometryFor={(tier) => getCargoGeometry(cargo[tier])}
          isExporting={isExporting}
          materialFor={() => getCargoMaterial(appearance)}
          nearSq={LOD_NEAR_SQ}
          nodeId={`${node.id}${CARGO_INSTANCE_SUFFIX}`}
        />
      )}
      {filmGeometry && (
        <FilmVeil geometry={filmGeometry} isExporting={isExporting} nodeId={node.id} />
      )}
    </group>
  )
}

/**
 * Streç film — kendi bileşeni, ve kesme mesafesini MERKEZÎ döngüden alan tek
 * mesh'i.
 *
 * Bileşenin ayrı olması, filmin yalnız sarılı paletlerde mount edilmesi için:
 * bir kanca koşullu çağrılamaz ama bir bileşen koşullu MOUNT edilebilir.
 *
 * Değerlendirme burada bir `useFrame` idi ve maliyeti `self-drawn.tsx` ile
 * `ghost-lod.ts`'in ölçüp kaldırdığının aynısıydı: sarılı palet varsayılan
 * olduğu için abonelik sayısı doğrudan palet sayısı — beş bin paletlik bir
 * sahnede kare başına beş bin kapanış, sekizde yedisi ilk satırda dönen. Kayıt
 * `registerGhostLod`'a taşındı; sürüş kolektif sistemin zaten koşan tek
 * döngüsünden geliyor, faz dağıtımı ve 1/8 aralığı orada aynen korunuyor
 * (`tickGhostLod` erken çıkışların üstünde, yani kolektif çizim kapalıyken de
 * koşuyor).
 *
 * Kayıt kimliği `:film` ekiyle: aynı düğüm zaten güvertesiyle havuzda ve
 * `${id}:cargo` ile yükünde: çakışan bir kimlik ötekinin kaydını sessizce ezer.
 */
function FilmVeil({
  geometry,
  isExporting,
  nodeId,
}: {
  geometry: BufferGeometry
  isExporting: boolean
  nodeId: string
}) {
  const meshRef = useRef<Mesh>(null)
  const appearance = useAppearance()

  const evaluate = useCallback(
    (camera: Camera) => {
      const mesh = meshRef.current
      if (!mesh || isExporting) return
      const { elements } = mesh.matrixWorld
      const distanceSq = camera.position.distanceToSquared(
        worldPosition.set(elements[12] ?? 0, elements[13] ?? 0, elements[14] ?? 0),
      )
      mesh.visible = distanceSq <= FILM_CUT_SQ * lodScaleSq()
    },
    [isExporting],
  )

  useEffect(() => registerGhostLod(`${nodeId}:film`, evaluate), [nodeId, evaluate])

  return (
    <mesh
      /**
       * Casts no shadow, and could not cast a correct one if it wanted to:
       * this host's shadow pass sets `scene.overrideMaterial` to one shared
       * material that reads nothing off the object's own, so a transparent
       * caster would lay down a fully solid shadow. Adding `alphaTest` or an
       * `alphaMap` would not save it either — worth writing down, because
       * that is the obvious thing to reach for next.
       */
      castShadow={false}
      dispose={null}
      geometry={geometry}
      material={getFilmMaterial(appearance)}
      raycast={NO_RAYCAST}
      receiveShadow={false}
      ref={meshRef}
      // After every default-0 opaque, so a blended veil is sorted and drawn
      // against a depth buffer that has already been laid down.
      renderOrder={1}
      // Off until the frame loop has judged the distance. Mounted visible,
      // a pallet placed at forty metres would draw a full sleeve for up to
      // eight frames — and an export, which never runs the loop, would draw
      // one at any distance.
      visible={isExporting}
    />
  )
}
