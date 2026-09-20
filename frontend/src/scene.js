/**
 * Renderer, camera and a body to walk with.
 *
 * Deliberately NOT using PointerLockControls: pointer lock is refused inside
 * iframes and in some embedded browsers, and when it fails the whole piece is
 * dead. Here look works either way, captured (pointer lock) or dragged, and the
 * movement maths is identical in both modes.
 */
import * as THREE from 'three';

const WALK_SPEED = 9.0;
const DAMPING = 8.0;
const EYE_HEIGHT = 1.7;
const WORLD_LIMIT = 70;
const LOOK_SENSITIVITY = 0.0023;
const PITCH_LIMIT = Math.PI / 2 - 0.05;

const UP = new THREE.Vector3(0, 1, 0);

export class Stage extends EventTarget {
  constructor(canvas) {
    super();
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      68, window.innerWidth / window.innerHeight, 0.1, 1000
    );
    this.camera.position.set(0, EYE_HEIGHT, 0);

    this.yaw = 0;
    this.pitch = 0;
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.velocity = new THREE.Vector3();
    this.move = new THREE.Vector3();
    this.keys = new Set();
    this.clock = new THREE.Clock();
    this.active = false;
    this.dragging = false;
    this.captured = false;

    this._bindInput();
    window.addEventListener('resize', () => this.resize());
  }

  _bindInput() {
    const canvas = this.canvas;

    document.addEventListener('keydown', (event) => {
      this.keys.add(event.code);
      if (event.code === 'Escape' && this.active && !this.captured) this.exit();
    });
    document.addEventListener('keyup', (event) => this.keys.delete(event.code));

    document.addEventListener('pointerlockchange', () => {
      this.captured = document.pointerLockElement === canvas;
      if (!this.captured && this.active) this.exit();
    });

    canvas.addEventListener('mousedown', () => {
      if (this.active && !this.captured) this.dragging = true;
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });

    window.addEventListener('mousemove', (event) => {
      if (!this.active) return;
      if (!this.captured && !this.dragging) return;
      this.yaw -= event.movementX * LOOK_SENSITIVITY;
      this.pitch -= event.movementY * LOOK_SENSITIVITY;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    });

    // Touch: one finger looks, so the world is at least explorable on a tablet.
    let lastTouch = null;
    canvas.addEventListener('touchstart', (e) => {
      lastTouch = e.touches[0];
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (!this.active || !lastTouch) return;
      const touch = e.touches[0];
      this.yaw -= (touch.clientX - lastTouch.clientX) * LOOK_SENSITIVITY * 1.6;
      this.pitch -= (touch.clientY - lastTouch.clientY) * LOOK_SENSITIVITY * 1.6;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
      lastTouch = touch;
    }, { passive: true });
  }

  /** Enter the world. Pointer lock if the browser allows it, drag-look if not. */
  enter() {
    this.active = true;
    try {
      const request = this.canvas.requestPointerLock?.({ unadjustedMovement: false });
      if (request && typeof request.catch === 'function') request.catch(() => {});
    } catch {
      /* pointer lock refused (iframe, embedded browser): drag-look still works */
    }
    this.dispatchEvent(new Event('enter'));
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.dragging = false;
    this.keys.clear();
    if (document.pointerLockElement) document.exitPointerLock();
    this.dispatchEvent(new Event('exit'));
  }

  /** True when the look controls are captured rather than drag-based. */
  get needsDragHint() {
    return this.active && !this.captured;
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  step(dt) {
    this.euler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(this.euler);

    const forward = this.active
      ? (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
        (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0)
      : 0;
    const strafe = this.active
      ? (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
        (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0)
      : 0;
    const boost = this.keys.has('ShiftLeft') ? 1.8 : 1.0;

    this.move.set(strafe, 0, -forward);
    if (this.move.lengthSq() > 0) {
      this.move.normalize().applyAxisAngle(UP, this.yaw).multiplyScalar(WALK_SPEED * boost);
    }

    // Exponential approach to the target velocity: no jerk on key down or up.
    const blend = 1 - Math.exp(-DAMPING * dt);
    this.velocity.lerp(this.move, blend);
    this.camera.position.addScaledVector(this.velocity, dt);

    const p = this.camera.position;
    p.y = EYE_HEIGHT;
    const distance = Math.hypot(p.x, p.z);
    if (distance > WORLD_LIMIT) {
      p.x *= WORLD_LIMIT / distance;
      p.z *= WORLD_LIMIT / distance;
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
