/**
 * Mechanic 3. Land a jump on the beat.
 *
 * The manifest carries the actual beat instants, not a 60/BPM grid, because a
 * grid drifts on anything a human played. Landing close to one sends a ring
 * out from your feet; land on several in a row and they grow.
 *
 * No counter, no score, no text. You either notice the world agreeing with you
 * or you do not.
 */
import * as THREE from 'three';

const WINDOW = 0.16;          // seconds either side of a beat that still counts
const RINGS = 8;

export class Beat {
  constructor(scene, beats, colour = '#ffffff') {
    this.beats = beats || [];
    this.streak = 0;
    this.best = 0;

    this.pool = [];
    for (let i = 0; i < RINGS; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1.0, 64),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(colour), transparent: true, opacity: 0,
          side: THREE.DoubleSide, depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, life: 0, span: 1, reach: 6 });
    }
    this.next = 0;
  }

  /** Seconds from the nearest beat, or null when there are no beats. */
  offsetFrom(songTime) {
    if (!this.beats.length) return null;
    // The song loops, so fold the clock back into one pass of the track.
    const span = this.beats[this.beats.length - 1] + 0.8;
    const t = ((songTime % span) + span) % span;

    let lo = 0;
    let hi = this.beats.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.beats[mid] < t) lo = mid + 1; else hi = mid;
    }
    const after = this.beats[lo];
    const before = this.beats[Math.max(0, lo - 1)];
    return Math.abs(t - before) < Math.abs(after - t) ? t - before : t - after;
  }

  /**
   * Called when a jump lands. Returns how far off the beat it was, in seconds,
   * or null if there is nothing to be on.
   */
  land(songTime, position) {
    const offset = this.offsetFrom(songTime);
    if (offset === null) return null;

    const accuracy = Math.max(0, 1 - Math.abs(offset) / WINDOW);
    if (accuracy > 0) {
      this.streak++;
      this.best = Math.max(this.best, this.streak);
    } else {
      this.streak = 0;
    }

    // A miss still leaves a mark, just a small dull one: the world always
    // answers, it just answers better when you are right.
    const ring = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    ring.mesh.position.set(position.x, 0.08, position.z);
    ring.mesh.scale.setScalar(1);
    ring.mesh.visible = true;
    ring.life = 1;
    ring.span = 0.5 + accuracy * 0.9;
    ring.reach = 2 + accuracy * (7 + Math.min(this.streak, 6) * 2.2);
    ring.mesh.material.opacity = 0.1 + accuracy * 0.6;

    return offset;
  }

  update(dt) {
    for (const ring of this.pool) {
      if (ring.life <= 0) continue;
      ring.life -= dt / ring.span;
      if (ring.life <= 0) {
        ring.mesh.visible = false;
        continue;
      }
      const t = 1 - ring.life;
      ring.mesh.scale.setScalar(1 + t * ring.reach);
      ring.mesh.material.opacity *= 1 - dt / ring.span * 1.15;
    }
  }
}
