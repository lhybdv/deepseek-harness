/** Service frames decode into the facts the session needs, whatever else the envelope carries. */
import { expect, it } from 'vitest'
import { parseRtasrMessage, RtasrTranscript } from '../src/protocol.ts'
import { resultFrame } from './rtasr.fixture.ts'

const LIMIT = 1024

/** One final result frame with the discriminant encoded as the given JSON value. */
function typedFrame(type: string | number): string {
  return JSON.stringify({
    action: 'result',
    code: 0,
    data: { cn: { st: { bg: '0', ed: '480', type, rt: [{ ws: [{ bg: '0', ed: '480', cw: [{ w: '有雨' }] }] }] } } },
  })
}

it('reads the final and interim sentence types', () => {
  expect(parseRtasrMessage(resultFrame({ type: 1, words: ['今天'] }), LIMIT))
    .toEqual({ segment: { final: false, text: '今天' } })
  expect(parseRtasrMessage(typedFrame('0'), LIMIT)).toEqual({ segment: { final: true, text: '有雨' } })
  expect(parseRtasrMessage(typedFrame(0), LIMIT)).toEqual({ segment: { final: true, text: '有雨' } })
})

it.each([
  ['a top-level sessionId', { action: 'action', code: '0', sessionId: 's-1' }, 's-1'],
  ['the sid shorthand', { action: 'started', code: '0', sid: 's-2' }, 's-2'],
  ['a nested sessionId', { msg_type: 'action', data: { sessionId: 's-3' } }, 's-3'],
])('reads %s', (_label, frame, sessionId) => {
  expect(parseRtasrMessage(JSON.stringify(frame), LIMIT)).toEqual({ sessionId })
})

it('ignores envelopes that carry no used fact', () => {
  expect(parseRtasrMessage('{"action":"started","code":"0","data":""}', LIMIT)).toEqual({})
  expect(parseRtasrMessage('{"action":"started","code":"0","sessionId":""}', LIMIT)).toEqual({})
  expect(parseRtasrMessage(resultFrame({ type: 0, words: [] }), LIMIT)).toEqual({})
  expect(parseRtasrMessage('{"data":{"cn":{"st":{"rt":[{"ws":[]}]}}}}', LIMIT)).toEqual({})
})

it.each([
  ['an unparseable frame', 'not json', {}],
  ['a non-object frame', '5', {}],
  ['a null frame', 'null', {}],
  ['a malformed result node', '{"data":{"cn":{"st":{"rt":"none"}}}}', {}],
  ['a result node without data', '{"data":"","cn":{}}', {}],
  ['a result node without a statement', '{"data":{"cn":{}}}', {}],
  ['a statement without results', '{"data":{"cn":{"st":{"type":"0"}}}}', {}],
  ['a result without words', '{"data":{"cn":{"st":{"rt":[{"ws":[]}]}}}}', {}],
  ['words the service typed differently', '{"data":{"cn":{"st":{"type":"0","rt":[7,{"ws":"x"},{"ws":[null]},{"ws":[{"cw":"x"}]},{"ws":[{"cw":[{"w":9},{"w":"ok"}]}]}]}}}}', {}],
] as const)('carries the facts of %s', (_label, raw, expected) => {
  expect(parseRtasrMessage(raw, LIMIT)).toEqual(expected)
})

it('reports service rejections with the service code and description', () => {
  expect(parseRtasrMessage('{"action":"error","code":"10105","desc":"invalid parameter"}', LIMIT))
    .toEqual({ failure: { code: '10105', description: 'invalid parameter' } })
  expect(parseRtasrMessage('{"code":10106}', LIMIT))
    .toEqual({ failure: { code: '10106', description: 'RTASR reported an error' } })
  expect(parseRtasrMessage('{"code":"10107","desc":""}', LIMIT))
    .toEqual({ failure: { code: '10107', description: 'RTASR reported an error' } })
  expect(parseRtasrMessage('{"code":{"nested":true}}', LIMIT))
    .toEqual({ failure: { code: 'invalid-code', description: 'RTASR reported an error' } })
})

it('rejects a frame beyond the configured size limit', () => {
  expect(parseRtasrMessage(resultFrame({ type: 0, words: ['今天'] }), 2)).toEqual({
    failure: { code: 'response-too-large', description: 'RTASR response exceeded the configured size limit' },
  })
})

it('extends the transcript with final sentences and replaces the interim one', () => {
  const transcript = new RtasrTranscript()
  expect(transcript.text()).toBe('')
  transcript.accept({ final: false, text: '今' })
  expect(transcript.text()).toBe('今')
  transcript.accept({ final: false, text: '今天' })
  expect(transcript.text()).toBe('今天')
  transcript.accept({ final: true, text: '今天有雨' })
  expect(transcript.text()).toBe('今天有雨')
  transcript.accept({ final: false, text: '明天' })
  expect(transcript.text()).toBe('今天有雨明天')
})
