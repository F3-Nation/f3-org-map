import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildOrgHierarchy,
  getOrgParentId,
  getOrgPointsFromItem,
  normalizeOrgType,
  type OrgChartItem
} from './orgChart'

describe('normalizeOrgType', () => {
  it('normalizes valid org type strings', () => {
    assert.equal(normalizeOrgType('Region', 'sector'), 'region')
    assert.equal(normalizeOrgType(' SECTOR ', 'area'), 'sector')
  })

  it('falls back for invalid org type strings', () => {
    assert.equal(normalizeOrgType('foo', 'area'), 'area')
    assert.equal(normalizeOrgType(null, 'nation'), 'nation')
  })
})

describe('getOrgParentId', () => {
  it('uses hierarchy tuple entries when present', () => {
    const item: OrgChartItem = {
      orgId: 10,
      name: 'Test Region',
      orgType: 'region',
      hierarchy: [[5, 'Test Area', 'area'], [2, 'Test Sector', 'sector'], [1, 'Nation', 'nation']]
    }

    assert.equal(getOrgParentId(item), 5)
  })

  it('uses numeric hierarchy when present', () => {
    const item: OrgChartItem = {
      orgId: 10,
      name: 'Test Region',
      orgType: 'region',
      hiearchy: [5, 2, 1]
    }

    assert.equal(getOrgParentId(item), 5)
  })
})

describe('getOrgPointsFromItem', () => {
  it('filters invalid coordinates and keeps valid points', () => {
    const item: OrgChartItem = {
      orgId: 1,
      name: 'Points',
      orgType: 'region',
      activeLocations: [
        { latitude: 43.1, longitude: -88.2 },
        { latitude: 200, longitude: 0 },
        { latitude: 0, longitude: -181 }
      ]
    }

    const points = getOrgPointsFromItem(item)
    assert.equal(points.length, 1)
    assert.deepEqual(points[0], { lat: 43.1, lng: -88.2 })
  })

  it('includes explicit lat/lng on the item', () => {
    const item: OrgChartItem = {
      orgId: 2,
      name: 'Fallback',
      orgType: 'region',
      latitude: 40.0,
      longitude: -75.0
    }

    const points = getOrgPointsFromItem(item)
    assert.ok(points.some((point) => point.lat === 40.0 && point.lng === -75.0))
  })
})

describe('buildOrgHierarchy', () => {
  it('builds parents from hierarchy tuples and links parentId chain', () => {
    const items: OrgChartItem[] = [
      {
        orgId: 49629,
        name: 'App Pioneers',
        orgType: 'region',
        hierarchy: [
          [11, 'Unknown (West)', 'area'],
          [4, 'West', 'sector'],
          [1, 'F3 Nation', 'nation']
        ]
      }
    ]

    const orgs = buildOrgHierarchy(items)
    const orgById = new Map(orgs.map((org) => [org.id, org]))

    assert.equal(orgById.get(49629)?.parentId, 11)
    assert.equal(orgById.get(11)?.parentId, 4)
    assert.equal(orgById.get(4)?.parentId, 1)
    assert.equal(orgById.get(4)?.name, 'West')
  })
})
