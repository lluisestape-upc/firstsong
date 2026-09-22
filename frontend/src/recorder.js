/**
 * Mechanic 4. Play your walk back as a mix.
 *
 * The trail already draws where you went. This makes it audible: the route is
 * replayed with the song restarted from where the walk began, so the thing you
 * hear is the mix your own movement made. That is the artifact the piece
 * produces, and it is different for everybody.
 */
import * as THREE from 'three';

const INTERVAL = 0.08;        // seconds between samples
const MAX_SECONDS = 180;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class Recorder {
  constructor(stage) {
    this.stage = stage;
    this.samples = [];        // { t, x, z, yaw, pitch }
    this.since = 0;
    this.playing = false;
    this.playhead = 0;
    this.startedAtSongTime = 0;
    this.clock = 0;
    this.onState = () => {};
  }

  /** Forget the walk so far. Entering Echo starts a fresh recording. */
  clear() {
    this.stop();
    this.samples = [];
    this.since = 0;
  }

  /** Where in the track this walk began, so a replay can hear the same music. */
  get songStart() {
    if (!this.samples.length) return 0;
    return this.startedAtSongTime + this.samples[0].t;
  }

  /** How much walking is held right now, oldest sample to newest. */
  get seconds() {
    if (this.samples.length < 2) return 0;
    return this.samples[this.samples.length - 1].t - this.samples[0].t;
  }

  /** Call every frame while the player is walking. */
  record(dt, songTime) {
    // Only what was walked counts. Standing in the menu is not a walk, and a
    // stationary stretch recorded there would replay as a stare at nothing.
    if (this.playing || !this.stage.active) return;

    // The clock is wall time, not song time: the track loops, and a walk that
    // crosses the seam would otherwise jump backwards mid-recording.
    if (this.samples.length === 0) {
      this.clock = 0;
      this.startedAtSongTime = songTime;
    } else {
      this.clock += dt;
    }

    this.since += dt;
    if (this.since < INTERVAL) return;
    this.since = 0;

    const { camera, yaw, pitch } = this.stage;
    this.samples.push({
      t: this.clock,
      x: camera.position.x, z: camera.position.z, yaw, pitch,
    });

    while (this.seconds > MAX_SECONDS) this.samples.shift();
  }

  /** Replay the recorded route. The player's input is ignored until it ends. */
  play() {
    if (this.samples.length < 8) return false;
    this.playing = true;
    // Start at the oldest sample still held, not at zero: on a long walk the
    // front of the recording has been dropped and t no longer starts there.
    this.playhead = this.samples[0].t;
    this.onState('play', this.seconds);
    return true;
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    this.onState('stop', 0);
  }

  /** Returns true while it is driving the camera, so the caller skips input. */
  update(dt) {
    if (!this.playing) return false;
    this.playhead += dt;

    const last = this.samples[this.samples.length - 1];
    if (this.playhead >= last.t) {
      this.stop();
      return false;
    }

    // Find the pair straddling the playhead and ease between them.
    let i = 1;
    while (i < this.samples.length && this.samples[i].t < this.playhead) i++;
    const b = this.samples[i];
    const a = this.samples[i - 1];
    const span = Math.max(1e-4, b.t - a.t);
    const k = (this.playhead - a.t) / span;

    _a.set(a.x, this.stage.camera.position.y, a.z);
    _b.set(b.x, this.stage.camera.position.y, b.z);
    this.stage.camera.position.copy(_a.lerp(_b, k));

    // Shortest way round for the yaw, or it spins the long way at the seam.
    let dyaw = b.yaw - a.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    this.stage.yaw = a.yaw + dyaw * k;
    this.stage.pitch = a.pitch + (b.pitch - a.pitch) * k;
    return true;
  }
}
