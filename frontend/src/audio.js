/**
 * The core of the project: the song is not a stereo file playing at you, it is
 * four mono sources standing in the world. Where you walk is the mix.
 *
 * Every stem: BufferSource -> Gain -> Panner(HRTF) -> Analyser -> master.
 * All sources are started at one shared moment so they stay sample-locked, and
 * looping keeps the world alive for as long as the judge wants to wander.
 */

import { Vector3 } from 'three';
import { Chain } from './fx.js';

const isParam = (x) => x && typeof x === 'object' && 'value' in x;

// Scratch vectors, reused every frame so we do not allocate in the render loop.
const _forward = new Vector3();
const _up = new Vector3();

/**
 * How sharply a stem fades as you walk away from it, and therefore how much
 * approaching one is rewarded. Higher = more contrast between standing on top
 * of a monument and standing between two of them.
 *   1.0  gentle, the whole mix stays present wherever you stand
 *   1.7  approaching a monument clearly favours it            <- default
 *   2.5  strongly local, the far stems drop close to silence
 * Tune live: __firstsong.mix.setRolloff(2.0)
 */
export const DEFAULT_ROLLOFF = 1.7;

function setListener(listener, position, forward, up) {
  if (isParam(listener.positionX)) {
    listener.positionX.value = position.x;
    listener.positionY.value = position.y;
    listener.positionZ.value = position.z;
    listener.forwardX.value = forward.x;
    listener.forwardY.value = forward.y;
    listener.forwardZ.value = forward.z;
    listener.upX.value = up.x;
    listener.upY.value = up.y;
    listener.upZ.value = up.z;
  } else {
    // Safari and older Chrome still want the deprecated setters.
    listener.setPosition(position.x, position.y, position.z);
    listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
  }
}

function writePannerPosition(panner, x, y, z) {
  if (isParam(panner.positionX)) {
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
  } else {
    panner.setPosition(x, y, z);
  }
}

export class SpatialMix {
  constructor(rolloff = DEFAULT_ROLLOFF) {
    this.ctx = null;
    this.stems = [];
    this.playing = false;
    this.startedAt = 0;
    this.rolloff = rolloff;
    this.soloed = null;
    this.paused = false;
  }

  /** Move a stem's source. This is what makes carrying a monument audible. */
  setStemPosition(stem, x, y, z) {
    writePannerPosition(stem.panner, x, y, z);
  }

