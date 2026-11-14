import { polarToLatLon, latLonToPolar, fetchPointElevation, getSatelliteTileUrl, computeCustomEphemeris, R_MOON } from '../core/nasaTrekApi.js';

/**
 * 2D Interactive Lunar South Pole Gridded Map
 * 
 * Features:
 * - Polar Stereographic projection (85°S - 90°S, ±150 km)
 * - NASA Moon Trek LROC WAC satellite mosaic basemap
 * - Concentric latitude circles (85°S - 90°S) and meridian rays
 * - Clickable 10km-20km grid sectors for arbitrary lunar exploration
 * - Pinned candidate landing sites (Site 01, 04, 07, 11, 23)
 * - Real-time coordinate inspection (Lat, Lon, Polar meters, Elevation)
 * - Blender dark-graphite UI styling with Teleport to 3D capability
 */
export class SouthPoleMap2D {
  constructor(container, onTeleportCallback) {
    this.container = container;
    this.onTeleport = onTeleportCallback;

    this.width = container.clientWidth || 1024;
    this.height = container.clientHeight || 768;

    // Viewport transform (meters to canvas pixels)
    // Map extent: -160,000 m to +160,000 m (320 km wide)
    this.mapExtentM = 160000.0;
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    // Grid definition: 16x16 sectors of 20km x 20km
    this.gridCols = 16;
    this.gridRows = 16;
    this.sectorSizeM = (this.mapExtentM * 2.0) / this.gridCols; // 20,000m = 20km

    // Candidate landing sites (loaded dynamically from data_out/sites.json per Rule 1)
    this.candidateSites = [];

    // Currently selected target
    this.currentHourIndex = 0;
    this.currentTimestamp = '2027-01-09T00:00:00Z';
    this.selectedTarget = null;

    this.hoverTarget = null;
    this.basemapImage = null;

    this.initDOM();
    this.loadSitesFromData();
    this.loadBasemap();
    this.attachEvents();
    this.render();
  }

  async loadSitesFromData() {
    try {
      const res = await fetch('./data/sites.json');
      if (res.ok) {
        const sites = await res.json();
        this.candidateSites = sites.map((s) => {
          const p = latLonToPolar(s.lat, s.lon);
          return {
            id: s.id,
            name: s.name,
            lat: s.lat,
            lon: s.lon,
            elev: s.ground_height_m,
            polarX: p.x,
            polarY: p.y,
          };
        });

        const defaultSite = this.candidateSites.find(s => s.id === 'site04') || this.candidateSites[0];
        if (defaultSite) {
          const normLon = defaultSite.lon < 0 ? defaultSite.lon + 360 : defaultSite.lon;
          this.selectedTarget = {
            sectorCol: Math.floor((defaultSite.polarX + this.mapExtentM) / this.sectorSizeM),
            sectorRow: Math.floor((defaultSite.polarY + this.mapExtentM) / this.sectorSizeM),
            polarX: defaultSite.polarX,
            polarY: defaultSite.polarY,
            lat: defaultSite.lat,
            lon: normLon,
            elev: defaultSite.elev,
            name: `${defaultSite.name} (${defaultSite.id.toUpperCase()})`,
            siteId: defaultSite.id,
            sectorId: 'SEC-04',
            isCandidateSite: true,
            ephemeris: null,
          };
          this.updateInspector();
        }
        this.render();
      }
    } catch (err) {
      console.warn('[SouthPoleMap2D] Failed to load sites.json:', err);
    }
  }

