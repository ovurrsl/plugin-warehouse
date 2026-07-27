/**
 * Figures about floor markings that an instrument actually publishes.
 *
 * **There are very few, and that is the finding rather than an omission.**
 * Almost nothing about a traffic route is a number in law. The EU directives
 * and their Turkish transpositions state duties — route the traffic, keep
 * sufficient distance, mark it clearly — and name no width at all:
 *
 *   - İşyeri Bina ve Eklentilerinde Alınacak Sağlık ve Güvenlik Önlemlerine
 *     İlişkin Yönetmelik (RG 17.07.2013 / 28710), Ek-1 md. 36–38, transposing
 *     89/654/EEC: "uygun boyutlarda", "yeterli güvenlik mesafesi", "yeterli
 *     mesafe". Not one figure.
 *   - Sağlık ve Güvenlik İşaretleri Yönetmeliği (RG 11.09.2013 / 28762), Ek-5,
 *     transposing 92/58/EEC: constrains COLOUR and continuity, not width.
 *
 * So this file holds two things only: the colour rule, which is genuinely
 * mandated, and the one published width table in the survey — which is German,
 * and is labelled German wherever it is shown.
 */

/**
 * **The stripes are white or yellow, continuous, and chosen against the floor.**
 *
 * Directive 92/58/EEC Annex V ¶2.1, transposed at RG 11.09.2013/28762 Ek-5:
 * *"araç trafiğine açık yollar, zemin rengi de dikkate alınarak, açıkça
 * seçilebilir şekilde, sarı ya da beyaz renkli sürekli şeritlerle belirtilir."*
 *
 * Continuous is the load-bearing word and the reason this is a catalogue entry
 * rather than a style choice: a dashed lane line is a different marking with a
 * different meaning, and a later styling pass must not be free to introduce one.
 * A test pins it.
 */
export const STRIPE_IS_CONTINUOUS = true

/**
 * **A pedestrian route is 1.20 m clear. GERMANY, ASR A1.8 Table 2.**
 *
 * The ≤50-simultaneous-persons band, which is the band a warehouse aisle sits
 * in and which also clears a wheelchair. Named with its jurisdiction because it
 * is the only published width in the whole survey, and because of what it is:
 * a *Technische Regel* carrying **Vermutungswirkung** under ArbStättV, not law.
 * Comply and conformity is presumed; deviate and equal safety must be shown.
 * Nothing in this package may therefore say a route "fails" — only that it sits
 * outside the presumption.
 *
 * Explicitly NOT the 2.0 m the older editor defaulted to. That is ASR's
 * 300-person band, and defaulting to it quietly eats two metres of floor along
 * every wall of the building.
 */
export const PEDESTRIAN_WIDTH_M = 1.2

/** Said wherever the pedestrian default is explained, so the jurisdiction
 *  travels with the number and never gets quoted as Turkish law. */
export const PEDESTRIAN_WIDTH_NOTE =
  'Almanya, ASR A1.8 Tablo 2 (≤50 kişi). Türk mevzuatı yeterli mesafe ister, rakam vermez.'

/**
 * **The narrowest stripe anyone accepts: 50 mm.**
 *
 * United States, the OSHA 1972-05-15 interpretation of 29 CFR 1910.176(a):
 * *"any width 2 inches or more is considered acceptable"*, inside a recommended
 * 2–6 inch band. It is here rather than in `./constants.ts` because it is the
 * one stripe width with a citable floor; the two wider options are what tape is
 * sold in and are estimates.
 */
export const NARROW_STRIPE_M = 0.05
