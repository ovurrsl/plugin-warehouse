import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveSurfaceColor } from '@pascal-app/viewer'
import * as THREE from 'three'
import {
  type Appearance,
  appearanceKey,
  previewMaterial,
  resetSurfaceMaterials,
  selectAppearance,
  surfaceMaterial,
  surfaceMaterialCacheSize,
} from './appearance'

/**
 * Display ayarlarına uyum — ve uyumun YARIM kalmasının neden bir hata olduğu.
 *
 * Kullanıcının bildirdiği şikâyet "nesneler kafasına göre davranıyor"du. Bir
 * ayarı nesnelerin YARISININ dinlemesi, hiçbirinin dinlememesinden daha kötü:
 * hiç dinlemeyen bir eklenti tutarlıdır, yarısı dinleyen bir eklenti aynı
 * sahnede iki farklı kurala uyan nesneler demektir — ve fark hiçbir hata
 * vermeden görünür.
 *
 * Bu yüzden buradaki değerli bekçi tek tek materyalleri değil, KAPSAMI
 * sınıyor: her materyal fabrikası ayarı okumak zorunda, ve kolektif havuza
 * kaydolan her düğüm ayarı havuz anahtarına katmak zorunda.
 */

const SRC = import.meta.dir

const RENDERED: Appearance = { shading: 'rendered', textures: true, colorPreset: 'clay' }
const SOLID: Appearance = { shading: 'solid', textures: true, colorPreset: 'clay' }
const FLAT: Appearance = { shading: 'rendered', textures: false, colorPreset: 'clay' }

const SPEC = {
  family: 'test',
  map: new THREE.Texture(),
  vertexColors: true,
  roughness: 0.55,
  metalness: 0.15,
} as const

describe('gölgeleme modu materyali gerçekten değiştiriyor', () => {
  test('rendered PBR, solid Lambert', () => {
    resetSurfaceMaterials()
    const rendered = surfaceMaterial(SPEC, RENDERED)
    const solid = surfaceMaterial(SPEC, SOLID)

    // Host'un `createDefaultMaterial`'ının yaptığı ayrımın aynısı. Üç, ikisini
    // de kendi node materyaline çeviriyor; buradaki sınıf o dönüşümün girdisi.
    expect(rendered.type).toBe('MeshStandardMaterial')
    expect(solid.type).toBe('MeshLambertMaterial')
    expect(rendered).not.toBe(solid)
  })

  test('solid modda harita ve vertex renkleri KALIR', () => {
    // Düzleşen şey aydınlatma modeli; nesnenin kimliği değil. Haritayı da
    // düşürmek, Solid modu Textures kapalıyla aynı şeye çevirirdi — ki host'ta
    // bunlar iki ayrı anahtar.
    resetSurfaceMaterials()
    const solid = surfaceMaterial(SPEC, SOLID) as THREE.MeshLambertMaterial
    expect(solid.map).toBe(SPEC.map)
    expect(solid.vertexColors).toBe(true)
  })
})

describe('dokular kapalıyken host ile aynı renge çökülüyor', () => {
  test('harita düşer, renk host’un paletinden gelir', () => {
    resetSurfaceMaterials()
    const flat = surfaceMaterial(SPEC, FLAT) as THREE.MeshLambertMaterial
    expect(flat.map).toBeNull()
    // Paletin bir kopyasını tutmak, bir gün sessizce host'unkinden ayrılmak
    // demekti. Renk tek kaynaktan okunuyor ve test de oradan okuyor.
    expect(`#${flat.color.getHexString()}`).toBe(
      resolveSurfaceColor('furnishing', 'clay').toLowerCase(),
    )
  })

  test('renk ön ayarı değişince materyal de değişir', () => {
    resetSurfaceMaterials()
    const clay = surfaceMaterial(SPEC, FLAT)
    const white = surfaceMaterial(SPEC, { ...FLAT, colorPreset: 'white' })
    expect(clay).not.toBe(white)
  })

  test('dokular kapalıyken gölgeleme modu havuzu BÖLMEZ', () => {
    // İki hâl de aynı düz Lambert'i üretiyor. Anahtar yine de ayırsaydı, aynı
    // materyalden iki havuz kurulur ve çizim çağrısı boşuna ikiye katlanırdı.
    expect(appearanceKey(FLAT)).toBe(appearanceKey({ ...FLAT, shading: 'solid' }))
    expect(appearanceKey(RENDERED)).not.toBe(appearanceKey(SOLID))
  })
})

