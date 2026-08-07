import { describe, expect, test } from 'bun:test'
import type * as THREE from 'three'
import { ghostLodCount, registerGhostLod, tickGhostLod } from './ghost-lod'

/** Yalnız `position.distanceToSquared` çağrılıyor — gerisi gereksiz. */
function fakeCamera(): THREE.Camera {
  return { position: { distanceToSquared: () => 0 } } as unknown as THREE.Camera
}

describe('ghost-lod kaydı', () => {
  test('sökücü yalnız kendi kaydını siler — StrictMode çift mount', () => {
    /**
     * Görünmez hata bu: StrictMode mount→unmount→mount koşturur ve İLK
     * kaydın geç kalan temizliği İKİNCİ (yaşayan) kaydı silerse, hayalet
     * o andan sonra hiç değerlendirilmez — katmanı sonsuza dek donar ve
     * hiçbir şey hata vermez.
     */
    const before = ghostLodCount()
    const first = registerGhostLod('strict-mode-rack', () => {})
    const second = registerGhostLod('strict-mode-rack', () => {})
    first() // geç kalan temizlik — yaşayan kaydı DÜŞÜRMEMELİ
    expect(ghostLodCount()).toBe(before + 1)
    second()
    expect(ghostLodCount()).toBe(before)
  })

  test('kayıtlı girdi faz aralığı içinde mutlaka değerlendirilir', () => {
    /**
     * Faz kayması yüzünden bir girdinin dilimi HİÇ gelmezse hayalet katmanı
     * kamera ne yaparsa yapsın sabit kalır — sessiz, görsel bir donma.
     * 8 karelik tam bir tur her kayıtlı girdiye en az bir değerlendirme
     * garanti etmeli.
     */
    let calls = 0
    const off = registerGhostLod('phase-coverage-rack', () => {
      calls += 1
    })
    const camera = fakeCamera()
    for (let i = 0; i < 8; i++) tickGhostLod(camera)
    off()
    expect(calls).toBe(1)
  })

  test('söküm sonrası tick değerlendirme çağırmaz', () => {
    let calls = 0
    const off = registerGhostLod('unmounted-rack', () => {
      calls += 1
    })
    off()
    const camera = fakeCamera()
    for (let i = 0; i < 16; i++) tickGhostLod(camera)
    expect(calls).toBe(0)
  })
})
