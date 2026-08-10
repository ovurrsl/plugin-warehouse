import { describe, expect, test } from 'bun:test'
import { bayPitch, crossBraceSets, drawerCount, totalDepth, UPRIGHT_SECTION } from './bays'
import { type M3Part, m3Parts } from './parts'
import { M3ShelvingNode } from './schema'

function bay(patch: Partial<M3ShelvingNode> = {}): M3ShelvingNode {
  return M3ShelvingNode.parse({ ...patch })
}

/**
 * Half-extents of a part after its leans, in the emitter's own order: X first,
 * then Z.
 *
 * Written out rather than reusing the emitter because that is the point — if
 * the two ever disagree, the geometry is not the list these tests measure.
 */
function halfExtents(part: M3Part): [number, number, number] {
  const [hx, hy, hz] = [part.size[0] / 2, part.size[1] / 2, part.size[2] / 2]
  const cx = Math.abs(Math.cos(part.tiltX ?? 0))
  const sx = Math.abs(Math.sin(part.tiltX ?? 0))
  const y1 = hy * cx + hz * sx
  const z1 = hy * sx + hz * cx
  const cz = Math.abs(Math.cos(part.tiltZ ?? 0))
  const sz = Math.abs(Math.sin(part.tiltZ ?? 0))
  return [hx * cz + y1 * sz, hx * sz + y1 * cz, z1]
}

function maxX(part: M3Part): number {
  return part.center[0] + halfExtents(part)[0]
}

function roles(parts: M3Part[], role: M3Part['role']): M3Part[] {
  return parts.filter((part) => part.role === role)
}

/**
 * Parts that belong to a frame LINE rather than to the bay between two frames.
 *
 * They live at the frame's own X and legitimately occupy it — a cross-tie spans
 * between one frame's two posts, an infill panel fills that same plane. The
 * clear-span rule is about what crosses the bay, and these do not.
 */
const FRAME_ROLES: ReadonlySet<M3Part['role']> = new Set<M3Part['role']>([
  'upright',
  'footplate',
  'cross-tie',
  'frame-diagonal',
  'frame-panel',
])

describe('girişim — hiçbir parça dikmenin içine girmiyor', () => {
  /**
   * Bu paketin dört kez tekrar ettiği tuzak: göz ADIMINA göre ölçülen bir raf,
   * dikme merkezinden merkeze uzanır ve her iki uçtan yarım dikme gömülür.
   * Kameradan görünmez, listeden ölçülür.
   */
  test('raf net boyda — dikme yüzünde biter, içinde değil', () => {
    const node = bay({ shelfLength: 1.25, frameHeight: 2.5 })
    const uprightMinX = bayPitch(node) / 2 - UPRIGHT_SECTION.width / 2

    for (const shelf of roles(m3Parts(node), 'shelf')) {
      expect(maxX(shelf)).toBeLessThanOrEqual(uprightMinX + 1e-9)
    }
  })

  test('arka panel, kapı ve çekmeceler de net boyun içinde', () => {
    const node = bay({
      shelfLength: 1,
      frameHeight: 2,
      backPanel: 'mesh',
      door: 'h2000',
      levels: [
        {
          elevation: 0.5,
          structure: 'drawers',
          model: 'HM',
          dividers: 0,
          drawerModel: 'MA',
          drawerWidth: 'narrow',
        },
      ],
    })
    const uprightMinX = bayPitch(node) / 2 - UPRIGHT_SECTION.width / 2

    for (const part of m3Parts(node)) {
      if (FRAME_ROLES.has(part.role)) continue
      // Eğik çubuğun kesiti bağlandığı dikmeye girer — gerçek parça da öyle.
      // Ölçüt onun için ayrı; bkz. koridor çaprazı testleri.
      if (part.role === 'brace') continue
      expect(maxX(part), `${part.role} dikmenin içine giriyor`).toBeLessThanOrEqual(
        uprightMinX + 1e-9,
      )
    }
  })

  test('her parça gözün derinliğinin içinde', () => {
    const node = bay({ shelfDepth: 0.4, backPanel: 'metal', door: 'h1000', shelfLength: 1 })
    for (const part of m3Parts(node)) {
      const [, , hz] = halfExtents(part)
      // Taban plakası dikmeden biraz taşar — tek istisna ve bilinçli.
      const allowance = part.role === 'footplate' ? UPRIGHT_SECTION.depth : 0
      expect(Math.abs(part.center[2]) + hz, `${part.role}`).toBeLessThanOrEqual(
        node.shelfDepth / 2 + allowance + 1e-9,
      )
    }
  })
})

