/** Signing follows the RTASR parameter contract: sorted, percent-encoded, HMAC-SHA1. */
import { createHmac } from 'node:crypto'
import { expect, it } from 'vitest'
import { beijingTimestamp, buildRtasrUrl, signParameters, type RtasrAuth } from '../src/signer.ts'

const AUTH: RtasrAuth = {
  appId: 'app',
  accessKeyId: 'key',
  accessKeySecret: 'secret',
  baseWsUrl: 'wss://service.example/ast/communicate/v1',
}

it('formats the signed timestamp as Beijing wall-clock time', () => {
  expect(beijingTimestamp(new Date('2026-10-01T00:00:00.000Z'))).toBe('2026-10-01T08:00:00+0800')
  expect(beijingTimestamp(new Date('2026-09-30T20:30:05.750Z'))).toBe('2026-10-01T04:30:05+0800')
})

it('signs the sorted, percent-encoded parameter list and skips empty values', () => {
  expect(signParameters('secret', { b: '2', a: '1', empty: '' })).toBe('0Nrzo2wVaw8JsjmGesHcZl4eDk4=')
  expect(signParameters('secret', { 'k ey': 'a&b' }))
    .toBe(createHmac('sha1', 'secret').update('k%20ey=a%26b').digest('base64'))
  expect(signParameters('secret', { b: '2', a: '1' })).toBe(signParameters('secret', { a: '1', b: '2' }))
})

it.each([['zh', 'cn'], ['en', 'en'], ['auto', 'autodialect']] as const)('maps the %s hint to the %s parameter', (hint, parameter) => {
  const url = new URL(buildRtasrUrl(AUTH, hint, 'session-1', new Date('2026-10-01T00:00:00.000Z')))
  expect(url.protocol).toBe('wss:')
  expect(`${url.host}${url.pathname}`).toBe('service.example/ast/communicate/v1')
  expect(Object.fromEntries(url.searchParams)).toEqual({
    accessKeyId: 'key',
    appId: 'app',
    audio_encode: 'pcm_s16le',
    lang: parameter,
    samplerate: '16000',
    signature: signParameters('secret', {
      accessKeyId: 'key', appId: 'app', audio_encode: 'pcm_s16le', lang: parameter,
      samplerate: '16000', utc: '2026-10-01T08:00:00+0800', uuid: 'session-1',
    }),
    utc: '2026-10-01T08:00:00+0800',
    uuid: 'session-1',
  })
})
