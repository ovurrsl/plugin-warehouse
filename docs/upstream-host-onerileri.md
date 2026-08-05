# Host tarafı öneriler — ölçülmüş etki sırasıyla

Bu depo eklenti deposu; buradaki hiçbir şey editörü değiştirmiyor. Bu dosya,
depo sahnesindeki donmanın **eklentiyle giderilemeyen** kısmını `pascalorg/editor`
tarafına taşınabilir hâlde tutuyor. Kullanıcı editörünü upstream'den
güncellediğinde bunlar hazır olur.

İki maddenin uygulanabilir yaması var; kalanı gerekçe + kaynak konumu.

| # | ne | nerede | ölçüm | durum |
|---|---|---|---|---|
| 1 | Toplu düğüm oluşturma: O(K²) children + boşa doğrulama | `core/store/actions/node-actions.ts` | 64.8 → 4.6 ms / 900 düğüm | **yama hazır** |
| 2 | Autosave her mağaza yazımında tüm sahneyi serileştiriyor | `editor/hooks/use-auto-save.ts` | 15.2 ms → ~0, **yazım başına** | **yama hazır** |
| 3 | Kat çoğaltma iki ayrı mağaza yazımı yapıyor | `floating-level-selector.tsx`, `site-panel/index.tsx` | 1 ve 2'nin maliyetini ikiye katlıyor | öneri |
| 4 | Kenar çubuğu ağacı sanallaştırılmamış | `site-panel/index.tsx:1374` | ölçülmedi | öneri |
| 5 | Kirli düğüm kümesini kimse temizlemiyorsa 12 sistem sonsuza dek geziyor | `viewer/systems/*` | eklenti tarafında çözüldü | not |

---

## 1. Toplu oluşturma — `docs/upstream-bulk-create.patch`

PR metni: `docs/upstream-bulk-create.md`.

Üç değişiklik, hepsi `packages/core/src/store/actions/node-actions.ts` içinde:
ebeveyn `children` yazımını op başına değil ebeveyn başına yapmak; tip başına
şema çözümünü — **ıskalayanlar dâhil** — memoize etmek; ve çözümleyici "bu tipin
şeması yok" dediğinde kesin başarısız olacak `safeParse`'ı atlamak.

900 düğüm, tek ebeveyn altında, 15 turun en iyisi:

| sürüm | eklenti kind'ı | çekirdek kind |
|---|---|---|
| bugün | 64.8 ms | 33.3 ms |
| + toplu children | 29.1 ms | 2.8 ms |
| + memoize şema | 20.5 ms | 2.8 ms |
| + kesin ıskayı atla | **4.6 ms** | **3.1 ms** |

Yamaya iki koruma testi dâhil; ikisi de yanlış uygulamada düşüyor, doğrusunda
geçiyor. Biri şunu koruyor: şemasız kind için sayısal temizleme **atlanmamalı**.
İlk yazdığım yama bunu sessizce kaybediyordu — `NaN` bir matrise ulaştığında tüm
`InstancedMesh` boşalır, ne hata ne ipucu verir.

## 2. Autosave — `docs/upstream-autosave.patch`

PR metni: `docs/upstream-autosave.md`.

`useAutoSave`, "sahne değişti mi?" sorusunu mağaza aboneliğinin **içinde,
senkron olarak**, tüm `nodes` haritasını `JSON.stringify` ederek yanıtlıyor.
Alttaki debounce yalnız *kaydı* geciktiriyor; bu karşılaştırma her yazımda tam
maliyetiyle koşuyor. Referans karşılaştırmasına çevirmek yeterli — mağaza her
yazımda yeni bir `nodes` nesnesi veriyor.

Bu **yükleme** donmasının değil, **düzenleme** takılmasının nedeni; ayrı bir
kusur olarak duruyor.

## 3. Kat çoğaltma iki mağaza yazımı yapıyor

`packages/editor/src/components/ui/floating-level-selector.tsx:495-503` ve
`packages/editor/src/components/ui/sidebar/panels/site-panel/index.tsx:683-691`
aynı diziyi taşıyor:

