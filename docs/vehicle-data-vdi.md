# Araç verisi — VDI 2198 (ham referans)

Kullanıcının araştırma raporlarından çıkarılmış ham figürler. **Bu dosya kod değildir ve
koddan okunmaz** — `handling/` altındaki katalog modüllerinin kaynağıdır. Kodda hiçbir ölçü
tekrar yazılmaz; buradan katalog modülüne geçer, oradan okunur.

Disiplin için bkz. [vehicle-research-brief.md](./vehicle-research-brief.md): her sayı ya
**yayınlanmış** (atıflı) ya **tahmin**dir (notlu). Aşağıda tahminler ⚠ ile işaretli.

Birim: mm · kg · km/h · m/s. Üretici: Jungheinrich AG. Model adları yalnız referans içindir;
geometri jenerik kalır, logo/marka görseli kullanılmaz.

---

## 1. AM 15l — manuel transpalet → `hand-pallet`

Kaynak: factsheet + specsheet TR 07/2026. 4 varyant (çatal genişlik × uzunluk).

| VDI | Sembol | 520×1150 | 520×950 | 520×795 | 680×1150 |
|---|---|---|---|---|---|
| 1.5 | Q | 1500 | 1500 | 1500 | 1500 |
| 1.6 | c | 600 | 500 | 400 | 600 |
| 1.9 | y | 1100 | 900 | 745 | 1080 |
| 2.1 | servis ağırlığı | 74 | 72 | 71 | 65 |
| 4.19 | l1 | 1530 | 1330 | 1175 | 1530 |
| 4.21 | b1 | 520 | 520 | 520 | 680 |
| 4.25 | b5 | 520 | 520 | 520 | 680 |
| 4.22 | s/e/l | 38/150/1150 | 38/150/950 | 38/150/795 | 38/150/1150 |

Ortak: l2=380 · h3=120 · h12=171 · **h13=51** (sınıfının en alçağı) · h14=1237 · m2=13 ·
b10=109 · b11=370 · lastik ön Ø170×50 (2 adet), arka Ø50×70 (4 adet) · indirme hızı
0.09 (yüklü) / 0.02 (yüksüz) m/s · aks yükü yüklü 476/613, yüksüz 60/28.

**Ast = 1584** (1000×1200 enlemesine) / **1784** (800×1200 boylamasına) — yayınlanmış
**Wa = 1274** — yayınlanmış · güvenlik payı a=200 (a/2=100)

Manuel: sürüş motoru yok. Kaldırma pompa darbesiyle — ≤120 kg için 3 darbe, tam yükseklik 5.

- ⚠ **YAYINLANMAMIŞ:** VDI 1.8 `x` (yük mesafesi). `Ast` doğrudan tablodan alınır, formülden değil.
- ⚠ Bileşen xyz konumları mühendislik tahmini (montaj çizimi yayınlanmamış).
- ⚠ Renk: RAL 1028 iddiası yedek boya parça nosundan (JU50009879), ürün sayfasından değil.
- Sürüm farkı: 2021-11 EN bayi sayfası 5 sütunlu (ek 61 kg, ek c=500); **07/2026 esas alınır**.

---

## 2. ERE 225i (ERE 2i) — elektrikli alçak transpalet → `powered-pallet`

Kaynak: factsheet + specsheet TR 07/2026. Tek model, iki platform varyantı.

Q=2500 · c=600 · **x=898** · y=1255 · l1=2139 · l2=989 · b1=770 · b5=535 ·
b10=512 · b11=363 · h13=85 · h14=1215/1275 (min/maks) · m2=29 · çatal s/e/l=56/172/1150

**Ast = 2346** (1000×1200) / **2396** (800×1200) — yayınlanmış · **Wa = 1894** — yayınlanmış

Performans: sürüş yüklü 9 km/h; yüksüz **12** (Efficiency) / **14** (drivePLUS) —
ikisi de doğru, varyanta bağlı. Kaldırma 0.05/0.07 m/s · indirme 0.12/0.05 m/s.
Ölü ağırlık 810 kg · aks yükü yüklü 1390/1920, yüksüz 670/140 · batarya 24 V Li-Ion
260 Ah (2×130, şasiye entegre) · ses 67.1 dB(A).

Tekerlek: ön tahrik Ø230×77 (1, tahrikli) · ön destek Ø140×57 (2) · arka yük Ø85×110 (2 veya 4).
Platform: komfort 632 / kompakt 529 mm; basamak 202 (süspansiyonlu 214).
Kompakt platformda l1 −103, l2 −103, koridor −108.

