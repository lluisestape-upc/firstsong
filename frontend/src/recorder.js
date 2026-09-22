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
    this.onState = () => {};
  }

  get seconds() {
    return this.samples.length ? this.samples[this.samples.length - 1].t : 0;
  }

  /** Call every frame while the player is walking. */
  record(dt, songTime) {
    if (this.playing) return;
    this.since += dt;
    if (this.since < INTERVAL) return;
    this.since = 0;

    const { camera, yaw, pitch } = this.stage;
    if (this.samples.length === 0) this.startedAtSongTime = songTime;
    this.samples.push({
      t: songTime - this.startedAtSongTime,
      x: camera.position.x, z: camera.position.z, yaw, pitch,
    });

    while (this.seconds > MAX_SECONDS) this.samples.shift();
  }

  /** Replay the recorded route. The player's input is ignored until it ends. */
  play() {
    if (this.samples.length < 8) return false;
    this.playing = true;
    this.playhead = 0;
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
