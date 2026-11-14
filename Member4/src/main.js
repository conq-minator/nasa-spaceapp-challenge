import { LanderSimulation } from './simulation/LanderSimulation.js';
import { SouthPoleMap2D } from './simulation/SouthPoleMap2D.js';
import { evaluateCustomExpedition } from './core/nasaTrekApi.js';

// DOM Elements
const container = document.getElementById('simulation-container');
const map2dContainer = document.getElementById('map-2d-container');
const viewportModeSelect = document.getElementById('viewport-mode-select');
const toolsDock = document.querySelector('.blender-tools-dock');
const timeSlider = document.getElementById('time-slider');
const frameInput = document.getElementById('frame-input');
const timeIsoText = document.getElementById('time-iso-text');
const sunCoordsText = document.getElementById('sun-coords-text');
const earthCoordsText = document.getElementById('earth-coords-text');

let map2d = null;

const siteSelector = document.getElementById('site-selector');
const badgeSun = document.getElementById('badge-sun');
const badgeEarth = document.getElementById('badge-earth');
const sunStatusText = document.getElementById('sun-status-text');
const earthStatusText = document.getElementById('earth-status-text');
const raycastAgreementText = document.getElementById('raycast-agreement-text');

const trackingBadge = document.getElementById('tracking-indicator-badge');
const trackingText = document.getElementById('tracking-indicator-text');

const batteryBarFill = document.getElementById('battery-bar-fill');
const batteryPctText = document.getElementById('battery-pct-text');
const dataProvenanceText = document.getElementById('data-provenance-text');

const failureBanner = document.getElementById('failure-banner');
const failureBannerText = document.getElementById('failure-banner-text');

const btnPlayPause = document.getElementById('btn-play-pause');
const btnStepBack = document.getElementById('btn-step-back');
const btnStepFwd = document.getElementById('btn-step-fwd');
const btnStepStart = document.getElementById('btn-step-start');
const btnStepEnd = document.getElementById('btn-step-end');
const speedSelector = document.getElementById('speed-selector');

const btnModeLander = document.getElementById('btn-mode-lander');
const btnModeOverview = document.getElementById('btn-mode-overview');

const btnMaskToggle = document.getElementById('btn-mask-toggle');

const btnLayerNone = document.getElementById('btn-layer-none');
const btnLayerSlope = document.getElementById('btn-layer-slope');
const btnLayerRock = document.getElementById('btn-layer-rock');
const legendSlope = document.getElementById('legend-slope');
const legendRock = document.getElementById('legend-rock');

const btnScale1x = document.getElementById('btn-scale-1x');
const btnScale3x = document.getElementById('btn-scale-3x');
const btnScale5x = document.getElementById('btn-scale-5x');

const btnLookSun = document.getElementById('btn-look-sun');
const btnLookEarth = document.getElementById('btn-look-earth');
const btnLookNorth = document.getElementById('btn-look-north');
const btnJumpFailure = document.getElementById('btn-jump-failure');
const windowStartInput = document.getElementById('window-start-input');
const windowEndInput = document.getElementById('window-end-input');
const totalHoursInput = document.getElementById('total-hours-input');
const delayInput = document.getElementById('delay-input');
const frameTicks = document.getElementById('frame-ticks');

const countdownText = document.getElementById('countdown-text');
const scaleWarningBadge = document.getElementById('scale-warning-badge');
const scaleWarningText = document.getElementById('scale-warning-text');
const walkWarningBadge = document.getElementById('walk-warning-badge');
const walkWarningText = document.getElementById('walk-warning-text');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingStatusText = document.getElementById('loading-status-text');

