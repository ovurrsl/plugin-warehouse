import { sceneRegistry } from '@pascal-app/core'
import * as THREE from 'three'

/**
 * Kolektif instancing — ölçülmüş darboğazın çözümü.
 *
 * ## Ölçüm
 *
 * 3000 palet + 2000 raf + 300 konveyörlük gerçekçi bir sahnede geometri
 * paylaşımı **zaten mükemmel**: 2000 raf yalnız 2 farklı buffer'a, 3000
 * palet 6 buffer'a çözülüyor. Sorun bellek değil — aynı buffer'ın **binlerce
 * kez ayrı ayrı dispatch edilmesi**. ~10.300 çizim çağrısı, anahtar başına
 * instancing ile ~11'e iner.
 *
 * ## Motorun izin verdiği yol
 *
 * `instanced-glb` yalnız GLB varlıkları için. Parametrik kind'lar için
 * host'un kendi tip dosyası çözümü yazıyor (`types.d.ts:796`): *"an
 * instanced kind whose renderer is an invisible selection proxy and whose
 * real geometry comes from a system"*. `RegisteredSystems` doğrudan
 * `<Canvas>` altında mount edilir — dünya dönüşümü BİRİMDİR, dolayısıyla
 * buradaki `InstancedMesh` dünya-uzayı matrisleri taşıyabilir.
 *
 * ## Dünya matrisi ÖNBELLEĞE ALINIR — ve bu bir borçtur
 *
 * Burada bir zamanlar "kat istifleme/slab lifti bedavaya doğru kalır"
 * yazıyordu. Doğrusu: **yalnız `rebuildPools` çağrıldığı an için** doğru
 * kalır. Kat kendi altındaki her şeyi taşıyabilir — patlatılmış görünümde
 * `LevelSystem` her kare `position.y`'yi lerpler — ve bu, kayıtlı gruba
 * işler ama önbelleğe alınmış matrise işlemez.
 *
 * Bir önbellek ancak onu geçersiz kılan olayların listesi eksiksizse
 * doğrudur. O liste `collective-system.tsx`'te tutuluyor ve kat hareketini
 * de içermek ZORUNDA. (Ölçülen belirti: patlatınca raflar eski katta asılı
 * kalıyor, kamera bir katman sınırı geçince yerine zıplıyordu.)
 *
 * ## İki kural, ikisi de zorunlu
 *
 * 1. **Matrisler her kare yazılmaz.** 10.000 örneğe kare başına matris
 *    yazmak, kurtardığı çizim çağrısından pahalıya gelir. Yeniden inşa
 *    yalnız sahne, katman ya da KAT KONUMU değiştiğinde olur.
 *
 * 2. **Seçili ve sürüklenen düğüm kendini çizer.** Ana hat geçişi
 *    (`merged-outline-node.ts:629`) kayıtlı nesnenin GÖRÜNÜR mesh'lerini
 *    tarıyor: gövdesi tamamen instancing'e taşınmış bir düğümün ana hattı
 *    kaybolurdu. Bir sahnede bir iki seçili düğüm olur; onların kendi
 *    çizimini ödemek, ana hattı kaybetmemenin bedelidir.
 */

export type InstanceTier = 'full' | 'simple'

