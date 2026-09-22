/**
 * The place the monuments stand in.
 *
 * Two providers, chosen by what the manifest carries:
 *
 *   procedural  sky gradient + fog + flat ground, coloured from the song's key
 *               and tempo. Always available, zero dependencies.
 *
 *   worldlabs   a Marble export: an equirectangular panorama as the sky and a
 *               collider mesh as the landscape. Both are documented export
 *               formats, so this works from the web app alone without touching
 *               their API.
 *
 * Marble worlds are in OpenCV coordinates (+x left, +y DOWN, +z forward) and
 * three.js is OpenGL (+y up, -z forward). Meshes must be flipped on Y and Z or
 * the whole landscape arrives upside down and back to front.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const SKY_VERT = `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = `
  uniform vec3 top;
  uniform vec3 bottom;
  varying vec3 vWorld;
  void main() {
    float h = clamp(normalize(vWorld).y * 0.5 + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(mix(bottom, top, pow(h, 0.8)), 1.0);
  }
`;

/** Marble (OpenCV) -> three.js (OpenGL). Documented in their export specs. */
export function openCVToOpenGL(object) {
  object.scale.multiply(new THREE.Vector3(1, -1, -1));
  return object;
}

function proceduralSky(scene, top, bottom) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(400, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: { top: { value: top }, bottom: { value: bottom } },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
    })
  );
  scene.add(sky);
  return sky;
}

function proceduralGround(scene, ground, bottom, radius) {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 64),
    new THREE.MeshStandardMaterial({ color: ground, roughness: 0.95, metalness: 0.0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const rings = new THREE.Group();
  for (let r = 6; r < radius; r += 6) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.035, r + 0.035, 96),
      new THREE.MeshBasicMaterial({
        color: bottom, transparent: true, opacity: 0.12, side: THREE.DoubleSide,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    rings.add(ring);
  }
  scene.add(rings);
  return { floor, rings };
}

/**
 * @param {THREE.Scene} scene
 * @param {object} env     world.json -> environment
 * @param {string} base    url the world's files hang off
 */
export async function buildEnvironment(scene, env, base = '') {
  const top = new THREE.Color(env.sky_top || '#1a2036');
  const bottom = new THREE.Color(env.sky_bottom || '#6d7a92');
  const fog = new THREE.Color(env.fog_color || '#55607a');
  const ground = new THREE.Color(env.ground_color || '#2b2f38');
  const radius = env.ground_radius ?? 90;

  scene.fog = new THREE.FogExp2(fog, env.fog_density ?? 0.02);

  const asset = env.asset || {};
  const result = { provider: 'procedural' };

  // --- sky: panorama if we have one, gradient otherwise -----------------
  if (asset.panorama) {
    try {
      const texture = await new THREE.TextureLoader().loadAsync(`${base}${asset.panorama}`);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      scene.background = texture;
      scene.environment = texture;
      result.provider = 'worldlabs';
      result.panorama = texture;
    } catch (error) {
      console.warn('panorama failed, falling back to gradient sky', error);
    }
  }
  if (!result.panorama) result.sky = proceduralSky(scene, top, bottom);

  // --- ground: collider mesh if we have one, disc otherwise -------------
  if (asset.collider_mesh) {
    try {
      const gltf = await new GLTFLoader().loadAsync(`${base}${asset.collider_mesh}`);
      const landscape = openCVToOpenGL(gltf.scene);
      landscape.traverse((node) => { if (node.isMesh) node.receiveShadow = true; });
      scene.add(landscape);
      result.provider = 'worldlabs';
      result.landscape = landscape;
    } catch (error) {
      console.warn('collider mesh failed, falling back to flat ground', error);
    }
  }
  if (!result.landscape) Object.assign(result, proceduralGround(scene, ground, bottom, radius));

  // A panorama already lights the scene through scene.environment; without one
  // the monuments need explicit lights or they read as silhouettes.
  scene.add(new THREE.HemisphereLight(top, ground, result.panorama ? 0.7 : 1.5));
  const key = new THREE.DirectionalLight(0xffffff, result.panorama ? 0.9 : 1.4);
  key.position.set(18, 30, 12);
  scene.add(key);

  return result;
}
