'use client'

import { ActionButton, ActionGroup, SegmentedControl, SliderControl } from '@pascal-app/editor'
import type { CSSProperties } from 'react'
import { Caption, Note, SelectRow } from '../panels/kit'
import {
  FLOOR_TYPES,
  LOAD_CLASSES,
  NEW_SAFETY_ZONE_WIDTH_M,
  RAILING_RULES,
  STAIRCASE_STEP_COUNTS,
} from './catalog'
import { emptyAccessories, type MezzanineNode, type MezzanineTier } from './schema'

/**
 * `grid` ve `tiers` — iç içe nesne / dizi-of-nesne, jenerik field kind'ları
 * (`number`/`enum`/`vec3`) bunu ifade edemez. Rack'ın `LevelClearsField`
 * deseni: `kind: 'custom'`, host düğümü abone eder ve `onUpdate` geçer —
 * `trailingSection`'ın aksine bu alanlar `parametrics.test.ts`'in kapsama
 * denetiminde GÖRÜNÜR kalır.
 *
 * ## Yedi erişilemez alan
 *
 * Denetim, iç içe şemanın panelden hiç ulaşılamayan yedi alanını çıkardı:
 * merdivenin `widthM`/`landing`/`railings`'i, üç kapı/bölge türünün
 * `widthM`'i, ve `tier.elevationM`. Hepsi şemada tanımlı, hepsi geometriyi
 * sürüyor, hiçbirinin kontrolü yoktu — yani `+ Stair`'in yazdığı 1 m'lik
 * genişlik ve `turn180` sahanlık, kullanıcının asla değiştiremeyeceği gizli
 * varsayılanlardı.
 *
 * Bekçi test bunları GÖREMİYORDU: `Object.keys(parsed)` yalnız üst seviye
 * anahtarları geziyor, `tiers` bir kez CUSTOM muafiyeti alınca içindeki her
 * şey denetim dışı kalıyordu. Test artık özyinelemeli.
 */

const MUTED = 'var(--muted-foreground)'
const BORDER_50 = 'color-mix(in oklab, var(--border) 50%, transparent)'

const styles = {
  row: { display: 'flex', alignItems: 'center', gap: '0.375rem' },
  input: {
    flex: 1,
    minWidth: 0,
    padding: '0.25rem 0.5rem',
    borderRadius: '0.375rem',
    border: `1px solid ${BORDER_50}`,
    background: '#2C2C2E',
    color: 'var(--foreground)',
    fontSize: '0.75rem',
    fontVariantNumeric: 'tabular-nums',
  },
  select: {
    flex: 1,
    minWidth: 0,
    padding: '0.25rem 0.5rem',
    borderRadius: '0.375rem',
    border: `1px solid ${BORDER_50}`,
    background: '#2C2C2E',
    color: 'var(--foreground)',
    fontSize: '0.75rem',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    borderRadius: '0.5rem',
    border: `1px solid ${BORDER_50}`,
    padding: '0.5rem',
  },
  tag: { flex: '0 0 3rem', fontSize: '0.625rem', color: MUTED },
  unit: { fontSize: '0.625rem', color: MUTED },
  /** Küçük ikon düğmesi — `ActionButton` h-9 ile bir aksesuar satırını iki
   *  katına çıkarırdı; silme/çevirme burada satırın parçası. */
  chip: {
    flex: '0 0 auto',
    padding: '0.1875rem 0.4375rem',
    borderRadius: '0.375rem',
    border: `1px solid ${BORDER_50}`,
    background: '#2C2C2E',
    color: 'var(--foreground)',
    fontSize: '0.6875rem',
    lineHeight: 1,
    cursor: 'pointer',
  },
} satisfies Record<string, CSSProperties>

type CustomField = { node: MezzanineNode; onUpdate: (patch: Partial<MezzanineNode>) => void }

