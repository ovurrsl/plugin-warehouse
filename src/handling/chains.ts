/**
 * VDI 2198 ölçü zincirleri — **hakem, türetici değil.**
 *
 * Bir aracın boyuna ölçüleri birbirine bağlıdır: toplam uzunluk çatal sırtına
 * kadar olan uzunluk artı çatal boyudur, çatal sırtı da dingil ve sarkmadan
 * çıkar. Bu ilişkiler tablodan okunan sayıları **doğrulamak** için buradadır;
 * eksik bir sayıyı hesaplamak için değil.
 *
 * ## Neden türetici değil
 *
 * `l1 = l2 + çatalBoyu` yardımcı fonksiyonu yazıp her aileye uygulamak çok
 * çekici, ve beş aileden dördünde doğru cevabı veriyor. Beşincisinde —
 * EKX'te — **914 mm** sapıyor, çünkü o tablonun `l1` ve `l2`'si aynı niceliği
 * ölçmüyor (bkz. {@link CHAIN_EXEMPT}).
 *
 * O hatanın kötülüğü büyüklüğünde değil, görünmezliğinde: 3B'de fark
 * edilmez, çünkü gövde zaten kendi ölçüleriyle çizilir. Yalnız çarpışma
 * kutusunda ve koridor okumasında ortaya çıkar — ve oradaki her aşağı akış
 * figürü kendi içinde tutarlı kalır, yani sonuç *makul görünür*. Bir taban izi
 * 914 mm yanlışsa ve hiçbir şey şikâyet etmiyorsa, kimse bakmaz.
 *
 * Bu yüzden buradaki fonksiyonlar bir sayı üretmez; bir **artık** (residual)
 * döndürür. Sıfıra yakınsa zincir kapanmıştır. Kapanmıyorsa cevap "o hâlde
 * şu değeri kullan" değil, "bu ailenin zinciri farklıdır ve bunu yazılı hâle
 * getir"dir.
 *
 * Birim: metre. Kaynak tablolar mm; dönüşüm katalog sınırında yapılır.
 */

/**
 * Yarım milimetre.
 *
 * Kaynak tablolar tam milimetre basıyor ve bu zincirlerin hepsi tamsayı mm
 * aritmetiğiyle kapanıyor, dolayısıyla gerçek artık ya tam 0 ya da en az 1 mm.
 * Aradaki tolerans yalnız metreye çevrilirken oluşan kayan nokta gürültüsünü
 * yutar — 1 mm'lik bir transkripsiyon hatasını yutmaz, ki bütün mesele odur.
 */
export const CHAIN_TOLERANCE_M = 0.0005

/** Artık sıfıra yeterince yakın mı — yani zincir kapanıyor mu. */
export function chainCloses(residualM: number): boolean {
  return Math.abs(residualM) <= CHAIN_TOLERANCE_M
}

/**
 * `l1 = l2 + çatalBoyu` — çatalın gövdenin önüne eklendiği aileler.
 *
 * Manuel transpalet, elektrikli alçak transpalet, karşı ağırlıklı forklift ve
 * reach truck. Dördünde de `l2` "çatal sırtına kadar" ölçüsüdür, yani çatalın
 * kendisini içermez, ve toplam uzunluk ikisinin toplamıdır.
 */
export function forkChainResidualM(row: {
  overallLengthL1: number
  lengthToForkFaceL2: number
  forkLengthM: number
}): number {
  return row.overallLengthL1 - (row.lengthToForkFaceL2 + row.forkLengthM)
}

/**
 * `l2 = arkaSarkma + y + x` — karşı ağırlıklı forklift.
 *
 * Zincir arka tamponan başlar: sarkma, dingil mesafesi, sonra yük mesafesi.
 * Arka sarkma VDI'da yayınlanmıyor; EFG serisinde yedi modelin hepsinde
 * 190 mm çıkıyor ve **türetilmiş** bir sabittir — bu fonksiyon onu doğrular,
 * varsaymaz, çünkü çağıran ona bir değer geçmek zorundadır.
 */
export function counterbalancedChainResidualM(row: {
  lengthToForkFaceL2: number
  rearOverhangM: number
  wheelbaseY: number
  loadDistanceX: number
}): number {
  return row.lengthToForkFaceL2 - (row.rearOverhangM + row.wheelbaseY + row.loadDistanceX)
}

/**
 * `x = (arkaKenardanTahrikAksına + y) − l2` — reach truck.
 *
 * Forkliftin tersine burada zincir yük tekeri aksından geriye doğru okunur:
 * yük mesafesi, aksın çatal sırtına olan uzaklığıdır. Mast **geride** iken
 * çatal sırtı aksın gerisinde kalır, ki `x`'in pozitif çıkmasının sebebi budur.
 *
 * `rearToDriveAxleM` ölçü çiziminden gelir (210 mm, dört modelde de aynı) ve
 * yine yayınlanmış bir VDI satırı değildir.
 */
export function reachChainResidualM(row: {
  loadDistanceX: number
  rearToDriveAxleM: number
  wheelbaseY: number
  lengthToForkFaceL2: number
}): number {
  return row.loadDistanceX - (row.rearToDriveAxleM + row.wheelbaseY - row.lengthToForkFaceL2)
}

/**
 * Jenerik çatal zincirinin **uygulanmadığı** aileler ve sebebi.
 *
 * Bu sabit bir istisna listesi değil, bir kayıttır: bir ailenin zinciri
 * kapanmıyorsa cevabı burada yazılı olmak zorundadır. Boş bir gerekçe kabul
 * edilmez — testi geçirmek için buraya bir aile eklemek, tam olarak bu
 * dosyanın engellemek için var olduğu şeydir.
 *
 * `turret` (EKX 410–516): `l1 − l2` beş modelde de tam **286 mm** ve çatal boyu
 * **1200 mm**. Jenerik zincir uygulanırsa taban izi 914 mm kısa çıkar. İki ölçü
 * aynı niceliği ölçmüyor: bu makinede `l2` çatal sırtına kadar olan mesafe
 * değil, ve aradaki 286 mm çatalın kendisi değil. Doğru `l1`/`l2` tanımları
 * teyit edilene kadar ikisi de tablodan olduğu gibi okunur, hiçbiri diğerinden
 * hesaplanmaz.
 */
export const CHAIN_EXEMPT: Readonly<Record<string, string>> = {
  turret:
    'EKX 410–516: l1 − l2 = 286 mm sabit, çatal boyu 1200 mm. Jenerik ' +
    'l1 = l2 + çatal zinciri 914 mm sapıyor — bu tabloda l1 ve l2 aynı ' +
    'niceliği ölçmüyor. İkisi de tablodan okunur, biri diğerinden türetilmez.',
}

/** Jenerik çatal zinciri bu aile için geçerli mi. */
export function forkChainApplies(variant: string): boolean {
  return !(variant in CHAIN_EXEMPT)
}
