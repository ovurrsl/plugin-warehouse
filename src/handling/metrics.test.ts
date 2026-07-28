import { describe, expect, test } from 'bun:test'
import { HANDLING_EQUIPMENT } from '../rack/standards'
import { TRUCK_EQUIPMENT, TRUCK_VARIANTS } from './catalog'
import { MANOEUVRING_WIDTH_M } from './constants'
import { aisleBandForVariant, aisleFigureForModel, aisleMarginM } from './metrics'
import { TRUCK_MODEL_IDS } from './models'

describe('a published band is quoted, never re-derived', () => {
  test('every rated variant reproduces its catalogue row exactly', () => {
    // A table-diff rather than three hardcoded numbers: the point of resolving
    // through `HANDLING_EQUIPMENT` is that a catalogue correction propagates,
    // and a test that restated the figures would defeat it.
    for (const variant of TRUCK_VARIANTS) {
      const equipmentId = TRUCK_EQUIPMENT[variant]
      if (!equipmentId) continue
      const row = HANDLING_EQUIPMENT[equipmentId]
      const band = aisleBandForVariant(variant)
      expect(band.min).toBe(row.aisle.min)
      expect(band.max).toBe(row.aisle.max)
      expect(band.basis).toBe('published')
      expect(band.note).toBe('')
    }
  })

  test('the three rated classes are the three that lift into racking', () => {
    expect(aisleBandForVariant('forklift').min).toBeCloseTo(3.2, 9)
    expect(aisleBandForVariant('reach').min).toBeCloseTo(2.6, 9)
    expect(aisleBandForVariant('turret').min).toBeCloseTo(1.7, 9)
  })

  test('a turret aisle is narrower than a reach aisle, which is narrower than a forklift’s', () => {
    // The whole reason a warehouse buys the dearer truck. If this ever inverts,
    // a mapping has been crossed.
    expect(aisleBandForVariant('turret').min).toBeLessThan(aisleBandForVariant('reach').min)
    expect(aisleBandForVariant('reach').min).toBeLessThan(aisleBandForVariant('forklift').min)
  })
})

describe('what is not rated says so, rather than borrowing a number', () => {
  test('the three non-stacking classes return a labelled estimate', () => {
    // Filing a hand pallet truck under a rated row would hand back a figure
    // that reads as published and was invented — the failure `standards.ts`
    // already refuses for a stacker crane by setting its class to null.
    for (const variant of ['hand-pallet', 'powered-pallet', 'agv'] as const) {
      const band = aisleBandForVariant(variant)
      expect(band.basis).toBe('estimate')
      expect(band.min).toBeCloseTo(MANOEUVRING_WIDTH_M, 9)
      expect(band.note.length).toBeGreaterThan(0)
      expect(band.note.toLowerCase()).toContain('not a stacking aisle')
    }
  })

  test('every variant answers, and every answer carries its basis', () => {
    // The section's promise is that each variant carries the width it needs.
    // Half the fleet returning nothing would leave a hole the blurb fills.
    for (const variant of TRUCK_VARIANTS) {
      const band = aisleBandForVariant(variant)
      expect(band.min).toBeGreaterThan(0)
      expect(band.max).toBeGreaterThanOrEqual(band.min)
      expect(['published', 'estimate']).toContain(band.basis)
      expect(band.label.length).toBeGreaterThan(0)
    }
  })
})

describe('the margin is a number, not a verdict', () => {
  test('a default multiplied aisle is short for a forklift, and says so in sign', () => {
    // 3.10 m between loads against a published 3.20 minimum — the discrepancy
    // `rack/envelope.test.ts` records, seen from the other side.
    expect(aisleMarginM(3.1, 'forklift')).toBeCloseTo(-0.1, 9)
    expect(aisleMarginM(3.3, 'forklift')).toBeCloseTo(0.1, 9)
  })

  test('a margin against an estimate is still only a number', () => {
    // Nothing here returns a pass or a fail. Colouring a margin against an
    // estimate green would turn an argument into a compliance statement, so the
    // basis travels with the band and the caller has to look at it.
    expect(aisleMarginM(2.4, 'hand-pallet')).toBeCloseTo(0.3, 9)
    expect(aisleBandForVariant('hand-pallet').basis).toBe('estimate')
  })
})

describe('the model figure is a second instrument, not a second band', () => {
  test('a published VDI figure is quoted per orientation, 123 mm apart', () => {
    // The orientation must travel with the number: for the counterbalanced
    // truck the two loads differ by 123 mm, and a figure quoted bare would be
    // wrong for one of them.
    const across = aisleFigureForModel('forklift-1300', '1000x1200')
    const along = aisleFigureForModel('forklift-1300', '800x1200')
    expect(across?.requiredM).toBeCloseTo(3.112, 9)
    expect(along?.requiredM).toBeCloseTo(3.235, 9)
    expect(across?.label).toContain('1000×1200')
    expect(along?.label).toContain('800×1200')
  })

  test('the two instruments coexist and disagree, and neither replaces the other', () => {
    // EN 15620 rates the class at 3.20 m; VDI measures this machine at
    // 3.112 m. Both published, both shown, each with its instrument — the
    // class band stays binding for aisles (see the module docstring).
    const band = aisleBandForVariant('forklift')
    const figure = aisleFigureForModel('forklift-1300', '1000x1200')
    expect(band.basis).toBe('published')
    expect(figure?.basis).toBe('published')
    expect(figure?.instrument).toBe('VDI 2198')
    expect(figure?.requiredM).not.toBeCloseTo(band.min, 3)
  })

  test('the safety margin is claimed only where it was printed', () => {
    // Reach publishes a = 200 mm; the counterbalanced sheet publishes Ast
    // without printing `a`. Quoting a margin nobody printed would grow the
    // figure an invented appendix.
    expect(aisleFigureForModel('rt-1800', '800x1200')?.note).toContain('200 mm')
    expect(aisleFigureForModel('forklift-1300', '1000x1200')?.note).not.toContain('200 mm')
  })

  test('no VDI Ast means null, never a number — tt and mpt read the class band only', () => {
    expect(aisleFigureForModel('tt-1600', '1000x1200')).toBeNull()
    expect(aisleFigureForModel('tt-1600', '800x1200')).toBeNull()
    expect(aisleFigureForModel('mpt-680x1150', '1000x1200')).toBeNull()
  })

  test('labels are brand-free, like every other user-facing string', () => {
    for (const id of TRUCK_MODEL_IDS) {
      for (const load of ['1000x1200', '800x1200'] as const) {
        const figure = aisleFigureForModel(id, load)
        if (!figure) continue
        expect(figure.label).not.toMatch(/jungheinrich|efg|etv|etm|ekx/i)
      }
    }
  })
})