// Initialize the 3D Lander Digital Twin Simulation
const sim = new LanderSimulation(
  container,
  (telemetry) => {
    // Update time and frame display
    timeSlider.value = telemetry.hourIndex;
    frameInput.value = telemetry.hourIndex;
    timeIsoText.textContent = telemetry.timestamp;
    sunCoordsText.textContent = `${telemetry.sunAz}°, ${telemetry.sunEl}°`;
    earthCoordsText.textContent = `${telemetry.earthAz}°, ${telemetry.earthEl}°`;

    // Update Tracking Lock Telemetry
    if (telemetry.trackingTarget === 'sun') {
      trackingBadge.style.display = 'flex';
      trackingText.textContent = 'TRACKING: SUN (LOCKED)';
      btnLookSun.classList.add('active');
      btnLookEarth.classList.remove('active');
    } else if (telemetry.trackingTarget === 'earth') {
      trackingBadge.style.display = 'flex';
      trackingText.textContent = 'TRACKING: EARTH (LOCKED)';
      btnLookEarth.classList.add('active');
      btnLookSun.classList.remove('active');
    } else {
      trackingBadge.style.display = 'none';
      btnLookSun.classList.remove('active');
      btnLookEarth.classList.remove('active');
    }

    // Mission window: slider / frame inputs allow full-year scrubbing (0-8759), inputs show bounds.
    const win = telemetry.window;
    if (win && win.hours) {
      const totalMax = (telemetry.totalHours ? telemetry.totalHours - 1 : 8759);
      if (!sim.expeditionWindow) {
        if (Number(timeSlider.max) !== totalMax || Number(timeSlider.min) !== 0) {
          timeSlider.min = 0;
          timeSlider.max = totalMax;
          frameInput.min = 0;
          frameInput.max = totalMax;
          frameTicks.innerHTML = Array.from({ length: 5 }, (_, k) =>
            `<span>${Math.round((k * totalMax) / 4)}</span>`).join('');
        }
        windowStartInput.value = 0;
        windowEndInput.value = totalMax;
      } else {
        const exp = sim.expeditionWindow;
        if (Number(timeSlider.min) !== exp.startIdx || Number(timeSlider.max) !== exp.endIdx) {
          timeSlider.min = exp.startIdx;
          timeSlider.max = exp.endIdx;
          frameInput.min = exp.startIdx;
          frameInput.max = exp.endIdx;
          frameTicks.innerHTML = Array.from({ length: 5 }, (_, k) =>
            `<span>${Math.round(exp.startIdx + (k * (exp.endIdx - exp.startIdx)) / 4)}</span>`).join('');
        }
        windowStartInput.value = exp.startIdx;
        windowEndInput.value = exp.endIdx;
      }
      if (totalHoursInput) totalHoursInput.value = totalMax;
    }
    delayInput.value = telemetry.delayDays;

    // Battery (missionLogic.batteryTrace; scenario assumption, not NASA data). "—" outside the window.
    if (telemetry.landerState) {
      const soc = telemetry.landerState.socPct;
      batteryBarFill.style.width = `${soc}%`;
      batteryPctText.textContent = `${soc}%`;

      if (soc < 20) {
        batteryBarFill.style.backgroundColor = 'var(--blender-danger)';
      } else if (soc < 45) {
        batteryBarFill.style.backgroundColor = 'var(--blender-accent)';
      } else {
        batteryBarFill.style.backgroundColor = 'var(--blender-success)';
      }
    } else {
      batteryBarFill.style.width = '0%';
      batteryPctText.textContent = '—';
    }

    // Sun / Earth badges: engine flag, independent ray-cast result in brackets.
    const ray = (v) => (v ? 'ray: clear' : 'ray: blocked');
    badgeSun.className = `telemetry-box ${telemetry.sunLitEngine ? 'status-ok' : 'status-blocked'}`;
    sunStatusText.textContent = `SUN: ${telemetry.sunLitEngine ? 'OK' : 'BLOCKED'} (${ray(telemetry.sunLitRaycast)})`;
    badgeEarth.className = `telemetry-box ${telemetry.earthVisEngine ? 'status-ok' : 'status-blocked'}`;
    earthStatusText.textContent = `EARTH: ${telemetry.earthVisEngine ? 'OK' : 'BLOCKED'} (${ray(telemetry.earthVisRaycast)})`;

    // M4.2 Real-time Countdowns & Ridge Margins in HUD
    if (countdownText) {
      countdownText.textContent = `${telemetry.nextSunEvent || '—'} · ${telemetry.nextEarthEvent || '—'} (${telemetry.sunMarginDeg}° ridge)`;
    }

    // M4.3 Walk Distance Warning
    if (walkWarningBadge && walkWarningText) {
      if (telemetry.walkDistM > 50) {
        walkWarningBadge.style.display = 'flex';
        walkWarningText.textContent = `Mask line is for the lander position; you are ${telemetry.walkDistM} m away`;
      } else {
        walkWarningBadge.style.display = 'none';
      }
    }

    // Pass telemetry to 2D Map
    if (typeof map2d !== 'undefined' && map2d) {
      map2d.updateEphemeris(telemetry);
    }

    // Ray-cast agreement: only computed results, never a typed-in number (Rule 1).
    if (!telemetry.agreement || !telemetry.agreement.sun) {
      raycastAgreementText.textContent = telemetry.isRealData && !telemetry.isMoonTrekApi
        ? 'Ray-cast: computing…'
        : 'Ray-cast: — (candidate sites only)';
    } else {
      const fmt = (r) => (!r ? 'computing…' : r.error ? 'error'
        : `${r.pct.toFixed(1)}% of ${r.checked} h${r.outOfGrid ? ` (+${r.outOfGrid} h beyond grid)` : ''}`);
      const ag = telemetry.agreement;
      raycastAgreementText.textContent = `Sun ${fmt(ag.sun)} · Earth ${fmt(ag.earth)}`;
    }

    // Failure banner: text from missionLogic.failureMessage() on the engine flags.
    if (telemetry.failureEvent) {
      failureBanner.style.display = 'flex';
      failureBannerText.textContent = telemetry.failureEvent.message;
    } else {
      failureBanner.style.display = 'none';
    }

    // Data provenance label
    if (telemetry.isMoonTrekApi) {
      dataProvenanceText.textContent =
        `DATA: NASA MOON TREK REST API (LOLA DEM 20m) · ${telemetry.siteName}`;
    } else if (telemetry.isRealData) {
      dataProvenanceText.textContent =
        `DATA: NASA LOLA 5 m / 20 m terrain · JPL SPICE ephemeris (checked vs Horizons) · ${telemetry.siteName}`;
    } else {
      dataProvenanceText.textContent = `DATA: SYNTHETIC DEMO (data_out/ not found) · ${telemetry.siteId}`;
    }
  },
  (isLoading, message) => {
    if (loadingOverlay) {
      loadingOverlay.style.display = isLoading ? 'flex' : 'none';
      if (loadingStatusText && message) loadingStatusText.textContent = message;
    }
  }
);

