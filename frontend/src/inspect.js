/**
 * Going inside an effect.
 *
 * Look at a puck on the table and press Enter: the camera leans in over it
 * and a panel opens above it with every parameter, a line saying what each
 * one does, and a picture of what the effect is doing to the sound right now.
 *
 * The pictures are the real thing, not illustrations: the reverb draws its
 * own impulse response, the filter asks the Web Audio node for its actual
 * frequency response, the delay puts its echoes on the song's beat grid, the
 * distortion draws the curve the wave is being bent through. Change a dial
 * and the picture and the sound change together.
 *
 * Hold F inside to hear only what the effect adds: the reverb's tail without
 * the dry sound, the echoes without the original.
 */
import * as THREE from 'three';
import { TABLE_HEIGHT } from './table.js';

const W = 1024;
const H = 700;
const TWEEN = 0.55;

const _target = new THREE.Vector3();
const _look = new THREE.Matrix4();

function formatValue(p, v) {
  if (p.options) {
    if (p.unit === 'beat') {
      const names = { 0.25: '1/16', 0.5: '1/8', 0.75: 'dotted 1/8', 1: '1/4', 1.5: 'dotted 1/4', 2: '1/2' };
      return names[v] || `${v} beat`;
    }
    return String(v);
  }
  if (p.unit === '%') return `${Math.round(v * 100)}%`;
  if (p.unit === 'Hz') return v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`;
  if (p.unit === 's') return `${v.toFixed(1)} s`;
  if (p.unit === 'Q') return `Q ${v.toFixed(1)}`;
  if (p.unit === 'x') return `×${Math.round(v)}`;
  return String(v);
}

function fraction(p, v) {
  if (p.options) return p.options.indexOf(v) / Math.max(1, p.options.length - 1);
  if (p.log) return Math.log(v / p.min) / Math.log(p.max / p.min);
  return (v - p.min) / (p.max - p.min);
}

export class Inspector {
  constructor({ stage, table, mix }) {
    this.stage = stage;
    this.table = table;
    this.mix = mix;
    this.active = false;
    this.closing = false;
    this.puck = null;
    this.selected = 0;
    this.t = 0;
    this.listening = false;
    // Told about 'open', 'change', 'listen' and 'close', so the tutorial can
    // tell when each has actually been done.
    this.onEvent = () => {};

    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.panel = new THREE.Mesh(
      // Sized to be read, not glanced at: about half the screen once you
      // are leaning over the table.
      new THREE.PlaneGeometry(1.22, 1.22 * H / W),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false })
    );
    this.panel.visible = false;
    this.panel.renderOrder = 10;
    stage.scene.add(this.panel);

    this.fromPos = new THREE.Vector3();
    this.fromQuat = new THREE.Quaternion();
    this.toPos = new THREE.Vector3();
    this.toQuat = new THREE.Quaternion();

    document.addEventListener('keydown', (event) => this._key(event));
  }

  get params() {
    return this.puck ? Object.keys(this.puck.spec.params) : [];
  }

  /** Lean in over a puck. */
  open(puck) {
    if (!puck || this.active) return false;
    this.puck = puck;
    this.active = true;
    this.closing = false;
    this.t = 0;
    this.selected = 0;

    const camera = this.stage.camera;
    this.fromPos.copy(camera.position);
    this.fromQuat.copy(camera.quaternion);

    const p = new THREE.Vector3(puck.pos.x, TABLE_HEIGHT, puck.pos.y);
    // Come in from the rim, but at an angle: straight out from the centre
    // would put the instrument's own miniature between you and the puck.
    const out = new THREE.Vector3(p.x, 0, p.z);
    if (out.lengthSq() < 0.01) out.set(camera.position.x, 0, camera.position.z);
    out.normalize();
    const side = new THREE.Vector3(-out.z, 0, out.x);
    const from = out.clone().multiplyScalar(0.5).addScaledVector(side, 0.87).normalize();

    // Far enough back that the whole panel and the puck under it both fit:
    // the panel's top lands near eye level, the puck in the lower third.
    this.toPos.copy(p).addScaledVector(from, 1.03).add(new THREE.Vector3(0, 0.95, 0));
    _target.copy(p).add(new THREE.Vector3(0, 0.42, 0));
    _look.lookAt(this.toPos, _target, new THREE.Vector3(0, 1, 0));
    this.toQuat.setFromRotationMatrix(_look);

    this.panel.position.copy(p).add(new THREE.Vector3(0, 0.62, 0)).addScaledVector(from, -0.08);
    this.panel.lookAt(this.toPos);
    this.panel.visible = true;
    this.draw();
    this.onEvent('open');
    return true;
  }

  close() {
    if (!this.active || this.closing) return;
    this.listen(false);
    this.closing = true;
    this.t = 0;
    const camera = this.stage.camera;
    this.toPos.copy(this.fromPos);
    this.toQuat.copy(this.fromQuat);
    this.fromPos.copy(camera.position);
    this.fromQuat.copy(camera.quaternion);
    this.panel.visible = false;
    this.onEvent('close');
  }

  /** Leave at once, no tween: the menu has been opened. */
  cancel() {
    if (!this.active) return;
    this.listen(false);
    const back = this.closing ? this.toPos : this.fromPos;
    const quat = this.closing ? this.toQuat : this.fromQuat;
    this.stage.camera.position.copy(back);
    this.stage.camera.quaternion.copy(quat);
    this.active = false;
    this.closing = false;
    this.panel.visible = false;
  }

  /** Hear only what the effect adds, with its instrument on its own. */
  listen(on) {
    if (!this.puck || on === this.listening) return;
    this.listening = on;
    if (on) this.onEvent('listen');
    this.puck.effect.setWetOnly(on);
    const stem = this.puck.on?.stem || null;
    this.mix.soloStem(on ? stem : null);
    this.draw();
  }

  _key(event) {
    if (!this.active || this.closing) return;
    const names = this.params;
    if (!names.length) return;
    let used = true;
    switch (event.code) {
      case 'KeyW': case 'ArrowUp':
        this.puck.effect.nudge(names[this.selected], +1);
        this.onEvent('change');
        break;
      case 'KeyS': case 'ArrowDown':
        this.puck.effect.nudge(names[this.selected], -1);
        this.onEvent('change');
        break;
      case 'KeyD': case 'ArrowRight':
        this.selected = (this.selected + 1) % names.length; break;
      case 'KeyA': case 'ArrowLeft':
        this.selected = (this.selected - 1 + names.length) % names.length; break;
      default:
        used = false;
    }
    if (used) {
      event.preventDefault();
      this.draw();
      // Parameters glide rather than jump, and the filter's picture is asked
      // of the node itself: draw again once the glide has arrived.
      clearTimeout(this._settle);
      this._settle = setTimeout(() => this.draw(), 90);
    }
  }

  /** Returns true while it is driving the camera. */
  update(dt) {
    if (!this.active) return false;
    const camera = this.stage.camera;
    this.t = Math.min(1, this.t + dt / TWEEN);
    const k = this.t < 0.5 ? 2 * this.t * this.t : 1 - Math.pow(-2 * this.t + 2, 2) / 2;
    camera.position.lerpVectors(this.fromPos, this.toPos, k);
    camera.quaternion.slerpQuaternions(this.fromQuat, this.toQuat, k);

    if (this.closing && this.t >= 1) {
      this.active = false;
      this.closing = false;
      return false;
    }
    // The reverb's picture arrives a moment after its dial moves.
    if (this.puck?.kind === 'reverb' && this._irShown !== this.puck.effect.convolver.buffer) {
      this.draw();
    }
    return true;
  }

  draw() {
    const puck = this.puck;
    if (!puck) return;
    const c = this.canvas.getContext('2d');
    const effect = puck.effect;
    const spec = puck.spec;

    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(10, 12, 20, 0.86)';
    c.beginPath();
    c.roundRect(4, 4, W - 8, H - 8, 28);
    c.fill();
    c.strokeStyle = spec.colour;
    c.lineWidth = 3;
    c.stroke();

    c.fillStyle = spec.colour;
    c.font = '600 54px ui-sans-serif, system-ui, sans-serif';
    c.fillText(spec.title, 40, 78);
    const after = 40 + c.measureText(spec.title).width + 28;

    c.font = '28px ui-sans-serif, system-ui, sans-serif';
    if (puck.on) {
      c.fillStyle = `#${puck.on.colour.getHexString()}`;
      c.fillText(`on ${puck.on.monument.spec.name}`, after, 76);
    } else {
      c.fillStyle = '#8a8579';
      c.fillText('not on anything: set it next to an instrument', after, 76);
    }

    c.fillStyle = '#d9d4c7';
    c.font = 'italic 27px ui-serif, Georgia, serif';
    c.fillText(spec.lesson, 40, 124);

    // Parameters, one row each.
    const names = Object.keys(spec.params);
    names.forEach((name, i) => {
      const p = spec.params[name];
      const y = 176 + i * 58;
      const selected = i === this.selected;
      c.fillStyle = selected ? '#ffffff' : '#9d988c';
      c.font = `${selected ? '600 ' : ''}28px ui-sans-serif, system-ui, sans-serif`;
      c.fillText(p.label, 40, y + 10);

      const x0 = 250;
      const w = 470;
      c.fillStyle = 'rgba(255,255,255,0.1)';
      c.fillRect(x0, y - 6, w, 14);
      c.fillStyle = selected ? spec.colour : 'rgba(255,255,255,0.45)';
      c.fillRect(x0, y - 6, w * fraction(p, effect.values[name]), 14);

      c.fillStyle = selected ? '#ffffff' : '#9d988c';
      c.fillText(formatValue(p, effect.values[name]), x0 + w + 24, y + 10);
    });

    const hint = spec.params[names[this.selected]]?.hint;
    if (hint) {
      c.fillStyle = '#bdb7a9';
      c.font = '24px ui-sans-serif, system-ui, sans-serif';
      c.fillText(`${spec.params[names[this.selected]].label}: ${hint}`, 40, 176 + names.length * 58 + 6);
    }

    // The picture of what it is doing.
    const gx = 40;
    const gy = 176 + names.length * 58 + 34;
    const gw = W - 80;
    const gh = H - gy - 72;
    c.strokeStyle = 'rgba(255,255,255,0.12)';
    c.lineWidth = 1;
    c.strokeRect(gx, gy, gw, gh);
    this[`_graph_${puck.kind}`]?.(c, gx, gy, gw, gh);

    c.fillStyle = '#7d786d';
    c.font = '22px ui-sans-serif, system-ui, sans-serif';
    c.fillText(this.listening
      ? 'listening to the effect alone · let go of F to hear it in the mix'
      : 'W S change · A D choose · hold F: hear only the effect · Enter: back',
    40, H - 30);

    this.texture.needsUpdate = true;
  }

  _graph_reverb(c, x, y, w, h) {
    const buffer = this.puck.effect.convolver.buffer;
    this._irShown = buffer;
    if (!buffer) return;
    const data = buffer.getChannelData(0);
    const columns = Math.floor(w);
    const per = Math.max(1, Math.floor(data.length / columns));
    let peak = 1e-6;
    const env = new Float32Array(columns);
    for (let i = 0; i < columns; i++) {
      let m = 0;
      for (let j = i * per; j < Math.min(data.length, (i + 1) * per); j++) m = Math.max(m, Math.abs(data[j]));
      env[i] = m;
      peak = Math.max(peak, m);
    }
    c.fillStyle = 'rgba(159, 211, 255, 0.55)';
    for (let i = 0; i < columns; i++) {
      const v = env[i] / peak;
      c.fillRect(x + i, y + h / 2 - (v * h) / 2, 1, v * h);
    }
    this._caption(c, x, y, `one clap in this room, and how long it keeps sounding: ${this.puck.effect.values.decay.toFixed(1)} s`);
  }

  _graph_delay(c, x, y, w, h) {
    const e = this.puck.effect;
    const beats = 8;
    const beatW = w / beats;
    c.strokeStyle = 'rgba(255,255,255,0.14)';
    for (let b = 0; b <= beats; b++) {
      c.beginPath(); c.moveTo(x + b * beatW, y); c.lineTo(x + b * beatW, y + h); c.stroke();
    }
    const tap = e.values.beats;
    let level = 1;
    let t = 0;
    let k = 0;
    while (t <= beats && level > 0.02) {
      const bar = k === 0 ? 1 : level;
      c.fillStyle = k === 0 ? 'rgba(255,255,255,0.8)' : 'rgba(255, 213, 154, 0.85)';
      c.fillRect(x + t * beatW - 5, y + h - bar * (h - 20), 10, bar * (h - 20));
      if (k === 0) level = Math.sin(e.values.mix * Math.PI / 2);
      else level *= e.values.feedback;
      t += tap;
      k++;
    }
    this._caption(c, x, y, 'the lines are the song\'s beats: the echoes land on them');
  }

  _graph_filter(c, x, y, w, h) {
    const e = this.puck.effect;
    const n = 256;
    const freqs = new Float32Array(n);
    for (let i = 0; i < n; i++) freqs[i] = 20 * Math.pow(1000, i / (n - 1));
    const db = e.response(freqs);
    const top = 24;
    const bottom = -36;
    const yOf = (d) => y + ((top - Math.max(bottom, Math.min(top, d))) / (top - bottom)) * h;

    c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.beginPath(); c.moveTo(x, yOf(0)); c.lineTo(x + w, yOf(0)); c.stroke();
    c.strokeStyle = '#a8f0c6';
    c.lineWidth = 4;
    c.beginPath();
    db.forEach((d, i) => {
      const px = x + (i / (n - 1)) * w;
      if (i === 0) c.moveTo(px, yOf(d)); else c.lineTo(px, yOf(d));
    });
    c.stroke();
    c.lineWidth = 1;
    const cx = x + (Math.log(e.values.cutoff / 20) / Math.log(1000)) * w;
    c.strokeStyle = 'rgba(168, 240, 198, 0.4)';
    c.beginPath(); c.moveTo(cx, y); c.lineTo(cx, y + h); c.stroke();
    this._caption(c, x, y, 'low notes on the left, high on the right; above the line gets through');
  }

  _graph_drive(c, x, y, w, h) {
    const e = this.puck.effect;
    const k = e.values.drive;
    c.strokeStyle = 'rgba(255,255,255,0.25)';
    c.setLineDash([6, 6]);
    c.beginPath(); c.moveTo(x, y + h); c.lineTo(x + w, y); c.stroke();
    c.setLineDash([]);
    c.strokeStyle = '#ffa3a3';
    c.lineWidth = 4;
    c.beginPath();
    for (let i = 0; i <= 200; i++) {
      const inX = (i / 200) * 2 - 1;
      const out = Math.tanh(k * inX) / Math.tanh(k);
      const px = x + (i / 200) * w;
      const py = y + h / 2 - (out * h) / 2;
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.stroke();
    c.lineWidth = 1;
    this._caption(c, x, y, 'dashed is a clean wave; the red curve flattens its peaks, and that flattening is the grit');
  }

  _caption(c, x, y, text) {
    c.fillStyle = '#9d988c';
    c.font = '22px ui-sans-serif, system-ui, sans-serif';
    c.fillText(text, x + 12, y + 28);
  }
}
