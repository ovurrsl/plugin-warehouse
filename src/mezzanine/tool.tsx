'use client'

import { type AnyNode, type AnyNodeId, spatialGridManager, useScene } from '@pascal-app/core'
import {
  EDITOR_LAYER,
  isGridSnapActive,
  movementSfxStepKey,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import { electSupportSlab, subscribeGridMove, subscribePlacementClicks } from '../placement'
import { useWarehouseStore } from '../store'
import { GROUND_SUPPORT_ID } from './deck-slabs'
import { closeEnough, finishOutline, outlineBounds, type Point2, rectangleFrom } from './draw-shape'
import { totalHeightM } from './metrics'
import { MezzanineNode } from './schema'

/**
 * Mezzanine yerleştirme aracı — **alan çizerek**.
 *
 * Bir asma kat, zemine konan bir nesne değil, bir alanın üstüne kurulan bir
 * yapı: onu yerleştirmek "nereye" değil "nereyi kaplayacak" sorusunun cevabı.
 * Bu yüzden tek yerleştirme yolu çizim, ve host'un kendi oda/slab aracının
 * etkileşimi birebir örnek alındı: her tıklama bir köşe, ilk köşeye yaklaşmak
 * ya da Enter kapatır, Escape son köşeyi geri alır.
 *
 * Önceki sürümde çizim `D` tuşunun arkasındaydı ve VARSAYILAN tek tıkla
 * ızgaradan üretilen bir dikdörtgendi. İki sonucu vardı: alanı çizmek gizli
 * bir özellikti, ve panelin ölçü kontrolleri poligon yokken ızgarayı, varken
 * yalnız kolon aksını sürüyordu — kullanıcının "ölçüleri değiştiremiyorum"
 * dediği durum.
 *
 * ## Çift tık neden kapatmıyor
 *
 * Host'un slab aracı çift tıkla da kapatıyor. Burada YAPILAMAZ ve bu bir
 * eksiklik değil bir çakışma: `subscribePlacementClicks`, aynı noktada 200 ms
 * içinde gelen ikinci tıklamayı YUTUYOR — çünkü tek bir fiziksel tıklama bu
 * listeye iki kez ulaşıyor (düğüm yüzeyi `pointerup`'ta sentezliyor, tarayıcı
 * `click`'i canvas dinleyicisine gidiyor) ve o koruma olmadan her tıklama iki
 * köşe eklerdi. Gerçek bir çift tık, tam olarak o yutulan kopyaya benziyor.
 * İki kapanış yolu — ilk köşeye dönmek ve Enter — bu yüzden yeterli sayıldı.
 */
export default function MezzanineTool() {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const brush = useWarehouseStore((s) => s.mezzanineBrush)

  const [cursor, setCursor] = useState<Point2>([0, 0])
  const [draft, setDraft] = useState<Point2[]>([])
  const [placementSerial, setPlacementSerial] = useState(0)
  const [blocked, setBlocked] = useState(false)

  /** Hem ref hem state: olay dinleyicileri efektin kapanışında yaşıyor ve
   *  state'in eski değerini görürdü; state yalnız önizlemeyi çizdirmek için. */
  const draftRef = useRef<Point2[]>([])
  const cursorRef = useRef<Point2>([0, 0])
  const altRef = useRef(false)

  const previewNode = useMemo(
    () => MezzanineNode.parse({ ...brush, position: [0, 0, 0], rotation: [0, 0, 0] }),
    [brush, placementSerial],
  )

  useEffect(() => {
    if (!activeLevelId) return
    draftRef.current = []
    setDraft([])
    setBlocked(false)
    altRef.current = false

    let previousSnapKey: string | null = null

    /**
     * Çizilen alanı düğüme çevir.
     *
     * Dönüş SIFIR: kullanıcı şekli zaten istediği yönde çizdi ve üstüne bir de
     * araç dönüşü uygulamak onu çizdiği yerden kaydırırdı.
     */
    const commit = (points: readonly Point2[]): boolean => {
      const finished = finishOutline(points)
      if (!finished) return false

      // Çizilen alan gerçekten boş mu. Alt bunu atlatır — rafın/M3'ün
      // "zorla yerleştir" davranışının aynısı, aynı tuşla.
      if (!altRef.current) {
        const bounds = outlineBounds(finished.polygon)
        const { valid } = spatialGridManager.canPlaceOnFloor(
          activeLevelId,
          finished.position,
          [bounds.widthM, totalHeightM(previewNode), bounds.depthM],
          [0, 0, 0],
          [],
        )
        if (!valid) {
          setBlocked(true)
          return false
        }
      }

      const nodes = useScene.getState().nodes as Readonly<Record<string, unknown>>
      const committed = MezzanineNode.parse({
        ...previewNode,
        id: previewNode.id,
        name: 'Mezzanine',
        position: finished.position,
        rotation: [0, 0, 0],
        polygon: finished.polygon,
        parentId: activeLevelId,
        // Zemine ya da gerçek bir slab'a ÇİVİLENİR — asla boş bırakılmaz.
        // Boş bırakılsaydı `getFloorPlacedElevation` her karede seçim yapardı
        // ve adaylar arasında mezzanine'in KENDİ güverte slab'ları da olurdu:
        // mezzanine kendi üstüne çıkar, güverte bir üst kota taşınır, sonraki
        // karede yine.
        supportSlabId:
          electSupportSlab(nodes, activeLevelId, finished.position[0], finished.position[2]) ??
          GROUND_SUPPORT_ID,
      })

      useScene.getState().createNode(committed as unknown as AnyNode, activeLevelId as AnyNodeId)
      useViewer.getState().setSelection({ selectedIds: [committed.id as AnyNodeId] })
      triggerSFX('sfx:item-place')

      draftRef.current = []
      setDraft([])
      setBlocked(false)
      setPlacementSerial((serial) => serial + 1)
      return true
    }

    /**
     * Enter ile bitir.
     *
     * **İki köşe bir DİKDÖRTGEN demek** — ve bu, çizimi tek yol yaptıktan
     * sonra sık olanı zor bırakmamanın yolu. Çoğu asma kat dikdörtgen; dört
     * köşeyi tek tek tıklatmak, kullanıcıyı en yaygın durumda cezalandırırdı.
     * Üç ve üstü kendi poligonudur.
     */
    const finish = () => {
      const points = draftRef.current
      if (points.length === 2) {
        const [a, b] = points
        if (a && b) commit(rectangleFrom(a, b))
        return
      }
      commit(points)
    }

    const unsubscribeMove = subscribeGridMove(([rawX, , rawZ]) => {
      cursorRef.current = [rawX, rawZ]
      setCursor([rawX, rawZ])

      const nextSnapKey = movementSfxStepKey({
        coords: [rawX, rawZ],
        gridSnapActive: isGridSnapActive(),
        gridStep: useEditor.getState().gridSnapStep,
      })
      if (previousSnapKey !== nextSnapKey) {
        triggerSFX('sfx:grid-snap')
        previousSnapKey = nextSnapKey
      }
    })

    const unsubscribeClicks = subscribePlacementClicks((event) => {
      const point = cursorRef.current
      const first = draftRef.current[0]
      // İlk köşeye dönmek kapatır — üç köşeden itibaren, çünkü iki köşe zaten
      // Enter'ın dikdörtgen kısayolu.
      if (first && draftRef.current.length >= 3 && closeEnough(point, first)) {
        commit(draftRef.current)
      } else {
        draftRef.current = [...draftRef.current, point]
        setDraft(draftRef.current)
        setBlocked(false)
        triggerSFX('sfx:grid-snap')
      }
      event.stopPropagation?.()
    })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        altRef.current = true
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'Enter') {
        event.preventDefault()
        finish()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        // Bir köşe geri al. Boşta ise araç zaten bir sonraki Escape'te host
        // tarafından kapatılır — burada yutmak, aracı terk etmeyi imkânsız
        // kılardı.
        if (draftRef.current.length > 0) {
          draftRef.current = draftRef.current.slice(0, -1)
          setDraft(draftRef.current)
          setBlocked(false)
        }
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') altRef.current = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      unsubscribeMove()
      unsubscribeClicks()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [activeLevelId, previewNode])

  if (!activeLevelId) return null

  /**
   * Çizim önizlemesi — köşe işaretleri ve aralarındaki kenarlar.
   *
   * Son kenar imlece kadar uzuyor, yani kullanıcı kapanışı tıklamadan önce
   * görüyor. İki köşedeyken Enter'ın çizeceği DİKDÖRTGEN gösteriliyor, ki
   * kısayol keşfedilebilir olsun — görünmeyen bir kısayol yok sayılır.
   */
  const preview: Point2[] =
    draft.length === 2 && draft[0] && draft[1] ? rectangleFrom(draft[0], draft[1]) : draft

  const closed = preview.length >= 3 && draft.length === 2
  const edges = preview.map((point, index) => {
    const next = preview[index + 1] ?? (closed ? preview[0] : cursor)
    if (!next) return null
    const dx = next[0] - point[0]
    const dz = next[1] - point[1]
    return {
      key: `${index}-${point[0]},${point[1]}`,
      center: [point[0] + dx / 2, 0.02, point[1] + dz / 2] as [number, number, number],
      length: Math.hypot(dx, dz),
      angle: Math.atan2(dz, dx),
    }
  })

  const tint = blocked ? '#dc2626' : '#e69a47'

  return (
    <group layers={EDITOR_LAYER}>
      {preview.map((point, index) => (
        <mesh key={`v-${index}-${point[0]},${point[1]}`} position={[point[0], 0.03, point[1]]}>
          <boxGeometry args={[0.22, 0.06, 0.22]} />
          <meshBasicMaterial color={tint} depthTest={false} />
        </mesh>
      ))}
      {edges.map(
        (edge) =>
          edge && (
            <mesh key={`e-${edge.key}`} position={edge.center} rotation={[0, -edge.angle, 0]}>
              <boxGeometry args={[edge.length, 0.03, 0.06]} />
              <meshBasicMaterial color={tint} depthTest={false} />
            </mesh>
          ),
      )}
    </group>
  )
}
