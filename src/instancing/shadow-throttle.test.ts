import { beforeEach, describe, expect, test } from 'bun:test'
import type * as THREE from 'three'
import { releaseShadows, throttledShadowCount, throttleShadows } from './shadow-throttle'

type FakeShadow = { autoUpdate: boolean; needsUpdate: boolean }

function fakeLight(): { shadow: FakeShadow } & Record<string, unknown> {
  return {
    isDirectionalLight: true,
    castShadow: true,
    shadow: { autoUpdate: true, needsUpdate: false },
  }
}

function fakeScene(lights: unknown[]): THREE.Scene {
  return {
    traverse(callback: (object: unknown) => void) {
      for (const light of lights) callback(light)
    },
  } as unknown as THREE.Scene
}

beforeEach(() => {
  releaseShadows()
})

describe('gölge kısıcı', () => {
  test('ilk temas devralır ve haritayı bir kez tazeler', () => {
    const light = fakeLight()
    throttleShadows(fakeScene([light]), false)
    expect(light.shadow.autoUpdate).toBe(false)
    expect(light.shadow.needsUpdate).toBe(true)
    expect(throttledShadowCount()).toBe(1)
  })

  test('durağan karelerde harita tazelenmez; kalp atışı karesinde tazelenir', () => {
    /**
     * Görünmez hata iki yönlü: ara karede tazelemek kısıcının var oluş
     * nedenini sessizce geri alır (gölge geçidi yine her kare koşar);
     * kalp atışının HİÇ gelmemesi ise host'un store'a yazmayan
     * animasyonlarının gölgesini sonsuza dek dondurur.
     */
    const light = fakeLight()
    const scene = fakeScene([light])
    throttleShadows(scene, false) // devralma karesi
    light.shadow.needsUpdate = false // motor tüketti

    throttleShadows(scene, false)
    throttleShadows(scene, false)
    expect(light.shadow.needsUpdate).toBe(false) // ara kareler: dokunulmadı

    throttleShadows(scene, false) // 4. kare — kalp atışı
    expect(light.shadow.needsUpdate).toBe(true)
  })

  test('kirli sinyal kalp atışını beklemez', () => {
    const light = fakeLight()
    const scene = fakeScene([light])
    throttleShadows(scene, false)
    light.shadow.needsUpdate = false

    throttleShadows(scene, true)
    expect(light.shadow.needsUpdate).toBe(true)
  })

  test('release ışığı three temposuna geri verir — kapatınca gölge donuk kalmasın', () => {
    const light = fakeLight()
    throttleShadows(fakeScene([light]), false)
    releaseShadows()
    expect(light.shadow.autoUpdate).toBe(true)
    expect(light.shadow.needsUpdate).toBe(true)
    expect(throttledShadowCount()).toBe(0)
  })
})
