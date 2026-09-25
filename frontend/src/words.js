/**
 * The song's words, standing in its world.
 *
 * Every noun the vocal stem was heard to sing has an object. The first time
 * the word is sung the object leaves the voice and arcs out to its place;
 * every time after that it bounces, rings the ground, and grows. By the end
 * of a pass the world is the song so far, with the chorus word towering over
 * everything because it was sung thirty times.
 *
 * The words only arrive while the voice can be heard. In Gather the singer
 * starts asleep, so the lyrics begin to build the world at the moment you
 * wake them, and whatever was sung before that was simply missed.
 *
 * Time is the song's own clock. Jump backwards (the loop, or Echo replaying
 * a walk) and the world is recounted to match that moment, without flights.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const FLIGHT_SECONDS = 1.4;
const BOUNCE_SECONDS = 0.55;
const RINGS = 10;
const GLOW = 0.35;             // they are remembered things; they give off a little light

const loader = new GLTFLoader();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();

/** Same curve as backend/pipeline/lyrics.py: metres after `count` times sung. */
export function sizeFor(count) {
  return 1.3 + 0.8 * Math.sqrt(Math.max(count, 1));
}

function placeholder() {
  return new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.5, 1),
    new THREE.MeshStandardMaterial({ color: '#f3d9c4', roughness: 0.7, flatShading: true })
  );
}

/** Scale a model so its largest dimension is 1 and stand it on its foot. */
function normalise(object) {
  _box.setFromObject(object);
  _box.getSize(_size);
  const largest = Math.max(_size.x, _size.y, _size.z) || 1;
  object.scale.setScalar(1 / largest);
  _box.setFromObject(object);
  object.position.y -= _box.min.y;
  object.position.x -= (_box.min.x + _box.max.x) / 2;
  object.position.z -= (_box.min.z + _box.max.z) / 2;
}

function glow(object) {
  object.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    const material = node.material;
    if (material.emissive && material.map) {
      material.emissive.set('#ffffff');
      material.emissiveMap = material.map;
      material.emissiveIntensity = GLOW;
    }
  });
}

