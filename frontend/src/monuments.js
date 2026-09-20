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

  return {
    spec,
    group,
    body,
    halo,
    glow,
    baseY: y,
    baseScale,
    /** stem.level is 0..1 from the analyser. */
    pulse(level, elapsed) {
      body.scale.setScalar(baseScale * (1 + level * 0.14));
      body.rotation.y = elapsed * 0.08;
      group.position.y = this.baseY + Math.sin(elapsed * 0.6) * 0.12 + level * 0.25;
      halo.material.opacity = 0.12 + level * 0.55;
      glow.intensity = level * 14;
    },
  };
}