export type InstanceEntry = {
  nodeId: string
  /** Kayıtlı grup — dünya matrisinin tek kaynağı. */
  object: THREE.Object3D
  /** Katman başına buffer; anahtar havuzu böler. */
  geometryFor: (tier: InstanceTier) => THREE.BufferGeometry
  keyFor: (tier: InstanceTier) => string
  /**
   * Materyal de KATMAN BAŞINA — geometriyle aynı biçimde.
   *
   * Skalerdi ve palet bunun bedelini ödüyordu: uzak katman geometrisi çıplak
   * bir kutu ve kendi düz materyali var (`getPalletFarMaterial`), tam da EPAL
   * atlasının on iki üçgene yayılmasını önlemek için yazılmış. Kolektif yol
   * skaler materyali kullandığı için uzaktaki paletlere atlas kutuya
   * sürülüyordu — kodun yanındaki yorum bunun olmaması gerektiğini
   * söylüyordu ama tip bunu ifade edemiyordu.
   */
  materialFor: (tier: InstanceTier) => THREE.Material
  /** Materyal kimliği — havuz anahtarına girer, iki materyal karışamaz. */
  materialKeyFor: (tier: InstanceTier) => string
  /**
   * Gölge düşürür mü. Bir zamanlar `castShadowWhenFull` idi ve katmanla
   * çarpılıyordu; sonuç, 70 m'nin ötesindeki her rafın sistem gölgesi AÇIK
   * olsa bile gölge düşürmemesiydi. Host gölgeyi mesh düzeyinde değil
   * `renderer.shadowMap.enabled` üstünden açıp kapatıyor ve built-in
   * kind'ların hepsi `castShadow`'u koşulsuz bırakıyor — mesafeye göre
   * kısmak host'un sözleşmesine aykırı. Uzaktaki nesneler gölge haritasında
   * zaten birkaç texel: frustum binaya fit ve harita 1024².
   */
  castsShadow: boolean
  /** Katman eşikleri, metre² (kind'ın kendi bandı). */
  farSq: number
  nearSq: number
  /** Bu düğüm şu an kendi mesh'ini mi çiziyor (seçili / sürükleniyor). */
  excluded: boolean
  /** Sistemin sürdüğü katman. */
  tier: InstanceTier
}

const entries = new Map<string, InstanceEntry>()

/** Sistem bunu okur; herhangi bir değişiklikte artırılır. */
let generation = 0

export function registerInstance(entry: InstanceEntry): void {
  entries.set(entry.nodeId, entry)
  generation++
}

export function unregisterInstance(nodeId: string): void {
  if (entries.delete(nodeId)) generation++
}

/** Seçim/sürükleme durumu değişti — düğüm havuzdan çıkar ya da girer. */
export function setInstanceExcluded(nodeId: string, excluded: boolean): void {
  const entry = entries.get(nodeId)
  if (!entry || entry.excluded === excluded) return
  entry.excluded = excluded
  generation++
}

/**
 * Şekil, materyal ya da eşik değişti — kayıt yerinde güncellenir ve havuz
 * bir sonraki karede yeniden toplanır. Kaydı silip yeniden kurmak, düğümü
 * bir kare boyunca hiç çizilmez hâle getirirdi.
 */
export function refreshInstance(
  nodeId: string,
  patch: Partial<Pick<InstanceEntry, 'geometryFor' | 'keyFor' | 'materialFor' | 'materialKeyFor'>>,
): void {
  const entry = entries.get(nodeId)
  if (!entry) return
  Object.assign(entry, patch)
  generation++
}

export function instanceEntries(): IterableIterator<InstanceEntry> {
  return entries.values()
}

export function instanceGeneration(): number {
  return generation
}

/** Test kancası — havuzun gerçekten paylaştığının tek kanıtı. */
export function instanceCount(): number {
  return entries.size
}

export function resetInstances(): void {
  entries.clear()
  generation = 0
}

// ── Havuz ───────────────────────────────────────────────────────────────

const worldPosition = new THREE.Vector3()
const scratchMatrix = new THREE.Matrix4()

/**
 * Katman değerlendirmesi — histerezisli, faz dağıtımlı.
 *
 * Düğüm başına ayrı `useFrame` yerine TEK döngü: beş bin kapanış yerine bir
 * tane. Faz dağıtımı korunur (aynı karede hepsi yeniden değerlendirilmesin),
 * ama artık tek bir sayaçtan okunur.
 *
 * @returns katman değişen düğüm oldu mu
 */
export function evaluateTiers(cameraPosition: THREE.Vector3, frame: number): boolean {
  let changed = false
  let index = 0
  for (const entry of entries.values()) {
    index++
    // Faz: her karede toplamın 1/8'i değerlendirilir.
    if ((frame + index) % 8 !== 0) continue
    const { elements } = entry.object.matrixWorld
    const distanceSq = cameraPosition.distanceToSquared(
      worldPosition.set(elements[12] ?? 0, elements[13] ?? 0, elements[14] ?? 0),
    )
    const next: InstanceTier =
      entry.tier === 'full'
        ? distanceSq > entry.farSq
          ? 'simple'
          : 'full'
        : distanceSq < entry.nearSq
          ? 'full'
          : 'simple'
    if (next !== entry.tier) {
      entry.tier = next
      changed = true
    }
  }
  return changed
}

