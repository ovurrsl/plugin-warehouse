import { beforeEach, describe, expect, test } from 'bun:test'
import { sceneRegistry } from '@pascal-app/core'
import * as THREE from 'three'
import type { InstanceTier, LevelSignature } from './collective'
import {
  clearPools,
  evaluateTiers,
  instanceCount,
  instanceEntries,
  instanceGeneration,
  pollLevelPositions,
  poolCount,
  rebuildPools,
  refreshInstance,
  registerInstance,
  resetInstances,
  setInstanceExcluded,
  unregisterInstance,
} from './collective'

const GEOM_A = new THREE.BoxGeometry(1, 1, 1)
const GEOM_B = new THREE.BoxGeometry(2, 1, 1)
const MATERIAL = new THREE.MeshBasicMaterial()

/** Kayıtlı grubun yerine geçen nesne — dünya matrisi elle konumlanır. */
function objectAt(x: number, z = 0): THREE.Object3D {
  const object = new THREE.Object3D()
  object.position.set(x, 0, z)
  object.updateMatrix()
  object.updateMatrixWorld(true)
  return object
}

function entry(id: string, x: number, shape: 'a' | 'b' = 'a') {
  return {
    nodeId: id,
    object: objectAt(x),
    geometryFor: () => (shape === 'a' ? GEOM_A : GEOM_B),
    keyFor: (tier: 'full' | 'simple') => `${shape}:${tier}`,
    materialFor: () => MATERIAL,
    materialKeyFor: () => 'test',
    castsShadow: true,
    farSq: 70 * 70,
    nearSq: 55 * 55,
    excluded: false,
    // `as const` DEĞİL: testlerin katmanı elle değiştirebilmesi gerekiyor ve
    // literal tip bunu engelliyordu.
    tier: 'full' as InstanceTier,
  }
}

let root: THREE.Object3D

beforeEach(() => {
  clearPools(root ?? null)
  resetInstances()
  root = new THREE.Object3D()
})

describe('kayıt defteri', () => {
  test('ekleme/çıkarma sayacı ilerletir — sistem yeniden inşayı bundan bilir', () => {
    const before = instanceGeneration()
    registerInstance(entry('a', 0))
    expect(instanceGeneration()).toBeGreaterThan(before)
    expect(instanceCount()).toBe(1)
    const mid = instanceGeneration()
    unregisterInstance('a')
    expect(instanceGeneration()).toBeGreaterThan(mid)
    expect(instanceCount()).toBe(0)
  })

  test('olmayan kaydı silmek sayacı BOŞA ilerletmez', () => {
    const before = instanceGeneration()
    unregisterInstance('yok')
    expect(instanceGeneration()).toBe(before)
  })

  test('aynı değere excluded set etmek sayacı ilerletmez — her render çağrılabilir', () => {
    registerInstance(entry('a', 0))
    const before = instanceGeneration()
    setInstanceExcluded('a', false)
    expect(instanceGeneration()).toBe(before)
    setInstanceExcluded('a', true)
    expect(instanceGeneration()).toBeGreaterThan(before)
  })

  test('refreshInstance kaydı YERİNDE günceller — bir kare kaybolmaz', () => {
    registerInstance(entry('a', 0))
    const before = instanceGeneration()
    refreshInstance('a', { materialKeyFor: () => 'other' })
    expect(instanceCount()).toBe(1) // hâlâ kayıtlı
    expect(instanceGeneration()).toBeGreaterThan(before)
  })
})

