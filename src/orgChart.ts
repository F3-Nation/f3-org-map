export type OrgType = 'nation' | 'sector' | 'area' | 'region' | 'ao'

export type Org = {
  id: number
  parentId?: number | null
  name: string
  orgType: OrgType
  email?: string | null
  website?: string | null
  twitter?: string | null
  facebook?: string | null
  instagram?: string | null
  meta?: Record<string, unknown> | null
  isActive?: boolean
}

export type OrgChartItem = {
  id?: number
  orgId?: number
  name: string
  orgType: OrgType
  parentId?: number | null
  hierarchy?: Array<number | [number, string, string]>
  hiearchy?: number[]
  latitude?: number | null
  longitude?: number | null
  activeLocations?: Array<{
    latitude?: number | null
    longitude?: number | null
    eventCount?: number | null
    aoCount?: number | null
  }>
}

export type Point = { lat: number; lng: number }

export function normalizeOrgType(value: unknown, fallback: OrgType): OrgType {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (
    normalized === 'nation' ||
    normalized === 'sector' ||
    normalized === 'area' ||
    normalized === 'region' ||
    normalized === 'ao'
  ) {
    return normalized as OrgType
  }
  return fallback
}

export function getOrgParentId(item: OrgChartItem): number | null {
  if (item.parentId != null) return item.parentId
  const hierarchy = item.hierarchy ?? item.hiearchy
  if (Array.isArray(hierarchy) && hierarchy.length > 0) {
    const first = hierarchy[0]
    if (Array.isArray(first)) {
      return first[0] ?? null
    }
    return first ?? null
  }
  return null
}

export function isValidPoint(lat: number, lng: number): boolean {
  if (Number.isNaN(lat) || Number.isNaN(lng)) return false
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

export function getOrgPointsFromItem(item: OrgChartItem): Point[] {
  const points: Point[] = []

  if (Array.isArray(item.activeLocations) && item.activeLocations.length > 0) {
    item.activeLocations.forEach((loc) => {
      if (loc.latitude == null || loc.longitude == null) return
      if (!isValidPoint(loc.latitude, loc.longitude)) return
      points.push({ lat: loc.latitude, lng: loc.longitude })
    })
  }

  const record = item as Record<string, unknown>
  const latCandidate =
    item.latitude ?? (record.lat as number | undefined) ?? (record.latitude as number | undefined)
  const lngCandidate =
    item.longitude ??
    (record.lng as number | undefined) ??
    (record.lon as number | undefined) ??
    (record.longitude as number | undefined)
  if (latCandidate != null && lngCandidate != null && isValidPoint(latCandidate, lngCandidate)) {
    points.push({ lat: latCandidate, lng: lngCandidate })
  }

  return points
}

export function buildOrgHierarchy(items: OrgChartItem[]): Org[] {
  const orgMap = new Map<number, Org>()
  const hierarchyTypes: OrgType[] = ['area', 'sector', 'nation']

  const ensureOrg = (id: number, orgType: OrgType, name?: string, parentId?: number | null) => {
    const existing = orgMap.get(id)
    if (existing) {
      if (name && (!existing.name || existing.name.startsWith('Org '))) {
        existing.name = name
      }
      if (parentId != null) {
        existing.parentId = parentId
      }
      return
    }
    orgMap.set(id, {
      id,
      name: name ?? (id === 1 ? 'Nation' : `Org ${id}`),
      orgType,
      parentId: parentId ?? null,
    })
  }

  items.forEach((item) => {
    const itemId = item.id ?? item.orgId
    if (itemId == null) return
    const parentId = getOrgParentId(item)
    const orgType = normalizeOrgType(item.orgType, 'region')
    ensureOrg(itemId, orgType, item.name, parentId ?? null)

    const hierarchy = item.hierarchy ?? item.hiearchy
    if (Array.isArray(hierarchy)) {
      hierarchy.forEach((entry, index) => {
        if (Array.isArray(entry)) {
          const [parentOrgId, parentName, parentTypeRaw] = entry
          const parentType = normalizeOrgType(parentTypeRaw, hierarchyTypes[index] ?? 'nation')
          const nextEntry = hierarchy[index + 1]
          const parentParentId = Array.isArray(nextEntry) ? nextEntry[0] : (nextEntry ?? null)
          ensureOrg(parentOrgId, parentType, parentName, parentParentId)
          return
        }

        const parentOrgId = entry
        const parentType = hierarchyTypes[index] ?? 'nation'
        const nextEntry = hierarchy[index + 1]
        const parentParentId = Array.isArray(nextEntry) ? nextEntry[0] : (nextEntry ?? null)
        ensureOrg(parentOrgId, parentType, parentOrgId === 1 ? 'Nation' : undefined, parentParentId)
      })
    }
  })

  return [...orgMap.values()]
}
