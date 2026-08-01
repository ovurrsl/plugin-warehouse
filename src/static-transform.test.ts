import { afterEach, describe, expect, test } from 'bun:test'
import { sceneRegistry } from '@pascal-app/core'
import { Euler, Object3D, Vector3 } from 'three'
import { applyStaticTransform, rebakeDriftedStaticTransforms } from './static-transform'

/** A bare stand-in for the slice of `Object3D` this file touches, so the test
 *  drives real `Vector3`/`Euler` math without mounting a scene. */
function fakeObject() {
  let matrixCalls = 0
  return {
    position: new Vector3(),
    rotation: new Euler(),
    matrixAutoUpdate: true,
    updateMatrix() {
      matrixCalls += 1
    },
    get matrixCalls() {
      return matrixCalls
    },
  }
}

describe('applyStaticTransform', () => {
  test('at rest: writes the transform, freezes it, and recomposes once', () => {
    const object = fakeObject()
    applyStaticTransform(object, [1, 2, 3], [0, Math.PI / 2, 0], false)

    expect(object.position.toArray()).toEqual([1, 2, 3])
    expect(object.rotation.y).toBeCloseTo(Math.PI / 2)
    expect(object.matrixAutoUpdate).toBe(false)
    expect(object.matrixCalls).toBe(1)
  })

  test('live: hands matrixAutoUpdate back to three and touches nothing else', () => {
    const object = fakeObject()
    object.position.set(9, 9, 9)
    object.matrixAutoUpdate = false

    applyStaticTransform(object, [1, 2, 3], [0, 0, 0], true)

    // The position a drag already wrote is left alone — this call's job is
    // only to stop suppressing three's own per-frame recompute.
    expect(object.position.toArray()).toEqual([9, 9, 9])
    expect(object.matrixAutoUpdate).toBe(true)
    expect(object.matrixCalls).toBe(0)
  })

  test('a later at-rest call after a live window recomposes from the settled values', () => {
    const object = fakeObject()
    applyStaticTransform(object, [5, 0, 5], [0, 0, 0], true)
    applyStaticTransform(object, [7, 0, 5], [0, Math.PI, 0], false)

    expect(object.position.toArray()).toEqual([7, 0, 5])
    expect(object.rotation.y).toBeCloseTo(Math.PI)
    expect(object.matrixAutoUpdate).toBe(false)
    expect(object.matrixCalls).toBe(1)
  })
})

/**
 * Dondurulmuş matrisin host'un yazımını yutması — ölçülmüş, bildirilmemiş hata.
 *
 * `sceneRegistry` gerçek kayıt defteri; testler kendi düğümlerini ekleyip
 * temizliyor. Sahte bir defter kurmak, tam da hatanın yaşadığı yeri
 * (defterdeki nesnenin `matrixAutoUpdate` bayrağı) taklit etmek olurdu.
 */
describe('rebakeDriftedStaticTransforms — host’un yazdığı Y yutulmasın', () => {
  const ids: string[] = []

  function registered(id: string): Object3D {
    const object = new Object3D()
    sceneRegistry.nodes.set(id, object)
    ids.push(id)
    return object
  }

  afterEach(() => {
    for (const id of ids) sceneRegistry.nodes.delete(id)
    ids.length = 0
  })

  test('host mesh’in Y’sini yazınca matris yeniden basılır', () => {
    const rack = registered('rack-1')
    applyStaticTransform(rack, [4, 0, 6], [0, 0, 0], false)
    expect(rack.matrix.elements[13]).toBe(0)

    // `FloorElevationSystem`'in yaptığı: slab lifti YALNIZ mesh'e yazılır,
    // düğüm verisindeki position[1] taban yükseklikte kalır.
    rack.position.y = 3.4

    expect(rebakeDriftedStaticTransforms()).toBe(1)
    expect(rack.matrix.elements[13]).toBeCloseTo(3.4, 9)
    // Dünya matrisinin tazelenmesi gerektiği işaretlenmiş olmalı.
    expect(rack.matrixWorldNeedsUpdate).toBe(true)
  })

  test('kimse yazmadıysa hiçbir şey yeniden basılmaz', () => {
    const rack = registered('rack-2')
    applyStaticTransform(rack, [1, 2, 3], [0, 0, 0], false)
    expect(rebakeDriftedStaticTransforms()).toBe(0)
  })

  test('three’nin kendi bastığı düğümlere DOKUNULMAZ — host düğümleri dahil', () => {
    const hostNode = registered('wall-1')
    hostNode.position.set(0, 9, 0) // matrixAutoUpdate açık: three basacak
    expect(hostNode.matrixAutoUpdate).toBe(true)
    expect(rebakeDriftedStaticTransforms()).toBe(0)
    // Matris kasten eski: basmak three'nin işi, bizim değil.
    expect(hostNode.matrix.elements[13]).toBe(0)
  })

  test('imperatif sürükleme de yutulmuyor — X ve Z de gözetiliyor', () => {
    const rack = registered('rack-3')
    applyStaticTransform(rack, [0, 0, 0], [0, 0, 0], false)
    // Host'un `MoveTool`'u kayıtlı nesneye doğrudan yazıyor; `isLive` bunu
    // göremiyor (bu yol eklentinin canlı-durum okumasından geçmiyor).
    rack.position.set(2.5, 0, -1.5)
    expect(rebakeDriftedStaticTransforms()).toBe(1)
    expect(rack.matrix.elements[12]).toBeCloseTo(2.5, 9)
    expect(rack.matrix.elements[14]).toBeCloseTo(-1.5, 9)
  })
})
