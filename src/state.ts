export function setCurrentLevelIndex(val: number) {
  currentLevelIndex = val
}
// State logic extracted from main.ts
import type { Org, OrgType } from './orgChart'

export const levelOrder: OrgType[] = ['sector', 'area', 'region', 'ao']
export let currentLevelIndex = 0
export let selectedPath: Org[] = []

export function updateUrlState() {
  const params = new URLSearchParams()
  // Only add level if not 0 (root)
  if (currentLevelIndex > 0) {
    params.set('level', String(currentLevelIndex))
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
      // If org is a region, only include up to area in selectedPath
      if (org.orgType === 'region') {
        selectedPath.push(...path.filter((o) => o.orgType !== 'nation' && o.orgType !== 'region'))
      } else {
        selectedPath.push(...path.filter((o) => o.orgType !== 'nation'))
      }
      if (levelParam) {
        setCurrentLevelIndex(parseInt(levelParam, 10))
      } else {
        // Default: go one level deeper than org type
        const levelIndex = levelOrder.indexOf(org.orgType)
        if (levelIndex !== -1) {
          setCurrentLevelIndex(levelIndex + 1)
        }
      }
      return
    }
  }
  if (levelParam) {
    setCurrentLevelIndex(parseInt(levelParam, 10))
    selectedPath.length = 0
  } else {
    setCurrentLevelIndex(0)
    selectedPath.length = 0
  }
}
