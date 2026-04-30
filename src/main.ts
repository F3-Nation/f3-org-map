import './style.css'
import changelogMarkdown from '../CHANGELOG.md?raw'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import turfArea from '@turf/area'
import { polygon as turfPolygon } from '@turf/helpers'
import {
  buildOrgHierarchy,
  getOrgPointsFromItem,
  normalizeOrgType,
  type Org,
  type OrgChartItem,
  type OrgType,
  type Point
} from './orgChart'
import { apiGet } from './api'
import { fuzzyScore, convexHull } from './utils'
import { updateUrlState, restoreStateFromUrl, levelOrder, currentLevelIndex, selectedPath, setCurrentLevelIndex } from './state'

declare const __APP_VERSION__: string

type OrgPosition = {
  title?: string
  f3Name?: string
  avatarUrl?: string
}

type OrgRole = {
  title?: string
  f3Name?: string
  avatarUrl?: string
}

type OrgInfo = {
  id: number
  name: string
  orgType: OrgType
  email?: string | null
  website?: string | null
  twitter?: string | null
  facebook?: string | null
  instagram?: string | null
  positions?: OrgPosition[]
  roles?: OrgRole[]
}

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('Missing #app container')
}

app.innerHTML = `
  <div class="app">
    <header class="top-bar">
      <div class="brand">
        <div class="brand-title">F3 Geographic Directory</div>
        <div class="brand-subtitle">Sectors → Areas → Regions → AOs</div>
      </div>
      <div class="layers" id="layers">
        <button class="layer-btn layer-active" data-level="0">Sectors</button>
        <button class="layer-btn" data-level="1">Areas</button>
        <button class="layer-btn" data-level="2">Regions</button>
      </div>
      <div class="controls">
        <div id="breadcrumb" class="breadcrumb"></div>
      </div>
    </header>
    <main class="main">
      <section id="map" class="map">
        <div class="map-loading" id="map-loading" aria-live="polite" aria-hidden="false">
          <div class="map-loading-spinner" aria-hidden="true"></div>
          <div class="map-loading-text">Loading map data...</div>
        </div>
        <button
          class="map-version"
          id="map-version"
          type="button"
          aria-haspopup="dialog"
          aria-controls="changelog-dialog"
          title="View version history"
        >v${__APP_VERSION__}</button>
      </section>
      <div class="sidebar">
        <div class="search" id="search">
          <label class="search-label" for="org-search">Search</label>
          <input
            id="org-search"
            class="search-input"
            type="search"
            placeholder="Search sectors, areas, regions"
            autocomplete="off"
            disabled
          />
          <div class="search-results is-hidden" id="search-results" role="listbox"></div>
        </div>
        <aside class="info" id="info">
          <div class="info-title">Loading organizations...</div>
          <div class="info-body"></div>
        </aside>
      </div>
    </main>
    <div class="changelog-modal is-hidden" id="changelog-modal" aria-hidden="true">
      <div class="changelog-backdrop" id="changelog-backdrop"></div>
      <section class="changelog-panel" id="changelog-dialog" role="dialog" aria-modal="true" aria-labelledby="changelog-title">
        <div class="changelog-header">
          <div>
            <div class="changelog-eyebrow">Version History</div>
            <h2 class="changelog-title" id="changelog-title">F3 Geographic Directory</h2>
          </div>
          <button class="changelog-close" id="changelog-close" type="button" aria-label="Close changelog">Close</button>
        </div>
        <div class="changelog-content" id="changelog-content"></div>
      </section>
    </div>
  </div>
`

const map = L.map('map', {
  zoomControl: true,
  worldCopyJump: true,
  minZoom: 2
}).setView([37.6, -96], 4)

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  subdomains: 'abcd',
  maxZoom: 20
}).addTo(map)

