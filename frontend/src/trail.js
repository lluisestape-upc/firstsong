/**
 * Mechanic 3. The world keeps where you have been.
 *
 * A faint line on the ground that never clears, so by the end of the song the
 * floor is a drawing of the route you took, which is to say a drawing of the
 * mix you heard. Nobody hears the same song.
 *
 * One preallocated buffer with a growing draw range: no per-frame allocation,
 * no geometry rebuilds.
 */
import * as THREE from 'three';

const MAX_POINTS = 6000;
const STEP = 0.45;          // metres of travel between recorded points
const HEIGHT = 0.06;        // just clear of the ground so it does not z-fight

export class Trail {
  constructor(scene, colour = '#cfd6e6') {
    this.positions = new Float32Array(MAX_POINTS * 3);
    this.alphas = new Float32Array(MAX_POINTS);
    this.count = 0;
    this.last = new THREE.Vector3(Infinity, 0, Infinity);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    geometry.setDrawRange(0, 0);

    const material = new THREE.ShaderMaterial({
      uniforms: { uColour: { value: new THREE.Color(colour) } },
      vertexShader: `
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uColour;
        varying float vAlpha;
        void main() { gl_FragColor = vec4(uColour, vAlpha * 0.55); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.line = new THREE.Line(geometry, material);
    this.line.frustumCulled = false;
    scene.add(this.line);
    this.geometry = geometry;
  }

  /** Call once per frame with the camera position. */
  update(position) {
    if (this.count >= MAX_POINTS) return;
    if (position.distanceTo(this.last) < STEP) return;

    const i = this.count;
    this.positions[i * 3] = position.x;
    this.positions[i * 3 + 1] = HEIGHT;
    this.positions[i * 3 + 2] = position.z;
    // The oldest part of the walk sits faintest, so the route reads as a path
    // rather than a scribble.
    this.alphas[i] = 0.35;

    for (let k = Math.max(0, i - 40); k < i; k++) {
      this.alphas[k] = Math.min(1.0, this.alphas[k] + 0.012);
    }

    this.count++;
    this.last.copy(position);

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
    this.geometry.setDrawRange(0, this.count);
  }

  clear() {
    this.count = 0;
    this.last.set(Infinity, 0, Infinity);
    this.geometry.setDrawRange(0, 0);
  }
}
