import type { PalletRackNode } from './schema'
import {
  bayCenterX,
  beamedLevels,
  type DeckFinish,
  deckFinishOf,
  depthPositionZ,
  frameCentersX,
  levelBeamHeight,
  levelSurfaceY,
  storageLevelsPresent,
} from './slots'

/**
 * Every piece of steel in a rack, as a list of boxes.
 *
 * One list, three consumers: the 3D builder extrudes it, the floorplan projects
 * it, and the tests measure it. That is the only way "the plan matches the
 * model" can be a fact rather than a hope — before this the two files each
 * computed their own frame positions from the same inputs, which agrees right
 * up until one of them is edited.
 *
 * It is also what makes interference testable. The version this replaces gave
 * every beam a length of `bayClearWidth + uprightWidth` centred on its bay, so
 * each beam ran from the centreline of one post to the centreline of the next
 * and buried half an upright width in the steel at both ends. Nothing in the
 * code said so; you had to fly the camera into the frame to see it. Now the
 * parts are inspectable and a test refuses any overlap between roles that
 * cannot physically share space.
 */

export type RackPartRole = 'upright' | 'footplate' | 'brace' | 'beam' | 'shelf'

export type RackPart = {
  role: RackPartRole
  center: [number, number, number]
  size: [number, number, number]
  /** Rotation about X in radians. Only frame bracing uses it. */
  tiltX?: number
  /**
   * Which column of the material's atlas this part reads.
   *
   * The whole rack draws from **one** material, so a part that needs a surface
   * pattern cannot have its own map — it steers its UVs into a column of a
   * shared atlas instead. `slots` is the upright's punched face; `mesh` is a
   * wire deck's grid. Absent means the blank column, which multiplies out to
   * exactly the part's own colour.
   *
   * The pattern is a texture rather than geometry, and that is the whole point:
   * the renderer this replaces drew each punched slot as an instanced box, which
   * on a 5 m post is 65 slots x 2 columns x 8 posts — about a thousand extra
   * boxes per rack, more than everything else in the model combined.
   */
  pattern?: 'slots' | 'mesh'
  /**
   * Which panel a shelf is. Absent on everything that is not a shelf.
   *
   * Carried on the part rather than read back off the node, because a rack mixes
   * them: the pallet levels take `decking` and a picking level takes its own
   * shelf whatever `decking` says. One field decides both the colour and the
   * thickness, so the two can never drift apart.
   */
  finish?: DeckFinish
}

/**
 * Baseplate thickness.
 *
 * Named because the ground beam has to clear it: the plate is wider than the
 * post it carries, so a ground beam set from the floor buried its end in it.
 */
const FOOTPLATE_HEIGHT = 0.02
/** Ground beam's clearance above the baseplate — the reach a real beam-end's
 *  hooks take below the section. The connector itself is no longer modelled
 *  (see the tier note below) but the clearance it dictated keeps the ground
 *  beam out of the plate. */
const CONNECTOR_REACH = 0.015

export type RackDetail = 'full' | 'simple'

/**
 * İki katman aynı çeliği üretir; fark yalnız DESEN.
 *
 * ## Sadelik varsayılan oldu (kullanıcı kararı, 2026-08-07)
 *
 * `full` bir zamanlar beş kutulu katlanmış dikme profili, kiriş bağlantı
 * plakaları ve palet destek çubukları taşıyordu — birkaç metreden hiçbiri
 * seçilemeyen detaylar. "Editörün yerleşikleri gibi sade, kaliteli bir raf"
 * istendi ve kompozisyon iki katmanda eşitlendi: tek kutulu dikme + kiriş +
 * güverte + çapraz kafes + taban plakası. Katman farkı desenlerde kaldı:
 * yakın katman dikmeye delik dokusunu ve tel güverteye mesh desenini basar,
 * uzak katman ikisini de bırakır (alt-piksel tekrar moiréye döner).
 *
 * ## İskelet tarihine dikkat — geri gidilecek yer orası değil
 *
 * İlk sadeleştirme güverteyi ve çaprazı da atmıştı ve "uzaktan çubuk gibi"
 * diye reddedildi. Şekli menzilde taşıyan üçlü **güverte panelleri** (rafın
 * tek büyük düz yüzeyi), **çapraz kafes** ("direk" değil "raf" dedirten
 * örgü) ve **taban plakaları** (yer çizgisine oturtan) — üçü de her iki
 * katmanda kalır ve kalmalıdır.
 *
 * Bu diyetten büyük fps beklenmemeli, ve bu ölçülmüş bir gerçek: 3.704
 * gözlük sahnenin CPU profili kare süresinin ~%61'ini nesne başına çizim
 * dispatch'ine, ~%25'ini matris işine yazdı — geometri karmaşıklığı profile
 * hiç girmedi. 120 üçgenlik raf ile 372 üçgenlik raf aynıya mal oluyordu;
 * kazanılan şey görsel sadelik, küçük bir gölge-raster payı ve yarıya inen
 * inşa/bellek maliyeti.
 */