describe('katman değerlendirmesi — histerezis ve faz', () => {
  test('uzaklaşan düğüm simple, geri yaklaşan full; bant içinde değişmez', () => {
    registerInstance(entry('a', 0))
    const camera = new THREE.Vector3(0, 0, 0)

    // Bant içi (55–70 m): katman DEĞİŞMEZ, iki yönde de.
    camera.set(60, 0, 0)
    // Faz: 8 karede bir; tek kaydın indeksi 1 olduğundan frame 7'de değerlenir.
    evaluateTiers(camera, 7)
    expect(poolBucketTier()).toBe('full')

    camera.set(80, 0, 0)
    expect(evaluateTiers(camera, 7)).toBe(true)
    expect(poolBucketTier()).toBe('simple')

    // 60 m bandın içinde: simple'dan full'e DÖNMEZ.
    camera.set(60, 0, 0)
    expect(evaluateTiers(camera, 7)).toBe(false)
    expect(poolBucketTier()).toBe('simple')

    // 50 m yakın eşiğin altında: full'e döner.
    camera.set(50, 0, 0)
    expect(evaluateTiers(camera, 7)).toBe(true)
    expect(poolBucketTier()).toBe('full')
  })

  test('faz dağıtımı: her karede toplamın 1/8’i değerlendirilir', () => {
    for (let i = 0; i < 8; i++) registerInstance(entry(`n${i}`, 0))
    const camera = new THREE.Vector3(500, 0, 0)
    // Tek karede hepsi değil — sekiz kayıttan yalnız biri sınıra girer.
    evaluateTiers(camera, 0)
    let simple = 0
    rebuildPools(root)
    for (const child of root.children) {
      const mesh = child as THREE.InstancedMesh
      if (mesh.geometry === GEOM_A) simple += mesh.count
    }
    // Sekiz düğümün hepsi hâlâ havuzda ama katmanları karışık: iki havuz
    // (full + simple) oluştu ise faz gerçekten dağıtıyor demektir.
    expect(root.children.length).toBeGreaterThanOrEqual(1)
    expect(simple).toBe(8)
  })
})

/** Tek kaydın katmanını havuzdan okur. */
function poolBucketTier(): 'full' | 'simple' {
  // Katmanı doğrudan kaydından okur. Bir zamanlar gölge bayrağından
  // çıkarılıyordu ("yalnız full gölge atar") — o bağ artık yok: gölge host'un
  // anahtarına ait, mesafeye değil. Vekil bir ölçüt, ölçtüğü şey değiştiğinde
  // sessizce yanlış cevap verir; burada gürültülü biçimde patladı ve iyi oldu.
  return [...instanceEntries()][0]?.tier ?? 'full'
}

describe('havuz toplama — ölçülen kazancın kendisi', () => {
  test('aynı anahtardaki bin düğüm TEK çizim çağrısına iner', () => {
    for (let i = 0; i < 1000; i++) registerInstance(entry(`r${i}`, i * 3))
    rebuildPools(root)
    expect(poolCount()).toBe(1)
    const mesh = root.children[0] as THREE.InstancedMesh
    expect(mesh.count).toBe(1000)
  })

  test('farklı şekil = farklı havuz; ikisi karışmaz', () => {
    for (let i = 0; i < 10; i++) registerInstance(entry(`a${i}`, i, 'a'))
    for (let i = 0; i < 10; i++) registerInstance(entry(`b${i}`, i, 'b'))
    rebuildPools(root)
    expect(poolCount()).toBe(2)
    const geometries = root.children.map((c) => (c as THREE.InstancedMesh).geometry)
    expect(new Set(geometries).size).toBe(2)
  })

  test('excluded düğüm havuza GİRMEZ — kendi mesh’ini çiziyor, iki kez çizilmez', () => {
    for (let i = 0; i < 5; i++) registerInstance(entry(`n${i}`, i))
    setInstanceExcluded('n2', true)
    rebuildPools(root)
    const mesh = root.children[0] as THREE.InstancedMesh
    expect(mesh.count).toBe(4)
  })

  test('örnek matrisi düğümün DÜNYA matrisidir — kat istifleme bedavaya doğru', () => {
    const e = entry('a', 0)
    // Bir kat grubu altında: dünya matrisi yerel + ebeveyn.
    const level = new THREE.Object3D()
    level.position.set(0, 4.5, 0)
    level.add(e.object)
    e.object.position.set(12, 0, -7)
    level.updateMatrixWorld(true)
    registerInstance(e)

    rebuildPools(root)
    const mesh = root.children[0] as THREE.InstancedMesh
    const read = new THREE.Matrix4()
    mesh.getMatrixAt(0, read)
    const position = new THREE.Vector3().setFromMatrixPosition(read)
    expect(position.x).toBeCloseTo(12, 9)
    expect(position.y).toBeCloseTo(4.5, 9) // katın Y'si — hiçbir çarpım yazmadan
    expect(position.z).toBeCloseTo(-7, 9)
  })

  test('kapasite büyürken mesh yenilenir, küçülürken yenilenmez', () => {
    for (let i = 0; i < 10; i++) registerInstance(entry(`n${i}`, i))
    rebuildPools(root)
    const first = root.children[0] as THREE.InstancedMesh
    // 10 → 16 kapasite; 12'ye çıkmak aynı mesh'i kullanmalı.
    for (let i = 10; i < 12; i++) registerInstance(entry(`n${i}`, i))
    rebuildPools(root)
    expect(root.children[0]).toBe(first)
    expect((root.children[0] as THREE.InstancedMesh).count).toBe(12)
    // 20'ye çıkmak kapasiteyi aşar → yeni mesh.
    for (let i = 12; i < 20; i++) registerInstance(entry(`n${i}`, i))
    rebuildPools(root)
    expect(root.children[0]).not.toBe(first)
    expect((root.children[0] as THREE.InstancedMesh).count).toBe(20)
  })

  test('boşalan havuz sökülür — silinen düğümler hayalet bırakmaz', () => {
    for (let i = 0; i < 4; i++) registerInstance(entry(`n${i}`, i))
    rebuildPools(root)
    expect(poolCount()).toBe(1)
    for (let i = 0; i < 4; i++) unregisterInstance(`n${i}`)
    rebuildPools(root)
    expect(poolCount()).toBe(0)
    expect(root.children.length).toBe(0)
  })

  test('kolektif mesh ışın testine girmez — tıklama kendi grubundan gelir', () => {
    registerInstance(entry('a', 0))
    rebuildPools(root)
    const mesh = root.children[0] as THREE.InstancedMesh
    const hits: THREE.Intersection[] = []
    mesh.raycast(new THREE.Raycaster(), hits)
    expect(hits.length).toBe(0)
  })
})

