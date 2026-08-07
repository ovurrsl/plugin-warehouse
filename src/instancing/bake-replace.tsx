'use client'

import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { type Appearance, useAppearance } from '../appearance'

/**
 * `bake: 'replace'` için jenerik seviye-başına statik çizici.
 *
 * Host'un bake hattı, politikası `replace` olan kind'ın donmuş baked mesh'ini
 * gizleyip bu bileşeni o seviyenin nesnesine portallıyor
 * (`glb-replace-instances.tsx`) — plugin-trees'in kurduğu sözleşmenin aynısı.
 * Editördeki karşılığı kolektif havuz; burada havuzun kare döngüsü yok, çünkü
 * baked sahne tanımı gereği durağan: matrisler bir kez yazılır.
 *
 * Gruplama paylaşılan geometri NESNESİNE göre — önbellek aynı şekle aynı
 * `BufferGeometry`'yi verdiği için "aynı şekil" sorusunun cevabı kimlik
 * karşılaştırması kadar ucuz, ve seviye kaç şekle çözülüyorsa o kadar çizim
 * çağrısı kalıyor.
 *
 * Bilinen fark: hayalet stok bake'e girmez — o bir yerleşim illüstrasyonu,
 * sahnenin verisi değil.
 */
type BakeNode = {
  id: string
  position?: readonly number[]
  rotation?: readonly number[]
}

export type BakeGroup<N extends BakeNode> = {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  members: readonly N[]
  castShadow?: boolean
}

/** Saf gruplayıcı — üç'süz test edilebilir. Aynı geometri nesnesine çözülen
 *  düğümler tek gruba düşer; materyal grubun İLK düğümünden alınır (aile
 *  başına tek materyal kuralının sonucu: aynı gruptakiler zaten aynı). */
export function groupByGeometry<N extends BakeNode>(
  nodes: readonly N[],
  geometryOf: (node: N) => THREE.BufferGeometry,
  materialOf: (node: N) => THREE.Material,
): Array<BakeGroup<N>> {
  const byGeometry = new Map<
    THREE.BufferGeometry,
    { geometry: THREE.BufferGeometry; material: THREE.Material; members: N[] }
  >()
  for (const node of nodes) {
    const geometry = geometryOf(node)
    let group = byGeometry.get(geometry)
    if (!group) {
      group = { geometry, material: materialOf(node), members: [] }
      byGeometry.set(geometry, group)
    }
    group.members.push(node)
  }
  return [...byGeometry.values()]
}

export type BakeGroupsOf<N extends BakeNode> = (
  nodes: readonly N[],
  appearance: Appearance,
) => ReadonlyArray<BakeGroup<N>>

export function makeBakeReplaceRenderer<N extends BakeNode>(groupsOf: BakeGroupsOf<N>) {
  return function BakeReplaceRenderer({ nodes }: { nodes: N[] }) {
    const appearance = useAppearance()
    const groups = useMemo(() => groupsOf(nodes, appearance), [nodes, appearance])
    return (
      <>
        {groups.map((group) => (
          <BakeGroupMesh group={group} key={group.geometry.uuid} />
        ))}
      </>
    )
  }
}

const NO_RAYCAST = () => {}
const bakeMatrix = new THREE.Matrix4()
const bakePosition = new THREE.Vector3()
const bakeEuler = new THREE.Euler()
const bakeQuaternion = new THREE.Quaternion()
const UNIT_SCALE = new THREE.Vector3(1, 1, 1)

function BakeGroupMesh<N extends BakeNode>({ group }: { group: BakeGroup<N> }) {
  const ref = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    // Düğüm konumu seviye-yerel ve bileşen seviyenin nesnesine portallı —
    // dünya matrisi zinciri seviyeden miras alınıyor, burada katlanmıyor.
    group.members.forEach((node, index) => {
      const [x, y, z] = node.position ?? [0, 0, 0]
      const [rx, ry, rz] = node.rotation ?? [0, 0, 0]
      bakeEuler.set(rx ?? 0, ry ?? 0, rz ?? 0)
      bakeQuaternion.setFromEuler(bakeEuler)
      bakeMatrix.compose(bakePosition.set(x ?? 0, y ?? 0, z ?? 0), bakeQuaternion, UNIT_SCALE)
      mesh.setMatrixAt(index, bakeMatrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.count = group.members.length
    // Küre yerleşimle birlikte — kırpma bir öncekinin ölçüsüyle yapılmasın.
    mesh.computeBoundingSphere()
  }, [group])

  return (
    <instancedMesh
      args={[group.geometry, group.material, group.members.length]}
      castShadow={group.castShadow ?? true}
      dispose={null}
      raycast={NO_RAYCAST}
      receiveShadow
      ref={ref}
    />
  )
}
