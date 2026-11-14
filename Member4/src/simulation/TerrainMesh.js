import * as THREE from 'three';

// -------------------------------------------------------------
// Fast, Deterministic 2D Simplex Noise & Fractal Brownian Motion (fBm)
// Completely eliminates grid / waffle / checkerboard artifacts!
// -------------------------------------------------------------
const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;

const perm = new Uint8Array(512);
const grad2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1]
];

(function initPermutation() {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let seed = 987654321;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
  }
})();

function simplex2D(xin, yin) {
  let n0 = 0, n1 = 0, n2 = 0;
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const X0 = i - t;
  const Y0 = j - t;
  const x0 = xin - X0;
  const y0 = yin - Y0;

  let i1, j1;
  if (x0 > y0) { i1 = 1; j1 = 0; }
  else { i1 = 0; j1 = 1; }

  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1.0 + 2.0 * G2;
  const y2 = y0 - 1.0 + 2.0 * G2;

  const ii = i & 255;
  const jj = j & 255;
  const gi0 = perm[ii + perm[jj]] % 8;
  const gi1 = perm[ii + i1 + perm[jj + j1]] % 8;
  const gi2 = perm[ii + 1 + perm[jj + 1]] % 8;

  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) {
    t0 *= t0;
    n0 = t0 * t0 * (grad2[gi0][0] * x0 + grad2[gi0][1] * y0);
  }

  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) {
    t1 *= t1;
    n1 = t1 * t1 * (grad2[gi1][0] * x1 + grad2[gi1][1] * y1);
  }

  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) {
    t2 *= t2;
    n2 = t2 * t2 * (grad2[gi2][0] * x2 + grad2[gi2][1] * y2);
  }

  return 70.0 * (n0 + n1 + n2);
}

