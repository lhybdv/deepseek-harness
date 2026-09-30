// @vitest-environment jsdom
/**
 * The brand occupants and the mark they share.
 *
 * The seats disagree about what they pass, so what is asserted here is the
 * mapping: the Sidebar's mark takes an edge, the hero's carries its host class
 * through unchanged (dropping it would break the larger mark geometry), and the
 * name owns its own content. The mark is drawn inline, so the assertion is on the
 * drawn glyph itself rather than on which component was rendered.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import {
  WindPilotHeadline, WindPilotHeroMark, WindPilotName, WindPilotSidebarMark, WindPilotTeamFooter,
  type WindPilotTeamFooterProps,
} from '../src/client/WindPilotBrand.tsx'
import { WindPilotMark } from '../src/client/WindPilotMark.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

afterEach(cleanup)

describe('WindPilotMark', () => {
  it('draws the cloud at the requested edge, labelled for assistive technology', () => {
    const view = render(<WindPilotMark size={34} t={t} />)
    const svg = view.container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('34')
    expect(svg?.getAttribute('height')).toBe('34')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg?.getAttribute('aria-label')).toBe(zh['brand.markLabel'])
    expect(svg?.getAttribute('role')).toBe('img')
    expect(svg?.querySelector('path')?.getAttribute('d')?.startsWith('M19.35 10.04')).toBe(true)
  })

  it('passes a host class through, and omits the attribute when the seat supplies none', () => {
    const withClass = render(<WindPilotMark size={16} className="host-fish" t={t} />)
    expect(withClass.container.querySelector('svg')?.getAttribute('class')).toBe('host-fish')
    cleanup()
    const without = render(<WindPilotMark size={16} t={t} />)
    expect(without.container.querySelector('svg')?.getAttribute('class')).toBeNull()
  })
})

describe('brand occupants', () => {
  it('fills the Sidebar mark with the cloud at the seat\'s edge', () => {
    const view = render(<WindPilotSidebarMark size={22} t={t} />)
    const svg = view.container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('22')
    expect(svg?.getAttribute('class')).toBeNull()
  })

  it('carries the hero\'s geometry class into the mark', () => {
    const view = render(<WindPilotHeroMark size={34} className="hero-fish" t={t} />)
    const svg = view.container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('34')
    expect(svg?.getAttribute('class')).toBe('hero-fish')
  })

  it('renders the headline as the product name', () => {
    const view = render(<WindPilotHeadline t={t} />)
    expect(view.container.textContent).toBe(zh['brand.headline'])
  })

  it('renders the wordmark above the platform tagline', () => {
    const view = render(<WindPilotName t={t} />)
    expect(view.container.textContent).toBe(`${zh['brand.wordmark']}${zh['brand.tagline']}`)
  })

  it('renders the team footer for the composer dock', () => {
    // The footer seat passes no owner share, so its props carry the whole
    // standard kit (session, workspace, panel, and resource hooks); the copy is
    // all this occupant reads.
    const props = { t } as unknown as WindPilotTeamFooterProps
    const view = render(<WindPilotTeamFooter {...props} />)
    expect(view.container.textContent).toBe(zh['team.footer'])
  })
})
