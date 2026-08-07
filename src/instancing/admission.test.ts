import { afterEach, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  admitAllNow,
  pendingAdmissions,
  resetAdmission,
  resumeProgressiveAdmission,
} from './admission'

/** Kolektif çizen renderer sayısı — testin ölçütünün boşa düşmediğinin kanıtı. */
function collectiveRendererCount(dir: string): number {
  let n = 0
  for (const family of readdirSync(dir, { withFileTypes: true })) {
    if (!family.isDirectory()) continue
    for (const entry of readdirSync(join(dir, family.name))) {
      if (!entry.endsWith('renderer.tsx')) continue
      if (readFileSync(join(dir, family.name, entry), 'utf8').includes('useCollective')) n++
    }
  }
  return n
}

afterEach(() => {
  resetAdmission()
})

/**
 * Kademeli mount'un iki yanlış hâli de SESSİZ: kuyruk hiç boşalmazsa raflar
 * görünmez ve hiçbir hata çıkmaz; kuyruk bir seferde boşalırsa yükleme yine
 * kilitlenir ve yine hiçbir hata çıkmaz. Testler ikisini de hedefliyor.
 */
describe('kademeli mount kabulü', () => {
  test('dışa aktarım kuyruğu SENKRON boşaltır — yarım sahne aktarılamaz', () => {
    admitAllNow()
    expect(pendingAdmissions()).toBe(0)

    // Senkronluk sözleşmenin kendisi: bir kare beklemek, dışa aktarımın aynı
    // tick'te anlık görüntü aldığı hâlde rafları eksik bırakırdı. `await` ya da
    // `requestAnimationFrame` üstünden boşaltmak bunu sessizce bozar.
    const source = readFileSync(join(import.meta.dir, 'admission.ts'), 'utf8')
    const body = source.slice(source.indexOf('export function admitAllNow'))
    const fn = body.slice(0, body.indexOf('\n}'))
    expect(fn).not.toContain('requestAnimationFrame')
    expect(fn).not.toContain('await')
    expect(fn).toContain('waiting.clear()')
  })

  test('dışa aktarım bitince bütçe geri devreye girer', () => {
    admitAllNow()
    resumeProgressiveAdmission()
    // Bayrak sıfırlanmazsa sonraki büyük yükleme kademeli yola HİÇ girmez ve
    // ilk sahnedeki kilitlenme geri gelir — sessizce.
    const source = readFileSync(join(import.meta.dir, 'admission.ts'), 'utf8')
    expect(source).toContain('draining = false')
  })

  test('bütçe tek başına bırakılmamış — taban ilerlemeyi garanti ediyor', () => {
    const source = readFileSync(join(import.meta.dir, 'admission.ts'), 'utf8')
    // Yalnız süreye bakan bir kuyruk, tek mount'u bütçeyi aşan bir makinede
    // kare başına bir düğüm ilerler; beş bin raf dakikalar sürerdi.
    expect(source).toContain('MIN_PER_FRAME')
    const min = source.match(/const MIN_PER_FRAME = (\d+)/)
    expect(Number(min?.[1])).toBeGreaterThan(0)
  })

  test('kabul edilen düğüm yeniden mount’ta kuyruğa GİRMEZ', () => {
    const source = readFileSync(join(import.meta.dir, 'admission.ts'), 'utf8')
    // Girseydi: kat görünürlüğü açılıp kapandığında zaten görünen raflar bir
    // kare kaybolur, kullanıcıya titreme olarak görünürdü.
    expect(source).toContain('const admitted = new Set<string>()')
    expect(source).toContain('admitted.has(nodeId)')
  })

  test('kuyruk boşalınca döngü kendini durdurur', () => {
    const source = readFileSync(join(import.meta.dir, 'admission.ts'), 'utf8')
    // `schedule()` koşulsuz yeniden kurulsaydı, sahne dolduktan sonra da her
    // kare boş bir rAF geri çağrısı koşardı — ölü döngü.
    expect(source).toContain('if (waiting.size > 0) schedule()')
  })

  test('kapı kolektif sisteme BAĞLI DEĞİL', () => {
    const source = readFileSync(join(import.meta.dir, 'admission.ts'), 'utf8')
    // Bağlı olsaydı: kullanıcı instancing'i kapattığında (donmayı teşhis etmek
    // için önerilen ilk adım) hiçbir raf hiç mount olmazdı — performans ayarı
    // sahneyi boşaltan bir hataya dönüşürdü.
    //
    // Kontrol import SATIRLARI üstünden: modülün gerekçesi bu bağımlılığın
    // neden kurulmadığını anlatıyor, yani düz metin araması kendi yorumunu
    // yakalar ve testi işe yaramaz kılardı.
    const imports = source
      .split('\n')
      .filter((line) => line.startsWith('import '))
      .join('\n')
    expect(imports).not.toContain('../store')
    expect(imports).not.toContain('./collective')
    expect(imports).not.toContain('@react-three/fiber')
    expect(source).toContain('requestAnimationFrame')
  })

  test('KOLEKTİF ÇİZEN HER renderer kapılı ve gövdesi ayrı', () => {
    // Liste elle tutulmuyor: "useCollective çağıran her renderer" ölçütünden
    // türetiliyor. Elle tutulsaydı, yeni bir kolektif kind eklendiğinde listeye
    // yazılmayı unutmak sessizce kapısız bırakırdı — ve kapısız bir kind, o
    // kind'dan binlerce olan bir sahnede yükleme kilidini geri getirir.
    const dir = join(import.meta.dir, '..')
    const offenders: string[] = []

    for (const family of readdirSync(dir, { withFileTypes: true })) {
      if (!family.isDirectory()) continue
      for (const entry of readdirSync(join(dir, family.name))) {
        if (!entry.endsWith('renderer.tsx')) continue
        const rel = join(family.name, entry)
        const source = readFileSync(join(dir, rel), 'utf8')
        if (!source.includes('useCollective')) continue

        const gate = source.indexOf('const admitted = useAdmitted')
        const bail = source.indexOf('if (!admitted) return null')
        // Gövde aynı bileşende kalsaydı kancalar yine koşardı ve kapı hiçbir şey
        // kazandırmazdı — tipler bunu ifade edemiyor, o yüzden burada bekçilik.
        const body = /function \w+Body\(/.test(source)
        if (gate === -1 || bail <= gate || !body) offenders.push(rel)
      }
    }

    expect(offenders).toEqual([])
    // Ölçütün gerçekten dosya bulduğunun kanıtı: sıfır dosya taranırsa yukarıdaki
    // beklenti boş listeyle sessizce geçerdi.
    expect(collectiveRendererCount(dir)).toBeGreaterThanOrEqual(13)
  })

  test('dışa aktarım kapısı kolektif sistemde bağlı', () => {
    const source = readFileSync(join(import.meta.dir, 'collective-system.tsx'), 'utf8')
    expect(source).toContain('admitAllNow()')
    expect(source).toContain('resumeProgressiveAdmission()')
  })
})

describe('katman takası kısıtı — kamera uçuşu havuzları her kare yeniden kurduramaz', () => {
  test('takas zamana bağlı, sahne düzenlemesi kısıtsız', () => {
    /**
     * Sessiz hata iki yönlü. Kısıt yoksa: kamera uçuşunda `tierChanged`
     * neredeyse her kare doğru ve etkilenen havuzların tam instanceMatrix
     * tamponu her kare GPU'ya yeniden yüklenir — kullanıcının "kamera
     * hareketinde kilitleniyor, nesne sürüklerken sorun yok" tarifi
     * (2026-08-07). Kısıt matricesDirty'yi de kapsarsa: raf silme/taşıma
     * çeyrek saniye ekranda hayalet bırakır.
     */
    const source = readFileSync(join(import.meta.dir, 'collective-system.tsx'), 'utf8')
    expect(source).toContain('TIER_SWAP_MIN_MS')
    // Süre, kare sayısı değil — yavaş makinede kısıt gevşemesin.
    expect(source).toMatch(/TIER_SWAP_MIN_MS = \d+/)
    // Sahne düzenlemesi anında inşa: matricesDirty tek başına yeterli kalmalı.
    expect(source).toContain('if (matricesDirty || tierSwapDue)')
  })
})
