import { describe, expect, test } from 'bun:test'
import { type AnyNode, emitter } from '@pascal-app/core'
import { useEditor, usePlacementPreview } from '@pascal-app/editor'
import { warehousePlugin } from './index'
import { PalletNode } from './pallet/schema'
import {
  CLICK_TRIGGER_KINDS,
  clearPlacementPreview,
  disarmPlacementToolOnCommit,
  publishPlacementPreview,
  resolveActiveLevelId,
  samePlacementPoint,
  subscribeGridMove,
  subscribePlacementClicks,
} from './placement'

/**
 * BEKÇİ: kaydedilen her kind yerleştirme tıklamasını TETİKLEMELİ.
 *
 * ## Neden bir test gerekiyor
 *
 * Bu atlama üç kez üst üste yapıldı — asma kat ve canlı raf bir turda, sonra
 * drive-in, M7 ve M3 sırayla — ve her seferinde aynı sebeple: bir kind'ı
 * eklemenin doğal adımları (şema, geometri, renderer, tanım, manifest, katalog)
 * bu listeye uğramıyor.
 *
 * ## Belirtisi neden fark edilmiyor
 *
 * Boş bir zeminde her şey çalışır. Hata yalnız imleç BAŞKA bir eklenti
 * nesnesinin üzerindeyken görünür — ve tam olarak o an, raf sıralarının
 * kurulduğu an. R3F tıklamayı en yakın mesh'e gönderiyor; yerleştirilmiş bir
 * gözün görünmez seçim kolideri o mesh. Kind bu listede yoksa `grid:click` hiç
 * gelmiyor, tıklama sessizce yutuluyor: hata yok, uyarı yok, sadece hiçbir şey
 * olmuyor. Kullanıcı ikinci kez tıklıyor, yine olmuyor.
 *
 * Kural bilerek İSTİSNASIZ: bu eklentinin kaydettiği her kind yerleştirilebilir
 * ve her birinin bir çarpma hedefi var. Bir gün gerçekten istisna gereken bir
 * kind gelirse, doğru hamle bu testi gevşetmek değil, istisnayı gerekçesiyle
 * buraya yazmak — panel erişilebilirlik bekçisinin yaptığı gibi.
 */
describe('yerleştirme tıklaması', () => {
  // `Plugin.nodes` host tipinde OPSİYONEL. `?? []` bu yüzden var, ve altındaki
  // "boş değil" testi de bu yüzden var: boşa düşerse döngü hiç dönmez ve dosya
  // sıfır iddiayla yeşil kalırdı — bekçinin en sinsi kendini kandırma biçimi.
  const registered = (warehousePlugin.nodes ?? []).map((node) => (node as { kind: string }).kind)

  test('eklenti gerçekten kind kaydediyor — liste boşsa test kendini kandırır', () => {
    expect(registered.length).toBeGreaterThan(10)
  })

  for (const kind of registered) {
    test(`${kind} tıklama tetikleyicisi olarak kayıtlı`, () => {
      expect(
        (CLICK_TRIGGER_KINDS as readonly string[]).includes(kind),
        `${kind} CLICK_TRIGGER_KINDS'te yok: bu kind'ın kolideri üzerindeyken yapılan yerleştirme tıklaması yutulur`,
      ).toBe(true)
    })
  }

  test('host kind’leri de listede duruyor — zemin, slab ve duvar', () => {
    // Yalnız eklenti kind'larını saymak, listenin asıl işini gölgede bırakırdı:
    // "zemin" diye tıklanan şey çoğu zaman bir slab.
    for (const kind of ['grid', 'slab', 'wall', 'item']) {
      expect((CLICK_TRIGGER_KINDS as readonly string[]).includes(kind)).toBe(true)
    }
  })

  test('listede tekrar yok', () => {
    // Bir kind iki kez yazılırsa her tıklama iki kez abone olur ve tek tıkla iki
    // nesne yerleşir — bu dosyanın kendi başındaki çift-tetikleme hikâyesi.
    expect(new Set(CLICK_TRIGGER_KINDS).size).toBe(CLICK_TRIGGER_KINDS.length)
  })
})

