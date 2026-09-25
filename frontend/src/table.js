/**
 * The table in the middle of the world: a mixing desk you play with objects.
 *
 * It borrows its grammar from the Reactable (UPF, Barcelona): things on a
 * round lit surface connect to each other by being near each other, and the
 * connection is drawn. Here the things are:
 *
 *   instruments  a miniature of every monument, standing on the rim at the
 *                angle where the real one stands, so the table is the world
 *                seen small.
 *   effects      pucks you pick up and set down. Put one next to an
 *                instrument and it is on that instrument; put another next
 *                to the first and it goes after it in the chain.
 *
 * The drawing is the signal flow: a line from the instrument through each
 * effect in order, with a pulse travelling along it on the beat.
 */
import * as THREE from 'three';
import { Effect, KINDS, rewire } from './fx.js';

export const TABLE_HEIGHT = 0.95;
export const TABLE_RADIUS = 1.5;
const TOKEN_RING = 1.0;
const LINK = 0.45;          // how near two things must be to connect
const PUCK_RADIUS = 0.12;
const REACH = 3.6;          // how close you must stand to use the table
const FALL_FROM = 38;
const FALL_SECONDS = 1.5;

const _ray = new THREE.Raycaster();
const _centre = new THREE.Vector2(0, 0);
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hit = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function glowTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(120,170,255,0.30)');
  g.addColorStop(0.7, 'rgba(70,110,220,0.14)');
  g.addColorStop(1, 'rgba(40,60,160,0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A small symbol for the top of each puck, so they can be told apart unlabelled. */
function iconTexture(kind, colour) {
  const s = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const c = canvas.getContext('2d');
  c.fillStyle = colour;
  c.beginPath(); c.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#141620';
  c.fillStyle = '#141620';
  c.lineWidth = 7;
  c.lineCap = 'round';
  const m = s / 2;
  if (kind === 'reverb') {
    for (const r of [12, 26, 40]) { c.beginPath(); c.arc(m, m, r, 0, Math.PI * 2); c.stroke(); }
  } else if (kind === 'delay') {
    [[34, 16], [60, 12], [84, 8], [104, 5]].forEach(([x, r]) => {
      c.beginPath(); c.arc(x, m, r, 0, Math.PI * 2); c.fill();
    });
  } else if (kind === 'filter') {
    c.beginPath(); c.moveTo(20, 50); c.lineTo(62, 50);
    c.quadraticCurveTo(76, 30, 84, 60); c.lineTo(108, 100); c.stroke();
  } else if (kind === 'drive') {
    c.beginPath(); c.moveTo(18, 84);
    [[36, 40], [54, 84], [72, 40], [90, 84], [108, 40]].forEach(([x, y]) => c.lineTo(x, y));
    c.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A copy of a monument, shrunk to stand on the table. Shares its materials,
 *  so an instrument asleep in the world is dim on the table too. */
function miniature(monument, height) {
  const mini = monument.body.clone(true);
  mini.position.set(0, 0, 0);
  mini.rotation.set(0, 0, 0);
  mini.scale.setScalar(1);
  const box = new THREE.Box3().setFromObject(mini);
  const size = new THREE.Vector3();
  box.getSize(size);
  const s = height / (Math.max(size.x, size.y, size.z) || 1);
  mini.scale.setScalar(s);
  box.setFromObject(mini);
  mini.position.y -= box.min.y;
  mini.position.x -= (box.min.x + box.max.x) / 2;
  mini.position.z -= (box.min.z + box.max.z) / 2;
  return mini;
}

export class Table {
  constructor({ scene, stage, mix, monuments, bpm }) {
    this.stage = stage;
    this.mix = mix;
    this.bpm = bpm || 120;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this.present = false;
    this.landed = false;
    this.fall = 1;
    this.carrying = null;
    this.aimed = null;
    this.aimPoint = null;
    this.inReach = false;
    this.onLanded = () => {};
    this.onChange = () => {};

    this._buildBody();
    this._buildTokens(monuments);
    this._buildPucks();
    this._buildLinks();
  }

  _buildBody() {
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS * 0.96, 0.08, 72),
      new THREE.MeshStandardMaterial({
        color: '#12141c', roughness: 0.35, metalness: 0.2,
        emissive: '#1a2240', emissiveIntensity: 0.6,
      })
    );
    top.position.y = TABLE_HEIGHT - 0.04;
    this.group.add(top);

    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.4, TABLE_HEIGHT - 0.08, 32),
      new THREE.MeshStandardMaterial({ color: '#0d0f15', roughness: 0.6 })
    );
    pillar.position.y = (TABLE_HEIGHT - 0.08) / 2;
    this.group.add(pillar);

    this.glow = new THREE.Mesh(
      new THREE.CircleGeometry(TABLE_RADIUS * 0.98, 72),
      new THREE.MeshBasicMaterial({
        map: glowTexture(), transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = TABLE_HEIGHT + 0.002;
    this.group.add(this.glow);

    this.rim = new THREE.Mesh(
      new THREE.TorusGeometry(TABLE_RADIUS, 0.016, 8, 128),
      new THREE.MeshBasicMaterial({ color: '#cfe0ff', transparent: true, opacity: 0.8 })
    );
    this.rim.rotation.x = Math.PI / 2;
    this.rim.position.y = TABLE_HEIGHT;
    this.group.add(this.rim);

    this.light = new THREE.PointLight('#9ab8ff', 3, 7, 2);
    this.light.position.y = TABLE_HEIGHT + 1.2;
    this.group.add(this.light);

    // Where you are pointing on the surface.
    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.05, 0.065, 32),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthWrite: false })
    );
    this.cursor.rotation.x = -Math.PI / 2;
    this.cursor.visible = false;
    this.group.add(this.cursor);

    // A ring that goes out when the table lands.
    this.shock = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.0, 96),
      new THREE.MeshBasicMaterial({
        color: '#cfe0ff', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
      })
    );
    this.shock.rotation.x = -Math.PI / 2;
    this.shock.position.y = 0.06;
    this.group.add(this.shock);
    this.shockLife = 0;
  }

  _buildTokens(monuments) {
    const byName = new Map(this.mix.stems.map((s) => [s.spec.name, s]));
    this.tokens = monuments.map((monument) => {
      const holder = new THREE.Group();
      const colour = new THREE.Color(monument.spec.colour || '#ffffff');
      const slot = new THREE.Mesh(
        new THREE.RingGeometry(0.1, 0.13, 40),
        new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.8, depthWrite: false })
      );
      slot.rotation.x = -Math.PI / 2;
      slot.position.y = 0.004;
      holder.add(slot);
      holder.add(miniature(monument, 0.34));
      holder.position.y = TABLE_HEIGHT;
      this.group.add(holder);
      return {
        monument,
        stem: byName.get(monument.spec.name),
        holder,
        slot,
        colour,
        angle: Math.atan2(monument.group.position.z, monument.group.position.x),
        pos: new THREE.Vector2(),
      };
    });
    this._placeTokens(1);
  }

  _placeTokens(ease) {
    for (const token of this.tokens) {
      const p = token.monument.group.position;
      const target = Math.atan2(p.z, p.x);
      let d = target - token.angle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      token.angle += d * ease;
      token.pos.set(Math.cos(token.angle) * TOKEN_RING, Math.sin(token.angle) * TOKEN_RING);
      token.holder.position.x = token.pos.x;
      token.holder.position.z = token.pos.y;
    }
  }

  _buildPucks() {
    const kinds = Object.keys(KINDS);
    this.pucks = kinds.map((kind, i) => {
      const spec = KINDS[kind];
      const holder = new THREE.Group();
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(PUCK_RADIUS, PUCK_RADIUS, 0.045, 40),
        new THREE.MeshStandardMaterial({
          color: spec.colour, roughness: 0.5, emissive: spec.colour, emissiveIntensity: 0.25,
        })
      );
      base.position.y = 0.0225;
      holder.add(base);
      const face = new THREE.Mesh(
        new THREE.CircleGeometry(PUCK_RADIUS * 0.92, 40),
        new THREE.MeshBasicMaterial({ map: iconTexture(kind, spec.colour) })
      );
      face.rotation.x = -Math.PI / 2;
      face.position.y = 0.046;
      holder.add(face);
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(PUCK_RADIUS * 1.15, PUCK_RADIUS * 1.35, 40),
        new THREE.MeshBasicMaterial({ color: spec.colour, transparent: true, opacity: 0, depthWrite: false })
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.003;
      holder.add(halo);

      holder.position.y = TABLE_HEIGHT;
      this.group.add(holder);

      // Parked in the middle, clear of every instrument: nothing is on
      // anything until somebody puts it there.
      const angle = Math.PI / 4 + (i * Math.PI) / 2;
      const pos = new THREE.Vector2(Math.cos(angle) * 0.3, Math.sin(angle) * 0.3);
      return {
        kind, spec, holder, base, halo, pos,
        effect: new Effect(this.mix.ctx, kind, this.bpm),
        lift: 0,
        on: null,              // the token this puck's chain belongs to
      };
    });
  }

  _buildLinks() {
    this.links = [];
    for (let i = 0; i < 16; i++) {
      const wire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.009, 0.009, 1, 8, 1, true),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false })
      );
      wire.visible = false;
      this.group.add(wire);
      const packet = new THREE.Mesh(
        new THREE.SphereGeometry(0.022, 12, 8),
        new THREE.MeshBasicMaterial({ color: '#ffffff' })
      );
      packet.visible = false;
      this.group.add(packet);
      this.links.push({ wire, packet });
    }
  }

  /** Bring the table in immediately (Play). */
  show() {
    this.present = true;
    this.landed = true;
    this.fall = 1;
    this.group.visible = true;
    this.group.position.y = 0;
  }

  /** Let it fall out of the sky (Discover, once every instrument is found). */
  drop() {
    if (this.present) return;
    this.present = true;
    this.landed = false;
    this.fall = 0;
    this.group.visible = true;
    this.group.position.y = FALL_FROM;
  }

  hide() {
    this.present = false;
    this.landed = false;
    this.group.visible = false;
    this.carrying = null;
    // Nothing on the table means nothing on any instrument.
    for (const puck of this.pucks) puck.pos.set(puck.pos.x * 0.3, puck.pos.y * 0.3);
    rewire(this.tokens.filter((t) => t.stem).map((t) => [t.stem.chain, []]));
  }

  /** Keep the walker out of the table. */
  push(position) {
    if (!this.present) return;
    const d = Math.hypot(position.x, position.z);
    const min = TABLE_RADIUS + 0.35;
    if (d < min) {
      const k = d < 1e-3 ? 1 : min / d;
      if (d < 1e-3) position.z = min;
      else { position.x *= k; position.z *= k; }
    }
  }

  /** Point the camera's centre at the table surface. */
  _aim() {
    this.aimPoint = null;
    this.aimed = null;
    const camera = this.stage.camera;
    this.inReach = this.landed && Math.hypot(camera.position.x, camera.position.z) < REACH;
    if (!this.inReach) return;

    // The camera has moved this frame but its matrix is only refreshed when
    // the frame renders; aim from where it is now, not from last frame.
    camera.updateMatrixWorld();
    _ray.setFromCamera(_centre, camera);
    _plane.constant = -(TABLE_HEIGHT + this.group.position.y);
    if (!_ray.ray.intersectPlane(_plane, _hit)) return;
    const r = Math.hypot(_hit.x, _hit.z);
    if (r > TABLE_RADIUS + 0.15) return;

    const scale = Math.min(1, (TABLE_RADIUS - PUCK_RADIUS) / Math.max(r, 1e-6));
    this.aimPoint = new THREE.Vector2(_hit.x * scale, _hit.z * scale);
    if (this.carrying) return;

    let best = null;
    let bestD = PUCK_RADIUS * 1.8;
    for (const puck of this.pucks) {
      const d = puck.pos.distanceTo(this.aimPoint);
      if (d < bestD) { bestD = d; best = puck; }
    }
    this.aimed = best;
  }

  /** E at the table. Returns true if the table used the key. */
  takeOrPlace() {
    if (!this.landed || !this.inReach) return false;
    if (this.carrying) {
      if (this.aimPoint) this.carrying.pos.copy(this.aimPoint);
      this.carrying = null;
      this.onChange('place');
      return true;
    }
    if (this.aimed) {
      this.carrying = this.aimed;
      this.onChange('take');
      return true;
    }
    return false;
  }

  /** Which effects are on which instrument, in what order. */
  _graph() {
    const chains = this.tokens.map(() => []);
    const tails = this.tokens.map((t) => t.pos);
    const free = new Set(this.pucks.filter((p) => p !== this.carrying));
    for (const puck of this.pucks) puck.on = null;

    for (;;) {
      let best = null;
      for (const puck of free) {
        tails.forEach((tail, i) => {
          if (!this.tokens[i].stem) return;
          const d = puck.pos.distanceTo(tail);
          if (d < LINK && (!best || d < best.d)) best = { puck, i, d };
        });
      }
      if (!best) break;
      chains[best.i].push(best.puck);
      tails[best.i] = best.puck.pos;
      best.puck.on = this.tokens[best.i];
      free.delete(best.puck);
    }

    const changed = rewire(this.tokens
      .map((t, i) => [t, chains[i]])
      .filter(([t]) => t.stem)
      .map(([t, list]) => [t.stem.chain, list.map((p) => p.effect)]));
    if (changed) this.onChange('route');
    return chains;
  }

  update(dt, songTime) {
    if (!this.present) return;

    if (!this.landed) {
      this.fall = Math.min(1, this.fall + dt / FALL_SECONDS);
      this.group.position.y = FALL_FROM * (1 - this.fall * this.fall);
      if (this.fall >= 1) {
        this.group.position.y = 0;
        this.landed = true;
        this.shockLife = 1;
        this.onLanded();
      }
      return;
    }

    if (this.shockLife > 0) {
      this.shockLife = Math.max(0, this.shockLife - dt / 1.6);
      const t = 1 - this.shockLife;
      this.shock.scale.setScalar(1.6 + t * 16);
      this.shock.material.opacity = 0.7 * this.shockLife * this.shockLife;
    }

    this._placeTokens(Math.min(1, dt * 3));
    this._aim();

    if (this.carrying && this.aimPoint) this.carrying.pos.lerp(this.aimPoint, Math.min(1, dt * 18));

    this.cursor.visible = !!this.aimPoint;
    if (this.aimPoint) {
      this.cursor.position.set(this.aimPoint.x, TABLE_HEIGHT + 0.004, this.aimPoint.y);
    }

    const chains = this._graph();

    for (const puck of this.pucks) {
      const lifted = puck === this.carrying ? 1 : 0;
      puck.lift += (lifted - puck.lift) * Math.min(1, dt * 12);
      puck.holder.position.set(puck.pos.x, TABLE_HEIGHT + puck.lift * 0.12, puck.pos.y);
      const aimed = puck === this.aimed || puck === this.carrying;
      puck.halo.material.opacity = puck.on ? 0.9 : aimed ? 0.5 : 0;
      if (puck.on) puck.halo.material.color.copy(puck.on.colour);
      else puck.halo.material.color.set(puck.spec.colour);
      puck.base.material.emissiveIntensity = (puck.on ? 0.55 : 0.18) + (aimed ? 0.3 : 0);
      puck.holder.scale.setScalar(aimed ? 1.08 : 1);
    }

    for (const token of this.tokens) {
      const busy = chains[this.tokens.indexOf(token)].length > 0;
      token.slot.material.opacity = busy ? 1 : 0.55;
    }

    // Draw each chain, with a pulse riding it once a beat from the
    // instrument outwards: the direction the sound actually flows.
    let used = 0;
    const beat = songTime * this.bpm / 60;
    this.tokens.forEach((token, i) => {
      const level = token.stem ? token.stem.level : 0;
      let from = token.pos;
      chains[i].forEach((puck, k) => {
        if (used >= this.links.length) return;
        const { wire, packet } = this.links[used++];
        _a.set(from.x, TABLE_HEIGHT + 0.03, from.y);
        _b.set(puck.pos.x, TABLE_HEIGHT + 0.03 + puck.lift * 0.12, puck.pos.y);
        const length = _a.distanceTo(_b);
        wire.visible = length > 1e-3;
        wire.position.copy(_a).lerp(_b, 0.5);
        wire.scale.set(1 + level * 1.5, length, 1 + level * 1.5);
        wire.quaternion.setFromUnitVectors(_up, _b.clone().sub(_a).normalize());
        wire.material.color.copy(token.colour);
        wire.material.opacity = 0.45 + level * 0.55;

        const t = ((beat - k * 0.25) % 1 + 1) % 1;
        packet.visible = true;
        packet.position.copy(_a).lerp(_b, t);
        packet.scale.setScalar(0.7 + level * 1.4);
        packet.material.color.copy(token.colour);
        from = puck.pos;
      });
    });
    for (let i = used; i < this.links.length; i++) {
      this.links[i].wire.visible = false;
      this.links[i].packet.visible = false;
    }

    const glow = 0.7 + Math.max(...this.tokens.map((t) => (t.stem ? t.stem.level : 0))) * 0.6;
    this.glow.material.opacity = glow;
  }
}