// Set initial speed
sim.setSpeed(Number(speedSelector.value));

// Site list from data_out/sites.json (falls back to ids marked synthetic).
sim.dataLoader.loadSites().then(({ sites }) => {
  const current = siteSelector.value || 'site04';
  siteSelector.innerHTML = sites
    .map((s) => `<option value="${s.id}"${s.id === current ? ' selected' : ''}>${s.name}</option>`)
    .join('');
  sim.setHourIndex(sim.currentHourIndex);   // refresh names in labels/banner
  if (sim.dataset) sim.setDelayDays(sim.mission.delayDays);
});

// Site Switching
siteSelector.addEventListener('change', (e) => {
  sim.loadDataset(e.target.value);
});

// Play / Pause with SVG toggle
let isPlaying = false;
const playSvg = `
  <svg viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3"></polygon>
  </svg>
`;
const pauseSvg = `
  <svg viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="4" width="4" height="16"></rect>
    <rect x="14" y="4" width="4" height="16"></rect>
  </svg>
`;

btnPlayPause.addEventListener('click', () => {
  isPlaying = !isPlaying;
  sim.setPlaying(isPlaying);
  btnPlayPause.innerHTML = isPlaying ? pauseSvg : playSvg;
  btnPlayPause.classList.toggle('play-active', isPlaying);
});