- **Çelişki:** h3 VDI tablo 4.4 = **120**; pazarlama/web = 122. Fiziksel strok 120 alınır
  (çatal üstü 85 → 205); 122 yalnız etiket.
- ⚠ Gövde/kaput/yan koruma dikey ölçüleri VDI'da **yayınlanmamış**, ±%5–10 tahmin.
- ⚠ Renk: RAL 1028 (gövde) / RAL 7016 (şasi) — boya parça nosundan doğrulanmış.

---

## 3. EFG 213–220 — elektrikli 3 tekerlekli karşı ağırlıklı → `forklift`

Kaynak: specsheet + factsheet TR 07/2026. 7 model, iki gövde grubu.

| | Grup A (213/215/216k/216) | Grup B (218k/218/220) |
|---|---|---|
| b1 | 1060 | 1120 |
| b10 | 904 | 914 |
| ön lastik | 18×7-8 (Ø457×178) | 200/50-10 (Ø454×200) |
| x | 344 | 364 |
| çatal s/e/l | 40/80/1150 | 40/100/1150 |
| h1 / h4 (3000 mast) | 2060 / 3590 | 2067 / 3612 |
| m1 | 97 | 105 |

Dingil y: 213/215 → 1249 · 216k/218k → 1357 · 216/218/220 → 1465
Arka lastik hepsinde 140/55-9 (Ø383×140, ikiz, b11=176). **Arka sarkma 190** (türetilmiş).

**Ölçü zinciri (doğrulanmış, teste dönüştürülmeli):**
`l2 = 190 + y + x` ve `l1 = l2 + 1150`
Örnek EFG 213: 190 + 1249 + 344 = 1783 = l2 ✓ · 1783 + 1150 = 2933 = l1 ✓

| Model | Q | l1 | l2 | y | **Ast 1000×1200** | **Ast 800×1200** | **Wa** | servis kg |
|---|---|---|---|---|---|---|---|---|
| 213 | 1300 | 2933 | 1783 | 1249 | 3112 | 3235 | 1440 | 2692 |
| 215 | 1500 | 2933 | 1783 | 1249 | 3112 | 3235 | 1440 | 2937 |
| 216k | 1600 | 3041 | 1891 | 1357 | 3220 | 3343 | 1548 | 2959 |
| 216 | 1600 | 3149 | 1999 | 1465 | 3327 | 3450 | 1655 | 3018 |
| 218k | 1800 | 3061 | 1911 | 1357 | 3238 | 3362 | 1548 | 3240 |
| 218 | 1800 | 3169 | 2019 | 1465 | 3345 | 3469 | 1655 | 3191 |
| 220 | 2000 | 3169 | 2019 | 1465 | 3345 | 3469 | 1655 | 3366 |

Ast ve Wa **yayınlanmış**.

Ortak: c=500 · çatal boyu 1150 · b3=980 (ISO 2A) · h6=2040 (koruyucu tavan) · h7=920 (koltuk) ·
h10=560 (çeki pimi) · m2=100 · ZT serbest kaldırma h2=150 · hız 16/16 km/h (tüm modeller) ·
sürüş motoru 2×4.5 kW (S2 60dk) · kaldırma 11.5 kW (S3) · 48 V · ses 67 dB(A) ·
ataşman hidroliği 230 bar / 27 l/dk · tilt ileri 7°, geri 4–7°.

Mast: **ZT / ZZ / DZ**, grup A ve B için ayrı tablolar, h3 aralığı 2020–7000.
ZT h2=150 sabit; ZZ/DZ tam serbest kaldırma.

- ⚠ Kapasite eğrisi: c ≤ 500 nominal; **600 ve 700 değerleri grafikten okunmuş yaklaşık**.
  c > 500'de doğrusal interpolasyon, UI'da "yaklaşık" ibaresi zorunlu.
- ⚠ `_merged`: bazı performans satırları PDF'te birleşik hücreydi (gradeability 216k/216;
  drawbarPull 218k/218; energy/co2/turnover kapasite grubuna göre atandı).
- ⚠ Lastik dış çapları nominal SE ölçüsünden türetilmiş (görselleştirme için yeterli).

---

## 4. ETM/ETV 318–325 — reach truck → `reach`

Kaynak: specsheet + factsheet TR 09/2021. 4 model.

Ortak: **arka kenar → tahrik aksı = 210** · çatal boyu 1150 · c=600 · b3=830 (ISO 2B) ·
h6=2190 · h7=1057 · güvenlik payı a=200 · direksiyon 180°/360° mod ·
servis freni elektrikli · ses 68 dB(A) · ataşman 150 bar / 20 l/dk.

