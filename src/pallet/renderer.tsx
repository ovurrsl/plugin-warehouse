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
import type { BufferGeometry, Mesh, Object3D } from 'three'
import { Vector3 } from 'three'
import { colliderProps } from '../collider'
import { SelfDrawnBody } from '../instancing/self-drawn'
import { useCollective } from '../instancing/use-collective'
import { useStaticTransform } from '../static-transform'
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
 */
const FILM_CUT_SQ = FILM_DRAW_DISTANCE_M * FILM_DRAW_DISTANCE_M

/** Frames between tier checks. Distance to a camera does not change fast enough
 *  to be worth a square root every frame on every pallet in a warehouse. */
const LOD_INTERVAL = 8

const worldPosition = new Vector3()

/** Spreads the tier checks across the interval so a thousand pallets do not all
 *  re-evaluate on the same frame and spike it. */
function hashPhase(id: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % LOD_INTERVAL
}

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
  const registeredRef = useRef<Object3D>(null!)
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id as AnyNodeId, node.type, registeredRef)

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
  const selected = useViewer((s) => s.selection.selectedIds.includes(node.id as AnyNodeId))
  /**
   * Havuzdan çıkma koşulu — güverte ve yük İÇİN AYNI ifade, tek yerde.
   *
   * İkisi ayrı yazıldığında ayrışabilirlerdi, ve ayrıştıkları hâl görünür:
   * seçili bir palet güvertesini kendi çizerken yükünü havuza bırakırsa,
   * sürüklerken yük geride kalır.
   */
  const excluded = selected || live !== undefined || override !== undefined || isExporting
  const drawsSelf = useCollective({
    nodeId: node.id,
    objectRef: registeredRef,
    geometryFor: (tier) =>
      tier === 'full' ? getPalletGeometry(node.preset) : getPalletFarGeometry(node.preset),
    keyFor: (tier) => `pallet-deck:${node.preset}:${tier}`,
    materialFor: (tier) => (tier === 'full' ? getPalletMaterial() : getPalletFarMaterial()),
    materialKeyFor: (tier) => `pallet-deck:${tier}`,
    castsShadow: true,
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
    <group visible={node.visible !== false} {...handlers}>
      {/* Selection collider. The deck has 41 mm gaps between boards and open
          fork tunnels, so raycasting the real mesh would let clicks fall
          straight through the pallet. An invisible box spanning the unit load
          is what the user is actually aiming at. Kept outside the registered
          group so the selection outline traces the true silhouette. */}
      {!isExporting && (
        <mesh
          {...colliderProps([spec.length, totalHeight, spec.width])}
          position={[position[0], position[1] + totalHeight / 2, position[2]]}
          rotation={rotation}
        />
      )}

      <group position={position} ref={registeredRef} rotation={rotation}>
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
            materialFor={(tier) => (tier === 'full' ? getPalletMaterial() : getPalletFarMaterial())}
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
  node,
  y,
  isExporting,
}: {
  /** İki katmanın girdisi, mount sınırında `null` olmadığı doğrulanmış. */
  cargo: Record<CargoDetail, CargoInput>
  excluded: boolean
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

  const drawsSelf = useCollective({
    nodeId: `${node.id}${CARGO_INSTANCE_SUFFIX}`,
    objectRef: anchorRef,
    geometryFor: (tier) => getCargoGeometry(cargo[tier]),
    // Havuz anahtarı geometri önbelleğinin anahtarının TA KENDİSİ: aynı tampona
    // çözülen iki yük aynı havuza düşer, farklı çözülenler düşmez. İkinci bir
    // anahtar yazmak, ikisinin ayrışabileceği bir yer daha açardı.
    keyFor: (tier) => cargoCacheKey(cargo[tier]),
    materialFor: () => getCargoMaterial(),
    // Tek paylaşımlı materyal — renk atlastan ve köşe renklerinden geliyor.
    materialKeyFor: () => 'cargo',
    castsShadow: true,
    farSq: LOD_FAR_SQ,
    nearSq: LOD_NEAR_SQ,
    excluded,
  })

  // One sleeve fits both tiers: `loadExtent` reads type, preset and variant and
  // never the tier, so the far tier's single box has exactly the near tier's
  // extent.
  const wrapped = node.wrapped && node.cargo !== 'none'
  const filmGeometry = useMemo(
    () => (wrapped ? getFilmGeometry(cargo.full) : null),
    [cargo, wrapped],
  )

  // Tell the cache both tiers are on screen. Eviction must never free a buffer
  // something is drawing, and a tier switch must not have to build one. Havuz
  // da bu tutamağa güveniyor: kolektif mesh geometriyi doğrudan tutuyor ve
  // altından tahliye edilmesi onu boş çizdirirdi.
  useEffect(() => {
    const nearKey = retainCargoGeometry(cargo.full)
    const farKey = retainCargoGeometry(cargo.simple)
    const filmKey = wrapped ? retainFilmGeometry(cargo.full) : null
    return () => {
      releaseCargoGeometry(nearKey)
      releaseCargoGeometry(farKey)
      if (filmKey) releaseFilmGeometry(filmKey)
    }
  }, [cargo, wrapped])

  return (
    <group position={[0, y, 0]} ref={anchorRef}>
      {/* Kolektif kapalıyken ya da bu palet seçili/sürükleniyorken yükünü
          kendi çizer; açıkken aynı yüke çözülen bütün paletleri tek
          `InstancedMesh` çiziyor. */}
      {drawsSelf && (
        <SelfDrawnBody
          farSq={LOD_FAR_SQ}
          geometryFor={(tier) => getCargoGeometry(cargo[tier])}
          isExporting={isExporting}
          materialFor={() => getCargoMaterial()}
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
 * Streç film — kendi bileşeni, ve kendi kare döngüsü.
 *
 * Döngü eskiden `CargoLoad`'un gövdesindeydi ve yükün katmanıyla filmin kesme
 * mesafesini aynı hesaptan sürüyordu. Katman artık kolektif çizicinin merkezî
 * döngüsüne ait, geriye yalnız film kaldı — ve film sarılı OLMAYAN palette hiç
 * yok. Ayrı bir bileşen, aboneliğin de yalnız sarılı paletlerde kurulması
 * demek: `useFrame` koşullu çağrılamaz ama bir bileşen koşullu MOUNT edilebilir.
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
  const frameRef = useRef(0)
  const phase = useMemo(() => hashPhase(nodeId), [nodeId])

  useFrame(({ camera }) => {
    const mesh = meshRef.current
    if (!mesh || isExporting) return
    frameRef.current += 1
    if ((frameRef.current + phase) % LOD_INTERVAL !== 0) return

    const { elements } = mesh.matrixWorld
    const distanceSq = camera.position.distanceToSquared(
      worldPosition.set(elements[12] ?? 0, elements[13] ?? 0, elements[14] ?? 0),
    )
    mesh.visible = distanceSq <= FILM_CUT_SQ
  })

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
      material={getFilmMaterial()}
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
