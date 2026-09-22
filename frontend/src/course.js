/**
 * Pulse: a platform course you can only cross in time with the song.
 *
 * A spiral of small discs climbing away from the centre. The gap between two
 * of them is easy; the step up between them is not. A jump launched on the
 * beat has the height to make it and a jump launched off the beat does not, so
 * the thing keeping you in the air is the drumming, not the joystick.
 *
 * The course comes in segments. Finish one and a stem comes back into the
 * song, so the music is literally built out of the climb: level one is a
 * drummer alone, and by the top the whole band is playing under you.
 *
 * The whole spiral flashes on every beat. That is the only teaching the mode
 * does: you watch it blink, you jump with the blink.
 */
import * as THREE from 'three';

/*
 * The numbers are the game. A full jump rises 0.97 m and carries about 5.4 m
 * from where it left the deck; an off-beat one rises a quarter of a metre,
 * which is under the step up to the next platform, so it cannot land there at
 * any distance or any run-up. What gates the course is height, and height is
 * the beat: the window works out at about a tenth of a second either side.
 *
 * So the timing is the hard part and the aim is not. The discs are wide and
 * the gap is set so that a jump launched from anywhere across most of one
 * comes down on the next.
 *
 * The whole thing starts above head height and climbs from there. It has to
 * clear the monuments — a platform inside one is a landing you cannot see —
 * and it should not climb so far that the song it is assembling goes quiet
 * underneath you.
 */
const RADIUS = 2.4;         // how forgiving a landing is
const THICKNESS = 0.3;
const GAP = 6.4;            // metres between platform centres
const RISE = 0.4;           // the step up that only a jump on the beat clears
// Enough to absorb rounding while standing, and no more: any larger and it
// becomes a landing assist that quietly hands you platforms you never reached.
const SUPPORT = 0.05;
const GROW = 0.35;          // how much further out each platform sits
const FIRST_RADIUS = 13;
const BASE_HEIGHT = 5.5;    // over the tallest monument, under the sky
const FLASH_WINDOW = 0.12;  // seconds either side of a beat that the discs lit

export class Course {
  constructor(scene, colour = '#e8e2d2') {
    this.scene = scene;
    this.colour = new THREE.Color(colour);
    this.group = new THREE.Group();
    scene.add(this.group);

    this.platforms = [];
    this.level = 0;
    this.reached = 0;         // highest platform index landed on
    this.angle = 0;
    this.radius = FIRST_RADIUS;
    this.base = BASE_HEIGHT;
    this.active = false;

    // One light, carried to whichever platform is next. Twenty-five lights
    // would look the same and cost a great deal more.
    this.light = new THREE.PointLight(this.colour, 0, 22, 2);
    this.group.add(this.light);
  }

  get goal() {
    return this.platforms[this.platforms.length - 1] || null;
  }

  /** The platform to aim at next, or the last one once the course is done. */
  get target() {
    return this.platforms[Math.min(this.reached + 1, this.platforms.length - 1)];
  }

  /**
   * Where a level's line should hang: out along the run, high enough to read
   * at a glance from the platform it belongs to and clear of the jump itself.
   * It is a place in the world, not a position relative to anybody's head.
   */
  signSpotFor(platform) {
    const next = this.platforms[platform.index + 1] || platform;
    const dx = next.x - platform.x;
    const dz = next.z - platform.z;
    const length = Math.hypot(dx, dz) || 1;
    return {
      x: platform.x + (dx / length) * 20,
      y: platform.h + 5,
      z: platform.z + (dz / length) * 20,
    };
  }

  /** Where a fall puts you back: the last disc you actually stood on. */
  get checkpoint() {
    return this.platforms[this.reached] || this.platforms[0];
  }

  _add() {
    const index = this.platforms.length;
    const x = Math.cos(this.angle) * this.radius;
    const z = Math.sin(this.angle) * this.radius;
    const h = this.base + index * RISE;

    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(RADIUS, RADIUS * 0.82, THICKNESS, 40),
      new THREE.MeshStandardMaterial({
        color: this.colour,
        emissive: this.colour,
        emissiveIntensity: 0.1,
        roughness: 0.6,
        metalness: 0.1,
      })
    );
    mesh.position.set(x, h - THICKNESS / 2, z);
    this.group.add(mesh);