describe('çerçeve paylaşımı', () => {
  test('komşusu olan göz sağ çerçevesini çizmiyor — N göz, N+1 çerçeve', () => {
    const node = bay()
    const both = roles(m3Parts(node, 'full', { omitRight: false }), 'upright')
    const left = roles(m3Parts(node, 'full', { omitRight: true }), 'upright')
    expect(both).toHaveLength(4)
    expect(left).toHaveLength(2)
    for (const post of left) expect(post.center[0]).toBeLessThan(0)
  })

  test('taban plakaları da çerçeveyle birlikte düşüyor', () => {
    const node = bay()
    expect(roles(m3Parts(node, 'full', { omitRight: true }), 'footplate')).toHaveLength(2)
  })
})

describe('koridor çaprazı GERÇEK bir çapraz', () => {
  /**
   * M7'de bu parça `tiltX` ile — yani Y–Z eğimiyle — çizilmişti: sonuç,
   * `hypot(boy, yükseliş)` uzunluğunda YATAY bir çubuktu, iki uçtan komşu gözün
   * içine taşan ve 1° farkla üst üste binen iki kopya. Emitter'a `tiltZ`
   * eklendi; bu test o hatanın M3'te tekrarlanmasını engelliyor.
   */
  test('X–Y düzleminde eğimli, yatay değil', () => {
    const braces = roles(m3Parts(bay({ frameHeight: 2 })), 'brace')
    expect(braces).toHaveLength(2)
    for (const brace of braces) {
      expect(brace.tiltZ ?? 0).not.toBe(0)
      expect(Math.abs(brace.tiltZ ?? 0)).toBeGreaterThan(0.2)
    }
    // İki kopya ZIT yönde — biri sola, biri sağa eğik; aynı yöne eğik iki kopya
    // z-savaşı demekti.
    expect(Math.sign(braces[0]?.tiltZ ?? 0)).not.toBe(Math.sign(braces[1]?.tiltZ ?? 0))
  })

  /**
   * Çubuğun EKSENİ net boyu tarıyor — adımı değil.
   *
   * Ölçülen şey bu, `maxX` değil: eğik bir çubuğun kesiti bağlandığı dikmenin
   * içine birkaç milimetre girer ve gerçek parça da öyle yapar. Yanlış olan,
   * eksenin adım kadar uzaması olurdu — o zaman çapraz komşu gözün dikmesine
   * gider.
   */
  test('çubuğun ekseni net boyu tarıyor, göz adımını değil', () => {
    const node = bay({ shelfLength: 1.4, frameHeight: 2 })
    for (const brace of roles(m3Parts(node), 'brace')) {
      const projected = brace.size[0] * Math.abs(Math.cos(brace.tiltZ ?? 0))
      expect(projected).toBeCloseTo(node.shelfLength, 9)
      expect(projected).toBeLessThan(bayPitch(node))
    }
  })

  test('kesitin dikmeye taşması yarım dikme yüzünü geçmiyor', () => {
    const node = bay({ shelfLength: 1.4, frameHeight: 2 })
    const uprightMaxX = bayPitch(node) / 2 + UPRIGHT_SECTION.width / 2
    for (const brace of roles(m3Parts(node), 'brace')) {
      // Dikmenin İÇİNDE kalıyor; dış yüzünden çıkmıyor.
      expect(maxX(brace)).toBeLessThanOrEqual(uprightMaxX)
    }
  })

  test('yükseklik iki takım istiyorsa dört çubuk çıkıyor', () => {
    const node = bay({ frameHeight: 4 })
    expect(crossBraceSets(node)).toBe(2)
    expect(roles(m3Parts(node), 'brace')).toHaveLength(4)
  })

  test('arka panel varsa hiç çapraz yok — kural tek yerden okunuyor', () => {
    const node = bay({ frameHeight: 4, backPanel: 'metal' })
    expect(roles(m3Parts(node), 'brace')).toHaveLength(0)
    expect(roles(m3Parts(node), 'back-panel')).toHaveLength(1)
  })
})

