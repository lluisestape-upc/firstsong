/**
 * What you can do to the world, beyond walking through it.
 *
 *   take / place   Pick a monument up and set it down somewhere else. Its
 *                  sound source travels with it, so rearranging the world
 *                  rearranges the mix. If position is the mix, then moving the
 *                  sources is composing.
 *   hush / wake    Silence a monument. It dims and stops breathing.
 *
 * Deliberately unlabelled. Nothing in the world explains what a monument is or
 * why it looks the way it does; you find out by handling it.
 */
import * as THREE from 'three';

const REACH = 7.0;          // how close you must be to touch a monument
const FACING = 0.25;        // dot(forward, toMonument): generous, not a laser
const CARRY_AHEAD = 3.4;    // how far in front a carried monument floats
const CARRY_BELOW = 0.55;   // and how far below eye level

const _toward = new THREE.Vector3();
const _forward = new THREE.Vector3();

export class Interaction {
  constructor(stage, mix, monuments) {
    this.stage = stage;
    this.mix = mix;
    this.monuments = monuments;
    this.byName = new Map(mix.stems.map((s) => [s.spec.name, s]));
    this.carrying = null;
    this.focus = null;
    this.soloing = null;
    // The arrangement the world was built with, so it can always be restored.
    this.original = monuments.map((m) => ({
      name: m.spec.name, position: [...m.spec.position],
    }));
    this.onChange = () => {};
  }

  /** True once anything has been moved or hushed: what the pad can undo. */
  get dirty() {
    if (this.carrying) return true;
    return this.monuments.some((m, i) => {
      if (m.hushed) return true;
      const from = this.original[i].position;
      const p = m.spec.position;
      return Math.hypot(p[0] - from[0], p[2] - from[2]) > 0.25;
    });
  }

  stemFor(monument) {
    return this.byName.get(monument.spec.name);
  }

  /** The monument you are close to and roughly looking at, or null. */
  nearest() {
    const camera = this.stage.camera;
    camera.getWorldDirection(_forward);
    let best = null;
    let bestScore = -Infinity;

    for (const monument of this.monuments) {
      if (monument === this.carrying) continue;
      _toward.copy(monument.group.position).sub(camera.position);
      const distance = _toward.length();
      if (distance > REACH) continue;
      _toward.normalize();
      const facing = _toward.dot(_forward);
      if (facing < FACING) continue;

      // Prefer what is closest, then what is most directly in front.
      const score = facing - distance / REACH;
      if (score > bestScore) {
        bestScore = score;
        best = monument;
      }
    }
    return best;
  }

  /** Mechanic 1. Take what you are looking at, or set down what you hold. */
  takeOrPlace() {
    if (this.carrying) return this.place();
    const target = this.nearest();
    if (!target) return null;

    this.carrying = target;
    target.carried = true;
    this.onChange('take', target);
    return target;
  }

  place() {
    const monument = this.carrying;
    if (!monument) return null;

    const p = monument.group.position;
    monument.carried = false;
    monument.setPosition(p.x, Math.max(0.6, p.y), p.z);
    monument.spec.position = [p.x, monument.baseY, p.z];
    this.mix.setStemPosition(this.stemFor(monument), p.x, monument.baseY, p.z);

    this.carrying = null;
    this.onChange('place', monument);
    return monument;
  }

  /** Mechanic 2. Silence what you are looking at, or wake it again. */
  hushOrWake() {
    const target = this.carrying || this.nearest();
    if (!target) return null;
    const stem = this.stemFor(target);
    target.hushed = this.mix.toggleStemMuted(stem);
    this.onChange(target.hushed ? 'hush' : 'wake', target);
    return target;
  }

  /** Mechanic 4. Hold to hear one monument on its own. */
  startSolo() {
    const target = this.carrying || this.nearest();
    if (!target) return null;
    this.soloing = target;
    this.mix.soloStem(this.stemFor(target));
    this.onChange('solo', target);
    return target;
  }

  endSolo() {
    if (!this.soloing) return;
    const was = this.soloing;
    this.soloing = null;
    this.mix.soloStem(null);
    this.onChange('unsolo', was);
  }

  /** Mechanic 5. Put the world back the way it was found. */
  reset() {
    if (this.carrying) {
      this.carrying.carried = false;
      this.carrying = null;
    }
    this.endSolo();

    for (const monument of this.monuments) {
      const from = this.original.find((o) => o.name === monument.spec.name);
      if (!from) continue;
      const [x, y, z] = from.position;
      monument.setPosition(x, y, z);
      monument.spec.position = [x, y, z];
      monument.hushed = false;
      this.mix.setStemMuted(this.stemFor(monument), false);
    }
    this.mix.resetPositions(this.original);
    this.onChange('reset', null);
  }

  /** Call once per frame, after the camera has moved. */
  update() {
    this.focus = this.carrying ? null : this.nearest();

    const held = this.carrying;
    if (!held) return;

    const camera = this.stage.camera;
    camera.getWorldDirection(_forward);
    const x = camera.position.x + _forward.x * CARRY_AHEAD;
    const y = camera.position.y + _forward.y * CARRY_AHEAD - CARRY_BELOW;
    const z = camera.position.z + _forward.z * CARRY_AHEAD;

    held.group.position.set(x, y, z);
    held.halo.position.y = -y + 0.02;
    this.mix.setStemPosition(this.stemFor(held), x, y, z);
  }
}
