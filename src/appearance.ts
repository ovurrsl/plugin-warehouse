'use client'

import {
  type ColorPreset,
  type RenderShading,
  resolveSurfaceColor,
  useViewer,
} from '@pascal-app/viewer'
import { useMemo } from 'react'
import * as THREE from 'three'

/**
 * Display ayarlarının bu paketteki karşılığı.
 *
 * ## Neden gerekli
 *
 * Host'un Display menüsündeki üç satır — Render, Textures, Theme — nesnelerin
 * MATERYALİNİ değiştirerek çalışıyor. Built-in kind'lar bunu tek tek yapıyor:
 * `packages/nodes/src/item/renderer.tsx` mağazadan `shading` ve `textures`
 * okuyup materyali ona göre kuruyor, dokular kapalıyken tema renginde düz bir
 * yüzeye çöküyor.
 *
 * Bu paket hiçbirini okumuyordu. Materyaller modül düzeyinde tek örnekti ve bir
 * kez kurulup öyle kalıyordu — yani kullanıcı Render'ı Solid'e aldığında bütün
 * bina düzleşirken depo ekipmanı PBR kalıyor, Textures'ı kapattığında host
 * mobilyası kile dönerken paletler EPAL damgalarını göstermeye devam ediyordu.
 * Aynı sahnede iki farklı kurala uyan nesneler: kullanıcının "kafasına göre"
 * dediği şeyin öteki yarısı.
 *
 * ## Politika
 *
 * Host'un `createDefaultMaterial` (solid ⇄ rendered) ve item renderer'ının
 * (textures) yaptığının aynısı, tek yerde:
 *
 * | ayar                    | sonuç                                            |
 * |-------------------------|--------------------------------------------------|
 * | rendered + dokular açık | bugünkü PBR materyali, hiç değişmeden             |
 * | solid + dokular açık    | Lambert: harita ve vertex renkleri kalır, PBR gider |
 * | dokular kapalı          | Lambert: tema renginde düz yüzey, harita yok      |
 *
 * `MeshLambertMaterial` bir vekil değil, host'un solid modda ürettiğinin ta
 * kendisi: three'nin `StandardNodeLibrary`'si onu `MeshLambertNodeMaterial`'e
 * çeviriyor (`three/build/three.webgpu.js`, `addMaterial( MeshLambertNodeMaterial,
 * 'MeshLambertMaterial' )`) — bu paketin `MeshStandardMaterial`'i için zaten
 * işleyen dönüşümün aynısı. Bu yüzden `three/webgpu` import'una gerek yok ve
 * `src/index.ts`'in SSR yüzeyi büyümüyor.
 *
 * ## Dokular kapalıyken neyi KAYBEDİYORUZ, ve neden kabul
 *
 * Vertex renkleri de düşüyor. Rafın mavi ayakları ile turuncu kirişleri o
 * attribute'ta; tutulsalardı "monokrom" modu monokrom olmazdı ve host'un
 * mobilyası tek renge çökerken depo ekipmanı alacalı kalırdı. Paletin aynı
 * attribute'ta taşıdığı pişmiş gölgelenme de gidiyor — düz renk modunda zaten
 * ölçülemez.
 *
 * Filmin alfası da o attribute'ta (dört bileşen), yani dokular kapalıyken
 * eteğin incelen kenarı düz bir saydamlığa dönüyor. Harmanlama alanları
 * korunuyor: film her modda saydam kalıyor, yoksa sarılı paletin yükü opak
 * kilin altında kaybolurdu.
 */
export type Appearance = {
  shading: RenderShading
  textures: boolean
  colorPreset: ColorPreset
}