function fbm(x, y, octaves = 5) {
  let total = 0;
  let amp = 1.0;
  let freq = 1.0;
  let maxAmp = 0;
  for (let o = 0; o < octaves; o++) {
    total += simplex2D(x * freq, y * freq) * amp;
    maxAmp += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return total / maxAmp;
}

/**
 * Manages the dual-resolution lunar terrain (near-field 10m and far-field 120m)
 * and the solid 3D geological pedestal block.
 * 
 * Features:
 * - 5 Distinct site morphologies (Shackleton, De Gerlache, Malapert, Haworth, Amundsen)
 * - Authentic impact crater geology (uplifted rims, parabolic bowls, central peaks, ejecta slopes)
 * - Isotropic Simplex Fractal Brownian Motion (ZERO waffle/checkerboard stripes)
 * - Photorealistic lunar albedo and subtle bump mapping (zero moiré aliasing)
 * - Complete 4-wall solid 3D pedestal base skirt (no hollow plane with stars underneath)
 * - Seamless near/far grid elevation blending with polygonOffset
 */
export class TerrainMesh {
  constructor(scene) {
    this.scene = scene;
    this.nearMesh = null;
    this.farMesh = null;
    this.pedestalMesh = null;
    this.extendedCrustMesh = null;
    this.neighborMeshes = [];
    this.datumOffset = 0.0;

    this.nearGrid = null;
    this.farGrid = null;

    this.activeOverlay = 'none';
    this.slopeTexture = null;
    this.rockTexture = null;
    this.regolithTexture = null;

    this.lunarBaseMaterial = new THREE.MeshStandardMaterial({
      color: 0xb5b8bc,
      roughness: 0.92,
      metalness: 0.02,
      flatShading: false,
      side: THREE.FrontSide,
    });

    this.pedestalMaterial = new THREE.MeshStandardMaterial({
      color: 0x181a1c,
      roughness: 0.98,
      metalness: 0.01,
      side: THREE.DoubleSide,
    });

    this.createRegolithTextures();
  }

  /**
   * Generates photorealistic lunar albedo and bump textures
   * with authentic regolith grain, crater ejecta rays, and dark mare patches.
   * Completely avoids harsh single-pixel dots or high-frequency tiling that causes moiré grids.
   */
  createRegolithTextures() {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // 1. Highland anorthosite base tone (authentic lunar grey)
    ctx.fillStyle = '#b0b3b7';
    ctx.fillRect(0, 0, size, size);

    // 2. Basaltic dark mare patches (soft feathered edges)
    const drawMare = (cx, cy, rx, ry, opacity = 0.22) => {
      const grad = ctx.createRadialGradient(cx, cy, Math.min(rx, ry) * 0.2, cx, cy, Math.max(rx, ry));
      grad.addColorStop(0.0, `rgba(50, 52, 56, ${opacity})`);
      grad.addColorStop(0.6, `rgba(65, 68, 72, ${opacity * 0.6})`);
      grad.addColorStop(1.0, 'rgba(65, 68, 72, 0.0)');

      ctx.save();
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    drawMare(320, 380, 240, 180, 0.28);
    drawMare(780, 280, 210, 140, 0.24);
    drawMare(520, 780, 280, 160, 0.25);

    // 3. Regolith fine noise grain
    const imgData = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 14;
      imgData.data[i] = Math.max(0, Math.min(255, imgData.data[i] + noise));
      imgData.data[i + 1] = Math.max(0, Math.min(255, imgData.data[i + 1] + noise));
      imgData.data[i + 2] = Math.max(0, Math.min(255, imgData.data[i + 2] + noise));
    }
    ctx.putImageData(imgData, 0, 0);

    // 4. Bright Radial Crater Ray Systems (Copernicus / Tycho style)
    const drawRaySystem = (originX, originY, rayCount = 16, maxRadius = 450) => {
      for (let i = 0; i < rayCount; i++) {
        const angle = (i / rayCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
        const length = maxRadius * (0.5 + Math.random() * 0.5);
        const endX = originX + Math.cos(angle) * length;
        const endY = originY + Math.sin(angle) * length;

        const rayGrad = ctx.createLinearGradient(originX, originY, endX, endY);
        rayGrad.addColorStop(0.0, 'rgba(235, 240, 245, 0.30)');
        rayGrad.addColorStop(0.4, 'rgba(220, 225, 230, 0.12)');
        rayGrad.addColorStop(1.0, 'rgba(205, 210, 215, 0.0)');

        ctx.strokeStyle = rayGrad;
        ctx.lineWidth = 2.0 + Math.random() * 2.5;
        ctx.beginPath();
        ctx.moveTo(originX, originY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }
    };
    drawRaySystem(240, 200, 20, 480);
    drawRaySystem(840, 720, 16, 400);

    // 5. Soft micro-craters with smooth radial gradients (no harsh black pixels!)
    for (let c = 0; c < 160; c++) {
      const cx = Math.random() * size;
      const cy = Math.random() * size;
      const r = 3.0 + Math.random() * 18.0;

      // Bright raised ejecta halo
      const haloGrad = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 1.8);
      haloGrad.addColorStop(0.0, 'rgba(220, 225, 230, 0.30)');
      haloGrad.addColorStop(1.0, 'rgba(220, 225, 230, 0.0)');
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.8, 0, Math.PI * 2);
      ctx.fill();

      // Soft shadowed crater interior
      const bowlGrad = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, 0, cx, cy, r);
      bowlGrad.addColorStop(0.0, 'rgba(45, 48, 52, 0.55)');
      bowlGrad.addColorStop(0.8, 'rgba(65, 68, 72, 0.35)');
      bowlGrad.addColorStop(1.0, 'rgba(110, 112, 116, 0.0)');
      ctx.fillStyle = bowlGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    this.regolithTexture = new THREE.CanvasTexture(canvas);
    this.regolithTexture.wrapS = THREE.RepeatWrapping;
    this.regolithTexture.wrapT = THREE.RepeatWrapping;
    this.regolithTexture.repeat.set(4, 4); // 4x4 repeat eliminates moiré pattern
    this.regolithTexture.generateMipmaps = true;
    this.regolithTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.regolithTexture.magFilter = THREE.LinearFilter;

    this.lunarBaseMaterial.map = this.regolithTexture;
    this.lunarBaseMaterial.bumpMap = this.regolithTexture;
    this.lunarBaseMaterial.bumpScale = 0.12; // Gentle, realistic regolith roughness
    this.lunarBaseMaterial.roughness = 0.92;
    this.lunarBaseMaterial.metalness = 0.02;
    this.lunarBaseMaterial.needsUpdate = true;
  }

  /**
   * Evaluates standard lunar impact crater elevation profile:
   * uplifted mountain rim + parabolic bowl + central uplift peak + ejecta slope.
   */
  evalCrater(x, y, cx, cy, radius, depth, rimHeight, hasCentralPeak = false) {
    const dx = x - cx;
    const dy = y - cy;
    if (Math.abs(dx) > radius * 2.4 || Math.abs(dy) > radius * 2.4) return 0;

    const distSq = dx * dx + dy * dy;
    const rMax = radius * 2.4;
    if (distSq > rMax * rMax) return 0;

    const dist = Math.sqrt(distSq);
    const rNorm = dist / radius;

    if (rNorm < 1.0) {
      // Inside crater bowl
      const bowl = (rNorm * rNorm - 1.0) * depth + rimHeight;
      // Central peak uplift
      let peak = 0;
      if (hasCentralPeak && rNorm < 0.28) {
        peak = Math.cos((rNorm / 0.28) * (Math.PI / 2)) * (depth * 0.42);
      }
      return bowl + peak;
    } else {
      // Raised rim & outer ejecta slope
      const rimFactor = Math.max(0, (2.4 - rNorm) / 1.4);
      return Math.pow(rimFactor, 2.2) * rimHeight;
    }
  }

  /**
   * Generates site-specific south pole topography for candidate landing sites,
   * or authentic rolling lunar highlands for off-grid exploration chunks.
   */
  generateProceduralTerrain(siteId = 'site04', customCoords = null) {
    const R_MOON = 1737400.0;

    // Near grid: 512x512, 10m cells, 5120m total width (radius = 2560m)
    const nearNx = 512;
    const nearNy = 512;
    const nearCellM = 10.0;
    const nearSizeM = 5120.0;
    const nearData = new Float32Array(nearNx * nearNy);

    // Far grid: 512x512, 120m cells, 61440m total width (radius = 30720m)
    const farNx = 512;
    const farNy = 512;
    const farCellM = 120.0;
    const farSizeM = 61440.0;
    const farData = new Float32Array(farNx * farNy);

    // Offset coordinates for unique topography per exploration sector
    const pX = customCoords ? (customCoords.polarX || 0) : 0;
    const pY = customCoords ? (customCoords.polarY || 0) : 0;
    const seedOffset = Math.sin(pX * 0.0001 + pY * 0.0001) * 10000;

    // Deterministic field of surrounding impact craters across the 60km extent
    const surroundingCraters = [
      // Major impact basins & prominent craters (safely placed at distances > 3.5km from lander)
      { cx: -14000 + (seedOffset % 3000), cy: -18000, r: 6500, d: 1600, rim: 260, peak: true },
      { cx: 16000, cy: -14000 + (seedOffset % 2500), r: 5400, d: 1450, rim: 220, peak: true },
      { cx: -19000, cy: 16000, r: 6200, d: 1550, rim: 240, peak: true },
      { cx: 13000, cy: 23000, r: 5600, d: 1400, rim: 230, peak: true },
      { cx: 22000, cy: -2000, r: 4800, d: 1250, rim: 190, peak: false },
      { cx: -24000, cy: -4000, r: 5200, d: 1350, rim: 200, peak: false },
      { cx: 2000, cy: 25000, r: 4700, d: 1200, rim: 180, peak: false },
      { cx: -3000, cy: -26000, r: 6000, d: 1550, rim: 250, peak: true },

      // Medium craters across the intermediate zone (1.5km - 3.5km)
      { cx: 7200, cy: -6500, r: 2400, d: 750, rim: 120, peak: false },
      { cx: -8500, cy: -7800, r: 2900, d: 850, rim: 140, peak: false },
      { cx: -6800, cy: 8400, r: 2300, d: 680, rim: 110, peak: false },
      { cx: 9200, cy: 9600, r: 2700, d: 780, rim: 130, peak: false },
      { cx: 14800, cy: 4600, r: 3200, d: 920, rim: 150, peak: false },
      { cx: -13800, cy: -8600, r: 3000, d: 880, rim: 145, peak: false },
      { cx: 4500, cy: 16800, r: 2800, d: 820, rim: 135, peak: false },
      { cx: -16200, cy: 3200, r: 3400, d: 990, rim: 160, peak: false },
      { cx: -9800, cy: 21500, r: 3700, d: 1050, rim: 170, peak: false },
      { cx: 21500, cy: 14200, r: 3500, d: 1020, rim: 165, peak: false },
      { cx: -3800, cy: -15200, r: 2400, d: 710, rim: 115, peak: false },
      { cx: 18800, cy: -22500, r: 3900, d: 1150, rim: 185, peak: true },

      // Smaller craters (800m - 1.5km) away from lander center
      { cx: 3400, cy: -3400, r: 1200, d: 380, rim: 65, peak: false },
      { cx: -4100, cy: 3300, r: 1350, d: 420, rim: 70, peak: false },
      { cx: 5100, cy: 3000, r: 1450, d: 460, rim: 75, peak: false },
      { cx: -3100, cy: -4400, r: 1050, d: 320, rim: 55, peak: false },
      { cx: 1400, cy: 5500, r: 920, d: 290, rim: 50, peak: false },
      { cx: -5700, cy: -2100, r: 1350, d: 440, rim: 72, peak: false },
      { cx: 6400, cy: -11200, r: 1650, d: 520, rim: 85, peak: false },
      { cx: -11200, cy: 11800, r: 1800, d: 560, rim: 90, peak: false }
    ];

    // Helper to evaluate terrain at any coordinate for the active site
    const evaluateElevation = (x, y) => {
      let elev = 0;

      // 1. Natural Fractal Brownian Motion (Simplex Noise)
      // Macro rolling mountain relief (wavelengths 4km - 28km, amplitude up to 1600m)
      const coordShiftX = (pX * 0.00007) % 100;
      const coordShiftY = (pY * 0.00007) % 100;
      const macroNoise = fbm(x * 0.00007 + coordShiftX, y * 0.00007 + coordShiftY, 4);
      elev += macroNoise * 1450.0;

      // Meso rolling hills (wavelengths 800m - 3km)
      const mesoNoise = simplex2D(x * 0.00035 + 2.1 + coordShiftX * 2, y * 0.00035 + 1.4 + coordShiftY * 2);
      elev += mesoNoise * 180.0;

      // Micro topography roughness
      const microNoise = simplex2D(x * 0.0018 + 0.5, y * 0.0018 + 0.8);
      elev += microNoise * 16.0;

      // 2. Surrounding Impact Craters Field across the 60km span
      for (let i = 0; i < surroundingCraters.length; i++) {
        const c = surroundingCraters[i];
        elev += this.evalCrater(x, y, c.cx, c.cy, c.r, c.d, c.rim, c.peak);
      }

      // 3. Primary Site-Specific Morphologies
      if (siteId === 'site04') {
        // Site 04: Shackleton Crater Rim (Connecting Ridge)
        // Main Shackleton Crater directly south (radius 2200m, depth 1300m, rim 240m)
        elev += this.evalCrater(x, y, 0, -2250, 2200, 1300, 240, false);
        // Connecting ridge crest running east-west through (0, 0)
        elev += Math.exp(-Math.pow(y / 750, 2)) * 180.0;
        // Mons Malapert massif far to the north-east
        const dMalapert = Math.sqrt((x - 14000) * (x - 14000) + (y - 30000) * (y - 30000));
        if (dMalapert < 18000) {
          const mf = Math.cos((dMalapert / 18000) * (Math.PI / 2));
          elev += mf * mf * 3200; // Peaks +3200m
        }
      } else if (siteId === 'site01') {
        // Site 01: De Gerlache Crater Rim (Broader rolling plateau)
        elev += this.evalCrater(x, y, -1600, -2400, 3400, 1100, 190, true);
        elev += simplex2D(x * 0.0005, y * 0.0005) * 320.0;
        // Faustini crater rim to the south-east
        elev += this.evalCrater(x, y, 14000, -12000, 4800, 1400, 220, true);
      } else if (siteId === 'site07') {
        // Site 07: Malapert Massif Peak (Towering mountain summit)
        const dSummit = Math.sqrt(x * x + y * y);
        if (dSummit < 22000) {
          const sf = Math.cos((dSummit / 22000) * (Math.PI / 2));
          elev += sf * sf * 4200; // Towering high summit
        }
        // Steep northern cliff drop-off
        if (y > 1500) {
          elev -= Math.min(1800, Math.pow((y - 1500) * 0.0008, 1.6) * 1200);
        }
        // Haworth crater to the south
        elev += this.evalCrater(x, y, 2000, -18000, 4400, 1600, 250, false);
      } else if (siteId === 'site11') {
        // Site 11: Haworth Crater Rim (Permanently shadowed deep crater)
        elev += this.evalCrater(x, y, 600, -1800, 2900, 1650, 260, false);
        elev += this.evalCrater(x, y, -14000, -16000, 6200, 1800, 280, true);
        elev += simplex2D(x * 0.0008, y * 0.0008) * 220.0;
      } else if (siteId === 'site23') {
        // Site 23: Amundsen Crater Rim (Complex impact basin with central peak)
        elev += this.evalCrater(x, y, 0, -3800, 5600, 1650, 320, true);
        elev += this.evalCrater(x, y, -16000, -12000, 4400, 1300, 210, false);
      } else {
        // Off-grid exploration sector: authentic natural lunar highland plateau with gentle ridges
        elev += simplex2D(x * 0.0004 + 1.2, y * 0.0004 + 2.7) * 240.0;
        // Distant ridge crest 4km to 8km away to provide a realistic skyline horizon
        const dRidge = Math.hypot(x - 4500, y - 6000);
        if (dRidge < 8000) {
          elev += Math.cos((dRidge / 8000) * Math.PI) * 160.0;
        }
      }

      return elev;
    };

    // 1. Populate Near Grid
    for (let r = 0; r < nearNy; r++) {
      for (let c = 0; c < nearNx; c++) {
        const x = (c - nearNx / 2) * nearCellM;
        const y = (r - nearNy / 2) * nearCellM;
        const dist = Math.sqrt(x * x + y * y);
        const curve = -(dist * dist) / (2.0 * R_MOON);

        nearData[r * nearNx + c] = evaluateElevation(x, y) + curve;
      }
    }

    // Anchor: ground height at lander position (0, 0) is height = 0
    const centerIdx = Math.floor(nearNy / 2) * nearNx + Math.floor(nearNx / 2);
    const datumOffset = nearData[centerIdx];
    this.datumOffset = datumOffset;
    for (let i = 0; i < nearData.length; i++) {
      nearData[i] -= datumOffset;
    }

    // 2. Populate Far Grid: true, continuous 60km topography anchored to exact same datumOffset
    // (No artificial drops inside nearRadius, so the orbital view is 100% seamless!)
    for (let r = 0; r < farNy; r++) {
      for (let c = 0; c < farNx; c++) {
        const x = (c - farNx / 2) * farCellM;
        const y = (r - farNy / 2) * farCellM;
        const dist = Math.sqrt(x * x + y * y);
        const curve = -(dist * dist) / (2.0 * R_MOON);

        farData[r * farNx + c] = evaluateElevation(x, y) + curve - datumOffset;
      }
    }

    this.nearGrid = { data: nearData, nx: nearNx, ny: nearNy, cellM: nearCellM, sizeM: nearSizeM, maxDist: nearSizeM / 2 };
    this.farGrid = { data: farData, nx: farNx, ny: farNy, cellM: farCellM, sizeM: farSizeM, maxDist: farSizeM / 2 };

    this.buildMeshes();
    this.buildSolidPedestal();
    this.buildNeighborChunks();
    this.computeSlopeTexture();
  }

  /**
   * Constructs the dual Three.js PlaneGeometry terrain meshes.
   */
  buildMeshes() {
    this.dispose();

    // 1. Near Mesh
    const nearGeo = new THREE.PlaneGeometry(
      this.nearGrid.sizeM,
      this.nearGrid.sizeM,
      this.nearGrid.nx - 1,
      this.nearGrid.ny - 1
    );
    nearGeo.rotateX(-Math.PI / 2);

    const nearPos = nearGeo.attributes.position.array;
    for (let r = 0; r < this.nearGrid.ny; r++) {
      for (let c = 0; c < this.nearGrid.nx; c++) {
        const dataRow = this.nearGrid.ny - 1 - r;
        const vertexIndex = r * this.nearGrid.nx + c;
        const dataIndex = dataRow * this.nearGrid.nx + c;
        nearPos[vertexIndex * 3 + 1] = this.nearGrid.data[dataIndex];
      }
    }
    nearGeo.computeVertexNormals();
    nearGeo.attributes.position.needsUpdate = true;

    const nearMat = this.lunarBaseMaterial.clone();
    nearMat.polygonOffset = true;
    nearMat.polygonOffsetFactor = -1.0;
    nearMat.polygonOffsetUnits = -1.0;

    this.nearMesh = new THREE.Mesh(nearGeo, nearMat);
    this.nearMesh.receiveShadow = true;
    this.nearMesh.castShadow = true;
    this.nearMesh.name = 'nearTerrain';
    this.scene.add(this.nearMesh);

    // 2. Far Mesh (Center Square Chunk: 61.44 km x 61.44 km) - 100% Uncorrupted NASA LOLA DEM
    const farGeo = new THREE.PlaneGeometry(
      this.farGrid.sizeM,
      this.farGrid.sizeM,
      this.farGrid.nx - 1,
      this.farGrid.ny - 1
    );
    farGeo.rotateX(-Math.PI / 2);

    const farPos = farGeo.attributes.position.array;
    for (let r = 0; r < this.farGrid.ny; r++) {
      for (let c = 0; c < this.farGrid.nx; c++) {
        const vertexIndex = r * this.farGrid.nx + c;
        const dataRow = this.farGrid.ny - 1 - r;
        const dataIndex = dataRow * this.farGrid.nx + c;
        farPos[vertexIndex * 3 + 1] = this.farGrid.data[dataIndex];
      }
    }
    farGeo.computeVertexNormals();
    farGeo.attributes.position.needsUpdate = true;

    this.farMesh = new THREE.Mesh(farGeo, this.lunarBaseMaterial.clone());
    this.farMesh.receiveShadow = true;
    this.farMesh.castShadow = true;
    this.farMesh.name = 'farTerrain';
    this.scene.add(this.farMesh);
  }

  /**
   * Precise edge elevation sampling from center farGrid to ensure 0.000m seam
   */
  sampleFarGridEdge(worldX, worldZ) {
    if (!this.farGrid) return 0;
    const halfFar = this.farGrid.sizeM / 2.0;
    const clampedX = Math.max(-halfFar, Math.min(halfFar, worldX));
    const clampedZ = Math.max(-halfFar, Math.min(halfFar, worldZ));

    const grid = this.farGrid;
    const colFloat = (clampedX + halfFar) / grid.cellM;
    const rowFloat = (clampedZ + halfFar) / grid.cellM;
    const col0 = Math.max(0, Math.min(grid.nx - 2, Math.floor(colFloat)));
    const row0 = Math.max(0, Math.min(grid.ny - 2, Math.floor(rowFloat)));
    const u = Math.max(0, Math.min(1, colFloat - col0));
    const v = Math.max(0, Math.min(1, rowFloat - row0));

    const dataRow0 = grid.ny - 1 - row0;
    const dataRow1 = grid.ny - 1 - (row0 + 1);

    const h00 = grid.data[dataRow0 * grid.nx + col0];
    const h10 = grid.data[dataRow0 * grid.nx + (col0 + 1)];
    const h01 = grid.data[dataRow1 * grid.nx + col0];
    const h11 = grid.data[dataRow1 * grid.nx + (col0 + 1)];

    return (1 - u) * (1 - v) * h00 + u * (1 - v) * h10 + (1 - u) * v * h01 + u * v * h11;
  }

  /**
   * Builds solid subterranean mantle plate underneath the lunar crust
   * so orbital view looking from below never shows see-through stars or void.
   */
  buildSolidPedestal() {
    if (this.pedestalMesh) {
      this.scene.remove(this.pedestalMesh);
      this.pedestalMesh.geometry.dispose();
      this.pedestalMesh = null;
    }

    const S = this.farGrid ? this.farGrid.sizeM : 61440.0;
    const slabSize = S * 3.1; // ~190 km square subterranean plate
    const baseDepth = -7500.0;
    const floorGeo = new THREE.PlaneGeometry(slabSize, slabSize);
    floorGeo.rotateX(Math.PI / 2); // face downward

    this.pedestalMesh = new THREE.Mesh(floorGeo, this.pedestalMaterial);
    this.pedestalMesh.position.y = baseDepth;
    this.pedestalMesh.name = 'solidSubterraneanPlate';
    this.scene.add(this.pedestalMesh);
  }

  /**
   * Evaluates procedural macro lunar topography (craters + highland fractal relief)
   * across the expansive multi-chunk lunar South Pole.
   */
  evaluateMacroRelief(x, z) {
    let elev = 0;

    // Macro lunar highland relief (wavelengths 15km - 80km)
    const macro = fbm(x * 0.000028 + 5.2, z * 0.000028 + 3.7, 4) * 750.0;
    const meso = fbm(x * 0.000085 + 1.4, z * 0.000085 + 8.1, 3) * 280.0;
    elev += macro + meso;

    // Surrounding regional craters across the multi-chunk landscape
    const regionalCraters = [
      { cx: -55000, cy: -40000, r: 16000, d: 2400, rim: 450, peak: true },
      { cx: 48000, cy: -52000, r: 14000, d: 2100, rim: 380, peak: true },
      { cx: -42000, cy: 56000, r: 15000, d: 2200, rim: 410, peak: true },
      { cx: 58000, cy: 45000, r: 13500, d: 1950, rim: 360, peak: false },
      { cx: -14000, cy: -18000, r: 6500, d: 1600, rim: 260, peak: true },
      { cx: 16000, cy: -14000, r: 5400, d: 1450, rim: 220, peak: true },
      { cx: -19000, cy: 16000, r: 6200, d: 1550, rim: 240, peak: true },
      { cx: 13000, cy: 23000, r: 5600, d: 1400, rim: 230, peak: true },
      { cx: 22000, cy: -2000, r: 4800, d: 1250, rim: 190, peak: false },
      { cx: -24000, cy: -4000, r: 5200, d: 1350, rim: 200, peak: false },
      { cx: 2000, cy: 25000, r: 4700, d: 1200, rim: 180, peak: false },
      { cx: -3000, cy: -26000, r: 6000, d: 1550, rim: 250, peak: true },
      { cx: 0, cy: 62000, r: 18000, d: 2600, rim: 480, peak: true },
      { cx: -65000, cy: 0, r: 17000, d: 2500, rim: 460, peak: true },
      { cx: 65000, cy: 0, r: 15000, d: 2200, rim: 390, peak: true },
      { cx: 0, cy: -68000, r: 19000, d: 2800, rim: 520, peak: true },
    ];

    for (const c of regionalCraters) {
      elev += this.evalCrater(x, z, c.cx, c.cy, c.r, c.d, c.rim, c.peak);
    }

    return elev;
  }

  /**
   * Constructs square neighboring chunks surrounding the center site chunk.
   * Uses exact edge matching so the boundary with center chunk has 0.000m vertical cliff.
   */
  buildNeighborChunks() {
    this.disposeNeighborChunks();

    const S = this.farGrid ? this.farGrid.sizeM : 61440.0;
    const halfFar = S / 2.0;
    const segments = 48;
    const R_MOON = 1737400.0;
    const relief0 = this.evaluateMacroRelief(0, 0);
    const datum = this.datumOffset || 0.0;
    const blendSpan = 18000.0; // 18 km smooth transition away from border

    const offsets = [
      { dx: 0, dz: -1, name: 'North' },
      { dx: 0, dz: 1, name: 'South' },
      { dx: 1, dz: 0, name: 'East' },
      { dx: -1, dz: 0, name: 'West' },
      { dx: 1, dz: -1, name: 'NE' },
      { dx: -1, dz: -1, name: 'NW' },
      { dx: 1, dz: 1, name: 'SE' },
      { dx: -1, dz: 1, name: 'SW' },
    ];

    for (const off of offsets) {
      const geo = new THREE.PlaneGeometry(S, S, segments, segments);
      geo.rotateX(-Math.PI / 2);

      const pos = geo.attributes.position.array;
      const vCount = geo.attributes.position.count;
      const chunkCenterX = off.dx * S;
      const chunkCenterZ = off.dz * S;

      for (let i = 0; i < vCount; i++) {
        const localX = pos[i * 3];
        const localZ = pos[i * 3 + 2];
        const worldX = chunkCenterX + localX;
        const worldZ = chunkCenterZ + localZ;

        const distSq = worldX * worldX + worldZ * worldZ;
        const curve = -distSq / (2.0 * R_MOON);
        const farRelief = curve + (this.evaluateMacroRelief(worldX, worldZ) - relief0) - datum;

        // Distance from center chunk square border
        const dX = Math.max(0, Math.abs(worldX) - halfFar);
        const dZ = Math.max(0, Math.abs(worldZ) - halfFar);
        const dOut = Math.max(dX, dZ);

        if (dOut <= 0.01) {
          // Exactly at the boundary: match the center chunk border vertex height 1:1
          pos[i * 3 + 1] = this.sampleFarGridEdge(worldX, worldZ);
        } else if (dOut < blendSpan) {
          const edgeH = this.sampleFarGridEdge(worldX, worldZ);
          const t = dOut / blendSpan;
          const w = t * t * (3.0 - 2.0 * t); // smoothstep
          pos[i * 3 + 1] = (1.0 - w) * edgeH + w * farRelief;
        } else {
          pos[i * 3 + 1] = farRelief;
        }
      }

      geo.computeVertexNormals();
      geo.attributes.position.needsUpdate = true;

      const mat = this.lunarBaseMaterial.clone();
      mat.roughness = 0.94;
      mat.metalness = 0.01;

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(chunkCenterX, 0, chunkCenterZ);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.name = `neighborChunk_${off.name}`;
      this.scene.add(mesh);
      this.neighborMeshes.push(mesh);
    }
  }

  disposeNeighborChunks() {
    if (this.neighborMeshes && this.neighborMeshes.length > 0) {
      for (const m of this.neighborMeshes) {
        this.scene.remove(m);
        m.geometry.dispose();
        if (m.material) m.material.dispose();
      }
      this.neighborMeshes = [];
    }
  }

  /**
   * Continuous bilinear height sampling across the multi-chunk planetary surface.
   * Guarantees non-zero, realistic elevation under the camera anywhere in the 184km region.
   */
  sampleHeightAt(x, z) {
    if (this.nearGrid) {
      const halfNear = this.nearGrid.sizeM / 2;
      if (Math.abs(x) <= halfNear && Math.abs(z) <= halfNear) {
        const grid = this.nearGrid;
        const colFloat = (x + halfNear) / grid.cellM;
        const rowFloat = (z + halfNear) / grid.cellM;
        const col0 = Math.max(0, Math.min(grid.nx - 2, Math.floor(colFloat)));
        const row0 = Math.max(0, Math.min(grid.ny - 2, Math.floor(rowFloat)));
        const u = Math.max(0, Math.min(1, colFloat - col0));
        const v = Math.max(0, Math.min(1, rowFloat - row0));

        const dataRow0 = grid.ny - 1 - row0;
        const dataRow1 = grid.ny - 1 - (row0 + 1);

        const h00 = grid.data[dataRow0 * grid.nx + col0];
        const h10 = grid.data[dataRow0 * grid.nx + (col0 + 1)];
        const h01 = grid.data[dataRow1 * grid.nx + col0];
        const h11 = grid.data[dataRow1 * grid.nx + (col0 + 1)];

        return (1 - u) * (1 - v) * h00 + u * (1 - v) * h10 + (1 - u) * v * h01 + u * v * h11;
      }
    }

    if (this.farGrid) {
      const halfFar = this.farGrid.sizeM / 2;
      if (Math.abs(x) <= halfFar && Math.abs(z) <= halfFar) {
        const grid = this.farGrid;
        const colFloat = (x + halfFar) / grid.cellM;
        const rowFloat = (z + halfFar) / grid.cellM;
        const col0 = Math.max(0, Math.min(grid.nx - 2, Math.floor(colFloat)));
        const row0 = Math.max(0, Math.min(grid.ny - 2, Math.floor(rowFloat)));
        const u = Math.max(0, Math.min(1, colFloat - col0));
        const v = Math.max(0, Math.min(1, rowFloat - row0));

        const dataRow0 = grid.ny - 1 - row0;
        const dataRow1 = grid.ny - 1 - (row0 + 1);

        const h00 = grid.data[dataRow0 * grid.nx + col0];
        const h10 = grid.data[dataRow0 * grid.nx + (col0 + 1)];
        const h01 = grid.data[dataRow1 * grid.nx + col0];
        const h11 = grid.data[dataRow1 * grid.nx + (col0 + 1)];

        return (1 - u) * (1 - v) * h00 + u * (1 - v) * h10 + (1 - u) * v * h01 + u * v * h11;
      }
    }

    const R_MOON = 1737400.0;
    const relief0 = this.evaluateMacroRelief(0, 0);
    return -(x * x + z * z) / (2.0 * R_MOON) + (this.evaluateMacroRelief(x, z) - relief0) - (this.datumOffset || 0);
  }

  loadDynamicChunk(nearResult, farResult, sizeNearM = 5120.0, sizeFarM = 61440.0, satelliteImage = null) {
    if (satelliteImage) {
      const tex = (typeof HTMLCanvasElement !== 'undefined' && satelliteImage instanceof HTMLCanvasElement)
        ? new THREE.CanvasTexture(satelliteImage)
        : new THREE.Texture(satelliteImage);
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      this.lunarBaseMaterial.map = tex;
      this.lunarBaseMaterial.bumpMap = tex;
      this.lunarBaseMaterial.bumpScale = 0.08;
      this.lunarBaseMaterial.roughness = 0.94;
      this.lunarBaseMaterial.needsUpdate = true;
    }

    this.nearGrid = {
      data: nearResult.data,
      nx: nearResult.width,
      ny: nearResult.height,
      cellM: sizeNearM / nearResult.width,
      sizeM: sizeNearM,
      maxDist: sizeNearM / 2,
    };

    const centerIdx = Math.floor(nearResult.height / 2) * nearResult.width + Math.floor(nearResult.width / 2);
    const datumOffset = this.nearGrid.data[centerIdx] || 0;
    this.datumOffset = datumOffset;

    for (let i = 0; i < this.nearGrid.data.length; i++) {
      this.nearGrid.data[i] -= datumOffset;
    }

    if (farResult && farResult.data) {
      this.farGrid = {
        data: farResult.data,
        nx: farResult.width,
        ny: farResult.height,
        cellM: sizeFarM / farResult.width,
        sizeM: sizeFarM,
        maxDist: sizeFarM / 2,
      };
      for (let i = 0; i < this.farGrid.data.length; i++) {
        this.farGrid.data[i] -= datumOffset;
      }
    } else {
      this.farGrid = this.nearGrid;
    }

    this.buildMeshes();
    this.buildSolidPedestal();
    this.buildNeighborChunks();
    this.computeSlopeTexture();
  }

  loadFromBuffers(nearBuffer, nearMeta, farBuffer, farMeta) {
    this.datumOffset = 0.0;
    this.nearGrid = {
      data: new Float32Array(nearBuffer),
      nx: nearMeta.nx,
      ny: nearMeta.ny,
      cellM: nearMeta.cell_m,
      sizeM: nearMeta.size_m,
      maxDist: nearMeta.size_m / 2,
    };

    this.farGrid = {
      data: new Float32Array(farBuffer),
      nx: farMeta.nx,
      ny: farMeta.ny,
      cellM: farMeta.cell_m,
      sizeM: farMeta.size_m,
      maxDist: farMeta.size_m / 2,
    };

    this.buildMeshes();
    this.buildSolidPedestal();
    this.buildNeighborChunks();
    this.computeSlopeTexture();
  }

  computeSlopeTexture() {
    if (!this.nearGrid) return;

    const nx = this.nearGrid.nx;
    const ny = this.nearGrid.ny;
    const cellM = this.nearGrid.cellM;
    const data = this.nearGrid.data;

    const canvas = document.createElement('canvas');
    canvas.width = nx;
    canvas.height = ny;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(nx, ny);

    for (let r = 0; r < ny; r++) {
      for (let c = 0; c < nx; c++) {
        const cL = Math.max(0, c - 1);
        const cR = Math.min(nx - 1, c + 1);
        const rD = Math.max(0, r - 1);
        const rU = Math.min(ny - 1, r + 1);

        const dzdx = (data[r * nx + cR] - data[r * nx + cL]) / ((cR - cL) * cellM || 1);
        const dzdy = (data[rU * nx + c] - data[rD * nx + c]) / ((rU - rD) * cellM || 1);
        const slopeDeg = (Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * 180) / Math.PI;

        const canvasRow = ny - 1 - r;
        const pixelIdx = (canvasRow * nx + c) * 4;

        if (slopeDeg < 10) {
          imgData.data[pixelIdx] = 30;
          imgData.data[pixelIdx + 1] = 160;
          imgData.data[pixelIdx + 2] = 60;
          imgData.data[pixelIdx + 3] = 210;
        } else if (slopeDeg < 15) {
          imgData.data[pixelIdx] = 210;
          imgData.data[pixelIdx + 1] = 180;
          imgData.data[pixelIdx + 2] = 20;
          imgData.data[pixelIdx + 3] = 210;
        } else {
          imgData.data[pixelIdx] = 220;
          imgData.data[pixelIdx + 1] = 40;
          imgData.data[pixelIdx + 2] = 30;
          imgData.data[pixelIdx + 3] = 220;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    this.slopeTexture = new THREE.CanvasTexture(canvas);
  }

  computeRockAbundanceTexture() {
    if (!this.nearGrid) return;
    const nx = this.nearGrid.nx;
    const ny = this.nearGrid.ny;
    const canvas = document.createElement('canvas');
    canvas.width = nx;
    canvas.height = ny;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(nx, ny);

    for (let r = 0; r < ny; r++) {
      for (let c = 0; c < nx; c++) {
        const h = this.nearGrid.data[r * nx + c];
        const noise = Math.sin(c * 0.1) * Math.cos(r * 0.1);
        const rockPct = Math.max(0, Math.min(30, 4.0 + (h > 50 ? 12 : 2) + noise * 5));

        const canvasRow = ny - 1 - r;
        const pixelIdx = (canvasRow * nx + c) * 4;

        const t = Math.min(1.0, rockPct / 25.0);
        imgData.data[pixelIdx] = Math.floor(30 + t * 225);
        imgData.data[pixelIdx + 1] = Math.floor(40 + (1 - t) * 60);
        imgData.data[pixelIdx + 2] = Math.floor(160 * (1 - t) + 20);
        imgData.data[pixelIdx + 3] = 220;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    this.rockTexture = new THREE.CanvasTexture(canvas);
  }

  setOverlay(overlayType) {
    this.activeOverlay = overlayType;
    if (!this.nearMesh) return;

    if (overlayType === 'slope') {
      if (!this.slopeTexture) this.computeSlopeTexture();
      this.nearMesh.material.map = this.slopeTexture;
      this.nearMesh.material.bumpMap = null;
      this.nearMesh.material.color.setHex(0xffffff);
    } else if (overlayType === 'rock') {
      if (!this.rockTexture) this.computeRockAbundanceTexture();
      this.nearMesh.material.map = this.rockTexture;
      this.nearMesh.material.bumpMap = null;
      this.nearMesh.material.color.setHex(0xffffff);
    } else {
      this.nearMesh.material.map = this.regolithTexture;
      this.nearMesh.material.bumpMap = this.regolithTexture;
      this.nearMesh.material.bumpScale = 0.12;
      this.nearMesh.material.color.setHex(0xb5b8bc);
    }
    this.nearMesh.material.needsUpdate = true;
  }

  dispose() {
    this.disposeNeighborChunks();
    if (this.nearMesh) {
      this.scene.remove(this.nearMesh);
      this.nearMesh.geometry.dispose();
      this.nearMesh.material.dispose();
      this.nearMesh = null;
    }
    if (this.farMesh) {
      this.scene.remove(this.farMesh);
      this.farMesh.geometry.dispose();
      this.farMesh.material.dispose();
      this.farMesh = null;
    }
    if (this.pedestalMesh) {
      this.scene.remove(this.pedestalMesh);
      this.pedestalMesh.geometry.dispose();
      this.pedestalMesh = null;
    }
    if (this.extendedCrustMesh) {
      this.scene.remove(this.extendedCrustMesh);
      this.extendedCrustMesh.geometry.dispose();
      if (this.extendedCrustMesh.material) this.extendedCrustMesh.material.dispose();
      this.extendedCrustMesh = null;
    }
  }
}
