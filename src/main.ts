import './style.css'
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

const API_BASE = import.meta.env.VITE_API_BASE ?? ''
const API_KEY = 'f3-org-map'
const CLIENT_HEADER = 'scalar-api'

type OrgPosition = {
  title?: string
  f3Name?: string
  avatarLogo?: string
  avatar?: string
  logo?: string
  avatar_url?: string
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
        <button id="back-btn" class="btn" type="button" disabled>Back</button>
        <div id="breadcrumb" class="breadcrumb"></div>
      </div>
    </header>
    <main class="main">
      <section id="map" class="map">
        <div class="map-loading" id="map-loading" aria-live="polite" aria-hidden="false">
          <div class="map-loading-spinner" aria-hidden="true"></div>
          <div class="map-loading-text">Loading map data...</div>
        </div>
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
const backBtn = document.querySelector<HTMLButtonElement>('#back-btn')!
const layersContainer = document.querySelector<HTMLDivElement>('#layers')!
const mapLoadingEl = document.querySelector<HTMLDivElement>('#map-loading')!
const searchInput = document.querySelector<HTMLInputElement>('#org-search')!
const searchResults = document.querySelector<HTMLDivElement>('#search-results')!
const searchContainer = document.querySelector<HTMLDivElement>('#search')!

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
    const level = parseInt((btn as HTMLElement).dataset.level!)
    selectedPath = []
    currentLevelIndex = level
    
    // Update active button styling
    layersContainer.querySelectorAll('.layer-btn').forEach((b) => b.classList.remove('layer-active'))
    btn.classList.add('layer-active')
    
    updateUrlState()
    renderLevel()
  })
})

const levelOrder: OrgType[] = ['sector', 'area', 'region', 'ao']
let currentLevelIndex = 0
let selectedPath: Org[] = []

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

