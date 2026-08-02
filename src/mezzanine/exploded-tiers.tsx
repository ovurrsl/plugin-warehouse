'use client'

import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type * as THREE from 'three'
import { getMezzanineTierGeometry } from './geometry'
import { getMezzanineMaterial } from './materials'
import type { MezzanineNode } from './schema'

/**
 * Patlatılmış görünümde asma katın KENDİ katlarını ayırması.
 *
 * ## Neden ayrı bir bileşen
 *
 * `useFrame` koşullu çağrılamaz — ama bir bileşen koşullu MOUNT edilebilir.
 * Bu, `instancing/self-drawn.tsx`'in de dayandığı ayrım: patlatma kapalıyken
 * bu bileşen hiç mount olmuyor, yani ne kare döngüsü, ne kat başına geometri,
 * ne fazladan çizim var. Olağan durumda asma kat eskisi gibi TEK birleşik
 * mesh.
 *
 * ## Host'un kendi davranışı taklit ediliyor, uydurulmuyor
 *
 * `viewer/systems/level/level-system.tsx` bir katı `baseY + index * 5`'e
 * `lerp(…, delta * 12)` ile taşıyor. Buradaki hareket aynı yumuşatma sabitini
 * kullanıyor, ki bir asma katın açılması binanın katlarının açılmasıyla aynı
 * hızda okunsun — iki farklı hız, tek bir hareket gibi görünmezdi.
 */

/** Host'un kat aralığı (`level-system.tsx`). Burada bir üst SINIR olarak
 *  okunuyor, hedef olarak değil — aşağıya bakın. */
const HOST_LEVEL_GAP = 5

/** Host'un yumuşatma katsayısı. Aynı sayı, aynı his. */
const LERP_RATE = 12

/**
 * Katlar arasındaki açılma payı.
 *
 * İki kısıt arasında: yeterince büyük olmalı ki güverteler ayrıldığı görülsün,
 * ama asma katın TOPLAM açılması host'un kat aralığını AŞMAMALI — aşarsa
 * patlatılmış bir binada asma katın üst güvertesi bir üstteki katın içine
 * girer ve iki ayrı yapı tek bir karmaşa gibi okunur.
 *
 * Bu yüzden pay sabit değil, kat sayısına göre kendini sınırlıyor: üç katta
 * 2 m, altı katta 1 m.
 */
export function tierGapFor(tierCount: number): number {
  const spans = Math.max(1, tierCount - 1)
  return Math.min(2, HOST_LEVEL_GAP / spans)
}

export default function ExplodedTiers({
  node,
  tierCount,
}: {
  node: MezzanineNode
  tierCount: number
}) {
  const groupsRef = useRef<Array<THREE.Group | null>>([])
  const material = getMezzanineMaterial()
  const gap = tierGapFor(tierCount)

  useFrame((_, delta) => {
    // Host'un kendi lerp'i gibi: hedefe doğru kare başına oransal yaklaşma.
    // `delta` ile ölçekli, yani kare hızı hareketi değiştirmiyor.
    const t = Math.min(1, delta * LERP_RATE)
    for (let index = 0; index < groupsRef.current.length; index++) {
      const group = groupsRef.current[index]
      if (!group) continue
      const target = index * gap
      group.position.y += (target - group.position.y) * t
    }
  })

  return (
    <>
      {Array.from({ length: tierCount }, (_, index) => (
        <group
          key={`tier-${index}`}
          ref={(group) => {
            groupsRef.current[index] = group
          }}
        >
          <mesh
            castShadow
            dispose={null}
            geometry={getMezzanineTierGeometry(node, index)}
            material={material}
            receiveShadow
          />
        </group>
      ))}
    </>
  )
}
