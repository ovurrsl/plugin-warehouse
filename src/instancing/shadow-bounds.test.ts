import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * BEKÇİ: kolektif çizilen her kind, seçim koliderini KAYITLI GRUBUN İÇİNDE
 * tutmalı.
 *
 * ## Neden bir test gerekiyor
 *
 * Bu, kullanıcının "gölgeler kafasına göre çalışıyor" diye bildirdiği hatanın
 * ta kendisiydi ve hiçbir yerde hata vermiyordu.
 *
 * Host, yönlü ışığın gölge frustum'unu KAYITLI düğümlerin birleşimine
 * oturtuyor (`viewer/components/viewer/lights.tsx`: `for (const [id, obj] of
 * sceneRegistry.nodes) box.expandByObject(obj)`). Kolektif çizici açıkken —
 * ki varsayılan bu — bir rafın kayıtlı grubunun içi BOŞ: gövde sahne
 * kökündeki havuz mesh'inden çiziliyor ve o mesh kayıt defterinde yok. Kolider
 * de grubun kardeşiyse, düğümün zarfını bildiren hiçbir şey kalmıyor.
 *
 * Sonucu iki ayrı belirti:
 *
 *  1. Sahnede host binası yoksa birleşim boş kalıyor ve frustum dünya
 *     merkezinde sabit bir yedeğe düşüyor — 120 m'lik bir holün büyük kısmı
 *     dışarıda kalıyor, oradaki rafların gölgesi hiç çizilmiyor.
 *  2. Bir rafı SEÇMEK onu kendi çizmesine döndürüyor, grubun içi doluyor,
 *     birleşim büyüyor ve bütün binanın gölgeleri bir anda değişiyor.
 *
 * ## Neden kaynak seviyesinde
 *
 * `instancing/coverage.test.ts` ile aynı gerekçe: bu bir çalışma-zamanı
 * davranışı değil, bir MONTAJ kararı — kolider ya o grubun içinde yazılıdır ya
 * değildir. Sahne kurmadan sınamanın dürüst yolu kaynağa bakmak.
 *
 * ## Neden bedeli yok
 *
 * `colliderProps` `visible: false` veriyor; üç, görünmez alt ağacı
 * `projectObject`'te tümden eliyor, yani ne renk ne gölge geçidine tek bir
 * çizim çağrısı ekleniyor. `Box3.expandByObject` ise görünürlüğe HİÇ bakmıyor.
 * Kutuyu içeri almak bu yüzden bedava: gölge sınırları düzeliyor, çizim sayısı
 * değişmiyor.
 *
 * Seçim ana hattı da etkilenmiyor — maskesini sıradan bir `render()` sırasında
 * `renderObject`'i devralarak topluyor, görünmez mesh oraya hiç ulaşmıyor.
 * (Kolider bir zamanlar tam da "ana hat gerçek silueti çizsin" diye dışarıda
 * duruyordu; gerekçe GÖRÜNÜR bir kutu için doğru, bunun için değil.)
 */

const SRC = join(import.meta.dir, '..')

function source(relative: string): string {
  return readFileSync(join(SRC, relative), 'utf8')
}

/**
 * Kolektif çizilen ve seçim kolideri olan her renderer.
 *
 * Liste elle değil, `coverage.test.ts`'in kolektif listesiyle aynı ölçütten
 * türüyor: `useCollective(` çağıran ve bir kolider mesh'i olan her dosya.
 * Elle tutulan bir liste, yeni bir kind eklendiğinde sessizce eksik kalırdı —
 * ki bu hatanın beş konveyör türevinde tekrar etme biçimi tam olarak buydu.
 */
const COLLECTIVE_RENDERERS = [
  'rack/renderer.tsx',
  'pallet/renderer.tsx',
  'drivein/renderer.tsx',
  'longspan/renderer.tsx',
  'm3/renderer.tsx',
  'live-racking/renderer.tsx',
  'mezzanine/renderer.tsx',
  'conveyor/renderer.tsx',
  'conveyor/booster-renderer.tsx',
  'conveyor/curve-renderer.tsx',
  'conveyor/launcher-renderer.tsx',
  'conveyor/oblique-renderer.tsx',
  'conveyor/transfer-renderer.tsx',
]

/** Kolider mesh'inin iki yazım biçimi de sayılır. */
const COLLIDER_MARKER = /UNIT_COLLIDER|colliderProps\(/

describe('gölge sınırları — kolider kayıtlı grubun içinde', () => {
  test('liste boş değil — bekçinin en sinsi kendini kandırma biçimi', () => {
    expect(COLLECTIVE_RENDERERS.length).toBeGreaterThan(10)
  })

  for (const file of COLLECTIVE_RENDERERS) {
    test(`${file} kolideri kayıtlı grubun İÇİNDE`, () => {
      const text = source(file)

      const group = text.indexOf('ref={registeredRef}')
      expect(group, `${file}: kayıtlı grup bulunamadı`).toBeGreaterThan(-1)

      // `import` satırlarındaki `UNIT_COLLIDER` sayılmasın: JSX'teki ilk
      // kullanımı arıyoruz, o da her zaman `return`'den sonra.
      const markup = text.indexOf('\n  return (')
      expect(markup, `${file}: JSX gövdesi bulunamadı`).toBeGreaterThan(-1)

      const collider = text.slice(markup).search(COLLIDER_MARKER)
      expect(collider, `${file}: seçim kolideri bulunamadı`).toBeGreaterThan(-1)

      expect(
        markup + collider > group,
        `${file}: kolider kayıtlı grubun DIŞINDA. Kolektif çizici açıkken o grubun içi boş kalıyor, yani host'un gölge frustum'u bu düğümün zarfını hiç görmüyor — gölgeler görünmez bir çizgide kesiliyor ve düğüm seçilince bütün sahnenin gölgesi değişiyor.`,
      ).toBe(true)
    })

    test(`${file} kolideri YEREL koordinatta`, () => {
      // İçeri alınan bir kolider, kayıtlı grubun konumunu ve dönüşünü İKİNCİ
      // kez uygulamamalı. Dünya konumunu yeniden yazmak (`position[0]`) kutuyu
      // düğümden iki kat uzağa koyar: tıklama hedefi kayar ve gölge sınırı
      // sahnenin olmayan bir yerine şişer. Hatanın sessiz olması, kutunun
      // görünmez olmasından.
      const text = source(file)
      const markup = text.indexOf('\n  return (')
      const body = text.slice(markup)
      const collider = body.search(COLLIDER_MARKER)
      const block = body.slice(collider, collider + 500)
      expect(
        block.includes('position[0]'),
        `${file}: kolider hâlâ dünya koordinatı yazıyor — kayıtlı grup dönüşümü zaten taşıyor, ikinci kez uygulanıyor`,
      ).toBe(false)
    })
  }
})