  initDOM() {
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'map2d-wrapper';
    this.wrapper.style.display = 'none'; // Initially hidden, toggled via dropdown

    // Canvas
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map2d-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.wrapper.appendChild(this.canvas);

    // Overlay Header & HUD
    this.hudHeader = document.createElement('div');
    this.hudHeader.className = 'map2d-hud-header';
    this.hudHeader.innerHTML = `
      <div class="map2d-title-group">
        <svg class="map2d-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="2" x2="12" y2="22"></line>
          <line x1="2" y1="12" x2="22" y2="12"></line>
          <circle cx="12" cy="12" r="6"></circle>
        </svg>
        <span class="map2d-title">LUNAR SOUTH POLE 2D NAVIGATOR (85°S – 90°S)</span>
      </div>
      <div class="map2d-ephem-readout">
        <span id="map2d-time-text" class="map2d-readout-time">2027-01-01 00:00 UTC</span>
        <span class="map2d-readout-tag tag-sun">☉ SUN: <b id="map2d-sun-text">—</b></span>
        <span class="map2d-readout-tag tag-earth">♁ EARTH: <b id="map2d-earth-text">—</b></span>
      </div>
      <div class="map2d-nav-tools">
        <button id="map2d-btn-zoom-in" class="blender-tool-pill tooltip-trigger" data-tooltip="Zoom In (+)">+</button>
        <button id="map2d-btn-zoom-out" class="blender-tool-pill tooltip-trigger" data-tooltip="Zoom Out (-)">−</button>
        <button id="map2d-btn-reset" class="blender-tool-pill tooltip-trigger" data-tooltip="Reset View [Pole Center]">Reset</button>
      </div>
    `;
    this.wrapper.appendChild(this.hudHeader);

    // Moon Trek Style Floating Cursor Badge
    this.cursorBadge = document.createElement('div');
    this.cursorBadge.className = 'map2d-floating-badge';
    this.cursorBadge.style.display = 'none';
    this.wrapper.appendChild(this.cursorBadge);

    // Inspector Card (Blender floating side-card)
    this.inspectorCard = document.createElement('div');
    this.inspectorCard.className = 'map2d-inspector-card';
    this.wrapper.appendChild(this.inspectorCard);

    // Status bar at bottom
    this.statusBar = document.createElement('div');
    this.statusBar.className = 'map2d-status-bar';
    this.wrapper.appendChild(this.statusBar);

    this.container.appendChild(this.wrapper);
    this.resize();
    this.updateInspector();
  }

