import { describe, expect, test } from 'bun:test'
import { ConveyorBoosterNode } from './conveyor/booster-schema'
import { ConveyorCurveNode } from './conveyor/curve-schema'
import { ConveyorLauncherNode } from './conveyor/launcher-schema'
import { ConveyorObliqueNode } from './conveyor/oblique-schema'
import { ConveyorRollerNode } from './conveyor/schema'
import { ConveyorTransferNode } from './conveyor/transfer-schema'
import { PalletNode } from './pallet/schema'
import { PalletRackNode } from './rack/schema'
import { RouteNode } from './route/schema'
import { TruckNode } from './truck/schema'

/**
 * Kimlik sözleşmesi: önek TEK token, alt çizgi yalnız ayraç.
 *
 * Buradaki ilk test bu hatanın SINIFINI kapatır: yeni basılmış bir kimliği
 * ilk alt çizgide bölmek ile son alt çizgide bölmek aynı öneki vermek
 * ZORUNDADIR. `pallet_rack_…` bunu ihlal ediyordu — ilk alt çizgide bölen
 * host kopyala-yapıştırı öneki `pallet` diye kesti, bastığı `pallet_<sonek>`
 * kimliğini kind'ın şeması reddetti ve yapıştırma sessizce iptal oldu.
 */

const MIGRATED = [
  ['pallet-rack', 'pallet_rack', PalletRackNode],
  ['conveyor-roller', 'conveyor_roller', ConveyorRollerNode],
  ['conveyor-curve', 'conveyor_curve', ConveyorCurveNode],
  ['conveyor-launcher', 'conveyor_launcher', ConveyorLauncherNode],
  ['conveyor-booster', 'conveyor_booster', ConveyorBoosterNode],
  ['conveyor-transfer', 'conveyor_transfer', ConveyorTransferNode],
  ['conveyor-oblique', 'conveyor_oblique', ConveyorObliqueNode],
] as const

const SINGLE_TOKEN = [
  ['pallet', PalletNode],
  ['route', RouteNode],
  ['truck', TruckNode],
] as const

describe('yeni basılan her kimlikte önek, ilk ve son alt çizgiden aynı okunur', () => {
  test('göç eden yedi kind tireli tek token basar', () => {
    for (const [prefix, , schema] of MIGRATED) {
      const { id } = schema.parse({})
      expect(id.startsWith(`${prefix}_`), id).toBe(true)
      const first = id.slice(0, id.indexOf('_'))
      const last = id.slice(0, id.lastIndexOf('_'))
      // Hatanın sınıfını kapatan iddia: iki bölme de aynı öneki verir —
      // yani bu kimlik, ilk alt çizgide bölen ESKİ bir editörde bile
      // doğru çoğaltılır.
      expect(first, id).toBe(last)
      expect(first).toBe(prefix)
    }
  })

  test("tek token kind'lar zaten sözleşmede", () => {
    for (const [prefix, schema] of SINGLE_TOKEN) {
      const { id } = schema.parse({})
      expect(id.startsWith(`${prefix}_`), id).toBe(true)
      expect(id.slice(0, id.indexOf('_'))).toBe(id.slice(0, id.lastIndexOf('_')))
    }
  })
})

describe('eski kimlikler kalıcı kullanıcı verisidir', () => {
  test("eski önekli kimlik parse'tan DEĞİŞMEDEN geçer", () => {
    for (const [, legacy, schema] of MIGRATED) {
      const id = `${legacy}_abc123` as const
      const parsed = schema.parse({ id })
      expect(parsed.id).toBe(id)
      // İkinci geçiş de aynı: normalizasyon/yeniden basım yok.
      expect(schema.parse(parsed).id).toBe(id)
    }
  })

  test('önek listesi dışındaki kimlik reddedilir — doğrulama gevşemedi', () => {
    const bad = PalletRackNode.safeParse({ id: 'wall_abc123' })
    expect(bad.success).toBe(false)
  })
})
