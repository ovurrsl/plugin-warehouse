'use client'

import { Icon } from '@iconify/react'
import type { Issue } from '@pascal-app/core'
import type { CSSProperties } from 'react'

/**
 * The one place a descriptor's `invariants` become something a user can read.
 *
 * `parametrics.invariants` is declared on the host's `NodeDefinition` and read
 * by nothing: grep the editor for it and the only hit is the type definition.
 * So a kind that declares invariants and does not draw them itself computes its
 * warnings on every render and throws them away — including anything at
 * `severity: 'error'`. Seven of this pack's kinds already drew their own list;
 * `pallet` and `route` did not, which is why a drum that does not fit a quarter
 * pallet drew nothing and said nothing, and why a route's whole aisle-width
 * reading — the reason that kind exists — never reached the panel.
 *
 * Extracted rather than copied a ninth time. It takes the issues rather than
 * the descriptor so the caller stays free to append the ones no single node can
 * compute (the conveyor's joint problems are between two nodes).
 */

const styles = {
  issues: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.375rem',
    borderRadius: '0.5rem',
    border: '1px solid color-mix(in oklab, #f59e0b 40%, transparent)',
    background: 'color-mix(in oklab, #f59e0b 10%, transparent)',
    padding: '0.5rem 0.625rem',
    /**
     * Kendi yatay boşluğunu taşıyor, çünkü bir uyarı bir ayar DEĞİL: her
     * bölümün üstünde, `PanelSection`'ın dışında duruyor. Ölçü host'un
     * `p-3`'ünün aynısı, böylece altındaki bölümlerle aynı hizada başlıyor.
     */
    margin: '0.75rem 0.75rem 0',
  },
  /**
   * Errors are bordered red, warnings amber — but the container is amber
   * whenever anything is present, because a panel that turns red the moment a
   * single measurement is out of band reads as a compliance verdict. This pack
   * deliberately does not issue those: see the route descriptor, where every
   * message is a measurement or a citation and never a pass/fail.
   */
  error: {
    borderColor: 'color-mix(in oklab, #ef4444 45%, transparent)',
    background: 'color-mix(in oklab, #ef4444 10%, transparent)',
  },
  issue: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.375rem',
    margin: 0,
    fontSize: '0.6875rem',
    lineHeight: 1.45,
    color: 'var(--foreground)',
  },
} satisfies Record<string, CSSProperties>

export function IssueList({ issues }: { issues: readonly Issue[] }) {
  if (issues.length === 0) return null
  const hasError = issues.some((issue) => issue.severity === 'error')

  return (
    <div style={hasError ? { ...styles.issues, ...styles.error } : styles.issues}>
      {issues.map((issue) => (
        <p
          // Field alone is not unique — a kind may report two things about one
          // field — so the message is part of the key.
          key={`${issue.field ?? ''}:${issue.msg}`}
          style={styles.issue}
        >
          <Icon
            height={12}
            icon={issue.severity === 'error' ? 'lucide:octagon-alert' : 'lucide:triangle-alert'}
            style={{ flexShrink: 0, marginTop: '0.125rem' }}
            width={12}
          />
          <span>{issue.msg}</span>
        </p>
      ))}
    </div>
  )
}
