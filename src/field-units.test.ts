import { describe, expect, test } from 'bun:test'
import { warehousePlugin } from './index'

/**
 * BEKÇİ: metre tutan her sayı alanı `unit` bildirmeli.
 *
 * `unit` bu eklentide bir etiket sanılıyordu; host'ta üç işi var ve üçü de
 * alan onu bildirmeyince SESSİZCE kayboluyor (`slider-control.tsx` →
 * `lib/measurement-parser.ts`):
 *
 * 1. **Doğal dil ayrıştırma.** Host `@pascal-app/lingo`'yu `unit`'e bakarak
 *    kuruyor. Bildiren alana `1200mm`, `4ft`, `1m20` yazılabiliyor. Bildirmeyen
 *    alan düz `parseFloat`'a düşüyor — ve burası asıl tehlike: depo ekipmanı
 *    katalogları MİLİMETRE yayımlıyor, yani kullanıcının yazacağı ilk şey
 *    `1200`. Tezgâh genişliğinde bu 1200 metre demek, sessizce 4'e kırpılıyor
 *    ve kullanıcı 1,2 m istediğini sanarak 4 m'lik bir tezgâh alıyor.
 * 2. **Birim gösterimi.** Bildirmeyen alan panelde çıplak sayı gösteriyor,
 *    yani 0,75'in metre mi santim mi olduğu okunmuyor.
 * 3. **Emperyal çevrim.** Metrik/emperyal anahtarı `unit` üzerinden çalışıyor;
 *    bildirmeyen alan anahtar çevrildiğinde metre göstermeye devam ediyor.
 *
 * Kural bilerek TERSİNE kuruldu: varsayılan "birim bildir", istisna açıkça
 * yazılıyor. Böylece yarın eklenen bir ölçü alanı kendiliğinden kapsanıyor;
 * gerçekten birimsiz olan bir alan eklemek ise listeye bir satır ve bir
 * gerekçe yazmayı gerektiriyor. Ters kurulsaydı — istisnalar örtük olsaydı —
 * bekçi hiçbir şey yakalamazdı, ki bu dosya yazılırken dört alan tam da o
 * yüzden birimsiz duruyordu.
 */

/** Birimi OLMAYAN sayı alanları, ve neden. `kind/alan` → gerekçe. */
const INTENTIONALLY_UNITLESS: Record<string, string> = {
  'warehouse:conveyor-booster/rollers': 'adet',
  'warehouse:conveyor-telescopic/extension':
    'oran 0–1, metre değil — model B ölçüsü değişince anlamını koruyor',
  'warehouse:dock-leveller/inclination':
    'işaretli oran −1…+1, metre karşılığı tabla boyuna göre değişiyor',
  'warehouse:dock-leveller/lipExtension': 'oran 0–1',
  'warehouse:drive-in-rack/ghostFill': 'oran 0–1, doluluk',
  'warehouse:drive-in-rack/levels': 'adet',
  'warehouse:drive-in-rack/palletsDeep': 'adet',
  'warehouse:live-rack/gradient': 'kesir 0,03–0,05 (%3–5 eğim); host yüzde ayrıştırmıyor',
  'warehouse:live-rack/levels': 'adet',
  'warehouse:live-rack/palletsDeep': 'adet',
  'warehouse:pallet-rack/depthPositions': 'adet',
  'warehouse:pallet-rack/ghostFill': 'oran 0–1, doluluk',
  'warehouse:pallet-rack/levels': 'adet',
  'warehouse:pallet-rack/pickingLevels': 'adet',
  'warehouse:pallet-rack/tunnelLevels': 'adet',
  'warehouse:tote-cart/loadedTiers': 'adet',
  'warehouse:tote-cart/tiers': 'adet',
}

function unitlessNumberFields(): string[] {
  const found: string[] = []
  for (const def of warehousePlugin.nodes ?? []) {
    const groups = (def as { parametrics?: { groups?: { fields?: unknown[] }[] } }).parametrics
      ?.groups
    for (const group of groups ?? []) {
      for (const raw of group.fields ?? []) {
        const field = raw as { kind?: string; key?: unknown; unit?: string }
        if (field.kind !== 'number' || field.unit) continue
        found.push(`${def.kind}/${String(field.key)}`)
      }
    }
  }
  return [...new Set(found)].sort()
}

describe('sayı alanlarının birimi', () => {
  test('birimsiz her alan gerekçesiyle listede', () => {
    const undeclared = unitlessNumberFields().filter((id) => !(id in INTENTIONALLY_UNITLESS))
    expect(undeclared).toEqual([])
  })

  test('liste ölü satır taşımıyor', () => {
    // Bir alan birim kazandığında ya da silindiğinde satırı da gitmeli, yoksa
    // liste zamanla "her şey mazur" hâline gelir ve bekçi susar.
    const actual = new Set(unitlessNumberFields())
    const stale = Object.keys(INTENTIONALLY_UNITLESS).filter((id) => !actual.has(id))
    expect(stale).toEqual([])
  })

  test('ölçü alanları gerçekten birim bildiriyor', () => {
    // Bu dördü listede DEĞİL, ve olmamalı: dördü de metre. Birimsiz
    // duruyorlardı ve belirtisi yalnızca panelde çıplak bir sayıydı.
    const declared = new Set<string>()
    for (const def of warehousePlugin.nodes ?? []) {
      const groups = (def as { parametrics?: { groups?: { fields?: unknown[] }[] } }).parametrics
        ?.groups
      for (const group of groups ?? []) {
        for (const raw of group.fields ?? []) {
          const field = raw as { kind?: string; key?: unknown; unit?: string }
          if (field.kind === 'number' && field.unit)
            declared.add(`${def.kind}/${String(field.key)}`)
        }
      }
    }

    expect(declared).toContain('warehouse:bench/width')
    expect(declared).toContain('warehouse:bench/height')
    expect(declared).toContain('warehouse:bench/depth')
    expect(declared).toContain('warehouse:conveyor-telescopic/transportHeight')
  })
})