| | ETV 318 | ETV 320 | ETM 325 | ETV 325 |
|---|---|---|---|---|
| Q | 1800 | 2000 | 2500 | 2500 |
| y | 1460 | 1518 | 1673 | 1673 |
| l2 | 1306 | 1316 | 1494 | 1396 |
| l4 (itme) | 569 | 624 | 703 | 736 |
| l7 (ayak ucu) | 1842 | 1920 | 2075 | 2075 |
| l1 = l2+1150 | 2456 | 2466 | 2644 | 2546 |
| x = (210+y)−l2 | 364 | 412 | 389 | 487 |
| b1 | 1270 | 1290 | 1198 | 1348 |
| b2 | 1270 | 1270 | 1120 | 1270 |
| **b4** | 940 | 940 | **790** | 940 |
| b11 | 1136 | 1155 | 1034 | 1184 |
| m2 | 80 | 95 | 95 | 95 |
| h8 | 285 | 355 | 355 | 355 |
| çatal s/e | 40/120 | 40/120 | 50/140 | 50/140 |
| b5 min–maks | 335–730 | 356–750 | 356–580 | 356–750 |
| **Ast 800×1200** | 2790 | 2794 | 2969 | 2883 |
| **Ast 1000×1200** | 2737 | 2750 | 2921 | 2854 |
| **Wa** | 1663 | 1710 | 1865 | 1865 |
| servis kg | 3522 | 3650 | 3895 | 3700 |

**Ölçü zinciri (doğrulanmış, teste dönüştürülmeli):** `x = (210 + y) − l2` — dört modelde de tutuyor.
`l1 = l2 + 1150` — dört modelde de tutuyor. Dönüş pivotu = yük tekeri aksı `(210 + y)`.

**KRİTİK ETV ↔ ETM farkı:** `b4` (ayak iç açıklığı).
ETV **940** → 800 mm palet ayaklar *arasına* girer, yere kadar inebilir.
ETM **790** → palet ayakların *üzerinden* taşınır, bırakma kotu ≥ h8 (+30 kapak) + pay.
Bu, palet alma/bırakma mantığını ve çarpışma kuralını değiştirir.

Mast: hepsi **Triplex DZ**. Üç grup — A (mast eğimli, 4250–9110, tüm modeller) ·
B (taşıyıcı eğimli, 6200–11510, ETM325 hariç) · C (12020–13000, yalnız ETV320/325).
**Türetilmiş sabitler (39 satırda doğrulandı):** `h4 = h3 + 746` · `h2 = h1 − 730`.
**Ara h3 enterpole edilmez** — yalnız tablo satırları geçerli konfigürasyondur.
ETM325 yalnız grup A → maks h3 = 9110. ETV318 maks 11510. ETV320/325 maks 13000.

Performans (Efficiency | PLUS): hız 11/11 | 14/14 km/h · kaldırma 0.32/0.64 | 0.38/0.64 m/s ·
indirme 0.55 · itme 0.18 | 0.20 m/s. **ETM325 ve ETV325'te Efficiency paketi YOK** —
kaynakta "0 km/h" yazması aracın hareketsiz olduğu anlamına gelmez, sütun boş demektir.

- ⚠ **REZİDÜEL KAPASİTE EĞRİSİ YAYINLANMAMIŞ** → yüksek h3 + c>600 kombinasyonlarında
  nominal Q taahhüt edilemez (kural R-9: yalnız "doğrulanmadı" uyarısı üret).
- ⚠ `[EŞLEME-TAHMİN]`: b2/b4 (318 hariç), lastik ölçüleri (318 hariç), m2/h8 (318 hariç),
  batarya satırları, 325'lerin y/Wa/l7 değerleri — kaynak tabloda birleşik hücre.
- ⚠ Şasi gövde ölçüleri, ayak başlangıç X'i, mast plan derinliği, renkler, eğim/direksiyon
  açısal hızları, taşıma çatal yüksekliği (~300 mm) — hepsi tahmin.

---

## 5. EKX 410–516 — VNA üç yönlü istifleyici (Man-Up) → `turret`

Kaynak: specsheet + factsheet TR 07/2026. 5 model, iki yapı serisi.

