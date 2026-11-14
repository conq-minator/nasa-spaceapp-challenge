/**
 * Synthetic ephemeris & visibility dataset generator for Phase 1 simulation testing.
 * Produces 720 hours (30 Earth days) of mathematically coherent Sun and Earth angles,
 * plus site-specific coordinates and delay failure scenarios for all 5 candidate sites.
 */

export function generateFakeDataset(horizonOverlay, terrainMesh, siteId = 'site04') {
  const totalHours = 720;
  const startTime = new Date('2027-01-01T00:00:00Z').getTime();

  const timestamps = [];
  const sunAz = new Float32Array(totalHours);
  const sunEl = new Float32Array(totalHours);
  const earthAz = new Float32Array(totalHours);
  const earthEl = new Float32Array(totalHours);

  const sunLit = new Uint8Array(totalHours);
  const earthVis = new Uint8Array(totalHours);

  const synodicPeriodH = 708.73;

  // Synthetic generator settings per site id. These only shape the DEMO data used when
  // data_out/ is not available; they are not site facts (no names, no coordinates here).
  // The failure banner is NOT taken from here: LanderSimulation computes it from the generated
  // flags with missionLogic.js, exactly as for real data.
  const siteProfiles = {
    site04: { sunElBase: 1.2, sunElAmp: 2.6, earthAzCenter: 18.0, earthElCenter: 1.4,
              failHour: 124, failDuration: 41, failType: 'COMM_GAP' },
    site01: { sunElBase: 0.8, sunElAmp: 2.4, earthAzCenter: 24.0, earthElCenter: 1.1,
              failHour: 215, failDuration: 68, failType: 'NIGHT_EXCEEDED' },
    site07: { sunElBase: 2.2, sunElAmp: 3.2, earthAzCenter: 12.0, earthElCenter: 2.4,
              failHour: 340, failDuration: 38, failType: 'COMM_GAP' },
    site11: { sunElBase: 0.4, sunElAmp: 2.1, earthAzCenter: 28.0, earthElCenter: 0.8,
              failHour: 82, failDuration: 52, failType: 'COMM_GAP' },
    site23: { sunElBase: 1.0, sunElAmp: 2.5, earthAzCenter: 16.0, earthElCenter: 1.3,
              failHour: 178, failDuration: 48, failType: 'NIGHT_EXCEEDED' },
  };

  const profile = siteProfiles[siteId] || siteProfiles.site04;

  for (let h = 0; h < totalHours; h++) {
    const t = new Date(startTime + h * 3600 * 1000).toISOString();
    timestamps.push(t);

    const sunCycle = (h / synodicPeriodH) * 2 * Math.PI;
    let sAz = (h * (360.0 / synodicPeriodH)) % 360.0;
    let sEl = profile.sunElBase + profile.sunElAmp * Math.sin(sunCycle);

    const librationCycle = (h / 655.7) * 2 * Math.PI;
    let eAz = profile.earthAzCenter + 5.5 * Math.sin(librationCycle);
    let eEl = profile.earthElCenter + 1.6 * Math.cos(librationCycle * 1.05);

    // Injected failure window for this site
    if (h >= profile.failHour && h < profile.failHour + profile.failDuration) {
      if (profile.failType === 'COMM_GAP') {
        eEl = -0.5; // Dropped behind mountain ridge
      } else {
        sEl = -1.2; // Sun dropped behind rim
      }
    }

    sunAz[h] = sAz;
    sunEl[h] = sEl;
    earthAz[h] = eAz;
    earthEl[h] = eEl;

    const horizonAtSun = horizonOverlay.getHorizonElevation(sAz);
    const horizonAtEarth = horizonOverlay.getHorizonElevation(eAz);

    sunLit[h] = sEl > horizonAtSun ? 1 : 0;
    earthVis[h] = eEl > horizonAtEarth ? 1 : 0;
  }

  // Ray-cast agreement on the synthetic data (computed, labelled synthetic on screen).
  let sunAgree = 0, earthAgree = 0;
  for (let h = 0; h < totalHours; h++) {
    if (testRaycast(sunAz[h], sunEl[h], terrainMesh) === (sunLit[h] === 1)) sunAgree++;
    if (testRaycast(earthAz[h], earthEl[h], terrainMesh) === (earthVis[h] === 1)) earthAgree++;
  }

  return {
    totalHours,
    siteId,
    timestamps,
    sunAz,
    sunEl,
    earthAz,
    earthEl,
    sunLit,
    earthVis,
    syntheticAgreement: {
      sun: { pct: (100 * sunAgree) / totalHours, checked: totalHours, outOfGrid: 0 },
      earth: { pct: (100 * earthAgree) / totalHours, checked: totalHours, outOfGrid: 0 },
    },
  };
}

export function testRaycast(azDeg, elDeg, terrainMesh) {
  if (elDeg < -4.5) return false;

  const azRad = (azDeg * Math.PI) / 180;
  const elRad = (elDeg * Math.PI) / 180;
  const sinAz = Math.sin(azRad);
  const cosAz = Math.cos(azRad);
  const tanEl = Math.tan(elRad);
  const obsHeight = 2.0;

  if (terrainMesh.nearGrid) {
    const near = terrainMesh.nearGrid;
    for (let dist = 10; dist <= near.maxDist; dist += near.cellM) {
      const x = dist * sinAz;
      const y = dist * cosAz;
      const r = Math.floor((y + near.sizeM / 2) / near.cellM);
      const c = Math.floor((x + near.sizeM / 2) / near.cellM);
      if (r >= 0 && r < near.ny && c >= 0 && c < near.nx) {
        if (near.data[r * near.nx + c] > obsHeight + dist * tanEl) return false;
      }
    }
  }

  if (terrainMesh.farGrid) {
    const far = terrainMesh.farGrid;
    for (let dist = 2500; dist <= far.maxDist; dist += far.cellM * 2) {
      const x = dist * sinAz;
      const y = dist * cosAz;
      const r = Math.floor((y + far.sizeM / 2) / far.cellM);
      const c = Math.floor((x + far.sizeM / 2) / far.cellM);
      if (r >= 0 && r < far.ny && c >= 0 && c < far.nx) {
        if (far.data[r * far.nx + c] > obsHeight + dist * tanEl) return false;
      }
    }
  }

  return true;
}
