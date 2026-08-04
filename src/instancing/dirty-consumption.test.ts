import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KIND_PREFIX } from '../plugin-id'

const SRC = join(import.meta.dir, '..')

function read(relative: string): string {
  return readFileSync(join(SRC, relative), 'utf8')
}

function definitionFiles(): string[] {
  const out: string[] = []
  for (const entry of readdirSync(SRC, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      readFileSync(join(SRC, entry.name, 'definition.ts'), 'utf8')
      out.push(join(entry.name, 'definition.ts'))
    } catch {
      // Not every folder declares a kind.
    }
  }
  return out
}

/**
 * The host clears a node's dirty flag only for kinds declaring NEITHER
 * `def.geometry` NOR `def.system` (`floor-elevation-system.tsx`). Everything
 * else is expected to consume its own — and the failure is silent: the flag
 * simply never drops, the host's `dirtyNodes.size === 0` early exit never
 * fires, and twelve host systems walk the whole set every frame forever.
 *
 * These tests assert the specific wrong state rather than the right one,
 * because the right one produces no observable output.
 */
describe('kirli bayrağı tüketimi', () => {
  test('bu paket kirli bayrağını tüketiyor', () => {
    const source = read('instancing/collective-system.tsx')
    expect(source).toContain('clearDirty')
  })

  test('tüketim erken çıkışların ÜSTÜNDE — instancing kapalıyken de koşar', () => {
    const source = read('instancing/collective-system.tsx')
    const consume = source.indexOf('consumeOwnDirtyNodes()')
    const earlyExit = source.indexOf('if (!enabled || isExporting) return')
    expect(consume).toBeGreaterThan(-1)
    expect(earlyExit).toBeGreaterThan(-1)
    // Kapalıyken temizlemeyi atlamak, kullanıcı instancing'i kapatınca donmayı
    // geri getirirdi — ve kapatmak tam da donmayı teşhis etmek için önerilen şey.
    expect(consume).toBeLessThan(earlyExit)
  })

  test('tüketim kaldırma işinden SONRA koşar (öncelik > FloorElevationSystem)', () => {
    const source = read('instancing/collective-system.tsx')
    const priority = source.match(/const FRAME_PRIORITY = (\d+)/)
    expect(priority).not.toBeNull()
    // `<FloorElevationSystem>` öncelik 1'de slab kaldırmasını uyguluyor. Ondan
    // önce temizlemek, asma kat güvertesindeki rafı zemine düşürürdü.
    expect(Number(priority?.[1])).toBeGreaterThan(1)
  })

  test('yalnız BU paketin kind’ları temizleniyor', () => {
    const source = read('instancing/collective-system.tsx')
    // Host'un kendi düğümlerinin bayrağını düşürmek, host sistemlerinin işini
    // hiç yapmadan iptal etmek olurdu — duvar geometrisi güncellenmeden kalırdı.
    expect(source).toContain('KIND_PREFIX')
    expect(KIND_PREFIX).toBe('warehouse:')
  })

  test('floorPlaced bildiren her kind bu tüketimin kapsamında', () => {
    // `capabilities.floorPlaced` bir kind'ı `<FloorElevationSystem>`'in kirli
    // döngüsüne sokar. Kapsam kind adı ön ekiyle çizildiği için, ön eki taşımayan
    // bir kind eklemek onu sessizce kapsam dışında bırakırdı.
    const offenders: string[] = []
    for (const file of definitionFiles()) {
      const source = read(file)
      if (!source.includes('floorPlaced')) continue
      if (!source.includes(KIND_PREFIX) && !source.includes('KIND_PREFIX')) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })
})