const layerGroup = L.layerGroup().addTo(map)
const infoPanel = document.querySelector<HTMLDivElement>('#info')!
const breadcrumbEl = document.querySelector<HTMLDivElement>('#breadcrumb')!
const layersContainer = document.querySelector<HTMLDivElement>('#layers')!
const mapLoadingEl = document.querySelector<HTMLDivElement>('#map-loading')!
const mapVersionButton = document.querySelector<HTMLButtonElement>('#map-version')!
const searchInput = document.querySelector<HTMLInputElement>('#org-search')!
const searchResults = document.querySelector<HTMLDivElement>('#search-results')!
const searchContainer = document.querySelector<HTMLDivElement>('#search')!
const changelogModal = document.querySelector<HTMLDivElement>('#changelog-modal')!
const changelogBackdrop = document.querySelector<HTMLDivElement>('#changelog-backdrop')!
const changelogCloseButton = document.querySelector<HTMLButtonElement>('#changelog-close')!
const changelogContent = document.querySelector<HTMLDivElement>('#changelog-content')!

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderInlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function renderChangelog(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
  const parts: string[] = []
  let paragraph: string[] = []
  let listItems: string[] = []
  let releaseOpen = false

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    parts.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`)
    paragraph = []
  }

  const flushList = () => {
    if (listItems.length === 0) return
    parts.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`)
    listItems = []
  }

  const closeRelease = () => {
    if (!releaseOpen) return
    flushParagraph()
    flushList()
    parts.push('</section>')
    releaseOpen = false
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line) {
      flushParagraph()
      flushList()
      continue
    }

    if (line.startsWith('# ')) {
      flushParagraph()
      flushList()
      parts.push(`<h1>${renderInlineMarkdown(line.slice(2))}</h1>`)
      continue
    }

    if (line.startsWith('## ')) {
      closeRelease()
      const headingText = line.slice(3)
      const releaseMatch = headingText.match(/^\[(.+?)\]\s*-\s*(.+)$/)
      if (releaseMatch) {
        const [, version, date] = releaseMatch
        parts.push(
          `<section class="changelog-release"><div class="changelog-release-header"><h2>${renderInlineMarkdown(version)}</h2><span class="changelog-release-date">${renderInlineMarkdown(date)}</span></div>`
        )
        releaseOpen = true
      } else {
        parts.push(`<h2>${renderInlineMarkdown(headingText)}</h2>`)
      }
      continue
    }

    if (line.startsWith('### ')) {
      flushParagraph()
      flushList()
      parts.push(`<h3>${renderInlineMarkdown(line.slice(4))}</h3>`)
      continue
    }

    if (line.startsWith('- ')) {
      flushParagraph()
      listItems.push(line.slice(2))
      continue
    }

    paragraph.push(line)
  }

  closeRelease()
  flushParagraph()
  flushList()

  return parts.join('')
}

function openChangelog() {
  changelogModal.classList.remove('is-hidden')
  changelogModal.setAttribute('aria-hidden', 'false')
  changelogCloseButton.focus()
}

function closeChangelog() {
  changelogModal.classList.add('is-hidden')
  changelogModal.setAttribute('aria-hidden', 'true')
  mapVersionButton.focus()
}

changelogContent.innerHTML = renderChangelog(changelogMarkdown)

mapVersionButton.addEventListener('click', () => {
  openChangelog()
})

changelogCloseButton.addEventListener('click', () => {
  closeChangelog()
})

changelogBackdrop.addEventListener('click', () => {
  closeChangelog()
})

function setMapLoading(isLoading: boolean, message: string = 'Loading map data...') {
  if (!mapLoadingEl) return
  const textEl = mapLoadingEl.querySelector<HTMLDivElement>('.map-loading-text')
  if (textEl) {
    textEl.textContent = message
  }
  mapLoadingEl.classList.toggle('is-hidden', !isLoading)
  mapLoadingEl.setAttribute('aria-hidden', String(!isLoading))
}

// Handle layer button clicks
layersContainer.querySelectorAll('.layer-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const level = parseInt((btn as HTMLElement).dataset.level!, 10)
    selectedPath.length = 0
    setCurrentLevelIndex(level)
    // Update active button styling
    layersContainer.querySelectorAll('.layer-btn').forEach((b) => {
      b.classList.remove('layer-active')
    })
    btn.classList.add('layer-active')
    updateUrlState()
    renderLevel()
  })
})

// State logic now in state.ts
// Use currentLevelIndex and selectedPath from state.ts directly

