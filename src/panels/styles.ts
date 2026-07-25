import type { CSSProperties } from 'react'

/**
 * Styling for the parts of the panel the host does not export a component for.
 *
 * Everything here resolves a host CSS variable (`--sidebar-foreground`,
 * `--sidebar-border`, …) rather than a literal colour, so the panel follows the
 * host's theme — including light/dark switches and any future restyle — exactly
 * as a host-owned component would. The variables are declared on `:root` and
 * `.dark` by the host and resolved by the browser at paint time, so there is no
 * build-time coupling at all.
 *
 * Why not Tailwind utility classes: Tailwind v4's scanner does not follow
 * symlinked directories, and a package installed from a git URL always lands as
 * a symlink into the package manager's store. Utility classes written inside
 * this package are therefore never compiled into the host's stylesheet — and
 * the failure is silent, producing an unstyled panel with no error. Verified
 * against this repo: pointing `@source` at the store's real path emits the
 * classes, pointing it at the symlink emits nothing.
 *
 * Keep host components wherever one exists. Only reach for this module when it
 * doesn't.
 */

const FG = 'var(--sidebar-foreground)'
const BORDER = 'var(--sidebar-border)'
const ACCENT = 'var(--sidebar-accent)'
const RING = 'var(--sidebar-ring)'

/** `color-mix` keeps the alpha ramp on the theme variable instead of baking a
 * literal, so a theme change carries through the muted text too. */
const fade = (percent: number) => `color-mix(in oklab, ${FG} ${percent}%, transparent)`

export const tokens = {
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    padding: '0.75rem 1rem',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
  },
  countChip: {
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: ACCENT,
    padding: '0.125rem 0.5rem',
    fontSize: '0.6875rem',
    color: fade(70),
  },
  sectionBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    padding: '0 1rem 0.75rem',
  },
  blurb: {
    margin: 0,
    fontSize: '0.75rem',
    lineHeight: 1.5,
    color: fade(45),
  },
  empty: {
    borderRadius: '0.5rem',
    border: `1px dashed ${BORDER}`,
    padding: '0.5rem 0.75rem',
    fontSize: '0.75rem',
    lineHeight: 1.5,
    color: fade(40),
  },
  tileIcon: {
    color: fade(70),
  },
  tileLabel: {
    fontSize: '0.75rem',
    fontWeight: 500,
    color: FG,
  },
} satisfies Record<string, CSSProperties>

export const tileGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '0.5rem',
}

export function tile(selected: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    alignItems: 'flex-start',
    borderRadius: '0.75rem',
    border: `1px solid ${selected ? RING : BORDER}`,
    backgroundColor: selected ? ACCENT : 'transparent',
    padding: '0.625rem',
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'border-color 150ms, background-color 150ms',
  }
}
