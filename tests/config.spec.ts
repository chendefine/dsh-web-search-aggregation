import { describe, expect, it } from 'vitest'
import { DEFAULT_QUEUE, DEFAULT_KEY_REF, resolveConfig } from '../src/config.ts'
import { formatApiKeys, keyRefLabel, maskApiKey, parseApiKeys } from '../src/keys.ts'

describe('config defaults and resolution', () => {
  it('fills the shipped default queue and timeout from an empty input', () => {
    expect(resolveConfig({})).toEqual({
      providers: [
        { kind: 'anysearch', enabled: true },
        { kind: 'tavily', enabled: true },
        { kind: 'tinyfish', enabled: true },
        { kind: 'brave', enabled: true },
        { kind: 'exa', enabled: true },
        { kind: 'firecrawl', enabled: true },
        { kind: 'jina', enabled: true },
        { kind: 'serpapi', enabled: true },
        { kind: 'serper', enabled: true },
      ],
      attemptTimeoutMs: 10000,
    })
  })

  it('normalizes entries: drops an empty baseURL, keeps a kind to one entry', () => {
    expect(resolveConfig({
      providers: [
        { kind: 'tavily', enabled: true, baseURL: '  ' },
        { kind: 'tavily', enabled: false, baseURL: 'https://second.test' },
      ],
    }).providers).toEqual([
      { kind: 'tavily', enabled: true },
    ])
  })

  it('keeps a non-blank baseURL override', () => {
    const resolved = resolveConfig({
      providers: [{ kind: 'tinyfish', enabled: false, baseURL: 'https://proxy.test' }],
    })
    expect(resolved.providers).toEqual([
      { kind: 'tinyfish', enabled: false, baseURL: 'https://proxy.test' },
    ])
  })

  it('ignores a hand-written apiKeyRefs row instead of failing', () => {
    const legacy = resolveConfig({
      providers: [
        { kind: 'tavily', enabled: true, apiKeyRefs: ['TAVILY_API_KEY', 'TAVILY_API_KEY_2'] } as never,
      ],
    })
    expect(legacy.providers).toEqual([{ kind: 'tavily', enabled: true }])
  })

  it('rejects an out-of-range attempt timeout', () => {
    expect(() => resolveConfig({ attemptTimeoutMs: 10 })).toThrow()
    expect(() => resolveConfig({ attemptTimeoutMs: 100001 })).toThrow()
  })

  it('does not mutate the shipped default queue while resolving', () => {
    resolveConfig({ providers: [{ kind: 'tavily', enabled: true }, { kind: 'tavily', enabled: true }] })
    expect(DEFAULT_QUEUE[0]).toEqual({ kind: 'anysearch', enabled: true })
  })

  it('names one fixed credential per kind', () => {
    expect(DEFAULT_KEY_REF).toEqual({
      anysearch: 'ANYSEARCH_API_KEY',
      tinyfish: 'TINYFISH_API_KEY',
      tavily: 'TAVILY_API_KEY',
      brave: 'BRAVE_SEARCH_API_KEY',
      exa: 'EXA_API_KEY',
      firecrawl: 'FIRECRAWL_API_KEY',
      jina: 'JINA_API_KEY',
      serpapi: 'SERPAPI_API_KEY',
      serper: 'SERPER_API_KEY',
    })
  })
})

describe('the comma-joined key value', () => {
  it('stores a single key bare, without a separator', () => {
    expect(formatApiKeys(['tvly-one'])).toBe('tvly-one')
    expect(parseApiKeys('tvly-one')).toEqual(['tvly-one'])
  })

  it('joins and parses multiple keys with ","', () => {
    expect(formatApiKeys(['a', 'b', 'c'])).toBe('a,b,c')
    expect(parseApiKeys('a,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('trims whitespace around keys in both directions', () => {
    expect(parseApiKeys(' a , b ')).toEqual(['a', 'b'])
    expect(formatApiKeys([' a ', 'b'])).toBe('a,b')
  })

  it('drops empty segments when parsing and formats an empty pool as ""', () => {
    expect(parseApiKeys('a,,b')).toEqual(['a', 'b'])
    expect(parseApiKeys(',')).toEqual([])
    expect(parseApiKeys('   ')).toEqual([])
    expect(formatApiKeys([])).toBe('')
    expect(formatApiKeys(['', '  '])).toBe('')
  })

  it('labels a key as the plain ref in a single-key pool and REF#N otherwise', () => {
    expect(keyRefLabel('TAVILY_API_KEY', 0, 1)).toBe('TAVILY_API_KEY')
    expect(keyRefLabel('TAVILY_API_KEY', 0, 3)).toBe('TAVILY_API_KEY#1')
    expect(keyRefLabel('TAVILY_API_KEY', 2, 3)).toBe('TAVILY_API_KEY#3')
  })

  it('masks a key as head 12 + … + tail 2', () => {
    const key = 'tvly-abcdefghijklmnop'
    expect(maskApiKey(key)).toBe(`${key.slice(0, 12)}…${key.slice(-2)}`)
    // A key just long enough still hides a middle.
    expect(maskApiKey('a'.repeat(15))).toBe('aaaaaaaaaaaa…aa')
  })

  it('degrades gracefully for keys too short to hide a middle', () => {
    // ≤ 14 chars: only the tail window shows, never the whole key.
    expect(maskApiKey('as-key')).toBe('…ey')
    expect(maskApiKey('abcd')).toBe('…cd')
    expect(maskApiKey('ab')).toBe('…')
  })
})
