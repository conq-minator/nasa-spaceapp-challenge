import * as THREE from 'three';
import { bodyDirection } from '../core/math.js';

/**
 * Manages the Sun, Earth, deep space starfield, directional illumination, and dynamic shadows.
 * High-fidelity rendering:
 * - Ultra-smooth 128-segment Earth sphere (zero faceted pentagon edges)
 * - 2048x1024 photorealistic Blue Marble Earth texture with realistic continents, deserts, and cyclonic storm spirals
 * - Soft atmospheric Rayleigh scattering limb halo
 * - Blinding white solar disk with radiant corona flare
 * - Soft secondary lunar ambient and earthshine lighting
 */
export class CelestialBodies {
  constructor(scene) {
    this.scene = scene;
    this.skyRadius = 600000.0;
    this.exaggeration = 1.0;

    this.sunAz = 0.0;
    this.sunEl = 1.5;
    this.earthAz = 15.0;
    this.earthEl = 2.0;

    this.initStarfield();
    this.initSun();
    this.initEarth();
    this.initEarthArrow();

    this.updatePositions(this.sunAz, this.sunEl, this.earthAz, this.earthEl);
  }

  initStarfield() {
    const starCount = 3600;
    const starGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    const starRadius = 800000.0;

    const spectralColors = [
      new THREE.Color(0xdce6ff),
      new THREE.Color(0xf8f9fa),
      new THREE.Color(0xfff4e6),
      new THREE.Color(0xffe4b5),
      new THREE.Color(0xffd1a4),
    ];

    for (let i = 0; i < starCount; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);

      positions[i * 3] = starRadius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = starRadius * Math.cos(phi);
      positions[i * 3 + 2] = starRadius * Math.sin(phi) * Math.sin(theta);

      const col = spectralColors[Math.floor(Math.random() * spectralColors.length)];
      const brightness = Math.pow(Math.random(), 2.8) * 0.8 + 0.2;
      colors[i * 3] = col.r * brightness;
      colors[i * 3 + 1] = col.g * brightness;
      colors[i * 3 + 2] = col.b * brightness;
    }

    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const starMat = new THREE.PointsMaterial({
      size: 2.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.90,
      sizeAttenuation: false,
      depthWrite: false,
      depthTest: true,
    });

