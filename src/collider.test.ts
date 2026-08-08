import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { freezeColliderMatrix } from './collider'

/**
 * Donmuş matrisin sessiz hata modu: ekranda hiçbir şey değişmez (çarpıştırıcı
 * zaten görünmez) ama tıklama yanlış yeri vurur — birim küp, düğümün gerçek
 * hacmi yerine. Bu yüzden test matrisin İÇERİĞİNE bakıyor, bayrağa değil.
 */
describe('freezeColliderMatrix', () => {
  const mesh = (
    position: [number, number, number],
    scale: [number, number, number],
    rotationY = 0,
  ) => {
    const m = new THREE.Mesh()
    m.position.set(...position)
    m.scale.set(...scale)
    m.rotation.set(0, rotationY, 0)
    return m
  }

  test('dondurulan mesh three tarafından her kare yeniden hesaplanmaz', () => {
    const m = mesh([1, 2, 3], [4, 5, 6])
    expect(m.matrixAutoUpdate).toBe(true)
    freezeColliderMatrix(m)
    expect(m.matrixAutoUpdate).toBe(false)
  })

  test('donmuş matris konumu ve ölçeği TAŞIR — birim küpte kalmaz', () => {
    const m = mesh([1, 2, 3], [4, 5, 6])
    freezeColliderMatrix(m)

    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    m.matrix.decompose(position, quaternion, scale)
    expect([position.x, position.y, position.z]).toEqual([1, 2, 3])
    expect([scale.x, scale.y, scale.z]).toEqual([4, 5, 6])
  })

  test('dönüş de basılır — dönmüş bir konveyörün çarpıştırıcısı eksende kalmaz', () => {
    const m = mesh([0, 0, 0], [2, 1, 1], Math.PI / 2)
    freezeColliderMatrix(m)
    const forward = new THREE.Vector3(1, 0, 0).applyMatrix4(m.matrix)
    // +X, 90° dönüşten sonra −Z'ye bakar; ölçek 2 olduğu için uzunluk 2.
    expect(forward.x).toBeCloseTo(0, 6)
    expect(forward.z).toBeCloseTo(-2, 6)
  })

  test('boyut değişince yeniden dondurmak matrisi tazeler', () => {
    // Bileşen bunu bağımlılık dizisiyle yapıyor; burada kilitlenen sözleşme,
    // yeniden çağrının gerçekten yeni değeri basması.
    const m = mesh([0, 0, 0], [1, 1, 1])
    freezeColliderMatrix(m)
    m.scale.set(9, 9, 9)
    freezeColliderMatrix(m)
    const scale = new THREE.Vector3()
    m.matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale)
    expect(scale.x).toBe(9)
  })
})
