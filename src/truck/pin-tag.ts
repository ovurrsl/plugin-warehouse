/**
 * Sabitlenen yuvanın `<option value>` içindeki dize temsili.
 *
 * ## Neden ayrı bir dosya
 *
 * `<option value>` tek bir dize istiyor, ama sabitlenen yuva bir ÇİFT: raf
 * kimliği + yuva adresi. Birleştirme ve ayrıştırma paneldeydi ve test
 * edilemiyordu; ayırıcı sessizce değiştiğinde de kimse haber alamıyordu — ve
 * tam olarak bu oldu.
 *
 * ## Ayırıcının geçmişi
 *
 * Öncesi ham bir **NUL baytıydı**. Çalışıyordu ve çakışması imkânsızdı, ama
 * iki bedeli vardı:
 *
 *  1. **Kaynakta görünmüyordu.** Panel yeniden yazılırken NUL, hiçbir editör
 *     onu göstermediği için farkında olunmadan boşluğa dönüştü. Kendi içinde
 *     tutarlı kaldığı için hiçbir test düşmedi — sessizce değişen bir
 *     protokol.
 *  2. **git dosyanın tamamını ikili sayıyordu.** `git diff` bu paneli hiçbir
 *     zaman okunur biçimde göstermedi; `Bin 12662 -> 11032 bytes` yazdı. Yani
 *     dosyada yapılan hiçbir değişiklik gözden geçirilemiyordu.
 *
 * `|` seçildi çünkü iki kimlik biçiminin de dışında: raf kimliği
 * `pallet-rack_<nanoid>` (`A-Za-z0-9_-` alfabesi), yuva adresi
 * `R1-B2-L3-P1-D1`.
 */
export const PIN_SEPARATOR = '|'

export function pinTag(rackId: string, slotId: string): string {
  return `${rackId}${PIN_SEPARATOR}${slotId}`
}

/**
 * `İLK` ayırıcıya göre bölüyor — sondakine değil.
 *
 * İleride kimlik biçimlerinden biri ayırıcıyı içerirse, adres bozulmuş bir
 * çifte değil, eşleşmeyen bir çifte dönüşür: panel "sabit artık geçerli değil"
 * uyarısını verir ve çevrim kuraya döner. Sessizce yanlış rafa sabitlenmekten
 * iyidir.
 */
export function parsePinTag(tag: string): { rackId: string; address: string } | null {
  const at = tag.indexOf(PIN_SEPARATOR)
  if (at <= 0) return null
  const rackId = tag.slice(0, at)
  const address = tag.slice(at + PIN_SEPARATOR.length)
  return address ? { rackId, address } : null
}