describe('harmanlama ve derinlik alanları HER modda korunuyor', () => {
  test('film her modda saydam kalır', () => {
    // Opaklaşsaydı sarılı paletin yükü kilin altında tamamen kaybolurdu.
    resetSurfaceMaterials()
    const spec = {
      ...SPEC,
      family: 'film-test',
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    }
    for (const appearance of [RENDERED, SOLID, FLAT]) {
      const material = surfaceMaterial(
        { ...spec, family: `film-${appearanceKey(appearance)}` },
        appearance,
      )
      expect({ mode: appearanceKey(appearance), transparent: material.transparent }).toEqual({
        mode: appearanceKey(appearance),
        transparent: true,
      })
      expect(material.depthWrite).toBe(false)
      expect(material.opacity).toBe(0.4)
    }
  })

  test('rota derinlik önyargısı her modda korunur', () => {
    // Düşerse zemine boyanmış rota slab ile z-savaşına girer — gölgeleme
    // modunun bu sorunla hiçbir ilgisi yok.
    resetSurfaceMaterials()
    const spec = {
      family: 'route-test',
      color: 0xf2c31d,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    }
    for (const appearance of [RENDERED, SOLID, FLAT]) {
      const material = surfaceMaterial(
        { ...spec, family: `route-${appearanceKey(appearance)}` },
        appearance,
      )
      expect({ mode: appearanceKey(appearance), offset: material.polygonOffset }).toEqual({
        mode: appearanceKey(appearance),
        offset: true,
      })
      expect(material.polygonOffsetUnits).toBe(-4)
    }
  })
})

describe('yayıcılık: lamba solid modda da yanar', () => {
  /**
   * `emissive` `physical` grubunda DEĞİL, ve bu bir tercih değil olgu:
   * `MeshLambertMaterial` alanı taşıyor
   * (`three/src/materials/MeshLambertMaterial.js:122,130`). Yanlış grupta
   * olsaydı hata sessiz olurdu — kullanıcı Solid'e alır, teleskopiğin
   * çalışma lambası sönerdi ve kimse bunu bir ayarın yan etkisi olarak
   * okumazdı.
   */
  const LENS = {
    family: 'lens-test',
    color: '#fff6d8',
    emissive: '#ffe9a8',
    emissiveIntensity: 1.6,
    roughness: 0.4,
  }

  test('rendered ve solid — ikisinde de yayıcı', () => {
    resetSurfaceMaterials()
    for (const appearance of [RENDERED, SOLID]) {
      const material = surfaceMaterial(
        { ...LENS, family: `lens-${appearanceKey(appearance)}` },
        appearance,
      ) as THREE.MeshStandardMaterial
      expect({
        mode: appearanceKey(appearance),
        emissive: material.emissive?.getHexString(),
        intensity: material.emissiveIntensity,
      }).toEqual({ mode: appearanceKey(appearance), emissive: 'ffe9a8', intensity: 1.6 })
    }
  })

  test('dokular kapalıyken söner — monokrom modun tek iddiası', () => {
    resetSurfaceMaterials()
    const material = surfaceMaterial(LENS, FLAT) as THREE.MeshLambertMaterial
    // Siyah yayıcı = kapalı. Parlayan bir leke, "sahne tek renge indi"
    // iddiasını bozan tam olarak o şey olurdu.
    expect(material.emissive.getHex()).toBe(0x000000)
  })
})

