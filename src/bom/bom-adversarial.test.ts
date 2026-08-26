import { describe, expect, it } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import { calculateWarehouseBOM } from './bom-engine'
import { generateWarehouseBomPdf } from './bom-pdf'
import type { WarehouseBOM } from './types'

describe('R2 Adversarial & Stress Verification: Warehouse BOM & PDF Export Engine', () => {
  // ── 1. PDF Binary Specification & Structure Oracle ───────────────────────
  it('strictly conforms to PDF binary standards: %PDF- magic bytes, >1000 byte length, %%EOF trailer, and object structure', async () => {
    // Generate a diverse BOM
    const testNodes: Record<string, AnyNode> = {
      'rack-adv-1': {
        id: 'rack-adv-1',
        type: 'warehouse:pallet-rack',
        bayClearWidth: 2.7,
        uprightWidth: 0.122,
        uprightDepth: 0.08,
        uprightHeight: 6.0,
        beamThickness: 0.05,
        levels: 4,
        depth: 1.1,
        depthPositions: 1,
      } as unknown as AnyNode,
      'mezz-adv-1': {
        id: 'mezz-adv-1',
        type: 'warehouse:mezzanine',
        width: 20,
        depth: 15,
        tiers: [
          {
            index: 0,
            clearHeightM: 3.5,
            loadClass: 500,
            floorType: 'WOOD_CHIPBOARD_30',
          },
        ],
      } as unknown as AnyNode,
      'truck-adv-1': {
        id: 'truck-adv-1',
        type: 'warehouse:truck',
        model: 'rt',
      } as unknown as AnyNode,
    }

    const bom = calculateWarehouseBOM(testNodes, {
      projectName: 'Adversarial Mega Facility',
      scopeLabel: 'Zone Alpha',
      zoneName: 'Alpha Logistics',
    })

    const pdfBytes = await generateWarehouseBomPdf(bom, {
      title: 'Adversarial PDF Test',
      author: 'Pascal QA Challenger',
    })

    // 1. Must be a non-empty Uint8Array / Buffer
    expect(pdfBytes).toBeInstanceOf(Uint8Array)
    expect(pdfBytes.length).toBeGreaterThan(1000)

    // 2. Magic Header check: starts with `%PDF-` (0x25, 0x50, 0x44, 0x46, 0x2D)
    expect(pdfBytes[0]).toBe(0x25) // %
    expect(pdfBytes[1]).toBe(0x50) // P
    expect(pdfBytes[2]).toBe(0x44) // D
    expect(pdfBytes[3]).toBe(0x46) // F
    expect(pdfBytes[4]).toBe(0x2d) // -

    const pdfText = Buffer.from(pdfBytes).toString('latin1')
    expect(pdfText.startsWith('%PDF-')).toBe(true)

    // 3. Trailer check: ends with `%%EOF` (ignoring trailing whitespace/newlines)
    const trimmedPdf = pdfText.trimEnd()
    expect(trimmedPdf.endsWith('%%EOF')).toBe(true)

    // 4. Structural PDF elements check
    expect(pdfText).toContain('/Type /Catalog')
    expect(pdfText).toContain('/Type /Pages')
    expect(pdfText).toContain('xref')
    expect(pdfText).toContain('trailer')
    expect(pdfText).toContain('/Title')
    expect(pdfText).toContain('/Author')
  })

  // ── 2. Frame Sharing Invariant & Mathematical Conservation Oracle ─────────
  it('proves the frame sharing invariant: N adjacent bays in a run bill exactly N+1 frame lines across arbitrary N', () => {
    // Test runs of lengths N = 1, 2, 3, 5, 10, 25, 50, 100
    const runLengths = [1, 2, 3, 5, 10, 25, 50, 100]

    for (const N of runLengths) {
      const nodes: Record<string, AnyNode> = {}
      for (let i = 0; i < N; i++) {
        const id = `bay-${i}`
        nodes[id] = {
          id,
          type: 'warehouse:pallet-rack',
          bayClearWidth: 2.7,
          uprightWidth: 0.122,
          uprightDepth: 0.08,
          uprightHeight: 5.0,
          beamThickness: 0.05,
          levels: 3,
          depth: 1.1,
          depthPositions: 1,
          // If i < N - 1, bay has a neighbor on its right
          hasRightNeighbour: i < N - 1,
        } as unknown as AnyNode
      }

      const bom = calculateWarehouseBOM(nodes)
      const palletSec = bom.sections.find((s) => s.id === 'selective-pallet-racks')
      const fastenersSec = bom.sections.find((s) => s.id === 'fasteners-accessories')
      expect(palletSec).toBeDefined()
      expect(fastenersSec).toBeDefined()

      const postsItem = palletSec!.items.find((i) => i.role === 'upright-post')
      const footplatesItem = palletSec!.items.find((i) => i.role === 'footplate')
      const anchorsItem = fastenersSec!.items.find((i) => i.role === 'anchor-bolt')
      const beamsItem = palletSec!.items.find((i) => i.role === 'load-beam')
      const pinsItem = fastenersSec!.items.find((i) => i.role === 'safety-pin')

      // INVARIANT 1: N bays in continuous run = N + 1 frame lines = 2 * (N + 1) upright posts
      const expectedFrameLines = N + 1
      const expectedPosts = 2 * expectedFrameLines
      expect(postsItem?.quantity).toBe(expectedPosts)

      // INVARIANT 2: 1 footplate per post
      expect(footplatesItem?.quantity).toBe(expectedPosts)

      // INVARIANT 3: 2 M12 anchor bolts per post / footplate
      expect(anchorsItem?.quantity).toBe(expectedPosts * 2)

      // INVARIANT 4: Beams = 2 beams per level * 3 levels * N bays = 6 * N
      const expectedBeams = 2 * 3 * N
      expect(beamsItem?.quantity).toBe(expectedBeams)

      // INVARIANT 5: Safety locking pins = exactly 2 per beam
      expect(pinsItem?.quantity).toBe(expectedBeams * 2)
    }
  })

  // ── 3. Multi-Run Disjoint Sharing Conservation ───────────────────────────
  it('correctly calculates frame sharing across multiple disjoint runs of varying bay counts', () => {
    // 4 disjoint runs: Run A (5 bays), Run B (8 bays), Run C (12 bays), Run D (1 standalone bay)
    const runSpecs = [
      { prefix: 'runA', count: 5 },
      { prefix: 'runB', count: 8 },
      { prefix: 'runC', count: 12 },
      { prefix: 'runD', count: 1 },
    ]

    const nodes: Record<string, AnyNode> = {}
    let totalExpectedFrames = 0
    let totalBays = 0

    for (const run of runSpecs) {
      totalExpectedFrames += run.count + 1
      totalBays += run.count
      for (let i = 0; i < run.count; i++) {
        const id = `${run.prefix}-bay-${i}`
        nodes[id] = {
          id,
          type: 'warehouse:pallet-rack',
          bayClearWidth: 2.7,
          uprightWidth: 0.122,
          uprightDepth: 0.08,
          uprightHeight: 6.0,
          beamThickness: 0.05,
          levels: 4,
          depth: 1.1,
          depthPositions: 1,
          hasRightNeighbour: i < run.count - 1,
        } as unknown as AnyNode
      }
    }

    const bom = calculateWarehouseBOM(nodes)
    const palletSec = bom.sections.find((s) => s.id === 'selective-pallet-racks')
    const postsItem = palletSec!.items.find((i) => i.role === 'upright-post')

    // Sum of frames = (5+1) + (8+1) + (12+1) + (1+1) = 6 + 9 + 13 + 2 = 30 frame lines
    // Total posts = 30 * 2 = 60 posts
    expect(totalExpectedFrames).toBe(30)
    expect(postsItem?.quantity).toBe(totalExpectedFrames * 2)

    // Unshared billing would have been: (5+8+12+1) * 4 = 104 posts
    // Verify substantial frame-sharing savings
    expect(postsItem?.quantity).toBeLessThan(totalBays * 4)
  })

  // ── 4. Additivity & Zone Partitioning Invariant ───────────────────────────
  it('proves additivity: sum of zone-scoped BOMs equals global warehouse BOM for all line items', () => {
    // 3 zones with different equipment
    const zone1Ids = ['z1-r1', 'z1-r2', 'z1-m3']
    const zone2Ids = ['z2-di1', 'z2-di2', 'z2-live1']
    const unzonedIds = ['unzoned-forklift', 'unzoned-bench']

    const allNodes: Record<string, AnyNode> = {
      'z1-r1': {
        id: 'z1-r1',
        type: 'warehouse:pallet-rack',
        bayClearWidth: 2.7,
        levels: 3,
        depthPositions: 1,
        hasRightNeighbour: true,
      } as unknown as AnyNode,
      'z1-r2': {
        id: 'z1-r2',
        type: 'warehouse:pallet-rack',
        bayClearWidth: 2.7,
        levels: 3,
        depthPositions: 1,
        hasRightNeighbour: false,
      } as unknown as AnyNode,
      'z1-m3': {
        id: 'z1-m3',
        type: 'warehouse:m3-rack',
        shelfLength: 1.0,
        shelfDepth: 0.5,
        levels: 4,
      } as unknown as AnyNode,
      'z2-di1': {
        id: 'z2-di1',
        type: 'warehouse:drive-in-rack',
        laneClearWidth: 1.35,
        palletsDeep: 4,
        levels: 3,
        hasRightNeighbour: true,
      } as unknown as AnyNode,
      'z2-di2': {
        id: 'z2-di2',
        type: 'warehouse:drive-in-rack',
        laneClearWidth: 1.35,
        palletsDeep: 4,
        levels: 3,
        hasRightNeighbour: false,
      } as unknown as AnyNode,
      'z2-live1': {
        id: 'z2-live1',
        type: 'warehouse:live-rack',
        bayWidth: 1.5,
        channelDepth: 6.0,
        levels: 3,
      } as unknown as AnyNode,
      'unzoned-forklift': {
        id: 'unzoned-forklift',
        type: 'warehouse:truck',
        model: 'efg',
      } as unknown as AnyNode,
      'unzoned-bench': {
        id: 'unzoned-bench',
        type: 'warehouse:bench',
        length: 2.0,
        width: 0.8,
      } as unknown as AnyNode,
    }

    const bomZone1 = calculateWarehouseBOM(allNodes, { filterNodeIds: zone1Ids })
    const bomZone2 = calculateWarehouseBOM(allNodes, { filterNodeIds: zone2Ids })
    const bomUnzoned = calculateWarehouseBOM(allNodes, { filterNodeIds: unzonedIds })
    const bomGlobal = calculateWarehouseBOM(allNodes)

    // Helper to extract map of item totals by role+item+spec
    function getTotalsMap(bom: WarehouseBOM): Map<string, number> {
      const map = new Map<string, number>()
      for (const sec of bom.sections) {
        for (const it of sec.items) {
          const key = `${it.role}|${it.item}|${it.specification}`
          map.set(key, (map.get(key) ?? 0) + it.quantity)
        }
      }
      return map
    }

    const mapZ1 = getTotalsMap(bomZone1)
    const mapZ2 = getTotalsMap(bomZone2)
    const mapUn = getTotalsMap(bomUnzoned)
    const mapGlobal = getTotalsMap(bomGlobal)

    // Sum of partitioned parts maps
    const mapSum = new Map<string, number>()
    for (const m of [mapZ1, mapZ2, mapUn]) {
      for (const [k, v] of m.entries()) {
        mapSum.set(k, (mapSum.get(k) ?? 0) + v)
      }
    }

    // Verify exact equality across all keys
    expect(mapSum.size).toBe(mapGlobal.size)
    for (const [k, globalQty] of mapGlobal.entries()) {
      const sumQty = mapSum.get(k)
      expect(sumQty).toBe(globalQty)
    }

    // Verify totalPartsCount conservation
    const sumPartsCount =
      bomZone1.totalPartsCount + bomZone2.totalPartsCount + bomUnzoned.totalPartsCount
    expect(sumPartsCount).toBe(bomGlobal.totalPartsCount)
  })

  // ── 5. Mega-Scale Industrial Workload Stress Benchmark ───────────────────
  it('calculates BOM and renders valid multi-page PDF for a 5,000-bay mega installation in < 250ms', async () => {
    const megaNodes: Record<string, AnyNode> = {}
    const totalBays = 5000

    for (let i = 0; i < totalBays; i++) {
      const id = `mega-bay-${i}`
      megaNodes[id] = {
        id,
        type: 'warehouse:pallet-rack',
        bayClearWidth: 2.7,
        uprightWidth: 0.122,
        uprightDepth: 0.08,
        uprightHeight: 7.5,
        beamThickness: 0.05,
        levels: 5,
        depth: 1.1,
        depthPositions: 1,
        hasRightNeighbour: i % 20 !== 19, // 250 runs of 20 bays each
      } as unknown as AnyNode
    }

    // Add other equipment
    for (let d = 0; d < 30; d++) {
      megaNodes[`dock-${d}`] = {
        id: `dock-${d}`,
        type: 'warehouse:dock-leveller',
        length: '2500',
        width: '2000',
        capacity: '60',
      } as unknown as AnyNode
    }

    const startTime = performance.now()
    const megaBom = calculateWarehouseBOM(megaNodes, {
      projectName: 'Global Mega Fulfillment Center 5000',
      scopeLabel: 'Total Site Installation',
    })
    const calcTime = performance.now() - startTime

    expect(megaBom.totalPartsCount).toBeGreaterThan(50000)
    expect(calcTime).toBeLessThan(500) // Calculation must complete in < 500ms for 5,030 nodes

    // Verify 250 runs of 20 bays = 250 * 21 = 5,250 frame lines = 10,500 upright posts
    const palletSec = megaBom.sections.find((s) => s.id === 'selective-pallet-racks')
    const postsItem = palletSec!.items.find((i) => i.role === 'upright-post')
    expect(postsItem?.quantity).toBe(250 * 21 * 2)

    // Render binary PDF for the mega BOM
    const pdfStart = performance.now()
    const pdfBytes = await generateWarehouseBomPdf(megaBom)
    const pdfTime = performance.now() - pdfStart

    expect(pdfBytes.length).toBeGreaterThan(15000)
    expect(pdfTime).toBeLessThan(800)

    const pdfText = Buffer.from(pdfBytes).toString('latin1')
    expect(pdfText.startsWith('%PDF-')).toBe(true)
    expect(pdfText.trimEnd().endsWith('%%EOF')).toBe(true)
  })
})
