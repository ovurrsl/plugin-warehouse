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
import { resolveTierElevations } from './metrics'
import type { MezzanineNode } from './schema'

/** Bir düğümün mezzanine üstünde sayılması için kot toleransı, metre. */
const DECK_TOLERANCE_M = 0.15

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
 * "Üstünde durmak" iki şart: rafın taban izi merkezi mezzanine'in taban
 * izinin İÇİNDE, ve rafın Y kotu bir tier'in yürüme yüzeyine yakın. İkinci
 * şart olmadan mezzanine'in ALTINDA duran raflar da sayılırdı — ve
 * altındaki hacim tam olarak rafa açık olan yerdir.
 */
export function racksOnMezzanine(
  nodes: Readonly<Record<string, unknown>>,
  mezzanine: MezzanineNode,
): SupportedRack[] {
  const resolved = resolveTierElevations(mezzanine.tiers)
  const [mx, , mz] = mezzanine.position ?? [0, 0, 0]
  const rotationY = mezzanine.rotation?.[1] ?? 0
  const halfWidth = (mezzanine.grid.baysX * mezzanine.grid.bayWidthM) / 2
  const halfDepth = (mezzanine.grid.baysY * mezzanine.grid.bayDepthM) / 2

  const found: SupportedRack[] = []

  for (const [id, candidate] of Object.entries(nodes)) {
    if ((candidate as { type?: string })?.type !== 'warehouse:pallet-rack') continue
    const rack = candidate as PalletRackNode
    const [rx, ry, rz] = rack.position ?? [0, 0, 0]

    // Mezzanine'in yerel çerçevesine döndür — döndürülmüş bir mezzanine'in
    // üstündeki raf, dünya eksenlerinde kutusunun dışında görünürdü.
    const dx = rx - mx
    const dz = rz - mz
    const cos = Math.cos(-rotationY)
    const sin = Math.sin(-rotationY)
    const localX = dx * cos + dz * sin
    const localZ = -dx * sin + dz * cos
    if (Math.abs(localX) > halfWidth || Math.abs(localZ) > halfDepth) continue

    const tier = resolved.find((t) => Math.abs(ry - t.deckTopM) <= DECK_TOLERANCE_M)
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

/** Panelin gösterdiği cümle — hüküm değil, ölçü ve sebep. */
export function overloadText(entry: SupportedRack): string {
  const ratio = entry.declaredLoadKg / Math.max(entry.allowanceKg, 1)
  return `Tier ${entry.tierIndex}: bir raf ${entry.declaredLoadKg.toFixed(0)} kg beyan ediyor, taban izi (${entry.footprintM2.toFixed(2)} m²) için sınır ${entry.allowanceKg.toFixed(0)} kg — ${ratio.toFixed(1)}× aşım. Yapısal inceleme gerekir (FEM değil, yayılı yük oranı).`
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
