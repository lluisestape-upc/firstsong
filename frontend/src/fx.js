/**
 * The effects on the table, as real Web Audio graphs.
 *
 * Each effect is a self-contained insert with its own dry/wet: input splits
 * into a dry path and a processed path, and the two meet again at output. A
 * stem's chain is a line of these between its gain and its panner, so an
 * effect is heard where the instrument stands, like anything else in the
 * world.
 *
 * Every parameter is described (range, unit, a line of explanation) so the
 * table can draw a dial for it and say what it does without a manual.
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function ramp(param, value, ctx, seconds = 0.04) {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + seconds);
}

/** A decaying burst of noise: what a room does to a click, which is all a reverb is. */
function impulseResponse(ctx, seconds, damping) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let smooth = 0;
  for (let i = 0; i < length; i++) {
    const t = i / length;
    // Exponential decay to about -60 dB at the end, which is what "decay
    // time" means on a real reverb (RT60).
    const envelope = Math.pow(1000, -t);
    smooth += (Math.random() * 2 - 1 - smooth) * (1 - damping * t);
    data[i] = smooth * envelope;
  }
  return buffer;
}

function driveCurve(amount) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(amount * x) / Math.tanh(amount);
  }
  return curve;
}

export const KINDS = {
  reverb: {
    title: 'Reverb',
    lesson: 'a reverb is a room: every sound keeps bouncing off the walls and fading',
    colour: '#9fd3ff',
    params: {
      mix: { label: 'dry / wet', min: 0, max: 1, value: 0.45, step: 0.05, unit: '%' },
      decay: { label: 'decay', min: 0.3, max: 6, value: 2.2, step: 0.2, unit: 's',
        hint: 'how long the room takes to go quiet' },
      damping: { label: 'damping', min: 0, max: 0.95, value: 0.4, step: 0.05, unit: '%',
        hint: 'soft walls swallow the highs first' },
    },
  },
  delay: {
    title: 'Delay',
    lesson: 'a delay repeats what it hears, a little quieter each time',
    colour: '#ffd59a',
    params: {
      mix: { label: 'dry / wet', min: 0, max: 1, value: 0.35, step: 0.05, unit: '%' },
      beats: { label: 'time', options: [0.25, 0.5, 0.75, 1, 1.5, 2], value: 0.75, unit: 'beat',
        hint: 'measured in beats, so the echoes land in time with the song' },
      feedback: { label: 'feedback', min: 0, max: 0.9, value: 0.45, step: 0.05, unit: '%',
        hint: 'how much of each echo is fed back in to echo again' },
    },
  },
  filter: {
    title: 'Filter',
    lesson: 'a filter lets some frequencies through and stops the rest',
    colour: '#a8f0c6',
    params: {
      type: { label: 'type', options: ['lowpass', 'highpass', 'bandpass'], value: 'lowpass',
        hint: 'which side of the cutoff gets through' },
      cutoff: { label: 'cutoff', min: 60, max: 16000, value: 900, log: true, unit: 'Hz',
        hint: 'where the filter starts to bite' },
      resonance: { label: 'resonance', min: 0.5, max: 16, value: 4, step: 0.5, unit: 'Q',
        hint: 'a peak right at the cutoff; turn it up and the filter sings' },
    },
  },
  drive: {
    title: 'Distortion',
    lesson: 'distortion pushes the wave until it clips, adding harmonics that were never played',
    colour: '#ffa3a3',
    params: {
      mix: { label: 'dry / wet', min: 0, max: 1, value: 0.6, step: 0.05, unit: '%' },
      drive: { label: 'drive', min: 1, max: 40, value: 8, step: 1, unit: 'x',
        hint: 'how hard the wave is pushed into the ceiling' },
      tone: { label: 'tone', min: 800, max: 12000, value: 4000, log: true, unit: 'Hz',
        hint: 'clipping is harsh; this takes the edge off afterwards' },
    },
  },
};

export class Effect {
  constructor(ctx, kind, bpm = 120) {
    this.ctx = ctx;
    this.kind = kind;
    this.spec = KINDS[kind];
    this.bpm = bpm;
    this.values = {};
    for (const [name, p] of Object.entries(this.spec.params)) this.values[name] = p.value;

    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.input.connect(this.dry).connect(this.output);
    this.wet.connect(this.output);
    this.wetOnly = false;

    this[`_build_${kind}`]();
    for (const name of Object.keys(this.values)) this._apply(name);
  }

  _build_reverb() {
    this.convolver = this.ctx.createConvolver();
    this.input.connect(this.convolver).connect(this.wet);
    this._irTimer = null;
  }

  _build_delay() {
    this.delay = this.ctx.createDelay(4.0);
    this.feedback = this.ctx.createGain();
    this.darken = this.ctx.createBiquadFilter();
    this.darken.type = 'lowpass';
    this.darken.frequency.value = 5000;       // each repeat a little duller, like tape
    this.input.connect(this.delay);
    this.delay.connect(this.darken).connect(this.feedback).connect(this.delay);
    this.delay.connect(this.wet);
  }

  _build_filter() {
    // A filter is an insert, not a send: the whole signal goes through it.
    this.biquad = this.ctx.createBiquadFilter();
    this.input.disconnect(this.dry);
    this.dry.gain.value = 0;
    this.input.connect(this.biquad).connect(this.wet);
    this.wet.gain.value = 1;
  }

