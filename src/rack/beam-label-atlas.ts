import * as THREE from 'three'

export const ATLAS_WIDTH = 2048
export const ATLAS_HEIGHT = 2048
export const CELL_WIDTH = 256
export const CELL_HEIGHT = 64
export const ATLAS_COLS = ATLAS_WIDTH / CELL_WIDTH // 8
export const ATLAS_ROWS = ATLAS_HEIGHT / CELL_HEIGHT // 32
export const MAX_ATLAS_CELLS = ATLAS_COLS * ATLAS_ROWS // 256

export const LEVEL_COLOR_PALETTE: Record<string, string> = {
  A: '#FACC15', // Yellow
  B: '#2563EB', // Blue
  C: '#DC2626', // Red
  D: '#16A34A', // Green
  E: '#18181B', // Black
  F: '#9333EA', // Magenta
}

export const LEVEL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const

export function getLevelLetter(levelIndex: number): string {
  return LEVEL_LETTERS[levelIndex] ?? String.fromCharCode(65 + levelIndex)
}

export function getLevelColor(levelIndex: number): string {
  const letter = getLevelLetter(levelIndex)
  return LEVEL_COLOR_PALETTE[letter] ?? '#EA580C'
}

/**
 * Code 128 Subset B patterns (values 0 to 106).
 * Each string represents [bar, space, bar, space, bar, space] module widths.
 */
export const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', // 0-9
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', // 10-19
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', // 20-29
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', // 30-39
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', // 40-49
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', // 50-59
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', // 60-69
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', // 70-79
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', // 80-89
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', // 90-99
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'                                  // 100-106 (104=StartB, 106=Stop)
]

export function computeCode128Checksum(text: string): number {
  const values: number[] = [104] // Start Code B
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 32 && code <= 126) {
      values.push(code - 32)
    }
  }
  let checksum = values[0]!
  for (let i = 1; i < values.length; i++) {
    checksum += values[i]! * i
  }
  return checksum % 103
}

export function drawCode128Barcode(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const values: number[] = [104]
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 32 && code <= 126) {
      values.push(code - 32)
    }
  }

  let checksum = values[0]!
  for (let i = 1; i < values.length; i++) {
    checksum += values[i]! * i
  }
  values.push(checksum % 103)
  values.push(106) // Stop code

  let pattern = ''
  for (const val of values) {
    pattern += CODE128_PATTERNS[val] ?? '211214'
  }
  pattern += '2' // Final termination bar

  let totalModules = 0
  for (let i = 0; i < pattern.length; i++) {
    totalModules += parseInt(pattern[i]!, 10)
  }

  const moduleWidth = width / totalModules
  let currentX = x

  ctx.fillStyle = '#0f172a'
  for (let i = 0; i < pattern.length; i++) {
    const barWidth = parseInt(pattern[i]!, 10) * moduleWidth
    if (i % 2 === 0) {
      ctx.fillRect(currentX, y, barWidth, height)
    }
    currentX += barWidth
  }
}

export interface LabelData {
  address: string     // e.g. "A-02-D2"
  levelLetter: string // e.g. "D"
}

export class MasterLabelAtlas {
  public readonly canvas: HTMLCanvasElement | null = null
  public readonly ctx: CanvasRenderingContext2D | null = null
  public readonly texture: THREE.Texture
  private addressToCell = new Map<string, number>()
  private cellToAddress = new Map<number, string>()
  private nextCellIndex = 0

