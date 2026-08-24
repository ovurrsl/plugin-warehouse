import { describe, expect, test } from 'bun:test'
import { warehousePlugin } from './index'

/**
 * BEKÇİ: yerleştirme neyi denetliyorsa sürükleme de onu denetler.
 *
 * ## Kapatılan boşluk
 *
 * Bu paketin araçları yerleştirmeyi `clash.ts` üzerinden ÜÇ BOYUTTA
 * denetliyordu. Yerleşen nesne sonradan sürüklenebiliyordu ve orada hiçbir
 * denetim yoktu: host'un sürükleme kapısı `floorPlaced.collides`'a bakar, bu
 * paketin her kind'ı onu kapalı tutmak ZORUNDA (host'un testi plan
 * dikdörtgenidir ve Y görmez — tünelli bir gözün altındaki yürüme yolunu
 * dikmelerin içinden geçmekten ayıramaz), dolayısıyla sürükleme kapısı da
 * kapalıydı. Doğru yerleştirilen bir konveyör ertesi saniye rafın içine
 * çekilebiliyordu ve hiçbir şey itiraz etmiyordu.
 *
 * ## Neden test, neden manifest üzerinden
 *
 * Eksikliği HATA VERMEZ. `canMoveTo` bildirmeyen bir kind derlenir, çalışır,
 * yerleştirmesi denetlenir — yalnız sürüklemesi serbesttir. Yirmi kind'a elle
 * eklenen bir alan, yirmi birincisinde unutulur. Bu test manifesti tarar, yani
 * yeni bir kind eklendiği anda cevap verir.
 *
 * Rota tek istisna ve kasıtlı: zemine çizilen boyadır, `occupiedVolumes` ona
 * hacim vermez, bir hacmi olmayan şeyin çarpışması da yoktur.
 */

const KINDS_WITHOUT_A_VOLUME = ['warehouse:route']

type Definition = {
  kind: string
  capabilities?: { movable?: { canMoveTo?: unknown } }
}

const DEFINITIONS = (warehousePlugin.nodes ?? []) as unknown as Definition[]

const movableDefinitions = DEFINITIONS.filter((def) => def.capabilities?.movable)

describe('sürüklenebilir her kind sürüklemesini de denetler', () => {
  test('manifest gerçekten sürüklenebilir kind taşıyor', () => {
    expect(movableDefinitions.length).toBeGreaterThan(10)
  })

  for (const def of movableDefinitions) {
    const expected = !KINDS_WITHOUT_A_VOLUME.includes(def.kind)
    test(`${def.kind} — canMoveTo ${expected ? 'bildiriyor' : 'bildirmiyor'}`, () => {
      expect(
        typeof def.capabilities?.movable?.canMoveTo === 'function',
        expected
          ? `${def.kind}: sürüklemesi denetlenmiyor — \`...clashGuardedMove()\` eksik`
          : `${def.kind}: hacmi yok, çarpışma sorusu ona sorulmamalı`,
      ).toBe(expected)
    })
  }
})
