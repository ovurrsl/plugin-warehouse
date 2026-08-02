'use client'

import { SegmentedControl, SliderControl } from '@pascal-app/editor'
import type { CSSProperties } from 'react'
import { Caption, Field, Note } from '../panels/kit'
import type { PalletRackNode } from './schema'
import {
  autoPalletSupportBars,
  autoPalletsPerLevel,
  autoPickingBoxesAcross,
  autoPickingBoxesDeep,
  fittedLevelCount,
  type LevelType,
  levelClearOpening,
  levelTypeOf,
  nextLevelTypes,
} from './slots'

/**
 * The fields that mean "work it out unless I say otherwise".
 *
 * Four of the rack's settings are `number | null`, where **null is the whole
 * point**: null means the value is derived from the geometry, so a bay widened
 * from 2.7 m to 3.5 m starts holding four pallets instead of three without
 * anyone editing a second field.
 *
 * The host's plain number field cannot express that — `parametric-inspector.tsx`
 * renders a number as `typeof value === 'number' ? value : 0`, so a null shows
 * as 0, clamped by the slider to its minimum, and the first drag writes a real
 * number over the null: a value that tracked the geometry is silently frozen.
 *
 * These used to live in the plugin's own trailing section on the stated grounds
 * that `ParamField` had no kind for a nullable number. That was simply wrong —
 * `kind: 'custom'` exists, the host subscribes the node and passes `onUpdate`,
 * and first-party kinds already use it for exactly this. Being wrong about it
 * cost more than the duplicated markup: a field in the trailing section is
 * exempt from `parametrics.test.ts`'s coverage assertions, so all four sat
 * outside the one test that checks every schema field is reachable.
 */

const MUTED = 'var(--muted-foreground)'
const WARN = '#f59e0b'

const styles = {
  levelRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
    padding: '0 0.5rem',
  },
  levelName: { flex: '0 0 3.25rem', fontSize: '0.6875rem', color: MUTED },
  levelInput: {
    flex: '0 0 3.5rem',
    minWidth: 0,
    borderRadius: '0.375rem',
    border: '1px solid color-mix(in oklab, var(--border) 50%, transparent)',
    background: '#2C2C2E',
    padding: '0.1875rem 0.375rem',
    fontSize: '0.6875rem',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'right',
    color: 'var(--foreground)',
  },
  levelUnit: { fontSize: '0.625rem', color: MUTED },
} satisfies Record<string, CSSProperties>

/** Auto plus the counts around the derived one, so the choice is a short list
 *  rather than a slider whose useful range is three values wide. */
function optionsAround(auto: number, min: number, max: number): string[] {
  const wanted = [auto - 1, auto, auto + 1, auto + 2]
  const seen = new Set<number>()
  for (const value of wanted) {
    if (value >= min && value <= max) seen.add(value)
  }
  return [...seen].sort((a, b) => a - b).map(String)
}

function AutoField({
  auto,
  label,
  max,
  min,
  onChange,
  value,
}: {
  auto: number
  label: string
  max: number
  min: number
  onChange: (next: number | null) => void
  value: number | null
}) {
  return (
    <Field hint={value === null ? `auto — ${auto}` : 'elle'} label={label}>
      <SegmentedControl
        onChange={(next: string) => onChange(next === 'auto' ? null : Number(next))}
        options={[
          { label: 'Auto', value: 'auto' },
          ...optionsAround(auto, min, max).map((option) => ({ label: option, value: option })),
        ]}
        value={value === null ? 'auto' : String(value)}
      />
    </Field>
  )
}

/**
 * One component per field, each matching the host's custom-field contract:
 * `{ node, onUpdate }`, rendered inside the group it belongs to.
 *
 * The bounds are passed as literals here and asserted against the schema in
 * `parametrics.test.ts` — they used to match by inspection only, which is the
 * kind of agreement that holds until someone widens a schema range.
 */
type CustomField = { node: PalletRackNode; onUpdate: (patch: Partial<PalletRackNode>) => void }

export const PALLETS_PER_LEVEL_BOUNDS = { min: 1, max: 12 } as const
export const SUPPORT_BARS_BOUNDS = { min: 0, max: 3 } as const
export const BOXES_ACROSS_BOUNDS = { min: 1, max: 30 } as const
export const BOXES_DEEP_BOUNDS = { min: 1, max: 10 } as const

/** Kat açıklığı varsayılanlarının şema sınırları — `LevelsField` bunları
 *  gösteriyor, `parametrics.test.ts` şemayla karşılaştırıyor. */
export const FIRST_LEVEL_CLEAR_BOUNDS = { min: 0.2, max: 6, step: 0.05 } as const
export const LEVEL_CLEAR_BOUNDS = { min: 0.2, max: 6, step: 0.05 } as const
export const PICKING_LEVEL_CLEAR_BOUNDS = { min: 0.15, max: 3, step: 0.05 } as const

