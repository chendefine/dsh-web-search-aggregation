import { describe, expect, it } from 'vitest'
import { DEFAULT_QUEUE, resolveConfig, suggestKeyRef } from '../src/config.ts'

describe('config defaults and resolution', () => {
  it('fills the shipped default queue and timeout from an empty input', () => {
    expect(resolveConfig({})).toEqual({
      providers: [
        { kind: 'anysearch', enabled: true, apiKeyRefs: ['ANYSEARCH_API_KEY'] },
        { kind: 'tavily', enabled: true, apiKeyRefs: ['TAVILY_API_KEY'] },
        { kind: 'tinyfish', enabled: true, apiKeyRefs: ['TINYFISH_API_KEY'] },
      ],
      attemptTimeoutMs: 15000,
    })
  })

  it('normalizes entries: trims refs, drops blanks and duplicates, drops an empty baseURL', () => {
    expect(resolveConfig({
      providers: [
        { kind: 'tavily', enabled: true, apiKeyRefs: [' TAVILY_API_KEY ', '', 'TAVILY_API_KEY'], baseURL: '  ' },
      ],
    }).providers).toEqual([
      { kind: 'tavily', enabled: true, apiKeyRefs: ['TAVILY_API_KEY'] },
    ])
  })

  it('keeps a non-blank baseURL override', () => {
    const resolved = resolveConfig({
      providers: [{ kind: 'tinyfish', enabled: false, apiKeyRefs: [], baseURL: 'https://proxy.test' }],
    })
    expect(resolved.providers).toEqual([
      { kind: 'tinyfish', enabled: false, apiKeyRefs: [], baseURL: 'https://proxy.test' },
    ])
  })

  it('rejects an out-of-range attempt timeout', () => {
    expect(() => resolveConfig({ attemptTimeoutMs: 10 })).toThrow()
    expect(() => resolveConfig({ attemptTimeoutMs: 100001 })).toThrow()
  })

  it('does not mutate the shipped default queue while resolving', () => {
    resolveConfig({ providers: [{ kind: 'tavily', enabled: true, apiKeyRefs: ['A', 'A'] }] })
    expect(DEFAULT_QUEUE[0]?.apiKeyRefs).toEqual(['ANYSEARCH_API_KEY'])
  })
})

describe('suggestKeyRef', () => {
  it('suggests the conventional name first, then numbered suffixes', () => {
    expect(suggestKeyRef('tavily', new Set())).toBe('TAVILY_API_KEY')
    expect(suggestKeyRef('tavily', new Set(['TAVILY_API_KEY']))).toBe('TAVILY_API_KEY_2')
    expect(suggestKeyRef('tavily', new Set(['TAVILY_API_KEY', 'TAVILY_API_KEY_2']))).toBe('TAVILY_API_KEY_3')
  })
})
