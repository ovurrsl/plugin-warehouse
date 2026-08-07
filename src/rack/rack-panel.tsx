'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  PanelSection,
  SegmentedControl,
  SliderControl,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { type CSSProperties, useState } from 'react'
import { IssueList } from '../panels/issue-list'
import { Field, Figures, Note } from '../panels/kit'
import { useWarehouseStore } from '../store'
import { lengthLabel, millimetreLabel, useUnit } from '../units'
import { runExtent } from './multiply'
import { multiplyRack, pendingPlacements } from './multiply-command'
import { occupiedSlots } from './occupancy'
import { palletRackParametrics } from './parametrics'
import type { PalletRackNode } from './schema'
import { directAccessSlotCount, fittedLevelCount, palletSlotCount, pickingSlotCount } from './slots'

/**
 * Turning one bay into a run.
 *
 * Mounted as `parametrics.trailingSection`, so it sits under the bay's own
 * fields in the host inspector rather than replacing them — `customPanel` would
 * short-circuit the auto-derived groups, the actions and the Move/Delete buttons
 * along with them.
 *
 * ## Neden her blok bir `PanelSection`
 *
 * Host trailing bölümü `<PanelSection>`'larının çıplak kardeşi olarak çiziyor
 * (`parametric-inspector.tsx:173`), yani iç boşluk, başlık ve ayraç gelmiyor.
 * Bu panel eskiden bunu kendi çerçeveli kartlarıyla telafi ediyordu ve sonuç,
 * zaten çerçeveli bölümlerin içinde ikinci bir çerçeve katmanıydı. Artık
 * bölümler host'un kendi bileşeni: başlık, iç boşluk, ayraç ve katlanma bedava
 * geliyor ve panel üstündeki gruplarla aynı hizada duruyor.
 *
 * The panel this replaces edited *bays inside a block*: a bay had to be clicked
 * into focus, and skipping, tunnelling or re-decking one wrote an override keyed
 * by index. All of it is gone, because a bay is a node now. Configuring one is
 * the ordinary inspector above; deleting, moving, copying and multi-selecting
 * one is the host's own machinery. What is left is the single thing the host
 * cannot do: place the *rest* of the run by coordinate.
 */

const styles = {
  /** `ActionButton`'ın dinlenme dolgusunu ezen onay hâli. Sınıf değil satır içi
   *  stil, çünkü bu paketin Tailwind'i host'un stil dosyasına derlenmiyor. */
  confirm: {
    borderColor: 'color-mix(in oklab, #f59e0b 55%, transparent)',
    background: 'color-mix(in oklab, #f59e0b 16%, transparent)',
  },
  inert: { opacity: 0.45, cursor: 'default' },
} satisfies Record<string, CSSProperties>

/**
 * The rack this panel is editing.
 *
 * `ParametricDescriptor.trailingSection` is typed `ComponentType<{ node: N }>`,
 * but `parametric-inspector.tsx` renders `<TrailingSection />` with no props at
 * all — so the declared `node` arrives `undefined` and the first property read
 * throws. The type is the thing that is wrong, not the call site's intent, and
 * a plugin cannot patch the host.
 *
 * So the node is read the way the inspector itself reads it: whatever is
 * selected. The prop is still preferred when a host does pass one, which costs
 * nothing and means this keeps working if the contract is repaired.
 */
function useInspectedRack(provided?: PalletRackNode): PalletRackNode | null {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const selected = useScene((s) => (selectedId ? s.nodes[selectedId as AnyNodeId] : undefined))
  if (provided) return provided
  if (!selected || (selected as { type?: string }).type !== 'warehouse:pallet-rack') return null
  return selected as unknown as PalletRackNode
}

/**
 * How many nodes one press may create before it has to be asked twice.
 *
 * The pivot budgeted a 15,000 m² warehouse at about two thousand bays, and the
 * two axes multiply: Bays 200 × Rows 50 is 10,000 nodes on one click, five times
 * the whole building. Not forbidden — someone may genuinely want it — but not
 * something to do by accident either, and the number is worth reading twice.
 */
const CONFIRM_ABOVE = 500