  _build_drive() {
    this.pre = this.ctx.createGain();
    this.shaper = this.ctx.createWaveShaper();
    this.shaper.oversample = '4x';
    this.post = this.ctx.createBiquadFilter();
    this.post.type = 'lowpass';
    this.input.connect(this.pre).connect(this.shaper).connect(this.post).connect(this.wet);
  }

  /** Seconds for one delay step at the song's tempo. */
  get delaySeconds() {
    return clamp(this.values.beats * 60 / this.bpm, 0.01, 3.9);
  }

  set(name, value) {
    const p = this.spec.params[name];
    if (!p) return;
    if (p.options) {
      value = p.options.includes(value) ? value : p.options[0];
    } else {
      value = clamp(value, p.min, p.max);
    }
    this.values[name] = value;
    this._apply(name);
    return value;
  }

  /** Move a parameter one notch. `direction` is +1 or -1. */
  nudge(name, direction) {
    const p = this.spec.params[name];
    const now = this.values[name];
    if (p.options) {
      const i = p.options.indexOf(now);
      return this.set(name, p.options[clamp(i + direction, 0, p.options.length - 1)]);
    }
    if (p.log) {
      return this.set(name, now * Math.pow(2, direction / 3));   // a third of an octave
    }
    return this.set(name, Math.round((now + direction * p.step) / p.step) * p.step);
  }

  /** Hear only what the effect adds: the tail of the reverb, the echoes alone. */
  setWetOnly(on) {
    this.wetOnly = on;
    this._apply('mix');
  }

  _apply(name) {
    const v = this.values;
    const ctx = this.ctx;
    if (name === 'mix' && 'mix' in v) {
      // Equal-power crossfade: at 50% neither side dips in loudness.
      const dry = this.wetOnly ? 0 : Math.cos(v.mix * Math.PI / 2);
      let wet = Math.sin(v.mix * Math.PI / 2) * (this.wetOnly ? 1.4 : 1);
      // Keep distortion roughly level as the drive rises, or "more
      // distortion" is heard as nothing more than "louder".
      if (this.kind === 'drive') wet /= Math.sqrt(1 + v.drive * 0.08);
      ramp(this.dry.gain, dry, ctx);
      ramp(this.wet.gain, wet, ctx);
    }
    switch (this.kind) {
      case 'reverb':
        if (name === 'decay' || name === 'damping') {
          // Rebuilding the room is not free; wait for the dial to settle.
          clearTimeout(this._irTimer);
          this._irTimer = setTimeout(() => {
            this.convolver.buffer = impulseResponse(ctx, v.decay, v.damping);
          }, this.convolver.buffer ? 120 : 0);
        }
        break;
      case 'delay':
        if (name === 'beats') ramp(this.delay.delayTime, this.delaySeconds, ctx, 0.08);
        if (name === 'feedback') ramp(this.feedback.gain, v.feedback, ctx);
        break;
      case 'filter':
        if (name === 'type') this.biquad.type = v.type;
        if (name === 'cutoff') ramp(this.biquad.frequency, v.cutoff, ctx);
        if (name === 'resonance') ramp(this.biquad.Q, v.resonance, ctx);
        break;
      case 'drive':
        if (name === 'drive') {
          this.shaper.curve = driveCurve(v.drive);
          this._apply('mix');
        }
        if (name === 'tone') ramp(this.post.frequency, v.tone, ctx);
        break;
      default:
        break;
    }
  }

  /** For the display: the response of the filter, in dB, at `freqs`. */
  response(freqs) {
    if (this.kind !== 'filter') return null;
    const mag = new Float32Array(freqs.length);
    const phase = new Float32Array(freqs.length);
    this.biquad.getFrequencyResponse(freqs, mag, phase);
    return Array.from(mag, (m) => 20 * Math.log10(Math.max(m, 1e-5)));
  }

  disconnectOut() {
    try { this.output.disconnect(); } catch { /* nothing connected */ }
  }
}

/**
 * The line of effects on one stem. Rebuilt whenever the table changes which
 * effects touch this instrument, in which order.
 */
export class Chain {
  constructor(source, destination) {
    this.source = source;
    this.destination = destination;
    this.effects = [];
    this.wired = false;
  }

  sameAs(effects) {
    return this.wired && effects.length === this.effects.length
      && effects.every((e, i) => e === this.effects[i]);
  }

  teardown() {
    try { this.source.disconnect(); } catch { /* first time */ }
    for (const effect of this.effects) effect.disconnectOut();
    this.effects = [];
    this.wired = false;
  }

  wire(effects) {
    let node = this.source;
    for (const effect of effects) {
      node.connect(effect.input);
      node = effect.output;
    }
    node.connect(this.destination);
    this.effects = effects.slice();
    this.wired = true;
  }

  set(effects) {
    if (this.sameAs(effects)) return false;
    this.teardown();
    this.wire(effects);
    return true;
  }
}

/**
 * Re-route several chains at once. An effect can move from one instrument to
 * another in a single frame, and rewiring the chains one at a time would let
 * the first one's teardown cut the connection the second one just made. So:
 * everything down, then everything up.
 */
export function rewire(pairs) {
  if (pairs.every(([chain, effects]) => chain.sameAs(effects))) return false;
  for (const [chain] of pairs) chain.teardown();
  for (const [chain, effects] of pairs) chain.wire(effects);
  return true;
}
