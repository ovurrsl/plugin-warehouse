import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * BEKÇİ: hangi kind kolektif çiziciye katılıyor, hangisi katılmıyor ve NEDEN.
 *
 * ## Neden kaynak seviyesinde
 *
 * Katılım bir çalışma-zamanı davranışı değil, bir MONTAJ kararı: renderer ya
 * `useCollective` çağırır ya çağırmaz. Bunu React ağacı kurmadan sınamanın tek
 * dürüst yolu kaynağa bakmak. Alternatif — tanımlara bir `instanced: true`
 * bayrağı eklemek — yalnız bu testin okuyacağı, davranışı hiç sürmeyen bir
 * meta veri olurdu; bu oturumun kaldırdığı "görünür ama etkisiz" alanların
 * aynısı.
 *
 * ## Ölçü
 *
 * Kolektif çizici KAPALIYKEN her düğüm kendi mesh'ini çizer: N modül = N draw
 * call renk geçişinde, N tane daha gölge geçişinde. Açıkken çizim sayısı
 * düğümle değil, farklı (geometri anahtarı × katman × materyal) üçlüsüyle
 * ölçeklenir. Bir konveyör hattı tam olarak bunun için tasarlanmış: bir taşıma
 * omurgası, bir dolgu boyu, bir geniş paketleme şeridi — avuç içi kadar şekil,
 * yüzlerce kopya. Üç yüz modüllük bir hat, üç yüz çizimden bir avuca iner.
 *
 * Konveyör ailesi bu turdan önce instancing'in TAMAMEN dışındaydı; paylaşımı
 * sağlayan `conveyorGeometryKey` zaten vardı, eksik olan tek şey kayıttı.
 */

const SRC = join(import.meta.dir, '..')

function source(relative: string): string {
  return readFileSync(join(SRC, relative), 'utf8')
}

/** Kolektif çiziciye kayıtlı olması GEREKEN renderer'lar. */
const INSTANCED = [
  'rack/renderer.tsx',
  'drivein/renderer.tsx',
  'longspan/renderer.tsx',
  'm3/renderer.tsx',
  'pallet/renderer.tsx',
  'mezzanine/renderer.tsx',
  'live-racking/renderer.tsx',
  'conveyor/renderer.tsx',
  'conveyor/booster-renderer.tsx',
  'conveyor/curve-renderer.tsx',
  'conveyor/launcher-renderer.tsx',
  'conveyor/oblique-renderer.tsx',
  'conveyor/transfer-renderer.tsx',
]

/**
 * Kayıtlı OLMAMASI gereken renderer'lar — her biri gerekçesiyle.
 *
 * Bir kind'ın dışarıda kalması bir eksik değil, bir karar. Gerekçesiz
 * bırakılırsa bir sonraki okuyucu ya boşuna ekler ya boşuna arar.
 */
const NOT_INSTANCED: Array<{ file: string; why: string }> = [
  {
    file: 'conveyor/telescopic-renderer.tsx',
    why: 'Bom her karede uzayıp kısalıyor: dört mesh, düğüm başına farklı poz. Kolektif havuz dünya matrislerini yeniden inşa anında donduruyor, yani her kare değişen bir şekli taşıyamaz.',
  },
  {
    file: 'truck/renderer.tsx',
    why: 'Mast kademeleri ve çatal kızağı filo sistemi tarafından düğüm başına ayrı sürülüyor; gövdeler tek bir matrise sığmıyor. Kendi LOD katmanı zaten var.',
  },
  {
    file: 'route/renderer.tsx',
    why: 'Her rota KENDİ poligonu — iki rotanın geometri anahtarı hiçbir zaman eşleşmiyor. Instancing yalnız şekil tekrarladığında kazandırır; burada havuz başına tek örnek düşer ve InstancedMesh ek yükü net kayıp olurdu.',
  },
]