export function rackParts(
  rack: PalletRackNode,
  detail: RackDetail,
  /**
   * Leave the right frame to the bay standing against it.
   *
   * Bays share their frames, so a run of them must not each build both: at one
   * bay pitch the right frame of one lands exactly on the left frame of the
   * next, and building both puts two posts in the same place — doubled steel,
   * doubled perforation texture, z-fighting on every coincident face. Building
   * the left always and the right only when nothing abuts gives a run of N bays
   * N+1 frames, which is how racking is really built. See `./neighbours`.
   */
  hasRightNeighbour = false,
): RackPart[] {
  const parts: RackPart[] = []
  const full = detail === 'full'
  const frames = hasRightNeighbour ? [frameCentersX(rack)[0]] : frameCentersX(rack)
  const levels = beamedLevels(rack)
  const present = new Set(storageLevelsPresent(rack))
  const { uprightWidth, uprightDepth, depth, uprightHeight, beamThickness } = rack
  const postOffset = depth / 2 - uprightDepth / 2

  for (let position = 1; position <= rack.depthPositions; position++) {
    const centerZ = depthPositionZ(rack, position)
    const postZ = [centerZ + postOffset, centerZ - postOffset]

    frames.forEach((x) => {
      postZ.forEach((z) => {
        // Tek kutu, iki katmanda da — katlanmış C-profil (beş kutu) ve delik
        // dokusu sadelik kararlarıyla düştü (kullanıcı, 2026-08-07: dikme
        // delikleri de gitsin). Dikme artık düz boyalı kutu; atlasın slot
        // kolonu bu kind'da okunmuyor ama drivein hâlâ kullanıyor, mekanizma
        // yerinde kalıyor.
        parts.push({
          role: 'upright',
          center: [x, uprightHeight / 2, z],
          size: [uprightWidth, uprightHeight, uprightDepth],
        })

        // Catalogue footplates are wider than the post they carry — 175 x
        // 119 mm under a 122 x 80 upright — so they overhang it by about
        // 26 mm a side. Real, and the reason the built mesh is slightly
        // wider at the floor than the declared footprint.
        //
        // Built at both tiers: four boxes, and without them a distant rack
        // ends in mid-air at the floor line instead of standing on it.
        parts.push({
          role: 'footplate',
          center: [x, FOOTPLATE_HEIGHT / 2, z],
          size: [uprightWidth + 0.053, FOOTPLATE_HEIGHT, uprightDepth + 0.039],
        })
      })

      // Built at both tiers. The diagonal lattice across the frame end is the
      // single most recognisable thing about racking seen down an aisle, and
      // dropping it is most of what made the far tier read as bare posts.
      if (rack.bracing !== 'open') {
        pushFrameBracing(parts, x, centerZ, rack)
      }
    })

    const centerX = bayCenterX()
    for (const level of levels) {
      // A tunnel omits the lowest levels. Intersected with the beamed levels
      // so the bay can never gain one the frame does not carry.
      if (!present.has(level)) continue
      const beamHeight = levelBeamHeight(rack, level)
      const surface = levelSurfaceY(rack, level)
      // Every other level hangs its beam under the load surface; a ground
      // beam has no surface above it to hang from. It stands on its own
      // connectors, clear of the baseplate — the hooks reach below the
      // section, and the plate is wider than the post, so a ground beam set
      // from the floor buried its connectors in both.
      const beamY =
        level === 0 ? FOOTPLATE_HEIGHT + CONNECTOR_REACH + beamHeight / 2 : surface - beamHeight / 2
      const beamTop = beamY + beamHeight / 2

      for (const sign of [1, -1]) {
        // Outer face flush with the frame's outer face, which is where a
        // beam actually sits — its connector bolts to the post's front.
        const beamZ = centerZ + sign * (depth / 2 - beamThickness / 2)
        parts.push({
          role: 'beam',
          // Spans the clear width exactly, so its ends meet the upright
          // faces instead of running through them.
          center: [centerX, beamY, beamZ],
          size: [rack.bayClearWidth, beamHeight, beamThickness],
        })
      }

      // `levelHasShelf` already encodes the open-deck rule, and it encodes it
      // per level: a picking level carries a shelf whatever `decking` says,
      // because containers cannot sit on beams. Re-testing `decking !== 'open'`
      // here on top of it deleted exactly that shelf and left the containers
      // standing on a panel that was never built.
      const finish = deckFinishOf(rack, level)

      // Built at both tiers: a deck is the only large flat area a rack has, so
      // it is what gives the shape mass at range. Three boxes on a default bay.
      if (finish) {
        const thickness = panelThickness(rack, finish)
        // Flush-mounted: the panel drops between the beams and its top
        // finishes level with them, so the load surface stays exactly where
        // `levelSurfaceY` says it is and pallets do not float on a lip.
        parts.push({
          role: 'shelf',
          finish,
          /**
           * Only a wire deck carries a pattern, and only at the near tier.
           *
           * The mesh is a fine repeating texture; past the LOD band its cell
           * is well under a pixel, and a sub-pixel repeat does not read as
           * mesh — it aliases into moiré that crawls as the camera moves.
           * The far tier keeps the panel (that is the mass it was missing)
           * and drops the pattern, which is the one thing about a deck that
           * gets worse rather than smaller with distance.
           */
          pattern: full && finish === 'wire-mesh' ? 'mesh' : undefined,
          center: [centerX, beamTop - thickness / 2, centerZ],
          size: [rack.bayClearWidth, thickness, depth - 2 * beamThickness],
        })
      }

      // Palet destek çubukları sadelik kararıyla düştü: açık gözde palet
      // görsel olarak zaten iki kirişe oturuyor, çubuklar birkaç metreden
      // seçilmeyen ara donanımdı. (Yük hesabına hiç girmiyorlardı —
      // `levelSurfaceY` parçalardan bağımsız.)
    }
  }

  // Row spacers are gone with rows. They were real hardware — a tie between two
  // bays standing spine to spine — but they cannot be expressed by either bay
  // alone, and a bay is a node now. Modelling them would need a kind of their
  // own rather than a part one node guesses at.

  return parts
}

