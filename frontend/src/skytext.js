/**
 * Words written in the world.
 *
 * Every line here is a thing standing at a place: it is given one position and
 * one facing when it is written, and it never moves again. It does not hang
 * off the camera, it does not swim when you jump, and it does not turn to
 * follow you. Walk away from it and it is behind you, like anything else.
 *
 * Three kinds, differing only in where they are written and how long they
 * last:
 *   say       the one sentence a mode needs, written ahead of you as you come
 *             in, and faded out once you have clearly understood it.
 *   announce  a single remark, briefly, at the moment it is true.
 *   pin       a sign at a place somebody else chose, held until replaced.
 */
import * as THREE from 'three';

const AHEAD = 26;               // how far in front a written line stands
const INSTRUCTION_HEIGHT = 9.5; // about twenty degrees up at that distance
const ANNOUNCE_HEIGHT = 6.5;

const _ahead = new THREE.Vector3();

function textPlane(text, { size = 88, width = 2048, opacity = 0.5, italic = false }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round(size * 2.2);
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${italic ? 'italic ' : ''}${size}px ui-serif, Georgia, "Times New Roman", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const aspect = canvas.width / canvas.height;
  const height = 7;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(height * aspect, height),
    new THREE.MeshBasicMaterial({
      map: texture, transparent: true, opacity,
      depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    })
  );
  mesh.renderOrder = -1;
  return mesh;
}

export class SkyText {
  constructor(scene, camera) {
    this.camera = camera;
    this.scene = scene;
    this.group = new THREE.Group();
    this.instruction = null;
    this.instructionUntil = 0;
    this.announcement = null;
    this.announceUntil = 0;
    this.sign = null;
    this.elapsed = 0;
    scene.add(this.group);
  }

  /** A point out in front of where the camera is facing, right now, once. */
  _ahead(height) {
    this.camera.getWorldDirection(_ahead);
    _ahead.y = 0;
    if (_ahead.lengthSq() < 1e-6) _ahead.set(0, 0, -1);
    _ahead.normalize().multiplyScalar(AHEAD).add(this.camera.position);
    return { x: _ahead.x, y: this.camera.position.y + height, z: _ahead.z };
  }

  /**
   * Stand a line at a place, facing where the reader is at this instant, and
   * leave it there. Both the position and the facing are set once: turning
   * afterwards must not move a single vertex of it.
   */
  _stand(mesh, at) {
    mesh.position.set(at.x, at.y, at.z);
    mesh.lookAt(this.camera.position.x, at.y, this.camera.position.z);
    this.group.add(mesh);
  }

  /**
   * The line for the mode just entered. Written in front of you as you arrive,
   * held long enough to read twice, then faded, so the sky is empty by the
   * time you are actually playing.
   */
  say(text, seconds = 14) {
    if (this.instruction) this.group.remove(this.instruction);
    this.instruction = textPlane(text, { size: 74, opacity: 0, italic: true });
    this._stand(this.instruction, this._ahead(INSTRUCTION_HEIGHT));
    this.instructionUntil = this.elapsed + seconds;
  }

  /**
   * A sign, not narration: it is written at one place in the world and stays
   * there until something replaces it. Each level of Pulse hangs one out along
   * the run it belongs to.
   */
  pin(text, position, { height = 5.5, size = 62, scale = 0.38 } = {}) {
    this.unpin();
    this.sign = textPlane(text, { size, opacity: 0, italic: true });
    // Small: a pinned line is read from one place at one distance, so it can
    // be sized for that. A line written ahead of a walker has to be huge
    // because it might be read from anywhere.
    this.sign.scale.setScalar(scale);
    this._stand(this.sign, { x: position.x, y: position.y + height, z: position.z });
    return this.sign;
  }

  unpin() {
    if (!this.sign) return;
    this.group.remove(this.sign);
    this.sign = null;
  }

  /** Cut it short: the player has clearly understood. */
  dismiss() {
    this.instructionUntil = Math.min(this.instructionUntil, this.elapsed + 1.2);
  }

  /**
   * Say something once, briefly, then never again. Used to mark the moment the
   * song is whole, which otherwise passes without acknowledgement.
   */
  announce(text, seconds = 5) {
    if (this.announcement) this.group.remove(this.announcement);
    this.announcement = textPlane(text, { size: 58, opacity: 0, italic: true });
    this.announcement.scale.setScalar(0.7);
    this._stand(this.announcement, this._ahead(ANNOUNCE_HEIGHT));
    this.announceUntil = this.elapsed + seconds;
  }

  /** Only opacity changes here. Nothing written ever moves. */
  update(dt) {
    this.elapsed += dt;

    const fade = (mesh, held, full) => {
      const material = mesh.material;
      const target = held ? full : 0;
      material.opacity += (target - material.opacity) * Math.min(1, dt * 1.4);
      return material.opacity > 0.01 || target > 0;
    };

    if (this.instruction
        && !fade(this.instruction, this.elapsed < this.instructionUntil, 0.5)) {
      this.group.remove(this.instruction);
      this.instruction = null;
    }

    if (this.announcement
        && !fade(this.announcement, this.elapsed < this.announceUntil, 0.48)) {
      this.group.remove(this.announcement);
      this.announcement = null;
    }

    // A sign has no timer: it fades up once and then simply is there.
    if (this.sign) fade(this.sign, true, 0.46);
  }
}
