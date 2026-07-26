#!/usr/bin/env bun
/**
 * Rewrite the generated blocks of README.md, and nothing else.
 *
 * Three blocks are generated — badges, the architecture diagram, and the tail
 * of the changelog. Everything else in that file is written by hand and stays
 * that way, deliberately: the install section carries findings that took real
 * work to establish (why `github:` fails for a private repo, why a Tailwind
 * class written in this package is silently never compiled), and a generator
 * that overwrote them with boilerplate would delete knowledge while looking
 * like maintenance.
 *
 * Idempotent by construction: it writes only when a block's contents actually
 * change, so a push that alters nothing generated produces no commit.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const README = join(ROOT, 'README.md')
const CHANGELOG = join(ROOT, 'CHANGELOG.md')

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const REPO = 'ovurrsl/plugin-warehouse'

/**
 * Replace the text between `<!-- NAME:START -->` and `<!-- NAME:END -->`.
 *
 * A missing marker pair is an error rather than a silent skip. The whole point
 * of the markers is that the file and this script agree on what is generated;
 * if they have drifted, saying so is the only useful behaviour.
 */
function fillBlock(source, name, body) {
  const start = `<!-- ${name}:START -->`
  const end = `<!-- ${name}:END -->`
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`)
  if (!pattern.test(source)) {
    throw new Error(`README.md has no ${start} … ${end} block`)
  }
  return source.replace(pattern, `${start}\n${body.trim()}\n${end}`)
}

const badges = [
  `[![CI](https://github.com/${REPO}/actions/workflows/ci.yml/badge.svg)](https://github.com/${REPO}/actions/workflows/ci.yml)`,
  `[![CodeQL](https://github.com/${REPO}/actions/workflows/codeql.yml/badge.svg)](https://github.com/${REPO}/actions/workflows/codeql.yml)`,
  `![Version](https://img.shields.io/badge/version-${pkg.version}-blue)`,
  `![Plugin API](https://img.shields.io/badge/plugin%20API-v1-8957e5)`,
  `![License](https://img.shields.io/github/license/${REPO})`,
  `![Last commit](https://img.shields.io/github/last-commit/${REPO})`,
].join('\n')

/**
 * The dependency arrow, which is the one thing about this package that is easy
 * to get wrong and expensive to debug: everything host-owned is read through a
 * single guarded module, and the plugin's own figures never touch it.
 */
const architecture = `\`\`\`mermaid
flowchart TD
  subgraph host["Pascal host"]
    core["@pascal-app/core<br/>nodeRegistry · useScene"]
    editor["@pascal-app/editor<br/>panels · controls"]
    viewer["@pascal-app/viewer<br/>R3F canvas"]
  end

  subgraph plugin["@ovurrsl/plugin-warehouse"]
    manifest["index.ts<br/><i>manifest barrel — SSR-eager</i>"]
    adapter["host-adapter.ts<br/><i>every host-schema read,<br/>behind runtime guards</i>"]
    kinds["warehouse: node kinds<br/>schema · parts · slots"]
    geom["geometry-builder.ts<br/><i>one merged mesh per shape</i>"]
    panels["panels/<br/><i>inline styles, host CSS vars</i>"]
    store["store.ts<br/><i>plugin-owned zustand</i>"]
  end

  manifest -->|"Plugin · NodeDefinition"| core
  panels -->|"EditorHostPanel"| editor
  kinds --> geom
  geom -->|"renderer"| viewer
  panels --> store
  store --> kinds
  adapter -.->|"guarded reads only"| core
  kinds -.->|"area figures"| adapter

  classDef owned fill:#1e3a8a22,stroke:#1e40af;
  classDef guarded fill:#c2410c22,stroke:#c2410c;
  class manifest,kinds,geom,panels,store owned;
  class adapter guarded;
\`\`\`

Capacity figures come entirely from this plugin's own schemas, so a host change
cannot break them. Only the *area* figures cross the dashed line, and those
degrade to "no data" rather than throwing.`

/** The most recent released section of the changelog, or the unreleased one. */
function latestChangelog() {
  let text
  try {
    text = readFileSync(CHANGELOG, 'utf8')
  } catch {
    return '_No changelog yet — run `bunx git-cliff --output CHANGELOG.md`._'
  }
  const sections = text.split(/^## /m).slice(1)
  if (sections.length === 0) return '_No entries yet._'
  const [first] = sections
  const trimmed = `## ${first}`.trimEnd()
  // Keep the block short: the README is an entry point, and a full changelog
  // pasted into it buries everything below.
  const lines = trimmed.split('\n')
  const clipped = lines.length > 24 ? [...lines.slice(0, 24), '', '…'] : lines
  return `${clipped.join('\n')}\n\nFull history in [CHANGELOG.md](CHANGELOG.md).`
}

const before = readFileSync(README, 'utf8')
let after = before
after = fillBlock(after, 'BADGES', badges)
after = fillBlock(after, 'ARCH', architecture)
after = fillBlock(after, 'CHANGELOG', latestChangelog())

if (after === before) {
  console.log('README.md — generated blocks already current')
} else {
  writeFileSync(README, after)
  console.log('README.md — generated blocks updated')
}
