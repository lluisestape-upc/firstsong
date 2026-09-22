/**
 * Blind: one sound, somewhere. Walk to where you think it is.
 *
 * The world goes dark and silent except for a single stem, moved to somewhere
 * it does not live. You walk to where you believe it is standing and commit.
 * The monument then appears where it actually was, and the distance between
 * the two is your error.
 *
 * This is the piece's own claim turned into a test: if position really is the
 * mix, then a listener can find a source by ear alone. Five rounds is enough
 * to feel yourself getting better at it.
 */
import * as THREE from 'three';

const ROUNDS = 5;
const MIN_RADIUS = 9;
const MAX_RADIUS = 24;
const REVEAL_SECONDS = 3.2;

export class BlindGame {
  constructor({ stage, mix, monuments, sky, pad, trail }) {
    this.stage = stage;
    this.mix = mix;
    this.monuments = monuments;
    this.sky = sky;
    this.pad = pad;
    this.trail = trail;

    this.active = false;
    this.round = 0;
    this.errors = [];
    this.target = null;
    this.truth = new THREE.Vector3();
    this.revealing = 0;
    this.onRound = () => {};
  }

  _stemFor(monument) {
    return this.mix.stems.find((s) => s.spec.name === monument.spec.name);
  }

  _hideAll() {
    for (const monument of this.monuments) {
      monument.group.visible = false;
      this.mix.setStemMuted(this._stemFor(monument), true, 0.2);
    }
  }

  start() {
    this.active = true;
    this.round = 0;
    this.errors = [];
    // Remember where everything lives so the world can be handed back intact.
    this.home = this.monuments.map((m) => ({
      monument: m, position: [...m.spec.position],
    }));
    this.trail?.clear();
    this._nextRound();
  }

  _nextRound() {
    this.revealing = 0;
    this._hideAll();

    if (this.round >= ROUNDS) return this._finish();
    this.round++;

    // A stem we have not used yet this game, so all five get a turn.
    const used = this.errors.map((e) => e.name);
    const pool = this.monuments.filter((m) => !used.includes(m.spec.name));
    this.target = pool[Math.floor(Math.random() * pool.length)] || this.monuments[0];

    const angle = Math.random() * Math.PI * 2;
    const radius = MIN_RADIUS + Math.random() * (MAX_RADIUS - MIN_RADIUS);
    this.truth.set(Math.cos(angle) * radius, 1.5 + Math.random() * 2.0,
                   Math.sin(angle) * radius);

    const stem = this._stemFor(this.target);
    this.mix.setStemPosition(stem, this.truth.x, this.truth.y, this.truth.z);
    this.mix.setStemMuted(stem, false, 0.35);

    this.sky.announce(`${this.round} of ${ROUNDS}`, 2.6);
    this.onRound('start', this.round);
  }

  /** The player commits to a spot. Returns the error in metres. */
  guess() {
    if (!this.active || !this.target || this.revealing > 0) return null;

    const here = this.stage.camera.position;
    const error = Math.hypot(here.x - this.truth.x, here.z - this.truth.z);
    this.errors.push({ name: this.target.spec.name, error });

    // Show where it really was.
    this.target.group.visible = true;
    this.target.setPosition(this.truth.x, this.truth.y, this.truth.z);
    this.revealing = REVEAL_SECONDS;

    const verdict = error < 3 ? 'right there'
      : error < 7 ? 'close'
      : error < 14 ? 'not quite'
      : 'nowhere near';
    this.sky.announce(`${verdict} · ${error.toFixed(1)} m`, REVEAL_SECONDS);
    this.onRound('guess', error);
    return error;
  }

  _finish() {
    this.active = false;
    const total = this.errors.reduce((sum, e) => sum + e.error, 0);
    const average = total / Math.max(this.errors.length, 1);

    // Hand the world back exactly as it was found.
    for (const { monument, position } of this.home) {
      monument.group.visible = true;
      monument.setPosition(...position);
      monument.spec.position = [...position];
      const stem = this._stemFor(monument);
      this.mix.setStemPosition(stem, ...position);
      this.mix.setStemMuted(stem, false, 1.2);
    }

    this.sky.announce(`${average.toFixed(1)} m off, on average`, 7);
    this.onRound('finish', average);
    return average;
  }

  update(dt) {
    if (!this.active || this.revealing <= 0) return;
    this.revealing -= dt;
    if (this.revealing <= 0) this._nextRound();
  }
}
