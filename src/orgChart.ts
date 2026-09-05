// Leaf-to-root order (ao → nation). src/state.ts reverses this to derive
// root-to-leaf navigation order — insert a new level here in the position
// matching its place in the real hierarchy.
export const ORG_TYPES = ['ao', 'region', 'area', 'territory', 'sector', 'nation'] as const
export type OrgType = (typeof ORG_TYPES)[number]

export const ORG_TYPE_PLURAL: Record<OrgType, string> = {
  nation: 'Nation',
  sector: 'Sectors',
  territory: 'Territories',
  area: 'Areas',
  region: 'Regions',
  ao: 'AOs',
}

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

export function normalizeOrgType(value: unknown): OrgType | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return (ORG_TYPES as readonly string[]).includes(normalized) ? (normalized as OrgType) : null
}

export function getOrgParentId(item: OrgChartItem): number | null {
  if (item.parentId != null) return item.parentId
  const hierarchy = item.hierarchy ?? item.hiearchy
  if (Array.isArray(hierarchy) && hierarchy.length > 0) {
    const first = hierarchy[0]
    if (Array.isArray(first)) {
      // Only point at this ancestor if it will actually be created below —
      // an unrecognized type means it gets skipped, so referencing its id
      // here would leave a dangling parentId. Treat the item as a root
      // instead of guessing which further ancestor should stand in for it.
      return normalizeOrgType(first[2]) != null ? (first[0] ?? null) : null
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
    const orgType = normalizeOrgType(item.orgType)
    if (orgType != null) {
      ensureOrg(itemId, orgType, item.name, parentId ?? null)
    } else {
      console.warn(`Skipping org ${itemId} with unrecognized orgType:`, item.orgType)
    }

    const hierarchy = item.hierarchy ?? item.hiearchy
    if (Array.isArray(hierarchy)) {
      hierarchy.forEach((entry, index) => {
        // Legacy bare-number hierarchy entries carry no type string at all.
        // A positional guess is unreliable once more levels can sit between
        // the leaf and nation, so skip rather than mislabel.
        if (!Array.isArray(entry)) {
          console.warn(`Skipping legacy bare-number hierarchy ancestor for org ${itemId}:`, entry)
          return
        }

        const [parentOrgId, parentName, parentTypeRaw] = entry
        const parentType = normalizeOrgType(parentTypeRaw)
        if (parentType == null) {
          console.warn(
            `Skipping hierarchy ancestor ${parentOrgId} with unrecognized orgType:`,
            parentTypeRaw,
          )
          return
        }
        const nextEntry = hierarchy[index + 1]
        const parentParentId = Array.isArray(nextEntry) ? nextEntry[0] : (nextEntry ?? null)
        ensureOrg(parentOrgId, parentType, parentName, parentParentId)
      })
    }
  })

  return [...orgMap.values()]
}
