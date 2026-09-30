// @vitest-environment jsdom
/**
 * The shared row chrome: the hidden lifecycle word, the leading slot and its
 * disclosure crossfade, the expansion state and its button/keyboard contract,
 * the generic input/output fallback body, and the inspect affordance.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { KeyboardEvent, ReactNode } from 'react'
import {
  MeteoGenericBody, MeteoInspectButton, disclosureLeading, disclosureProps, leadingFor, stateStatus, useDisclosure,
  type MeteoStateKeys,
} from '../src/client/meteo-chrome.tsx'
import { zh } from '../src/client/locales.ts'
import { t, preTexts } from './fixtures.client.ts'

const KEYS: MeteoStateKeys = {
  running: 'consult.running', failed: 'consult.failed', stopped: 'consult.stopped',
}

const ICON: ReactNode = <span data-icon />

afterEach(cleanup)

describe('stateStatus', () => {
  it('announces the lifecycle word for every non-ok state', () => {
    expect(stateStatus('running', KEYS, t)).toBe(zh['consult.running'])
    expect(stateStatus('error', KEYS, t)).toBe(zh['consult.failed'])
    expect(stateStatus('stopped', KEYS, t)).toBe(zh['consult.stopped'])
  })

  it('announces nothing for a successful result', () => {
    expect(stateStatus('ok', KEYS, t)).toBeNull()
  })
})

describe('leadingFor', () => {
  it('shows the lifecycle dot for a non-ok state and the tool glyph at rest', () => {
    const running = render(<div>{leadingFor('running', ICON)}</div>)
    expect(running.container.querySelector('[data-state="ongoing"]')).toBeTruthy()
    const error = render(<div>{leadingFor('error', ICON)}</div>)
    expect(error.container.querySelector('[data-state="error"]')).toBeTruthy()
    const stopped = render(<div>{leadingFor('stopped', ICON)}</div>)
    expect(stopped.container.querySelector('[data-state="warning"]')).toBeTruthy()
    const ok = render(<div>{leadingFor('ok', ICON)}</div>)
    expect(ok.container.querySelector('[data-icon]')).toBeTruthy()
    expect(ok.container.querySelector('[data-state]')).toBeNull()
  })
})

describe('disclosureLeading', () => {
  it('shows only the chevron while the body is open', () => {
    const view = render(<div>{disclosureLeading('ok', true, true, ICON)}</div>)
    expect(view.container.querySelectorAll('svg')).toHaveLength(1)
    expect(view.container.querySelector('[data-icon]')).toBeNull()
  })

  it('shows the resting glyph alone when the row carries no body', () => {
    const view = render(<div>{disclosureLeading('ok', false, false, ICON)}</div>)
    expect(view.container.querySelector('[data-icon]')).toBeTruthy()
    expect(view.container.querySelector('svg')).toBeNull()
  })

  it('crossfades the glyph into a hover chevron for an expandable row', () => {
    const view = render(<div>{disclosureLeading('ok', false, true, ICON)}</div>)
    expect(view.container.querySelector('[data-icon]')).toBeTruthy()
    expect(view.container.querySelectorAll('svg')).toHaveLength(1)
  })

  it('keeps the lifecycle dot as the idle glyph of a non-ok expandable row', () => {
    const view = render(<div>{disclosureLeading('running', false, true, ICON)}</div>)
    expect(view.container.querySelector('[data-state="ongoing"]')).toBeTruthy()
    expect(view.container.querySelectorAll('svg')).toHaveLength(2)
  })
})

describe('useDisclosure', () => {
  function Probe({ expandable }: { expandable: boolean }) {
    const { open, toggle } = useDisclosure(expandable)
    return <button type="button" data-open={String(open)} onClick={toggle}>flip</button>
  }

  it('opens and closes on the toggle for an expandable row', () => {
    const view = render(<Probe expandable />)
    const button = view.getByRole('button')
    expect(button.getAttribute('data-open')).toBe('false')
    fireEvent.click(button)
    expect(button.getAttribute('data-open')).toBe('true')
    fireEvent.click(button)
    expect(button.getAttribute('data-open')).toBe('false')
  })

  it('never opens a row that carries no body', () => {
    const view = render(<Probe expandable={false} />)
    const button = view.getByRole('button')
    fireEvent.click(button)
    expect(button.getAttribute('data-open')).toBe('false')
  })
})

describe('disclosureProps', () => {
  it('is empty for a row that carries no body', () => {
    expect(disclosureProps(false, false, vi.fn())).toEqual({})
  })

  it('carries button semantics and the expansion flip', () => {
    const toggle = vi.fn()
    const props = disclosureProps(true, true, toggle)
    expect(props.role).toBe('button')
    expect(props.tabIndex).toBe(0)
    expect(props['aria-expanded']).toBe(true)
    props.onClick?.()
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('flips on Enter and Space, and ignores every other key', () => {
    const toggle = vi.fn()
    const props = disclosureProps(false, true, toggle)
    const press = (key: string) => {
      const preventDefault = vi.fn()
      const event = { key, preventDefault } as unknown as KeyboardEvent<HTMLDivElement>
      props.onKeyDown?.(event)
      return preventDefault
    }
    expect(press('Escape')).not.toHaveBeenCalled()
    expect(toggle).not.toHaveBeenCalled()
    expect(press('Enter')).toHaveBeenCalledTimes(1)
    expect(press(' ')).toHaveBeenCalledTimes(1)
    expect(toggle).toHaveBeenCalledTimes(2)
  })
})

describe('MeteoGenericBody', () => {
  it('renders both the input and the output of a failing call', () => {
    const view = render(<MeteoGenericBody argsText={'{\n  "a": 1\n}'} output="boom" error t={t} />)
    expect(view.getByText(zh['generic.input'])).toBeTruthy()
    expect(view.getByText(zh['generic.output'])).toBeTruthy()
    expect(preTexts(view.container)).toEqual(['{\n  "a": 1\n}', 'boom'])
    expect(view.container.querySelector('pre[data-error="true"]')?.textContent).toBe('boom')
  })

  it('marks a successful output as not an error', () => {
    const view = render(<MeteoGenericBody argsText={null} output="完成" error={false} t={t} />)
    expect(view.queryByText(zh['generic.input'])).toBeNull()
    expect(preTexts(view.container)).toEqual(['完成'])
    expect(view.container.querySelector('pre')?.getAttribute('data-error')).toBeNull()
  })

  it('omits the output when the result carried no text', () => {
    const view = render(<MeteoGenericBody argsText="args" output={null} error={false} t={t} />)
    expect(view.getByText(zh['generic.input'])).toBeTruthy()
    expect(view.queryByText(zh['generic.output'])).toBeNull()
    expect(preTexts(view.container)).toEqual(['args'])
  })

  it('renders nothing but the empty card when there is neither input nor output', () => {
    const view = render(<MeteoGenericBody argsText={null} output={null} error={false} t={t} />)
    expect(view.container.textContent).toBe('')
  })
})

describe('MeteoInspectButton', () => {
  it('is absent without an inspect handle', () => {
    const view = render(<MeteoInspectButton inspect={undefined} t={t} />)
    expect(view.container.textContent).toBe('')
  })

  it('inspects the call when the owner supplied a handle', () => {
    const inspect = vi.fn()
    const view = render(<MeteoInspectButton inspect={inspect} t={t} />)
    expect(view.getByRole('button').textContent).toBe(zh['card.inspect'])
    fireEvent.click(view.getByRole('button'))
    expect(inspect).toHaveBeenCalledTimes(1)
  })
})
