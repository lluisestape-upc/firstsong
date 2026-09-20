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

export class SpatialMix {
  constructor() {
    this.ctx = null;
    this.stems = [];
    this.playing = false;
    this.startedAt = 0;
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
        panner.rolloffFactor = 1.3;
        const [x, y, z] = spec.position;
        if (isParam(panner.positionX)) {
          panner.positionX.value = x;
          panner.positionY.value = y;
          panner.positionZ.value = z;
        } else {
          panner.setPosition(x, y, z);
        }

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
