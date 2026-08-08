'use client'

import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef } from 'react'
import type * as THREE from 'three'
import { useAppearance } from '../appearance'
import {
  getMezzanineTierGeometry,
  mezzanineTierGeometryKey,
  releaseGeometry,
  retainGeometry,
} from './geometry'
import { getMezzanineMaterial } from './materials'
import type { MezzanineNode } from './schema'

const NO_RAYCAST = () => {}

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

/**
 * Hedefe "oturmuş" sayılan mesafe.
 *
 * Oransal lerp hedefe hiçbir zaman ULAŞMIYOR — her kare kalan farkın bir
 * oranını kapatıyor, yani fark küçülüyor ama sıfırlanmıyor. Eşiksiz hâlde
 * bu, patlatma açık kaldığı sürece kare başına kat sayısı kadar `position.y`
 * yazımı demekti; her yazım `matrixWorldNeedsUpdate` kaldırıyor ve alt ağacın
 * dünya matrisini yeniden çarptırıyor. 0,5 mm bir asma katta hiçbir ekranda
 * ayırt edilemez ve hareketin bittiği yer olarak kullanılabilir.
 */
const SETTLE_EPSILON_M = 5e-4

/**
 * Bir katın bir sonraki kotu — hareketin saf hâli, test bunu ölçüyor.
 *
 * Fark eşiğin altındaysa hedefin KENDİSİ dönüyor: oransal yaklaşmanın
 * kendiliğinden biteceği bir nokta yok, "bitti" diyen tek şey bu. Çağıran
 * dönen değeri mevcut kotla karşılaştırıp yazıp yazmayacağına karar veriyor,
 * yani oturmuş bir kata bir daha dokunulmuyor.
 */
export function nextTierY(current: number, target: number, t: number): number {
  const remaining = target - current
  if (Math.abs(remaining) < SETTLE_EPSILON_M) return target
  return current + remaining * t
}

export default function ExplodedTiers({
  node,
  tierCount,
}: {
  node: MezzanineNode
  tierCount: number
}) {
  const groupsRef = useRef<Array<THREE.Group | null>>([])
  const settledRef = useRef(false)
  const appearance = useAppearance()
  const material = getMezzanineMaterial(appearance)
  const gap = tierGapFor(tierCount)

  /**
   * Kat sayısı değişince hareket yeniden başlar: yeni bir grup y=0'da mount
   * oluyor ve hedefleri de kayıyor. `gap` bu sayıdan türüyor, yani tek
   * bağımlılık yeter.
   */
  useLayoutEffect(() => {
    settledRef.current = false
  }, [tierCount])

  /**
   * Kat geometrileri de ekranda sayılır: tahliye çizileni boşaltamaz.
   *
   * Bölünmüş yol ikinci bir temsil ve kendi anahtarlarını üretiyor
   * (`mezzanineTierGeometryKey`) — bütünün anahtarını tutmak bunları
   * korumuyor. Tutulmadan bırakılan bir kat, patlatma açıkken havuzun
   * sınırına takılıp serbest bırakılabilirdi. Şablon: `rack/renderer.tsx`.
   */
  useEffect(() => {
    const keys = Array.from({ length: tierCount }, (_, index) =>
      retainGeometry(mezzanineTierGeometryKey(node, index)),
    )
    return () => {
      for (const key of keys) releaseGeometry(key)
    }
  }, [node, tierCount])

  useFrame((_, delta) => {
    if (settledRef.current) return
    // Host'un kendi lerp'i gibi: hedefe doğru kare başına oransal yaklaşma.
    // `delta` ile ölçekli, yani kare hızı hareketi değiştirmiyor.
    const t = Math.min(1, delta * LERP_RATE)
    let settled = true
    for (let index = 0; index < groupsRef.current.length; index++) {
      const group = groupsRef.current[index]
      if (!group) continue
      const target = index * gap
      const next = nextTierY(group.position.y, target, t)
      if (next !== group.position.y) group.position.y = next
      if (next !== target) settled = false
    }
    settledRef.current = settled
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
            dispose={null}
            geometry={getMezzanineTierGeometry(node, index)}
            material={material}
            // Seçim ışını çarpıştırıcıdan geçiyor (kayıtlı grubun içinde) —
            // bu mesh de ışına girseydi, kat başına bir kez daha üçgen üçgen
            // taranırdı ve tıklama yine aynı düğümü seçerdi.
            raycast={NO_RAYCAST}
            receiveShadow
          />
        </group>
      ))}
    </>
  )
}