/**
 * BEKÇİ: hareket kare başına bir kez işlenir — ama tıklama ASLA bayat konuma
 * yerleştirmez.
 *
 * Host `grid:move`'u ham `pointermove` dinleyicisinden yayınlıyor, düğme
 * koşulu olmadan: fare tuval üzerinde yalnızca gezinirken bile akıyor ve bir
 * oyun faresi saniyede 1000 olay üretebiliyor. Her olayda tam yerleştirme
 * hattını koşturmak (hizalama, şema ayrıştırma, çakışma taraması, React
 * `setState`'leri) işin yirmide on dokuzunu çizilmeyen kareler için harcamaktı.
 *
 * Birleştirmenin bedeli, dikkat edilmezse, gerçek bir hata: tıklama imleci son
 * hareketin bıraktığı yerden okuyor, yani bekleyen hareket işlenmeden gelen bir
 * tıklama nesneyi BİR KARE ESKİ konuma koyar. Hızlı bir "sürükle ve bırak"ta
 * gözle görülür ve hiçbir hata vermez. Bu blok ikisini birden tutuyor.
 */
describe('ızgara hareketi kareye kilitlenir', () => {
  const frames = new Map<number, () => void>()
  let nextFrameId = 1

  const installFakeFrames = () => {
    frames.clear()
    nextFrameId = 1
    ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (
      callback: () => void,
    ) => {
      const id = nextFrameId++
      frames.set(id, callback)
      return id
    }
    ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (id: number) => {
      frames.delete(id)
    }
  }

  const removeFakeFrames = () => {
    ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = undefined
    ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = undefined
  }

  const runFrame = () => {
    const due = [...frames.values()]
    frames.clear()
    for (const callback of due) callback()
  }

  const move = (x: number, z: number) =>
    emitter.emit('grid:move', {
      position: [x, 0, z],
      localPosition: [x, 0, z],
      nativeEvent: {} as never,
    } as never)

  test('bir karedeki üç hareket TEK kez işlenir, ve SON konumla', () => {
    installFakeFrames()
    const seen: number[] = []
    const unsubscribe = subscribeGridMove(([x]) => seen.push(x))

    move(1, 0)
    move(2, 0)
    move(3, 0)
    // Kare henüz dönmedi: hiçbiri işlenmemiş olmalı.
    expect(seen).toEqual([])

    runFrame()
    expect(seen).toEqual([3])

    unsubscribe()
    removeFakeFrames()
  })

  test('tıklama, bekleyen hareketi ÖNCE işler — bir kare eski konuma yerleşmez', () => {
    installFakeFrames()
    const seen: number[] = []
    const committed: number[] = []
    let last = Number.NaN
    const unsubscribeMove = subscribeGridMove(([x]) => {
      last = x
      seen.push(x)
    })
    const unsubscribeClicks = subscribePlacementClicks(() => committed.push(last))

    move(1, 0)
    runFrame()
    // İmleç yeni bir yere gitti ve kullanıcı kareyi beklemeden tıkladı.
    move(9, 0)
    emitter.emit('grid:click', {
      position: [9, 0, 0],
      localPosition: [9, 0, 0],
      nativeEvent: {} as never,
    } as never)

    expect(seen).toEqual([1, 9])
    expect(committed).toEqual([9])

    unsubscribeMove()
    unsubscribeClicks()
    removeFakeFrames()
  })

  test('abonelik sökülünce bekleyen hareket ÇALIŞMAZ', () => {
    installFakeFrames()
    const seen: number[] = []
    const unsubscribe = subscribeGridMove(([x]) => seen.push(x))

    move(5, 0)
    unsubscribe()
    runFrame()

    expect(seen).toEqual([])
    removeFakeFrames()
  })

  test('rAF olmayan ortamda (sunucu ön-render) senkron kalır', () => {
    // Ertelenecek bir kare yoksa ertelemek, olayı hiç işlememek olurdu.
    removeFakeFrames()
    const seen: number[] = []
    const unsubscribe = subscribeGridMove(([x]) => seen.push(x))
    move(7, 0)
    expect(seen).toEqual([7])
    unsubscribe()
  })
})

