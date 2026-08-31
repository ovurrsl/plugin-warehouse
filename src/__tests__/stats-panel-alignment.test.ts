import { describe, expect, it } from 'bun:test'
import { tokens } from '../panels/styles'
import { areaLabel, areaUnitLabel, areaValue, lengthLabel, lengthValue } from '../units'

describe('Stats Panel UI Alignment & Typography Tokens', () => {
  it('defines 3-column CSS Grid layout for figures container', () => {
    expect(tokens.figures.display).toBe('grid')
    expect(tokens.figures.gridTemplateColumns).toBe('max-content 1fr max-content')
    expect(tokens.figures.alignItems).toBe('baseline')
    expect(tokens.figures.rowGap).toBe('0.5rem')
    expect(tokens.figures.columnGap).toBe('0.375rem')
  })

  it('configures figureValue with right alignment, tabular numbers, and bold typography', () => {
    expect(tokens.figureValue.textAlign).toBe('right')
    expect(tokens.figureValue.fontVariantNumeric).toBe('tabular-nums')
    expect(tokens.figureValue.fontWeight).toBe(600)
    expect(tokens.figureValue.fontSize).toBe('0.875rem')
    expect(tokens.figureValue.whiteSpace).toBe('nowrap')
  })

  it('configures figureUnit with left alignment, 10px font size, and muted weight', () => {
    expect(tokens.figureUnit.textAlign).toBe('left')
    expect(tokens.figureUnit.fontWeight).toBe(400)
    expect(tokens.figureUnit.fontSize).toBe('0.625rem')
    expect(tokens.figureUnit.whiteSpace).toBe('nowrap')
  })

  it('configures figureNote to span all grid columns (1 / -1)', () => {
    expect(tokens.figureNote.gridColumn).toBe('1 / -1')
    expect(tokens.figureNote.fontSize).toBe('0.625rem')
  })

  it('configures figureLabel with left alignment and nowrap', () => {
    expect(tokens.figureLabel.fontSize).toBe('0.6875rem')
    expect(tokens.figureLabel.whiteSpace).toBe('nowrap')
  })
})

describe('Decoupled Area Formatting for Stats Alignment', () => {
  it('separates numerical area value from unit suffix in metric mode', () => {
    const value = 3450.5
    const valStr = areaValue(value, 'metric', 1)
    const unitStr = areaUnitLabel('metric')

    expect(valStr).toBe('3,450.5')
    expect(unitStr).toBe('m²')
    expect(valStr).not.toContain('m²')
  })

  it('separates numerical area value from unit suffix in imperial mode', () => {
    const value = 100 // 100 m² = ~1076.39 ft²
    const valStr = areaValue(value, 'imperial', 1)
    const unitStr = areaUnitLabel('imperial')

    expect(valStr).toBe('1,076.4')
    expect(unitStr).toBe('ft²')
    expect(valStr).not.toContain('ft²')
  })

  it('gracefully handles non-finite values with placeholder and no unit', () => {
    expect(areaValue(Number.NaN, 'metric')).toBe('––')
    expect(areaValue(Number.POSITIVE_INFINITY, 'imperial')).toBe('––')
  })
})
