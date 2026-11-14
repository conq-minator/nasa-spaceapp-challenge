import * as THREE from 'three';

/**
 * Converts spherical coordinates (azimuth, elevation in degrees)
 * to a Three.js unit direction vector.
 * 
 * Coordinate System:
 *   +X = East
 *   +Y = Up (Zenith)
 *   +Z = South
 *   -Z = North (Azimuth = 0°)
 * 
 * @param {number} azDeg - Azimuth clockwise from North [0, 360)
 * @param {number} elDeg - Elevation above local horizontal in degrees
 * @returns {THREE.Vector3} Unit direction vector
 */
export function bodyDirection(azDeg, elDeg) {
  const azRad = (azDeg * Math.PI) / 180;
  const elRad = (elDeg * Math.PI) / 180;

  const cosEl = Math.cos(elRad);
  const sinEl = Math.sin(elRad);
  const sinAz = Math.sin(azRad);
  const cosAz = Math.cos(azRad);

  return new THREE.Vector3(
    cosEl * sinAz,   // East (+X)
    sinEl,           // Up (+Y)
    -cosEl * cosAz   // South (+Z, so -Z is North)
  ).normalize();
}

/**
 * Converts a Three.js direction vector back to azimuth and elevation in degrees.
 * 
 * @param {THREE.Vector3} dir - Direction vector
 * @returns {{ az: number, el: number }}
 */
export function azElFromDirection(dir) {
  const norm = dir.clone().normalize();
  const elRad = Math.asin(Math.max(-1, Math.min(1, norm.y)));
  const elDeg = (elRad * 180) / Math.PI;

  // x = cosEl * sinAz, -z = cosEl * cosAz
  // atan2(sinAz, cosAz) = atan2(x, -z)
  let azRad = Math.atan2(norm.x, -norm.z);
  let azDeg = (azRad * 180) / Math.PI;
  if (azDeg < 0) azDeg += 360;

  return { az: azDeg, el: elDeg };
}

/**
 * Sample bilinear interpolation on a 2D grid
 */
export function sampleBilinear(grid, x, y) {
  const colFloat = (x + grid.sizeM / 2) / grid.cellM;
  const rowFloat = (y + grid.sizeM / 2) / grid.cellM;

  const col0 = Math.floor(colFloat);
  const col1 = Math.min(col0 + 1, grid.nx - 1);
  const row0 = Math.floor(rowFloat);
  const row1 = Math.min(row0 + 1, grid.ny - 1);

  if (col0 < 0 || col0 >= grid.nx || row0 < 0 || row0 >= grid.ny) {
    return -9999;
  }

  const u = colFloat - col0;
  const v = rowFloat - row0;

  const idx00 = row0 * grid.nx + col0;
  const idx10 = row0 * grid.nx + col1;
  const idx01 = row1 * grid.nx + col0;
  const idx11 = row1 * grid.nx + col1;

  const h00 = grid.data[idx00];
  const h10 = grid.data[idx10];
  const h01 = grid.data[idx01];
  const h11 = grid.data[idx11];

  return (1 - u) * (1 - v) * h00 + u * (1 - v) * h10 + (1 - u) * v * h01 + u * v * h11;
}