describe('çerçeve modelleri', () => {
  test('çaprazlı çerçeve iki köşegen taşıyor, düz çerçeve hiç', () => {
    expect(roles(m3Parts(bay({ frameVariant: 'basic' })), 'frame-diagonal')).toHaveLength(0)
    expect(roles(m3Parts(bay({ frameVariant: 'diagonals' })), 'frame-diagonal')).toHaveLength(2)
  })

  test('panelli çerçeveler köşegen yerine dolgu taşıyor', () => {
    for (const variant of ['central-panel', 'side-panel', 'mesh'] as const) {
      const parts = m3Parts(bay({ frameVariant: variant }))
      expect(roles(parts, 'frame-panel')).toHaveLength(2)
      expect(roles(parts, 'frame-diagonal')).toHaveLength(0)
    }
  })

  test('tel çerçeve delikli desen taşıyor, sac panel düz', () => {
    const mesh = roles(m3Parts(bay({ frameVariant: 'mesh' })), 'frame-panel')[0]
    const sheet = roles(m3Parts(bay({ frameVariant: 'side-panel' })), 'frame-panel')[0]
    expect(mesh?.pattern).toBe('slots')
    expect(sheet?.pattern).toBeUndefined()
  })
})

describe('çekmeceler', () => {
  test('çizilen çekmece sayısı türetilen sayıyla aynı', () => {
    const level = {
      elevation: 0.5,
      structure: 'drawers' as const,
      model: 'HL' as const,
      dividers: 0,
      drawerModel: 'MB' as const,
      drawerWidth: 'narrow' as const,
    }
    const node = bay({ shelfLength: 1.25, levels: [level] })
    expect(roles(m3Parts(node), 'drawer')).toHaveLength(drawerCount(node, level))
    expect(roles(m3Parts(node), 'drawer')).toHaveLength(10)
  })

  test('çekmeceli kat rafını da taşıyor — çekmeceler havada durmuyor', () => {
    const node = bay({
      levels: [
        {
          elevation: 0.5,
          structure: 'drawers',
          model: 'HL',
          dividers: 0,
          drawerModel: 'MA',
          drawerWidth: 'wide',
        },
      ],
    })
    expect(roles(m3Parts(node), 'shelf')).toHaveLength(1)
    const shelf = roles(m3Parts(node), 'shelf')[0]
    const drawer = roles(m3Parts(node), 'drawer')[0]
    expect(drawer?.center[1]).toBeGreaterThan(shelf?.center[1] ?? 0)
  })
})

describe('bölücüler', () => {
  test('istenen sayıda ve rafın üstünde duruyor', () => {
    const node = bay({
      frameHeight: 3,
      levels: [
        {
          elevation: 0.5,
          structure: 'shelf',
          model: 'HL',
          dividers: 3,
          drawerModel: 'MA',
          drawerWidth: 'wide',
        },
        {
          elevation: 1.025,
          structure: 'shelf',
          model: 'HL',
          dividers: 0,
          drawerModel: 'MA',
          drawerWidth: 'wide',
        },
      ],
    })
    const dividers = roles(m3Parts(node), 'divider')
    expect(dividers).toHaveLength(3)
    for (const divider of dividers) {
      expect(divider.center[1] - divider.size[1] / 2).toBeCloseTo(0.5, 9)
    }
  })

  test('açıklık hiçbir katalog boyunu almıyorsa bölücü çizilmiyor', () => {
    const node = bay({
      levels: [
        {
          elevation: 0.5,
          structure: 'shelf',
          model: 'HL',
          dividers: 3,
          drawerModel: 'MA',
          drawerWidth: 'wide',
        },
        {
          elevation: 0.575,
          structure: 'shelf',
          model: 'HL',
          dividers: 0,
          drawerModel: 'MA',
          drawerWidth: 'wide',
        },
      ],
    })
    expect(roles(m3Parts(node), 'divider')).toHaveLength(0)
  })
})

