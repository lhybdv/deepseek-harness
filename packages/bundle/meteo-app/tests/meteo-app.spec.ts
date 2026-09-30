/**
 * The bundle's substance is its patch file: `dsh.bundle.patch` must name a real,
 * parseable patch list, every row it inserts must be a dependency the manifest
 * declares, and the deployment-varying values must stay `!!js` expressions
 * rather than baked paths.
 *
 * The rows are asserted in order, because order is the deployment's contract:
 * `meteo-corpus` and `meteo-data` provide the services the two tool rows inject,
 * the controller reads both, and the browser rows are inert host entries whose
 * only job is to appear in the client roster.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { apply } from '../src/index.ts'

/** The bundle's declared plugin row, as the patch file carries it. */
interface Row {
  readonly id?: string
  readonly name?: string
  readonly config?: Record<string, unknown>
  readonly disabled?: unknown
}

/** The manifest fields this spec reads. */
interface Manifest {
  readonly dependencies?: Record<string, string>
  readonly dsh?: { readonly bundle?: { readonly patch?: string } }
}

const root = fileURLToPath(new URL('..', import.meta.url))

/** The flat row list of one patch list, skipping anything that is not one. */
function insertRows(parsed: readonly unknown[]): Row[] {
  const rows: Row[] = []
  for (const patch of parsed) {
    if (typeof patch !== 'object' || patch === null || !('insert' in patch)) continue
    const insert = patch.insert
    if (!Array.isArray(insert)) continue
    for (const row of insert) {
      if (typeof row === 'object' && row !== null) rows.push(row as Row)
    }
  }
  return rows
}

/** The manifest, and the rows its patch file inserts. */
function bundle(): { manifest: Manifest; rows: readonly Row[] } {
  // A JSON file is a boundary; the shape above is this spec's own reading of it.
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as Manifest
  const patch = manifest.dsh?.bundle?.patch
  if (patch === undefined) throw new Error('the manifest must name its patch file')
  const parsed = yaml.load(readFileSync(resolve(root, patch), 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new TypeError('the patch must parse to a patch list')
  return { manifest, rows: insertRows(parsed) }
}

describe('dsh-meteo-app bundle', () => {
  it('keeps the host Loader entry inert', () => {
    expect(apply).not.toThrow()
  })

  it('declares a parseable patch list through the dsh.bundle.patch manifest field', () => {
    const { manifest, rows } = bundle()
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    // Both seams first, then the tools that inject them, then the Remote
    // surface, then the two browser surfaces, then the brand that fills the
    // shell's generic brand seats.
    expect(rows.map(row => row.id)).toEqual([
      'meteo-corpus', 'meteo-data', 'tool-corpus', 'tool-meteo', 'meteo-controller', 'ui-meteo', 'ui-meteo-chat',
      'ui-brand-windpilot',
    ])
    expect(rows.map(row => row.name)).toEqual([
      '@deepseek-ai/dsh-meteo-corpus',
      '@deepseek-ai/dsh-meteo-data',
      '@deepseek-ai/dsh-tool-corpus',
      '@deepseek-ai/dsh-tool-meteo',
      '@deepseek-ai/dsh-api-meteo-controller',
      '@deepseek-ai/dsh-client-ui-meteo',
      '@deepseek-ai/dsh-client-ui-meteo-chat',
      '@deepseek-ai/dsh-client-ui-brand-windpilot',
    ])
    // Every mounted row must be a declared dependency, or a published install
    // would fail to resolve it; and an unlisted dependency would ship a package
    // the patch never mounts.
    expect(Object.keys(manifest.dependencies ?? {}).sort())
      .toEqual([...new Set(rows.map(row => row.name))].sort())
  })

  it('leaves the deployment-varying seam values to the deployment', () => {
    const { rows } = bundle()
    const corpus = rows.find(row => row.id === 'meteo-corpus')
    const data = rows.find(row => row.id === 'meteo-data')
    // The index file and the published data bundle are both host paths: a baked
    // literal would ship one machine's layout inside a published package.
    expect(corpus?.config?.['path']).toEqual({ __jsExpr: "dshHomePath('meteo', 'corpus.v1.sqlite')" })
    expect(data?.config?.['source']).toBe('fixture')
    expect(data?.config?.['fixtureDir']).toEqual({ __jsExpr: "dshHomePath('meteo', 'fixtures')" })
    expect(data?.config?.['timeoutMs']).toBe(15000)
    expect(rows.filter(row => row.disabled !== undefined)).toEqual([])
  })
})