const orgById = new Map<number, Org>()
const childrenByParent = new Map<number, Org[]>()
const orgDescendantsCache = new Map<number, number[]>()
const orgPointsById = new Map<number, Point[]>()
const orgMetricsById = new Map<number, { events: number; aos: number; locations: number }>()
const orgColors = new Map<number, string>()
const orgInfoCache = new Map<number, OrgInfo>()
const orgInfoPending = new Map<number, Promise<OrgInfo>>()
let activeInfoOrgId: number | null = null
let searchIndex: Org[] = []
const UNKNOWN_AVATAR_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">' +
      '<rect width="80" height="80" rx="16" fill="#f1ead7"/>' +
      '<circle cx="40" cy="30" r="16" fill="#9ca3af"/>' +
      '<path d="M16 70c3-16 17-26 24-26s21 10 24 26" fill="#9ca3af"/>' +
    '</svg>'
  )

function generateRandomColor(): string {
  const letters = '0123456789ABCDEF'
  let color = '#'
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)]
  }
  return color
}

function getSearchResults(query: string): Org[] {
  const scored = searchIndex
    .map((org) => ({ org, score: fuzzyScore(query, org.name) }))
    .filter((item): item is { org: Org; score: number } => item.score != null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.org.name.localeCompare(b.org.name)
    })
  return scored.slice(0, 8).map((item) => item.org)
}

function getOrgPath(org: Org): Org[] {
  const path: Org[] = []
  let current: Org | undefined = org
  while (current) {
    path.unshift(current)
    current = current.parentId ? orgById.get(current.parentId) : undefined
  }
  return path
}

function getFocusBounds(org: Org): L.LatLngBounds | undefined {
  const points = getOrgPoints(org)
  if (points.length === 0) return undefined
  if (points.length < 3) {
    let center = { lat: points[0].lat, lng: points[0].lng }
    if (points.length === 2) {
      center = {
        lat: (points[0].lat + points[1].lat) / 2,
        lng: (points[0].lng + points[1].lng) / 2
      }
    }
    const circlePoints = createCircleBuffer(center, 0.6)
    return L.latLngBounds(circlePoints.map((point) => L.latLng(point.lat, point.lng)))
  }
  return L.latLngBounds(points.map((point) => L.latLng(point.lat, point.lng)))
}

function navigateToOrg(org: Org) {
  const levelIndex = levelOrder.indexOf(org.orgType);
  if (levelIndex === -1) return;

  if (org.orgType === 'sector') {
    selectedPath.length = 0;
    selectedPath.push(org);
    setCurrentLevelIndex(1); // Switch to area layer
  } else if (org.orgType === 'area') {
    const path = getOrgPath(org).filter((item) => item.orgType !== 'nation');
    selectedPath.length = 0;
    selectedPath.push(...path);
    setCurrentLevelIndex(2); // Switch to region layer
  } else if (org.orgType === 'region') {
    // Only show up to area in breadcrumb, not region itself
    const path = getOrgPath(org).filter((item) => item.orgType !== 'nation' && item.orgType !== 'region');
    selectedPath.length = 0;
    selectedPath.push(...path);
    setCurrentLevelIndex(levelIndex);
  } else {
    const path = getOrgPath(org).filter((item) => item.orgType !== 'nation');
    selectedPath.length = 0;
    selectedPath.push(...path.slice(0, -1));
    setCurrentLevelIndex(levelIndex);
  }

  updateUrlState();
  renderLevel(getFocusBounds(org));
  loadOrgInfo(org);
}

function clearSearchResults() {
  searchResults.innerHTML = ''
  searchResults.classList.add('is-hidden')
}

function renderSearchResults(orgs: Org[]) {
  searchResults.classList.remove('is-hidden')
  if (orgs.length === 0) {
    searchResults.innerHTML = '<div class="search-empty">No matches</div>'
    return
  }

  searchResults.innerHTML = orgs
    .map((org) => {
      return `
        <button class="search-item" type="button" data-org-id="${org.id}" role="option">
          <span class="search-name">${org.name}</span>
          <span class="search-type">${org.orgType.toUpperCase()}</span>
        </button>
      `
    })
    .join('')

  searchResults.querySelectorAll<HTMLButtonElement>('.search-item').forEach((button) => {
    button.addEventListener('click', () => {
      const orgId = parseInt(button.dataset.orgId ?? '', 10)
      const org = orgById.get(orgId)
      if (!org) return
      searchInput.value = org.name
      clearSearchResults()
      navigateToOrg(org)
    })
  })
}

