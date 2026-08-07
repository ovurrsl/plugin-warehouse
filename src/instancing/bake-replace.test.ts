import { describe, expect, test } from 'bun:test'
import type * as THREE from 'three'
import { groupByGeometry } from './bake-replace'

/** Gruplama kimlikle çalışır — gerçek BufferGeometry gerekmez. */
function geo(): THREE.BufferGeometry {
  return { uuid: Math.random().toString(36) } as unknown as THREE.BufferGeometry
}
const mat = {} as THREE.Material

describe('bake-replace gruplaması', () => {
  test('aynı geometriye çözülen düğümler TEK gruba düşer', () => {
    /**
     * Görünmez hata: paylaşılan geometri kimliği yerine düğüm başına grup
     * açmak, baked seviyeyi yine düğüm sayısı kadar çizim çağrısına böler —
     * replace politikasının var oluş nedenini sessizce geri alır.
     */
    const shared = geo()
    const nodes = [
      { id: 'a', position: [0, 0, 0] },
      { id: 'b', position: [3, 0, 0] },
      { id: 'c', position: [6, 0, 0] },
    ]
    const groups = groupByGeometry(
      nodes,
      () => shared,
      () => mat,
    )
    expect(groups.length).toBe(1)
    expect(groups[0]?.members.map((n) => n.id)).toEqual(['a', 'b', 'c'])
  })

  test('farklı geometriye çözülen düğümler ayrı gruplara düşer', () => {
    /**
     * Ters yönü: iki farklı şekli tek gruba sıkıştırmak, birinin mesh'ini
     * öbürünün geometrisiyle çizmek demek — görünüşte farklı iki raf aynı
     * çelikle görünürdü ve hiçbir şey hata vermezdi.
     */
    const left = geo()
    const right = geo()
    const groups = groupByGeometry(
      [
        { id: 'a', position: [0, 0, 0] },
        { id: 'b', position: [3, 0, 0] },
      ],
      (node) => (node.id === 'a' ? left : right),
      () => mat,
    )
    expect(groups.length).toBe(2)
    expect(groups.map((g) => g.members.length)).toEqual([1, 1])
  })
})