describe('materyal sayısı düğümle DEĞİL ayarla ölçekleniyor', () => {
  test('aynı aile ve aynı ayar bin kez sorulsa tek örnek', () => {
    resetSurfaceMaterials()
    const first = surfaceMaterial(SPEC, RENDERED)
    for (let i = 0; i < 1000; i++) expect(surfaceMaterial(SPEC, RENDERED)).toBe(first)
    expect(surfaceMaterialCacheSize()).toBe(1)
  })

  test('hayalet materyali gerçeğinin MUTASYONU değil', () => {
    // Paketin her materyal dosyasının kendi başına yazdığı kural: modül
    // tekilinin üstüne `transparent` yazmak sahnedeki her rafı saydamlaştırırdı.
    resetSurfaceMaterials()
    const real = surfaceMaterial(SPEC, RENDERED)
    const ghost = previewMaterial(SPEC, RENDERED)
    expect(ghost).not.toBe(real)
    expect(ghost.transparent).toBe(true)
    expect(real.transparent).toBe(false)
  })
})

describe('seçicinin kimliği durum değişmedikçe SABİT', () => {
  /**
   * Bu, tek aboneliğe geçmenin ödediği bedel — ve ödenmezse hata sessiz
   * değil, ölümcül: zustand `useSyncExternalStore` üstünde duruyor ve durum
   * değişmediği hâlde her çağrıda yeni nesne döndüren bir seçici React'e
   * "değişti" dedirtir, ekran sonsuz render döngüsüne girer.
   */
  const state = { colorPreset: 'clay', shading: 'rendered', textures: true } as const

  test('aynı durumun iki okuması AYNI nesneyi verir', () => {
    const first = selectAppearance(state)
    // Store durumu her yazımda yeni nesne; okunan üç alan aynı kaldıysa
    // sonuç yine de aynı referans olmalı.
    expect(selectAppearance({ ...state })).toBe(first)
  })

  test('bir alan değişince YENİ nesne verir', () => {
    const rendered = selectAppearance(state)
    const solid = selectAppearance({ ...state, shading: 'solid' })
    expect(solid).not.toBe(rendered)
    expect(solid.shading).toBe('solid')
    // Eski nesne yerinde değiştirilmiş olsaydı `useMemo` bağımlılıkları
    // kımıldamaz, materyal tazelenmez ve Display düğmesi hiçbir şey yapmazdı.
    expect(rendered.shading).toBe('rendered')
  })

  test('dokular kapanınca da yeni nesne — boolean alan gözden kaçmıyor', () => {
    const on = selectAppearance(state)
    expect(selectAppearance({ ...state, textures: false })).not.toBe(on)
  })
})

// ── Kapsam: hiçbir yüzey ayarın dışında kalamaz ──────────────────────────────

function source(relative: string): string {
  return readFileSync(join(SRC, relative), 'utf8')
}

/** `src/<aile>/materials.ts` dosyalarının tamamı. */
const MATERIAL_FILES = readdirSync(SRC, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `${entry.name}/materials.ts`)
  .filter((relative) => {
    try {
      source(relative)
      return true
    } catch {
      return false
    }
  })

describe('kapsam — her materyal fabrikası ayarı okuyor', () => {
  test('materyal dosyaları bulundu — bekçinin kendini kandırma biçimi', () => {
    expect(MATERIAL_FILES.length).toBeGreaterThan(5)
  })

  for (const file of MATERIAL_FILES) {
    test(`${file} ayarı parametre olarak alıyor`, () => {
      const text = source(file)
      // Dışa açılan her materyal getter'ı bir `Appearance` almalı. Parametresiz
      // kalan biri, o ailenin bütün nesnelerinin ayarı yok saymaya devam etmesi
      // demek — ve fark yalnız gözle görülür.
      const getters = [...text.matchAll(/export function (get\w*Material\w*)\(([^)]*)\)/g)]
      expect(getters.length, `${file}: dışa açılan materyal fabrikası yok`).toBeGreaterThan(0)
      for (const [, name, params] of getters) {
        expect(
          (params ?? '').includes('Appearance'),
          `${file}: ${name} ayarı almıyor — bu ailenin nesneleri Display menüsünü dinlemez`,
        ).toBe(true)
      }
    })
  }
})

