import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { routePointsEqual, startsGripDrag } from './route-controls'
import type { Point } from './stripes'

const SOURCE = readFileSync('src/route/route-controls.tsx', 'utf8')

/**
 * BEKÇİ: seçili bir rotanın tutamakları kamerayı çalamaz.
 *
 * ## Bulunan hata
 *
 * `beginDrag` / `beginInsert` / `beginAppend` / `beginPrepend` `event.button`'a
 * HİÇ bakmıyordu. Host'ta SAĞ tuş kameranın ROTATE'i, ORTA tuş SCREEN_PAN'ı
 * (`editor/components/editor/custom-camera-controls.tsx`). Tutamaklar boyanın
 * 50 mm üstünde duruyor ve seçim kutuları koşunun her iki ucundan 1 m ötesine
 * uzanıyor, yani seçili bir rotanın YAKININDA yapılan bir sağ-sürükleme
 * yörünge yerine köşe sürüklemesi başlatıyordu: kamera kımıldamıyor,
 * `stopPropagation` jestin her `pointermove`'unu yutuyor. Kullanıcının
 * "yaya yoluna tıklayınca kamera kitleniyor" dediği şey birebir bu.
 *
 * Host kendi düğüm olaylarında aynı kuralı zaten uyguluyor:
 * `if (e.button !== 0) return` (`viewer/hooks/use-node-events.ts`).
 *
 * ## İkinci hata: kımıldamayan bir basış SÜRÜKLEME sayılıyordu
 *
 * `commit()` koşulsuz `swallowNextClick()` çağırıyordu — pencere YAKALAMA
 * evresinde bir sonraki tıklamayı durduran bir dinleyici. `grid:click` de tam o
 * tuval dinleyicisinden yayınlanıyor (`editor/hooks/use-grid-events.ts`) ve
 * çok noktalı bir aracın çizim için sahip olduğu TEK olay o. Yani seçili bir
 * rotanın tutamağına yapılan sıradan bir tıklama, kullanıcının sahnede koymaya
 * çalıştığı BİR SONRAKİ köşeyi siliyordu: "sahnede yaya yolu çizemiyorum".
 */
describe('startsGripDrag', () => {
  test('birincil tuş sürüklemeyi başlatır', () => {
    expect(startsGripDrag({ button: 0 })).toBe(true)
  })

  test('SAĞ tuş başlatmaz — o kameranın ROTATE jesti', () => {
    expect(startsGripDrag({ button: 2 })).toBe(false)
  })

  test('ORTA tuş başlatmaz — o kameranın SCREEN_PAN jesti', () => {
    expect(startsGripDrag({ button: 1 })).toBe(false)
  })

  test('düğmesiz olay birincil sayılır', () => {
    // Dokunmatik yığınların bir kısmı ve sentezlenmiş olaylar `button`
    // taşımıyor; onları reddetmek telefonda sürüklemeyi tümden kapatırdı.
    expect(startsGripDrag({})).toBe(true)
  })
})

describe('dört tutamak da tuşu ÖNCE denetler', () => {
  const handlers = ['beginDrag', 'beginInsert', 'beginAppend', 'beginPrepend']

  test.each(handlers)('%s — startsGripDrag, stopPropagation ÖNCESİNDE', (handler) => {
    const start = SOURCE.indexOf(`const ${handler} =`)
    expect(start).toBeGreaterThan(-1)
    const body = SOURCE.slice(start, start + 400)
    const guardAt = body.indexOf('startsGripDrag(event)')
    const stopAt = body.indexOf('event.stopPropagation()')
    expect(guardAt).toBeGreaterThan(-1)
    expect(stopAt).toBeGreaterThan(-1)
    // Sıra tesadüf değil: `stopPropagation` önce çağrılırsa sağ tuş yine
    // yutulur ve kamera yine kımıldamaz, guard eklenmiş olsa bile.
    expect(guardAt).toBeLessThan(stopAt)
  })
})

describe('routePointsEqual', () => {
  const a: Point[] = [
    [0, 0],
    [5, 0],
  ]

  test('aynı dizi', () => {
    expect(routePointsEqual(a, a)).toBe(true)
  })

  test('aynı içerik, farklı kimlik — kımıldamamış bir jest', () => {
    expect(
      routePointsEqual(a, [
        [0, 0],
        [5, 0],
      ]),
    ).toBe(true)
  })

  test('taşınmış tek köşe eşit DEĞİL', () => {
    expect(
      routePointsEqual(a, [
        [0, 0],
        [5, 0.01],
      ]),
    ).toBe(false)
  })

  test('eklenmiş köşe eşit değil — uç tutamağı gerçekten bir düzenleme', () => {
    expect(
      routePointsEqual(a, [
        [0, 0],
        [5, 0],
        [7, 0],
      ]),
    ).toBe(false)
  })

  test('null bir jest hiçbir şeye eşit değil', () => {
    expect(routePointsEqual(null, a)).toBe(false)
    expect(routePointsEqual(a, null)).toBe(false)
    expect(routePointsEqual(null, null)).toBe(true)
  })
})

describe('kımıldamayan bir basış tıklama yutmaz', () => {
  test('swallowNextClick yalnız `changed` kapısının ARDINDA çağrılıyor', () => {
    const commitAt = SOURCE.indexOf('const commit = useCallback(')
    expect(commitAt).toBeGreaterThan(-1)
    const commitBody = SOURCE.slice(commitAt, SOURCE.indexOf('const cancelDrag', commitAt))
    const guardAt = commitBody.indexOf('if (!changed) return')
    const swallowAt = commitBody.indexOf('swallowNextClick()')
    expect(guardAt).toBeGreaterThan(-1)
    expect(swallowAt).toBeGreaterThan(guardAt)
  })

  test('sürükleme çıkışı TEK bir fonksiyondan geçiyor', () => {
    // `inputDragging`'i kaldırmayı unutan bir çıkış yolu, host'un düğüm seçim
    // olaylarını kalıcı olarak susturur (`viewer/hooks/use-node-events.ts`).
    // Bunu üç ayrı yerde tekrarlamak, üçüncüsünde atlanmasının sebebiydi.
    expect(SOURCE).toContain('const releaseDrag = useCallback(')
    expect(SOURCE).toContain('const { points, origin } = releaseDrag()')
    expect(SOURCE).toContain('const cancelDrag = useCallback(() => {\n    releaseDrag()\n  }')
    // Sökülme ve düğüm değişimi de aynı kapıdan.
    expect(SOURCE).toContain('return () => {\n      releaseDrag()\n    }')
  })

  test('setInputDragging(true) yalnız acquireDrag içinde', () => {
    const raises = SOURCE.split('setInputDragging?.(true)').length - 1
    expect(raises).toBe(1)
    const acquireAt = SOURCE.indexOf('const acquireDrag = useCallback(')
    const raiseAt = SOURCE.indexOf('setInputDragging?.(true)')
    expect(acquireAt).toBeGreaterThan(-1)
    expect(raiseAt).toBeGreaterThan(acquireAt)
  })
})
