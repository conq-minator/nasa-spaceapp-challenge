import * as THREE from 'three';

/**
 * Manages the dual-resolution lunar terrain (near-field 5m/10m and far-field 20m/120m).
 * Generates procedural realistic south pole topography for Phase 1
 * and seamlessly ingests LOLA Float32 binary heightmaps for Phase 2.
 */
export class TerrainMesh {
  constructor(scene) {
    this.scene = scene;
    this.nearMesh = null;
    this.farMesh = null;

    this.nearGrid = null;
    this.farGrid = null;

    this.activeOverlay = 'none';
    this.slopeTexture = null;
    this.rockTexture = null;

    // Default lunar surface material
    this.lunarBaseMaterial = new THREE.MeshStandardMaterial({
      color: 0x8a8c8e,
      roughness: 0.88,
      metalness: 0.08,
      flatShading: false,
      side: THREE.DoubleSide,
    });
  }

  /**
   * Generates a high-fidelity synthetic procedural terrain representing
   * a lunar south pole site (e.g. Shackleton crater rim & Malapert ridge).
   * Moon spherical curvature (-d^2 / 2R) is baked in.
   */
  generateProceduralTerrain() {
    const R_MOON = 1737400.0;

    // Near-field grid: 512x512, 10m cells, 5120m total width
    const nearNx = 512;
    const nearNy = 512;
    const nearCellM = 10.0;
    const nearSizeM = 5120.0;
    const nearData = new Float32Array(nearNx * nearNy);

    // Far-field grid: 512x512, 120m cells, 61440m total width
    const farNx = 512;
    const farNy = 512;
    const farCellM = 120.0;
    const farSizeM = 61440.0;
    const farData = new Float32Array(farNx * farNy);

    // Populate Near-field: Lander is at (0, 0).
    // Shackleton rim: Lander sits on a narrow ridge.
    // South (-Z in Three.js, positive Y in grid coords) drops into deep crater.
    for (let r = 0; r < nearNy; r++) {
      for (let c = 0; c < nearNx; c++) {
        const x = (c - nearNx / 2) * nearCellM; // East-West (m)
        const y = (r - nearNy / 2) * nearCellM; // North-South (m)
        const dist = Math.sqrt(x * x + y * y);

        // Curvature drop
        const curve = -(dist * dist) / (2.0 * R_MOON);

        // Ridge running East-West with crater to the South (y < 0 in local space)
        let elev = 0;
        // Crater rim profile:
        const craterCenterY = -1800; // 1.8km south
        const craterDist = Math.sqrt(x * x + (y - craterCenterY) * (y - craterCenterY));
        if (craterDist < 2200) {
          // Inside crater wall: drops rapidly down to -800m
          const craterWall = Math.sin((craterDist / 2200) * (Math.PI / 2));
          elev += (craterWall - 1.0) * 850;
        }

        // Rolling local terrain noise
        elev += Math.sin(x * 0.008) * Math.cos(y * 0.008) * 15.0;
        elev += Math.sin(x * 0.02 + 1.2) * Math.cos(y * 0.02 + 0.7) * 4.0;
        elev += Math.sin(x * 0.05) * 1.5;

        nearData[r * nearNx + c] = elev + curve;
      }
    }

    // Ensure lander position at (x=0, y=0) is exactly height = 0
    const centerIdx = Math.floor(nearNy / 2) * nearNx + Math.floor(nearNx / 2);
    const centerOffset = nearData[centerIdx];
    for (let i = 0; i < nearData.length; i++) {
      nearData[i] -= centerOffset;
    }

    // Populate Far-field: up to 30km radius
    // Add prominent Mons Malapert peak to the North/North-East (azimuth ~20°, dist ~25-40km)
    for (let r = 0; r < farNy; r++) {
      for (let c = 0; c < farNx; c++) {
        const x = (c - farNx / 2) * farCellM;
        const y = (r - farNy / 2) * farCellM;
        const dist = Math.sqrt(x * x + y * y);

        const curve = -(dist * dist) / (2.0 * R_MOON);

        let elev = 0;
        // Mons Malapert massif at x = 12000m, y = 32000m (North-East, 34km away)
        const malapertDist = Math.sqrt((x - 12000) * (x - 12000) + (y - 32000) * (y - 32000));
        if (malapertDist < 18000) {
          const mFactor = Math.cos((malapertDist / 18000) * (Math.PI / 2));
          elev += mFactor * mFactor * 2400; // Peaks 2400m above base
        }

        // Distant crater rings
        elev += Math.sin(dist * 0.0003) * 350.0;
        elev += Math.sin(x * 0.0008) * Math.cos(y * 0.0008) * 120.0;

        farData[r * farNx + c] = elev + curve;
      }
    }

    this.nearGrid = { data: nearData, nx: nearNx, ny: nearNy, cellM: nearCellM, sizeM: nearSizeM, maxDist: nearSizeM / 2 };
    this.farGrid = { data: farData, nx: farNx, ny: farNy, cellM: farCellM, sizeM: farSizeM, maxDist: farSizeM / 2 };

    this.buildMeshes();
    this.computeSlopeTexture();
  }