export default function RackPanel({ node: provided }: { node?: PalletRackNode }) {
  const spec = useWarehouseStore((s) => s.multiply)
  const setMultiply = useWarehouseStore((s) => s.setMultiply)
  const node = useInspectedRack(provided)
  const unit = useUnit()
  const [confirming, setConfirming] = useState(false)

  // What pressing the button will actually create, not what the spec describes.
  // Bays that already stand where the spec would put one are filtered out, so
  // pressing Multiply on a run that already exists is a no-op rather than a
  // second run stacked invisibly inside the first.
  //
  // SAYIYA abonelik, sözlüğe değil: `s.nodes` kimliği her store yazımında
  // değişiyor ve panel açıkken alakasız her düzenleme bütün paneli yeniden
  // çiziyordu. Selector yazım başına yine koşuyor — maliyeti spec boyutunda,
  // `occupiedPlaces` indeksi yazım başına bir kez ve panelden bağımsız
  // kuruluyor — ama panel yalnız sayı DEĞİŞTİĞİNDE render oluyor.
  const pending = useScene((s) =>
    node ? pendingPlacements(node, spec, s.nodes as Record<string, unknown>).length : 0,
  )

  // The inspector is open for something that is not a rack — or for nothing.
  if (!node) return null
  const extent = runExtent(node, spec)
  const issues = palletRackParametrics.invariants?.flatMap((check) => check(node)) ?? []

  const commit = () => {
    if (pending > CONFIRM_ABOVE && !confirming) {
      setConfirming(true)
      return
    }
    multiplyRack(node, spec)
    setConfirming(false)
  }

  return (
    <>
      {/* The descriptor's invariants, which nothing else renders. The host
          declares `parametrics.invariants` in its types and has no consumer for
          it, so five warnings a rack computes about itself — levels that do not
          fit, pallets with nothing under them, a tunnel that empties the bay —
          were being produced and dropped on the floor. */}
      <IssueList issues={issues} />

      <Capacity node={node} />

      <PanelSection title="Multiply">
        {/*
          Host'un kendi sayı kontrolü. Öncesi elle yazılmış bir `−/kutu/+`
          üçlüsüydü; `SliderControl` sürüklemeyi, tekerleği, ok tuşlarını,
          yazarak girişi ve birim ayrıştırmayı zaten getiriyor — ve bunları
          editördeki her sayıyla aynı biçimde yapıyor.

          `restoreOnCommit={false}`: bu iki sayı `useWarehouseStore`'da yaşıyor,
          sahnede değil. Kontrolün tek-geri-alma numarası (bırakırken eski
          değeri yazıp sonra yenisini yazmak) burada iki gereksiz yazımdan
          ibaret olurdu.
        */}
        <SliderControl
          label="Bays"
          max={200}
          min={1}
          onChange={(bays) => {
            setMultiply({ bays: Math.round(bays) })
            setConfirming(false)
          }}
          precision={0}
          restoreOnCommit={false}
          step={1}
          value={spec.bays}
        />
        <Note>{lengthLabel(extent.width, unit)} genişlik</Note>

        <SliderControl
          label="Rows"
          max={50}
          min={1}
          onChange={(rows) => {
            setMultiply({ rows: Math.round(rows) })
            setConfirming(false)
          }}
          precision={0}
          restoreOnCommit={false}
          step={1}
          value={spec.rows}
        />
        {spec.rows > 1 && <Note>{lengthLabel(extent.depth, unit)} derinlik</Note>}

        {spec.rows > 1 ? (
          <>
            {/* A switch rather than a count. A run either has another run
                against its back or it does not — there is no "how many". */}
            <Field
              hint={spec.backToBack ? 'sırtlar birleşir' : 'her sıra kendi koridorunda'}
              label="Back to back"
            >
              <SegmentedControl
                onChange={(value: string) => setMultiply({ backToBack: value === 'on' })}
                options={[
                  { label: 'Single', value: 'off' },
                  { label: 'Back to back', value: 'on' },
                ]}
                value={spec.backToBack ? 'on' : 'off'}
              />
            </Field>

            {spec.backToBack ? (
              // It had no control at all, while still setting the depth the
              // panel reports and the box the tool collides — an invisible
              // constant governing every back-to-back layout.
              <Field hint={millimetreLabel(spec.backToBackGap, unit)} label="Spine gap">
                <SegmentedControl
                  onChange={(value: string) => setMultiply({ backToBackGap: Number(value) })}
                  options={[
                    { label: '100', value: '0.1' },
                    { label: '200', value: '0.2' },
                    { label: '300', value: '0.3' },
                  ]}
                  value={String(spec.backToBackGap)}
                />
              </Field>
            ) : null}

            {/* The figure that decides how much of a building is racking: a
                turret truck turns in 1.8 m, a reach truck works 3.2, and a
                counterbalanced forklift wants 3.5. */}
            <Field hint={lengthLabel(spec.aisleWidth, unit)} label="Aisle">
              <SegmentedControl
                onChange={(value: string) => setMultiply({ aisleWidth: Number(value) })}
                options={[
                  { label: 'VNA 1.8', value: '1.8' },
                  { label: 'Reach 3.2', value: '3.2' },
                  { label: 'Fork 3.5', value: '3.5' },
                ]}
                value={String(spec.aisleWidth)}
              />
            </Field>
          </>
        ) : null}

        {/* Always a button, in the same place, whether or not there is anything
            to place. Swapping it for a div meant the control the user was
            reaching for moved out from under the cursor as they typed — and the
            click that would have grown the run went to a dead element instead. */}
        <ActionGroup>
          <ActionButton
            disabled={pending === 0}
            label={
              pending === 0
                ? 'Yerleştirilecek yeni göz yok'
                : confirming
                  ? `${pending.toLocaleString()} gözü onayla — ${(pending + 1).toLocaleString()} draw call`
                  : `${pending.toLocaleString()} göz daha yerleştir`
            }
            onClick={commit}
            style={pending === 0 ? styles.inert : confirming ? styles.confirm : undefined}
          />
        </ActionGroup>

        <Note>
          Her göz, bu gözün ayarlarını taşıyan kendi nesnesi olarak yerleşir; hepsini ayrı ayrı
          seçebilir, taşıyabilir, kopyalayabilir ve silebilirsiniz. Yan yana duran gözler dikme
          paylaşır — birini çekip ayırınca kendi dikmesini büyütür.
        </Note>
      </PanelSection>
    </>
  )
}

