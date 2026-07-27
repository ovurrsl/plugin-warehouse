import { describe, expect, test } from 'bun:test'
import { Euler, Vector3 } from 'three'
import { applyStaticTransform } from './static-transform'

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