  /**
   * Builds the dual Three.js PlaneGeometry meshes from stored grid data.
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
    nearGeo.rotateX(-Math.PI / 2); // Rotate flat onto XZ plane

    const nearPos = nearGeo.attributes.position.array;
    for (let r = 0; r < this.nearGrid.ny; r++) {
      for (let c = 0; c < this.nearGrid.nx; c++) {
        // PlaneGeometry vertices row-by-row top to bottom (row 0 = north, max row = south)
        // In our data, row 0 = southernmost row, so flip rows:
        const dataRow = this.nearGrid.ny - 1 - r;
        const vertexIndex = r * this.nearGrid.nx + c;
        const dataIndex = dataRow * this.nearGrid.nx + c;

        nearPos[vertexIndex * 3 + 1] = this.nearGrid.data[dataIndex];
      }
    }
    nearGeo.computeVertexNormals();
    nearGeo.attributes.position.needsUpdate = true;

    this.nearMesh = new THREE.Mesh(nearGeo, this.lunarBaseMaterial.clone());
    this.nearMesh.receiveShadow = true;
    this.nearMesh.castShadow = true;
    this.nearMesh.name = 'nearTerrain';
    this.scene.add(this.nearMesh);

    // 2. Far Mesh
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
        const dataRow = this.farGrid.ny - 1 - r;
        const vertexIndex = r * this.farGrid.nx + c;
        const dataIndex = dataRow * this.farGrid.nx + c;

        farPos[vertexIndex * 3 + 1] = this.farGrid.data[dataIndex];
      }
    }
    farGeo.computeVertexNormals();
    farGeo.attributes.position.needsUpdate = true;

    // Slight offset down to avoid z-fighting with near mesh at center
    farGeo.translate(0, -0.5, 0);

    this.farMesh = new THREE.Mesh(farGeo, this.lunarBaseMaterial.clone());
    this.farMesh.receiveShadow = true;
    this.farMesh.castShadow = true;
    this.farMesh.name = 'farTerrain';
    this.scene.add(this.farMesh);
  }

  /**
   * Ingests real Float32Array binary heightmaps (Phase 2).
   */
  loadFromBuffers(nearBuffer, nearMeta, farBuffer, farMeta) {
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
    this.computeSlopeTexture();
  }

  /**
   * Computes a high-contrast slope texture in degrees from near terrain heightmap.
   * Color ramp:
   *   0° - 5°   : Green (Safe landing & rover traverse)
   *   5° - 15°  : Yellow / Amber (Moderate slope)
   *   15° - 25°+: Deep Red (Hazardous / Tip-over risk)
   */
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
        const cLeft = Math.max(0, c - 1);
        const cRight = Math.min(nx - 1, c + 1);
        const rBottom = Math.max(0, r - 1);
        const rTop = Math.min(ny - 1, r + 1);

        const dzdx = (data[r * nx + cRight] - data[r * nx + cLeft]) / ((cRight - cLeft) * cellM);
        const dzdy = (data[rTop * nx + c] - data[rBottom * nx + c]) / ((rTop - rBottom) * cellM);

        const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
        const slopeDeg = (slopeRad * 180) / Math.PI;

        // Visual row flip for Canvas 2D (top row = 0)
        const canvasRow = ny - 1 - r;
        const pixelIdx = (canvasRow * nx + c) * 4;

        let red = 0, green = 0, blue = 0;
        if (slopeDeg < 5.0) {
          // 0° - 5° : Green
          const t = slopeDeg / 5.0;
          red = Math.floor(40 + t * 80);
          green = Math.floor(180 + t * 40);
          blue = 50;
        } else if (slopeDeg < 15.0) {
          // 5° - 15° : Green to Yellow
          const t = (slopeDeg - 5.0) / 10.0;
          red = Math.floor(120 + t * 135);
          green = Math.floor(220 - t * 40);
          blue = 20;
        } else {
          // 15° - 30°+ : Orange to Red
          const t = Math.min(1.0, (slopeDeg - 15.0) / 15.0);
          red = 240;
          green = Math.floor(180 * (1.0 - t));
          blue = 20;
        }

        imgData.data[pixelIdx] = red;
        imgData.data[pixelIdx + 1] = green;
        imgData.data[pixelIdx + 2] = blue;
        imgData.data[pixelIdx + 3] = 230; // semi-transparent blend
      }
    }

    ctx.putImageData(imgData, 0, 0);
    this.slopeTexture = new THREE.CanvasTexture(canvas);
    this.slopeTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.slopeTexture.wrapT = THREE.ClampToEdgeWrapping;
  }

  /**
   * Generates a synthetic Diviner Rock Abundance layer (<5% smooth, >20% rocky)
   */
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
        // Crater rims and slopes accumulate higher rock abundance
        const h = this.nearGrid.data[r * nx + c];
        const noise = Math.sin(c * 0.1) * Math.cos(r * 0.1);
        const rockPct = Math.max(0, Math.min(30, 4.0 + (h > 50 ? 12 : 2) + noise * 5));

        const canvasRow = ny - 1 - r;
        const pixelIdx = (canvasRow * nx + c) * 4;

        // Color: Deep Blue (low rocks <5%) -> Purple -> Bright Orange/Red (>20%)
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

  /**
   * Swaps the active visual overlay on the terrain mesh.
   * @param {'none' | 'slope' | 'rock'} overlayType
   */
  setOverlay(overlayType) {
    this.activeOverlay = overlayType;

    if (!this.nearMesh) return;

    if (overlayType === 'slope') {
      if (!this.slopeTexture) this.computeSlopeTexture();
      this.nearMesh.material.map = this.slopeTexture;
      this.nearMesh.material.color.setHex(0xffffff);
    } else if (overlayType === 'rock') {
      if (!this.rockTexture) this.computeRockAbundanceTexture();
      this.nearMesh.material.map = this.rockTexture;
      this.nearMesh.material.color.setHex(0xffffff);
    } else {
      // Natural lunar gray
      this.nearMesh.material.map = null;
      this.nearMesh.material.color.setHex(0x8a8c8e);
    }
    this.nearMesh.material.needsUpdate = true;
  }

  dispose() {
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
  }
}
