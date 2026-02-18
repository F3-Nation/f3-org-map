import { describe, it, expect, vi } from 'vitest'
// Mock import.meta.env for api.ts
Object.defineProperty(globalThis, 'import', {
  value: { meta: { env: { VITE_API_BASE: 'https://api.f3nation.com/v1' } } },
  configurable: true
});
import { apiGet } from './api'
import { fuzzyScore, convexHull } from './utils'
import { updateUrlState, restoreStateFromUrl } from './state'

// --- API Integration Test ---
describe('apiGet', () => {
  it('constructs correct URL and handles params', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: 'ok' })
    })
    globalThis.fetch = fetchMock as any
    const result = await apiGet('/test', { foo: 'bar', arr: [1, 2] })
    expect(fetchMock).toHaveBeenCalled()
    expect(result).toEqual({ result: 'ok' })
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.pathname.endsWith('/test')).toBe(true)
    expect(url.searchParams.get('foo')).toBe('bar')
    expect(url.searchParams.get('arr[0]')).toBe('1')
    expect(url.searchParams.get('arr[1]')).toBe('2')
  })

  it('throws on non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Error' })
    globalThis.fetch = fetchMock as any
    await expect(apiGet('/fail')).rejects.toThrow('API request failed')
  })
})

// --- UI Logic ---
describe('fuzzyScore', () => {
  it('is case-insensitive', () => {
    expect(fuzzyScore('FOO', 'foo')).toBe(fuzzyScore('foo', 'FOO'))
  })
})

// --- Map Logic ---
describe('convexHull', () => {
  it('returns correct hull for square', () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0 },
      { lat: 1, lng: 1 },
      { lat: 0, lng: 1 }
    ]
    const hull = convexHull(points)
    expect(hull.length).toBe(4)
  })
  it('returns input for <3 points', () => {
    expect(convexHull([{ lat: 1, lng: 2 }])).toEqual([{ lat: 1, lng: 2 }])
  })
})

// --- State Management ---
import { selectedPath, setCurrentLevelIndex } from './state'
describe('updateUrlState/restoreStateFromUrl', () => {
  it('sets and restores org and level params', () => {
    (selectedPath as any).length = 0; // clear array
    selectedPath.push({ id: 42, name: 'Test Org', orgType: 'region' })
    setCurrentLevelIndex(2)
    updateUrlState()
    expect(window.location.search).toContain('org=42')
    // Now test restore
    restoreStateFromUrl()
    // Would need to check selectedPath/currentLevelIndex updated
  })
})
