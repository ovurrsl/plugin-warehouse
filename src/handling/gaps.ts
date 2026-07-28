/**
 * Boşluk kütüğü — yayınlanmadığı TESPİT EDİLMİŞ figürler.
 *
 * Bu dosya eksik verinin listesi değil, eksikliğin KAYDIDIR: buradaki her
 * giriş "arandı, bulunamadı, ve yerine ne yapılacağı karara bağlandı" demek.
 * Katalogda `null` duran her yayınlanmış boşluğun burada bir karşılığı vardır
 * ve `models.test.ts` bu eşleşmeyi kilitler — `null`'ı "makul bir aralıkla"
 * doldurmak, bu paketin ilk günden reddettiği şeydir.
 *
 * Girişin `note`'u panele OLDUĞU GİBİ taşınır. Kısaltılmış bir boşluk notu,
 * boşluğu bilgiye çeviren tek şeyi — gerekçeyi — atar.
 */

import type { TruckVariant } from './catalog'
import type { TruckModelId } from './models'

export type GapEntry = {
  /** Aile ya da tek model — hangisine aitse. */
  scope: TruckVariant | TruckModelId
  /** Hangi figür(ler) — VDI sembolü ya da adı. */
  figure: string
  /** Tam metin: neden yok, yerine ne yapılır, ne YAPILMAZ. */
  note: string
}

