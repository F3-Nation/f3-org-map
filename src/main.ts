import './style.css'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import turfArea from '@turf/area'
import { polygon as turfPolygon } from '@turf/helpers'

const API_BASE = 'https://api.f3nation.com'
const API_KEY = 'f3-org-map'
const CLIENT_HEADER = 'scalar-api'

type OrgType = 'nation' | 'sector' | 'area' | 'region' | 'ao'

type Org = {
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

type Location = {
  id: number
  name: string
  latitude?: number | null
  longitude?: number | null
  isActive?: boolean
}

type Event = {
  id: number
  locationId?: number | null
  isActive?: boolean
  parents?: Array<{ parentId: number; parentName: string }>
  regions?: Array<{ regionId: number; regionName: string }>
}

type Position = {
  title?: string
  name?: string
  email?: string
  phone?: string
}

type Point = { lat: number; lng: number }

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
      <section id="map" class="map"></section>
      <aside class="info" id="info">
        <div class="info-title">Loading organizations...</div>
        <div class="info-body"></div>
      </aside>
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
const locationById = new Map<number, Location>()
const eventsByOrgId = new Map<number, Event[]>()
const orgColors = new Map<number, string>()

function generateRandomColor(): string {
  const letters = '0123456789ABCDEF'
  let color = '#'
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)]
  }
  return color
}

function getOrgColor(orgId: number): string {
  if (orgColors.has(orgId)) {
    return orgColors.get(orgId)!
  }
  const color = generateRandomColor()
  orgColors.set(orgId, color)
  return color
}

