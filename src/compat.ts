/**
 * Boot-time probe of the host features this plugin reads but does not own.
 *
 * The plugin is built to survive being dropped into a newer editor: contract
 * symbols are version-guarded, and everything else goes through `host-adapter`
 * behind runtime guards that fail soft. Failing soft is only useful if you can
 * see it happen — otherwise a renamed host field looks like "the numbers are
 * zero for some reason". This prints one block to the dev console saying
 * exactly which optional reads are live.
 *
 * Console only, by design: it is a developer diagnostic, not product UI.
 */

import { nodeRegistry, useScene } from '@pascal-app/core'
import { asLevel, asSlab } from './host-adapter'
import { PLUGIN_ID } from './plugin-id'

export type ProbeStatus = 'ok' | 'degraded' | 'missing'

export type Probe = {
  key: string
  status: ProbeStatus
  detail: string
}

function isDev(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env
  return env?.NODE_ENV !== 'production'
}

function probeRegistry(): Probe {
  const kinds: string[] = []
  try {
    for (const [kind] of nodeRegistry.entries()) {
      if (kind.startsWith('warehouse:')) kinds.push(kind)
    }
  } catch (error) {
    return { key: 'node registry', status: 'missing', detail: describe(error) }
  }
  if (kinds.length === 0) {
    return { key: 'node registry', status: 'degraded', detail: 'no warehouse kinds registered yet' }
  }
  return {
    key: 'node registry',
    status: 'ok',
    detail: `${kinds.length} kinds: ${kinds.join(', ')}`,
  }
}

function probeScene(): { probe: Probe; nodes: Readonly<Record<string, unknown>> } {
  try {
    const state = useScene.getState() as { nodes?: unknown }
    const nodes = state.nodes
    if (!nodes || typeof nodes !== 'object') {
      return {
        probe: { key: 'useScene.nodes', status: 'missing', detail: 'not an object' },
        nodes: {},
      }
    }
    const record = nodes as Readonly<Record<string, unknown>>
    const count = Object.keys(record).length
    return {
      probe: { key: 'useScene.nodes', status: 'ok', detail: `${count} nodes readable` },
      nodes: record,
    }
  } catch (error) {
    return {
      probe: { key: 'useScene.nodes', status: 'missing', detail: describe(error) },
      nodes: {},
    }
  }
}

/**
 * The highest-risk read in the plugin: host node schemas are not part of the
 * plugin contract. Reports how many slabs/levels actually survive the adapter
 * guards, so a schema change shows up as "0 of 7 readable" instead of as a
 * silently empty area figure.
 */
function probeHostShapes(nodes: Readonly<Record<string, unknown>>): Probe[] {
  let slabTotal = 0
  let slabOk = 0
  let levelTotal = 0
  let levelOk = 0

  for (const node of Object.values(nodes)) {
    const type = (node as { type?: unknown } | null)?.type
    if (type === 'slab') {
      slabTotal++
      if (asSlab(node)) slabOk++
    } else if (type === 'level') {
      levelTotal++
      if (asLevel(node)) levelOk++
    }
  }

  return [
    shapeProbe('slab polygon', slabOk, slabTotal),
    shapeProbe('level children', levelOk, levelTotal),
  ]
}

function shapeProbe(key: string, ok: number, total: number): Probe {
  if (total === 0) return { key, status: 'ok', detail: 'none in scene' }
  if (ok === total) return { key, status: 'ok', detail: `${ok}/${total} readable` }
  if (ok === 0) {
    return { key, status: 'missing', detail: `0/${total} readable — host schema changed?` }
  }
  return { key, status: 'degraded', detail: `${ok}/${total} readable` }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function runHostProbes(): Probe[] {
  const scene = probeScene()
  return [probeRegistry(), scene.probe, ...probeHostShapes(scene.nodes)]
}

const GLYPH: Record<ProbeStatus, string> = { ok: '✅', degraded: '⚠️', missing: '❌' }

let reported = false

/** Print the probe table once per session. Repeat calls are no-ops. */
export function reportHostCompatibility(): void {
  if (reported || !isDev() || typeof console === 'undefined') return
  reported = true
  const probes = runHostProbes()
  const worst = probes.some((p) => p.status === 'missing')
    ? 'missing'
    : probes.some((p) => p.status === 'degraded')
      ? 'degraded'
      : 'ok'
  console.groupCollapsed(`[${PLUGIN_ID}] host compatibility ${GLYPH[worst]}`)
  for (const probe of probes) {
    console.info(`${GLYPH[probe.status]} ${probe.key} — ${probe.detail}`)
  }
  console.groupEnd()
}