// Step Controls
btnStepBack.addEventListener('click', () => {
  sim.setHourIndex(sim.currentHourIndex - 1);
});
btnStepFwd.addEventListener('click', () => {
  sim.setHourIndex(sim.currentHourIndex + 1);
});
btnStepStart.addEventListener('click', () => {
  sim.setHourIndex(sim.expeditionWindow ? sim.expeditionWindow.startIdx : 0);
});
btnStepEnd.addEventListener('click', () => {
  const totalMax = sim.dataset?.totalHours ? sim.dataset.totalHours - 1 : 8759;
  sim.setHourIndex(sim.expeditionWindow ? sim.expeditionWindow.endIdx : totalMax);
});

// Launch delay (days): moves the mission window; failure and battery are recomputed.
delayInput.addEventListener('change', (e) => {
  sim.setDelayDays(Number(e.target.value));
});

// Timeline Scrubbing Slider
timeSlider.addEventListener('input', (e) => {
  const val = Number(e.target.value);
  frameInput.value = val;
  sim.setHourIndex(val);
});

// Numerical Frame Input
frameInput.addEventListener('change', (e) => {
  const val = Math.max(Number(timeSlider.min), Math.min(Number(timeSlider.max), Number(e.target.value) || 0));
  timeSlider.value = val;
  sim.setHourIndex(val);
});

// Speed Multiplier
speedSelector.addEventListener('change', (e) => {
  sim.setSpeed(Number(e.target.value));
});

// View Modes (Mode A: Lander First-Person vs Mode B: Orbital Overview)
btnModeLander.addEventListener('click', () => {
  btnModeLander.classList.add('active');
  btnModeOverview.classList.remove('active');
  sim.setViewMode('lander');
});

btnModeOverview.addEventListener('click', () => {
  btnModeOverview.classList.add('active');
  btnModeLander.classList.remove('active');
  sim.setViewMode('overview');
});

// Horizon Mask Line Overlay Toggle
let maskVisible = true;
btnMaskToggle.addEventListener('click', () => {
  maskVisible = !maskVisible;
  sim.horizon.setVisible(maskVisible);
  btnMaskToggle.classList.toggle('active', maskVisible);
});

// Terrain Data Layers
function setLayerActive(type) {
  btnLayerNone.classList.toggle('active', type === 'none');
  btnLayerSlope.classList.toggle('active', type === 'slope');
  btnLayerRock.classList.toggle('active', type === 'rock');

  legendSlope.style.display = type === 'slope' ? 'flex' : 'none';
  legendRock.style.display = type === 'rock' ? 'flex' : 'none';

  sim.terrain.setOverlay(type);
}
btnLayerNone.addEventListener('click', () => setLayerActive('none'));
btnLayerSlope.addEventListener('click', () => setLayerActive('slope'));
btnLayerRock.addEventListener('click', () => setLayerActive('rock'));

// Body Scale
function setScaleActive(mult, btn) {
  [btnScale1x, btnScale3x, btnScale5x].forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  sim.celestials.setExaggeration(mult);

  if (scaleWarningBadge && scaleWarningText) {
    if (mult > 1.0) {
      scaleWarningBadge.style.display = 'flex';
      scaleWarningText.textContent = `Sun/Earth enlarged ×${mult} for visibility (true angular sizes 0.53° / 1.9°)`;
    } else {
      scaleWarningBadge.style.display = 'none';
    }
  }
}
btnScale1x.addEventListener('click', () => setScaleActive(1.0, btnScale1x));
btnScale3x.addEventListener('click', () => setScaleActive(3.0, btnScale3x));
btnScale5x.addEventListener('click', () => setScaleActive(5.0, btnScale5x));