```ts
if (shiftedLevels.length > 0) {
  updateNodes(shiftedLevels.map(…))
}
createNodes(createOps)
```

Üstünde kat varsa bu iki ayrı `set` demek: iki abone dalgası, iki autosave
karşılaştırması, iki geri-al adımı. Zemin katı çoğaltmak — kullanıcının tam
olarak yaptığı şey — üstünde kat olduğu için her zaman iki yazım.

Depoda gereken iki parça zaten var ve burada kullanılmıyor:
`runAsSingleSceneHistoryStep` (`packages/core/src/store/history-control.ts:183`,
beş dosyada altı çağrı) ve tek `set` yapan `applyNodeChangesAction`. İki çağrı
tek geçmiş adımına sarılırsa hem maliyet hem de "çoğaltmayı geri al" davranışı
düzelir.

Ayrıca mantık iki dosyada birebir kopyalanmış; `buildLevelDuplicateCreateOps`
zaten paylaşılan yardımcı, uygulama adımı da oraya taşınabilir.

## 4. Kenar çubuğu ağacı sanallaştırılmamış

`packages/editor/src/components/ui/sidebar/panels/site-panel/index.tsx:1374`:

```tsx
{elementChildren.map((childId, index) => (
  <TreeNode depth={0} … nodeId={childId} />
))}
```

`packages/editor` içinde hiçbir sanallaştırma kullanılmıyor (arama sonucu boş).
Çoğaltma bittiğinde yeni kat otomatik seçiliyor (`selectLevel(newLevelId)`),
yani ~900 `TreeNode` tek commit'te mount oluyor.

Bunu **ölçmedim** — buradaki başsız ortamda editör render'ı bozuk. Diğer dört
madde gibi rakamla desteklenmiyor; kaynak okumasına dayanan bir gözlem olarak
duruyor.

## 5. Kirli düğüm kümesi — eklenti tarafında çözüldü, ama sözleşme belirsiz

Ayrıntı: `docs/DUZELTME-kirli-bayragi.md`.

Kısaca: `def.geometry` ya da `def.system` bildiren bir kind'ın kirli bayrağını
`FloorElevationSystem` temizlemiyor (`floor-elevation-system.tsx:111`), o kind'ın
kendi sistemi temizleyecek varsayılıyor. Eklenti bunu bilmiyorsa küme hiç
boşalmıyor ve on iki viewer sistemi her karede onu geziyor. Eklenti tarafında
`consumeOwnDirtyNodes()` ile çözüldü.

Upstream'de değeri olan kısım **belge**: bu sözleşme hiçbir yerde yazılı değil
ve ihlali sessiz. `wiki/architecture/systems.md` içinde bir cümle, eklenti
yazarının bunu keşfetmek için on iki sistemi okumasını gereksiz kılar.

---

## Ölçülüp bırakılanlar

Öneri listesine girmesi mantıklı görünen ama **ölçtükten sonra düşürdüğüm** bir
madde: `cloneLevelSubtree` düğüm başına `JSON.parse(JSON.stringify(node))`
yapıyor (`packages/core/src/utils/clone-scene-graph.ts:235`). Aynı 900 düğümlük
alt ağaçta **düğüm başına 16.3 ms, toplu 15.2 ms** — 1,1×. Ayrıca düğüm başına
biçim, serileştirilemeyen düğümü tek başına yalıtıyor; toplu biçim yalıtmaz.
Buradan bir kazanç yok, listeye alınmadı.

## Bütçe deseni zaten depoda var

`packages/viewer/src/systems/wall/wall-system.tsx:492-494`, kare başına yeniden
inşayı sınırlayan tek yol:

```ts
const MAX_WALL_REBUILDS_PER_FRAME = 8
const WALL_PROGRESSIVE_TIME_BUDGET_MS = 8
```

`GeometrySystem` ve `FloorElevationSystem` bütçesiz. Eklentideki kademeli mount
kapısı (`src/instancing/admission.ts`) bilinçli olarak bu deseni taklit ediyor —
aynı fikrin host'ta genelleştirilmesi eklentiye özel çözümü gereksiz kılardı.