/**
 * What the bay actually holds.
 *
 * `levelCapacity` was editable, persisted, and read by nothing at all — its own
 * schema comment promised a capacity panel that does not exist. So were
 * `directAccessSlotCount` and `pickingSlotCount`, both defined and never called.
 * They are the numbers a rack is specified *for*, and this is the one place they
 * are being edited.
 *
 * Direct access is called out separately because it is the figure a headline
 * "positions" number hides: on a double-deep bay half the positions cannot be
 * reached until the pallet in front of them is moved.
 */
function Capacity({ node }: { node: PalletRackNode }) {
  const positions = palletSlotCount(node)
  const direct = directAccessSlotCount(node)
  const picking = pickingSlotCount(node)
  // Kendi dolulukSAYISINA abonelik — indeks yazım başına bir kez paylaşılan
  // yoldan kuruluyor (`occupancy.ts`), bu bileşen yalnız sayı değişince
  // render oluyor.
  const occupied = useScene((s) => occupiedSlots(s.nodes as Record<string, unknown>, node.id).size)
  const levels = fittedLevelCount(node)
  const load = levels * node.levelCapacity

  return (
    <PanelSection title="This bay">
      <Figures
        rows={[
          [
            'Pallet positions',
            positions === direct ? `${positions}` : `${positions} · ${direct} direct`,
          ],
          picking > 0 && (['Container positions', `${picking}`] as const),
          ['Occupied', `${occupied}`],
          [
            'Rated load',
            `${node.levelCapacity.toLocaleString()} kg/level · ${(load / 1000).toFixed(1)} t`,
          ],
        ]}
      />
      {/*
        Kaynak beyanı, ölçü gibi görünen tek uydurma sayı için.

        Beş kataloğun hiçbirinde kg yük tablosu yok; `levelCapacity`'nin 3000
        varsayılanı bir ölçüm değil, seçilmiş bir sayı. Panelin bunu "Rated
        load" diye yazıp kaynağını söylememesi, kullanıcının kendi girdiği
        değeri katalog verisi sanmasına yol açar.
      */}
      <Note>
        Yük değeri KATALOG DEĞİL — Mecalux çizelgelerinde kg tablosu yayınlanmamış. Buradaki sayı
        sizin girdiğiniz değerdir; taşıma kapasitesi beyanı olarak kullanılamaz.
      </Note>
    </PanelSection>
  )
}