searchInput.addEventListener('input', () => {
  const query = searchInput.value
  if (!query.trim()) {
    clearSearchResults()
    return
  }
  renderSearchResults(getSearchResults(query))
})

searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim()) {
    searchInput.select()
  }
})

searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    const results = getSearchResults(searchInput.value)
    if (results.length > 0) {
      clearSearchResults()
      navigateToOrg(results[0])
    }
  }
  if (event.key === 'Escape') {
    if (!changelogModal.classList.contains('is-hidden')) {
      closeChangelog()
      return
    }
    clearSearchResults()
    searchInput.blur()
  }
})

document.addEventListener('click', (event) => {
  const target = event.target as Node
  if (!searchContainer.contains(target)) {
    clearSearchResults()
  }
})
function getOrgColor(orgId: number): string {
  if (orgColors.has(orgId)) {
    return orgColors.get(orgId)!
  }
  const color = generateRandomColor()
  orgColors.set(orgId, color)
  return color
}

function extractItems<T>(payload: unknown): T[] {
  if (!payload) return []
  if (Array.isArray(payload)) return payload as T[]
  if (typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>

  // Check common wrapping keys
  const arrayKeys = ['orgs', 'locations', 'events', 'items', 'data']
  for (const key of arrayKeys) {
    if (Array.isArray(record[key])) {
      return record[key] as T[]
    }
  }

  // Fallback: find first array value
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      return value as T[]
    }
  }

  return []
}

function isSectorInternational(org: Org): boolean {
  return org.orgType === 'sector' && org.name.trim().toLowerCase() === 'international'
}

function isGeneralInternationalArea(org: Org): boolean {
  return org.orgType === 'area' && org.name.trim().toLowerCase() === 'general international area'
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

function formatDecimal(value: number, fractionDigits = 1): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits
  }).format(value)
}

