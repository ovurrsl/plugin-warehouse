# Sahne açıkken sonsuza dek koşan kare işi — kirli bayrağı hiç düşmüyordu

*4 Ağustos 2026.*

> **Bu belge, aynı klasördeki `teshis-buyuk-projede-kasma.md`'nin BİRİNCİL
> sonucunu geçersiz kılar.** O belge kasmanın tek kaynağı olarak host'un
> autosave'ini gösteriyordu. Autosave bulgusu gerçek ama **düzenleme başına**
> bir maliyet; kullanıcının bildirdiği "dosyayı sadece açıyorum ve kilitleniyor"
> belirtisini açıklamıyor. Gerçek neden burada. O belgedeki "kare süreleri raflı
> ve rafsız özdeş, çizim masum" satırları da **geçersizdir** — ölçüm ortamında
> render bozuktu (aşağıda).

## Belirti (kullanıcının tarifi)

- Rafsız proje, kaç kat olursa olsun: sorun yok
- Tek kat + raflar: az kasıyor
- Katları raflarla birlikte çoğaltmak: **editör ve viewer tamamen kilitleniyor** —
  raf silinemiyor, kamera oynatılamıyor, nesne seçilemiyor
- x86 PC'de oluyor, iPhone 14 Pro'da olmuyor

Kameranın da durması belirleyici: GPU dolgu sorunu olsa kare hızı düşerdi ama
girdi işlenmeye devam ederdi. Hiçbir şey yapamamak **ana iş parçacığının JS'te
bloke olması** demektir.

## Zincir

**1. Tetikleyici sahne yüklemesinin kendisi.** Her slab düğümü geldiğinde host
`markNodesOverlappingSlab` taramasını koşuyor
(`packages/core/src/hooks/spatial-grid/spatial-grid-sync.ts`). Bu tarama tüm
düğümleri gezip `capabilities.floorPlaced` bildiren ve ayak izi slab'a değen
her düğümü `markDirty` ile kirletiyor. Bu paketin **on kind'ı** floorPlaced
bildiriyor (conveyor, drivein, live-racking, longspan, m3, mezzanine, pallet,
rack, route, truck). Bildirilen dosyada 24 slab ve 2.708 raf var — yani
yükleme, rafların tamamını kirletiyor. Tek bir kullanıcı eylemi gerekmiyor.

**2. Bayrak hiç düşmüyordu.** `<FloorElevationSystem>` (öncelik 1) kirli
düğümleri işliyor ama `clearDirty`'yi yalnız şu koşulda çağırıyor:

```js
if (!(def.geometry || def.system) && dirtyNodes.has(id)) clearDirty(id)
```

Yani geometri ya da sistem bildiren bir kind'ın bayrağını **kasten**
düşürmüyor: onu asıl işleyen kendi sistemidir, tüketmek de onun işidir. Host'un
yerleşik sistemlerinin hepsi bu sözleşmeye uyuyor — ceiling, door, window,
fence, wall, roof, stair, item, geometry sistemlerinin her biri işini bitirince
`clearDirty` çağırıyor. Bu paketin kind'ları `def.system` bildiriyor ve
`clearDirty`'yi hiçbir yerde çağırmıyordu.

Kind'lar `dirtyTracking: false` de bildirmiyor, yani izleme açık.

**3. Maliyet on iki sisteme yayılıyor.** `dirtyNodes.size === 0` on iki host
sisteminin **ortak** erken çıkışı. Küme bir daha boşalmadığı için hepsi kümenin
tamamını her karede geziyor — kendi tipleri olmasa bile — ve
`<FloorElevationSystem>` ayrıca kirli düğüm **başına** uzamsal yükseklik çözümü
koşuyor.

| sahne | kare başına kirli-küme gezinmesi | + yükseklik çözümü |
|---|---|---|
| rafsız | 0 (hepsi ilk satırda çıkıyor) | 0 |
| 960 raf / 1 kat | ~11.500 iterasyon | 960 |
| 2.708 raf / 3 kat | ~32.500 iterasyon | 2.708 |
| 4.628 raf / 5 kat | ~55.500 iterasyon | 4.628 |

Kullanıcının üç gözlemi de bu tabloda: rafsız temiz, tek kat taşınabilir,
çoğaltma kilitleniyor. iPhone farkı da tutarlı — A16'nın tek çekirdek
performansı tipik bir dizüstü x86'nın belirgin üstünde, yani aynı sabit yük
orada eşiği aşmıyor. Bu son nokta makul bir açıklama, kanıt değil.

## Düzeltme

`src/instancing/collective-system.tsx` her karede bu paketin kind'larının
bayrağını düşürüyor. Üç kısıt:

- **Öncelik 6**, kaldırma işini yapan öncelik 1'den sonra. Daha erken temizlemek
  asma kat güvertesindeki bir rafın slab kaldırmasını hiç uygulanmadan iptal
  eder, rafı zemine düşürürdü.
- **Erken çıkışların üstünde**, `rebakeDriftedStaticTransforms` ile aynı
  gerekçeyle. Instancing kapalıyken de koşmalı: kapatmak donmayı teşhis etmek
  için önerilen ilk adım ve kapalıyken donmanın geri gelmesi teşhisi yanlış
  yönlendirirdi.
- **Kapsam kind ön ekiyle** çiziliyor. Host'un kendi düğümlerinin bayrağını
  düşürmek, host sistemlerinin işini hiç yapmadan iptal etmek olurdu.

## Ölçüm ortamı hakkında dürüstlük notu

Bu teşhis **host kaynağından statik olarak** çıkarıldı, tarayıcı ölçümünden
değil. Kurduğum başsız ortamda render bozuktu: R3F'in çift kopyası yüzünden
kolektif sistem hata sınırında düşüyor, havuz sayısı 0 kalıyor ve raflar hiç
çizilmiyordu. Bu yüzden o ortamdan gelen **çizim çağrısı, üçgen ve kare süresi
sayılarının hiçbiri kanıt değildir** ve buraya alınmadı.

Aynı ortamda ölçülüp **geçerli** olan tek şey, doğrudan mikro-ölçümle alınan
ışın tarama (raycast) maliyetidir — ve o hipotezi çürüttü:

| sahne | raycast p50 | p95 |
|---|---|---|
| 0 raf | 0,20 ms | 3,80 ms |
| 960 raf | 0,50 ms | 1,90 ms |
| 2.708 raf | 1,10 ms | 2,80 ms |
| 4.628 raf | 1,60 ms | 5,60 ms |

4.628 rafta bile 1,6 ms — kilitlenmeyi açıklamıyor, pointer raycast elendi.

Düzeltmenin kullanıcının makinesinde etkisi **doğrulanmalıdır**.

## Ayrı duran ikinci sorun

Host'un `useAutoSave`'i her mağaza yazımında tüm sahneyi `JSON.stringify` ile
serileştiriyor (`docs/upstream-autosave.patch`). Bu gerçek ve ölçüldü — bu
dosyanın `nodes`'u 3,39 MB, düğüm-verisi üzerinde doğrudan ölçüm yazım başına
15,2 ms veriyor (rafsız hâlde 0,21 MB → 0,7 ms). Ama **düzenleme** başına bir
maliyet: dosyayı açıp hiçbir şey yapmayan kullanıcı onu ödemiyor. Ayrı bir
sorun olarak upstream'e önerilmeye devam ediyor.
