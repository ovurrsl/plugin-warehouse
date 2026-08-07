# Upstream önerisi: storey haritası memoizasyonu + marquee instancing sözleşmesi

**Durum: gönderilmedi.** `pascalorg/editor`'a issue + PR olarak iletilecek;
yama `upstream-storey-memo.patch` (fork'un `integration` dalındaki
`2f7f2e3d`'den türetildi, üç dosyanın upstream'e uyan alt kümesi).

**Fork'taki izleme:** üç değişiklik de fork'un integration dalında YAŞIYOR ve
editör `UPSTREAM.md` çatışma tablosuna kayıtlı. Upstream kendi çözümünü
gönderirse: upstream'inki alınır, bizimki düşer (tablo satırları böyle
diyor). Bu dosya o güne kadar önerinin kaynağı, o günden sonra tarihçesidir.

---

## Issue metni (İngilizce, gönderime hazır)

**Title: `getLevelElevations` is re-derived per wall per frame — O(walls × nodes) during camera movement**

On a plugin-heavy scene (~25k nodes: a warehouse with several thousand
racking bays), orbiting the camera saturates the main thread. Chrome traces
attribute **~35% of frame CPU** to `getLevelElevations`
(`packages/core/src/services/storey.ts`): it walks `Object.values(nodes)`
twice per call, and the wall systems reach it through
`getWallPlaneTop` / `resolveWallEffectiveHeight` **once per wall per
refresh** — `wall-cutout`'s camera-movement refresh and `wall-system`'s
rebuild path both. The map it builds depends only on buildings and levels,
which change on scene writes, never on camera movement.

Two further, smaller items in the same traces:

- `wall-cutout.tsx` recomputes `wallAppearanceKey` (a map + material hash +
  `JSON.stringify` over every wall) on **every frame**, outside its own
  refresh gate. Material and face-band edits can only arrive through a scene
  write, so the key only needs re-deriving when the nodes record's identity
  moves.
- `box-select-tool.tsx`'s marquee filters candidates through an
  ancestor-visibility walk. An object that is `visible = false` because an
  **instancing pool draws it on its behalf** (the node is on screen, just
  not through its own subtree) becomes unselectable by marquee while
  remaining click-selectable (the raycaster ignores `visible`). Proposal: a
  `userData.hiddenForInstancing === true` stamp keeps such proxies
  marquee-selectable; plain hides still filter.

Patch (attached): memoise `getLevelElevations` on the nodes record's
identity with a `WeakMap` — the store replaces the record on every write, so
identity means validity (the same invariant `spatial-grid-manager`'s
`levelWallsCache` already uses); gate `wallAppearanceKey` behind the same
identity; honour the `hiddenForInstancing` stamp in the marquee walk.

Measured on the same scene after the patch set: the `getLevelElevations`
share drops from ~35% of frame CPU to noise.

---

## Fork'taki üç dosya ve satırlar

| Dosya | Ne değişti |
|---|---|
| `packages/core/src/services/storey.ts` | `getLevelElevations` → WeakMap memo; gövde `computeLevelElevations`'a taşındı |
| `packages/viewer/src/systems/wall/wall-cutout.tsx` | `wallAppearanceKey` nodes-kimliği kapısının arkasında |
| `packages/editor/src/components/tools/select/box-select-tool.tsx` | `isObjectVisible` → `userData.hiddenForInstancing` toleransı |

Eklenti tarafı eşleri (bu depo): `src/host-tune.ts` (singleton metod
sarmalayıcısı — upstream memoizasyonu yayınlanırsa gereksizleşir ama zararsız
kalır) ve `src/rack/renderer.tsx`'teki `hiddenForInstancing` damgası
(sözleşmenin eklenti yarısı — kalıcı).
