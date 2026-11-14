import * as THREE from 'three';
import { bodyDirection } from '../core/math.js';

/**
 * Renders cardinal compass directions (N, NE, E, SE, S, SW, W, NW)
 * and elevation reference rings (0°, 5°, 10°) floating in the 3D sky.
 */
export class CompassGrid {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'compassGrid';
    this.scene.add(this.group);

    this.radius = 4200.0; // Distance for floating reference grid

    this.buildElevationRings();
    this.buildCompassTicks();
  }

  buildElevationRings() {
    const ringElevations = [0, 5, 10]; // degrees
    const segments = 120;

    ringElevations.forEach((elDeg) => {
      const points = [];
      for (let i = 0; i <= segments; i++) {
        const az = (i / segments) * 360;
        const dir = bodyDirection(az, elDeg);
        points.push(dir.multiplyScalar(this.radius));
      }

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const isZero = elDeg === 0;

      const material = new THREE.LineBasicMaterial({
        color: isZero ? 0x3d7099 : 0x244259, // 0° is brighter blue-gray
        transparent: true,
        opacity: isZero ? 0.75 : 0.45,
      });

      const ringLine = new THREE.Line(geometry, material);
      this.group.add(ringLine);

      // Add small label at North (az = 0°) for each ring
      const labelSprite = this.createTextSprite(`${elDeg}°`, isZero ? '#60a5fa' : '#38bdf8', 42);
      const labelDir = bodyDirection(0, elDeg);
      labelSprite.position.copy(labelDir.multiplyScalar(this.radius * 0.98));
      labelSprite.scale.set(120, 60, 1);
      this.group.add(labelSprite);
    });
  }

  buildCompassTicks() {
    const ticks = [
      { text: 'NORTH [0°]', az: 0, el: 0, color: '#f87171', primary: true },
      { text: 'NE [45°]', az: 45, el: 0, color: '#94a3b8', primary: false },
      { text: 'EAST [90°]', az: 90, el: 0, color: '#38bdf8', primary: true },
      { text: 'SE [135°]', az: 135, el: 0, color: '#94a3b8', primary: false },
      { text: 'SOUTH [180°]', az: 180, el: 0, color: '#38bdf8', primary: true },
      { text: 'SW [225°]', az: 225, el: 0, color: '#94a3b8', primary: false },
      { text: 'WEST [270°]', az: 270, el: 0, color: '#38bdf8', primary: true },
      { text: 'NW [315°]', az: 315, el: 0, color: '#94a3b8', primary: false },
    ];

    ticks.forEach(({ text, az, el, color, primary }) => {
      const sprite = this.createTextSprite(text, color, primary ? 52 : 36);
      const dir = bodyDirection(az, el);
      // Place slightly elevated so it floats above the 0° line
      sprite.position.copy(dir.multiplyScalar(this.radius * 0.96));
      sprite.position.y += primary ? 160 : 100;
      sprite.scale.set(primary ? 260 : 180, primary ? 130 : 90, 1);
      this.group.add(sprite);

      // Small vertical tick mark line down to 0°
      const topDir = bodyDirection(az, 1.2).multiplyScalar(this.radius);
      const botDir = bodyDirection(az, -0.6).multiplyScalar(this.radius);
      const tickGeo = new THREE.BufferGeometry().setFromPoints([topDir, botDir]);
      const tickMat = new THREE.LineBasicMaterial({
        color: primary ? 0x60a5fa : 0x475569,
        transparent: true,
        opacity: 0.8,
      });
      this.group.add(new THREE.Line(tickGeo, tickMat));
    });
  }

  createTextSprite(text, color, fontSize = 48) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.font = `bold ${fontSize}px "JetBrains Mono", monospace, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Dark background pill with border
    ctx.fillStyle = 'rgba(10, 15, 25, 0.75)';
    ctx.beginPath();
    ctx.roundRect(40, 60, 432, 136, 24);
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Text with soft glow
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    ctx.fillText(text, 256, 128);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    return new THREE.Sprite(material);
  }

  setVisible(visible) {
    this.group.visible = visible;
  }
}