describe('uzak katman', () => {
  test('sade katman ayrıntıyı bırakıyor ama rafları ve dikmeleri tutuyor', () => {
    const node = bay({
      frameVariant: 'diagonals',
      levels: [
        {
          elevation: 0.5,
          structure: 'shelf',
          model: 'HL',
          dividers: 2,
          drawerModel: 'MA',
          drawerWidth: 'wide',
        },
      ],
    })
    const simple = m3Parts(node, 'simple')
    expect(roles(simple, 'shelf')).toHaveLength(1)
    expect(roles(simple, 'upright')).toHaveLength(4)
    expect(roles(simple, 'shelf-support')).toHaveLength(0)
    expect(roles(simple, 'frame-diagonal')).toHaveLength(0)
    expect(roles(simple, 'brace')).toHaveLength(0)
    expect(simple.length).toBeLessThan(m3Parts(node, 'full').length)
  })
})

/**
 * DENETİMİN BULDUĞU İKİ KUSUR.
 */
describe('çapraz gözün arkasında, braketler iki uçta', () => {
  test('koridor çaprazı rafların İÇİNDEN geçmiyor', () => {
    /**
     * `-shelfDepth/2 + postDepth` çaprazı arka dikmenin ÖN yüzüne koyuyordu,
     * yani rafın derinlik ayak izinin tam içine: 18 mm'lik çubuk dört katın
     * hepsini kesiyordu. Çapraz gerçek üründe arka dikmelerin ARKA yüzüne
     * cıvatalanır.
     */
    const node = bay({ frameHeight: 2.5, backPanel: 'none' })
    const parts = m3Parts(node, 'full')
    const braces = parts.filter((part) => part.role === 'brace')
    const shelves = parts.filter((part) => part.role === 'shelf')
    expect(braces.length, 'çapraz yok').toBeGreaterThan(0)
    expect(shelves.length).toBeGreaterThan(0)

    for (const brace of braces) {
      for (const shelf of shelves) {
        const hitZ =
          Math.abs(brace.center[2] - shelf.center[2]) < (brace.size[2] + shelf.size[2]) / 2 - 1e-9
        expect(hitZ, 'çapraz rafın derinliğine giriyor').toBe(false)
      }
      // Ve gerçekten ARKADA: rafın arka yüzünün gerisinde.
      expect(brace.center[2]).toBeLessThan(-node.shelfDepth / 2)
    }
  })

  test('zarf çaprazı SAYIYOR — görünür ama tıklanamaz bir parça bırakmıyor', () => {
    // Çapraz ayak izinin dışına çıktı; zarf onu saymazsa görünür ama
    // tıklanamaz olur ve komşusuyla çakıştığı görülmez.
    const braced = bay({ frameHeight: 2.5, backPanel: 'none' })
    const panelled = bay({ frameHeight: 2.5, backPanel: 'metal' })
    expect(totalDepth(braced)).toBeGreaterThan(braced.shelfDepth)
    // Arka panelli gözde çapraz YOK, zarf da büyümüyor.
    expect(totalDepth(panelled)).toBeCloseTo(panelled.shelfDepth, 9)
  })

  test('komşusu olan göz KENDİ raflarını iki uçtan da braketliyor', () => {
    /**
     * Braket çerçevenin değil RAFIN parçası: paylaşılan çerçeveye takılıp bu
     * gözün rafını taşıyor. `lines` üzerinde dönerken sıraya eklenen her göz
     * dört rafını yalnız sol uçtan braketli çiziyordu — rafın sağ ucu havada.
     */
    const alone = m3Parts(bay(), 'full').filter((part) => part.role === 'shelf-support')
    const abutted = m3Parts(bay(), 'full', { omitRight: true }).filter(
      (part) => part.role === 'shelf-support',
    )
    expect(abutted.length).toBe(alone.length)
    // Ve iki farklı X'te duruyorlar.
    expect(new Set(abutted.map((part) => Math.sign(part.center[0]))).size).toBe(2)
  })
})