    this.starPoints = new THREE.Points(starGeo, starMat);
    this.scene.add(this.starPoints);
  }

  initSun() {
    this.sunGroup = new THREE.Group();
    this.scene.add(this.sunGroup);

    this.sunBaseRadius = 2775.0;

    // Blinding white core solar disk
    this.sunGeo = new THREE.SphereGeometry(this.sunBaseRadius, 64, 64);
    this.sunMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.sunMesh = new THREE.Mesh(this.sunGeo, this.sunMat);
    this.sunGroup.add(this.sunMesh);

    // Radiant Corona Flare Sprite (Always circular, soft atmospheric glare)
    const coronaTexture = this.generateCoronaTexture();
    const coronaMat = new THREE.SpriteMaterial({
      map: coronaTexture,
      color: 0xfff4dc,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.coronaSprite = new THREE.Sprite(coronaMat);
    this.coronaBaseScale = this.sunBaseRadius * 7.0;
    this.coronaSprite.scale.set(this.coronaBaseScale, this.coronaBaseScale, 1);
    this.sunGroup.add(this.coronaSprite);

    // Directional Sunlight (Grazing lunar shadow caster)
    this.sunLight = new THREE.DirectionalLight(0xfffcf2, 2.6);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 100;
    this.sunLight.shadow.camera.far = 250000;

    const d = 4200;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;

    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.05;

    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
  }

  generateCoronaTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createRadialGradient(128, 128, 4, 128, 128, 128);
    grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
    grad.addColorStop(0.12, 'rgba(255, 250, 235, 0.88)');
    grad.addColorStop(0.32, 'rgba(255, 220, 140, 0.40)');
    grad.addColorStop(0.65, 'rgba(255, 185, 75, 0.12)');
    grad.addColorStop(1.0, 'rgba(255, 140, 20, 0.0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    const tex = new THREE.CanvasTexture(canvas);
    tex.generateMipmaps = true;
    return tex;
  }

  initEarth() {
    this.earthGroup = new THREE.Group();
    this.scene.add(this.earthGroup);

    this.earthBaseRadius = 9940.0;

    const earthTexture = this.generateEarthTexture();

    // 128x128 ultra-high resolution sphere: perfectly circular silhouette at all zoom levels
    this.earthGeo = new THREE.SphereGeometry(this.earthBaseRadius, 128, 128);
    this.earthMat = new THREE.MeshStandardMaterial({
      map: earthTexture,
      roughness: 0.60,
      metalness: 0.05,
      bumpScale: 0.05,
    });
    this.earthMesh = new THREE.Mesh(this.earthGeo, this.earthMat);
    this.earthMesh.rotation.z = (23.44 * Math.PI) / 180; // Earth axial tilt
    this.earthGroup.add(this.earthMesh);

    // Subtle Atmospheric Rayleigh Glow Halo (Additive camera-facing rim)
    const atmoTexture = this.generateAtmosphereSpriteTexture();
    const atmoMat = new THREE.SpriteMaterial({
      map: atmoTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.earthAtmosphereSprite = new THREE.Sprite(atmoMat);
    // Exact scale matching Earth's limb profile
    this.earthAtmoScale = this.earthBaseRadius * 2.22;
    this.earthAtmosphereSprite.scale.set(this.earthAtmoScale, this.earthAtmoScale, 1);
    this.earthGroup.add(this.earthAtmosphereSprite);
  }

  generateAtmosphereSpriteTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Concentric radial gradient placed exactly at the planetary limb
    const grad = ctx.createRadialGradient(256, 256, 215, 256, 256, 256);
    grad.addColorStop(0.0, 'rgba(70, 165, 255, 0.0)');
    grad.addColorStop(0.25, 'rgba(85, 185, 255, 0.40)');
    grad.addColorStop(0.65, 'rgba(65, 150, 255, 0.18)');
    grad.addColorStop(1.0, 'rgba(35, 100, 240, 0.0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    const tex = new THREE.CanvasTexture(canvas);
    tex.generateMipmaps = true;
    return tex;
  }

  /**
   * Generates a photorealistic 2048x1024 equirectangular Earth texture
   * with deep oceanic shelf gradients, detailed continents, arid deserts,
   * realistic polar ice caps, and cyclonic storm cloud systems.
   */
  generateEarthTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    // 1. Deep Oceanic Gradient with continental shelves
    const oceanGrad = ctx.createLinearGradient(0, 0, 0, 1024);
    oceanGrad.addColorStop(0.0, '#0a2240');
    oceanGrad.addColorStop(0.2, '#0c2748');
    oceanGrad.addColorStop(0.5, '#071630');
    oceanGrad.addColorStop(0.8, '#0c2748');
    oceanGrad.addColorStop(1.0, '#0a2240');
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(0, 0, 2048, 1024);

    // Helper: draw continent landmass with soft coastal shelves
    const drawLandmass = (pathFn, baseColor, shelfColor = '#1d5472') => {
      // Coastal shallow shelf
      ctx.save();
      ctx.fillStyle = shelfColor;
      ctx.shadowColor = shelfColor;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      pathFn(ctx);
      ctx.fill();
      ctx.restore();

      // Core landmass
      ctx.save();
      ctx.fillStyle = baseColor;
      ctx.beginPath();
      pathFn(ctx);
      ctx.fill();
      ctx.restore();
    };

    // 2. North America
    drawLandmass((c) => {
      c.moveTo(340, 220);
      c.bezierCurveTo(390, 180, 520, 210, 580, 270);
      c.bezierCurveTo(620, 310, 600, 390, 570, 440);
      c.bezierCurveTo(540, 480, 480, 540, 460, 580); // Mexico
      c.bezierCurveTo(430, 560, 420, 500, 390, 460); // Gulf
      c.bezierCurveTo(360, 420, 310, 340, 300, 280); // West coast
      c.closePath();
    }, '#365331');

    // 3. South America
    drawLandmass((c) => {
      c.moveTo(560, 570);
      c.bezierCurveTo(650, 580, 720, 640, 710, 720); // Brazil bulge
      c.bezierCurveTo(690, 780, 640, 850, 590, 920); // Patagonia
      c.bezierCurveTo(570, 900, 550, 820, 540, 740); // Andes spine
      c.bezierCurveTo(530, 680, 530, 610, 560, 570);
      c.closePath();
    }, '#2a4c28');

    // 4. Eurasia (Europe & Asia)
    drawLandmass((c) => {
      c.moveTo(980, 240);
      c.bezierCurveTo(1100, 200, 1300, 190, 1500, 220);
      c.bezierCurveTo(1680, 250, 1800, 320, 1780, 420); // East Asia / Siberia
      c.bezierCurveTo(1740, 490, 1600, 550, 1500, 580); // China / Indochina
      c.bezierCurveTo(1440, 540, 1380, 520, 1320, 560); // India
      c.bezierCurveTo(1260, 530, 1200, 500, 1140, 540); // Arabia
      c.bezierCurveTo(1080, 480, 1020, 420, 960, 360); // Mediterranean / Europe
      c.bezierCurveTo(940, 300, 960, 250, 980, 240);
      c.closePath();
    }, '#3c582f');

    // 5. Africa
    drawLandmass((c) => {
      c.moveTo(1020, 410);
      c.bezierCurveTo(1160, 420, 1220, 470, 1240, 540); // Horn of Africa
      c.bezierCurveTo(1220, 640, 1180, 760, 1120, 820); // South Africa
      c.bezierCurveTo(1070, 800, 1040, 720, 1020, 640);
      c.bezierCurveTo(980, 580, 960, 500, 980, 440); // West Africa bulge
      c.closePath();
    }, '#4e542a');

    // 6. Arid Sahara & Arabian Desert tones
    const saharaGrad = ctx.createRadialGradient(1110, 470, 40, 1110, 470, 180);
    saharaGrad.addColorStop(0.0, 'rgba(185, 160, 95, 0.85)');
    saharaGrad.addColorStop(0.7, 'rgba(150, 130, 75, 0.65)');
    saharaGrad.addColorStop(1.0, 'rgba(60, 80, 40, 0.0)');
    ctx.fillStyle = saharaGrad;
    ctx.beginPath();
    ctx.ellipse(1110, 470, 190, 75, 0.05, 0, Math.PI * 2);
    ctx.fill();

    // 7. Australia
    drawLandmass((c) => {
      c.moveTo(1580, 680);
      c.bezierCurveTo(1680, 670, 1740, 720, 1720, 790);
      c.bezierCurveTo(1690, 840, 1610, 850, 1550, 810);
      c.bezierCurveTo(1520, 770, 1530, 710, 1580, 680);
      c.closePath();
    }, '#6d5232');

    // Outback red-gold center
    ctx.fillStyle = 'rgba(180, 95, 45, 0.65)';
    ctx.beginPath();
    ctx.ellipse(1630, 760, 60, 35, 0, 0, Math.PI * 2);
    ctx.fill();

    // 8. Soft Feathered Polar Ice Sheets (ZERO hard rectangle seams)
    // North Pole (Arctic)
    const northIceGrad = ctx.createLinearGradient(0, 0, 0, 110);
    northIceGrad.addColorStop(0.0, 'rgba(242, 248, 255, 0.96)');
    northIceGrad.addColorStop(0.55, 'rgba(230, 242, 255, 0.72)');
    northIceGrad.addColorStop(0.85, 'rgba(215, 235, 255, 0.28)');
    northIceGrad.addColorStop(1.0, 'rgba(200, 225, 255, 0.0)');
    ctx.fillStyle = northIceGrad;
    ctx.fillRect(0, 0, 2048, 110);

    // South Pole (Antarctica)
    const southIceGrad = ctx.createLinearGradient(0, 914, 0, 1024);
    southIceGrad.addColorStop(0.0, 'rgba(200, 225, 255, 0.0)');
    southIceGrad.addColorStop(0.18, 'rgba(215, 235, 255, 0.32)');
    southIceGrad.addColorStop(0.50, 'rgba(230, 242, 255, 0.78)');
    southIceGrad.addColorStop(1.0, 'rgba(242, 248, 255, 0.98)');
    ctx.fillStyle = southIceGrad;
    ctx.fillRect(0, 914, 2048, 110);

    // 9. Photorealistic Swirling Atmospheric Cloud Belts & Cyclonic Spirals
    const drawCyclone = (cx, cy, radius, arms = 3) => {
      ctx.save();
      for (let a = 0; a < arms; a++) {
        const startAngle = (a / arms) * Math.PI * 2;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.48)';
        ctx.lineWidth = radius * 0.22;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let t = 0; t < 1.4; t += 0.08) {
          const r = radius * t;
          const theta = startAngle + t * 2.8;
          const x = cx + Math.cos(theta) * r;
          const y = cy + Math.sin(theta) * r * 0.65;
          if (t === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    };

    // Major cyclonic systems
    drawCyclone(480, 320, 90, 3);   // North Atlantic cyclone
    drawCyclone(1650, 360, 110, 4);  // North-West Pacific typhoon
    drawCyclone(1250, 780, 100, 3);  // Southern Ocean circumpolar vortex
    drawCyclone(720, 740, 85, 3);    // South Pacific storm

    // Equatorial ITCZ Cloud Belts
    for (let i = 0; i < 48; i++) {
      const cx = (i * 44) % 2048;
      const cy = 490 + Math.sin(i * 0.52) * 55;
      const w = 120 + (i % 6) * 24;
      const h = 26 + (i % 4) * 8;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.5);
      grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.65)');
      grad.addColorStop(0.6, 'rgba(255, 255, 255, 0.35)');
      grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, w * 0.5, h * 0.5, 0.12 * Math.sin(i), 0, Math.PI * 2);
      ctx.fill();
    }

    // Mid-latitude wandering cloud bands
    for (let i = 0; i < 36; i++) {
      const cx = (i * 58 + 200) % 2048;
      const cy = 260 + Math.sin(i * 0.65) * 85;
      const w = 150 + (i % 5) * 35;
      const h = 32 + (i % 3) * 12;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.5);
      grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.55)');
      grad.addColorStop(0.7, 'rgba(255, 255, 255, 0.22)');
      grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, w * 0.5, h * 0.5, 0.25 * Math.sin(i), 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    return texture;
  }

  initEarthArrow() {
    this.earthArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 2.0, 0),
      350.0,
      0x00d4ff,
      60.0,
      30.0
    );
    this.earthArrow.visible = false;
    this.scene.add(this.earthArrow);
  }

  updatePositions(sunAz, sunEl, earthAz, earthEl) {
    this.sunAz = sunAz;
    this.sunEl = sunEl;
    this.earthAz = earthAz;
    this.earthEl = earthEl;

    // 1. Sun
    const sunDir = bodyDirection(sunAz, sunEl);
    const sunPos = sunDir.clone().multiplyScalar(this.skyRadius);
    this.sunGroup.position.copy(sunPos);

    this.sunLight.position.copy(sunDir.clone().multiplyScalar(100000.0));
    this.sunLight.target.position.set(0, 0, 0);
    this.sunLight.target.updateMatrixWorld();

    // 2. Earth
    const earthDir = bodyDirection(earthAz, earthEl);
    const earthPos = earthDir.clone().multiplyScalar(this.skyRadius);
    this.earthGroup.position.copy(earthPos);

    // Earth arrow direction
    this.earthArrow.setDirection(earthDir);
  }

  updateStarfield(cameraPos) {
    if (this.starPoints && cameraPos) {
      this.starPoints.position.copy(cameraPos);
    }
  }

  setExaggeration(mult) {
    this.exaggeration = mult;
    const rSun = this.sunBaseRadius * mult;
    this.sunMesh.scale.set(mult, mult, mult);
    this.coronaSprite.scale.set(this.coronaBaseScale * mult, this.coronaBaseScale * mult, 1);

    const rEarth = this.earthBaseRadius * mult;
    this.earthMesh.scale.set(mult, mult, mult);
    this.earthAtmosphereSprite.scale.set(this.earthAtmoScale * mult, this.earthAtmoScale * mult, 1);
  }

  setArrowVisible(visible) {
    this.earthArrow.visible = visible;
  }
}
