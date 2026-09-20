/**
 * The place the monuments stand in.
 *
 * Today: a gradient sky dome + fog + ground, all coloured from the song's key
 * and tempo by backend/pipeline/worldlabs.py.
 * When a World Labs asset shows up in world.environment.asset, load it here and
 * keep the procedural version as the fallback.
 */
import * as THREE from 'three';

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

export function buildEnvironment(scene, env) {
  const top = new THREE.Color(env.sky_top || '#1a2036');
  const bottom = new THREE.Color(env.sky_bottom || '#6d7a92');
  const fog = new THREE.Color(env.fog_color || '#55607a');
  const ground = new THREE.Color(env.ground_color || '#2b2f38');

  scene.fog = new THREE.FogExp2(fog, env.fog_density ?? 0.02);

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

  const radius = env.ground_radius ?? 90;
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 64),
    new THREE.MeshStandardMaterial({ color: ground, roughness: 0.95, metalness: 0.0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Faint concentric rings: a legible sense of distance while you walk.
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

  scene.add(new THREE.HemisphereLight(top, ground, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(18, 30, 12);
  scene.add(key);

  return { sky, floor, rings };
}
