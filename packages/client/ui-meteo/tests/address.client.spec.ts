/**
 * The citation address: what a consultation row opens, and what the tab body
 * reads back out of it.
 *
 * The document id is opaque text the corpus minted, so the round trip is the
 * property that matters — an id carrying a separator, a space, or a fragment
 * character must come back as itself, and an address this package did not write
 * must be refused rather than half-read.
 */
import { describe, expect, it } from 'vitest'
import { CITATION_PREFIX, citationAddress, parseCitationAddress } from '../src/client/address.ts'

describe('citation addresses', () => {
  it('keeps a document id carrying separators and reserved characters as one segment', () => {
    const address = citationAddress('a/b c#d?e', 3)
    expect(address).toBe(`${CITATION_PREFIX}a%2Fb%20c%23d%3Fe/3`)
    expect(parseCitationAddress(address)).toEqual({ docId: 'a/b c#d?e', ordinal: 3 })
  })

  it('reads chunk zero like any other ordinal', () => {
    expect(parseCitationAddress(citationAddress('doc-1', 0))).toEqual({ docId: 'doc-1', ordinal: 0 })
  })

  it('refuses an address another tab type owns', () => {
    expect(parseCitationAddress('dsh-resource://file/session/s-1/a.md')).toBeNull()
  })

  it('refuses a citation address with no chunk separator', () => {
    expect(parseCitationAddress(`${CITATION_PREFIX}doc-1`)).toBeNull()
  })

  it('refuses a citation address whose separator leaves no document', () => {
    expect(parseCitationAddress(`${CITATION_PREFIX}/3`)).toBeNull()
  })

  it('refuses an ordinal that is not a non-negative safe integer', () => {
    expect(parseCitationAddress(`${CITATION_PREFIX}doc-1/-1`)).toBeNull()
    expect(parseCitationAddress(`${CITATION_PREFIX}doc-1/1.5`)).toBeNull()
    expect(parseCitationAddress(`${CITATION_PREFIX}doc-1/two`)).toBeNull()
  })

  it('refuses a document id whose percent sequences are malformed', () => {
    expect(parseCitationAddress(`${CITATION_PREFIX}%E0%A4%A/3`)).toBeNull()
  })
})
