'use client'

import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { EDITOR_LAYER } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import type { ThreeEvent } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import { snapXZ } from '../placement'
import { type Point2, withVertexInserted, withVertexMoved, withVertexRemoved } from './draw-shape'
import { outlinePolygon } from './metrics'
import type { MezzanineNode } from './schema'

/**
 * Seçili mezzanine'in anahat düzenleyicisi — köşe tutamakları.
 *
 * `def.affordanceTools.selection` ile mount ediliyor: yalnız editörde, yalnız
 * tek bir mezzanine seçiliyken. `def.system`e konmamasının sebebi host'un
 * kendi kuralı: sistemler read-only viewer rotasında da mount edilir ve
 * orada düzenleme tutamağının işi yok.
 *
 * Etkileşim:
 *   - Köşe tutamağını sürükle → köşe taşınır
 *   - Kenar ortasındaki küçük tutamağı sürükle → yeni köşe eklenir
 *   - Alt+tık köşe → köşe silinir (en az 3 kalır)
 *
 * **Commit yalnız bırakınca.** Sürükleme sırasında store'a yazmak her karede
 * geometri + güverte-slab uzlaştırıcısını koştururdu; taslak yerel state'te
 * durur, gerçek düğüm bırakışta bir kez güncellenir — tek undo adımı.
 *
 * **Dikdörtgen mezzanine de düzenlenebilir:** `outlinePolygon` poligonsuz
 * düğümde grid dikdörtgenini verir; ilk commit onu gerçek `polygon` yapar.
 */

const HANDLE_COLOR = '#e69a47'
const MIDPOINT_COLOR = '#8fb5d9'

function useSelectedMezzanine(): MezzanineNode | null {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const node = useScene((s) =>
    selectedIds.length === 1 ? s.nodes[selectedIds[0] as AnyNodeId] : undefined,
  )
  if (!node || (node as { type?: string }).type !== 'warehouse:mezzanine') return null
  return node as unknown as MezzanineNode
}

export default function MezzanineOutlineEditor() {
  const node = useSelectedMezzanine()
  const [draft, setDraft] = useState<Point2[] | null>(null)
  const dragIndexRef = useRef<number | null>(null)
  const draftRef = useRef<Point2[] | null>(null)

  // Seçim değişince yarım kalmış sürükleme atılır.
  const nodeId = node?.id ?? null
  useEffect(() => {
    dragIndexRef.current = null
    draftRef.current = null
    setDraft(null)
  }, [nodeId])

  const commit = useCallback(() => {
    const polygon = draftRef.current
    dragIndexRef.current = null
    draftRef.current = null
    setDraft(null)
    if (!polygon || !nodeId) return
    useScene.getState().updateNode(nodeId as AnyNodeId, { polygon } as never)
  }, [nodeId])

  if (!node) return null

  const outline = draft ?? outlinePolygon(node)
  const [px, , pz] = node.position ?? [0, 0, 0]
  const rotationY = node.rotation?.[1] ?? 0
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)

  // Mezzanine-yerel → dünya (deck-slabs'in `toLevelLocal`i ile aynı kural).
  const toWorld = (lx: number, lz: number): [number, number] => [
    px + lx * cos + lz * sin,
    pz - lx * sin + lz * cos,
  ]
  const toLocal = (wx: number, wz: number): Point2 => {
    const dx = wx - px
    const dz = wz - pz
    return [dx * cos - dz * sin, dx * sin + dz * cos]
  }

  // Tutamaklar mesh'in kaldırıldığı kotta durmalı — host güverteye oturan
  // mezzanine'in MESH'ini kaldırır, `position[1]` veride 0 kalır.
  const baseY = sceneRegistry.nodes.get(node.id as AnyNodeId)?.position.y ?? 0
  const handleY = baseY + 0.12

  const beginDrag = (index: number) => (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    if (event.altKey) {
      const removed = withVertexRemoved(outline, index)
      if (removed) {
        draftRef.current = removed
        commit()
      }
      return
    }
    dragIndexRef.current = index
    draftRef.current = [...outline]
    setDraft([...outline])
  }

  const beginInsert = (edgeIndex: number, point: Point2) => (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    const inserted = withVertexInserted(outline, edgeIndex, point)
    if (!inserted) return
    dragIndexRef.current = edgeIndex + 1
    draftRef.current = inserted
    setDraft(inserted)
  }

  const onPlaneMove = (event: ThreeEvent<PointerEvent>) => {
    const index = dragIndexRef.current
    const polygon = draftRef.current
    if (index === null || !polygon) return
    event.stopPropagation()
    const [sx, sz] = snapXZ(event.point.x, event.point.z)
    const moved = withVertexMoved(polygon, index, toLocal(sx, sz))
    // Dejenere hamle taslağı İLERLETMEZ ama sürüklemeyi de bozmaz — kullanıcı
    // geçerli bir noktaya dönünce kaldığı yerden devam eder.
    if (moved) {
      draftRef.current = moved
      setDraft(moved)
    }
  }

  const dragging = draft !== null && dragIndexRef.current !== null

  return (
    <group layers={EDITOR_LAYER}>
      {outline.map(([lx, lz], i) => {
        const [wx, wz] = toWorld(lx, lz)
        return (
          <mesh
            key={`corner-${i}-${outline.length}`}
            onPointerDown={beginDrag(i)}
            position={[wx, handleY, wz]}
          >
            <boxGeometry args={[0.34, 0.1, 0.34]} />
            <meshBasicMaterial color={HANDLE_COLOR} depthTest={false} />
          </mesh>
        )
      })}

      {/* Kenar ortası: sürüklenince o kenara yeni köşe ekler. */}
      {outline.map(([lx, lz], i) => {
        const next = outline[(i + 1) % outline.length]
        if (!next) return null
        const mid: Point2 = [(lx + next[0]) / 2, (lz + next[1]) / 2]
        const [wx, wz] = toWorld(mid[0], mid[1])
        return (
          <mesh
            key={`mid-${i}-${outline.length}`}
            onPointerDown={beginInsert(i, mid)}
            position={[wx, handleY, wz]}
          >
            <boxGeometry args={[0.2, 0.08, 0.2]} />
            <meshBasicMaterial color={MIDPOINT_COLOR} depthTest={false} />
          </mesh>
        )
      })}

      {/* Sürüklerken imleci yakalayan görünmez düzlem. Yalnız sürükleme
          sırasında var: her zaman dursa bütün sahne tıklamalarını yerdi. */}
      {dragging && (
        <mesh
          onPointerMove={onPlaneMove}
          onPointerUp={(event) => {
            event.stopPropagation()
            commit()
          }}
          position={[px, handleY - 0.02, pz]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[600, 600]} />
          <meshBasicMaterial depthWrite={false} opacity={0} transparent />
        </mesh>
      )}
    </group>
  )
}