describe('aynı noktayı iki kez bildirmemek', () => {
  test('ızgaraya oturmuş imleç "değişmedi" der, gerçekten kımıldayan demez', () => {
    // Tek amacı bir React render'ını atlatmak; eşiği görünür bir mesafeye
    // çekmek, yerleştirme kutusunun imlecin gerisinde kalması demek olurdu.
    expect(samePlacementPoint([1, 0, 2], [1, 0, 2])).toBe(true)
    expect(samePlacementPoint(null, [1, 0, 2])).toBe(false)
    expect(samePlacementPoint([1, 0, 2], [1.00001, 0, 2])).toBe(true)
    expect(samePlacementPoint([1, 0, 2], [1.001, 0, 2])).toBe(false)
    expect(samePlacementPoint([1, 0, 2], [1, 0.001, 2])).toBe(false)
  })
})

describe('resolveActiveLevelId — ambient kat çözümü', () => {
  const sampleNodes: Record<string, unknown> = {
    'bldg-1': {
      id: 'bldg-1',
      type: 'building',
      children: ['lvl-1', 'lvl-0', 'lvl-2'],
    },
    'lvl-0': {
      id: 'lvl-0',
      type: 'level',
      level: 0,
      parentId: 'bldg-1',
    },
    'lvl-1': {
      id: 'lvl-1',
      type: 'level',
      level: 1,
      parentId: 'bldg-1',
    },
    'lvl-2': {
      id: 'lvl-2',
      type: 'level',
      level: 2,
      parentId: 'bldg-1',
    },
  }

  test('açıkça seçilmiş levelId doğrudan kazanır', () => {
    const levelId = resolveActiveLevelId(sampleNodes, {
      levelId: 'lvl-2',
      buildingId: 'bldg-1',
    })
    expect(levelId).toBe('lvl-2')
  })

  test('levelId null ve buildingId seçiliyken binanın Level 0 katına düşer', () => {
    const levelId = resolveActiveLevelId(sampleNodes, {
      levelId: null,
      buildingId: 'bldg-1',
    })
    expect(levelId).toBe('lvl-0')
  })

  test('levelId geçersiz / sahnede yoksa ambient Level 0 katına düşer', () => {
    const levelId = resolveActiveLevelId(sampleNodes, {
      levelId: 'non-existent',
      buildingId: 'bldg-1',
    })
    expect(levelId).toBe('lvl-0')
  })

  test('hiçbir şey seçili değilken sahnedeki ilk binanın Level 0 katına düşer', () => {
    const levelId = resolveActiveLevelId(sampleNodes, {
      levelId: null,
      buildingId: null,
    })
    expect(levelId).toBe('lvl-0')
  })

  test('Level 0 olmayan binada en düşük indeksli kata düşer', () => {
    const customNodes: Record<string, unknown> = {
      'bldg-x': {
        id: 'bldg-x',
        type: 'building',
        children: ['lvl-5', 'lvl-3'],
      },
      'lvl-5': { id: 'lvl-5', type: 'level', level: 5 },
      'lvl-3': { id: 'lvl-3', type: 'level', level: 3 },
    }
    const levelId = resolveActiveLevelId(customNodes, {
      buildingId: 'bldg-x',
    })
    expect(levelId).toBe('lvl-3')
  })

  test('bina olmayan ama kat bulunan sahnede Level 0 katına düşer', () => {
    const standaloneNodes: Record<string, unknown> = {
      'lvl-standalone-0': { id: 'lvl-standalone-0', type: 'level', level: 0 },
    }
    const levelId = resolveActiveLevelId(standaloneNodes, {})
    expect(levelId).toBe('lvl-standalone-0')
  })

  test('boş sahnede null döner', () => {
    const levelId = resolveActiveLevelId({}, {})
    expect(levelId).toBeNull()
  })
})

describe('2D placement preview — usePlacementPreview entegrasyonu', () => {
  test('publishPlacementPreview ephemeral store’a ghost düğümü ve aktif katı yazar', () => {
    const ghost = { id: 'pallet_ghost', type: 'warehouse:pallet', position: [1, 0, 2] } as never
    const level = { id: 'level_0', type: 'level' } as never

    publishPlacementPreview(ghost, level)

    const state = usePlacementPreview.getState()
    expect(state.node).toEqual(ghost)
    expect(state.parentNode).toEqual(level)
  })

  test('clearPlacementPreview ephemeral store’u sıfırlar', () => {
    const ghost = { id: 'pallet_ghost', type: 'warehouse:pallet', position: [1, 0, 2] } as never
    publishPlacementPreview(ghost)
    expect(usePlacementPreview.getState().node).not.toBeNull()

    clearPlacementPreview()
    const state = usePlacementPreview.getState()
    expect(state.node).toBeNull()
    expect(state.parentNode).toBeNull()
  })
})

