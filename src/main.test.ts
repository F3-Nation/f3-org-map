import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiGet } from './api'
import type { Org } from './orgChart'
import {
  currentLevelIndex,
  restoreStateFromUrl,
  selectedPath,
  setCurrentLevelIndex,
  updateUrlState,
} from './state'
import { convexHull, fuzzyScore } from './utils'

describe('apiGet', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('constructs URL, params, and headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const data = await apiGet('/v1/org-chart', {
      q: 'carolina',
      active: true,
      ids: [1, 2],
    })

    expect(data).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [rawUrl, requestInit] = fetchMock.mock.calls[0]
    const requestUrl = new URL(rawUrl)

    expect(requestUrl.pathname.endsWith('/org-chart')).toBe(true)
    expect(requestUrl.searchParams.get('q')).toBe('carolina')
    expect(requestUrl.searchParams.get('active')).toBe('true')
    expect(requestUrl.searchParams.get('ids[0]')).toBe('1')
    expect(requestUrl.searchParams.get('ids[1]')).toBe('2')
    expect(requestInit.headers).toMatchObject({
      Authorization: 'Bearer f3-org-map',
      client: 'https://org.f3nation.com',
    })
  })

  it('throws for non-ok responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Error' })
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiGet('/fail')).rejects.toThrow('API request failed: 500 Error')
  })
})

describe('fuzzyScore', () => {
  it('returns null for empty query', () => {
    expect(fuzzyScore('   ', 'charlotte')).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(fuzzyScore('REG', 'region')).toBe(fuzzyScore('reg', 'REGION'))
  })

  it('returns null when query characters are not matched in order', () => {
    expect(fuzzyScore('sct', 'south carolina')).toBeNull()
  })
})

describe('convexHull', () => {
  it('returns a four-corner hull for a square with an interior point', () => {
    const hull = convexHull([
      { lat: 0, lng: 0 },
      { lat: 1, lng: 0 },
      { lat: 1, lng: 1 },
      { lat: 0, lng: 1 },
      { lat: 0.5, lng: 0.5 },
    ])

    expect(hull).toHaveLength(4)
  })

  it('returns the same array for one point', () => {
    const points = [{ lat: 35.2, lng: -80.8 }]
    expect(convexHull(points)).toEqual(points)
  })
})

describe('URL state helpers', () => {
  const nation: Org = { id: 1, name: 'Nation', orgType: 'nation', parentId: null }
  const sector: Org = { id: 10, name: 'Mid Atlantic', orgType: 'sector', parentId: 1 }
  const area: Org = { id: 20, name: 'Carolinas', orgType: 'area', parentId: 10 }
  const region: Org = { id: 30, name: 'Charlotte Metro', orgType: 'region', parentId: 20 }

  beforeEach(() => {
    selectedPath.length = 0
    setCurrentLevelIndex(0)
    window.history.replaceState(null, '', '/')
  })

  it('writes level and org query params', () => {
    selectedPath.push(sector, area)
    setCurrentLevelIndex(2)

    updateUrlState()

    expect(window.location.search).toContain('level=2')
    expect(window.location.search).toContain('org=20')
  })

  it('restores selected path from a region deep-link up to area', () => {
    window.history.replaceState(null, '', '/?org=30&level=2')
    const orgById = new Map<number, Org>([
      [1, nation],
      [10, sector],
      [20, area],
      [30, region],
    ])

    restoreStateFromUrl(orgById)

    expect(currentLevelIndex).toBe(2)
    expect(selectedPath.map((org) => org.id)).toEqual([10, 20])
  })
})
