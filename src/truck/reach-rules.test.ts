import { describe, expect, test } from 'bun:test'
import { TRUCK_MODELS } from '../handling/models'
import {
  LEG_COVER_M,
  liftCeilingM,
  minSetDownY,
  SET_DOWN_MARGIN_M,
  strideModeFor,
} from './reach-rules'

/**
 * T32'nin katalog-sonrası hali: dar gövdeli reach (b4 = 0.79) katalogda yok
 * ama KURAL modele değil ölçüye bağlı — sentetik satırla iki dal da kilitli.
 * Tek harf farkla anılan iki modelin kopyala-yapıştırla karışması, bu iki
 * dalın tek dala düşmesi olarak görünürdü.
 */

const RT = TRUCK_MODELS['rt-1800'] // b4 = 0.940
const NARROW = { ...RT, b4: 0.79, h8: 0.355 }

describe('T32 — ETV ↔ ETM kuralı yönelime bağlıdır', () => {
  test('800 mm yüz: 0.94 açıklığa GİRER, 0.79 açıklıktan ÜSTTEN taşınır', () => {
    expect(strideModeFor(RT, 0.8)).toBe('straddle')
    expect(strideModeFor(NARROW, 0.8)).toBe('over-leg')
  })

  test('1000 mm enlemesine yüz HİÇBİRİNİN ayakları arasına girmez', () => {
    expect(strideModeFor(RT, 1.0)).toBe('over-leg')
    expect(strideModeFor(NARROW, 1.0)).toBe('over-leg')
  })

  test('bırakma kotu: straddle yere iner, over-leg h8 + kapak + payın altına inemez', () => {
    expect(minSetDownY(RT, 'straddle')).toBe(0)
    expect(minSetDownY(NARROW, 'over-leg')).toBeCloseTo(0.355 + LEG_COVER_M + SET_DOWN_MARGIN_M, 9)
  })

  test('reach olmayan aileler kot kısıtı taşımaz', () => {
    expect(strideModeFor(TRUCK_MODELS['forklift-1300'], 1.0)).toBe('straddle')
    expect(strideModeFor(TRUCK_MODELS['tt-1600'], 1.0)).toBe('straddle')
  })
})

describe('kaldırma tavanı yayınlanmış veriden okunur', () => {
  test('transpalet raf yuvasına hizmet edemez: strok 0.12 / 0.205', () => {
    expect(liftCeilingM(TRUCK_MODELS['mpt-680x1150'])).toBeCloseTo(0.12, 9)
    expect(liftCeilingM(TRUCK_MODELS['ept-2500'])).toBeCloseTo(0.205, 9)
  })

  test('masted aileler: forklift 7.0 (tablo), rt 11.51 (A+B), tt 18.0 (tavan haritası)', () => {
    expect(liftCeilingM(TRUCK_MODELS['forklift-1300'])).toBeCloseTo(7.0, 9)
    expect(liftCeilingM(TRUCK_MODELS['rt-1800'])).toBeCloseTo(11.51, 9)
    expect(liftCeilingM(TRUCK_MODELS['tt-1600'])).toBeCloseTo(18.0, 9)
  })
})
