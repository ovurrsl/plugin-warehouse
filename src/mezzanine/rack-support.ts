/**
 * Mezzanine üstünde duran raflar — yük sınıfı denetimi.
 *
 * **Bağımlılık tek yönlü:** mezzanine rafları OKUR, raf mezzanine'i bilmez.
 * Tersi olsaydı, raf paneli bir mezzanine'in içindeki tier zincirini
 * çözmek zorunda kalırdı ve iki kind birbirine kilitlenirdi. Yük sınıfı
 * zaten mezzanine'in bir özelliği — soruyu soran da o olmalı.
 *
 * **Bu bir FEM analizi DEĞİL** ve olmadığı adıyla yazılı: yayılı yük
 * (kg/m²) ile rafın beyan ettiği toplam yükü, rafın taban izi üzerinden
 * karşılaştıran bir orandır. Gerçek bir mezzanine hesabı kolon reaksiyonu,
 * kiriş açıklığı ve nokta yükü ister; bunların hiçbiri burada yok, bu
 * yüzden çıktı her zaman UYARI — asla ret.
 *
 * Saf: three yok, React yok, store yazımı yok.
 */

import type { PalletRackNode } from '../rack/schema'
import { bayPitch, storageLevelsPresent, totalDepth } from '../rack/slots'
import { areaLabel, DEFAULT_UNIT, type LinearUnit } from '../units'
import { deckSlabId } from './deck-slabs'
import { resolveTierElevations } from './metrics'
import type { MezzanineNode } from './schema'

export type SupportedRack = {
  rackId: string
  rack: PalletRackNode
  /** Üstünde durduğu tier'in indeksi. */
  tierIndex: number
  /** Rafın beyan ettiği toplam yük, kg. */
  declaredLoadKg: number
  /** Rafın taban izi, m². */
  footprintM2: number
  /** O taban izi üzerinde tier'in taşıyabileceği, kg. */
  allowanceKg: number
}

/** Rafın beyan ettiği toplam yük: kat kapasitesi × gerçekten var olan kat. */
export function rackDeclaredLoadKg(rack: PalletRackNode): number {
  return rack.levelCapacity * storageLevelsPresent(rack).length
}

/** Rafın kapladığı zemin, m². */
export function rackFootprintM2(rack: PalletRackNode): number {
  return bayPitch(rack) * totalDepth(rack)
}

/**
 * Bu mezzanine'in üstünde duran raflar.
 *
 * **Ölçüt rafın taşıyıcı slab'ıdır, kotu değil.** Önceki sürüm rafın taban
 * izini mezzanine'e karşı döndürüp `|rafY − deckTop| ≤ 0.15` arıyordu. O
 * ölçüt hiçbir zaman tutmadı ve tutamazdı: host bir rafı güverteye
 * oturttuğunda rafın MESH'inin Y'sini yazar, `position[1]` veride 0 kalır.
 * Yani kontrol doğru yazılmıştı ama ölçtüğü şey her zaman 0'dı — asla
 * ateşlenemeyen bir uyarıydı.
 *
 * Güverteler artık gerçek slab olduğu için (`deck-slabs.ts`) rafın
 * `supportSlabId`'si hangi tier'in üstünde durduğunu KESİN söylüyor:
 * toleranssız, döndürme matematiği olmadan, mezzanine'in altında duran raf
 * karışma ihtimali olmadan.
 *
 * **Bilinen sınır:** host taşıyıcıyı yalnız adaylar farklı kotlar taşıyorsa
 * kalıcılaştırır (`resolveSupportSlabPatch`, `candidateElevations.size >= 2`).
 * Katta hiç zemin döşemesi yoksa güverte tek adaydır, kalıcılaşmaz ve o raf
 * burada görünmez — görüntüde yine doğru yerde durur, yalnız yük sayımına
 * girmez. Zemin döşemesi olan her sahnede (yani pratikte hepsinde) sorun yok.
 */
export function racksOnMezzanine(
  nodes: Readonly<Record<string, unknown>>,
  mezzanine: MezzanineNode,
): SupportedRack[] {
  const byDeckId = new Map(
    resolveTierElevations(mezzanine.tiers).map((tier) => [
      deckSlabId(mezzanine.id, tier.index),
      tier,
    ]),
  )

  const found: SupportedRack[] = []

  for (const [id, candidate] of Object.entries(nodes)) {
    if ((candidate as { type?: string })?.type !== 'warehouse:pallet-rack') continue
    const rack = candidate as PalletRackNode
    const tier = rack.supportSlabId ? byDeckId.get(rack.supportSlabId) : undefined
    if (!tier) continue

    const footprintM2 = rackFootprintM2(rack)
    found.push({
      rackId: id,
      rack,
      tierIndex: tier.index,
      declaredLoadKg: rackDeclaredLoadKg(rack),
      footprintM2,
      allowanceKg: tier.loadClass * footprintM2,
    })
  }

  return found
}

/**
 * Yük sınıfını aşan raflar — yalnız uyarı metni üretir.
 *
 * Aşım oranı da veriliyor: "aştı" tek başına bir mühendisin ne kadar
 * aştığını sormasını gerektirirdi.
 */
export function overloadedRacks(supported: readonly SupportedRack[]): SupportedRack[] {
  return supported.filter((entry) => entry.declaredLoadKg > entry.allowanceKg)
}

/**
 * Panelin gösterdiği cümle — hüküm değil, ölçü ve sebep.
 *
 * Birim PARAMETRE, mağaza okuması değil: bu modül saf ve öyle kalmalı. Kütle
 * (kg) çevrilmiyor — Units yalnız uzunluk ve alanı yönetiyor, kütleyi değil.
 */
export function overloadText(entry: SupportedRack, unit: LinearUnit = DEFAULT_UNIT): string {
  const ratio = entry.declaredLoadKg / Math.max(entry.allowanceKg, 1)
  return `Tier ${entry.tierIndex}: bir raf ${entry.declaredLoadKg.toFixed(0)} kg beyan ediyor, taban izi (${areaLabel(entry.footprintM2, unit, 2)}) için sınır ${entry.allowanceKg.toFixed(0)} kg — ${ratio.toFixed(1)}× aşım. Yapısal inceleme gerekir (FEM değil, yayılı yük oranı).`
}

/** Bir tier'in üstündeki toplam beyan edilen yük ve toplam izin, kg. */
export function tierLoadSummary(
  supported: readonly SupportedRack[],
  tierIndex: number,
): { declaredKg: number; allowanceKg: number; count: number } {
  const rows = supported.filter((entry) => entry.tierIndex === tierIndex)
  return {
    declaredKg: rows.reduce((sum, entry) => sum + entry.declaredLoadKg, 0),
    allowanceKg: rows.reduce((sum, entry) => sum + entry.allowanceKg, 0),
    count: rows.length,
  }
}
