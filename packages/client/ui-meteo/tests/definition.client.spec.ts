// @vitest-environment jsdom
/**
 * Stage one, as the registry sees it: the type claims this package's own
 * address scheme, sits in the builtin band, and offers the guide page one entry
 * that opens its kind.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { citationAddress } from '../src/client/address.ts'
import { CITATION_ID, CITATION_KIND, citationDefinition } from '../src/client/definition.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

describe('citationDefinition', () => {
  it('claims its own address scheme and no file address', () => {
    const registry = new SidebarRightTabRegistry(new Context())
    registry.register(citationDefinition(t))
    expect(registry.get(CITATION_KIND)?.id).toBe(CITATION_ID)
    expect(registry.candidates(citationAddress('doc-1', 4)).map(entry => entry.kind)).toEqual([CITATION_KIND])
    expect(registry.candidates('dsh-resource://file/session/s-1/a.md')).toEqual([])
  })

  it('offers the guide page one entry at order 30 that opens the citation kind', () => {
    const registry = new SidebarRightTabRegistry(new Context())
    registry.register(citationDefinition(t))
    const [entry, ...rest] = registry.guide()
    expect(rest).toEqual([])
    expect(entry?.order).toBe(30)
    expect(entry?.kind).toBe(CITATION_KIND)
    expect(entry?.title()).toBe(zh['citation.label'])
    expect(entry?.description?.()).toBe(zh['citation.guide'])
  })

  it('names the chunk in the chip, and falls back to the label for an address it cannot read', () => {
    const definition = citationDefinition(t)
    expect(definition.priority).toBe('builtin')
    expect(definition.title(citationAddress('doc-1', 4))).toBe('段落 4')
    expect(definition.title(`${CITATION_KIND}/nothing`)).toBe(zh['citation.label'])
  })
})
