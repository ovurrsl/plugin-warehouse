'use client'

import * as THREE from 'three'
import { groupByGeometry, makeBakeReplaceRenderer } from '../instancing/bake-replace'
import { getCargoGeometry } from './cargo-geometry'
import { cargoInputOf } from './cargo-parts'
import { getPalletGeometry } from './geometry-builder'
import { getCargoMaterial, getPalletMaterial } from './materials'
import { specOf } from './presets'
import type { PalletNode } from './schema'

/**
 * Baked `/viewer` için paletin kolektif statik çizicisi — rafınkinin muadili.
 *
 * Katman hep `full`: bake mesafeye bağlı bir katmanı dosyaya pişirmemeli (dışa
 * aktarım yolunun kuralıyla aynı).
 *
 * ## İki üye sınıfı, çünkü palet iki mesh
 *
 * Editörde güverte ve yük AYRI kayıtlarla havuza giriyor; bake'te de öyle
 * olmalı, yoksa yüklü her palet baked görünümde çıplak bir tahtaya döner. İkisi
 * `bake` alanıyla ayrılıyor: yük üyesi hazır tamponuyla geliyor, güverte üyesi
 * presetinden çözülüyor. Gruplama zaten geometri NESNESİNE göre olduğu için
 * ikisi kendiliğinden ayrı `InstancedMesh`'lere düşüyor ve materyaller
 * karışamıyor.
 *
 * ## Bilinen fark: streç film bake'e girmez
 *
 * Editörde film havuzun dışında kalıyor ve gerekçesi burada da geçerli: saydam,
 * kendi sıralama düzenini istiyor, ve görünürlüğü düğüm başına mesafeyle
 * kesiliyor (`FILM_DRAW_DISTANCE_M`). Durağan bir örnek tamponu üçünü de ifade
 * edemiyor — kesme olmadan binadaki HER streç her karede harmanlanır, ve
 * harmanlanan yüzey alanı bu işin bütün hedefi olan tümleşik GPU'da ölçülen en
 * pahalı kalem. Bedeli: sarılı paletler baked görünümde streçsiz görünür.
 */
type PalletBakeMember = PalletNode & {
  /** Güverte dışındaki üyeler tamponlarıyla gelir; güverte üyesinde yok. */
  readonly bake?: { geometry: THREE.BufferGeometry; material: THREE.Material }
}

/** Yükün çapası paletin kimliğinden ayrı bir üye — editördeki
 *  `CARGO_INSTANCE_SUFFIX` ile aynı gerekçe ve aynı ek. */
const CARGO_SUFFIX = ':cargo'

const liftEuler = new THREE.Euler()
const liftOffset = new THREE.Vector3()

/**
 * Yükün durduğu nokta: paletin konumu artı güverte yüksekliği, paletin KENDİ
 * çerçevesinde.
 *
 * `y + yükseklik` yazmak bugünkü sahnelerde doğru sonucu verirdi — palet
 * `rotatable: { axes: ['y'] }` bildiriyor ve saf bir Y dönüşü `[0, h, 0]`
 * vektörünü kımıldatmıyor. Ama şema dönüşü üç serbest sayı olarak tutuyor
 * (içe aktarılan ya da MCP ile kurulan bir sahne yatık bir palet taşıyabilir),
 * ve o hâlde yük havada ya da güvertenin içinde durur. Editör bu hesabı hiç
 * yapmıyor: yük paletin alt ağacında, three dönüşü zaten uyguluyor. Bake yolu
 * matrisleri düz düğüm verisinden kurduğu için aynı şeyi elle yapmak zorunda.
 *
 * Ayrı export, `static-transform.ts`'in `applyStaticTransform`'uyla aynı
 * gerekçe: bir test bunu sahne kurmadan sürebilsin.
 */
export function deckTopOf(node: PalletNode): [number, number, number] {
  const [x, y, z] = node.position
  const [rx, ry, rz] = node.rotation
  liftOffset.set(0, specOf(node.preset).height, 0).applyEuler(liftEuler.set(rx, ry, rz))
  return [x + liftOffset.x, y + liftOffset.y, z + liftOffset.z]
}

export default makeBakeReplaceRenderer<PalletBakeMember>((nodes, appearance) => {
  const cargoMaterial = getCargoMaterial(appearance)

  const members: PalletBakeMember[] = [...nodes]
  for (const node of nodes) {
    // `cargoInputOf` güverteye sığmayan yükü reddediyor — editörde de mount
    // sınırı burası, ve iki yolun farklı karar vermesi bir paleti bir görünümde
    // yüklü, ötekinde boş gösterirdi.
    const input = cargoInputOf(node, 'full')
    if (!input) continue
    members.push({
      ...node,
      id: `${node.id}${CARGO_SUFFIX}`,
      position: deckTopOf(node),
      bake: { geometry: getCargoGeometry(input), material: cargoMaterial },
    })
  }

  return groupByGeometry(
    members,
    (member) => member.bake?.geometry ?? getPalletGeometry(member.preset),
    // Güverte materyali PRESET'e bağlı (plastik palet ahşap atlası kullanmaz),
    // o yüzden tek bir dış değişken değil, üye başına okunuyor —
    // `surfaceMaterial` aile başına tekil olduğu için bu bedava.
    (member) => member.bake?.material ?? getPalletMaterial(appearance, member.preset),
  )
})