// Camera Presets & Tracking Lock
btnLookSun.addEventListener('click', () => {
  sim.setTrackingTarget('sun');
});

btnLookEarth.addEventListener('click', () => {
  sim.setTrackingTarget('earth');
});

btnLookNorth.addEventListener('click', () => {
  sim.lookNorth();
});

// Jump to First Failure
btnJumpFailure.addEventListener('click', () => {
  sim.jumpToFirstFailure();
});

// -------------------------------------------------------------
// 2D South Pole Navigator & Viewport Mode Dropdown
// -------------------------------------------------------------
map2d = new SouthPoleMap2D(map2dContainer, (target) => {
  // Teleport from 2D map into 3D Simulation Viewport
  setViewportMode('3d');
  if (target.isCandidateSite && target.siteId) {
    siteSelector.value = target.siteId;
    sim.loadDataset(target.siteId);
  } else {
    // Add or select custom sector option
    let customOpt = siteSelector.querySelector('option[value="custom"]');
    if (!customOpt) {
      customOpt = document.createElement('option');
      customOpt.value = 'custom';
      siteSelector.appendChild(customOpt);
    }
    customOpt.textContent = target.name || `Sector ${target.sectorId}`;
    customOpt.selected = true;
    siteSelector.value = 'custom';

    sim.loadCustomChunk(target);
  }
});

function setViewportMode(mode) {
  const is3D = mode === '3d';
  container.style.display = is3D ? 'block' : 'none';
  if (is3D) {
    map2dContainer.classList.remove('active');
    map2dContainer.style.display = 'none';
    map2dContainer.style.pointerEvents = 'none';
    map2d.setVisible(false);
    if (document.activeElement) document.activeElement.blur();
    window.focus();
  } else {
    map2dContainer.classList.add('active');
    map2dContainer.style.display = 'block';
    map2dContainer.style.pointerEvents = 'auto';
    map2d.setVisible(true);
  }
  if (toolsDock) toolsDock.style.display = is3D ? 'flex' : 'none';
  if (viewportModeSelect) viewportModeSelect.value = mode;
}

if (viewportModeSelect) {
  viewportModeSelect.addEventListener('change', (e) => {
    setViewportMode(e.target.value);
  });
}

// -------------------------------------------------------------
// Blender-Style Expedition Feasibility Planner
// -------------------------------------------------------------
const btnExpeditionPlanner = document.getElementById('btn-expedition-planner');
const expeditionModal = document.getElementById('expedition-modal');
const btnCloseExpedition = document.getElementById('btn-close-expedition');
const expStartDateInput = document.getElementById('exp-start-date');
const expEndDateInput = document.getElementById('exp-end-date');
const btnRunExpedition = document.getElementById('btn-run-expedition-calc');
const btnApplyExpedition = document.getElementById('btn-apply-expedition-timeline');
const expStatusBadge = document.getElementById('exp-status-badge');
const expSiteName = document.getElementById('exp-site-name');
const expFailureReason = document.getElementById('exp-failure-reason');
const expMetricDuration = document.getElementById('exp-metric-duration');
const expMetricSun = document.getElementById('exp-metric-sun');
const expMetricEarth = document.getElementById('exp-metric-earth');
const expMetricNight = document.getElementById('exp-metric-night');
const expMetricGap = document.getElementById('exp-metric-gap');
const expMetricBattery = document.getElementById('exp-metric-battery');
const presetChips = document.querySelectorAll('.preset-chip');

let currentExpeditionResult = null;

if (btnExpeditionPlanner && expeditionModal) {
  btnExpeditionPlanner.addEventListener('click', () => {
    expeditionModal.style.display = 'flex';
    runExpeditionCalculation();
  });
}

if (btnCloseExpedition && expeditionModal) {
  btnCloseExpedition.addEventListener('click', () => {
    expeditionModal.style.display = 'none';
  });
}

if (expeditionModal) {
  expeditionModal.addEventListener('click', (e) => {
    if (e.target === expeditionModal) {
      expeditionModal.style.display = 'none';
    }
  });
}