export class Words {
  constructor(scene, specs = [], baseUrl = '') {
    this.scene = scene;
    this.baseUrl = baseUrl;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.origin = new THREE.Vector3(0, 3, 0);
    this.last = -1;
    this.elapsed = 0;
    this.onSung = () => {};

    this.items = specs.map((spec) => {
      const holder = new THREE.Group();
      holder.position.set(...spec.position);
      holder.visible = false;
      this.group.add(holder);
      return {
        spec,
        holder,
        home: new THREE.Vector3(...spec.position),
        next: 0,              // index of the next time still to come
        count: 0,             // how many times it has been heard
        flight: 1,            // 0..1 while flying in, 1 once it has landed
        bounce: 1,            // 0..1 after each repeat
        shown: 0.001,         // the size on screen, eased towards the target
        spin: Math.random() * Math.PI * 2,
      };
    });

    this.rings = [];
    for (let i = 0; i < RINGS; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1.0, 48),
        new THREE.MeshBasicMaterial({
          color: '#fff4e6', transparent: true, opacity: 0,
          side: THREE.DoubleSide, depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      scene.add(ring);
      this.rings.push({ mesh: ring, life: 0, reach: 3 });
    }
    this.nextRing = 0;
  }

  get count() {
    return this.items.length;
  }

  /** Fetch every mesh at once. Anything that fails is drawn as a placeholder. */
  async load() {
    await Promise.all(this.items.map(async (item) => {
      let body = null;
      if (item.spec.model) {
        try {
          const gltf = await loader.loadAsync(`${this.baseUrl}${item.spec.model}`);
          body = gltf.scene;
        } catch (error) {
          console.warn(`word ${item.spec.key}: no mesh, using a placeholder`, error);
        }
      }
      body = body || placeholder();
      normalise(body);
      glow(body);
      const wrapper = new THREE.Group();
      wrapper.add(body);
      item.holder.add(wrapper);
      item.body = wrapper;
    }));
    return this;
  }

  /** Where a newly sung word is born: the singer, if there is one. */
  setOrigin(position) {
    this.origin.copy(position);
  }

  _ring(at, size) {
    const ring = this.rings[this.nextRing];
    this.nextRing = (this.nextRing + 1) % this.rings.length;
    ring.mesh.position.set(at.x, 0.07, at.z);
    ring.mesh.scale.setScalar(size * 0.45);
    ring.mesh.material.opacity = 0.55;
    ring.mesh.visible = true;
    ring.life = 1;
    ring.reach = size * 1.6;
  }

  /** Put every word in the state it should be in at `songTime`, with no flights. */
  _recount(songTime, heard) {
    for (const item of this.items) {
      let next = 0;
      while (next < item.spec.times.length && item.spec.times[next] <= songTime) next++;
      item.next = next;
      item.count = heard ? next : 0;
      item.flight = 1;
      item.bounce = 1;
      item.holder.visible = item.count > 0;
      item.holder.position.copy(item.home);
      item.shown = item.count > 0 ? sizeFor(item.count) : 0.001;
    }
  }

  /**
   * `heard` is whether the voice is audible right now. A word sung while the
   * singer is asleep or hushed passes unseen.
   */
  update(dt, songTime, heard = true) {
    this.elapsed += dt;

    if (this.last < 0 || songTime < this.last - 0.5) {
      this._recount(songTime, heard);
    } else {
      for (const item of this.items) {
        const times = item.spec.times;
        while (item.next < times.length && times[item.next] <= songTime) {
          item.next++;
          if (!heard) continue;
          item.count++;
          if (item.count === 1) {
            item.flight = 0;
            item.holder.visible = true;
            item.shown = 0.001;
          } else {
            item.bounce = 0;
            this._ring(item.home, sizeFor(item.count));
          }
          this.onSung(item);
        }
      }
    }
    this.last = songTime;

    for (const item of this.items) {
      if (!item.holder.visible || !item.body) continue;
      const target = sizeFor(item.count);

      if (item.flight < 1) {
        item.flight = Math.min(1, item.flight + dt / FLIGHT_SECONDS);
        const t = item.flight;
        const k = 1 - Math.pow(1 - t, 3);             // leaves fast, settles
        const distance = this.origin.distanceTo(item.home);
        item.holder.position.lerpVectors(this.origin, item.home, k);
        item.holder.position.y += Math.sin(Math.PI * k) * Math.min(7, 1.5 + distance * 0.3);
        item.shown = target * (0.15 + 0.85 * k);
        if (item.flight >= 1) this._ring(item.home, target);
      } else {
        item.shown += (target - item.shown) * Math.min(1, dt * 3);
        item.holder.position.y = item.home.y + Math.sin(this.elapsed * 0.9 + item.spin) * 0.08;
      }

      let squash = 1;
      if (item.bounce < 1) {
        item.bounce = Math.min(1, item.bounce + dt / BOUNCE_SECONDS);
        squash = 1 + 0.22 * Math.sin(Math.PI * item.bounce) * (1 - item.bounce);
      }
      item.body.scale.setScalar(item.shown * squash);
      item.body.rotation.y = item.spin + this.elapsed * 0.15;
    }

    for (const ring of this.rings) {
      if (ring.life <= 0) continue;
      ring.life -= dt / 1.1;
      if (ring.life <= 0) {
        ring.mesh.visible = false;
        continue;
      }
      const t = 1 - ring.life;
      ring.mesh.scale.setScalar(ring.reach * (0.3 + t));
      ring.mesh.material.opacity = 0.55 * ring.life * ring.life;
    }
  }

  setVisible(visible) {
    this.group.visible = visible;
    for (const ring of this.rings) if (!visible) ring.mesh.visible = false;
  }
}