/**
 * Düğüm gerçekten görünür mü — ATALARI dâhil.
 *
 * Kolektif mesh sahne KÖKÜNDE duruyor, düğümün kendi ağacında değil. Yani
 * düğümü ya da onu taşıyan katı gizleyen her şey kolektif çiziciyi atlıyordu:
 *
 *  - Renderer'ın dış sarmalayıcısı (`<group visible={node.visible !== false}>`)
 *    kayıtlı grubu sarıyor → bir nesneyi gizlemek onu gizlemiyordu.
 *  - `LevelSystem` solo modunda kat grubuna `obj.visible = !hidden` yazıyor →
 *    gizlenen kattaki raflar çizilmeye devam ediyordu.
 *
 * Görünürlük three'de kalıtsal olduğu için ata zincirini yürümek şart; ~5
 * derinlikte bir boolean taraması ve yalnız yeniden inşa sırasında ödeniyor.
 */
function isEffectivelyVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object
  while (current) {
    if (!current.visible) return false
    current = current.parent
  }
  return true
}

type Pool = {
  mesh: THREE.InstancedMesh
  capacity: number
}

const pools = new Map<string, Pool>()

/**
 * Havuzları yeniden kurar. YALNIZ sahne ya da katman değiştiğinde çağrılır.
 *
 * `InstancedMesh` kapasitesi sabittir; büyümesi gerekiyorsa mesh değişir ve
 * eskisi atılır. Kapasite iki katına yuvarlanıyor ki bir palet eklemek her
 * seferinde yeniden tahsis ettirmesin.
 */