// Preset duration chips
presetChips.forEach((chip) => {
  chip.addEventListener('click', () => {
    presetChips.forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    const days = parseInt(chip.getAttribute('data-days'), 10) || 14;
    const start = new Date((expStartDateInput.value || '2027-01-09') + 'T00:00:00Z');
    const end = new Date(start.getTime() + days * 86400000);
    expEndDateInput.value = end.toISOString().split('T')[0];
    runExpeditionCalculation();
  });
});

if (expStartDateInput) {
  expStartDateInput.addEventListener('change', () => runExpeditionCalculation());
}
if (expEndDateInput) {
  expEndDateInput.addEventListener('change', () => runExpeditionCalculation());
}

if (btnRunExpedition) {
  btnRunExpedition.addEventListener('click', () => runExpeditionCalculation());
}

function runExpeditionCalculation() {
  if (!expStartDateInput || !expEndDateInput) return;
  const startDate = expStartDateInput.value;
  const endDate = expEndDateInput.value;
  if (!startDate || !endDate) return;

  const siteId = sim.currentSiteId || 'site04';
  const siteName = sim.dataset?.siteName || siteId;
  const lat = sim.customCoordinates?.lat || -89.76;
  const lon = sim.customCoordinates?.lon || 180.0;

  if (expSiteName) expSiteName.textContent = siteName;

  const result = evaluateCustomExpedition({
    siteId,
    lat,
    lon,
    startDate,
    endDate,
    dataset: sim.dataset,
    horizon: sim.horizon,
  });

  currentExpeditionResult = result;

  // Update UI values
  if (expMetricDuration) expMetricDuration.textContent = `${result.durationDays} Days (${result.totalHours} h)`;
  if (expMetricSun) expMetricSun.textContent = `${result.sunPct}%`;
  if (expMetricEarth) expMetricEarth.textContent = `${result.earthPct}%`;
  if (expMetricNight) expMetricNight.textContent = `${result.maxNightHours} h (Limit 36 h)`;
  if (expMetricGap) expMetricGap.textContent = `${result.maxCommGapHours} h (Limit 24 h)`;
  if (expMetricBattery) expMetricBattery.textContent = `${result.minSocPct}% (${result.minBatteryWh} Wh)`;

  if (expStatusBadge) {
    if (result.passed) {
      expStatusBadge.className = 'exp-badge badge-pass';
      expStatusBadge.textContent = 'EXPEDITION: SUCCESSFUL';
      if (expFailureReason) expFailureReason.style.display = 'none';
    } else {
      expStatusBadge.className = 'exp-badge badge-fail';
      expStatusBadge.textContent = 'EXPEDITION: MISSION FAILURE';
      if (expFailureReason) {
        expFailureReason.textContent = `CRITICAL FAILURE DETECTED: ${result.failReason}`;
        expFailureReason.style.display = 'block';
      }
    }
  }
}

if (btnApplyExpedition) {
  btnApplyExpedition.addEventListener('click', () => {
    if (!currentExpeditionResult) return;
    sim.setExpeditionWindow(currentExpeditionResult.startHour, currentExpeditionResult.endHour);
    timeSlider.min = currentExpeditionResult.startHour;
    timeSlider.max = currentExpeditionResult.endHour;
    frameInput.min = currentExpeditionResult.startHour;
    frameInput.max = currentExpeditionResult.endHour;
    windowStartInput.value = currentExpeditionResult.startHour;
    windowEndInput.value = currentExpeditionResult.endHour;
    frameTicks.innerHTML = Array.from({ length: 5 }, (_, k) =>
      `<span>${Math.round(currentExpeditionResult.startHour + (k * currentExpeditionResult.totalHours) / 4)}</span>`).join('');
    if (expeditionModal) expeditionModal.style.display = 'none';
    sim.setHourIndex(currentExpeditionResult.startHour);
  });
}