export function PalletsPerLevelField({ node, onUpdate }: CustomField) {
  return (
    <AutoField
      auto={autoPalletsPerLevel(node)}
      label="Pallets per level"
      max={PALLETS_PER_LEVEL_BOUNDS.max}
      min={PALLETS_PER_LEVEL_BOUNDS.min}
      onChange={(palletsPerLevel) => onUpdate({ palletsPerLevel })}
      value={node.palletsPerLevel}
    />
  )
}

export function PalletSupportBarsField({ node, onUpdate }: CustomField) {
  return (
    <AutoField
      auto={autoPalletSupportBars(node)}
      label="Pallet support bars"
      max={SUPPORT_BARS_BOUNDS.max}
      min={SUPPORT_BARS_BOUNDS.min}
      onChange={(palletSupportBars) => onUpdate({ palletSupportBars })}
      value={node.palletSupportBars}
    />
  )
}

export function PickingBoxesAcrossField({ node, onUpdate }: CustomField) {
  return (
    <AutoField
      auto={autoPickingBoxesAcross(node)}
      label="Boxes across"
      max={BOXES_ACROSS_BOUNDS.max}
      min={BOXES_ACROSS_BOUNDS.min}
      onChange={(pickingBoxesAcross) => onUpdate({ pickingBoxesAcross })}
      value={node.pickingBoxesAcross}
    />
  )
}

export function PickingBoxesDeepField({ node, onUpdate }: CustomField) {
  return (
    <AutoField
      auto={autoPickingBoxesDeep(node)}
      label="Boxes deep"
      max={BOXES_DEEP_BOUNDS.max}
      min={BOXES_DEEP_BOUNDS.min}
      onChange={(pickingBoxesDeep) => onUpdate({ pickingBoxesDeep })}
      value={node.pickingBoxesDeep}
    />
  )
}

/**
 * Katlar — kat açıklığının TEK editörü.
 *
 * ## Neden dört kontrol bire indi
 *
 * Bir katın açıklığı **dört** ayrı yerden geliyordu ve üçü panelde ayrı
 * slider'dı: `levelClears[i]` (buradaki satır) > `pickingLevelClear` (Picking
 * grubunda) > `firstLevelClear` / `levelClear` (Levels grubunda). Aynı sayıyı
 * yöneten kontroller iki ayrı bölüme dağılmıştı ve hangisinin hangisini
 * yendiği yalnız `levelClearOpening`'in gövdesinde yazıyordu.
 *
 * Kullanıcının "içi içe giren ayarlar" dediği şeyin kanonik örneği bu.
 * Çözüm alanları silmek değil — hepsi gerçek ve hepsi gerekli: biri zemin
 * açıklığını, biri üst katları, biri toplama katlarını üretiyor. Çözüm
 * **hepsini tek bileşene toplamak**, öncelik sırasını göstererek: üstte
 * varsayılanlar, altta o varsayılanı yenen kat satırları.
 *
 * ## Üç ölçülmüş hata bu birleştirmeyle düzeldi
 *
 *  1. **Eksik satır.** Liste `fittedLevelCount` kadar satır çiziyordu ama
 *     katlar `0..fitted` (zemin açıklığı + kiriş katları), yani HER ZAMAN
 *     son katın açıklığı düzenlenemiyordu.
 *  2. **Sığmayan kat gizleniyordu.** Açıklığı küçültüp o katı sığdırmak
 *     isteyen kullanıcı bunu yapamıyordu. Artık istenen kat kadar satır var;
 *     sığmayan işaretli ama DÜZENLENEBİLİR.
 *  3. **Kat sayısı düşünce hayalet değer.** Dizi hiç kırpılmıyordu: 5 kattan
 *     2'ye inip tekrar 5'e çıkınca eski geçersiz kılmalar geri geliyordu.
 */
