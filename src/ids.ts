/**
 * Kimlik önekleri — host sözleşmesine dönüş, eski kimlikleri bırakmadan.
 *
 * ## Sözleşme ve ihlali
 *
 * Host'ta bir düğüm kimliği `<önek>_<sonek>`tir ve önek TEK token'dır: çok
 * parçalı adlar TİRE ile yazılır — host'un kendi kind'ları bunu zaten yapar
 * (`roof-segment_…`, `stair-segment_…`, `cabinet-module_…`). Alt çizgi
 * yalnız ayraçtır; sonek alfabesi (`0-9a-z`) onu hiç içermez.
 *
 * Bu paket yedi kind'da sözleşmeyi bozdu: `pallet_rack_…`, `conveyor_roller_…`
 * vb. İlk alt çizgide bölen HER tüketici — host'un kopyala-yapıştırı bunu
 * yapıyordu — öneki `pallet` diye kesti, `pallet_<sonek>` bastı, ve kind'ın
 * kendi şeması "bu bir pallet_rack değil" diye yapıştırmayı sessizce iptal
 * etti. Editör kendi tarafını `lastIndexOf` ile onardı; ama semptomu onaran
 * oydu, kökü değil: sözleşmeyi bozan biziz ve düzeltme burada durur.
 *
 * ## Düzeltme
 *
 * Yeni kimlikler tireli tek token'la basılır (`pallet-rack_…`) — böyle bir
 * kimliği ilk VEYA son alt çizgide bölmek aynı öneki verir, yani eski sürüm
 * bir editörde bile kopyalanabilir. Eski önekli kimlikler ŞEMADA KALIR:
 * kaydedilmiş her sahne olduğu gibi yüklenir, kimse yeniden adlandırılmaz —
 * kimlik kalıcı kullanıcı verisidir ve bir "temizlik" migrasyonu, slot
 * adresleri gibi kimliğe işaret eden her alanı da peşinden sürüklemek
 * zorunda kalırdı.
 */

import { generateId } from '@pascal-app/core'
import { z } from 'zod'

/**
 * Yeni öneki basan, eskisini kabul etmeye devam eden kimlik alanı.
 *
 * `union` sırası anlamlı değil (iki kol ayrık) ama basım varsayılanı YALNIZ
 * yeni öneki üretir; eski kol salt-okuma geriye dönüklüktür. Testler iki
 * yönü de kilitler: yeni kimlikte tek alt çizgi vardır, eski kimlik parse'ta
 * değişmeden geçer.
 */
export function migratedObjectId<N extends string, L extends string>(prefix: N, legacy: L) {
  const current = z.templateLiteral([`${prefix}_` as `${N}_`, z.string()])
  const legacyArm = z.templateLiteral([`${legacy}_` as `${L}_`, z.string()])
  const union = z.union([current, legacyArm])
  // `generateId` tam olarak `current` kolunu üretir; TS'in şablon-literal
  // birleşimi üzerinden bunu görememesi bir tip sınırı, veri riski değil —
  // testler basılan öneki ayrıca kilitler.
  return union.default(() => generateId(prefix) as z.output<typeof union>)
}
