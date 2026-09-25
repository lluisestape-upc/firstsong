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
const WAKE_RADIUS = 9.5;    // how close a sleeping monument wakes on its own
const WAKE_SWELL = 1.6;     // seconds for a layer to arrive, not switch on
const FACING = 0.25;        // dot(forward, toMonument): generous, not a laser
const CARRY_AHEAD = 3.4;    // how far in front a carried monument floats
const CARRY_BELOW = 0.55;   // and how far below eye level
const RETURN_SECONDS = 1.25; // how long a monument takes to fly home
const RETURN_ARC = 0.26;    // apex of the arc, as a fraction of the distance

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
    this.sleeping = new Set();
    // Monuments currently flying back to where they started.
    this.returning = [];
    // Pulse mode turns this off: there a sleeping layer is earned by landing
    // on the beat, not by walking up to it.
    this.wakeOnApproach = true;
    this.onChange = () => {};
  }

  /**
   * Put the song to sleep except for one layer, so that walking around is what
   * assembles it. A judge with ninety seconds needs a reason to keep moving,
   * and the reason should be the music rather than a prompt on screen.
   *
   * Nothing has to be pressed: a monument wakes when you come near it. There
   * is no way to get this wrong and nothing to explain.
   */
  beginAsleep(prefer = null) {
    // The stem that carries most of the track stays audible, so the world
    // sounds like music from the first second rather than like silence.
    // Pulse asks for the drums instead: you cannot jump in time to a song
    // that has no pulse left in it.
    const seed = this.monuments.find((m) => m.spec.name === prefer)
      || this.monuments.reduce((best, m) =>
        (m.spec.features?.presence ?? 0) > (best.spec.features?.presence ?? 0) ? m : best
      );

    for (const monument of this.monuments) {
      if (monument === seed) {
        // Re-entering a mode can pick a seed that the last one had asleep.
        this.sleeping.delete(monument.spec.name);
        monument.hushed = false;
        this.mix.setStemMuted(this.stemFor(monument), false, 0.3);
        continue;
      }
      this.sleeping.add(monument.spec.name);
      monument.hushed = true;
      monument.dim = 1;                       // asleep from the very first frame
      this.mix.setStemMuted(this.stemFor(monument), true, 0.01);
    }
    this.onChange('sleep', seed);
    return seed;
  }

  get assembled() {
    return this.sleeping.size === 0;
  }

  /** Bring one sleeping monument back into the song. */
  wake(monument, seconds = WAKE_SWELL) {
    if (!this.sleeping.delete(monument.spec.name)) return null;
    monument.hushed = false;
    // A long ramp: the layer arrives, it does not click on.
    this.mix.setStemMuted(this.stemFor(monument), false, seconds);
    this.onChange(this.assembled ? 'assembled' : 'discovered', monument);
    return monument;
  }

  /**
   * Wake the sleeping monument nearest the player. Pulse mode calls this when
   * a run of jumps has landed on the beat, so the layer you earned arrives
   * from somewhere you can see rather than from nowhere.
   */
  wakeOne() {
    if (!this.sleeping.size) return null;
    const position = this.stage.camera.position;
    let best = null;
    let bestDistance = Infinity;
    for (const monument of this.monuments) {
      if (!this.sleeping.has(monument.spec.name)) continue;
      const distance = monument.group.position.distanceTo(position);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = monument;
      }
    }
    return best ? this.wake(best) : null;
  }

  /** Hand the whole song back at once. Wander and Echo begin from whole. */
  wakeAll(seconds = 1.0) {
    // Silently: being handed the song is not the same as assembling it, and
    // the sky should not congratulate anyone for picking a mode.
    const notify = this.onChange;
    this.onChange = () => {};
    for (const monument of this.monuments) this.wake(monument, seconds);
    this.onChange = notify;
  }

  /** Wake whatever the player has wandered close to. */
  _wakeNearby() {
    if (!this.sleeping.size || !this.wakeOnApproach) return;
    const position = this.stage.camera.position;

    for (const monument of this.monuments) {
      if (!this.sleeping.has(monument.spec.name)) continue;
      if (monument.group.position.distanceTo(position) > WAKE_RADIUS) continue;
      this.wake(monument);
    }
  }

  /** True once anything has been moved or hushed: what the pad can undo. */
  get dirty() {
    if (this.carrying) return true;
    return this.monuments.some((m, i) => {
      // Asleep is not "changed": there is nothing yet to put back.
      if (this.sleeping.has(m.spec.name)) return false;
      // Already on its way home: the pad dims the moment it fires.
      if (this.returning.some((r) => r.monument === m)) return false;
      if (m.hushed) return true;
      const from = this.original[i].position;
      const p = m.spec.position;
      return Math.hypot(p[0] - from[0], p[2] - from[2]) > 0.25;
    });
  }

  stemFor(monument) {
    return this.byName.get(monument.spec.name);
  }

  /**
   * Discover starts from silence: every instrument asleep, none spared, and
   * nothing wakes by being walked past. Each one is heard only when asked for.
   */
  sleepAll() {
    for (const monument of this.monuments) {
      this.sleeping.add(monument.spec.name);
      monument.hushed = true;
      monument.dim = 1;
      this.mix.setStemMuted(this.stemFor(monument), true, 0.05);
    }
    this.onChange('sleep', null);
  }

  /** Like nearest(), but a sleeping monument counts: it is what F wakes. */
  nearestAny() {
    return this.nearest(true);
  }

  /** The monument you are close to and roughly looking at, or null. */
  nearest(includeSleeping = false) {
    const camera = this.stage.camera;
    camera.getWorldDirection(_forward);
    let best = null;
    let bestScore = -Infinity;

    for (const monument of this.monuments) {
      if (monument === this.carrying) continue;
      if (!includeSleeping && this.sleeping.has(monument.spec.name)) continue;
      // Nothing in flight can be caught: let it land first.
      if (monument.homing > 0) continue;
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

  /**
   * Mechanic 5. Put the world back the way it was found.
   *
   * Not a snap. Everything that was moved flies home along an arc over a
   * second or so, its sound travelling with it, so you hear your arrangement
   * come apart and the original assemble itself. A snap would undo the mix
   * without ever showing you that it had one.
   */
  reset() {
    if (this.carrying) {
      this.carrying.carried = false;
      this.carrying = null;
    }
    this.endSolo();
    this.returning = [];

    for (const monument of this.monuments) {
      const home = this.original.find((o) => o.name === monument.spec.name);
      if (!home) continue;

      // What is still asleep stays asleep. The pad undoes what you did to the
      // world; it does not hand you the layers you have not found yet, or
      // jumping on it at the start would finish Gather in one go.
      if (this.sleeping.has(monument.spec.name)) continue;

      // Silence ends at once: only the journey is animated.
      monument.hushed = false;
      this.mix.setStemMuted(this.stemFor(monument), false, 0.4);

      const p = monument.group.position;
      const [x, y, z] = home.position;
      const travel = Math.hypot(p.x - x, p.z - z);
      if (travel < 0.05 && Math.abs(p.y - y) < 0.05) {
        monument.homing = 0;
        continue;
      }
      this.returning.push({
        monument,
        from: { x: p.x, y: p.y, z: p.z },
        to: { x, y, z },
        arc: Math.min(6, travel * RETURN_ARC),
        t: 0,
      });
      monument.homing = 1;
    }
    if (!this.returning.length) this.mix.resetPositions(this.original);
    this.onChange('reset', null);
    return this.returning.length;
  }

  /** Advance whatever is flying home. Returns true while any still is. */
  _stepReturns(dt) {
    if (!this.returning.length) return false;

    for (let i = this.returning.length - 1; i >= 0; i--) {
      const flight = this.returning[i];
      flight.t = Math.min(1, flight.t + dt / RETURN_SECONDS);

      // Ease in and out: it leans out of its place, crosses, and settles.
      const t = flight.t;
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const { from, to } = flight;
      const x = from.x + (to.x - from.x) * k;
      const z = from.z + (to.z - from.z) * k;
      const y = from.y + (to.y - from.y) * k + Math.sin(Math.PI * k) * flight.arc;

      const monument = flight.monument;
      monument.setPosition(x, y, z);
      monument.spec.position = [x, y, z];
      monument.homing = 1 - k;
      this.mix.setStemPosition(this.stemFor(monument), x, y, z);

      if (flight.t >= 1) {
        // Land on the exact numbers the manifest was built with, not on
        // whatever the easing happened to arrive at.
        monument.setPosition(to.x, to.y, to.z);
        monument.spec.position = [to.x, to.y, to.z];
        monument.homing = 0;
        this.returning.splice(i, 1);
      }
    }

    if (!this.returning.length) {
      this.mix.resetPositions(this.original);
      this.onChange('home', null);
    }
    return true;
  }

  /** Call once per frame, after the camera has moved. */
  update(dt = 1 / 60) {
    this._stepReturns(dt);
    this._wakeNearby();
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
