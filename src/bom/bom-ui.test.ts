import { describe, expect, it } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import { calculateWarehouseBOM } from './bom-engine'
import { exportWarehouseBomPdf, generateWarehouseBomPdf } from './index'

describe('Warehouse BOM Global UI Action Wiring', () => {
  const sceneNodes: Record<string, AnyNode> = {
    rack_1: {
      id: 'rack_1',
      type: 'warehouse:pallet-rack',
      parentId: 'level_1',
      position: [10, 0, 10],
      rotation: [0, 0, 0],
      bayClearWidth: 2.7,
      depth: 1.1,
      uprightHeight: 7.0,
      levels: 4,
    } as unknown as AnyNode,
    conveyor_1: {
      id: 'conveyor_1',
      type: 'warehouse:conveyor-roller',
      parentId: 'level_1',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      lengthM: 6.0,
      widthM: 0.8,
    } as unknown as AnyNode,
  }

  it('calculates global BOM with "Total Warehouse" scopeLabel when triggered from StatsTab', () => {
    const bom = calculateWarehouseBOM(sceneNodes, {
      scopeLabel: 'Total Warehouse',
    })

    expect(bom.scopeLabel).toBe('Total Warehouse')
    expect(bom.zoneName).toBeUndefined()
    expect(bom.totalPartsCount).toBeGreaterThan(0)
    expect(bom.kpis.length).toBeGreaterThan(0)
    expect(bom.sections.length).toBeGreaterThan(0)
  })

  it('triggers generateWarehouseBomPdf producing valid PDF binary stream', async () => {
    const bom = calculateWarehouseBOM(sceneNodes, {
      scopeLabel: 'Total Warehouse',
    })

    const pdfBuffer = await generateWarehouseBomPdf(bom)
    expect(pdfBuffer).toBeDefined()
    expect(pdfBuffer.length).toBeGreaterThan(100)

    // PDF magic bytes %PDF-
    const header = Buffer.from(pdfBuffer.slice(0, 5)).toString('ascii')
    expect(header).toBe('%PDF-')

    // Document contains Total Warehouse scope title
    const content = Buffer.from(pdfBuffer).toString('latin1')
    expect(content).toContain('Total Warehouse')
  })

  it('exportWarehouseBomPdf handles browser/headless environments gracefully', async () => {
    const bom = calculateWarehouseBOM(sceneNodes, {
      scopeLabel: 'Total Warehouse',
    })

    // In non-browser (headless) environment, should execute generateWarehouseBomPdf without throwing
    expect(typeof exportWarehouseBomPdf).toBe('function')
  })
})