export function GridField({ node, onUpdate }: CustomField) {
  const { grid } = node
  const set = (patch: Partial<typeof grid>) => onUpdate({ grid: { ...grid, ...patch } })
  return (
    <>
      <Caption>Grid</Caption>
      <SliderControl
        label="Bays X"
        max={40}
        min={1}
        onChange={(baysX) => set({ baysX: Math.max(1, Math.round(baysX)) })}
        precision={0}
        step={1}
        value={grid.baysX}
      />
      <SliderControl
        label="Bays Z"
        max={40}
        min={1}
        onChange={(baysY) => set({ baysY: Math.max(1, Math.round(baysY)) })}
        precision={0}
        step={1}
        value={grid.baysY}
      />
      <SliderControl
        label="Bay width"
        max={12}
        min={2}
        onChange={(bayWidthM) => set({ bayWidthM })}
        precision={2}
        step={0.1}
        unit="m"
        value={grid.bayWidthM}
      />
      <SliderControl
        label="Bay depth"
        max={12}
        min={2}
        onChange={(bayDepthM) => set({ bayDepthM })}
        precision={2}
        step={0.1}
        unit="m"
        value={grid.bayDepthM}
      />
    </>
  )
}

const FLOOR_TYPE_IDS = Object.keys(FLOOR_TYPES) as Array<MezzanineTier['floorType']>

const EDGE_IDS = ['north', 'south', 'east', 'west'] as const
type EdgeId = (typeof EDGE_IDS)[number]

/**
 * Bir tier'in aksesuarları: merdiven, kapılar, güvenlik bölgeleri.
 *
 * Korkuluk BURADA YOK ve olmamalı — açık çevrede zorunludur (katalog), yani
 * bir alan değil bir kural; `railing.ts` onu bu listelerden türetiyor. Bir
 * "korkuluk ekle" düğmesi, kullanıcıya kapatılabilir sanılan bir güvenlik
 * donanımı sunardı. Merdivenin `railings` sayısı bundan ayrı bir şey: kolun
 * kaç yanının korkuluklu olduğu, ve katalog 1 ya da 2 diyor — 0 yok.
 */
