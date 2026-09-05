export function setCurrentLevelIndex(val: number) {
  currentLevelIndex = val
}
// State logic extracted from main.ts
import { normalizeOrgType, ORG_TYPES, type Org, type OrgType } from './orgChart'

// Root-to-leaf navigation order, derived from the single ORG_TYPES source of
// truth so inserting a new level there is the only change this file needs.
export const levelOrder: OrgType[] = [...ORG_TYPES].filter((type) => type !== 'nation').reverse()

// Levels that get a layer button, are searchable, and show an info-panel
// count. 'ao' is deliberately excluded: it has no button/search entry today.
export const layerButtonTypes: OrgType[] = levelOrder.filter((type) => type !== 'ao')

// Levels where selecting an org advances the drill-down to the next level.
// The last layer-button level (region) is a view-only leaf: it stays at its
// own level and shows siblings instead.
export const drillableTypes: OrgType[] = layerButtonTypes.slice(0, -1)

// Pre-territory URL '?level=N' encoding, kept only to interpret old bookmarked
// links against the order they were generated under.
const LEGACY_LEVEL_ORDER: OrgType[] = ['sector', 'area', 'region', 'ao']

export let currentLevelIndex = 0
export let selectedPath: Org[] = []

// Breadcrumb-visible ancestors for `org`, given its root-to-leaf `path`
// (including `org` itself and nation): nation is always excluded, and a
// view-only leaf (e.g. region) also excludes itself.
export function buildBreadcrumbPath(org: Org, path: Org[]): Org[] {
  return path.filter(
    (item) =>
      item.orgType !== 'nation' &&
      (drillableTypes.includes(org.orgType) || item.orgType !== org.orgType),
  )
}

function parseLevelParam(levelParam: string): number {
  if (/^\d+$/.test(levelParam)) {
    const legacyType = LEGACY_LEVEL_ORDER[parseInt(levelParam, 10)]
    return legacyType ? Math.max(levelOrder.indexOf(legacyType), 0) : 0
  }
  const normalized = normalizeOrgType(levelParam)
  return normalized ? Math.max(levelOrder.indexOf(normalized), 0) : 0
}

export function updateUrlState() {
  const params = new URLSearchParams()
  // Only add level if not 0 (root)
  if (currentLevelIndex > 0) {
    params.set('level', levelOrder[currentLevelIndex])
  }
  if (selectedPath.length > 0) {
    const lastOrg = selectedPath[selectedPath.length - 1]
    params.set('org', String(lastOrg.id))
  }
  const query = params.toString()
  window.history.replaceState(null, '', query ? `?${query}` : './')
}

export function restoreStateFromUrl(orgById?: Map<number, Org>) {
  const params = new URLSearchParams(window.location.search)
  const orgParam = params.get('org')
  const levelParam = params.get('level')
  if (orgParam && orgById) {
    const orgId = parseInt(orgParam, 10)
    const org = orgById.get(orgId)
    if (org) {
      const path: Org[] = []
      let current: Org | undefined = org
      while (current) {
        path.unshift(current)
        current = current.parentId ? orgById.get(current.parentId) : undefined
      }
      selectedPath.length = 0
      selectedPath.push(...buildBreadcrumbPath(org, path))
      if (levelParam) {
        setCurrentLevelIndex(parseLevelParam(levelParam))
      } else {
        // Default: go one level deeper than org type, clamped to the last level
        const levelIndex = levelOrder.indexOf(org.orgType)
        if (levelIndex !== -1) {
          setCurrentLevelIndex(Math.min(levelIndex + 1, levelOrder.length - 1))
        }
      }
      return
    }
  }
  if (levelParam) {
    setCurrentLevelIndex(parseLevelParam(levelParam))
    selectedPath.length = 0
  } else {
    setCurrentLevelIndex(0)
    selectedPath.length = 0
  }
}