function renderInfo(org: Org, detail?: OrgInfo) {
  const positions = detail?.positions ?? []
  const roles = detail?.roles ?? []
  const descendantIds = getDescendantOrgIds(org.id)
  const descendantOrgs = descendantIds
    .map((id) => orgById.get(id))
    .filter((item): item is Org => item !== undefined)
  let eventsCount = 0
  let aoCount = 0
  let locationsCount = 0
  descendantIds.forEach((id) => {
    const metrics = orgMetricsById.get(id)
    if (!metrics) return
    eventsCount += metrics.events
    aoCount += metrics.aos
    locationsCount += metrics.locations
  })
  const sectorCount = descendantOrgs.filter((item) => item.orgType === 'sector').length
  const areaCount = descendantOrgs.filter((item) => item.orgType === 'area').length
  const regionCount = descendantOrgs.filter((item) => item.orgType === 'region').length
  const formattedAreaCount = formatNumber(areaCount)
  const formattedRegionCount = formatNumber(regionCount)
  const formattedSectorCount = formatNumber(sectorCount)
  const formattedAoCount = formatNumber(aoCount)
  const formattedEventsCount = formatNumber(eventsCount)
  const formattedLocationsCount = formatNumber(locationsCount)
  let regionFootprint: number | null = null
  if ((detail?.orgType ?? org.orgType) === 'region') {
    const regionPoints = getOrgPoints(org)
    if (regionPoints.length >= 3) {
      const hull = convexHull(regionPoints)
      if (hull.length >= 3) {
        const coordinates = hull.map((point) => [point.lng, point.lat])
        coordinates.push([hull[0].lng, hull[0].lat])
        const areaSqMeters = turfArea(turfPolygon([coordinates]))
        regionFootprint = areaSqMeters / 2_589_988.110336
      }
    }
  }
  const emailDisplay = detail?.email 
    ? `<a href="mailto:${detail.email}" class="info-link">${detail.email}</a>`
    : 'Not listed'
  
  const socialLinks: string[] = []
  const globeIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="info-icon" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path></svg>'
  const twitterIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="info-icon" aria-hidden="true"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"></path></svg>'
  const facebookIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="info-icon" aria-hidden="true"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path></svg>'
  const instagramIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="info-icon" aria-hidden="true"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"></line></svg>'

  if (detail?.website) {
    socialLinks.push(`<a href="${detail.website}" target="_blank" rel="noopener noreferrer" class="info-icon-link" title="Website" aria-label="Website">${globeIcon}</a>`)
  }
  if (detail?.twitter) {
    socialLinks.push(`<a href="${detail.twitter}" target="_blank" rel="noopener noreferrer" class="info-icon-link" title="X (Twitter)" aria-label="X (Twitter)">${twitterIcon}</a>`)
  }
  if (detail?.facebook) {
    socialLinks.push(`<a href="${detail.facebook}" target="_blank" rel="noopener noreferrer" class="info-icon-link" title="Facebook" aria-label="Facebook">${facebookIcon}</a>`)
  }
  if (detail?.instagram) {
    socialLinks.push(`<a href="${detail.instagram}" target="_blank" rel="noopener noreferrer" class="info-icon-link" title="Instagram" aria-label="Instagram">${instagramIcon}</a>`)
  }
  
  const socialMarkup = socialLinks.length > 0 
    ? `<div class="info-section"><div class="info-label">Connect</div><div class="info-social">${socialLinks.join('')}</div></div>` 
    : ''

  const positionMarkup = positions.length
    ? positions
        .map((pos) => {
          const title = pos.title ?? 'Leader'
          const name = pos.f3Name ?? 'Unknown'
          const avatar = pos.avatarUrl ?? UNKNOWN_AVATAR_SVG
          const avatarMarkup = `<img src="${avatar}" alt="${name}" class="info-avatar" loading="lazy" />`
          return `<li class="info-position">${avatarMarkup}<div><div class="info-role">${title}</div><div class="info-person">${name}</div></div></li>`
        })
        .join('')
    : '<li class="info-empty">No positions listed.</li>'

  const roleMarkup = roles.length
    ? roles
        .map((role) => {
          const title = role.title ?? 'Role'
          const name = role.f3Name ?? 'Unknown'
          const avatar = role.avatarUrl ?? UNKNOWN_AVATAR_SVG
          const avatarMarkup = `<img src="${avatar}" alt="${name}" class="info-avatar" loading="lazy" />`
          return `<li class="info-position">${avatarMarkup}<div><div class="info-role">${title}</div><div class="info-person">${name}</div></div></li>`
        })
        .join('')
    : '<li class="info-empty">No roles listed.</li>'

  infoPanel.innerHTML = `
    <div class="info-title">${detail?.name ?? org.name}</div>
    <div class="info-subtitle">${(detail?.orgType ?? org.orgType).toUpperCase()}</div>
    <div class="info-section">
      <div class="info-label">Organization Email</div>
      <div class="info-value">${emailDisplay}</div>
    </div>
    ${socialMarkup}
    <div class="info-section">
      <div class="info-label">Counts</div>
      <div class="info-value">
        ${(detail?.orgType ?? org.orgType) === 'nation' ? `<div>Sectors: ${formattedSectorCount}</div>` : ''}
        ${(detail?.orgType ?? org.orgType) === 'nation' || (detail?.orgType ?? org.orgType) === 'sector' ? `<div>Areas: ${formattedAreaCount}</div>` : ''}
        ${(detail?.orgType ?? org.orgType) === 'nation' || (detail?.orgType ?? org.orgType) === 'sector' || (detail?.orgType ?? org.orgType) === 'area' ? `<div>Regions: ${formattedRegionCount}</div>` : ''}
        <div>Events: ${formattedEventsCount}</div>
        <div>AOs: ${formattedAoCount}</div>
        <div>Locations: ${formattedLocationsCount}</div>
        ${regionFootprint != null ? `<div>Footprint: ${formatDecimal(regionFootprint)} sq mi</div>` : ''}
      </div>
    </div>
    <div class="info-section">
      <div class="info-label" style="display: flex; align-items: center; gap: 0.4em;">
        Positions
        <span class="info-help-tooltip" tabindex="0">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-label="Help" style="vertical-align: middle;">
            <circle cx="10" cy="10" r="9" stroke="#bdbdbd" stroke-width="1.2" fill="#fff"/>
            <text x="10" y="15" text-anchor="middle" font-size="11" font-family="Arial, sans-serif" fill="#bdbdbd" font-weight="400">?</text>
          </svg>
          <span class="info-tooltip-text">
            Changes: For sectors and areas, email it@f3nation.com. For regions, update in the F3 Nation Slackbot.
          </span>
        </span>
      </div>
      <ul class="info-list">${positionMarkup}</ul>
    </div>
    <div class="info-section">
      <div class="info-label">Roles</div>
      <ul class="info-list">${roleMarkup}</ul>
    </div>
  `
}