| | 410 | 412 | 514 | 516k | 516 |
|---|---|---|---|---|---|
| seri | BR4 48V | BR4 48V | BR5 80V | BR5 80V | BR5 80V |
| Q | 1000 | 1200 | 1400 | 1600 | 1600 |
| maks h3 | 11500 | 11500 | 13000 | 14000 | **18000** |
| l1 | 3665 | 3665 | 3665 | 3775 | 4045 |
| l2 | 3379 | 3379 | 3379 | 3489 | 3759 |
| y | 1807 | 1840 | 1950 ⚠ | 1950 ⚠ | 2220 |
| x | 450 | 450 | 445 | 445 | 445 |
| z (arka sarkma) | 320 | 320 | 282 | 282 | 282 |
| **Wa** | 2122 | 2122 | 2122 | 2232 ⚠ | 2502 |
| b10 | 1306 | 1306 | 1258 | 1258 | 1258 |
| ağırlık | 5515 | 5895 | 6350 | 6750 | 7900 |
| hız km/h | 10.5 | 10.5 | 10.5 | 12 | 12 |
| kaldırma m/s | 0.4 | 0.4 | 0.45 | 0.6 | 0.6 |
| çatal s/e/l | 40/120/1200 | 40/120/1200 | 50/120/1200 | 50/120/1200 | 50/120/1200 |

Ortak: c=600 · **b1=1210 gövde ama b2=1450 KABİN** (kabin gövdeden geniş — zarf `l1 × 1450`) ·
b3=880 (2B) · b5=856 · h6=2550 · h7=430 (sınıfının en alçak basamağı) ·
**h9=1780 yardımcı kaldırma** · h12=3930 · yana itme ±650 (sideshiftPLUS +100) ·
m1=m2=80 · ray kılavuzu mil dayanağı **1103** · referans palet **1200×1200** ·
ses 64 dB(A) · bakım aralığı 1000 saat.

**Mast kuralı: `h4 = h3 + 2550` (her zaman).** İki tip: **ZT** (2 kademe, h2=0 — serbest
kaldırma yok) ve **DZ** (3 kademe, serbest kaldırmalı). BR5 için ortak tablo
(`mastTables_BR5_common`) + model bazlı ek satırlar.

**Man-Up:** sürücü kabini çatalla birlikte h3'e kadar yükselir. Diğer dört ailede yok.
**Üç yönlü:** swivel ±90° + traverse ±650 → araç dönmeden iki taraftan alır; bu yüzden
koridor Wa'dan dar olabilir.
**Kılavuz:** ray (1103 mm) veya endüktif tel; **koridorda direksiyon kilitli**.

- ⚠⚠ **`Ast` YAYINLANMAMIŞ.** `Ast_published: null`. Verilen formül:
  `Ast = max(araç zarfı, palet diyagonali) + 2×90 mm`; 1200×1200 palet için pratik aralık
  **1600–1900 mm**, "raf projesine göre Jungheinrich'ten teyit edin" notuyla.
  → `turret` sınıfı EN 15620'nin yayınlanmış bandında **KALIR**; bu rapor onu değiştirmez.
- **Transfer koridoru ≥ 4000–4500 mm** (koridora giriş dönüşü için). Dar koridordan ayrı
  bir genişlik — tek "koridor genişliği" kavramı bu makineyi ifade etmiyor.
- ⚠ `_assumption`: 514'ün y=1950'si VDI birleşik sütun dizilişinden atandı;
  516k'nın Wa=2232'si sütun dizilişinden eşleştirildi.
- ⚠ 516'nın 14500 üzeri (→18000) mastları VDI'da satır satır **yok** — özel konfigürasyon
  (liftPLUS 17.5 m referansı); seçicide "özel konfigürasyon" etiketiyle tek uç değer.
- ⚠ İç kabin detayı (koltuk/panel ölçüsü) yayınlanmamış — temsilî sadeleştirilmiş geometri.

---

## Sınıf eşlemesi ve `aisleBandForVariant` üzerindeki etkisi

| Rapor | `TruckVariant` | Bugün | Rapordan sonra |
|---|---|---|---|
| AM 15l | `hand-pallet` | `null` → tahmin | Ast 1584/1784 **yayınlanmış** ✅ terfi |
| ERE 225i | `powered-pallet` | `null` → tahmin | Ast 2346/2396 **yayınlanmış** ✅ terfi |
| EFG 213–220 | `forklift` | EN 15620 bandı | model bazlı 3112–3469 ✅ incelme |
| ETM/ETV | `reach` | EN 15620 bandı | model bazlı 2737–2969 ✅ incelme |
| EKX 410–516 | `turret` | EN 15620 bandı | **Ast yok** → banda **dokunulmaz** |
| — | `agv` | `null` → tahmin | rapor yok |

Terfi tek yönlü değildir: üretici verisi her zaman EN 15620'den güçlü değildir.
