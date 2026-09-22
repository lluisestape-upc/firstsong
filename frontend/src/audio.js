/**
 * The core of the project: the song is not a stereo file playing at you, it is
 * four mono sources standing in the world. Where you walk is the mix.
 *
 * Every stem: BufferSource -> Gain -> Panner(HRTF) -> Analyser -> master.
 * All sources are started at one shared moment so they stay sample-locked, and
 * looping keeps the world alive for as long as the judge wants to wander.
 */

import { Vector3 } from 'three';

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

        gain.connect(panner);
        panner.connect(analyser);
        analyser.connect(this.master);

        onProgress(++done, world.stems.length, spec.name);
        return {
          spec,
          buffer,
          gain,
          panner,
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