describe('disarmPlacementToolOnCommit — araç bırakma mantığı', () => {
  test('single modunda (varsayılan) aracı ve modu select yapar, preview’ı temizler', () => {
    useEditor.getState().setMode('build')
    useEditor.getState().setTool('pallet' as never)
    useEditor.getState().setContinuation('point', 'single')
    publishPlacementPreview({ id: 'ghost', type: 'warehouse:pallet' } as never)

    let repeatCalled = false
    disarmPlacementToolOnCommit(() => {
      repeatCalled = true
    })

    expect(repeatCalled).toBe(false)
    expect(useEditor.getState().mode).toBe('select')
    expect(useEditor.getState().tool).toBeNull()
    expect(usePlacementPreview.getState().node).toBeNull()
  })

  test('repeat modunda aracı silahsızlandırmaz, onRepeat geri çağrısını çalıştırır', () => {
    useEditor.getState().setMode('build')
    useEditor.getState().setTool('pallet' as never)
    useEditor.getState().setContinuation('point', 'repeat')

    let repeatCalled = false
    disarmPlacementToolOnCommit(() => {
      repeatCalled = true
    })

    expect(repeatCalled).toBe(true)
    expect(useEditor.getState().mode).toBe('build')
    expect(useEditor.getState().tool).toBe('pallet' as never)
  })
})

describe('ambient kat çözümleme & 2D Floorplan görünürlük entegrasyonu', () => {
  test('ambient bina görünümünde yerleştirilen düğüm Level 0 parentId alır ve 2D DFS ile anında taranır', () => {
    // 1. Sahne: 1 bina ve Level 0 katı
    const level0 = {
      id: 'level_bldg1_0',
      type: 'level',
      object: 'node',
      level: 0,
      parentId: 'building_1',
      children: [],
      visible: true,
      metadata: {},
    } as unknown as AnyNode

    const building = {
      id: 'building_1',
      type: 'building',
      object: 'node',
      parentId: null,
      children: [level0.id],
      visible: true,
      metadata: {},
    } as unknown as AnyNode

    const initialNodes: Record<string, AnyNode> = {
      [building.id]: building,
      [level0.id]: level0,
    }

    // 2. Kullanıcı 2D ambient bina modunda (level seçimi yok, bina seçili veya sahne genelinde)
    const selection = { levelId: null, buildingId: 'building_1' }
    const resolvedLevelId = resolveActiveLevelId(initialNodes, selection)
    expect(resolvedLevelId).toBe('level_bldg1_0')

    // 3. Yerleştirilen warehouse düğümü resolvedLevelId'yi parentId olarak alır
    const palletNode = PalletNode.parse({
      id: 'pallet_placed_1',
      position: [2, 0, 3],
      rotation: [0, 0, 0],
      parentId: resolvedLevelId,
    })

    expect(palletNode.parentId).toBe('level_bldg1_0')

    // 4. Sahneye düğüm eklendiğinde katın çocuklarına girer
    const existingChildren = (level0 as unknown as { children?: string[] }).children ?? []
    const updatedLevel0 = {
      ...level0,
      children: [...existingChildren, palletNode.id],
    } as unknown as AnyNode

    const updatedNodes: Record<string, AnyNode> = {
      ...initialNodes,
      [level0.id]: updatedLevel0,
      [palletNode.id]: palletNode as unknown as AnyNode,
    }

    // 5. 2D FloorplanRegistryLayer DFS algoritmasını simüle et:
    // FloorplanRegistryLayer aktif kat (Level 0) üzerinden DFS traversal yapar
    const visitedIds: string[] = []
    const visit = (id: string) => {
      const node = updatedNodes[id]
      if (!node) return
      visitedIds.push(id)
      const childIds = (node as { children?: string[] }).children
      if (Array.isArray(childIds)) {
        for (const cid of childIds) visit(cid)
      }
    }

    visit(resolvedLevelId!)

    // Yerleştirilen düğüm doğrudan 2D kat DFS'i içinde yer alır — 2D/3D toggle gerektirmez
    expect(visitedIds).toContain('pallet_placed_1')
    expect(visitedIds).toEqual(['level_bldg1_0', 'pallet_placed_1'])
  })
})
