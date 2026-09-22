/**
 * The pad at the centre of the world. It does two jobs that turn out to be the
 * same job:
 *
 *   standing on it   this is where the song sits as it was mixed, the balance
 *                    somebody decided in 1969. Everywhere else is your version.
 *   jumping on it    puts every monument back where it started, wakes anything
 *                    hushed, and makes that reference true again.
 *
 * No label. It glows, it is in the middle, and jumping on things is what you
 * do when you are eight.
 */
import * as THREE from 'three';

const RADIUS = 2.2;
const TRIGGER = RADIUS + 0.6;

export class Pad {
  constructor(scene, colour = '#e8e2d2') {
    this.colour = new THREE.Color(colour);
    this.group = new THREE.Group();
    this.charge = 1;      // 1 = untouched world, 0 = just fired
    this.occupied = false;

    this.disc = new THREE.Mesh(
      new THREE.CircleGeometry(RADIUS, 64),
      new THREE.MeshBasicMaterial({
        color: this.colour, transparent: true, opacity: 0.1, side: THREE.DoubleSide,
      })
    );
    this.disc.rotation.x = -Math.PI / 2;
    this.disc.position.y = 0.03;
    this.group.add(this.disc);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(RADIUS - 0.1, RADIUS, 96),
      new THREE.MeshBasicMaterial({
        color: this.colour, transparent: true, opacity: 0.45, side: THREE.DoubleSide,
      })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.04;
    this.group.add(this.ring);

    // A second ring that expands outwards when the pad fires.
    this.pulseRing = new THREE.Mesh(
      new THREE.RingGeometry(RADIUS - 0.08, RADIUS, 96),
      new THREE.MeshBasicMaterial({
        color: this.colour, transparent: true, opacity: 0, side: THREE.DoubleSide,
      })
    );
    this.pulseRing.rotation.x = -Math.PI / 2;
    this.pulseRing.position.y = 0.05;
    this.group.add(this.pulseRing);

    this.light = new THREE.PointLight(this.colour, 0, 18, 2);
    this.light.position.y = 0.8;
    this.group.add(this.light);

    scene.add(this.group);
  }

  contains(position) {
    return Math.hypot(position.x, position.z) < TRIGGER;
  }

  /** Start the outward ripple. Called when a jump lands on the pad. */
  fire() {
    this.charge = 0;
  }

  /** `dirty` is true once the player has moved or hushed anything. */
  update(position, dt, dirty) {
    this.occupied = this.contains(position);

    // Brighter when there is something to undo, and brighter still up close.
    const wants = (dirty ? 0.75 : 0.32) + (this.occupied ? 0.25 : 0);
    this.ring.material.opacity += (wants - this.ring.material.opacity) * Math.min(1, dt * 4);
    this.disc.material.opacity = this.ring.material.opacity * 0.22;
    this.light.intensity = (dirty ? 2.6 : 0.8) * (this.occupied ? 1.8 : 1);

    if (this.charge < 1) {
      this.charge = Math.min(1, this.charge + dt * 0.9);
      const t = this.charge;
      this.pulseRing.scale.setScalar(1 + t * 9);
      this.pulseRing.material.opacity = 0.7 * (1 - t) * (1 - t);
    }
  }
}
