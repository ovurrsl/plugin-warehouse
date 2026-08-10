/**
 * Seçim sorgusu — dizi taramasının paylaşılan hâli.
 *
 * On üçten fazla renderer aynı soruyu soruyor:
 * `useViewer((s) => s.selection.selectedIds.includes(node.id))`. İki maliyet
 * üst üste biniyor:
 *
 * - zustand v5 HER store yazımında HER abonenin seçicisini koşturuyor, yani
 *   tek yazım sahnedeki her düğüm için bir `includes` taraması demek:
 *   O(seçili × düğüm).
 * - `useViewer` seçimden bağımsız olarak da yazılıyor — `geometryRevision`,
 *   `hoveredId`, `cameraDragging`, Display anahtarları — yani seçim hiç
 *   kımıldamadan da tarama tekrarlanıyor.
 *
 * Küme `selectedIds` dizisinin KİMLİĞİNE memoize ediliyor: host store'u yerinde
 * değiştirmiyor, her seçim yazımında yeni dizi koyuyor, dolayısıyla kimlik
 * "seçim kımıldamadı" demek ve değişmemiş seçim tek referans karşılaştırmasına
 * iniyor. Aynı desenin komşuluk indeksindeki hâli `rack/neighbours.ts`.
 */
let from: unknown = null
let set: ReadonlySet<string> = new Set()

/** Bu düğüm şu anki seçimin içinde mi. */
export function isSelected(selectedIds: readonly string[], id: string): boolean {
  if (selectedIds !== from) {
    set = new Set(selectedIds)
    from = selectedIds
  }
  return set.has(id)
}