export function rebuildPools(root: THREE.Object3D): void {
  // Anahtar başına örnekleri topla.
  const buckets = new Map<
    string,
    {
      geometry: THREE.BufferGeometry
      material: THREE.Material
      castShadow: boolean
      layersMask: number
      objects: THREE.Object3D[]
    }
  >()

  for (const entry of entries.values()) {
    if (entry.excluded) continue
    if (!isEffectivelyVisible(entry.object)) continue
    const tier = entry.tier
    /**
     * Katman maskesi HAVUZ ANAHTARININ parçası — solo kipinin öteki yarısı.
     *
     * Host solo'da iki farklı şey yapıyor: seçili katın ALTINDAKİLER
     * `visible = false` olur (yukarıdaki görünürlük taraması yakalar), ama
     * ÜSTÜNDEKİLER görünür KALIR ve `applyShadowOnly` her alt nesnenin
     * katman maskesini "yalnız gölge"ye çevirir — güneş, gizlenen katların
     * içinden solo katı yine gölgelesin diye. Maske kalıtsal değildir; host
     * bu yüzden alt ağacı tek tek damgalar ve kayıtlı grubumuz da damgayı
     * alır. Ama kolektif mesh sahne KÖKÜNDE durur, damga ona hiç ulaşmaz —
     * yani üst katlardaki raflar renk geçişinde çizilmeye devam ediyordu.
     *
     * Maske anahtara girince aynı şeklin renkli ve yalnız-gölge örnekleri
     * ayrı mesh'lere düşer, mesh kaynağın maskesini AYNEN kopyalar. Sabit
     * (`SHADOW_ONLY_LAYER`) okunmuyor — bilerek: viewer barrel'ı onu dışa
     * vermiyor ve kopyalamak zaten daha doğru, host yarın başka bir maske
     * damgalarsa havuz onu da bedavaya izler.
     */
    const layersMask = entry.object.layers.mask
    const poolKey = `${entry.keyFor(tier)}::${entry.materialKeyFor(tier)}::L${layersMask}`
    let bucket = buckets.get(poolKey)
    if (!bucket) {
      bucket = {
        geometry: entry.geometryFor(tier),
        material: entry.materialFor(tier),
        castShadow: entry.castsShadow,
        layersMask,
        objects: [],
      }
      buckets.set(poolKey, bucket)
    }
    bucket.objects.push(entry.object)
  }

  // Kullanılmayan havuzları düşür.
  for (const [poolKey, pool] of pools) {
    if (buckets.has(poolKey)) continue
    pool.mesh.removeFromParent()
    // Geometri PAYLAŞIMLI — asla dispose edilmez; yalnız örnek tamponu.
    pool.mesh.dispose()
    pools.delete(poolKey)
  }

  for (const [poolKey, bucket] of buckets) {
    const needed = bucket.objects.length
    let pool = pools.get(poolKey)
    if (pool && (pool.capacity < needed || pool.mesh.geometry !== bucket.geometry)) {
      pool.mesh.removeFromParent()
      pool.mesh.dispose()
      pool = undefined
      pools.delete(poolKey)
    }
    if (!pool) {
      const capacity = Math.max(16, 1 << Math.ceil(Math.log2(needed || 1)))
      const mesh = new THREE.InstancedMesh(bucket.geometry, bucket.material, capacity)
      mesh.frustumCulled = false
      mesh.receiveShadow = true
      // Örnekler kendi kayıtlı gruplarından tıklanır; kolektif mesh ışın
      // testine hiç girmez.
      mesh.raycast = () => {}
      mesh.matrixAutoUpdate = false
      root.add(mesh)
      pool = { mesh, capacity }
      pools.set(poolKey, pool)
    }
    /**
     * Havuz modül kapsamında yaşıyor, `root` ise sistem örneğine ait —
     * ve sistem, Canvas yeniden mount edildiğinde (editör ⇄ preview geçişi)
     * yeni bir `root` ile geri gelir. Yeniden kullanılan bir mesh yalnız
     * yaratıldığı dalda eklendiği için ölü sahnenin çocuğu olarak kalıyordu:
     * havuz doluydu, `count` doğruydu, ama mesh hiçbir yerde çizilmiyordu.
     * Ölçülen belirti "preview'da uzaklaşınca raflar kayboluyor"du —
     * uzaktaki `simple` anahtarı eski Canvas'tan miras kalmış hayalet havuza
     * düşüyor, yakındaki `full` anahtarı yeni olduğu için görünüyordu.
     */
    if (pool.mesh.parent !== root) root.add(pool.mesh)
    // Gölge kararı ve katman maskesi her yeniden kuruluşta yazılır: aynı
    // havuz anahtarı farklı bir bucket'a denk gelirse yaratım anındaki değere
    // saplanıp kalırdı. Maske kaynağın kopyası — solo'da üst katların
    // yalnız-gölge damgası böylece kolektif mesh'e de işler.
    pool.mesh.castShadow = bucket.castShadow
    pool.mesh.layers.mask = bucket.layersMask

    for (let index = 0; index < needed; index++) {
      const object = bucket.objects[index]
      if (!object) continue
      // Dünya matrisi olduğu gibi: kat istifleme, slab lifti ve döndürme
      // zaten içinde. Kolektif mesh birim dönüşümde durduğu için başka
      // hiçbir çarpım gerekmiyor.
      scratchMatrix.copy(object.matrixWorld)
      pool.mesh.setMatrixAt(index, scratchMatrix)
    }
    pool.mesh.count = needed
    pool.mesh.instanceMatrix.needsUpdate = true
    pool.mesh.computeBoundingSphere()
  }
}

/**
 * Kat hareketini "değişti" saymak için eşik, metre.
 *
 * `LevelSystem` hedefe lerp'liyor (`position.y += (target − y) · delta · 12`),
 * yani matematiksel olarak asla tam oturmaz. Eşik olmadan her kare yeniden
 * inşa tetiklerdik. Yarım milimetre gözle görülemez ve lerp'in oraya inmesi
 * yarım saniye sürüyor.
 */
const LEVEL_SETTLED_M = 5e-4