  /**
   * Silence or wake a stem. Ramped rather than switched: a gain that jumps
   * straight to zero puts a click through the whole mix.
   */
  setStemMuted(stem, muted, seconds = 0.12) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const gain = stem.gain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(muted ? 0.0001 : 1.0, now + seconds);
    stem.muted = muted;
  }

  /**
   * Hold one stem up and duck the rest. This is the piece's whole lesson in
   * three seconds: a song you know, with only the bass left in it.
   * Passing null releases the solo and restores whatever was muted before.
   */
  soloStem(stem, seconds = 0.14) {
    if (!this.ctx) return;
    this.soloed = stem || null;
    for (const other of this.stems) {
      const target = stem
        ? (other === stem ? 1.0 : 0.0001)
        : (other.muted ? 0.0001 : 1.0);
      const gain = other.gain.gain;
      const now = this.ctx.currentTime;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(target, now + seconds);
    }
  }

  /** Put every source back where the manifest first placed it. */
  resetPositions(specs) {
    for (const stem of this.stems) {
      const spec = specs.find((s) => s.name === stem.spec.name);
      if (!spec) continue;
      writePannerPosition(stem.panner, ...spec.position);
      stem.spec.position = [...spec.position];
    }
  }

  toggleStemMuted(stem) {
    this.setStemMuted(stem, !stem.muted);
    return stem.muted;
  }

  /** Change the distance falloff on every stem at once, while playing. */
  setRolloff(value) {
    this.rolloff = value;
    for (const stem of this.stems) stem.panner.rolloffFactor = value;
    return value;
  }

  /** What each stem's panner is currently contributing, for tuning by ear. */
  distances(camera) {
    return this.stems.map((stem) => {
      const [x, y, z] = stem.spec.position;
      const d = Math.hypot(camera.position.x - x, camera.position.y - y,
                           camera.position.z - z);
      const ref = stem.panner.refDistance;
      const gain = d <= ref ? 1 : ref / (ref + this.rolloff * (d - ref));
      return { name: stem.spec.name, distance: +d.toFixed(1), gain: +gain.toFixed(3) };
    });
  }

  /** Fetch and decode every stem. Call before start(). */
  async load(world, baseUrl, onProgress = () => {}) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    let done = 0;
    this.stems = await Promise.all(
      world.stems.map(async (spec) => {
        const response = await fetch(`${baseUrl}${spec.audio}`);
        if (!response.ok) throw new Error(`stem ${spec.name}: ${response.status}`);
        const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());

        const gain = this.ctx.createGain();
        gain.gain.value = 1.0;

        const panner = this.ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = spec.ref_distance ?? 4;
        panner.maxDistance = spec.max_distance ?? 30;
        panner.rolloffFactor = this.rolloff;
        writePannerPosition(panner, ...spec.position);

        const analyser = this.ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.6;

        // gain -> [effects from the table] -> panner: an effect is heard
        // from where its instrument stands, like the instrument itself.
        const chain = new Chain(gain, panner);
        chain.set([]);
        panner.connect(analyser);
        analyser.connect(this.master);

        onProgress(++done, world.stems.length, spec.name);
        return {
          spec,
          buffer,
          gain,
          panner,
          chain,
          analyser,
          bins: new Uint8Array(analyser.fftSize),
          level: 0,
          source: null,
          muted: false,
        };
      })
    );

    return this.stems;
  }

  /** One shared start time keeps the four stems phase-locked. */
  start() {
    if (this.playing) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const t0 = this.ctx.currentTime + 0.2;
    for (const stem of this.stems) {
      const source = this.ctx.createBufferSource();
      source.buffer = stem.buffer;
      source.loop = true;
      source.connect(stem.gain);
      source.start(t0);
      stem.source = source;
    }
    this.startedAt = t0;
    this.playing = true;
  }

  stop() {
    for (const stem of this.stems) stem.source?.stop();
    this.playing = false;
  }

  /**
   * Suspending the context holds every source at the same sample, so the four
   * stems stay locked to each other across a pause. Stopping and restarting
   * them would drift them apart.
   */
  async pause() {
    if (!this.ctx || this.ctx.state !== 'running') return false;
    await this.ctx.suspend();
    this.paused = true;
    return true;
  }

  async resume() {
    if (!this.ctx || this.ctx.state === 'closed') return false;
    await this.ctx.resume();
    this.paused = false;
    return true;
  }

  async togglePause() {
    if (this.paused) { await this.resume(); } else { await this.pause(); }
    return this.paused;
  }

  /**
   * Jump the whole song to a point in the track. Every source is replaced and
   * restarted at one shared moment with the same offset, so the stems come back
   * phase-locked: restarting them one at a time would smear the drums against
   * the bass by however long the loop took.
   *
   * Echo mode needs this. A walk is remembered against the song's clock, so
   * playing the walk back over a different part of the track would be a
   * different mix from the one that was actually made.
   */
  seek(seconds) {
    if (!this.ctx || !this.playing || this.paused) return false;
    const length = this.stems[0]?.buffer.duration || 1;
    const offset = ((seconds % length) + length) % length;

    for (const stem of this.stems) {
      try { stem.source?.stop(); } catch { /* already stopped */ }
    }
    const t0 = this.ctx.currentTime + 0.08;
    for (const stem of this.stems) {
      const source = this.ctx.createBufferSource();
      source.buffer = stem.buffer;
      source.loop = true;
      source.connect(stem.gain);
      source.start(t0, offset);
      stem.source = source;
    }
    // songTime() measures from startedAt, so back-date it by the offset.
    this.startedAt = t0 - offset;
    return true;
  }

  /** Call once per frame with the camera. */
  update(camera) {
    if (!this.ctx) return;

    camera.getWorldDirection(_forward);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    setListener(this.ctx.listener, camera.position, _forward, _up);

    for (const stem of this.stems) {
      // RMS off the time domain, not a mean of frequency bins: on real music
      // most bins sit near zero and a bin mean never leaves the bottom 1%.
      stem.analyser.getByteTimeDomainData(stem.bins);
      let sum = 0;
      for (let i = 0; i < stem.bins.length; i++) {
        const sample = (stem.bins[i] - 128) / 128;
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / stem.bins.length);
      // Perceptual-ish curve so quiet stems still register on the meter.
      const raw = Math.min(1, Math.pow(rms * 2.6, 0.6));
      stem.level += (raw - stem.level) * (raw > stem.level ? 0.45 : 0.12);
    }
  }

  /** Seconds into the track, wrapped by the loop. Drives the beat mechanic. */
  songTime() {
    if (!this.ctx || !this.playing) return 0;
    const length = this.stems[0]?.buffer.duration || 1;
    return ((this.ctx.currentTime - this.startedAt) % length + length) % length;
  }

  /** Loudest stem right now, for the HUD. */
  dominant() {
    let best = null;
    for (const stem of this.stems) {
      if (!best || stem.level > best.level) best = stem;
    }
    return best;
  }

  setMasterVolume(v) {
    if (this.master) this.master.gain.value = v;
  }
}