/**
 * There is no part budget any more, and that is worth saying out loud.
 *
 * A block used to be able to ask for 40 bays × 20 rows × 4 levels — about 39 000
 * boxes and 41 MB in one buffer — so the full tier fell back to the silhouette
 * past 12 000 parts and the inspector warned about it. A bay is a node now, and
 * the worst a single one can emit is a few hundred boxes: fifteen levels,
 * double-deep, fully braced and decked. The ceiling cannot be reached, so the
 * fallback and its warning are gone rather than kept as reassurance.
 *
 * The cost moved, it did not vanish. It is draw calls now, and `renderer.tsx`
 * pays it with LOD.
 */

/**
 * Panel thickness by finish, from the catalogues.
 *
 * A total record rather than a `decking === 'timber' ? … : …` ternary, which was
 * the shape of the old bug: two of the four values fell into the same branch and
 * built the same slab. A record cannot gain a fifth finish without failing to
 * compile.
 *
 * `picking` is here because it *is* one of the panels — it used to be detected
 * by comparing `levelBeamHeight` against `pickingBeamHeight`, so a rack that
 * legitimately set `beamHeight: 0.06` made every pallet deck take the picking
 * thickness and `decking` go completely inert.
 *
 * Thickness alone is not what makes the finishes readable, and the audit that
 * found this proved it: every face of the panel that differs is either coplanar
 * with an upright flange or hidden behind a 120 mm beam, and the one that is
 * visible — the underside — moves 12 mm. The colours and the wire pattern do the
 * work. These numbers are here to be right, not to be seen.
 */
const DECK_THICKNESS: Record<PalletRackNode['decking'], number> = {
  /** A welded wire mat, about 5 mm of wire. The formed channels it sits in are
   *  part of the beam, not the deck. */
  'wire-mesh': 0.005,
  /** Roll-formed galvanised sheet — under a millimetre of steel, held out by its
   *  own folded profile. */
  steel: 0.009,
  /** 18 mm P5 chipboard, the catalogue standard. (38 mm is the heavy option.) */
  timber: 0.018,
  /** Never emitted: `deckFinishOf` returns null for an open level. Present so
   *  the record is total. */
  open: 0.006,
}

/** A picking shelf is a specified part, so its thickness is a schema field
 *  rather than a catalogue constant. */
function panelThickness(rack: PalletRackNode, finish: DeckFinish): number {
  return finish === 'picking' ? rack.pickingShelfThickness : DECK_THICKNESS[finish]
}

/**
 * Frame bracing, between nodes clear of both ends of the post — the lowest
 * above the footplate, the highest below the top of the frame. That is how a
 * frame is built, and it also keeps the diagonals, whose rotated cross-section
 * reaches past their end nodes, from poking through the floor.
 */
function pushFrameBracing(
  parts: RackPart[],
  x: number,
  centerZ: number,
  rack: PalletRackNode,
): void {
  const braceBottom = 0.15
  const braceTop = Math.max(braceBottom + 0.3, rack.uprightHeight - 0.1)
  const bracedHeight = braceTop - braceBottom
  const panels = Math.max(3, Math.round(bracedHeight / 0.9))
  const step = bracedHeight / panels
  const span = rack.depth - rack.uprightDepth
  const length = Math.hypot(step, span)
  // The brace's local +Y must land on the (step, span) diagonal, so the angle
  // is atan2(span, step). Its complement — the easy slip — swaps the two
  // projections and drives the bottom brace through the floor.
  const angle = Math.atan2(span, step)

  for (const y of [braceBottom, braceTop]) {
    parts.push({ role: 'brace', center: [x, y, centerZ], size: [0.03, 0.03, span] })
  }

  for (let panel = 0; panel < panels; panel++) {
    const midY = braceBottom + (panel + 0.5) * step
    const sign = panel % 2 === 0 ? 1 : -1
    parts.push({
      role: 'brace',
      center: [x, midY, centerZ],
      size: [0.03, length, 0.03],
      tiltX: sign * angle,
    })
    if (rack.bracing === 'x-bracing') {
      parts.push({
        role: 'brace',
        center: [x, midY, centerZ],
        size: [0.03, length, 0.03],
        tiltX: -sign * angle,
      })
    }
  }
}
