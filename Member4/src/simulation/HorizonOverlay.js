import * as THREE from 'three';
import { bodyDirection } from '../core/math.js';

/**
 * Manages the 360-degree engine horizon mask line overlay.
 * Renders a glowing neon line tracing the exact ridge profile in 3D space.
 * When properly aligned, the mask line sits directly on the 3D peaks,
 * providing visual mathematical proof of geometric consistency.
 */
export class HorizonOverlay {
  constructor(scene) {
    this.scene = scene;
    this.maskLine = null;
    this.visualRadius = 4500.0; // Sits right at the ridge boundary
    this.visible = true;
    this.elevDegArray = new Float32Array(360);
  }

  /**
   * Generates a procedural horizon mask that mathematically matches
   * the procedural crater rim and distant Malapert mountain peak.
   */
  generateProceduralMask(terrainMesh) {
    const R_MOON = 1737400.0;
    const obsHeight = 2.0;

    for (let az = 0; az < 360; az++) {
      let maxAngleDeg = -10.0;
      const azRad = (az * Math.PI) / 180;
      const sinAz = Math.sin(azRad);
      const cosAz = Math.cos(azRad);

      // Ray march along azimuth across near and far terrain grids
      // Check near grid (10m to 2500m, step=20m)
      for (let dist = 20; dist <= terrainMesh.nearGrid.maxDist; dist += 20) {
        const x = dist * sinAz;
        const y = dist * cosAz;
        const r = Math.floor((y + terrainMesh.nearGrid.sizeM / 2) / terrainMesh.nearGrid.cellM);
        const c = Math.floor((x + terrainMesh.nearGrid.sizeM / 2) / terrainMesh.nearGrid.cellM);

        if (r >= 0 && r < terrainMesh.nearGrid.ny && c >= 0 && c < terrainMesh.nearGrid.nx) {
          const h = terrainMesh.nearGrid.data[r * terrainMesh.nearGrid.nx + c];
          // Angle formula: atan2(terrain_h - obs_h - d^2/2R, dist)
          const angleRad = Math.atan2(h - obsHeight, dist);
          const angleDeg = (angleRad * 180) / Math.PI;
          if (angleDeg > maxAngleDeg) maxAngleDeg = angleDeg;
        }
      }

      // Check far grid (2500m to 45000m, step=250m)
      for (let dist = 2500; dist <= terrainMesh.farGrid.maxDist; dist += 250) {
        const x = dist * sinAz;
        const y = dist * cosAz;
        const r = Math.floor((y + terrainMesh.farGrid.sizeM / 2) / terrainMesh.farGrid.cellM);
        const c = Math.floor((x + terrainMesh.farGrid.sizeM / 2) / terrainMesh.farGrid.cellM);

        if (r >= 0 && r < terrainMesh.farGrid.ny && c >= 0 && c < terrainMesh.farGrid.nx) {
          const h = terrainMesh.farGrid.data[r * terrainMesh.farGrid.nx + c];
          const angleRad = Math.atan2(h - obsHeight, dist);
          const angleDeg = (angleRad * 180) / Math.PI;
          if (angleDeg > maxAngleDeg) maxAngleDeg = angleDeg;
        }
      }

      this.elevDegArray[az] = Math.max(-1.5, maxAngleDeg);
    }

    this.rebuildMesh();
  }

  /**
   * Sets the horizon mask from real engine JSON array (Phase 2).
   * @param {number[]} elevDegArray - Exactly 360 float elevation values
   */
  setFromMaskData(elevDegArray) {
    for (let i = 0; i < 360; i++) {
      this.elevDegArray[i] = elevDegArray[i] || 0.0;
    }
    this.rebuildMesh();
  }

  /**
   * Rebuilds the Three.js LineLoop geometry from current elevation array.
   */
  rebuildMesh() {
    if (this.maskLine) {
      this.scene.remove(this.maskLine);
      this.maskLine.geometry.dispose();
      this.maskLine.material.dispose();
      this.maskLine = null;
    }

    const points = [];
    for (let az = 0; az < 360; az++) {
      const el = this.elevDegArray[az];
      const dir = bodyDirection(az, el);
      points.push(dir.multiplyScalar(this.visualRadius));
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0x00ff88, // Vivid emerald green laser line
      linewidth: 2,
      transparent: true,
      opacity: 0.92,
    });

    this.maskLine = new THREE.LineLoop(geometry, material);
    this.maskLine.visible = this.visible;
    this.maskLine.name = 'horizonMaskLine';
    this.scene.add(this.maskLine);
  }

  /**
   * Query the horizon elevation at any floating-point azimuth
   */
  getHorizonElevation(azDeg) {
    let az = azDeg % 360;
    if (az < 0) az += 360;
    const az0 = Math.floor(az);
    const az1 = (az0 + 1) % 360;
    const frac = az - az0;
    return (1 - frac) * this.elevDegArray[az0] + frac * this.elevDegArray[az1];
  }

  sampleElevation(azDeg) {
    return this.getHorizonElevation(azDeg);
  }

  setVisible(visible) {
    this.visible = visible;
    if (this.maskLine) this.maskLine.visible = visible;
  }
}