describe('kapsam — havuz anahtarı ayarı taşıyor', () => {
  /**
   * Bu, düzeltmenin SESSİZ yarısı.
   *
   * Kolektif havuz girdiyi `keyFor::materialKeyFor` ile anahtarlıyor ve o
   * anahtarı kayıt anında damgalıyor. Materyal ayara göre değişip anahtar sabit
   * kalırsa `use-collective` tazelemeyi hiç tetiklemiyor: havuz eski materyali
   * çizmeye devam ediyor, hata yok, uyarı yok. Kullanıcı düğmeye basıyor ve
   * hiçbir şey olmuyor — sonra kamerayı gezdirince bir raf bandı geçtiği an
   * sahne kendiliğinden güncelleniyormuş gibi görünüyor.
   */
  const RENDERER_FILES = readdirSync(SRC, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const dir = join(SRC, entry.name)
      return readdirSync(dir)
        .filter((name) => name.endsWith('renderer.tsx'))
        .map((name) => `${entry.name}/${name}`)
    })

  test('renderer bulundu', () => {
    expect(RENDERER_FILES.length).toBeGreaterThan(10)
  })

  for (const file of RENDERER_FILES) {
    test(`${file} materialKeyFor ayarı içeriyor`, () => {
      const text = source(file)
      if (!text.includes('materialKeyFor:')) return // kolektife girmeyen kind
      for (const [line] of text.matchAll(/materialKeyFor: [^\n]*/g)) {
        expect(
          line.includes('appearanceKey('),
          `${file}: ${line.trim()} — ayar anahtara girmiyor, havuz eski materyali çizmeye devam eder`,
        ).toBe(true)
      }
    })
  }
})

describe('kapsam — çizen dosyalar kendi ışıklı materyalini KURMUYOR', () => {
  /**
   * Yukarıdaki bekçi yalnız `src/<aile>/materials.ts` dosyalarını tarıyor,
   * ve teleskopik tam o boşluktan kaçtı: materyalini `telescopic-renderer.tsx`
   * ile `telescopic-preview.tsx` içinde modül düzeyinde çıplak
   * `MeshStandardMaterial` olarak kuruyordu, `useAppearance()` hiç
   * okumuyordu. Tarayacak bir `materials.ts` yoktu, dolayısıyla kapsam testi
   * yeşildi ve hiçbir şey söylemedi.
   *
   * Kural: ışıklı materyal (Standard / Lambert / Physical / Phong) yalnız
   * `appearance.ts` kurar. Çizen bir dosya birini kendi kurduysa, o yüzey
   * Display menüsünün dışında kalmış demektir.
   *
   * `MeshBasicMaterial` kapsam DIŞI ve bilerek: gölgelenmeyen bir materyalin
   * `solid` ile `rendered` arasında değişecek alanı yok. Seçim çarpıştırıcısı
   * (`collider.tsx`), rota hayaleti ve teleskopiğin ışık hüzmesi o sınıfta —
   * üçü de yüzey değil, sırasıyla hacim, editör katmanı ve efekt.
   */
  const LIT = /new THREE\.Mesh(Standard|Lambert|Physical|Phong)Material/

  const DRAWING_FILES = readdirSync(SRC, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'instancing')
    .flatMap((entry) => {
      const dir = join(SRC, entry.name)
      return readdirSync(dir)
        .filter((name) => /(renderer|preview|system)\.tsx$/.test(name))
        .map((name) => `${entry.name}/${name}`)
    })

  test('çizen dosya bulundu — bekçinin kendini kandırma biçimi', () => {
    expect(DRAWING_FILES.length).toBeGreaterThan(25)
  })

  test('hiçbiri ışıklı materyal kurmuyor', () => {
    const offenders = DRAWING_FILES.filter((file) => LIT.test(source(file)))
    expect(offenders).toEqual([])
  })
})