function renderPlaceholder(message: string) {
  infoPanel.innerHTML = `
    <div class="info-title">${message}</div>
    <div class="info-body"></div>
  `
}

function renderLoadingInfo(org: Org) {
  infoPanel.innerHTML = `
    <div class="info-title">${org.name}</div>
    <div class="info-body">Loadings...</div>
  `
}

function displayNationInfo() {
  const nationOrg = orgById.get(1)
  if (nationOrg) {
    loadOrgInfo(nationOrg)
  }
}

function buildChildrenMap(orgs: Org[]) {
  childrenByParent.clear()
  orgs.forEach((org) => {
    if (org.parentId == null) return
    const list = childrenByParent.get(org.parentId) ?? []
    list.push(org)
    childrenByParent.set(org.parentId, list)
  })
}

function getDescendantOrgIds(orgId: number): number[] {
  if (orgDescendantsCache.has(orgId)) {
    return orgDescendantsCache.get(orgId) ?? []
  }

  const org = orgById.get(orgId)
  if (!org) {
    orgDescendantsCache.set(orgId, [])
    return []
  }

  const children = childrenByParent.get(orgId) ?? []
  const descendantIds = [orgId, ...children.flatMap((child) => getDescendantOrgIds(child.id))]
  orgDescendantsCache.set(orgId, descendantIds)
  return descendantIds
}

function getOrgPoints(org: Org): Point[] {
  const orgIds = getDescendantOrgIds(org.id)
  const points: Point[] = []
  const seenOrgIds = new Set<number>()

  orgIds.forEach((descendantId) => {
    if (seenOrgIds.has(descendantId)) return
    const orgPoints = orgPointsById.get(descendantId)
    if (!orgPoints || orgPoints.length === 0) return
    seenOrgIds.add(descendantId)
    points.push(...orgPoints)
  })

  return points
}

async function loadOrgInfo(org: Org) {
  activeInfoOrgId = org.id

  if (orgInfoCache.has(org.id)) {
    renderInfo(org, orgInfoCache.get(org.id))
    return
  }

  renderLoadingInfo(org)

  let pending = orgInfoPending.get(org.id)
  if (!pending) {
    pending = apiGet<OrgInfo>(`/v1/org-chart/${org.id}`)
    orgInfoPending.set(org.id, pending)
  }

  try {
    const data = await pending
    orgInfoCache.set(org.id, data)
    const existing = orgById.get(org.id)
    if (existing) {
      existing.name = data.name ?? existing.name
      existing.orgType = normalizeOrgType(data.orgType, existing.orgType)
    }
  } catch (error) {
    if (activeInfoOrgId === org.id) {
      renderPlaceholder('Failed to load org info.')
    }
    console.error(error)
  } finally {
    orgInfoPending.delete(org.id)
  }

  if (activeInfoOrgId === org.id && orgInfoCache.has(org.id)) {
    renderInfo(org, orgInfoCache.get(org.id))
  }
}

function createStarPolygon(center: { lat: number; lng: number }, radiusDegrees: number, points: number = 5): Point[] {
  const star: Point[] = []
  const outerRadius = radiusDegrees
  const innerRadius = radiusDegrees * 0.4
  
  for (let i = 0; i < points * 2; i++) {
    const angle = (i * Math.PI) / points - Math.PI / 2
    const radius = i % 2 === 0 ? outerRadius : innerRadius
    const lat = center.lat + radius * Math.cos(angle)
    const lng = center.lng + radius * Math.sin(angle)
    star.push({ lat, lng })
  }
  
  return star
}

function createCircleBuffer(center: { lat: number; lng: number }, radiusDegrees: number, segments: number = 8): Point[] {
  const circle: Point[] = []
  
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * 2 * Math.PI
    const lat = center.lat + radiusDegrees * Math.cos(angle)
    const lng = center.lng + radiusDegrees * Math.sin(angle)
    circle.push({ lat, lng })
  }
  
  return circle
}

