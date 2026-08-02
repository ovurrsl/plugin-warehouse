import { describe, expect, test } from 'bun:test'
import { parseSlotAddress } from '../rack/slots'
import { PIN_SEPARATOR, parsePinTag, pinTag } from './pin-tag'

/**
 * Sabitlenen yuvanın dize temsili — sessizce değişen bir protokolün ardından.
 *
 * Ayırıcı ham bir NUL baytıydı, kaynakta görünmüyordu ve panelin yeniden
 * yazımında farkında olunmadan boşluğa döndü. Hiçbir test düşmedi: iki uç da
 * aynı anda değiştiği için kendi içinde tutarlıydı. Testin varlık sebebi bu —
 * gidiş-dönüşü ve ayırıcının kimliklerle çakışmadığını KİLİTLEMEK.
 */

const RACK_ID = 'pallet-rack_V1StGXR8Z5jd'
const SLOT_ID = 'R1-B1-L2-P3-D1'

describe('pinTag / parsePinTag', () => {
  test('gidiş-dönüş kimliği bozmuyor', () => {
    expect(parsePinTag(pinTag(RACK_ID, SLOT_ID))).toEqual({
      rackId: RACK_ID,
      address: SLOT_ID,
    })
  })

  test('ayırıcı iki kimlik biçiminin de dışında', () => {
    // Çakışma olsaydı ayrıştırma yanlış rafa sabitlerdi. nanoid alfabesi
    // `A-Za-z0-9_-`, yuva adresi `R#-B#-L#-P#-D#`.
    expect(RACK_ID.includes(PIN_SEPARATOR)).toBe(false)
    expect(SLOT_ID.includes(PIN_SEPARATOR)).toBe(false)
  })

  test('ürettiği adres gerçekten bir yuva adresi olarak ayrıştırılıyor', () => {
    // Uçtan uca: panelin yazdığı `address`, raf tarafının okuduğu biçim olmalı.
    const parsed = parsePinTag(pinTag(RACK_ID, SLOT_ID))
    expect(parseSlotAddress(parsed?.address ?? '')).toEqual({
      row: 1,
      bay: 1,
      level: 2,
      position: 3,
      depth: 1,
    })
  })

  test('ayırıcısız etiket reddedilir — sessizce yarım çift üretilmez', () => {
    expect(parsePinTag(RACK_ID)).toBeNull()
  })

  test('boş taraflar reddedilir', () => {
    expect(parsePinTag(`${PIN_SEPARATOR}${SLOT_ID}`)).toBeNull()
    expect(parsePinTag(`${RACK_ID}${PIN_SEPARATOR}`)).toBeNull()
  })

  test('İLK ayırıcıya göre bölünür — adres ayırıcı taşısa da raf doğru kalır', () => {
    // Sonuncuya göre bölmek, ayırıcı içeren bir adreste rafı uzatır ve BAŞKA
    // bir rafa sabitlerdi. İlk ayırıcı en fazla eşleşmeyen bir çift üretir,
    // onu da panel "sabit artık geçerli değil" diye söyler.
    expect(parsePinTag(`${RACK_ID}${PIN_SEPARATOR}A${PIN_SEPARATOR}B`)).toEqual({
      rackId: RACK_ID,
      address: `A${PIN_SEPARATOR}B`,
    })
  })
})