function AccessoryEditor({
  accessories,
  onChange,
  tierIndex,
}: {
  accessories: MezzanineTier['accessories']
  onChange: (next: MezzanineTier['accessories']) => void
  tierIndex: number
}) {
  const patch = (part: Partial<MezzanineTier['accessories']>) =>
    onChange({ ...accessories, ...part })

  const edgeSelect = (value: EdgeId, onPick: (edge: EdgeId) => void) => (
    <select
      onChange={(e) => onPick(e.target.value as EdgeId)}
      style={{ ...styles.select, flex: '0 0 5rem' }}
      value={value}
    >
      {EDGE_IDS.map((edge) => (
        <option key={edge} value={edge}>
          {edge}
        </option>
      ))}
    </select>
  )

  const offsetInput = (value: number, onSet: (offsetM: number) => void) => (
    <input
      onChange={(e) => onSet(Number(e.target.value))}
      step={0.5}
      style={styles.input}
      type="number"
      value={value}
    />
  )

  /** Serbest yerleşimin x / z / dönüş alanları — adım çağırana ait. */
  const numberInput = (value: number, onSet: (next: number) => void, step = 0.5) => (
    <input
      onChange={(e) => onSet(Number(e.target.value))}
      step={step}
      style={styles.input}
      type="number"
      value={value}
    />
  )

  /**
   * Basamak sayısı — `'auto'` ya da katalogun hazır serisi.
   *
   * Seçim doğrulamayı ATLAMAZ: kot farkı tutmuyorsa `resolveSteps`
   * `step-count-mismatch` üretir ve panel söyler. "Katalog satırı kutsal ama
   * fizik daha kutsal" ayrımı — sayı reddedilmiyor, uyarılıyor.
   */
  const stepsSelect = (value: 'auto' | number, onPick: (next: 'auto' | number) => void) => (
    <select
      onChange={(event) =>
        onPick(event.target.value === 'auto' ? 'auto' : Number(event.target.value))
      }
      style={styles.select}
      value={String(value)}
    >
      <option value="auto">auto basamak</option>
      {STAIRCASE_STEP_COUNTS.map((count) => (
        <option key={count} value={count}>
          {count} basamak
        </option>
      ))}
    </select>
  )

  const remove = (chip: () => void) => (
    <button onClick={chip} style={styles.chip} type="button">
      ×
    </button>
  )

  return (
    <>
      <Caption>Aksesuarlar</Caption>

      {accessories.staircases.map((stair, i) => {
        const editStair = (part: Partial<(typeof accessories.staircases)[number]>) =>
          patch({
            staircases: accessories.staircases.map((s, j) => (j === i ? { ...s, ...part } : s)),
          })
        return (
          <div key={stair.id} style={styles.card}>
            <div style={styles.row}>
              <span style={styles.tag}>merdiven</span>
              {stair.placement.mode === 'edge' ? (
                <>
                  {edgeSelect(stair.placement.edge, (edge) =>
                    editStair({
                      placement:
                        stair.placement.mode === 'edge'
                          ? { ...stair.placement, edge }
                          : stair.placement,
                    }),
                  )}
                  {offsetInput(stair.placement.offsetM, (offsetM) =>
                    editStair({
                      placement:
                        stair.placement.mode === 'edge'
                          ? { ...stair.placement, offsetM }
                          : stair.placement,
                    }),
                  )}
                </>
              ) : (
                <>
                  {numberInput(stair.placement.xM, (xM) =>
                    editStair({
                      placement:
                        stair.placement.mode === 'xz'
                          ? { ...stair.placement, xM }
                          : stair.placement,
                    }),
                  )}
                  {numberInput(stair.placement.zM, (zM) =>
                    editStair({
                      placement:
                        stair.placement.mode === 'xz'
                          ? { ...stair.placement, zM }
                          : stair.placement,
                    }),
                  )}
                  {numberInput(
                    stair.placement.rotationDeg,
                    (rotationDeg) =>
                      editStair({
                        placement:
                          stair.placement.mode === 'xz'
                            ? { ...stair.placement, rotationDeg }
                            : stair.placement,
                      }),
                    15,
                  )}
                </>
              )}
              {/**
               * Kenar ↔ serbest geçişi.
               *
               * Şema ve `stairOrigin` serbest yerleşimi (`mode: 'xz'`, dönüşle)
               * BAŞINDAN BERİ destekliyordu; eksik olan yalnız buraya bir
               * düğmeydi, yani merdiven "istenen yere" konamıyordu çünkü UI
               * sormuyordu.
               */}
              <button
                onClick={() =>
                  editStair({
                    placement:
                      stair.placement.mode === 'edge'
                        ? { mode: 'xz' as const, xM: 0, zM: 0, rotationDeg: 0 }
                        : { mode: 'edge' as const, edge: 'west' as const, offsetM: 2 },
                  })
                }
                style={styles.chip}
                title={stair.placement.mode === 'edge' ? 'Serbest konuma geç' : 'Kenara sabitle'}
                type="button"
              >
                {stair.placement.mode === 'edge' ? '⤢' : '⊞'}
              </button>
              {remove(() =>
                patch({ staircases: accessories.staircases.filter((_, j) => j !== i) }),
              )}
            </div>
            {/* EN ISO 14122-3'ün iki alanı ve katalogun sahanlığı — üçü de
                şemada vardı, üçünün de kontrolü yoktu. */}
            <SegmentedControl
              onChange={(value: string) => editStair({ widthM: Number(value) as 0.8 | 1 })}
              options={[
                { label: '800 tek', value: '0.8' },
                { label: '1000 çok', value: '1' },
              ]}
              value={String(stair.widthM)}
            />
            <div style={styles.row}>
              <select
                onChange={(e) =>
                  editStair({ landing: e.target.value as (typeof stair)['landing'] })
                }
                style={styles.select}
                value={stair.landing}
              >
                <option value="continuous">düz kol</option>
                <option value="turn90">90° sahanlık</option>
                <option value="turn180">180° sahanlık</option>
              </select>
              <select
                onChange={(e) => editStair({ railings: Number(e.target.value) as 1 | 2 })}
                style={{ ...styles.select, flex: '0 0 6rem' }}
                value={stair.railings}
              >
                <option value={1}>1 korkuluk</option>
                <option value={2}>2 korkuluk</option>
              </select>
            </div>
            {stepsSelect(stair.steps, (steps) => editStair({ steps }))}
          </div>
        )
      })}

      {accessories.swingGates.map((gate, i) => {
        const editGate = (part: Partial<(typeof accessories.swingGates)[number]>) =>
          patch({
            swingGates: accessories.swingGates.map((g, j) => (j === i ? { ...g, ...part } : g)),
          })
        return (
          <div key={`swing-${gate.edge}-${gate.offsetM}`} style={styles.card}>
            <div style={styles.row}>
              <span style={styles.tag}>kapı</span>
              {edgeSelect(gate.edge, (edge) => editGate({ edge }))}
              {offsetInput(gate.offsetM, (offsetM) => editGate({ offsetM }))}
              {remove(() =>
                patch({ swingGates: accessories.swingGates.filter((_, j) => j !== i) }),
              )}
            </div>
            <SegmentedControl
              onChange={(value: string) => editGate({ widthM: Number(value) as 0.75 | 1.5 })}
              options={[
                { label: '750 tek', value: '0.75' },
                { label: '1500 çift', value: '1.5' },
              ]}
              value={String(gate.widthM)}
            />
          </div>
        )
      })}

      {accessories.upAndOverGates.map((gate, i) => {
        const editGate = (part: Partial<(typeof accessories.upAndOverGates)[number]>) =>
          patch({
            upAndOverGates: accessories.upAndOverGates.map((g, j) =>
              j === i ? { ...g, ...part } : g,
            ),
          })
        return (
          <div key={`upover-${gate.edge}-${gate.offsetM}`} style={styles.card}>
            <div style={styles.row}>
              <span style={styles.tag}>palet</span>
              {edgeSelect(gate.edge, (edge) => editGate({ edge }))}
              {offsetInput(gate.offsetM, (offsetM) => editGate({ offsetM }))}
              {remove(() =>
                patch({
                  upAndOverGates: accessories.upAndOverGates.filter((_, j) => j !== i),
                }),
              )}
            </div>
            <SliderControl
              label="Genişlik"
              max={3}
              min={1}
              onChange={(widthM) => editGate({ widthM })}
              precision={2}
              step={0.05}
              unit="m"
              value={gate.widthM}
            />
          </div>
        )
      })}

      {accessories.safetyZones.map((zone, i) => {
        const editZone = (part: Partial<(typeof accessories.safetyZones)[number]>) =>
          patch({
            safetyZones: accessories.safetyZones.map((z, j) => (j === i ? { ...z, ...part } : z)),
          })
        return (
          <div key={`zone-${zone.edge}-${zone.offsetM}`} style={styles.card}>
            <div style={styles.row}>
              <span style={styles.tag}>bölge</span>
              {edgeSelect(zone.edge, (edge) => editZone({ edge }))}
              {offsetInput(zone.offsetM, (offsetM) => editZone({ offsetM }))}
              {remove(() =>
                patch({ safetyZones: accessories.safetyZones.filter((_, j) => j !== i) }),
              )}
            </div>
            {/* Kontrolü olmayan bu alan, düzeltilemez bir uyarının kaynağıydı:
                düğme 1.5 m yazıyor, invariant 1.2 m'yi aşanı uyarıyordu ve
                genişliği değiştirmenin yolu yoktu. */}
            <SliderControl
              label="Genişlik"
              max={4}
              min={0.5}
              onChange={(widthM) => editZone({ widthM })}
              precision={2}
              step={0.05}
              unit="m"
              value={zone.widthM}
            />
            {zone.widthM > RAILING_RULES.openingProtectionM && (
              <Note>
                {RAILING_RULES.openingProtectionM.toFixed(1)} m üstünde zincir yetmez — düşme
                koruması gerekir.
              </Note>
            )}
          </div>
        )
      })}

      <ActionGroup>
        <ActionButton
          label="+ Merdiven"
          onClick={() =>
            patch({
              staircases: [
                ...accessories.staircases,
                {
                  // Tier indeksi kimliğe girer: iki tier'in merdivenleri
                  // aynı id'yi taşırsa panel okuması ikisini tek satırda
                  // birleştirirdi.
                  id: `stair-${tierIndex}-${accessories.staircases.length + 1}`,
                  placement: { mode: 'edge', edge: 'west', offsetM: 2 },
                  widthM: 1,
                  landing: 'turn180',
                  railings: 2,
                  steps: 'auto',
                },
              ],
            })
          }
        />
        <ActionButton
          label="+ Kapı"
          onClick={() =>
            patch({
              swingGates: [...accessories.swingGates, { edge: 'north', offsetM: 2, widthM: 0.75 }],
            })
          }
        />
      </ActionGroup>
      <ActionGroup>
        <ActionButton
          label="+ Palet kapısı"
          onClick={() =>
            patch({
              upAndOverGates: [
                ...accessories.upAndOverGates,
                { edge: 'north', offsetM: 5, widthM: 1.5 },
              ],
            })
          }
        />
        <ActionButton
          label="+ Güvenlik bölgesi"
          onClick={() =>
            patch({
              safetyZones: [
                ...accessories.safetyZones,
                // Eşiğin KENDİSİ, 1.5 değil: düğmenin yazdığı değer
                // invariant'ın uyardığı değer olamaz — yeni konan bir aksesuar
                // sarı doğmamalı.
                { edge: 'east', offsetM: 5, widthM: NEW_SAFETY_ZONE_WIDTH_M },
              ],
            })
          }
        />
      </ActionGroup>
    </>
  )
}

