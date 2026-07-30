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
 * buradaki `InstancedMesh` dünya-uzayı matrisleri taşıyabilir ve kat
 * istifleme/slab lifti bedavaya doğru kalır.
 *
 * ## İki kural, ikisi de zorunlu
 *
 * 1. **Matrisler her kare yazılmaz.** 10.000 örneğe kare başına matris
 *    yazmak, kurtardığı çizim çağrısından pahalıya gelir. Yeniden inşa
 *    yalnız sahne değiştiğinde ya da bir katman sınırı geçildiğinde olur.
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
  material: THREE.Material
  /** Materyal kimliği — havuz anahtarına girer, iki materyal karışamaz. */
  materialKey: string
  castShadowWhenFull: boolean
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
  patch: Partial<Pick<InstanceEntry, 'geometryFor' | 'keyFor' | 'material' | 'materialKey'>>,
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
      objects: THREE.Object3D[]
    }
  >()

  for (const entry of entries.values()) {
    if (entry.excluded) continue
    const tier = entry.tier
    const poolKey = `${entry.keyFor(tier)}::${entry.materialKey}`
    let bucket = buckets.get(poolKey)
    if (!bucket) {
      bucket = {
        geometry: entry.geometryFor(tier),
        material: entry.material,
        castShadow: entry.castShadowWhenFull && tier === 'full',
        objects: [],
      }
      buckets.set(poolKey, bucket)
    }
    bucket.objects.push(entry.object)
  }

  // Kullanılmayan havuzları düşür.
  for (const [poolKey, pool] of pools) {
    if (buckets.has(poolKey)) continue
    root.remove(pool.mesh)
    // Geometri PAYLAŞIMLI — asla dispose edilmez; yalnız örnek tamponu.
    pool.mesh.dispose()
    pools.delete(poolKey)
  }

  for (const [poolKey, bucket] of buckets) {
    const needed = bucket.objects.length
    let pool = pools.get(poolKey)
    if (pool && (pool.capacity < needed || pool.mesh.geometry !== bucket.geometry)) {
      root.remove(pool.mesh)
      pool.mesh.dispose()
      pool = undefined
      pools.delete(poolKey)
    }
    if (!pool) {
      const capacity = Math.max(16, 1 << Math.ceil(Math.log2(needed || 1)))
      const mesh = new THREE.InstancedMesh(bucket.geometry, bucket.material, capacity)
      mesh.frustumCulled = false
      mesh.castShadow = bucket.castShadow
      mesh.receiveShadow = true
      // Örnekler kendi kayıtlı gruplarından tıklanır; kolektif mesh ışın
      // testine hiç girmez.
      mesh.raycast = () => {}
      mesh.matrixAutoUpdate = false
      root.add(mesh)
      pool = { mesh, capacity }
      pools.set(poolKey, pool)
    }

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

/** Test ve teşhis: kaç çizim çağrısına indi. */
export function poolCount(): number {
  return pools.size
}

export function clearPools(root: THREE.Object3D | null): void {
  for (const pool of pools.values()) {
    root?.remove(pool.mesh)
    pool.mesh.dispose()
  }
  pools.clear()
}
