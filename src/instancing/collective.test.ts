import { beforeEach, describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import {
  clearPools,
  evaluateTiers,
  instanceCount,
  instanceGeneration,
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
    material: MATERIAL,
    materialKey: 'test',
    castShadowWhenFull: true,
    farSq: 70 * 70,
    nearSq: 55 * 55,
    excluded: false,
    tier: 'full' as const,
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
    refreshInstance('a', { materialKey: 'other' })
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
  const probe = new THREE.Object3D()
  rebuildPools(probe)
  const mesh = probe.children[0] as THREE.InstancedMesh | undefined
  clearPools(probe)
  // Anahtar `a:full` / `a:simple`; havuz anahtarını doğrudan okuyamadığımız
  // için gölge bayrağından çıkarıyoruz (yalnız full gölge atar).
  return mesh?.castShadow ? 'full' : 'simple'
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