function getCurrentLevelOrgs(): Org[] {
  const level = levelOrder[currentLevelIndex];

  if (level === 'sector') {
    return [...orgById.values()].filter((org) => org.orgType === 'sector');
  }

  const parent = selectedPath[selectedPath.length - 1];

  // If no parent selected, show all orgs of this level (for layer button views)
  if (!parent) {
    return [...orgById.values()].filter((org) => org.orgType === level);
  }

  // Special handling for International: get all region descendants (not just direct children)
  if (isSectorInternational(parent) && level === 'region') {
    const internationalDescendants = getDescendantOrgIds(parent.id);
    return [...orgById.values()].filter((org) => org.orgType === 'region' && internationalDescendants.includes(org.id));
  }

  // If at region level and selectedPath points to a region, show all sibling regions (same parent)
  if (level === 'region' && parent.orgType === 'region') {
    const regionParentId = parent.parentId;
    return [...orgById.values()].filter((org) => org.orgType === 'region' && org.parentId === regionParentId);
  }

  return [...orgById.values()].filter((org) => org.orgType === level && org.parentId === parent.id);
}

function renderBreadcrumb() {
  const crumbs = [
    { label: 'Nation', depth: -1 },
    ...selectedPath.map((org, idx) => ({ label: org.name, depth: idx }))
  ];
  const crumbHtml = crumbs
    .map((crumb, idx) => {
      const isLast = idx === crumbs.length - 1;
      const isNation = crumb.depth === -1;
      // Mark as non-clickable only if it's the last crumb AND not Nation
      const isNonClickable = isLast && !isNation;
      return `<span class="breadcrumb-crumb${isNonClickable ? ' breadcrumb-current' : ''}" data-depth="${crumb.depth}">${crumb.label}</span>`;
    })
    .join(' <span class="breadcrumb-sep">/</span> ');
  breadcrumbEl.innerHTML = crumbHtml;
  // Add click handlers to all clickable breadcrumbs
  // All breadcrumbs are clickable except the last one (unless it's Nation)
  breadcrumbEl.querySelectorAll('.breadcrumb-crumb').forEach((crumb) => {
    const depth = parseInt((crumb as HTMLElement).dataset.depth!, 10);
    crumb.addEventListener('click', () => {
      if (depth === -1) {
        // Clicking Nation: show sectors on map but Nation info in sidebar
        selectedPath.length = 0;
        setCurrentLevelIndex(0);
        updateUrlState();
        renderLevel();
        displayNationInfo();
      } else {
        selectedPath.length = depth + 1;
        setCurrentLevelIndex(depth + 1);
        updateUrlState();
        renderLevel();
        // Show info for the org at this breadcrumb (by depth)
        const org = selectedPath[depth];
        if (org) loadOrgInfo(org);
      }
    });
  });
}

