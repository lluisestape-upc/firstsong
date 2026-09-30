/**
 * Renderer, camera and a body to walk with.
 *
 * Deliberately NOT using PointerLockControls: pointer lock is refused inside
 * iframes and in some embedded browsers, and when it fails the whole piece is
 * dead. Here look works either way, captured (pointer lock) or dragged, and the
 * movement maths is identical in both modes.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const WALK_SPEED = 9.0;
const DAMPING = 8.0;
const EYE_HEIGHT = 1.7;
const WORLD_LIMIT = 70;
const JUMP_SPEED = 5.2;
const GRAVITY = 14.0;
// Radians per pixel of mouse travel. Raw input (no OS acceleration) makes
// this the same on every machine; - and = scale it for a particular mouse.
const LOOK_SENSITIVITY = 0.0012;
const SENSITIVITY_KEY = 'unwrapped.look';
// Chrome on Windows occasionally reports one pointer-locked move of several
// hundred pixels that never happened; a real flick is spread over frames.
const MAX_MOVE = 120;

function storedScale() {
  try { return Number(localStorage.getItem(SENSITIVITY_KEY)) || 1; } catch { return 1; }
}
const PITCH_LIMIT = Math.PI / 2 - 0.05;
// A rise this small is walked up rather than fallen off. It has to stay well
// under the step between two platforms on a course, or you could walk the
// whole climb without ever jumping.
const STEP_UP = 0.3;
const STEP_DOWN = 0.3;

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
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      68, window.innerWidth / window.innerHeight, 0.1, 1000
    );
    this.camera.position.set(0, EYE_HEIGHT, 0);

    // Bloom on the bright things only: the sun, lit pucks, fireflies. The
    // landscape sets how much, and the song's loudness moves it a little.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), 0.3, 0.55, 0.88
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

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
    this.altitude = 0;       // metres the feet stand above the plain
    this.hopVelocity = 0;
    this.airborne = false;

    /**
     * What is underfoot at a point, given where the feet are now. The plain is
     * flat, so the default answer is always zero; Pulse swaps in its course and
     * the same walker suddenly has platforms to miss.
     */
    this.groundAt = () => 0;
    /** How much of a jump the world is willing to give. Pulse reads the beat. */
    this.jumpPower = () => 1;
    this.lookScale = storedScale();

    this._bindInput();
    window.addEventListener('resize', () => this.resize());
  }

  _bindInput() {
    const canvas = this.canvas;

    document.addEventListener('keydown', (event) => {
      if (event.repeat) return;
      this.keys.add(event.code);
      if (!this.active) return;
      if (event.code === 'Escape' && !this.captured) this.exit();
      if (event.code === 'KeyE') this.dispatchEvent(new Event('takeOrPlace'));
      if (event.code === 'KeyQ') this.dispatchEvent(new Event('hushOrWake'));
      if (event.code === 'KeyF') this.dispatchEvent(new Event('soloStart'));
      if (event.code === 'Space') this.jump(this.jumpPower());
      if (event.code === 'KeyR') this.dispatchEvent(new Event('replay'));
      if (event.code === 'Enter') this.dispatchEvent(new Event('inspect'));
      if (event.code === 'KeyL') this.dispatchEvent(new Event('landscape'));
      if (event.code === 'KeyT') this.dispatchEvent(new Event('trailer'));
      if (event.code === 'KeyM') this.dispatchEvent(new Event('mission'));
      if (event.code === 'Minus' || event.code === 'Equal') {
        const factor = event.code === 'Minus' ? 1 / 1.25 : 1.25;
        this.lookScale = Math.min(4, Math.max(0.25, this.lookScale * factor));
        try { localStorage.setItem(SENSITIVITY_KEY, String(this.lookScale)); } catch { /* fine */ }
        this.dispatchEvent(new CustomEvent('sensitivity', { detail: this.lookScale }));
      }
    });
    document.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
      if (event.code === 'KeyF') this.dispatchEvent(new Event('soloEnd'));
    });

    document.addEventListener('pointerlockchange', () => {
      this.captured = document.pointerLockElement === canvas;
      if (!this.captured && this.active) this.exit();
    });

    canvas.addEventListener('mousedown', (event) => {
      if (!this.active) return;
      // Captured pointer: clicks are interaction. Drag-look mode: the left
      // button is already steering, so only the right button interacts.
      if (this.captured) {
        if (event.button === 0) this.dispatchEvent(new Event('takeOrPlace'));
        if (event.button === 2) this.dispatchEvent(new Event('hushOrWake'));
      } else if (event.button === 2) {
        this.dispatchEvent(new Event('takeOrPlace'));
      } else {
        this.dragging = true;
      }
    });
    canvas.addEventListener('contextmenu', (event) => {
      if (this.active) event.preventDefault();
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });

    window.addEventListener('mousemove', (event) => {
      if (!this.active) return;
      if (!this.captured && !this.dragging) return;
      const dx = event.movementX;
      const dy = event.movementY;
      if (Math.abs(dx) > MAX_MOVE || Math.abs(dy) > MAX_MOVE) return;
      const k = LOOK_SENSITIVITY * this.lookScale;
      this.yaw -= dx * k;
      this.pitch -= dy * k;
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
      this.yaw -= (touch.clientX - lastTouch.clientX) * LOOK_SENSITIVITY * 3;
      this.pitch -= (touch.clientY - lastTouch.clientY) * LOOK_SENSITIVITY * 3;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
      lastTouch = touch;
    }, { passive: true });
  }

  /**
   * `power` scales the launch. In Pulse an off-beat jump is worth about six
   * tenths of one, which is not enough height to reach the next platform: the
   * gate on the course is the song, not the geometry.
   */
  jump(power = 1) {
    if (!this.active || this.airborne) return 0;
    this.hopVelocity = JUMP_SPEED * power;
    this.airborne = true;
    this.dispatchEvent(new CustomEvent('launch', { detail: { power } }));
    return power;
  }

  /** Enter the world. Pointer lock if the browser allows it, drag-look if not. */
  enter() {
    this.active = true;
    try {
      // Raw mouse input where the browser offers it: without it Windows
      // acceleration turns a small quick move into a huge turn.
      const request = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
      if (request && typeof request.catch === 'function') {
        request.catch(() => {
          try { this.canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* drag-look */ }
        });
      }
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
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  setBloom(strength) {
    this.bloom.strength = strength;
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

    // Vertical. On the plain this is just a hop; on a course it is everything.
    if (this.airborne) {
      const was = this.altitude;
      this.hopVelocity -= GRAVITY * dt;
      this.altitude += this.hopVelocity * dt;
      // Only ever land on something that was at or below the feet already, so
      // a jump passes up through a platform instead of sticking to it.
      const floor = this.groundAt(p.x, p.z, was);
      if (this.hopVelocity <= 0 && this.altitude <= floor) {
        this.altitude = floor;
        this.hopVelocity = 0;
        this.airborne = false;
        this.dispatchEvent(new CustomEvent('land', {
          detail: { altitude: floor },
        }));
      }
    } else {
      const floor = this.groundAt(p.x, p.z, this.altitude);
      if (floor > this.altitude + STEP_UP) {
        // Something overhead, not underfoot: keep walking beneath it.
      } else if (floor < this.altitude - STEP_DOWN) {
        this.airborne = true;              // walked off an edge
        this.hopVelocity = 0;
      } else {
        this.altitude = floor;
      }
    }

    p.y = EYE_HEIGHT + this.altitude;
    const distance = Math.hypot(p.x, p.z);
    if (distance > WORLD_LIMIT) {
      p.x *= WORLD_LIMIT / distance;
      p.z *= WORLD_LIMIT / distance;
    }
  }

  /** Put the walker down at a point, standing still. Used by Pulse respawns. */
  placeAt(x, altitude, z) {
    this.camera.position.set(x, EYE_HEIGHT + altitude, z);
    this.altitude = altitude;
    this.hopVelocity = 0;
    this.airborne = false;
    this.velocity.set(0, 0, 0);
  }

  render() {
    this.composer.render();
  }
}
