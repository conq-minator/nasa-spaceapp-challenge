import * as THREE from 'three';
import { bodyDirection } from '../core/math.js';

/**
 * Manages the Sun, Earth, directional illumination, and dynamic shadows.
 * True angular diameters:
 *   Sun  ~ 0.53 degrees
 *   Earth ~ 1.90 degrees (approx 3.6x larger than Sun)
 */
export class CelestialBodies {
  constructor(scene) {
    this.scene = scene;
    this.skyRadius = 70000.0; // Distance on sky sphere (meters)
    this.exaggeration = 1.0;  // 1x (realistic), 3x, 5x

    this.sunAz = 0.0;
    this.sunEl = 1.5;
    this.earthAz = 15.0;
    this.earthEl = 2.0;

    // 1. Sun Mesh
    // Base physical radius at 70,000m: 70000 * tan(0.53° / 2) ~ 324m
    this.sunBaseRadius = 324.0;
    this.sunGeo = new THREE.SphereGeometry(this.sunBaseRadius, 32, 32);
    this.sunMat = new THREE.MeshBasicMaterial({
      color: 0xfff6bd, // Luminous solar disk
    });
    this.sunMesh = new THREE.Mesh(this.sunGeo, this.sunMat);
    this.scene.add(this.sunMesh);

    // Sun Directional Light (solar beam casting long grazing shadows)
    this.sunLight = new THREE.DirectionalLight(0xfffae6, 2.2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 100;
    this.sunLight.shadow.camera.far = 150000;

    // Cover the near terrain tile
    const d = 3500;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;

    // Low grazing angle bias tuning
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.05;

    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // 2. Earth Mesh
    // Base physical radius: 70000 * tan(1.90° / 2) ~ 1160m
    this.earthBaseRadius = 1160.0;
    this.earthGeo = new THREE.SphereGeometry(this.earthBaseRadius, 32, 32);
    this.earthMat = new THREE.MeshBasicMaterial({
      color: 0x4aa3df, // Oceanic blue with cloud brilliance
    });
    this.earthMesh = new THREE.Mesh(this.earthGeo, this.earthMat);
    this.scene.add(this.earthMesh);

    // 3. Earth Direction Vector Arrow (Cyan helper from mast)
    this.earthArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 2.0, 0),
      400.0,
      0x00d4ff,
      40.0,
      20.0
    );
    this.scene.add(this.earthArrow);

    this.updatePositions(this.sunAz, this.sunEl, this.earthAz, this.earthEl);
  }

  /**
   * Sets celestial bodies positions from azimuth and elevation in degrees.
   */
  updatePositions(sunAz, sunEl, earthAz, earthEl) {
    this.sunAz = sunAz;
    this.sunEl = sunEl;
    this.earthAz = earthAz;
    this.earthEl = earthEl;

    // 1. Sun Vector
    const sunDir = bodyDirection(sunAz, sunEl);
    this.sunMesh.position.copy(sunDir.clone().multiplyScalar(this.skyRadius));

    // Directional light position
    this.sunLight.position.copy(sunDir.clone().multiplyScalar(10000.0));
    this.sunLight.target.position.set(0, 0, 0);

    // Dim the sunlight when Sun drops below horizon
    if (sunEl < 0) {
      this.sunLight.intensity = Math.max(0, 2.2 * (1.0 + sunEl * 0.5));
    } else {
      this.sunLight.intensity = 2.2;
    }

    // 2. Earth Vector
    const earthDir = bodyDirection(earthAz, earthEl);
    this.earthMesh.position.copy(earthDir.clone().multiplyScalar(this.skyRadius));

    // Update Earth Arrow direction
    this.earthArrow.setDirection(earthDir);
  }

  /**
   * Toggles visual magnification for Sun and Earth disks.
   * @param {number} mult - 1.0, 3.0, or 5.0
   */
  setExaggeration(mult) {
    this.exaggeration = mult;
    this.sunMesh.scale.setScalar(mult);
    this.earthMesh.scale.setScalar(mult);
  }

  /**
   * Toggle visibility of Earth direction arrow
   */
  setArrowVisible(visible) {
    this.earthArrow.visible = visible;
  }
}