async function apiGet<T>(path: string, params?: Record<string, string | number | boolean | Array<string | number>>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`)
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

async function fetchPaged<T>(path: string, params: Record<string, string | number | boolean | Array<string | number>>): Promise<T[]> {
  const results: T[] = []
  const pageSize = 1000
  let pageIndex = 0

  while (true) {
    const payload = await apiGet<unknown>(path, { ...params, pageIndex, pageSize })
    const items = extractItems<T>(payload)
    results.push(...items)

    if (items.length < pageSize) {
      break
    }

    pageIndex += 1
  }

  return results
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

function getPositions(): Position[] {
  return []
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

function renderInfo(org: Org) {
  const positions = getPositions()
  const descendantIds = getDescendantOrgIds(org.id)
  const descendantOrgs = descendantIds
    .map((id) => orgById.get(id))
    .filter((item): item is Org => item !== undefined)
  const eventIds = new Set<number>()
  const locationIds = new Set<number>()
  descendantIds.forEach((id) => {
    const events = eventsByOrgId.get(id) ?? []
    events.forEach((event) => {
      eventIds.add(event.id)
      if (event.locationId != null) {
        locationIds.add(event.locationId)
      }
    })
  })
  const sectorCount = descendantOrgs.filter((item) => item.orgType === 'sector').length
  const areaCount = descendantOrgs.filter((item) => item.orgType === 'area').length
  const regionCount = descendantOrgs.filter((item) => item.orgType === 'region').length
  const aoCount = descendantOrgs.filter((item) => item.orgType === 'ao').length
  const eventsCount = eventIds.size
  const locationsCount = locationIds.size
  const formattedAreaCount = formatNumber(areaCount)
  const formattedRegionCount = formatNumber(regionCount)
  const formattedSectorCount = formatNumber(sectorCount)
  const formattedAoCount = formatNumber(aoCount)
  const formattedEventsCount = formatNumber(eventsCount)
  const formattedLocationsCount = formatNumber(locationsCount)
  let regionFootprint: number | null = null
  if (org.orgType === 'region') {
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
  const emailDisplay = org.email 
    ? `<a href="mailto:${org.email}" class="info-link">${org.email}</a>`
    : 'Not listed'
  
  const socialLinks: string[] = []
  if (org.website) {
    socialLinks.push(`<a href="${org.website}" target="_blank" rel="noopener noreferrer" class="info-link">🌐 Website</a>`)
  }
  if (org.twitter) {
    socialLinks.push(`<a href="https://twitter.com/${org.twitter}" target="_blank" rel="noopener noreferrer" class="info-link">𝕏 Twitter</a>`)
  }
  if (org.facebook) {
    socialLinks.push(`<a href="https://facebook.com/${org.facebook}" target="_blank" rel="noopener noreferrer" class="info-link">f Facebook</a>`)
  }
  if (org.instagram) {
    socialLinks.push(`<a href="https://instagram.com/${org.instagram}" target="_blank" rel="noopener noreferrer" class="info-link">📷 Instagram</a>`)
  }
  
  const socialMarkup = socialLinks.length > 0 
    ? `<div class="info-section"><div class="info-label">Connect</div><div class="info-social">${socialLinks.join('')}</div></div>` 
    : ''

  const positionMarkup = positions.length
    ? positions
        .map((pos) => {
          const title = pos.title ?? 'Leader'
          const name = pos.name ?? 'Unknown'
          const contact = pos.email ?? pos.phone ?? 'No contact listed'
          return `<li><div class="info-role">${title}</div><div class="info-person">${name}</div><div class="info-contact">${contact}</div></li>`
        })
        .join('')
    : '<li class="info-empty">No positions listed (coming soon).</li>'

  infoPanel.innerHTML = `
    <div class="info-title">${org.name}</div>
    <div class="info-subtitle">${org.orgType.toUpperCase()}</div>
    <div class="info-section">
      <div class="info-label">Organization Email</div>
      <div class="info-value">${emailDisplay}</div>
    </div>
    ${socialMarkup}
    <div class="info-section">
      <div class="info-label">Counts</div>
      <div class="info-value">
        ${org.orgType === 'nation' ? `<div>Sectors: ${formattedSectorCount}</div>` : ''}
        ${org.orgType === 'nation' || org.orgType === 'sector' ? `<div>Areas: ${formattedAreaCount}</div>` : ''}
        ${org.orgType === 'nation' || org.orgType === 'sector' || org.orgType === 'area' ? `<div>Regions: ${formattedRegionCount}</div>` : ''}
        <div>AOs: ${formattedAoCount}</div>
        <div>Events: ${formattedEventsCount}</div>
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

function displayNationInfo() {
  const nationOrg = orgById.get(1)
  if (nationOrg) {
    renderInfo(nationOrg)
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
  const seenLocationIds = new Set<number>()

  orgIds.forEach((descendantId) => {
    const events = eventsByOrgId.get(descendantId) ?? []
    events.forEach((event) => {
      if (!event.locationId || seenLocationIds.has(event.locationId)) return
      const location = locationById.get(event.locationId)
      if (!location || location.latitude == null || location.longitude == null) return
      seenLocationIds.add(event.locationId)
      points.push({ lat: location.latitude, lng: location.longitude })
    })
  })

  return points
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
      renderInfo(org)
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
        renderLevel(polygon.getBounds())
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
  renderPlaceholder('Loading organizations...')

  const [orgs, locations, events] = await Promise.all([
    fetchPaged<Org>('/v1/org', {
      orgTypes: ['nation', 'sector', 'area', 'region', 'ao'],
      statuses: ['active']
    }),
    fetchPaged<Location>('/v1/location', {
      statuses: ['active']
    }),
    fetchPaged<Event>('/v1/event', {
      statuses: ['active']
    })
  ])

  console.log(`Loaded ${orgs.length} orgs, ${locations.length} locations, ${events.length} events`)

  orgs.forEach((org) => {
    orgById.set(org.id, org)
  })

  const sectors = orgs.filter(o => o.orgType === 'sector')
  console.log(`Found ${sectors.length} sectors:`, sectors.map(s => ({ id: s.id, name: s.name })))

  buildChildrenMap(orgs)
  orgDescendantsCache.clear()

  locations.forEach((location) => {
    locationById.set(location.id, location)
  })

  events.forEach((event) => {
    const orgIds: number[] = []

    if (event.parents) {
      event.parents.forEach((p) => orgIds.push(p.parentId))
    }
    if (event.regions) {
      event.regions.forEach((r) => orgIds.push(r.regionId))
    }

    orgIds.forEach((orgId) => {
      const list = eventsByOrgId.get(orgId) ?? []
      list.push(event)
      eventsByOrgId.set(orgId, list)
    })
  })

  console.log(`Events mapped to ${eventsByOrgId.size} orgs`)

  sectors.forEach(sector => {
    const points = getOrgPoints(sector)
    console.log(`Sector "${sector.name}" (${sector.id}): ${points.length} points`)
  })

  restoreStateFromUrl()
  renderLevel()
  displayNationInfo()
}

init().catch((error) => {
  renderPlaceholder('Failed to load data.')
  console.error(error)
})
