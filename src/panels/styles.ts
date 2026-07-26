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
 * against the editor repo: pointing `@source` at the store's real path emits
 * the classes, pointing it at the symlink emits nothing.
 *
 * Compose host components wherever one exists — `SegmentedControl`,
 * `SliderControl`, `ToggleControl`, `ActionButton`. Note that `PanelWrapper`
 * and `PanelSection` are *inspector* chrome (title bar, drag handle, collapse
 * affordance, fixed width); a left-rail panel is a plain scroll container and
 * must not use them.
 */

const FG = 'var(--sidebar-foreground)'
const BORDER = 'var(--sidebar-border)'
const ACCENT = 'var(--sidebar-accent)'
const RING = 'var(--sidebar-ring)'

/** Keeps the alpha ramp on the theme variable instead of baking a literal, so a
 * theme change carries through the muted text too. */
const fade = (percent: number) => `color-mix(in oklab, ${FG} ${percent}%, transparent)`

export const tokens = {
  /** Root of a left-rail panel: a plain full-height scroll container. The rail
   * supplies the chrome — see the note above about PanelWrapper. */
  root: {
    display: 'flex',
    height: '100%',
    flexDirection: 'column',
    gap: '1rem',
    overflowY: 'auto',
    padding: '1rem',
    color: FG,
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
  },
  title: {
    margin: 0,
    fontSize: '1rem',
    fontWeight: 600,
  },
  countChip: {
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: ACCENT,
    padding: '0.125rem 0.5rem',
    fontSize: '0.75rem',
    color: fade(70),
  },
  sections: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  sectionIcon: {
    color: fade(60),
  },
  sectionTitle: {
    margin: 0,
    fontSize: '0.75rem',
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: fade(80),
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
  tileGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '0.5rem',
  },
  tileIcon: {
    color: fade(70),
  },
  tileLabel: {
    fontSize: '0.75rem',
    fontWeight: 500,
    color: FG,
  },

  // ── The statistics readout ───────────────────────────────────────────────
  // Two columns, never three: the rail is 256 px, and a third column would
  // either wrap or truncate the one number the user came to read.
  figures: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  figureRow: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '0.5rem',
  },
  figureLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
    fontSize: '0.6875rem',
    color: fade(60),
  },
  figureValue: {
    fontSize: '0.875rem',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    color: FG,
  },
  figureUnit: {
    marginLeft: '0.25rem',
    fontSize: '0.625rem',
    fontWeight: 400,
    color: fade(45),
  },
  figureNote: {
    margin: '0 0 0 1.375rem',
    fontSize: '0.625rem',
    lineHeight: 1.45,
    color: fade(40),
  },
  disclosure: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
    width: '100%',
    border: 'none',
    background: 'transparent',
    padding: '0.25rem 0',
    fontSize: '0.6875rem',
    color: fade(60),
    cursor: 'pointer',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: '0.375rem',
    border: `1px solid ${BORDER}`,
    overflow: 'hidden',
  },
  rowArea: {
    marginLeft: 'auto',
    flexShrink: 0,
    fontVariantNumeric: 'tabular-nums',
    color: fade(45),
  },
  advisory: {
    display: 'flex',
    gap: '0.375rem',
    borderRadius: '0.375rem',
    border: '1px solid color-mix(in oklab, #e8a13a 45%, transparent)',
    background: 'color-mix(in oklab, #e8a13a 10%, transparent)',
    padding: '0.375rem 0.5rem',
    fontSize: '0.625rem',
    lineHeight: 1.45,
    color: FG,
  },
} satisfies Record<string, CSSProperties>

/** A row in one of the two inline pickers. No host `Popover`: it is not on the
 *  editor package's public surface, and a floating layer over a 256 px rail
 *  overflows it. */
export function listRow(selected: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    width: '100%',
    border: 'none',
    borderBottom: `1px solid ${BORDER}`,
    background: selected ? ACCENT : 'transparent',
    padding: '0.375rem 0.5rem',
    fontSize: '0.6875rem',
    textAlign: 'left',
    color: selected ? FG : fade(65),
    cursor: 'pointer',
  }
}

export function checkbox(checked: boolean): CSSProperties {
  return {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '0.75rem',
    height: '0.75rem',
    borderRadius: '0.1875rem',
    border: `1px solid ${checked ? RING : BORDER}`,
    background: checked ? RING : 'transparent',
    fontSize: '0.5rem',
    lineHeight: 1,
    color: 'var(--sidebar-accent)',
  }
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