function renderLevel(focusBounds?: L.LatLngBounds) {
  layerGroup.clearLayers()
  renderBreadcrumb()
  
  // Update active layer button
  layersContainer.querySelectorAll('.layer-btn').forEach((btn) => {
    btn.classList.remove('layer-active')
  })
  const activeBtn = layersContainer.querySelector(`[data-level="${currentLevelIndex}"]`)
  if (activeBtn) activeBtn.classList.add('layer-active')

  const level = levelOrder[currentLevelIndex]
  const orgs = getCurrentLevelOrgs()
  const allLatLngs: L.LatLng[] = []

  orgs.forEach((org) => {
    let latLngs: L.LatLng[] | undefined;
    // Special handling for International sector and General International Area - create star polygon in Atlantic
    if (isSectorInternational(org) || isGeneralInternationalArea(org)) {
      const atlanticCenter = { lat: 20, lng: -40 };
      const starPoints = createStarPolygon(atlanticCenter, 8, 5);
      latLngs = starPoints.map((point) => L.latLng(point.lat, point.lng));
      allLatLngs.push(...latLngs);
    } else {
      const points = getOrgPoints(org);
      // For regions/areas with fewer than 3 points, create a circle buffer
      if (points.length < 3) {
        if (points.length === 0) return;
        const center = { lat: points[0].lat, lng: points[0].lng };
        if (points.length === 2) {
          center.lat = (points[0].lat + points[1].lat) / 2;
          center.lng = (points[0].lng + points[1].lng) / 2;
        }
        const circlePoints = createCircleBuffer(center, 0.15); // ~16km radius at equator
        latLngs = circlePoints.map((point) => L.latLng(point.lat, point.lng));
        allLatLngs.push(...latLngs);
      } else {
        const hull = convexHull(points);
        if (hull.length < 3) return;
        latLngs = hull.map((point) => L.latLng(point.lat, point.lng));
        allLatLngs.push(...latLngs);
      }
    }
    // Guard: only create polygon if latLngs is valid and has at least 3 points
    if (!latLngs || latLngs.length < 3) return;
    const polygon = L.polygon(latLngs, {
      color: getOrgColor(org.id),
      weight: 2,
      fillColor: getOrgColor(org.id),
      fillOpacity: 0.18
    });

    polygon.on('mouseover', () => {
      polygon.setStyle({ weight: 3, fillOpacity: 0.28 });
      loadOrgInfo(org);
      // If at region level, update URL to reflect hovered region
      if (currentLevelIndex === 2) {
        selectedPath.length = 0;
        selectedPath.push(org);
        updateUrlState();
      }
    });

    polygon.on('mouseout', () => {
      polygon.setStyle({ weight: 2, fillOpacity: 0.18 });
    });

    polygon.on('click', () => {
      // Regions are view-only, don't navigate on click
      if (org.orgType === 'region') return;
      if (currentLevelIndex >= levelOrder.length - 1) return;
      navigateToOrg(org);
    });

    polygon.addTo(layerGroup);
  });

  if (focusBounds) {
    map.fitBounds(focusBounds, { padding: [24, 24] })
  } else if (allLatLngs.length > 0) {
    map.fitBounds(L.latLngBounds(allLatLngs), { padding: [24, 24] })
  }

  if (orgs.length === 0) {
    renderPlaceholder(`No ${level}s available.`)
  }
}


async function init() {
  setMapLoading(true, 'Loading organizations...')
  renderPlaceholder('Loading organizations...')

  const payload = await apiGet<unknown>('/v1/org-chart')
  const items = extractItems<OrgChartItem>(payload)

  console.log(`Loaded ${items.length} orgs from /org-chart`)

  const orgs = buildOrgHierarchy(items)

  orgs.forEach((org) => {
    orgById.set(org.id, org)
  })

  searchIndex = orgs.filter((org) => org.orgType === 'sector' || org.orgType === 'area' || org.orgType === 'region')
  searchInput.disabled = false

  items.forEach((item) => {
    const itemId = item.id ?? item.orgId
    if (itemId == null) return
    const points = getOrgPointsFromItem(item)
    if (points.length === 0) return
    orgPointsById.set(itemId, points)
  })

  items.forEach((item) => {
    const itemId = item.id ?? item.orgId
    if (itemId == null) return
    let events = 0
    let aos = 0
    let locations = 0
    if (Array.isArray(item.activeLocations)) {
      item.activeLocations.forEach((loc) => {
        locations += 1
        if (typeof loc.eventCount === 'number') {
          events += loc.eventCount
        }
        if (typeof loc.aoCount === 'number') {
          aos += loc.aoCount
        }
      })
    }
    orgMetricsById.set(itemId, { events, aos, locations })
  })

  buildChildrenMap(orgs)
  orgDescendantsCache.clear()

  restoreStateFromUrl(orgById);
  // Check if we should zoom to a region and show its info
  const params = new URLSearchParams(window.location.search);
  const orgParam = params.get('org');
  const levelParam = params.get('level');
  let zoomed = false;
  if (levelParam === '2' && orgParam) {
    const orgId = parseInt(orgParam, 10);
    const org = orgById.get(orgId);
    if (org && org.orgType === 'region') {
      const bounds = getFocusBounds(org);
      renderLevel(bounds);
      loadOrgInfo(org);
      zoomed = true;
    }
  }
  if (!zoomed) {
    renderLevel();
    if (orgParam) {
      const orgId = parseInt(orgParam, 10);
      const org = orgById.get(orgId);
      if (org) {
        loadOrgInfo(org);
      } else {
        displayNationInfo();
      }
    } else {
      displayNationInfo();
    }
  }
  setMapLoading(false);
}

init().catch((error) => {
  renderPlaceholder('Failed to load data.')
  setMapLoading(false)
  console.error(error)
})
