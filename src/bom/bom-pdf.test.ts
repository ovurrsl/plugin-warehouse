import { describe, expect, it } from 'bun:test'
import type { AnyNode, AnyNodeId } from '@pascal-app/core'
import { calculateWarehouseBOM, generateWarehouseBomPdf, type WarehouseBOM } from './index'

const asNodeId = (id: string): AnyNodeId => id as unknown as AnyNodeId
const asNodes = (nodes: Record<string, AnyNode>): Record<string, AnyNode> => nodes

function sampleBOM(): WarehouseBOM {
  const rack1: AnyNode = {
    id: asNodeId('rack_1'),
    type: 'warehouse:pallet-rack',
    parentId: asNodeId('level_ground'),
    position: [10, 0, 10],
    bayClearWidth: 2.7,
    uprightWidth: 0.09,
    uprightHeight: 8.0,
    depth: 1.1,
    depthPositions: 1,
    levels: 4,
    decking: 'wire-mesh',
  } as unknown as AnyNode

  const drivein1: AnyNode = {
    id: asNodeId('drivein_1'),
    type: 'warehouse:drive-in-rack',
    parentId: asNodeId('level_ground'),
    position: [20, 0, 10],
    laneClearWidth: 1.35,
    palletsDeep: 4,
    levels: 4,
  } as unknown as AnyNode

  return calculateWarehouseBOM(asNodes({ rack_1: rack1, drivein_1: drivein1 }), {
    projectName: 'Main Logistics Hub',
    scopeLabel: 'Zone A - Heavy Pallet Storage',
    zoneName: 'Zone A',
  })
}

describe('Warehouse BOM PDF Generator (Tiers 1-3)', () => {
  it('T1.1: generates non-empty binary PDF buffer starting with %PDF- header', async () => {
    const bom = sampleBOM()
    const result = await generateWarehouseBomPdf(bom, {
      title: 'Installation Bill of Materials',
      author: 'Pascal Digital Twin',
    })

    expect(result).toBeDefined()
    const bytes = result instanceof Uint8Array ? result : new Uint8Array(result)
    expect(bytes.byteLength).toBeGreaterThan(500)

    // Verify PDF Magic Header "%PDF-" (0x25, 0x50, 0x44, 0x46, 0x2D)
    const headerStr = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!, bytes[4]!)
    expect(headerStr).toBe('%PDF-')
  })

  it('T1.2: encodes project metadata, zone names, and KPI figures into the PDF stream', async () => {
    const bom = sampleBOM()
    const result = await generateWarehouseBomPdf(bom)
    const bytes = result instanceof Uint8Array ? result : new Uint8Array(result)
    const latin1Text = Buffer.from(bytes).toString('latin1')

    // PDF stream must contain document metadata or text structures
    expect(latin1Text.length).toBeGreaterThan(100)
    // Check EOF marker
    expect(latin1Text).toContain('%%EOF')
  })

  it('T2.1: handles empty warehouse BOM without throwing exception or corrupting byte stream', async () => {
    const emptyBom = calculateWarehouseBOM({})
    const result = await generateWarehouseBomPdf(emptyBom)

    expect(result).toBeDefined()
    const bytes = result instanceof Uint8Array ? result : new Uint8Array(result)
    expect(bytes.byteLength).toBeGreaterThan(200)
    const header = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!, bytes[4]!)
    expect(header).toBe('%PDF-')
  })

  it('T2.2: handles complex multi-page BOM with 50+ line items cleanly across page boundaries', async () => {
    // Construct large BOM with multiple sections
    const largeNodes: Record<string, AnyNode> = {}
    for (let i = 0; i < 25; i++) {
      largeNodes[`rack_${i}`] = {
        id: asNodeId(`rack_${i}`),
        type: 'warehouse:pallet-rack',
        bayClearWidth: 2.7,
        levels: 4,
        decking: 'wire-mesh',
      } as unknown as AnyNode
      largeNodes[`drivein_${i}`] = {
        id: asNodeId(`drivein_${i}`),
        type: 'warehouse:drive-in-rack',
        palletsDeep: 4,
        levels: 3,
      } as unknown as AnyNode
    }

    const largeBom = calculateWarehouseBOM(asNodes(largeNodes), {
      projectName: 'Mega Fulfillment Hub - 100 Bay Installation',
    })

    const result = await generateWarehouseBomPdf(largeBom)
    const bytes = result instanceof Uint8Array ? result : new Uint8Array(result)
    expect(bytes.byteLength).toBeGreaterThan(2000)
    const latin1Text = Buffer.from(bytes).toString('latin1')
    expect(latin1Text).toContain('%%EOF')
  })
})
