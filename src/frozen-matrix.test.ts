import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { freezeMatrix } from './frozen-matrix'

/**
 * Donmuş matrisin iki sessiz hata modu var, ve ikisi de ekranda hata vermiyor:
 *
 * 1. Bayrak kapanır ama matris BASILMAZ — nesne birim matriste kalır. Görünen
 *    şey "yanlış yerde duruyor", ve çarpıştırıcıda o bile görünmez: yalnız
 *    tıklama yanlış hacmi vurur.
 * 2. Nesne donar ama üstündeki sarmalayıcı donmaz — `force` yayılmaya devam
 *    ettiği için kazanç geri verilir. Hiçbir şey bozulmaz, yalnız hiçbir şey
 *    de kazanılmaz; teşhisi yalnız profilde görünür.
 *
 * Bu yüzden testler bayrağa değil, matrisin İÇERİĞİNE ve kare başına yapılan
 * çarpım SAYISINA bakıyor.
 */

/** Kare başına kaç dünya çarpımı yapıldığını sayar. */
function countWorldMultiplies(object: THREE.Object3D): () => number {
  let calls = 0
  const { matrixWorld } = object
  const original = matrixWorld.multiplyMatrices.bind(matrixWorld)
  matrixWorld.multiplyMatrices = (a: THREE.Matrix4, b: THREE.Matrix4) => {
    calls++
    return original(a, b)
  }
  return () => calls
}

/** Dönüşümsüz bir sarmalayıcı ve altında yer kaplayan bir çocuk. */
function tree() {
  const wrapper = new THREE.Group()
  const child = new THREE.Group()
  child.position.set(4, 0, -7)
  wrapper.add(child)
  return { child, wrapper }
}

describe('freezeMatrix', () => {
  test('bayrağı kapatırken matrisi BASAR — nesne birim matriste kalmaz', () => {
    const object = new THREE.Group()
    object.position.set(1, 2, 3)
    object.scale.set(4, 5, 6)
    // three bunu ilk `updateMatrixWorld`'de basacaktı; donma o anı öne alıyor.
    expect(object.matrix.elements[12]).toBe(0)

    freezeMatrix(object)

    const position = new THREE.Vector3()
    const scale = new THREE.Vector3()
    object.matrix.decompose(position, new THREE.Quaternion(), scale)
    expect([position.x, position.y, position.z]).toEqual([1, 2, 3])
    expect([scale.x, scale.y, scale.z]).toEqual([4, 5, 6])
  })

  test('auto-update sarmalayıcı, altındaki DONMUŞ çocuğu her karede yeniden çarptırır', () => {
    // Kazancın geri verildiği yer burası: çocuk donmuş olmasına rağmen
    // sarmalayıcı her karede `matrixWorldNeedsUpdate` işaretleyip `force`'u
    // aşağı yayıyor, ve dünya çarpımı kare başına bir kez yine yapılıyor.
    const { child, wrapper } = tree()
    freezeMatrix(child)
    wrapper.updateMatrixWorld()

    const multiplies = countWorldMultiplies(child)
    wrapper.updateMatrixWorld()
    wrapper.updateMatrixWorld()
    expect(multiplies()).toBe(2)
  })

  test('sarmalayıcı da donunca çocuğun dünya matrisi kare başına HİÇ çarpılmaz', () => {
    const { child, wrapper } = tree()
    freezeMatrix(child)
    freezeMatrix(wrapper)
    // Donmanın işaretlediği `matrixWorldNeedsUpdate`'i tüketen tek yerleşme
    // karesi; sayaç ondan sonra kuruluyor.
    wrapper.updateMatrixWorld()

    const multiplies = countWorldMultiplies(child)
    wrapper.updateMatrixWorld()
    wrapper.updateMatrixWorld()
    expect(multiplies()).toBe(0)
  })

  test('donmuş sarmalayıcının altındaki çocuk DOĞRU yerde duruyor', () => {
    // Bir hesabı atlamanın sessiz hâli: nesne çizilmeye devam eder, yalnız
    // olması gereken yerde değil. Sayı kazancı ancak bu doğruysa bir kazanç.
    const { child, wrapper } = tree()
    freezeMatrix(child)
    freezeMatrix(wrapper)
    wrapper.updateMatrixWorld()

    const world = new THREE.Vector3().setFromMatrixPosition(child.matrixWorld)
    expect([world.x, world.y, world.z]).toEqual([4, 0, -7])
  })
})