function fuzzyScore(query: string, target: string): number | null {
  const trimmedQuery = query.trim().toLowerCase()
  if (!trimmedQuery) return null
  const haystack = target.toLowerCase()
  let score = 0
  let streak = 0
  let qIndex = 0

  for (let i = 0; i < haystack.length && qIndex < trimmedQuery.length; i += 1) {
    if (haystack[i] === trimmedQuery[qIndex]) {
      score += 1 + streak
      if (i === 0 || haystack[i - 1] === ' ' || haystack[i - 1] === '-') {
        score += 2
      }
      streak += 1
      qIndex += 1
    } else {
      streak = 0
    }
  }

  if (qIndex < trimmedQuery.length) return null
  return score - haystack.length * 0.01
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
  const levelIndex = levelOrder.indexOf(org.orgType)
  if (levelIndex === -1) return

  if (org.orgType === 'sector') {
    selectedPath = []
    currentLevelIndex = 0
  } else {
    const path = getOrgPath(org).filter((item) => item.orgType !== 'nation')
    selectedPath = path.slice(0, -1)
    currentLevelIndex = levelIndex
  }

  updateUrlState()
  renderLevel(getFocusBounds(org))
  loadOrgInfo(org)
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

async function apiGet<T>(path: string, params?: Record<string, string | number | boolean | Array<string | number>>): Promise<T> {
  const url = API_BASE ? new URL(`${API_BASE}${path}`) : new URL(path, window.location.origin)
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => url.searchParams.append(`${key}[${index}]`, String(item)))
      } else {
        url.searchParams.set(key, String(value))
      }
    })
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      client: CLIENT_HEADER
    }
  })

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`)
  }

  return (await response.json()) as T
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

function updateUrlState() {
  const params = new URLSearchParams()
  
  if (selectedPath.length > 0) {
    const lastOrg = selectedPath[selectedPath.length - 1]
    params.set('org', String(lastOrg.id))
  } else {
    params.set('level', String(currentLevelIndex))
  }
  
  window.history.replaceState(null, '', `?${params.toString()}`)
}

function restoreStateFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const orgParam = params.get('org')
  const levelParam = params.get('level')
  
  if (orgParam) {
    const orgId = parseInt(orgParam, 10)
    const org = orgById.get(orgId)
    
    if (org) {
      // Build the full path by walking up the parent chain
      const path: Org[] = []
      let current: Org | undefined = org
      
      while (current) {
        path.unshift(current)
        current = current.parentId ? orgById.get(current.parentId) : undefined
      }
      
      // Filter out Nation org since it's already shown in the breadcrumb
      selectedPath = path.filter((o) => o.orgType !== 'nation')
      
      // Derive the level - show children of the selected org, not the org itself
      const levelIndex = levelOrder.indexOf(org.orgType)
      if (levelIndex !== -1) {
        currentLevelIndex = levelIndex + 1
      }
    }
  } else if (levelParam) {
    currentLevelIndex = parseInt(levelParam, 10)
    selectedPath = []
  }
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
          const avatar = pos.avatar_url ?? pos.avatarLogo ?? pos.avatar ?? pos.logo ?? UNKNOWN_AVATAR_SVG
          const avatarMarkup = `<img src="${avatar}" alt="${name}" class="info-avatar" loading="lazy" />`
          return `<li class="info-position">${avatarMarkup}<div><div class="info-role">${title}</div><div class="info-person">${name}</div></div></li>`
        })
        .join('')
    : '<li class="info-empty">No positions listed.</li>'

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
      <div class="info-label">Positions</div>
      <ul class="info-list">${positionMarkup}</ul>
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

function cross(o: Point, a: Point, b: Point): number {
  return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng)
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

function convexHull(points: Point[]): Point[] {
  if (points.length <= 1) return points

  const sorted = [...points].sort((p1, p2) => (p1.lng === p2.lng ? p1.lat - p2.lat : p1.lng - p2.lng))
  const lower: Point[] = []

  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop()
    }
    lower.push(point)
  }

  const upper: Point[] = []
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop()
    }
    upper.push(point)
  }

  upper.pop()
  lower.pop()
  return lower.concat(upper)
}

function renderBreadcrumb() {
  const crumbs = [
    { label: 'Nation', depth: -1 },
    ...selectedPath.map((org, idx) => ({ label: org.name, depth: idx }))
  ]
  
  const crumbHtml = crumbs
    .map((crumb, idx) => {
      const isLast = idx === crumbs.length - 1
      const isNation = crumb.depth === -1
      // Mark as non-clickable only if it's the last crumb AND not Nation
      const isNonClickable = isLast && !isNation
      return `<span class="breadcrumb-crumb${isNonClickable ? ' breadcrumb-current' : ''}" data-depth="${crumb.depth}">${crumb.label}</span>`
    })
    .join(' <span class="breadcrumb-sep">/</span> ')
  
  breadcrumbEl.innerHTML = crumbHtml
  backBtn.disabled = selectedPath.length === 0
  
  // Add click handlers to all clickable breadcrumbs
  // All breadcrumbs are clickable except the last one (unless it's Nation)
  breadcrumbEl.querySelectorAll('.breadcrumb-crumb').forEach((crumb) => {
    const isNationCrumb = (crumb as HTMLElement).dataset.depth === '-1'
    const isCurrentStyle = crumb.classList.contains('breadcrumb-current')
    
    // Nation is always clickable, others only if not marked as current
    if (isNationCrumb || !isCurrentStyle) {
      crumb.addEventListener('click', () => {
        const depth = parseInt((crumb as HTMLElement).dataset.depth!)
        if (depth === -1) {
          // Clicking Nation: show sectors on map but Nation info in sidebar
          selectedPath = []
          currentLevelIndex = 0
          updateUrlState()
          renderLevel()
          // Display Nation info after rendering sectors
          displayNationInfo()
        } else {
          selectedPath = selectedPath.slice(0, depth + 1)
          currentLevelIndex = depth + 1
          updateUrlState()
          renderLevel()
        }
      })
    }
  })
}

function getCurrentLevelOrgs(): Org[] {
  const level = levelOrder[currentLevelIndex]

  if (level === 'sector') {
    return [...orgById.values()]
      .filter((org) => org.orgType === 'sector')
  }

  const parent = selectedPath[selectedPath.length - 1]
  
  // If no parent selected, show all orgs of this level (for layer button views)
  if (!parent) {
    return [...orgById.values()].filter((org) => org.orgType === level)
  }

  // Special handling for International: get all region descendants (not just direct children)
  if (isSectorInternational(parent) && level === 'region') {
    const internationalDescendants = getDescendantOrgIds(parent.id)
    return [...orgById.values()].filter((org) => org.orgType === 'region' && internationalDescendants.includes(org.id))
  }

  return [...orgById.values()].filter((org) => org.orgType === level && org.parentId === parent.id)
}

function renderLevel(focusBounds?: L.LatLngBounds) {
  layerGroup.clearLayers()
  renderBreadcrumb()
  
  // Update active layer button
  layersContainer.querySelectorAll('.layer-btn').forEach((btn) => btn.classList.remove('layer-active'))
  const activeBtn = layersContainer.querySelector(`[data-level="${currentLevelIndex}"]`)
  if (activeBtn) activeBtn.classList.add('layer-active')

  const level = levelOrder[currentLevelIndex]
  const orgs = getCurrentLevelOrgs()
  const allLatLngs: L.LatLng[] = []

  orgs.forEach((org) => {
    let latLngs: L.LatLng[]
    
    // Special handling for International sector and General International Area - create star polygon in Atlantic
    if (isSectorInternational(org) || isGeneralInternationalArea(org)) {
      const atlanticCenter = { lat: 20, lng: -40 }
      const starPoints = createStarPolygon(atlanticCenter, 8, 5)
      latLngs = starPoints.map((point) => L.latLng(point.lat, point.lng))
      allLatLngs.push(...latLngs)
    } else {
      const points = getOrgPoints(org)
      
      // For regions/areas with fewer than 3 points, create a circle buffer
      if (points.length < 3) {
        if (points.length === 0) return
        const center = { lat: points[0].lat, lng: points[0].lng }
        if (points.length === 2) {
          // Average the two points
          center.lat = (points[0].lat + points[1].lat) / 2
          center.lng = (points[0].lng + points[1].lng) / 2
        }
        const circlePoints = createCircleBuffer(center, 0.15) // ~16km radius at equator
        latLngs = circlePoints.map((point) => L.latLng(point.lat, point.lng))
        allLatLngs.push(...latLngs)
      } else {
        const hull = convexHull(points)
        if (hull.length < 3) return
        latLngs = hull.map((point) => L.latLng(point.lat, point.lng))
        allLatLngs.push(...latLngs)
      }
    }

    const polygon = L.polygon(latLngs, {
      color: getOrgColor(org.id),
      weight: 2,
      fillColor: getOrgColor(org.id),
      fillOpacity: 0.18
    })

    polygon.on('mouseover', () => {
      polygon.setStyle({ weight: 3, fillOpacity: 0.28 })
      loadOrgInfo(org)
    })

    polygon.on('mouseout', () => {
      polygon.setStyle({ weight: 2, fillOpacity: 0.18 })
    })

    polygon.on('click', () => {
      // Regions are view-only, don't navigate on click
      if (org.orgType === 'region') return
      if (currentLevelIndex >= levelOrder.length - 1) return
      
      // If viewing all orgs of a level (no parent selected) and clicking an org with a parent,
      // include the parent in the path for proper breadcrumb navigation
      // Skip Nation org since it's already shown in the breadcrumb
      if (selectedPath.length === 0 && org.parentId) {
        const parent = orgById.get(org.parentId)
        if (parent && parent.orgType !== 'nation') {
          selectedPath = [parent, org]
        } else {
          selectedPath = [org]
        }
      } else {
        selectedPath = [...selectedPath, org]
      }
      
      // Skip Area level for International sector and General International Area
      if (isSectorInternational(org) || isGeneralInternationalArea(org)) {
        currentLevelIndex = 2 // Jump to 'region' level (0=sector, 1=area, 2=region)
        updateUrlState()
        renderLevel() // No focus bounds - zoom to all regions instead of the star
      } else {
        currentLevelIndex += 1
        updateUrlState()
        const focusBounds = org.orgType === 'area' ? undefined : polygon.getBounds()
        renderLevel(focusBounds)
      }
    })

    polygon.addTo(layerGroup)
  })

  if (focusBounds) {
    map.fitBounds(focusBounds, { padding: [24, 24] })
  } else if (allLatLngs.length > 0) {
    map.fitBounds(L.latLngBounds(allLatLngs), { padding: [24, 24] })
  }

  if (orgs.length === 0) {
    renderPlaceholder(`No ${level}s available.`)
  }
}

backBtn.addEventListener('click', () => {
  if (selectedPath.length === 0) return
  selectedPath = selectedPath.slice(0, -1)
  currentLevelIndex = Math.max(0, currentLevelIndex - 1)
  const focusOrg = selectedPath[selectedPath.length - 1]
  const focusPoints = focusOrg ? getOrgPoints(focusOrg) : []
  const focusHull = focusPoints.length >= 3 ? convexHull(focusPoints) : []
  const focusBounds = focusHull.length >= 3 ? L.latLngBounds(focusHull.map((p) => L.latLng(p.lat, p.lng))) : undefined
  updateUrlState()
  renderLevel(focusBounds)
})

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

  restoreStateFromUrl()
  renderLevel()
  displayNationInfo()
  setMapLoading(false)
}

init().catch((error) => {
  renderPlaceholder('Failed to load data.')
  setMapLoading(false)
  console.error(error)
})