  constructor() {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = ATLAS_WIDTH
        canvas.height = ATLAS_HEIGHT
        const ctx = canvas.getContext('2d', { willReadFrequently: false })
        if (ctx) {
          this.canvas = canvas
          this.ctx = ctx
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT)
          const tex = new THREE.CanvasTexture(canvas)
          tex.colorSpace = THREE.SRGBColorSpace
          tex.minFilter = THREE.LinearMipmapLinearFilter
          tex.magFilter = THREE.LinearFilter
          tex.generateMipmaps = true
          this.texture = tex
          return
        }
      } catch {
        // Fallback for headless environments
      }
    }

    // Headless / Server / Bun test fallback texture
    const data = new Uint8Array(4)
    data[0] = 255
    data[1] = 255
    data[2] = 255
    data[3] = 255
    this.texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
  }

  public getOrCreateCell(data: LabelData): number {
    const existing = this.addressToCell.get(data.address)
    if (existing !== undefined) return existing

    if (this.nextCellIndex >= MAX_ATLAS_CELLS) {
      this.nextCellIndex = 0
    }

    const cellIndex = this.nextCellIndex++

    // Evict old address occupying this cell to avoid stale collisions
    const oldAddress = this.cellToAddress.get(cellIndex)
    if (oldAddress !== undefined) {
      this.addressToCell.delete(oldAddress)
    }

    this.addressToCell.set(data.address, cellIndex)
    this.cellToAddress.set(cellIndex, data.address)
    this.renderCell(cellIndex, data)
    this.texture.needsUpdate = true
    return cellIndex
  }

  public getAddressForCell(cellIndex: number): string | undefined {
    return this.cellToAddress.get(cellIndex)
  }

  public hasAddress(address: string): boolean {
    return this.addressToCell.has(address)
  }

  public get allocatedCellsCount(): number {
    return this.addressToCell.size
  }

  public getCellUvOffset(cellIndex: number): [number, number] {
    const col = cellIndex % ATLAS_COLS
    const row = Math.floor(cellIndex / ATLAS_COLS)
    const uScale = 1.0 / ATLAS_COLS
    const vScale = 1.0 / ATLAS_ROWS
    const u = col * uScale
    const v = 1.0 - (row + 1) * vScale
    return [u, v]
  }

  private renderCell(cellIndex: number, data: LabelData): void {
    if (!this.ctx) return

    const col = cellIndex % ATLAS_COLS
    const row = Math.floor(cellIndex / ATLAS_COLS)
    const x0 = col * CELL_WIDTH
    const y0 = row * CELL_HEIGHT
    const ctx = this.ctx

    // 1. Label Base Background & Border
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(x0, y0, CELL_WIDTH, CELL_HEIGHT)
    ctx.lineWidth = 2
    ctx.strokeStyle = '#cbd5e1'
    ctx.strokeRect(x0 + 1, y0 + 1, CELL_WIDTH - 2, CELL_HEIGHT - 2)

    // 2. Zone 1: Level Color Box (width 38px)
    const color = LEVEL_COLOR_PALETTE[data.levelLetter] ?? '#3b82f6'
    ctx.fillStyle = color
    ctx.fillRect(x0 + 2, y0 + 2, 38, CELL_HEIGHT - 4)

    ctx.fillStyle = data.levelLetter === 'A' ? '#18181b' : '#ffffff'
    ctx.font = '900 24px system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(data.levelLetter, x0 + 21, y0 + CELL_HEIGHT / 2)

    // 3. Zone 2: Industrial Address Text (A-02-D2)
    ctx.fillStyle = '#0f172a'
    ctx.font = '800 22px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(data.address, x0 + 46, y0 + CELL_HEIGHT / 2)

    // 4. Zone 3: Pick Orientation Arrow [↑]
    ctx.fillStyle = '#0f172a'
    const arrowX = x0 + 172
    const arrowY = y0 + CELL_HEIGHT / 2
    ctx.beginPath()
    ctx.moveTo(arrowX, arrowY - 14)
    ctx.lineTo(arrowX - 7, arrowY - 4)
    ctx.lineTo(arrowX - 3, arrowY - 4)
    ctx.lineTo(arrowX - 3, arrowY + 12)
    ctx.lineTo(arrowX + 3, arrowY + 12)
    ctx.lineTo(arrowX + 3, arrowY - 4)
    ctx.lineTo(arrowX + 7, arrowY - 4)
    ctx.closePath()
    ctx.fill()

    // 5. Zone 4: Code 128 Barcode
    drawCode128Barcode(ctx, data.address, x0 + 186, y0 + 10, 64, 44)
  }

  public dispose(): void {
    this.texture.dispose()
    this.addressToCell.clear()
    this.cellToAddress.clear()
    this.nextCellIndex = 0
  }
}

// Global master atlas singleton for the application
let globalAtlasInstance: MasterLabelAtlas | null = null

export function getMasterLabelAtlas(): MasterLabelAtlas {
  if (!globalAtlasInstance) {
    globalAtlasInstance = new MasterLabelAtlas()
  }
  return globalAtlasInstance
}