export function LevelsField({ node, onUpdate }: CustomField) {
  // Kullanıcının İSTEDİĞİ kat sayısı — sığan değil. Zemin açıklığı da bir
  // satır, o yüzden `levels + 1`.
  const rows = node.levels + 1
  const fitted = fittedLevelCount(node)
  const clears = node.levelClears ?? []
  const hasPicking = node.pickingLevels > 0 || (node.levelTypes?.includes('picking') ?? false)

  /** Diziyi satır sayısına kırp — hayalet değer kalmasın. */
  const sized = <T,>(source: readonly T[] | null | undefined, fill: (i: number) => T): T[] =>
    Array.from({ length: rows }, (_, i) => source?.[i] ?? fill(i))

  const setClear = (level: number, raw: string) => {
    const next = sized<number | null>(clears, () => null)
    next[level] = raw === '' ? null : Number(raw)
    // Hepsi null'a dönerse alan şemadaki "hiç geçersiz kılma yok" hâline
    // döner — kaydedilmiş sahne, hiç dokunulmamış sahneyle aynı okunur.
    onUpdate({ levelClears: next.every((v) => v == null) ? null : next })
  }

  /**
   * Kat tipi — YALNIZ dokunulan satır, ve türetilmiş desene dönerse dizi silinir.
   *
   * Öncesi diziyi her dokunuşta baştan sona dolduruyordu, iki sonucu vardı:
   * `pickingLevels` bir daha hiçbir şeyi sürmüyordu (açık liste onu her zaman
   * yener), ve şema yorumunun uyardığı şey oluyordu — "elli rafın paylaştığı
   * tek mesh elli mesh olur", çünkü açık `levelTypes` geometri anahtarını
   * benzersizleştiriyor.
   *
   * Artık geri dönüş var: her satırı türetilmiş tipine geri getirmek diziyi
   * `null`'a düşürüyor ve raf tekrar komşularıyla mesh paylaşıyor.
   */
  const setType = (level: number, type: LevelType) => {
    onUpdate({ levelTypes: nextLevelTypes(node, level, type) })
  }

  return (
    <>
      <Caption>Varsayılan açıklıklar</Caption>
      <SliderControl
        label="Zemin"
        max={FIRST_LEVEL_CLEAR_BOUNDS.max}
        min={FIRST_LEVEL_CLEAR_BOUNDS.min}
        onChange={(firstLevelClear) => onUpdate({ firstLevelClear })}
        precision={2}
        step={FIRST_LEVEL_CLEAR_BOUNDS.step}
        unit="m"
        value={node.firstLevelClear}
      />
      {/* Tek kiriş katı varken üstünde aralanacak bir şey yok. Host'un aynı
          alandaki `visibleIf`'i buydu; birleştirme onu da taşıdı. */}
      {node.levels > 1 && (
        <SliderControl
          label="Üst katlar"
          max={LEVEL_CLEAR_BOUNDS.max}
          min={LEVEL_CLEAR_BOUNDS.min}
          onChange={(levelClear) => onUpdate({ levelClear })}
          precision={2}
          step={LEVEL_CLEAR_BOUNDS.step}
          unit="m"
          value={node.levelClear}
        />
      )}
      {hasPicking && (
        <SliderControl
          label="Toplama katı"
          max={PICKING_LEVEL_CLEAR_BOUNDS.max}
          min={PICKING_LEVEL_CLEAR_BOUNDS.min}
          onChange={(pickingLevelClear) => onUpdate({ pickingLevelClear })}
          precision={2}
          step={PICKING_LEVEL_CLEAR_BOUNDS.step}
          unit="m"
          value={node.pickingLevelClear}
        />
      )}

      <Caption hint="boş = varsayılan">Kat başına</Caption>
      {Array.from({ length: rows }, (_, level) => {
        const doesNotFit = level > fitted
        return (
          <div key={level} style={styles.levelRow}>
            <span
              style={doesNotFit ? { ...styles.levelName, color: WARN } : styles.levelName}
              title={doesNotFit ? 'Dikme yüksekliğine sığmıyor — açıklığı küçültün' : undefined}
            >
              {level === 0 ? 'Zemin' : `Kat ${level}`}
              {doesNotFit ? ' ⚠' : ''}
            </span>
            <input
              inputMode="decimal"
              onChange={(event) => setClear(level, event.target.value)}
              placeholder={levelClearOpening({ ...node, levelClears: null }, level).toFixed(2)}
              step={0.05}
              style={styles.levelInput}
              type="number"
              value={clears[level] ?? ''}
            />
            <span style={styles.levelUnit}>m</span>
            {/* Zemin katının TİPİ yok: `levelTypeOf` kiriş katlarını
                adlandırıyor, zemin açıklığı yalnız ilk kirişe kadar boşluk. */}
            {level > 0 && (
              <SegmentedControl
                onChange={(value: string) => setType(level, value as LevelType)}
                options={[
                  { label: 'Palet', value: 'pallet' },
                  { label: 'Toplama', value: 'picking' },
                ]}
                value={levelTypeOf(node, level)}
              />
            )}
          </div>
        )
      })}
      {node.levels > fitted && (
        <Note>
          {node.levels - fitted} kat {node.uprightHeight.toFixed(2)} m dikmeye sığmıyor —
          açıklıkları küçültün ya da dikmeyi yükseltin.
        </Note>
      )}
      {node.levelTypes !== null && (
        <Note>
          Kat tipleri elle yazıldı: bu raf artık komşularıyla mesh paylaşmıyor. Her satırı
          türetilmiş tipine geri almak paylaşımı geri getirir.
        </Note>
      )}
    </>
  )
}
