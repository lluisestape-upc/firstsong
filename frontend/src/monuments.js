/**
 * One monument per stem. If Tripo produced a .glb we load it; if not we fall
 * back to procedural geometry so the world is walkable before any API key
 * exists. Both paths pulse with their stem's live level.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

const FALLBACK = {
  drums: () => new THREE.IcosahedronGeometry(1.6, 1),
  bass: () => new THREE.DodecahedronGeometry(2.2, 0),
  other: () => new THREE.TorusKnotGeometry(1.2, 0.38, 128, 20),
  vocals: () => new THREE.ConeGeometry(1.0, 3.0, 5),
};

function fallbackMesh(spec) {
  const geometry = (FALLBACK[spec.name] || FALLBACK.other)();
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(spec.colour || '#888888'),
    roughness: 0.55,
    metalness: 0.25,
    flatShading: true,
  });
  return new THREE.Mesh(geometry, material);
}

/** Scale a loaded glb so every monument reads at a comparable size. */
function normaliseScale(object, target) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  const largest = Math.max(size.x, size.y, size.z) || 1;
  object.scale.setScalar(target / largest);
}

export async function buildMonument(spec, baseUrl) {
  const group = new THREE.Group();
  const [x, y, z] = spec.position;
  group.position.set(x, y, z);

  let body;
  if (spec.model) {
    try {
      const gltf = await loader.loadAsync(`${baseUrl}${spec.model}`);
      body = gltf.scene;
      normaliseScale(body, 3.2 * (spec.scale ?? 1));
      body.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
    } catch (error) {
      console.warn(`glb failed for ${spec.name}, using placeholder`, error);
    }
  }
  if (!body) {
    body = fallbackMesh(spec);
    body.scale.setScalar(spec.scale ?? 1);
  }
  // Whatever produced it, remember the resting scale so pulse() can modulate
  // around it instead of fighting normaliseScale.
  const baseScale = body.scale.x;
  group.add(body);
  // How far this thing sticks up above its own origin, so a course can be
  // built over the whole skyline rather than through it.
  const reach = new THREE.Box3().setFromObject(body).max.y;

  // A halo on the ground marking where this stem still reaches you.
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(spec.ref_distance - 0.15, spec.ref_distance, 96),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(spec.colour || '#ffffff'),
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    })
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -y + 0.02;
  group.add(halo);

  const glow = new THREE.PointLight(new THREE.Color(spec.colour || '#ffffff'), 0, 24, 2);
  group.add(glow);

  // Remember the resting look so the hushed and carried states can return to it.
  const restColour = new THREE.Color(spec.colour || '#ffffff');
  const hushColour = restColour.clone().lerp(new THREE.Color('#202225'), 0.72);

  return {
    spec,
    group,
    body,
    halo,
    glow,
    baseY: y,
    baseScale,

    /** The height of its highest point right now, in world metres. */
    get top() {
      return this.baseY + reach;
    },

    // set by the interaction layer
    carried: false,
    hushed: false,
    /** 0 at rest, 1 fully carried. Smoothed so pick-up and drop are not a snap. */
    lift: 0,
    /** 0 awake, 1 fully hushed. */
    dim: 0,
    /** 1 the moment it is sent home, 0 once it has landed. */
    homing: 0,
    /** Extra rotation picked up in flight. Accumulated so it never snaps back. */
    spin: 0,

    /** Where this monument stands now. Changes when the player puts it down. */
    setPosition(x, y, z) {
      group.position.set(x, y, z);
      this.baseY = y;
      halo.position.y = -y + 0.02;
    },

    /** stem.level is 0..1 from the analyser. */
    pulse(level, elapsed, dt = 1 / 60) {
      // Ease towards the target states rather than switching, so a monument
      // visibly wakes up or settles instead of popping.
      const ease = Math.min(1, dt * 6);
      this.lift += ((this.carried ? 1 : 0) - this.lift) * ease;
      this.dim += ((this.hushed ? 1 : 0) - this.dim) * ease;

      const awake = 1 - this.dim;
      const beat = level * awake;

      // A monument on its way home draws itself in and spins, so a shape in
      // flight never looks like a shape that happens to be drifting past.
      const tuck = this.homing * 0.18;
      body.scale.setScalar(baseScale * (1 + beat * 0.14 + this.lift * 0.08 - tuck));
      // A carried monument spins a little faster: it reads as "in your hands".
      this.spin += dt * this.homing * 7.0;
      body.rotation.y = elapsed * (0.08 + this.lift * 0.5) + this.spin;

      if (!this.carried && this.homing <= 0) {
        group.position.y = this.baseY
          + Math.sin(elapsed * 0.6) * (0.12 + this.lift * 0.3)
          + beat * 0.25;
      }

      halo.material.opacity = (0.12 + beat * 0.55) * (1 - this.dim * 0.85)
        + this.lift * 0.25;
      glow.intensity = beat * 14 + this.lift * 6;

      // Colour carries the hushed state on both the body and its halo.
      body.traverse((node) => {
        if (node.isMesh && node.material && node.material.color) {
          if (!node.userData.restColour) {
            node.userData.restColour = node.material.color.clone();
            node.userData.hushColour = node.material.color.clone()
              .lerp(new THREE.Color('#202225'), 0.72);
          }
          node.material.color.copy(node.userData.restColour)
            .lerp(node.userData.hushColour, this.dim);
        }
      });
      halo.material.color.copy(restColour).lerp(hushColour, this.dim);
    },
  };
}
