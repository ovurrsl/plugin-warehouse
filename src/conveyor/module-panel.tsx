'use client'

import type { Issue } from '@pascal-app/core'
import { PanelSection } from '@pascal-app/editor'
import type { ReactNode } from 'react'
import { IssueList } from '../panels/issue-list'
import { Figures } from '../panels/kit'

/**
 * Bir konveyör modülünün okuma paneli — yedi kind için tek gövde.
 *
 * Yedi panel de aynı üç parçayı kendi dosyasında elle çiziyordu: kopyalanmış
 * bir uyarı listesi, `styles.readout` + `styles.label` ikilisiyle yazılmış bir
 * etiket/değer bloğu, ve kesik çizgili bir ipucu paragrafı. Ölçüler yedi
 * dosyada ayrı ayrı duruyordu, yani birinde yapılan bir düzeltme diğer altısını
 * sessizce ayrıştırıyordu — ve tam olarak bu olmuştu: `conveyor-panel` ile
 * `booster-panel` arasında `root` boşluğu aynı, `label` rengi farklıydı.
 *
 * Bölüm host'un kendi `<PanelSection>`'ı. Trailing bölüm host tarafından
 * `<PanelSection>`'ların çıplak kardeşi olarak çizildiği için
 * (`parametric-inspector.tsx:173`) iç boşluğu ve ayracı kendimiz getirmek
 * zorundayız; kendi kartımızı çizmek yerine host'un bileşenini kullanmak
 * panelin üstündeki gruplarla birebir aynı hizayı da beraberinde getiriyor.
 */
export function ModuleReadout({
  children,
  issues,
  rows,
  title,
}: {
  /** Okumanın altına giren serbest içerik — `Note`, ek kontrol, ikinci uyarı. */
  children?: ReactNode
  issues: readonly Issue[]
  rows: ReadonlyArray<readonly [string, ReactNode] | null | false | undefined>
  title: string
}) {
  return (
    <>
      <IssueList issues={issues} />
      <PanelSection title={title}>
        <Figures rows={rows} />
        {children}
      </PanelSection>
    </>
  )
}

/**
 * İki düğüm arasındaki sorunları `Issue`'ya çevirir.
 *
 * `jointProblems` düz metin döndürüyor çünkü bir eklem tek düğümün özelliği
 * değil — `invariants` onu göremez. Yedi panel bu dönüşümü elle yapıyordu ve
 * yedisi de `severity`'yi genişletilmiş `string` olarak bırakıyordu, yani
 * `Issue`'nun ayrım birleşimi (`'warning' | 'error'`) tip denetiminden
 * kaçıyordu — `IssueList`'in kırmızı/sarı ayrımı sessizce hep sarıya düşüyordu.
 */
export function jointIssues(messages: readonly string[], field?: string): Issue[] {
  return messages.map((msg) => ({ field, severity: 'warning', msg }))
}