describe('kolektif instancing kapsamı', () => {
  for (const file of INSTANCED) {
    test(`${file} kolektife kayıtlı`, () => {
      const text = source(file)
      expect(text.includes('useCollective('), `${file}: useCollective çağrısı yok`).toBe(true)
      // Kayıt tek başına yetmez: kolektif çizerken düğüm KENDİ mesh'ini
      // çizmemeli, yoksa iki kopya üst üste gelir ve z-savaşı olur.
      expect(text.includes('drawsSelf'), `${file}: drawsSelf koruması yok`).toBe(true)
    })
  }

  for (const { file, why } of NOT_INSTANCED) {
    test(`${file} kolektife GİRMİYOR — ${why.slice(0, 60)}…`, () => {
      expect(source(file).includes('useCollective(')).toBe(false)
      // Gerekçe boş bırakılamaz: bu listeye bir dosya eklemenin bedeli, neden
      // dışarıda kaldığını yazmaktır.
      expect(why.length).toBeGreaterThan(40)
    })
  }
})

describe('ölü kare döngüsü kalmadı', () => {
  /**
   * Katman döngüsü `SelfDrawnBody`'de yaşamalı, renderer'ın gövdesinde değil.
   *
   * Renderer gövdesindeki `useFrame`, kolektif çizici AÇIKKEN bile R3F'in
   * abonelik listesinde duruyordu: mesh mount edilmediği için ref `null`, döngü
   * ilk satırda dönüyor — ama kare başına bir kez çağrılıyor. İki bin raflık
   * bir sahnede kare başına iki bin boş kapanış, ve aynı işi kolektif sistem
   * zaten tek merkezî döngüde (`evaluateTiers`) yapıyor.
   *
   * `SelfDrawnBody` yalnız düğüm kendi çizerken mount olduğu için, kolektif
   * açıkken abonelik hiç kurulmuyor.
   */
  /**
   * Kural, "hiç mesafe hesabı olmasın" DEĞİL — o fazla kaba olurdu ve gerçek
   * bir döngüyü yasaklardı: paletin kargo mesh'i kolektife girmiyor, hep mount
   * ediliyor, ve aynı mesafeyi hem katman hem de film kesme sınırı için
   * kullanıyor. Onu silmek film'i her mesafede çizmek olurdu.
   *
   * Kural şu: kolektifin kapattığı GÖVDE `SelfDrawnBody` olmalı. Kendi
   * `<mesh>`'ini yazan bir dosya, katman döngüsünü de yanında taşıyor demektir
   * — ve o döngü, kolektif açıkken hiçbir şey yapmadan her kare çağrılır.
   */
  for (const file of INSTANCED) {
    test(`${file} gövdesi SelfDrawnBody`, () => {
      const text = source(file)
      const gate = text.indexOf('{drawsSelf && (')
      expect(gate, `${file}: drawsSelf koruması bulunamadı`).toBeGreaterThan(-1)

      /**
       * LOD'u OLMAYAN kind muaf — ve muafiyetin ölçütü sonsuz eşik.
       *
       * Asma katın tek katmanı var; `SelfDrawnBody` ona bir katman döngüsü
       * takmak, hiç değişmeyecek bir katmanı her sekiz karede yeniden
       * hesaplamak olurdu. Ölçüt yorum değil KOD: sonsuz eşik, kolektifin
       * merkezî döngüsünde de bu düğümün katman değiştirmesini imkânsız
       * kılıyor — yani "LOD yok" iddiası tek bir yerde, çalışan bir ifadeyle
       * duruyor.
       */
      if (text.includes('farSq: Number.POSITIVE_INFINITY')) return

      const body = text.slice(gate, gate + 200)
      expect(
        body.includes('<SelfDrawnBody'),
        `${file}: kolektifin kapattığı gövde hâlâ elle yazılmış bir <mesh> — katman döngüsü de yanındadır`,
      ).toBe(true)
    })
  }
})
