import { describe, expect, it } from 'vitest'
import { buildOrgHierarchy, normalizeOrgType, type OrgChartItem } from './orgChart'

describe('normalizeOrgType', () => {
  it('recognizes every current org type, case- and whitespace-insensitively', () => {
    expect(normalizeOrgType(' Territory ')).toBe('territory')
    expect(normalizeOrgType('REGION')).toBe('region')
  })

  it('returns null for unrecognized input instead of guessing a plausible type', () => {
    expect(normalizeOrgType('district')).toBeNull()
    expect(normalizeOrgType(undefined)).toBeNull()
    expect(normalizeOrgType(42)).toBeNull()
  })
})

describe('buildOrgHierarchy', () => {
  it('keeps territory as its own type and does not shift ancestor types in a six-level hierarchy', () => {
    const items: OrgChartItem[] = [
      {
        id: 30,
        name: 'Charlotte Metro',
        orgType: 'region',
        hierarchy: [
          [20, 'Carolinas', 'area'],
          [15, 'Southeast', 'territory'],
          [10, 'Mid Atlantic', 'sector'],
          [1, 'Nation', 'nation'],
        ],
      },
    ]

    const orgs = buildOrgHierarchy(items)
    const byId = new Map(orgs.map((org) => [org.id, org]))

    expect(byId.get(30)).toMatchObject({ orgType: 'region', parentId: 20 })
    expect(byId.get(20)).toMatchObject({ orgType: 'area', parentId: 15 })
    expect(byId.get(15)).toMatchObject({ orgType: 'territory', parentId: 10 })
    expect(byId.get(10)).toMatchObject({ orgType: 'sector', parentId: 1 })
    expect(byId.get(1)).toMatchObject({ orgType: 'nation', parentId: null })
  })

  it('skips an item whose own org type is unrecognized rather than mislabeling it', () => {
    const items: OrgChartItem[] = [
      { id: 99, name: 'Mystery Org', orgType: 'district' as OrgChartItem['orgType'] },
    ]

    expect(buildOrgHierarchy(items)).toEqual([])
  })

  it('skips a hierarchy-tuple ancestor with an unrecognized type without dropping other ancestors', () => {
    const items: OrgChartItem[] = [
      {
        id: 30,
        name: 'Charlotte Metro',
        orgType: 'region',
        hierarchy: [
          [20, 'Carolinas', 'district'],
          [10, 'Mid Atlantic', 'sector'],
        ],
      },
    ]

    const orgs = buildOrgHierarchy(items)
    const byId = new Map(orgs.map((org) => [org.id, org]))

    expect(byId.has(20)).toBe(false)
    expect(byId.get(10)).toMatchObject({ orgType: 'sector' })
    // The child must not be left pointing at the skipped, never-created ancestor.
    expect(byId.get(30)).toMatchObject({ parentId: null })
  })

  it('skips legacy bare-number hierarchy entries instead of positionally guessing their type', () => {
    const items: OrgChartItem[] = [
      { id: 30, name: 'Charlotte Metro', orgType: 'region', hiearchy: [20, 10, 1] },
    ]

    expect(buildOrgHierarchy(items)).toEqual([
      { id: 30, name: 'Charlotte Metro', orgType: 'region', parentId: 20 },
    ])
  })
})