    // A ring on the deck, so the edge is readable from above while falling
    // towards it, which is the only angle that matters.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(RADIUS - 0.18, RADIUS, 48),
      new THREE.MeshBasicMaterial({
        color: this.colour, transparent: true, opacity: 0.4,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, h + 0.02, z);
    this.group.add(ring);

    // Keep the spacing even as the spiral widens: the angle each platform
    // advances has to shrink as the radius grows, or the gaps would stretch.
    this.angle += GAP / this.radius;
    this.radius += GROW;

    const platform = { index, x, z, h, mesh, ring, level: this.level };
    this.platforms.push(platform);
    return platform;
  }

  /**
   * Build the first disc and the first segment. `floor` is how high the first
   * one has to sit, which the caller works out from the tallest monument: a
   * platform buried inside one is a landing nobody can see coming.
   */
  start(floor = BASE_HEIGHT) {
    this.clear();
    this.active = true;
    this.level = 1;
    this.reached = 0;
    this.angle = Math.random() * Math.PI * 2;
    this.radius = FIRST_RADIUS;
    this.base = Math.max(BASE_HEIGHT, floor);
    this._add();                            // the one you are set down on
    return this.extend();
  }

  /**
   * Add the next segment, each one a disc longer than the last. Returns the
   * platform the segment starts from, which is where its sign hangs.
   */
  extend() {
    const from = this.goal;
    // Two crossings at first, four by the end: long enough to feel the rhythm
    // settle, short enough that the climb stays inside the song.
    const count = 2 + Math.floor(this.level / 2);
    for (let i = 0; i < count; i++) this._add();
    return from;
  }

  /** Called on finishing a segment. Returns false when there is no more room. */
  nextLevel(maxLevels) {
    if (this.level >= maxLevels) {
      this.active = false;
      return false;
    }
    this.level++;
    this.extend();
    return true;
  }

  /**
   * What is underfoot at a point. `feet` is where the feet already are, so a
   * platform overhead is not mistaken for a floor.
   */
  heightAt(x, z, feet = Infinity) {
    let best = 0;
    for (const p of this.platforms) {
      if (p.h > feet + SUPPORT || p.h <= best) continue;
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz > RADIUS * RADIUS) continue;
      best = p.h;
    }
    return best;
  }

  /**
   * Work out what a landing meant.
   *   'level'  the last disc of the segment: a stem comes back
   *   'step'   further along than you had got before
   *   'again'  a disc you had already reached
   *   'ground' the plain, which means you fell
   */
  landed(x, z, altitude) {
    if (!this.active && !this.platforms.length) return { kind: 'none' };

    let on = null;
    for (const p of this.platforms) {
      if (Math.abs(p.h - altitude) > 0.3) continue;
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz > RADIUS * RADIUS) continue;
      if (!on || p.h > on.h) on = p;
    }
    if (!on) return { kind: altitude < 0.2 ? 'ground' : 'none' };

    if (on.index <= this.reached) return { kind: 'again', platform: on };
    this.reached = on.index;
    const finished = on.index === this.platforms.length - 1;
    return { kind: finished ? 'level' : 'step', platform: on };
  }

  /**
   * `phase` is how far the song is from a beat, in seconds. Every disc lights
   * up together on it; the one you are meant to reach next lights up more.
   */
  update(dt, phase) {
    if (!this.platforms.length) return;
    const flash = phase === null
      ? 0 : Math.max(0, 1 - Math.abs(phase) / FLASH_WINDOW);
    const target = this.target;

    for (const p of this.platforms) {
      const done = p.index <= this.reached;
      const aimed = target && p.index === target.index;
      const base = done ? 0.06 : 0.14;
      const lit = base + flash * (aimed ? 0.9 : 0.28);
      const material = p.mesh.material;
      material.emissiveIntensity += (lit - material.emissiveIntensity)
        * Math.min(1, dt * 12);
      p.ring.material.opacity = (aimed ? 0.5 : 0.22) + flash * (aimed ? 0.45 : 0.1);
    }

    if (target) {
      this.light.position.set(target.x, target.h + 1.2, target.z);
      this.light.intensity = 3 + flash * 9;
    } else {
      this.light.intensity = 0;
    }
  }

  clear() {
    for (const p of this.platforms) {
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      p.ring.geometry.dispose();
      p.ring.material.dispose();
      this.group.remove(p.mesh);
      this.group.remove(p.ring);
    }
    this.platforms = [];
    this.level = 0;
    this.reached = 0;
    this.active = false;
    this.light.intensity = 0;
  }
}