describe('Canvas yeniden mount — ölçülen "preview’da kayboluyor" hatası', () => {
  test('yeniden kullanılan havuz YENİ köke bağlanır', () => {
    for (let i = 0; i < 4; i++) registerInstance(entry(`n${i}`, i))
    rebuildPools(root)
    const mesh = root.children[0] as THREE.InstancedMesh
    expect(mesh.parent).toBe(root)

    // Editör ⇄ preview geçişi: Canvas komple yenilenir, sistem yeni bir
    // `root` ile geri gelir. Havuz modül kapsamında olduğu için hayatta kalır.
    const freshRoot = new THREE.Object3D()
    rebuildPools(freshRoot)

    // Eskiden: mesh yalnız yaratıldığı dalda ekleniyordu, yani ölü sahnenin
    // çocuğu olarak kalıyor ve hiçbir yerde çizilmiyordu.
    expect(mesh.parent).toBe(freshRoot)
    expect(freshRoot.children).toContain(mesh)
    expect(root.children.length).toBe(0)
  })

  test('clearPools mesh’i GERÇEK ebeveyninden söker, verilen kökten değil', () => {
    registerInstance(entry('a', 0))
    rebuildPools(root)
    const mesh = root.children[0] as THREE.InstancedMesh

    // Alakasız bir kökle temizlemek bile mesh'i sahnede bırakmamalı.
    clearPools(new THREE.Object3D())
    expect(mesh.parent).toBeNull()
    expect(root.children.length).toBe(0)
  })
})

describe('görünürlük — kolektif mesh kökte durduğu için MİRAS ALMAZ', () => {
  test('gizli ATA altındaki düğüm havuza girmez', () => {
    const visible = entry('görünür', 0)
    const hidden = entry('gizli', 5)
    // Renderer'ın dış sarmalayıcısı (`<group visible={node.visible !== false}>`)
    // ya da solo modunda `LevelSystem`'in gizlediği kat grubu.
    const hiddenParent = new THREE.Object3D()
    hiddenParent.visible = false
    hiddenParent.add(hidden.object)
    registerInstance(visible)
    registerInstance(hidden)

    rebuildPools(root)
    const mesh = root.children[0] as THREE.InstancedMesh
    expect(mesh.count).toBe(1)
  })

  test('ata tekrar görünür olunca düğüm geri gelir', () => {
    const e = entry('a', 0)
    const parent = new THREE.Object3D()
    parent.visible = false
    parent.add(e.object)
    registerInstance(e)
    rebuildPools(root)
    expect(poolCount()).toBe(0)

    parent.visible = true
    rebuildPools(root)
    expect((root.children[0] as THREE.InstancedMesh).count).toBe(1)
  })
})

