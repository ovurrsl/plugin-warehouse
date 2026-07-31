import { describe, expect, test } from 'bun:test'
import { warehousePlugin } from './index'

/**
 * BEKÇİ: her kind'ın her şema alanı panelden KULLANILABİLİR olmalı.
 *
 * Kullanıcının şartı bu ("eklediğimiz nesnelerin tüm özelliklerini kendi
 * panellerinden kullanabilmeliyim") ve tek seferlik bir denetim yerine
 * kalıcı bir test: bundan sonra şemaya eklenen her alan ya bir parametrik
 * gruba girer, ya aşağıdaki kayıtlı istisnalardan birine gerekçesiyle
 * yazılır — yoksa bu test onu ERİŞİLEMEZ diye düşürür.
 *
 * İstisna türleri:
 *   - SYSTEM  — yerleştirme/sistem yazar, kullanıcı alanı değil
 *   - CUSTOM  — trailing panel ya da 3B araçla düzenleniyor (generic alan
 *               tipi onu ifade edemiyor); NEREDE düzenlendiği yazılı
 *
 * "Kullanıcıya kapalı" diye bir istisna türü BİLEREK yok.
 */

/** BaseNode'un her kind'da tekrar eden alanları. */
const BASE = new Set([
  'object',
  'id',
  'type',
  'name',
  'parentId',
  'visible',
  'metadata',
  'camera',
  'position',
  'rotation',
])

type Exemption = { field: string; kind: 'SYSTEM' | 'CUSTOM'; where: string }

const EXEMPTIONS: Record<string, Exemption[]> = {
  'warehouse:pallet': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
    { field: 'slotRackId', kind: 'SYSTEM', where: 'raf gözüne oturtmada araç yazar' },
    { field: 'slotAddress', kind: 'SYSTEM', where: 'raf gözüne oturtmada araç yazar' },
    {
      field: 'fillRange',
      kind: 'SYSTEM',
      where: 'göz aralığından araç yazar; kargo varyantını sürer',
    },
  ],
  'warehouse:pallet-rack': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
    { field: 'levelTypes', kind: 'CUSTOM', where: 'trailing panel LevelTypes editörü' },
  ],
  'warehouse:route': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
    { field: 'points', kind: 'CUSTOM', where: 'çizim aracı; nokta listesi generic alan değil' },
  ],
  'warehouse:truck': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
    { field: 'routeId', kind: 'SYSTEM', where: 'filo sistemi yazar' },
    { field: 'routeAnchor', kind: 'SYSTEM', where: 'filo sistemi yazar' },
    { field: 'carryingPalletId', kind: 'SYSTEM', where: 'palet görev döngüsü yazar' },
  ],
  'warehouse:conveyor-roller': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
  ],
  'warehouse:conveyor-booster': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
  ],
  'warehouse:conveyor-curve': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
  ],
  'warehouse:conveyor-launcher': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
  ],
  'warehouse:conveyor-oblique': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
  ],
  'warehouse:conveyor-transfer': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
  ],
  'warehouse:conveyor-telescopic': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
  ],
  'warehouse:mezzanine': [
    {
      field: 'supportSlabId',
      kind: 'SYSTEM',
      where: 'yerleştirme/uzlaştırıcı yazar (zemin çivisi)',
    },
    { field: 'grid', kind: 'CUSTOM', where: 'auto-fields GridField' },
    { field: 'tiers', kind: 'CUSTOM', where: 'auto-fields TiersField (aksesuar editörü dahil)' },
    { field: 'polygon', kind: 'CUSTOM', where: 'çizim aracı (D) + seçim tutamakları' },
    { field: 'mainBeamProfile', kind: 'CUSTOM', where: 'trailing panel profil seçicisi' },
    { field: 'secondaryBeamProfile', kind: 'CUSTOM', where: 'trailing panel profil seçicisi' },
    { field: 'columnProfile', kind: 'CUSTOM', where: 'trailing panel profil seçicisi' },
  ],
  'warehouse:live-racking': [
    { field: 'supportSlabId', kind: 'SYSTEM', where: 'yerleştirmede electSupportSlab yazar' },
    { field: 'skus', kind: 'CUSTOM', where: 'trailing panel kat başına SKU girdileri' },
  ],
}

describe('panel erişilebilirliği — her alan ya grupta ya kayıtlı istisnada', () => {
  const defs = warehousePlugin.nodes ?? []
  expect(defs.length).toBeGreaterThan(0)

  for (const def of defs) {
    test(def.kind, () => {
      const parsed = def.schema.parse({ id: `${def.kind.split(':')[1]}_probe` }) as Record<
        string,
        unknown
      >
      const covered = new Set(
        (def.parametrics?.groups ?? []).flatMap((group) =>
          group.fields.map((field) => String(field.key)),
        ),
      )
      const exempt = new Map(
        (EXEMPTIONS[def.kind] ?? []).map((entry) => [entry.field, entry] as const),
      )

      for (const field of Object.keys(parsed)) {
        if (BASE.has(field)) continue
        const reachable = covered.has(field) || exempt.has(field)
        expect(reachable, `${def.kind}.${field} panelden erişilemez ve istisnada yok`).toBe(true)
      }

      // Ters yön: istisna listesi şişmesin — şemadan silinen alanın
      // istisnası da silinmeli, yoksa liste yalan söylemeye başlar.
      for (const field of exempt.keys()) {
        expect(field in parsed, `${def.kind}.${field} istisnada ama şemada yok`).toBe(true)
      }
    })
  }
})