/**
 * Bu paketin her kind'ının host'a bildirdiği rol.
 *
 * On yedi tanımın hepsinde `surfaceRole: 'furnishing'` yazıyor — depo ekipmanı
 * yapı değil, içine konan şey. Host bu alanı kendiliğinden yalnız `def.geometry`
 * ile kurulan kind'lara uyguluyor; bu paket `def.renderer` kullandığı için
 * (kolektif instancing'in tamamı ona bağlı) rolü kendi uygulamak zorunda. Burada
 * sabit yazılması o yüzden bir tekrar değil: bildirilen rolü dürüst kılan şey.
 */
const SURFACE_ROLE = 'furnishing' as const

/** Ayarların önbellek ve havuz anahtarına giren kimliği. */
export function appearanceKey(appearance: Appearance): string {
  // Dokular kapalıyken gölgeleme modu materyali DEĞİŞTİRMİYOR (iki hâl de aynı
  // düz Lambert), o yüzden anahtara da girmiyor: girseydi havuzu ikiye bölüp
  // aynı materyalden iki kopya çizdirirdi.
  return appearance.textures ? `t:${appearance.shading}` : `f:${appearance.colorPreset}`
}

/**
 * Display ayarlarını okur.
 *
 * Üç ayrı seçici, çünkü üçü de ilkel değer döndürüyor: zustand referansla
 * karşılaştırdığı için tek bir nesne döndüren seçici her yazışta yeni kimlik
 * üretir ve abone olan her düğümü boşuna yeniden render ederdi.
 */
export function useAppearance(): Appearance {
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset = useViewer((s) => s.colorPreset)
  return useMemo(() => ({ shading, textures, colorPreset }), [shading, textures, colorPreset])
}

/**
 * Bir yüzeyin ayardan bağımsız tarifi.
 *
 * `physical` alanları YALNIZ `rendered`'da uygulanıyor — Lambert'te pürüzlülük
 * ve metaliklik diye bir şey yok, ve olmayan bir alanı taklit etmeye çalışmak
 * (parlaklığı renge katmak gibi) modun anlamını bozardı. Kayıp bilerek kayıt
 * altında: solid mod, host'un kendi metallerine de aynısını yapıyor.
 */
export type SurfaceSpec = {
  /** Önbellek kimliği — aileyi ayırt eder, ayarları değil. */
  family: string
  map?: THREE.Texture | null
  vertexColors?: boolean
  side?: THREE.Side
  /**
   * Düz renk — vertex rengi taşımayan yüzeyler için (rota şeritleri, uzak
   * katman paleti). Dokular KAPALIYKEN uygulanmıyor: o modun tamamı zaten
   * tema rengine çökmek demek.
   */
  color?: THREE.ColorRepresentation
  /** Harmanlama alanları: her modda korunur. */
  transparent?: boolean
  opacity?: number
  depthWrite?: boolean
  /**
   * Derinlik önyargısı: her modda korunur, ve korunması ŞART.
   *
   * Zemine boyanmış bir rota slab ile eş düzlemde duruyor; offset düşerse
   * z-savaşı başlar. Gölgeleme modunun bununla hiçbir ilgisi yok, o yüzden
   * `physical` alanlarının yanına değil harmanlamanın yanına yazılı.
   */
  polygonOffset?: boolean
  polygonOffsetFactor?: number
  polygonOffsetUnits?: number
  /** Yalnız `rendered`: Lambert bunları taşımıyor. */
  roughness?: number
  metalness?: number
  roughnessMap?: THREE.Texture | null
  metalnessMap?: THREE.Texture | null
}

/**
 * Materyaller AİLE × AYAR başına tek örnek.
 *
 * Düğüm başına değil: paketin bütün performans hikâyesi paylaşılan materyalde
 * (bkz. `rack/materials.ts`). İki gölgeleme modu ve dört renk ön ayarıyla bir
 * ailenin tavanı altı örnek — sahnedeki düğüm sayısından bağımsız.
 */
const cache = new Map<string, THREE.Material>()

