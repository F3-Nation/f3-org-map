export function setCurrentLevelIndex(val: number) {
  currentLevelIndex = val;
}
// State logic extracted from main.ts
import type { Org, OrgType } from './orgChart';

export const levelOrder: OrgType[] = ['sector', 'area', 'region', 'ao'];
export let currentLevelIndex = 0;
export let selectedPath: Org[] = [];

export function updateUrlState() {
  const params = new URLSearchParams();
  if (selectedPath.length > 0) {
    const lastOrg = selectedPath[selectedPath.length - 1];
    params.set('org', String(lastOrg.id));
  } else {
    params.set('level', String(currentLevelIndex));
  }
  window.history.replaceState(null, '', `?${params.toString()}`);
}

export function restoreStateFromUrl(orgById?: Map<number, Org>) {
  const params = new URLSearchParams(window.location.search);
  const orgParam = params.get('org');
  const levelParam = params.get('level');
  if (orgParam && orgById) {
    const orgId = parseInt(orgParam, 10);
    const org = orgById.get(orgId);
    if (org) {
      const path: Org[] = [];
      let current: Org | undefined = org;
      while (current) {
        path.unshift(current);
        current = current.parentId ? orgById.get(current.parentId) : undefined;
      }
      selectedPath = path.filter((o) => o.orgType !== 'nation');
      const levelIndex = levelOrder.indexOf(org.orgType);
      if (levelIndex !== -1) {
        currentLevelIndex = levelIndex + 1;
      }
    }
  } else if (levelParam) {
    currentLevelIndex = parseInt(levelParam, 10);
    selectedPath = [];
  }
}