  loadBasemap() {
    // NASA Moon Trek WAC South Pole Mosaic
    const extent = this.mapExtentM;
    const url = getSatelliteTileUrl([-extent, -extent, extent, extent], 1024, 1024);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.basemapImage = img;
      this.render();
    };
    img.onerror = () => {
      console.warn('Moon Trek WAC basemap failed to load, using high-contrast vector cartography');
      this.render();
    };
    img.src = url;
  }

  resize() {
    const rect = this.wrapper.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width || window.innerWidth;
    this.height = rect.height || window.innerHeight;

    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.render();
  }

  setVisible(visible) {
    this.wrapper.style.display = visible ? 'block' : 'none';
    if (visible) {
      this.resize();
    }
  }

  // Coordinate transforms
  worldToCanvas(xM, yM) {
    const scale = (Math.min(this.width, this.height) * 0.46 * this.zoom) / this.mapExtentM;
    const cx = this.width / 2 + this.panX;
    const cy = this.height / 2 + this.panY;
    // In polar stereographic, East is +X, North towards 0° meridian is -Y
    return {
      cx: cx + xM * scale,
      cy: cy - yM * scale,
    };
  }

  canvasToWorld(cx, cy) {
    const scale = (Math.min(this.width, this.height) * 0.46 * this.zoom) / this.mapExtentM;
    const centerX = this.width / 2 + this.panX;
    const centerY = this.height / 2 + this.panY;
    const xM = (cx - centerX) / scale;
    const yM = -(cy - centerY) / scale;
    return { xM, yM };
  }

  attachEvents() {
    window.addEventListener('resize', () => {
      if (this.wrapper.style.display !== 'none') this.resize();
    });

    // Panning
    this.canvas.addEventListener('mousedown', (e) => {
      this.isPanning = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isPanning && this.wrapper.style.display !== 'none') {
        const dx = e.clientX - this.lastMouseX;
        const dy = e.clientY - this.lastMouseY;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this.panX += dx;
        this.panY += dy;
        this.render();
      }
    });

    window.addEventListener('mouseup', () => {
      this.isPanning = false;
    });

    // Mouse move hover & coordinates
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const { xM, yM } = this.canvasToWorld(cx, cy);

      const { lat, lon } = polarToLatLon(xM, yM);
      const col = Math.floor((xM + this.mapExtentM) / this.sectorSizeM);
      const row = Math.floor((yM + this.mapExtentM) / this.sectorSizeM);

      const colCode = String.fromCharCode(65 + Math.max(0, Math.min(this.gridCols - 1, col)));
      const rowCode = String(Math.max(1, Math.min(this.gridRows, row + 1))).padStart(2, '0');
      const sectorId = `SEC-${colCode}${rowCode}`;

      this.hoverTarget = { cx, cy, xM, yM, lat, lon, col, row, sectorId };

      if (this.cursorBadge) {
        this.cursorBadge.style.display = 'block';
        const left = Math.min(this.width - 240, cx + 18);
        const top = Math.min(this.height - 40, cy + 18);
        this.cursorBadge.style.left = `${left}px`;
        this.cursorBadge.style.top = `${top}px`;
        this.cursorBadge.innerHTML = `<span class="badge-tag">LAT</span> ${lat.toFixed(4)}° <span class="badge-tag">LON</span> ${lon.toFixed(4)}°`;
      }

      this.updateStatusBar();
      this.render();
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoverTarget = null;
      if (this.cursorBadge) this.cursorBadge.style.display = 'none';
      this.updateStatusBar();
      this.render();
    });

    // Zoom via wheel
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      this.zoom = Math.max(0.6, Math.min(8.0, this.zoom * zoomFactor));
      this.render();
    }, { passive: false });

    // Click to select sector or candidate site
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const { xM, yM } = this.canvasToWorld(cx, cy);

      // Check if clicked near candidate site
      let matchedSite = null;
      for (const site of this.candidateSites) {
        const sc = this.worldToCanvas(site.polarX, site.polarY);
        const dist = Math.hypot(sc.cx - cx, sc.cy - cy);
        if (dist < 18) {
          matchedSite = site;
          break;
        }
      }

      if (matchedSite) {
        this.selectCandidateSite(matchedSite);
      } else {
        this.selectCustomCoordinate(xM, yM);
      }
    });

    // Double-click canvas to immediately Teleport to 3D
    this.canvas.addEventListener('dblclick', () => {
      this.triggerTeleport();
    });

    // Zoom Buttons
    this.wrapper.querySelector('#map2d-btn-zoom-in').addEventListener('click', () => {
      this.zoom = Math.min(8.0, this.zoom * 1.3);
      this.render();
    });
    this.wrapper.querySelector('#map2d-btn-zoom-out').addEventListener('click', () => {
      this.zoom = Math.max(0.6, this.zoom / 1.3);
      this.render();
    });
    this.wrapper.querySelector('#map2d-btn-reset').addEventListener('click', () => {
      this.zoom = 1.0;
      this.panX = 0;
      this.panY = 0;
      this.render();
    });
  }

  async selectCustomCoordinate(xM, yM) {
    const { lat, lon } = polarToLatLon(xM, yM);
    const col = Math.floor((xM + this.mapExtentM) / this.sectorSizeM);
    const row = Math.floor((yM + this.mapExtentM) / this.sectorSizeM);
    const colCode = String.fromCharCode(65 + Math.max(0, Math.min(this.gridCols - 1, col)));
    const rowCode = String(Math.max(1, Math.min(this.gridRows, row + 1))).padStart(2, '0');
    const sectorId = `SEC-${colCode}${rowCode}`;

    const eph = computeCustomEphemeris(lat, lon, this.currentHourIndex);

    this.selectedTarget = {
      sectorCol: col,
      sectorRow: row,
      polarX: xM,
      polarY: yM,
      lat,
      lon,
      elev: null, // Queried asynchronously
      name: `Off-Record Sector ${sectorId}`,
      siteId: null,
      sectorId,
      isCandidateSite: false,
      ephemeris: eph,
    };

    this.updateInspector();
    this.render();

    // Query elevation dynamically from Moon Trek ImageServer identify
    const elev = await fetchPointElevation(xM, yM);
    if (this.selectedTarget.polarX === xM && this.selectedTarget.polarY === yM) {
      this.selectedTarget.elev = Math.round(elev * 10) / 10;
      this.updateInspector();
    }
  }

  selectCandidateSite(site) {
    const col = Math.floor((site.polarX + this.mapExtentM) / this.sectorSizeM);
    const row = Math.floor((site.polarY + this.mapExtentM) / this.sectorSizeM);
    const colCode = String.fromCharCode(65 + Math.max(0, Math.min(this.gridCols - 1, col)));
    const rowCode = String(Math.max(1, Math.min(this.gridRows, row + 1))).padStart(2, '0');
    const sectorId = `SEC-${colCode}${rowCode}`;

    const normLon = site.lon < 0 ? site.lon + 360 : site.lon;
    const eph = computeCustomEphemeris(site.lat, normLon, this.currentHourIndex);

    this.selectedTarget = {
      sectorCol: col,
      sectorRow: row,
      polarX: site.polarX,
      polarY: site.polarY,
      lat: site.lat,
      lon: normLon,
      elev: site.elev,
      name: `${site.name} (${site.id.toUpperCase()})`,
      siteId: site.id,
      sectorId,
      isCandidateSite: true,
      ephemeris: eph,
    };

    this.updateInspector();
    this.render();
  }

  updateEphemeris(telemetry) {
    if (!telemetry) return;
    this.currentHourIndex = telemetry.hourIndex || 0;
    this.currentTimestamp = telemetry.timestamp || '2027-01-01T00:00:00Z';

    if (this.selectedTarget) {
      this.selectedTarget.ephemeris = computeCustomEphemeris(
        this.selectedTarget.lat,
        this.selectedTarget.lon,
        this.currentHourIndex
      );
    }

    const timeText = this.wrapper.querySelector('#map2d-time-text');
    const sunText = this.wrapper.querySelector('#map2d-sun-text');
    const earthText = this.wrapper.querySelector('#map2d-earth-text');

    if (timeText && telemetry.timestamp) {
      timeText.textContent = telemetry.timestamp.replace('T', ' ').slice(0, 16) + ' UTC';
    }
    if (this.selectedTarget && this.selectedTarget.ephemeris) {
      const eph = this.selectedTarget.ephemeris;
      if (sunText) sunText.textContent = `${eph.sunAz.toFixed(1)}°, ${eph.sunEl.toFixed(1)}°`;
      if (earthText) earthText.textContent = `${eph.earthAz.toFixed(1)}°, ${eph.earthEl.toFixed(1)}°`;
    }

    this.updateInspector();
    this.render();
  }

  updateInspector() {
    const t = this.selectedTarget;
    if (!t) return;

    const eph = t.ephemeris || computeCustomEphemeris(t.lat, t.lon, this.currentHourIndex);
    const sunText = this.wrapper.querySelector('#map2d-sun-text');
    const earthText = this.wrapper.querySelector('#map2d-earth-text');
    if (sunText) sunText.textContent = `${eph.sunAz.toFixed(1)}°, ${eph.sunEl.toFixed(1)}°`;
    if (earthText) earthText.textContent = `${eph.earthAz.toFixed(1)}°, ${eph.earthEl.toFixed(1)}°`;

    const elevText = t.elev !== null ? `${t.elev.toFixed(1)} m (NASA LOLA)` : 'querying Moon Trek…';
    const tagClass = t.isCandidateSite ? 'badge-candidate' : 'badge-sector';
    const tagLabel = t.isCandidateSite ? 'NASA CANDIDATE SITE' : 'APPROXIMATE EXPLORATION';
    const provenanceNotice = t.isCandidateSite
      ? `<div style="font-size: 11px; color: #a0c49d; margin-top: 6px; padding: 4px 6px; background: rgba(80,180,90,0.12); border-left: 2px solid #50b45a; border-radius: 2px;">Official PGDA candidate site · Validated flight DEM & JPL SPICE ephemeris</div>`
      : `<div style="font-size: 11px; color: #e6b800; margin-top: 6px; padding: 4px 6px; background: rgba(255,180,0,0.12); border-left: 2px solid #e6b800; border-radius: 2px;">Visual exploration only · Topocentric estimate (not flight-certified)</div>`;

    this.inspectorCard.innerHTML = `
      <div class="card-header">
        <div class="card-tag ${tagClass}">${tagLabel}</div>
        <div class="card-sector-id">${t.sectorId || 'TARGET'}</div>
      </div>
      <div class="card-body">
        <h3 class="card-site-name">${t.name}</h3>
        ${provenanceNotice}

        <div class="card-metric-row" style="margin-top: 8px;">
          <span class="metric-label">Latitude</span>
          <span class="metric-value">${t.lat.toFixed(5)}°</span>
        </div>
        <div class="card-metric-row">
          <span class="metric-label">Longitude</span>
          <span class="metric-value">${t.lon.toFixed(5)}°</span>
        </div>
        <div class="card-metric-row">
          <span class="metric-label">Polar Stereographic</span>
          <span class="metric-value">X ${(t.polarX / 1000).toFixed(2)} km, Y ${(t.polarY / 1000).toFixed(2)} km</span>
        </div>
        <div class="card-metric-row">
          <span class="metric-label">Elevation Datum</span>
          <span class="metric-value" style="color: var(--blender-accent);">${elevText}</span>
        </div>
        <div class="card-metric-row">
          <span class="metric-label">Local Sun (Az, El)</span>
          <span class="metric-value" style="color: #facc15; font-weight: bold;">${eph.sunAz.toFixed(1)}°, ${eph.sunEl.toFixed(1)}°</span>
        </div>
        <div class="card-metric-row">
          <span class="metric-label">Local Earth (Az, El)</span>
          <span class="metric-value" style="color: #38bdf8; font-weight: bold;">${eph.earthAz.toFixed(1)}°, ${eph.earthEl.toFixed(1)}°</span>
        </div>
        <div class="card-metric-row">
          <span class="metric-label">Data Source</span>
          <span class="metric-value" style="font-size: 11px;">NASA Moon Trek REST API (EPSG:3031)</span>
        </div>

        <button id="btn-teleport-3d" class="blender-action-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 3h6v6"></path>
            <path d="M10 14 21 3"></path>
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
          </svg>
          <span>TELEPORT TO 3D VIEW</span>
        </button>
        <div class="card-tip">Double-click any sector on map to jump directly</div>
      </div>
    `;

    this.inspectorCard.querySelector('#btn-teleport-3d').addEventListener('click', () => {
      this.triggerTeleport();
    });
  }

  updateStatusBar() {
    if (!this.hoverTarget) {
      this.statusBar.innerHTML = `<span>CURSOR: OUT OF BOUNDS</span><span>CLICK OR DOUBLE-CLICK ANY GRID CELL TO INSPECT & TELEPORT</span>`;
      return;
    }
    const h = this.hoverTarget;
    this.statusBar.innerHTML = `
      <span class="status-item"><strong style="color:var(--blender-text-dim);">SECTOR:</strong> ${h.sectorId}</span>
      <span class="status-item"><strong style="color:var(--blender-text-dim);">LAT:</strong> ${h.lat.toFixed(4)}°</span>
      <span class="status-item"><strong style="color:var(--blender-text-dim);">LON:</strong> ${h.lon.toFixed(4)}°</span>
      <span class="status-item"><strong style="color:var(--blender-text-dim);">POLAR:</strong> X ${(h.xM / 1000).toFixed(2)} km, Y ${(h.yM / 1000).toFixed(2)} km</span>
      <span class="status-item hint">[DOUBLE-CLICK TO TELEPORT TO 3D VIEW]</span>
    `;
  }

  triggerTeleport() {
    if (!this.selectedTarget) return;
    if (this.onTeleport) {
      this.onTeleport(this.selectedTarget);
    }
  }

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // 1. Clear background
    ctx.fillStyle = '#141619';
    ctx.fillRect(0, 0, w, h);

    // 2. Render Basemap (NASA WAC Mosaic or Vector fallback)
    const poleCanvas = this.worldToCanvas(0, 0);
    const cornerCanvas = this.worldToCanvas(this.mapExtentM, this.mapExtentM);
    const radiusPix = Math.abs(cornerCanvas.cx - poleCanvas.cx);

    if (this.basemapImage) {
      const minCanvas = this.worldToCanvas(-this.mapExtentM, this.mapExtentM);
      const maxCanvas = this.worldToCanvas(this.mapExtentM, -this.mapExtentM);
      const imgW = maxCanvas.cx - minCanvas.cx;
      const imgH = maxCanvas.cy - minCanvas.cy;

      ctx.save();
      // Clip to circular lunar polar boundary
      ctx.beginPath();
      ctx.arc(poleCanvas.cx, poleCanvas.cy, radiusPix * 1.02, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(this.basemapImage, minCanvas.cx, minCanvas.cy, imgW, imgH);
      // Dark vignette overlay
      ctx.fillStyle = 'rgba(15, 18, 22, 0.28)';
      ctx.fillRect(minCanvas.cx, minCanvas.cy, imgW, imgH);
      ctx.restore();
    } else {
      // High-tech circular gradient cartography
      const grad = ctx.createRadialGradient(poleCanvas.cx, poleCanvas.cy, 0, poleCanvas.cx, poleCanvas.cy, radiusPix);
      grad.addColorStop(0.0, '#282b30');
      grad.addColorStop(0.7, '#1f2226');
      grad.addColorStop(1.0, '#15171a');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(poleCanvas.cx, poleCanvas.cy, radiusPix, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Polar Grid: Concentric Latitude Rings
    ctx.lineWidth = 1.0;
    const latitudes = [85.0, 86.0, 87.0, 88.0, 89.0, 89.5];
    latitudes.forEach((latDeg) => {
      const p = latLonToPolar(-latDeg, 0);
      const c = this.worldToCanvas(p.x, p.y);
      const rPix = Math.abs(c.cy - poleCanvas.cy);

      ctx.strokeStyle = latDeg === 85.0 ? 'rgba(90, 105, 120, 0.65)' : 'rgba(75, 90, 105, 0.35)';
      ctx.setLineDash(latDeg === 85.0 ? [] : [4, 4]);
      ctx.beginPath();
      ctx.arc(poleCanvas.cx, poleCanvas.cy, rPix, 0, Math.PI * 2);
      ctx.stroke();

      // Label along +Y axis
      ctx.fillStyle = 'rgba(175, 190, 205, 0.75)';
      ctx.font = '10px monospace';
      ctx.fillText(`${latDeg}°S`, poleCanvas.cx + 6, poleCanvas.cy - rPix + 12);
    });
    ctx.setLineDash([]);

    // 4. Meridian Spokes (Longitudes)
    const longitudes = [0, 45, 90, 135, 180, 225, 270, 315];
    longitudes.forEach((lonDeg) => {
      const p = latLonToPolar(-85.0, lonDeg);
      const c = this.worldToCanvas(p.x, p.y);

      ctx.strokeStyle = (lonDeg === 0 || lonDeg === 180) ? 'rgba(100, 120, 140, 0.55)' : 'rgba(65, 80, 95, 0.28)';
      ctx.beginPath();
      ctx.moveTo(poleCanvas.cx, poleCanvas.cy);
      ctx.lineTo(c.cx, c.cy);
      ctx.stroke();

      // Label
      const pLab = latLonToPolar(-84.7, lonDeg);
      const cLab = this.worldToCanvas(pLab.x, pLab.y);
      ctx.fillStyle = 'rgba(160, 175, 190, 0.85)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const dirText = lonDeg === 0 ? '0° (Earth)' : lonDeg === 180 ? '180°' : `${lonDeg}°`;
      ctx.fillText(dirText, cLab.cx, cLab.cy);
    });

    // 5. Square Sector Grid Lines
    ctx.strokeStyle = 'rgba(60, 75, 90, 0.18)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= this.gridCols; i++) {
      const xM = -this.mapExtentM + i * this.sectorSizeM;
      const c0 = this.worldToCanvas(xM, -this.mapExtentM);
      const c1 = this.worldToCanvas(xM, this.mapExtentM);
      ctx.beginPath();
      ctx.moveTo(c0.cx, c0.cy);
      ctx.lineTo(c1.cx, c1.cy);
      ctx.stroke();
    }
    for (let j = 0; j <= this.gridRows; j++) {
      const yM = -this.mapExtentM + j * this.sectorSizeM;
      const c0 = this.worldToCanvas(-this.mapExtentM, yM);
      const c1 = this.worldToCanvas(this.mapExtentM, yM);
      ctx.beginPath();
      ctx.moveTo(c0.cx, c0.cy);
      ctx.lineTo(c1.cx, c1.cy);
      ctx.stroke();
    }

    // 6. Highlight Hovered Sector
    if (this.hoverTarget) {
      const h = this.hoverTarget;
      const x0 = -this.mapExtentM + h.col * this.sectorSizeM;
      const y0 = -this.mapExtentM + h.row * this.sectorSizeM;
      const cTopLeft = this.worldToCanvas(x0, y0 + this.sectorSizeM);
      const cBottomRight = this.worldToCanvas(x0 + this.sectorSizeM, y0);
      const wPix = cBottomRight.cx - cTopLeft.cx;
      const hPix = cBottomRight.cy - cTopLeft.cy;

      ctx.fillStyle = 'rgba(78, 161, 255, 0.12)';
      ctx.fillRect(cTopLeft.cx, cTopLeft.cy, wPix, hPix);
      ctx.strokeStyle = 'rgba(78, 161, 255, 0.45)';
      ctx.strokeRect(cTopLeft.cx, cTopLeft.cy, wPix, hPix);

      // Mouse Crosshairs
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(h.cx, 0); ctx.lineTo(h.cx, this.height);
      ctx.moveTo(0, h.cy); ctx.lineTo(this.width, h.cy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 7. Selected Target Box & Reticle
    if (this.selectedTarget) {
      const t = this.selectedTarget;
      const tc = this.worldToCanvas(t.polarX, t.polarY);

      // Sector bounding box
      const x0 = -this.mapExtentM + t.sectorCol * this.sectorSizeM;
      const y0 = -this.mapExtentM + t.sectorRow * this.sectorSizeM;
      const cTopLeft = this.worldToCanvas(x0, y0 + this.sectorSizeM);
      const cBottomRight = this.worldToCanvas(x0 + this.sectorSizeM, y0);
      const wPix = cBottomRight.cx - cTopLeft.cx;
      const hPix = cBottomRight.cy - cTopLeft.cy;

      ctx.fillStyle = 'rgba(235, 140, 40, 0.16)';
      ctx.fillRect(cTopLeft.cx, cTopLeft.cy, wPix, hPix);
      ctx.strokeStyle = '#eb8c28'; // Blender orange accent
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cTopLeft.cx, cTopLeft.cy, wPix, hPix);

      // Center reticle
      ctx.strokeStyle = '#eb8c28';
      ctx.lineWidth = 2.0;
      const rSize = 12;
      ctx.beginPath();
      ctx.arc(tc.cx, tc.cy, rSize, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(tc.cx - rSize - 4, tc.cy); ctx.lineTo(tc.cx + rSize + 4, tc.cy);
      ctx.moveTo(tc.cx, tc.cy - rSize - 4); ctx.lineTo(tc.cx, tc.cy + rSize + 4);
      ctx.stroke();

      // Dynamic Topocentric Sun & Earth Direction Rays radiating from selected location
      const eph = t.ephemeris || computeCustomEphemeris(t.lat, t.lon, this.currentHourIndex);
      const lonRad = (t.lon * Math.PI) / 180;
      const nx = Math.sin(lonRad);
      const ny = Math.cos(lonRad);
      const ex = Math.cos(lonRad);
      const ey = -Math.sin(lonRad);

      const drawRay = (azDeg, elDeg, color, label, lenPix) => {
        const azRad = (azDeg * Math.PI) / 180;
        const vx = Math.cos(azRad) * nx + Math.sin(azRad) * ex;
        const vy = Math.cos(azRad) * ny + Math.sin(azRad) * ey;

        const endX = tc.cx + vx * lenPix;
        const endY = tc.cy - vy * lenPix;

        // Dashed Ray
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(tc.cx, tc.cy);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Disc Indicator
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(endX, endY, 4, 0, Math.PI * 2);
        ctx.fill();

        // Label Tag
        ctx.font = 'bold 9px monospace';
        const txt = `${label}: ${azDeg.toFixed(0)}° (${elDeg.toFixed(1)}°)`;
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = 'rgba(16, 20, 24, 0.88)';
        ctx.fillRect(endX + 6, endY - 8, tw + 8, 16);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.0;
        ctx.strokeRect(endX + 6, endY - 8, tw + 8, 16);
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, endX + 10, endY);
      };

      drawRay(eph.sunAz, eph.sunEl, '#facc15', 'SUN', 80);
      drawRay(eph.earthAz, eph.earthEl, '#38bdf8', 'EARTH', 105);
    }

    // 8. Candidate Landing Sites Markers
    this.candidateSites.forEach((site) => {
      const sc = this.worldToCanvas(site.polarX, site.polarY);
      const isSelected = this.selectedTarget && this.selectedTarget.siteId === site.id;

      // Glow Halo
      ctx.fillStyle = isSelected ? 'rgba(235, 140, 40, 0.35)' : 'rgba(56, 189, 248, 0.25)';
      ctx.beginPath();
      ctx.arc(sc.cx, sc.cy, isSelected ? 12 : 8, 0, Math.PI * 2);
      ctx.fill();

      // Core Marker
      ctx.fillStyle = isSelected ? '#eb8c28' : '#38bdf8';
      ctx.beginPath();
      ctx.arc(sc.cx, sc.cy, isSelected ? 5 : 4, 0, Math.PI * 2);
      ctx.fill();

      // Outer Ring
      ctx.strokeStyle = isSelected ? '#ffffff' : '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sc.cx, sc.cy, isSelected ? 9 : 7, 0, Math.PI * 2);
      ctx.stroke();

      // Label Badge
      ctx.fillStyle = '#ffffff';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${site.id.toUpperCase()}: ${site.name}`, sc.cx + 12, sc.cy);
    });

    // 9. South Pole Center Pin (90°S)
    ctx.fillStyle = '#f87171';
    ctx.beginPath();
    ctx.arc(poleCanvas.cx, poleCanvas.cy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('90°S POLE', poleCanvas.cx, poleCanvas.cy + 10);
  }
}