export function TiersField({ node, onUpdate }: CustomField) {
  const setTier = (index: number, patch: Partial<MezzanineTier>) => {
    const next = node.tiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier))
    onUpdate({ tiers: next })
  }

  const addTier = () => {
    const index = node.tiers.length
    const last = node.tiers[index - 1]
    onUpdate({
      tiers: [
        ...node.tiers,
        {
          index,
          elevationM: 'auto',
          clearHeightM: last?.clearHeightM ?? 3,
          loadClass: last?.loadClass ?? 500,
          floorType: last?.floorType ?? 'WOOD_CHIPBOARD_30',
          // Yeni tier BOŞ aksesuarla gelir — bir öncekinin merdivenini
          // kopyalamak, aynı yere ikinci bir merdiven koymak demekti.
          accessories: emptyAccessories(),
        },
      ],
    })
  }

  const removeTier = (index: number) => {
    // En az bir tier kalmalı — şemanın kendi kuralı (`tiers.min(1)`); son
    // tier'i silme düğmesi devre dışı kalır, `parse` reddetmeyi bekletmez.
    if (node.tiers.length <= 1) return
    const next = node.tiers.filter((_, i) => i !== index).map((tier, i) => ({ ...tier, index: i }))
    onUpdate({ tiers: next })
  }

  return (
    <>
      <Caption hint={`${node.tiers.length}`}>Tier</Caption>
      {node.tiers.map((tier, index) => (
        <div key={tier.index} style={styles.card}>
          <div style={styles.row}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>
              Tier {index} {index === 0 ? '(zemin)' : ''}
            </span>
            {node.tiers.length > 1 && (
              <button
                onClick={() => removeTier(index)}
                style={{ ...styles.chip, marginLeft: 'auto' }}
                type="button"
              >
                Sil
              </button>
            )}
          </div>

          <SliderControl
            label="Net yükseklik"
            max={6}
            min={2}
            onChange={(clearHeightM) => setTier(index, { clearHeightM })}
            precision={2}
            step={0.1}
            unit="m"
            value={tier.clearHeightM}
          />

          {/**
           * Kot geçersiz kılma — şemada vardı, panelde yoktu.
           *
           * `'auto'` kümülatif toplamdır ve olağan hâldir; açık bir sayı,
           * kasıtlı bir boşluk bırakmak isteyen kenar durum içindir
           * (`resolveTierElevations`'ın yorumunun tarif ettiği şey). Kontrol
           * olmayınca o kenar durum yalnız kaydedilmiş JSON'u elle düzenleyerek
           * kurulabiliyordu.
           */}
          <SegmentedControl
            onChange={(mode: string) =>
              setTier(index, {
                elevationM: mode === 'auto' ? 'auto' : index === 0 ? 0 : index * 3.3,
              })
            }
            options={[
              { label: 'Kot: auto', value: 'auto' },
              { label: 'Elle', value: 'manual' },
            ]}
            value={tier.elevationM === 'auto' ? 'auto' : 'manual'}
          />
          {tier.elevationM !== 'auto' && (
            <SliderControl
              label="Kot"
              max={40}
              min={0}
              onChange={(elevationM) => setTier(index, { elevationM })}
              precision={2}
              step={0.05}
              unit="m"
              value={tier.elevationM}
            />
          )}

          <SelectRow
            label="Yük sınıfı"
            onChange={(value: string) =>
              setTier(index, { loadClass: Number(value) as MezzanineTier['loadClass'] })
            }
            options={LOAD_CLASSES.map((value) => ({
              label: `${value} kg/m²`,
              value: String(value),
            }))}
            value={String(tier.loadClass)}
          />
          <SelectRow
            label="Döşeme"
            onChange={(floorType: MezzanineTier['floorType']) => setTier(index, { floorType })}
            options={FLOOR_TYPE_IDS.map((id) => ({ label: FLOOR_TYPES[id].label, value: id }))}
            value={tier.floorType}
          />

          <AccessoryEditor
            accessories={tier.accessories}
            onChange={(accessories) => setTier(index, { accessories })}
            tierIndex={index}
          />
        </div>
      ))}
      <ActionGroup>
        <ActionButton label="+ Tier ekle" onClick={addTier} />
      </ActionGroup>
    </>
  )
}