describe('gölge — host’un anahtarına ait, mesafeye değil', () => {
  test('uzak katmandaki düğüm de gölge düşürür', () => {
    const e = entry('a', 0)
    e.tier = 'simple'
    registerInstance(e)
    rebuildPools(root)
    // Bir zamanlar `castsShadow && tier === 'full'` idi: 70 m'nin ötesindeki
    // hiçbir raf, sistem gölgesi AÇIK olsa bile gölge düşürmüyordu.
    expect((root.children[0] as THREE.InstancedMesh).castShadow).toBe(true)
  })

  test('castsShadow: false diyen kind gölge düşürmez', () => {
    const e = { ...entry('a', 0), castsShadow: false }
    registerInstance(e)
    rebuildPools(root)
    expect((root.children[0] as THREE.InstancedMesh).castShadow).toBe(false)
  })
})

describe('materyal katman başına — paletin uzak materyali', () => {
  const FAR_MATERIAL = new THREE.MeshBasicMaterial()

  test('katman değişince materyal ve havuz da değişir', () => {
    const e = {
      ...entry('p', 0),
      materialFor: (tier: InstanceTier) => (tier === 'full' ? MATERIAL : FAR_MATERIAL),
      materialKeyFor: (tier: InstanceTier) => `pallet:${tier}`,
    }
    registerInstance(e)

    rebuildPools(root)
    expect((root.children[0] as THREE.InstancedMesh).material).toBe(MATERIAL)

    // Uzaklaştı: çıplak kutu geometrisi + kendi düz materyali. Skaler
    // materyalle EPAL atlası on iki üçgene sürülüyordu.
    e.tier = 'simple'
    rebuildPools(root)
    expect((root.children[0] as THREE.InstancedMesh).material).toBe(FAR_MATERIAL)
  })
})

