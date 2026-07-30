/**
 * Stok hareketinin sahneye TAAHHÜDÜ — kullanıcı tetikli, tek history adımı.
 *
 * Kural (plan §5.6): **simülasyon sahneye hiç yazmaz.** Araç bir paleti
 * taşırken sistem paletin KENDİ düğümünün canlı transform'unu yazar —
 * hayalet kopya yok, ikinci geometri yok: taşınan şey paletin ta kendisidir,
 * kargosu, filmi ve LOD'uyla doğru görünür. `occupiedSlots` o sırada paleti
 * hâlâ kaynak yuvasında sayar ve bu DOĞRUDUR, çünkü henüz hiçbir şey
 * taahhüt edilmemiştir.
 *
 * Bu dosya taahhüdün tek kapısıdır ve tek çağıranı panel düğmesidir.
 * Otomatik taahhüt reddedildi: her bırakma bir geri-alma adımı olurdu ve
 * kullanıcı kendi çizdiği sahneyi Ctrl+Z ile geri alamaz hâle gelirdi.
 */

import type { PalletNode } from '../pallet/schema'
import { occupiedSlots } from '../rack/occupancy'
import type { Station } from './stations'

export type CommitRefusal = 'pallet-missing' | 'target-occupied' | 'source-mismatch'

export type CommitPlan = {
  palletId: string
  patch: {
    position: [number, number, number]
    rotation: [number, number, number]
    slotRackId: string
    slotAddress: string
  }
}

/**
 * Taahhüt edilecek yamayı hazırlar, ya da nedenini söyleyerek reddeder.
 *
 * Saf: hiçbir store'a yazmaz. Yazan `applyNodeChanges` çağrısı paneldedir —
 * böylece bu mantık test edilebilir kalır ve "yazan tek yer" görünür olur.
 *
 * Yazdığı şekil `findSlotTarget`'ın ürettiğiyle AYNI olmak zorunda (Y
 * konvansiyonu dahil): iki farklı yol aynı yuvaya iki farklı palet pozu
 * yazsaydı, elle yerleştirilen palet ile araçla taşınan palet aynı rafta
 * farklı yükseklikte dururdu.
 */
export function planCommit(
  nodes: Readonly<Record<string, unknown>>,
  palletId: string,
  source: Station,
  target: Station,
): CommitPlan | { refusal: CommitRefusal } {
  const pallet = nodes[palletId] as PalletNode | undefined
  if (!pallet || (pallet as { type?: string }).type !== 'warehouse:pallet') {
    return { refusal: 'pallet-missing' }
  }
  // Palet gerçekten kaynak yuvada mı — simülasyon sırasında kullanıcı onu
  // elle taşımış olabilir ve o zaman taahhüt bir başkasının yerini bozar.
  if (pallet.slotRackId !== source.rackId || pallet.slotAddress !== source.slot.id) {
    return { refusal: 'source-mismatch' }
  }
  // Hedef bu arada dolmuş olabilir: indeks YENİDEN sorulur, çevrim başındaki
  // cevaba güvenilmez.
  if (occupiedSlots(nodes, target.rackId).has(target.slot.id)) {
    return { refusal: 'target-occupied' }
  }

  const [lx, ly, lz] = target.slot.localPosition
  const cos = Math.cos(target.rackRotationY)
  const sin = Math.sin(target.rackRotationY)
  return {
    palletId,
    patch: {
      position: [target.rackX + lx * cos + lz * sin, ly, target.rackZ - lx * sin + lz * cos],
      rotation: [0, target.rackRotationY, 0],
      slotRackId: target.rackId,
      slotAddress: target.slot.id,
    },
  }
}

/** Panelin kullanıcıya gösterdiği ret cümleleri — hüküm değil, sebep. */
export const COMMIT_REFUSAL_TEXT: Record<CommitRefusal, string> = {
  'pallet-missing': 'Taşınan palet sahnede yok — çevrim boşa döner.',
  'target-occupied': 'Hedef yuva bu arada doldu — taahhüt edilmedi.',
  'source-mismatch': 'Palet artık kaynak yuvada değil; elle taşınmış olabilir.',
}