/**
 * Kat grupları son bakıştan bu yana kımıldadı ya da görünürlüğü değişti mi.
 *
 * Bu, önbelleğin geçersiz kılma listesindeki EKSİK maddeydi. Havuz dünya
 * matrislerini saklıyor; kat kendi altındaki her şeyi taşıyabiliyor
 * (patlatılmış görünüm) ya da gizleyebiliyor (solo) — ikisi de `useScene`'e
 * dokunmuyor, `generation`'ı artırmıyor, katman değiştirmiyor. Yani havuzun
 * bildiği hiçbir tetikleyici bunları duymuyordu.
 *
 * Neden `levelMode`'a abone olmak yerine konumu ÖLÇÜYORUZ: `LevelSystem`
 * hedefe lerp'liyor, yani mod değiştiği kare ile katın yerine oturduğu kare
 * arasında yarım saniye var — moda abone olmak o aralığın yalnız ilk karesini
 * yakalardı. Ölçmek ayrıca `solo`, `manual` ve dışa aktarımın katları gerçek
 * yığına çektiği `snapLevelsToTruePositions` yolunu da bedavaya kapsıyor.
 *
 * Sahnede bir avuç kat vardır; bu, kare başına birkaç karşılaştırma.
 */
export type LevelSignature = { y: number; mask: number }
export function pollLevelPositions(seen: Map<string, LevelSignature>): boolean {
  let moved = false
  const alive = new Set<string>()
  for (const levelId of sceneRegistry.byType.level ?? []) {
    const object = sceneRegistry.nodes.get(levelId)
    if (!object) continue
    alive.add(levelId)
    // Y ve görünürlük tek sayıya katlanıyor: gizli kat NaN, görünür kat Y.
    const y = object.visible ? object.position.y : Number.NaN
    /**
     * Katman maskesi de ölçülüyor — Y'nin yakalayamadığı geçiş bu.
     *
     * Solo'da seçili katın ÜSTÜNDEKİ katlar ne taşınır ne gizlenir: yerli
     * yerinde, `visible = true`, yalnız maskeleri "yalnız gölge" olur. Y'ye
     * bakan bir ölçüm bu geçişi hiç görmez ve havuz eski maskeyle çizmeye
     * devam ederdi. Kat grubunun kendi maskesi yeter: `applyShadowOnly` alt
     * ağacı kökünden damgalar, yani kök değiştiyse altındakiler de değişti.
     */
    const mask = object.layers.mask
    const previous = seen.get(levelId)
    const changed =
      previous === undefined ||
      Number.isNaN(previous.y) !== Number.isNaN(y) ||
      (!Number.isNaN(y) && Math.abs(previous.y - y) > LEVEL_SETTLED_M) ||
      previous.mask !== mask
    if (changed) {
      seen.set(levelId, { y, mask })
      moved = true
    }
  }
  // Kaybolan kat haritadan düşer. "Değişti" DEMEZ: sahne değişimi zaten kendi
  // tetikleyicisinden yeniden inşa ettiriyor, burada tekrar demek boşa iş olur.
  for (const levelId of seen.keys()) {
    if (!alive.has(levelId)) seen.delete(levelId)
  }
  return moved
}

/**
 * Kat alt ağaçlarının dünya matrislerini ŞİMDİ tazele.
 *
 * R3F dünya matrislerini `useFrame`'lerden SONRA, çizim sırasında günceller —
 * yani bir sistemin okuduğu `matrixWorld` bir önceki karenin değeridir. Kat
 * hareket ederken bu bir kare gecikme demek. Katın alt ağacını güncellemek,
 * render'ın zaten yapacağı işi öne almaktan ibaret ve yalnız gerçekten
 * yeniden inşa ederken ödeniyor.
 */
export function refreshLevelWorldMatrices(): void {
  for (const levelId of sceneRegistry.byType.level ?? []) {
    sceneRegistry.nodes.get(levelId)?.updateWorldMatrix(true, true)
  }
}

/** Test ve teşhis: kaç çizim çağrısına indi. */
export function poolCount(): number {
  return pools.size
}

export function clearPools(root: THREE.Object3D | null): void {
  for (const pool of pools.values()) {
    // `root`'tan değil, GERÇEK ebeveyninden sökülür: Canvas yeniden mount
    // edildiğinde mesh hâlâ eski sahnenin çocuğu olabilir ve yeni root'tan
    // silmeye çalışmak sessizce hiçbir şey yapardı.
    pool.mesh.removeFromParent()
    root?.remove(pool.mesh)
    pool.mesh.dispose()
  }
  pools.clear()
}