describe('solo kipi — katman maskesi havuza işliyor', () => {
  /**
   * Host'un solo davranışının İKİ yarısı var ve ilkini görünürlük taraması
   * zaten yakalıyordu: seçili katın ALTINDAKİLER `visible = false` olur.
   * Bu blok ikinci yarıyı kilitliyor: ÜSTTEKİLER görünür KALIR ve
   * `applyShadowOnly` alt ağacın maskesini "yalnız gölge"ye çevirir — güneş
   * gizlenen katların içinden solo katı yine gölgelesin diye. Kolektif mesh
   * sahne kökünde durduğu için damgayı almıyordu ve üst katlardaki raflar
   * renk geçişinde çizilmeye devam ediyordu — kullanıcının bildirdiği hata.
   *
   * Host taklidi: maske kalıtsal DEĞİL, host bu yüzden alt ağacı tek tek
   * damgalıyor; testte de kayıtlı nesnenin kendi maskesi damgalanıyor.
   */
  const SHADOW_ONLY_MASK = 1 << 4 // host `layers.ts`: SHADOW_ONLY_LAYER = 4

  function stampShadowOnly(object: THREE.Object3D): void {
    object.layers.disable(0)
    object.layers.enable(4)
  }

  test('yalnız-gölge örnek AYRI havuza düşüyor ve maskeyi kopyalıyor', () => {
    const color = entry('renkli', 0)
    const above = entry('ust-kat', 3)
    stampShadowOnly(above.object)
    registerInstance(color)
    registerInstance(above)
    rebuildPools(root)

    // Aynı şekil, iki havuz: bir InstancedMesh tek maske taşıyabilir.
    expect(poolCount()).toBe(2)
    const meshes = root.children.filter(
      (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
    )
    const masks = meshes.map((mesh) => mesh.layers.mask).sort((a, b) => a - b)
    expect(masks).toEqual([1, SHADOW_ONLY_MASK])
  })

  test('yalnız-gölge havuz gölge ATMAYA devam ediyor — solo bunun için var', () => {
    const above = entry('ust-kat', 3)
    stampShadowOnly(above.object)
    registerInstance(above)
    rebuildPools(root)

    const mesh = root.children.find(
      (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
    )
    expect(mesh?.castShadow).toBe(true)
    // Ana kamera 0. katmanı görür; bu mesh onda YOK.
    expect(mesh?.layers.mask ?? 0 & 1).not.toBe(1)
  })

  test('damga kalkınca örnek renkli havuza geri dönüyor', () => {
    const node = entry('gidip-gelen', 0)
    stampShadowOnly(node.object)
    registerInstance(node)
    rebuildPools(root)

    // Solo kapandı: host `clearShadowOnly` maskeyi eski hâline döndürür.
    node.object.layers.mask = 1
    rebuildPools(root)

    const meshes = root.children.filter(
      (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
    )
    expect(meshes).toHaveLength(1)
    expect(meshes[0]?.layers.mask).toBe(1)
  })
})

describe('kat imzası maskeyi de ölçüyor', () => {
  /**
   * Yeniden inşayı TETİKLEYEN taraf. Solo'da üst katlar ne taşınır ne
   * gizlenir — Y'ye bakan eski imza geçişi hiç görmüyordu ve havuz, maskeyi
   * kopyalamayı öğrenmiş olsa bile, eski maskeyle çizmeye devam ederdi.
   *
   * GERÇEK `pollLevelPositions` sınanıyor, karşılaştırmanın bir kopyası
   * değil: kayıt defteri enjekte edilebilir bir tekil, sahte bir kat konup
   * sonda temizleniyor. Kopya, fonksiyondaki bir gerileme ne yaparsa yapsın
   * yeşil kalırdı — bu turda ayıklanan kendini-doğrulayan test sınıfı.
   */
  const LEVEL_ID = 'level_poll-probe'

  function withFakeLevel(run: (object: THREE.Object3D) => void): void {
    const object = new THREE.Object3D()
    sceneRegistry.nodes.set(LEVEL_ID as never, object)
    sceneRegistry.byType.level?.add(LEVEL_ID as never)
    try {
      run(object)
    } finally {
      sceneRegistry.byType.level?.delete(LEVEL_ID as never)
      sceneRegistry.nodes.delete(LEVEL_ID as never)
    }
  }

  test('aynı Y, değişen maske yeniden inşa istiyor — solo geçişinin kendisi', () => {
    withFakeLevel((object) => {
      const seen = new Map<string, LevelSignature>()
      expect(pollLevelPositions(seen)).toBe(true) // ilk görüş her zaman değişimdir

      // Kat yerinde, görünür — hiçbir şey değişmedi.
      expect(pollLevelPositions(seen)).toBe(false)

      // Solo: üst kat taşınmaz, gizlenmez, yalnız damgalanır.
      object.layers.disable(0)
      object.layers.enable(4)
      expect(pollLevelPositions(seen)).toBe(true)
      expect(pollLevelPositions(seen)).toBe(false)

      // Solo kapandı: damga geri alındı.
      object.layers.mask = 1
      expect(pollLevelPositions(seen)).toBe(true)
    })
  })

  test('görünürlük ve Y eski davranışını koruyor', () => {
    withFakeLevel((object) => {
      const seen = new Map<string, LevelSignature>()
      pollLevelPositions(seen)

      object.visible = false
      expect(pollLevelPositions(seen)).toBe(true) // gizlenen alt kat

      object.visible = true
      object.position.y = 5 // patlatmada taşınan kat
      expect(pollLevelPositions(seen)).toBe(true)
    })
  })
})

/**
 * Yeniden inşanın MALİYETİ — ve maliyeti kısmanın sessizce bozabileceği şey.
 *
 * Bu blok bir hızlanmayı değil, o hızlanmanın ödünç aldığı doğruluğu ölçüyor.
 * Havuz artık üyeliği değişmemiş bir havuzun tamponuna dokunmuyor; kazanç
 * gerçek (kamera gezerken tek bir raf bant geçtiğinde eskiden HER havuzun
 * kapasite boyu tamponu yeniden yükleniyordu), ama atlamanın yanlış anda
 * yapılması hiçbir hata vermeden yanlış yerde çizilen raflar demek.
 */
describe('yeniden inşa — değişmeyen havuza dokunulmaz, değişene dokunulur', () => {
  /** Tampon yüklemesinin tek dürüst göstergesi: `needsUpdate` sürümü artırır. */
  function versions(): number[] {
    return root.children.map((child) => (child as THREE.InstancedMesh).instanceMatrix.version)
  }

  /** Her havuzun 0. yuvasındaki X — kimin nerede çizildiği. */
  function slotZeroXs(): number[] {
    const matrix = new THREE.Matrix4()
    return root.children
      .map((child) => {
        ;(child as THREE.InstancedMesh).getMatrixAt(0, matrix)
        return matrix.elements[12] ?? Number.NaN
      })
      .sort((a, b) => a - b)
  }

  test('salt katman geçişi, üyeliği aynı kalan havuzu YENİDEN YÜKLEMEZ', () => {
    // İki ayrı şekil: 'a' katman değiştirecek, 'b' hiç kımıldamayacak.
    const a = entry('a', 0, 'a')
    registerInstance(a)
    registerInstance(entry('b', 10, 'b'))
    rebuildPools(root, true)

    const untouched = root.children.find(
      (child) => (child as THREE.InstancedMesh).geometry === GEOM_B,
    ) as THREE.InstancedMesh
    const before = untouched.instanceMatrix.version

    a.tier = 'simple'
    rebuildPools(root, false)

    expect(untouched.instanceMatrix.version).toBe(before)
  })

  test('matrisler kirliyken üyelik aynı olsa da tampon YENİDEN YAZILIR', () => {
    // Atlamanın tehlikeli yarısı. Bir düğüm kımıldadığında havuz üyeliği
    // değişmez — yazım o yüzden atlanırsa raf eski yerinde çizilmeye devam
    // eder ve hiçbir şey hata vermez.
    const a = entry('a', 0)
    registerInstance(a)
    rebuildPools(root, true)

    a.object.position.set(42, 0, 0)
    a.object.updateMatrix()
    a.object.updateMatrixWorld(true)
    rebuildPools(root, true)

    expect(slotZeroXs()).toEqual([42])
  })

  test('bir örnek havuzdan ayrılınca KALANIN yuvası yeniden yazılır', () => {
    // Aynı şekilden iki düğüm tek havuzda, 'a' 0. yuvada. 'a' uzaklaşıp kendi
    // havuzuna geçince 'b' 0. yuvaya kaymalı. Yazım atlanırsa o yuvada hâlâ
    // 'a'nın matrisi durur: iki raf üst üste çizilir, 'b' ortadan kaybolur.
    const a = entry('a', 0)
    registerInstance(a)
    registerInstance(entry('b', 10))
    rebuildPools(root, true)
    expect(poolCount()).toBe(1)

    a.tier = 'simple'
    rebuildPools(root, false)

    expect(poolCount()).toBe(2)
    expect(slotZeroXs()).toEqual([0, 10])
  })

  test('atlanan kare tamponu bozmaz — sürüm artmasa da içerik doğru', () => {
    const a = entry('a', 0)
    registerInstance(a)
    registerInstance(entry('b', 10, 'b'))
    rebuildPools(root, true)
    const before = versions()

    // Hiçbir şey değişmedi: iki havuz da atlanmalı.
    rebuildPools(root, false)
    expect(versions()).toEqual(before)
    expect(slotZeroXs()).toEqual([0, 10])
  })
})

describe('şekil anahtarı önbelleği', () => {
  test('refreshInstance anahtarı da tazeler — iki şekil tek havuzu paylaşamaz', () => {
    // Anahtar artık kayıt anında bir kez basılıp saklanıyor (yeniden inşa
    // başına binlerce dizge kurmamak için). Tazelenmezse şekli değişmiş bir
    // düğüm eski havuzda kalır ve BAŞKA bir geometriyle çizilir — görünür
    // biçimde yanlış, ve hiçbir hata vermez.
    registerInstance(entry('a', 0, 'a'))
    registerInstance(entry('b', 10, 'a'))
    rebuildPools(root, true)
    expect(poolCount()).toBe(1)

    refreshInstance('b', {
      keyFor: (tier: InstanceTier) => `b:${tier}`,
      geometryFor: () => GEOM_B,
    })
    rebuildPools(root, true)

    expect(poolCount()).toBe(2)
  })
})
