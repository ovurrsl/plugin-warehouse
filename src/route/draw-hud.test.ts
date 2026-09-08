import { describe, expect, test } from 'bun:test'
import { formatRouteHud, ROUTE_ROLE_COLORS, ROUTE_ROLE_LABELS } from './draw-hud'

/**
 * Çizim okumasının SÖYLEDİĞİ şey.
 *
 * Okuma, aracın kullanıcıya verdiği tek sayısal geri bildirim: yanlış olduğunda
 * hiçbir şey hata vermez, kullanıcı yalnızca yanlış uzunlukta bir yol çizer.
 * Bu yüzden testler "doğru olan doğru mu" değil, gördüğümüz ÜÇ makul yanlış
 * cevabı çiviliyor: köşe konmadan mesafe göstermek, tek bacaklı bir yolda aynı
 * sayıyı iki kez ("Mesafe" ve "Toplam") yazmak, ve toplamı canlı bacağı hariç
 * tutarak vermek.
 */
describe('formatRouteHud', () => {
  const base = {
    role: 'pedestrian' as const,
    hasAnchor: true,
    legDistanceM: 3,
    legAngleDeg: 90,
    totalDistanceM: 3,
  }

  test('köşe konmadan mesafe DEĞİL yönerge gösterir', () => {
    const text = formatRouteHud({ ...base, hasAnchor: false })
    expect(text.readouts).toEqual([])
    expect(text.prompt).toBe('Başlangıç noktasını tıklayın')
  })

  test('ilk köşeden sonra mesafe ve açı verir', () => {
    const text = formatRouteHud({ ...base, legDistanceM: 3.456, legAngleDeg: 44.44 })
    expect(text.prompt).toBeNull()
    expect(text.readouts[0]).toBe('Mesafe: 3.46 m')
    expect(text.readouts[1]).toBe('Açı: 44.4°')
  })

  test('tek bacaklı yolda toplamı TEKRAR ETMEZ', () => {
    // Toplam bacağa eşitken ikinci bir "Toplam: 3.00 m" satırı, kullanıcıya iki
    // ayrı ölçü verdiğini söyler. Kayan nokta toplamı bire bir tutturmayabilir,
    // o yüzden eşitlik toleranslı.
    const text = formatRouteHud({ ...base, legDistanceM: 3, totalDistanceM: 3 + 1e-12 })
    expect(text.readouts).toHaveLength(2)
    expect(text.readouts.join(' ')).not.toContain('Toplam')
  })

  test('ikinci bacaktan itibaren toplamı gösterir', () => {
    const text = formatRouteHud({ ...base, legDistanceM: 3, totalDistanceM: 11.5 })
    expect(text.readouts).toHaveLength(3)
    expect(text.readouts[2]).toBe('Toplam: 11.50 m')
  })

  test('iki rol iki fiş — sabit ad araç koridoruna da yapışmıyor', () => {
    expect(formatRouteHud({ ...base, role: 'pedestrian' }).roleLabel).toBe('Yaya Yolu')
    expect(formatRouteHud({ ...base, role: 'vehicle' }).roleLabel).toBe('Araç Koridoru')
    expect(ROUTE_ROLE_LABELS.vehicle).toBe('Araç Koridoru')
  })

  test('vurgu rengi taslak boyasıyla aynı', () => {
    // `tool.tsx` köşe imlerini ve `preview.tsx` hayalet boyayı bu iki renkle
    // çiziyor. Okumanın başka bir renk göstermesi, iki farklı şey çizildiğini
    // söyler.
    expect(formatRouteHud({ ...base, role: 'pedestrian' }).accent).toBe('#2f9e58')
    expect(formatRouteHud({ ...base, role: 'vehicle' }).accent).toBe('#f2c31d')
    expect(ROUTE_ROLE_COLORS.pedestrian).toBe('#2f9e58')
  })
})