/** Gölgeleme modundan bağımsız alanlar — üç dalın hepsine giriyor. */
function invariantOf(spec: SurfaceSpec) {
  return {
    ...(spec.transparent === undefined ? {} : { transparent: spec.transparent }),
    ...(spec.opacity === undefined ? {} : { opacity: spec.opacity }),
    ...(spec.depthWrite === undefined ? {} : { depthWrite: spec.depthWrite }),
    ...(spec.side === undefined ? {} : { side: spec.side }),
    ...(spec.polygonOffset === undefined ? {} : { polygonOffset: spec.polygonOffset }),
    ...(spec.polygonOffsetFactor === undefined
      ? {}
      : { polygonOffsetFactor: spec.polygonOffsetFactor }),
    ...(spec.polygonOffsetUnits === undefined
      ? {}
      : { polygonOffsetUnits: spec.polygonOffsetUnits }),
  }
}

function build(spec: SurfaceSpec, appearance: Appearance): THREE.Material {
  if (!appearance.textures) {
    // Host'un item renderer'ının yaptığının aynısı: rolün tema renginde düz bir
    // yüzey. Rengi `resolveSurfaceColor`'dan almak, paletin host'unkinden
    // ayrışmasını imkânsız kılıyor — burada bir kopyasını tutmak, bir gün
    // sessizce farklı bir kile dönmek demekti.
    return new THREE.MeshLambertMaterial({
      color: resolveSurfaceColor(SURFACE_ROLE, appearance.colorPreset),
      ...invariantOf(spec),
    })
  }

  const common = {
    ...(spec.map ? { map: spec.map } : {}),
    ...(spec.vertexColors === undefined ? {} : { vertexColors: spec.vertexColors }),
    ...(spec.color === undefined ? {} : { color: spec.color }),
    ...invariantOf(spec),
  }

  if (appearance.shading === 'solid') return new THREE.MeshLambertMaterial(common)

  return new THREE.MeshStandardMaterial({
    ...common,
    ...(spec.roughness === undefined ? {} : { roughness: spec.roughness }),
    ...(spec.metalness === undefined ? {} : { metalness: spec.metalness }),
    ...(spec.roughnessMap ? { roughnessMap: spec.roughnessMap } : {}),
    ...(spec.metalnessMap ? { metalnessMap: spec.metalnessMap } : {}),
  })
}

/** Bir yüzeyin şu anki ayarlardaki materyali. */
export function surfaceMaterial(spec: SurfaceSpec, appearance: Appearance): THREE.Material {
  const key = `${spec.family}|${appearanceKey(appearance)}`
  const hit = cache.get(key)
  if (hit) return hit
  const material = build(spec, appearance)
  cache.set(key, material)
  return material
}

/** Yerleştirme hayaletinin şeffaflığı. */
const PREVIEW_OPACITY = 0.55

/**
 * Aynı yüzeyin hayalet hâli.
 *
 * Gerçek materyalin mutasyonu DEĞİL, ayrı bir örnek — paketin her materyal
 * dosyasının kendi başına yazdığı kural: modül tekilinin üstüne `transparent`
 * yazmak sahnedeki her rafı saydamlaştırırdı. Klonlamak yerine yeniden
 * kuruluyor, çünkü dokular kapalıyken kaynak materyal host'un önbelleğinden
 * gelebiliyor ve onun bir klonuna yazmak host'un kendi nesnesini zehirlerdi.
 */
export function previewMaterial(spec: SurfaceSpec, appearance: Appearance): THREE.Material {
  const key = `${spec.family}|${appearanceKey(appearance)}|preview`
  const hit = cache.get(key)
  if (hit) return hit
  const material = build(
    { ...spec, transparent: true, opacity: PREVIEW_OPACITY, depthWrite: false },
    appearance,
  )
  cache.set(key, material)
  return material
}

/** Test kancası — önbelleğin gerçekten aile × ayar başına tek örnek tuttuğunun
 *  tek kanıtı. */
export function surfaceMaterialCacheSize(): number {
  return cache.size
}

export function resetSurfaceMaterials(): void {
  cache.clear()
}
