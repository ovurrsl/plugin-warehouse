# Büyük projede kasmanın teşhisi — kusur eklentide değil, host'un otomatik kaydetmesinde

> ⚠️ **BU BELGENİN BİRİNCİL SONUCU GEÇERSİZDİR.** Buradaki autosave bulgusu
> gerçek ama *düzenleme başına* bir maliyettir ve kullanıcının "dosyayı sadece
> açıyorum, kilitleniyor" belirtisini açıklamaz. Gerçek neden
> `DUZELTME-kirli-bayragi.md`'de. Ayrıca aşağıdaki kare süresi / çizim
> ölçümleri geçersizdir: ölçüm ortamında render bozuktu (R3F çift kopyası,
> havuzlar hiç kurulmuyordu), yani "çizim masum" sonucu ölçülmemiş sayılmalıdır.


*4 Ağustos 2026. Ölçümler, kullanıcının 3.011 düğümlük gerçek proje dosyasıyla
(2.708 × `warehouse:pallet-rack`), dağıtımdakiyle aynı editör sürümü (incele
dalı, `3840a0c`) ve bu eklentinin v0.1.2'siyle, başsız Chromium'da alındı.
Rakamlar hızlı bir sunucu CPU'suna ait; tümleşik grafikli bir dizüstünde
mutlak değerler 2–4 kat büyür, oranlar değişmez.*

## Belirti

Proje dosyası yüklendiği andan itibaren sistem kasıyor; depo nesneleri
silinince kasma bitiyor. Bu, doğal olarak eklentiyi işaret ediyor gibi
görünüyor — ama değişkenlerin yalnız biri "eklenti nesneleri": öbürü, sahne
JSON'unun **boyutu**.

## Eklenti katman katman ölçüldü ve temiz çıktı

| Katman | Bulgu |
|---|---|
| Geometri paylaşımı | 2.708 raf yalnız **4 benzersiz şekle** çözülüyor; önbellek ideal |
| Üçgen yükü | Şekil başına ~320 üçgen, toplam ~900 bin — sorun değil |
| Boşta kare süresi | Raflarla da rafsız da **16,7 ms** (60 fps, vsync kilidi) |
| Yörünge (kamera gezinirken) | Raflarla da rafsız da **16,7 ms** — kamera hareketi mağazaya yazmaz |
| Kare başına eklenti işi | `evaluateTiers` 1/8 faz dağıtımlı, rebake üç float karşılaştırması — µs düzeyi |
| Yazım başına indeksler | `neighbours` / `occupancy` / `clash` / `stats` hepsi düğüm kimliğiyle memoize, O(n) |
| Dağıtımdaki sürüm | Derlenmiş istemci paketinde v0.1.1 + v0.1.2'nin tüm perf düzeltmeleri **var** (chunk'larda doğrulandı) |

## Suçlu: her mağaza yazımında tüm sahnenin serileştirilmesi

`packages/editor/src/hooks/use-auto-save.ts` (hem bu dağıtımda hem upstream
`pascalorg/editor`'de aynı), "sahne değişti mi?" sorusunu mağaza aboneliğinin
**içinde, her yazımda, senkron** olarak şöyle yanıtlıyor:

```ts
const currentNodesSnapshot = JSON.stringify(state.nodes)   // HER yazımda!
const changed = currentNodesSnapshot !== lastNodesSnapshot || …
```

Altındaki debounce yalnız *kaydetmeyi* geciktiriyor; bu karşılaştırma her
yazımda tam bedel ödüyor ve bedel sahne JSON'uyla büyüyor:

| | düğüm JSON'u | stringify süresi |
|---|---|---|
| Raflarla | **3,39 MB** | **15–17 ms/yazım** |
| Rafsız | 0,21 MB | 0,7 ms/yazım |

Gerçek uygulamada tek bir `updateNode`'un toplam maliyeti (React commit dahil):

| | p50 | p90 | max |
|---|---|---|---|
| Yamasız | **32,4 ms** | 41,0 | 51,4 |
| Referans-karşılaştırma yamasıyla | **17,6 ms** | 27,7 | 29,8 |

CPU profili de aynı şeyi söylüyor: yamasız koşuda en büyük JS çerçevesi
`useAutoSave`'in abonelik geri çağrısı; yamalı koşuda profilden tamamen
kayboluyor.

Her ayrık düzenleme (duvar taşıma, silme, geri alma, kaydırıcı tıkı) bir
yazımdır → bir takılmadır. Sürekli yazan yollar — 2B planda kapı/pencere
sürüklemek, kapı animasyonu, kaydırıcı sürtmek — yazımı kare hızında tekrarlar
ve donmaya dönüşür. Raflar silinince düzelmesinin nedeni rafların yavaş
çizilmesi değil, sahne JSON'unu 16 kat büyütmesidir.

## Düzeltme (host tarafı — upstream'e önerilecek)

Değişiklik tespiti referansla yapılmalı: mağaza, düğümlere dokunan her yazımda
yeni bir `nodes` nesnesi verdiği için `state.nodes !== lastNodesRef` her
gerçek değişikliği yakalar. Stringify'ın önlediği tek şey, içeriği özdeş bir
yeniden-yazımın gereksiz kayıt tetiklemesiydi — bunun bedeli en fazla bir
debounce'lu kayıt, ve uzak kayıt yapan host zaten içerik-özdeş kayıtları
POST'tan önce imzayla eliyor (`SceneLoader`'daki karşılaştırma).

Yama: [`upstream-autosave.patch`](./upstream-autosave.patch) — İngilizce PR
metni: [`upstream-pr-text.md`](./upstream-pr-text.md).

Bu depo **kasıtlı olarak değişmeden** kalıyor: her katmanı ölçüldü ve temiz
çıktı; kusur host'ta ve düzeltmesi upstream'e gidiyor. Editör güncellendiğinde
düzeltme kendiliğinden gelecek.

## Yükleme anındaki takılmalar hakkında not

Yük sırasında ana iş parçacığında uzun görevler ölçüldü (başsız/dev ortamında
abartılı; üretimde daha küçük). Bunların baskın kaynağı 2.708 renderer'ın
React mount'u ve gölgelendirici derlemeleridir — bir kerelik maliyetlerdir.
Kalıcı olan kasma, yukarıdaki yazım-başına serileştirmedir; yamayla birlikte
düzenleme akışı sahne boyutundan bağımsızlaşır.