export const KNOWN_GAPS: readonly GapEntry[] = [
  // ── Manuel transpalet ─────────────────────────────────────────────────
  {
    scope: 'hand-pallet',
    figure: 'x (VDI 1.8, yük mesafesi)',
    note:
      'Yayınlanmamış. Ast doğrudan tablodan alınır, x üzerinden formülle hesaplanmaz — ' +
      'formül yolu bir uydurma girdiyi yayınlanmış bir çıktıya çevirirdi.',
  },
  {
    scope: 'hand-pallet',
    figure: 'Ast, Wa (680×1150 varyantı)',
    note:
      'Çıkarımda yalnız standart 520×1150 varyantı için yayınlanmış (Ast 1.584/1.784, ' +
      'Wa 1.274). Kataloglanan 680×1150 varyantının dingil mesafesi farklı (1.080 ↔ 1.100), ' +
      'dolayısıyla figürler kopyalanamaz: ast/Wa null kalır ve koridor sınıf bandından ' +
      'okunur — üretici teyidi gelirse satıra yazılır.',
  },
  // ── Elektrikli transpalet ─────────────────────────────────────────────
  {
    scope: 'powered-pallet',
    figure: 'Gövde/kaput/yan koruma dikey ölçüleri',
    note:
      "VDI'da yayınlanmamış; 3B gövde ±%5–10 mühendislik tahminiyle çizilir ve tahmin " +
      'estetiktir, ölçü değildir — çarpışma kutusuna ve koridor okumasına girmez.',
  },
  // ── Karşı ağırlıklı forklift ──────────────────────────────────────────
  {
    scope: 'forklift',
    figure: 'Mast tabloları (3000 ZT satırı dışında)',
    note:
      'Grup başına yalnız 3000 ZT satırı çıkarıldı (A: 2.060/3.590, B: 2.067/3.612 → ' +
      'h4−h3 = 0.590 / 0.612). İki grubun tepe payı bile eşit değil, yani tek bir sabitle ' +
      'satır türetilemez: kalan satırlar girilene kadar mast seçici yalnız bu iki satırı sunar.',
  },
  {
    scope: 'forklift',
    figure: 'b5 (çatal açıklığı)',
    note:
      'Yayınlanmamış. b3=0.980 ISO 2A TAŞIYICI genişliğidir, çatal açıklığı değil — ' +
      "b5'e yazmak iki farklı niceliği tek alanda eritir. Alan null kalır.",
  },
  // ── Reach truck ───────────────────────────────────────────────────────
  {
    scope: 'reach',
    figure: 'Mast tabloları (satır satır)',
    note:
      'Yalnız grup aralıkları (A 4.250–9.110, B 6.200–11.510) ve iki türetilmiş sabit ' +
      '(h4 = h3 + 0.746, h2 = h1 − 0.730, 39 satırda doğrulanmış) elimizde. Ara bir h3 ' +
      'geçerli bir konfigürasyon DEĞİLDİR; satırlar girilene kadar seçici boştur.',
  },
  {
    scope: 'reach',
    figure: 'Rezidüel kapasite eğrisi',
    note:
      'YAYINLANMAMIŞ. Yüksek h3 + c > 0.6 kombinasyonlarında nominal Q taahhüt edilemez; ' +
      'kural R-9: hesap yapılmaz, yalnız "doğrulanmadı" uyarısı üretilir.',
  },
  {
    scope: 'reach',
    figure: 'b10 (ön iz genişliği)',
    note: 'Çıkarımda yok; alan null. 3B iz genişliği gövde tahmininden gelir ve öyle etiketlenir.',
  },
  // ── Üç yönlü VNA istifleyici ──────────────────────────────────────────
  {
    scope: 'turret',
    figure: 'Ast (VDI 4.34)',
    note:
      'YAYINLANMAMIŞ ve alan KALICI null. Üreticinin formülü: Ast = max(araç zarfı, palet ' +
      'diyagonali) + 2×0.090; 1200×1200 palet için pratik aralık 1.6–1.9 m, "raf projesine göre ' +
      'üreticiden teyit edin" notuyla. Hesaplanmış değer ÇİZİLMEZ: EN 15620 trilateral-turret ' +
      'bandı (1.7–1.9, yayınlanmış) zaten bu aralığı kapsıyor ve ikinci bir sayı yalnız çelişme ' +
      'imkânı ekler. Sınıf bandına dokunulmaz.',
  },
  {
    scope: 'turret',
    figure: 'l1 / l2 tanımları',
    note:
      'l1 − l2 = 0.286 beş modelde de sabit, çatal boyu 1.200 — jenerik l1 = l2 + çatal zinciri ' +
      '914 mm sapıyor. İki ölçü aynı niceliği ölçmüyor; doğru tanımlar teyit edilene kadar ikisi ' +
      'de tablodan okunur, biri diğerinden türetilmez (chains.CHAIN_EXEMPT).',
  },
  {
    scope: 'turret',
    figure: 'h1 (kapalı mast), DZ h2',
    note:
      'Yayınlanmamış. Aile, veri teyit edilene kadar BEKLETİLİR — bir Man-Up aracın kapalı ' +
      "mastını uydurmak, araştırma brief §1'in reddettiği tek şeydir (plan §10 soru 7b).",
  },
  {
    scope: 'tt-1600',
    figure: 'Mast satırları > 14.5 m',
    note:
      "VDI'da satır satır yok; 18.0 tavanı özel konfigürasyondur (liftPLUS 17.5 m referansı). " +
      'Seçicide tek uç değer olarak "özel konfigürasyon" etiketiyle durur, ara satır uydurulmaz.',
  },
  {
    scope: 'turret',
    figure: 'Transfer koridoru',
    note:
      'Koridora giriş dönüşü için ≥ 4.0–4.5 m gerekir ve bu ÇALIŞMA koridorundan ayrı bir ' +
      'kavramdır — route.width ile karıştırılmaz; tek "koridor genişliği" bu makineyi ifade etmiyor.',
  },
  // ── AGV ───────────────────────────────────────────────────────────────
  {
    scope: 'agv',
    figure: 'Tümü',
    note:
      "Araştırma raporu yok. Sınıf sözlükte kalır (route.requiredFor enum'unu daraltmamak ve " +
      'kaydedilmiş sahneleri kırmamak için), yerleştirilebilir model sunmaz, bandı tahmin kalır.',
  },
]

/** Bir modele dokunan girişler: kendi kimliği + ailesi. */
export function gapsFor(model: { id: TruckModelId; variant: TruckVariant }): GapEntry[] {
  return KNOWN_GAPS.filter((gap) => gap.scope === model.id || gap.scope === model.variant)
}
