/**
 * The place the monuments stand in.
 *
 * Two providers, chosen by what the manifest carries:
 *
 *   procedural  a landscape: sky with a sun (or a moon), clouds, hills past
 *               the edge of the walkable plain, trees, grass and something in
 *               the air. Five of them, one per song, and L walks through the
 *               rest. Always available, zero dependencies.
 *
 *   worldlabs   a Marble export: an equirectangular panorama as the sky and a
 *               collider mesh as the landscape. Both are documented export
 *               formats, so this works from the web app alone without touching
 *               their API.
 *
 * Marble worlds are in OpenCV coordinates (+x left, +y DOWN, +z forward) and
 * three.js is OpenGL (+y up, -z forward). Meshes must be flipped on Y and Z or
 * the whole landscape arrives upside down and back to front.
 *
 * The plain you walk on is flat out to the world's edge (70 m) and everything
 * that rises (hills, dunes, the sea going down) starts past it, so nothing in
 * the landscape can change what the walker stands on.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const PLAIN = 72;               // flat out to here, a little past the walk limit
const GROUND_SIZE = 900;
const GROUND_SEGMENTS = 160;
const SKY_RADIUS = 480;
const PARTICLE_BOX = 36;        // particles live in a box that follows you

/**
 * Each landscape is a time of day as much as a place. The colours are chosen
 * so the fog is the horizon: distant hills dissolve into the sky rather than
 * ending against it.
 */
export const BIOMES = {
  meadow: {
    label: 'summer meadow',
    top: '#4a8ad4', horizon: '#cfe4ef', below: '#a9c48a',
    sun: { elevation: 38, azimuth: 35, colour: '#fff0d4', intensity: 2.8, disc: 1, size: 1 },
    hemi: { sky: '#cfe2ff', ground: '#6f8a3c', intensity: 1.05 },
    fog: 0.0042, exposure: 1.0, bloom: 0.28,
    ground: ['#7aa447', '#98b85a'], hills: '#6d9447',
    terrain: 'hills',
    trees: { shape: 'round', count: 80, trunk: '#6b4a2f', canopy: ['#5b8c38', '#76a644', '#4b7932'] },
    grass: { count: 1800, colour: '#6f9a3c' },
    flowers: { count: 700, colours: ['#ffffff', '#ffd84d', '#ff8fb1', '#b9a4ff'] },
    rocks: { count: 22, colour: '#a19c90' },
    clouds: { count: 10, colour: '#ffffff' },
    air: 'motes',
  },
  shore: {
    label: 'shore at sunset',
    top: '#3a4c8c', horizon: '#ffb78a', below: '#e0a07c',
    sun: { elevation: 11, azimuth: -20, colour: '#ffb47a', intensity: 1.8, disc: 1, size: 1.4 },
    hemi: { sky: '#ffdcc8', ground: '#b99a80', intensity: 1.1 },
    fog: 0.0038, exposure: 1.05, bloom: 0.42,
    ground: ['#ecd6b0', '#dfc79c'], hills: '#9a7a66',
    terrain: 'shore',
    sea: '#4c93b4',
    trees: { shape: 'palm', count: 22, trunk: '#8a6a48', canopy: ['#4f7d3c', '#5f8f42'] },
    grass: { count: 260, colour: '#b9ab6a' },
    flowers: null,
    rocks: { count: 40, colour: '#8e8076' },
    clouds: { count: 8, colour: '#ffcfb4' },
    air: 'motes',
  },
  blossom: {
    label: 'spring blossom',
    top: '#78aee6', horizon: '#fde4ec', below: '#b9d39a',
    sun: { elevation: 44, azimuth: 120, colour: '#fff4ea', intensity: 2.6, disc: 1, size: 1 },
    hemi: { sky: '#ffe3ee', ground: '#7fae5c', intensity: 1.1 },
    fog: 0.0048, exposure: 1.0, bloom: 0.3,
    ground: ['#8cbc68', '#a6c877'], hills: '#8fb56c',
    terrain: 'hills',
    trees: { shape: 'round', count: 64, trunk: '#5a3a2e', canopy: ['#f6b3c8', '#f39ab8', '#fbd0dc', '#ffffff'] },
    grass: { count: 1500, colour: '#86b25c' },
    flowers: { count: 900, colours: ['#ffffff', '#ffc2d6', '#fff2a8'] },
    rocks: { count: 14, colour: '#b0a79d' },
    clouds: { count: 9, colour: '#ffffff' },
    air: 'petals',
  },
  snow: {
    label: 'first snow',
    top: '#6a9cd6', horizon: '#e4edf6', below: '#eef3f8',
    sun: { elevation: 22, azimuth: 60, colour: '#fff4e4', intensity: 2.2, disc: 1, size: 1 },
    hemi: { sky: '#dce9ff', ground: '#b8c4d0', intensity: 1.0 },
    fog: 0.0055, exposure: 0.88, bloom: 0.22,
    ground: ['#eef3f8', '#dfe7f0'], hills: '#f5f8fc',
    terrain: 'mountains',
    trees: { shape: 'pine', count: 110, trunk: '#4a3526', canopy: ['#2c5943', '#386a50', '#2a4f3d'] },
    grass: null,
    flowers: null,
    rocks: { count: 30, colour: '#8f97a3' },
    clouds: { count: 7, colour: '#f2f5fa' },
    air: 'snow',
  },
  night: {
    label: 'summer night',
    top: '#0c1638', horizon: '#3b4884', below: '#1c2a3e',
    sun: { elevation: 34, azimuth: -60, colour: '#cfdcff', intensity: 1.0, disc: 0.8, size: 2.6 },
    hemi: { sky: '#6a80c8', ground: '#223246', intensity: 1.35 },
    fog: 0.006, exposure: 1.25, bloom: 0.75,
    ground: ['#27423d', '#2f4c44'], hills: '#1f3440',
    terrain: 'hills',
    trees: { shape: 'round', count: 60, trunk: '#2a2420', canopy: ['#1f3a33', '#27463b'] },
    grass: { count: 1300, colour: '#2f4d3e' },
    flowers: { count: 260, colours: ['#8fd0ff', '#c6a8ff'], glow: 1.2 },
    rocks: { count: 16, colour: '#4b5566' },
    clouds: { count: 0 },
    air: 'fireflies',
    stars: true,
  },
};

export const BIOME_ORDER = ['meadow', 'shore', 'blossom', 'snow', 'night'];

/**
 * The manifest can name one. Otherwise the song picks: a slow song gets the
 * sunset, and the key chooses among the rest. The same song always lands in
 * the same place.
 */
export function chooseBiome(env = {}, mix = {}) {
  if (env.biome && BIOMES[env.biome]) return env.biome;
  if ((mix.tempo ?? 100) < 90) return 'shore';
  const keys = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const index = Math.max(0, keys.indexOf(mix.key));
  return ['meadow', 'blossom', 'snow', 'night'][index % 4];
}

// --- small deterministic helpers ----------------------------------------------

function rng(seed) {
  let a = 0;
  for (const c of seed) a = (a * 31 + c.charCodeAt(0)) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x, y) {
  return noise2(x, y) * 0.55 + noise2(x * 2.1, y * 2.1) * 0.3 + noise2(x * 4.3, y * 4.3) * 0.15;
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// The sea lies under the setting sun, so the sun goes down into it.
const SEA_ANGLE = (() => {
  const a = THREE.MathUtils.degToRad(BIOMES.shore.sun.azimuth);
  return Math.atan2(-Math.cos(a), Math.sin(a));
})();

/** Height of the landscape. Zero everywhere you can walk. */
function heightFor(terrain, x, z) {
  const r = Math.hypot(x, z);
  if (terrain === 'shore') {
    // The beach shelves into the sea on the sun's side and rises into a
    // headland behind you.
    const toward = Math.cos(Math.atan2(z, x) - SEA_ANGLE);
    // On the sea side the sand runs out at 42 m and you can wade the
    // shallows to the edge of the world.
    const land = smoothstep(-0.2, -0.6, toward);
    const dune = smoothstep(PLAIN, 130, r) * (6 + 22 * fbm(x * 0.02, z * 0.02)) * land;
    const shelf = -smoothstep(38, 54, r) * 0.4 - smoothstep(PLAIN, 110, r) * 4;
    return dune + shelf * (1 - land);
  }
  if (r < PLAIN) return 0;
  const rise = smoothstep(PLAIN, terrain === 'mountains' ? 170 : 140, r);
  const scale = terrain === 'mountains' ? 70 : 26;
  const n = fbm(x * 0.012 + 3.1, z * 0.012 - 7.4);
  const peaks = terrain === 'mountains' ? Math.pow(n, 1.8) * 1.6 : n;
  return rise * scale * peaks;
}

// --- sky ------------------------------------------------------------------------

const SKY_VERT = `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = `
  uniform vec3 top;
  uniform vec3 horizon;
  uniform vec3 below;
  uniform vec3 sunDir;
  uniform vec3 sunColour;
  uniform float sunDisc;
  uniform float sunSize;
  uniform float stars;
  uniform float time;
  varying vec3 vDir;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 colour = h > 0.0
      ? mix(horizon, top, pow(h, 0.5))
      : mix(horizon, below, clamp(-h * 5.0, 0.0, 1.0));

    float s = max(dot(d, sunDir), 0.0);
    float disc = smoothstep(0.9994 - 0.0008 * sunSize, 0.9997 - 0.0006 * sunSize, s);
    colour += sunColour * (disc * 6.0 * sunDisc + pow(s, 14.0) * 0.4 + pow(s, 3.0) * 0.14);

    if (stars > 0.0 && h > 0.0) {
      vec3 cell = floor(d * 260.0);
      float n = hash(cell);
      float twinkle = 0.55 + 0.45 * sin(time * 1.7 + n * 90.0);
      colour += vec3(0.9, 0.93, 1.0) * step(0.9975, n) * twinkle * smoothstep(0.02, 0.25, h) * 1.4;
    }
    gl_FragColor = vec4(colour, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function sunDirection(sun) {
  const e = THREE.MathUtils.degToRad(sun.elevation);
  const a = THREE.MathUtils.degToRad(sun.azimuth);
  return new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
}

function buildSky(spec) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(spec.top) },
      horizon: { value: new THREE.Color(spec.horizon) },
      below: { value: new THREE.Color(spec.below) },
      sunDir: { value: sunDirection(spec.sun) },
      sunColour: { value: new THREE.Color(spec.sun.colour) },
      sunDisc: { value: spec.sun.disc },
      sunSize: { value: spec.sun.size },
      stars: { value: spec.stars ? 1 : 0 },
      time: { value: 0 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 48, 24), material);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  return sky;
}

function puffTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const random = rng('cloud');
  for (let i = 0; i < 14; i++) {
    const x = 50 + random() * 156;
    const y = 58 + (random() - 0.5) * 30;
    const r = 22 + random() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildClouds(spec, random) {
  const group = new THREE.Group();
  if (!spec.clouds || !spec.clouds.count) return group;
  const texture = puffTexture();
  for (let i = 0; i < spec.clouds.count; i++) {
    const material = new THREE.SpriteMaterial({
      map: texture, color: spec.clouds.colour, transparent: true,
      opacity: 0.75 + random() * 0.2, depthWrite: false, fog: false,
    });
    const cloud = new THREE.Sprite(material);
    const angle = random() * Math.PI * 2;
    const distance = 170 + random() * 180;
    cloud.position.set(Math.cos(angle) * distance, 55 + random() * 60, Math.sin(angle) * distance);
    const width = 70 + random() * 90;
    cloud.scale.set(width, width * 0.42, 1);
    group.add(cloud);
  }
  return group;
}

// --- ground and everything on it ---------------------------------------------------

function buildGround(spec) {
  const geometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, GROUND_SEGMENTS, GROUND_SEGMENTS);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const colours = new Float32Array(position.count * 3);
  const a = new THREE.Color(spec.ground[0]);
  const b = new THREE.Color(spec.ground[1]);
  const hill = new THREE.Color(spec.hills);
  const c = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = heightFor(spec.terrain, x, z);
    position.setY(i, y);
    c.copy(a).lerp(b, fbm(x * 0.06, z * 0.06));
    c.lerp(hill, smoothstep(0, 14, Math.abs(y)) * 0.85);
    colours.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  const ground = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0,
  }));
  ground.receiveShadow = true;
  return ground;
}

function buildSea(spec) {
  const sea = new THREE.Mesh(
    new THREE.RingGeometry(30, GROUND_SIZE, 96, 1),
    new THREE.MeshStandardMaterial({
      color: spec.sea, roughness: 0.22, metalness: 0, transparent: true, opacity: 0.9,
    })
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.12;
  return sea;
}

/** A point on the ground, somewhere between two radii, clear of the middle. */
function scatter(random, near, far, terrain, avoidSea = false) {
  for (let tries = 0; tries < 20; tries++) {
    const angle = random() * Math.PI * 2;
    const r = near + Math.sqrt(random()) * (far - near);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const y = heightFor(terrain, x, z);
    if (avoidSea && terrain === 'shore' && (y < -0.05 || (r > 60 && y < 0.5))) continue;
    return new THREE.Vector3(x, y, z);
  }
  return null;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

function place(mesh, index, at, scale, spin = 0, tilt = 0, lift = 0) {
  _e.set(tilt, spin, tilt * 0.5);
  _q.setFromEuler(_e);
  _p.set(at.x, at.y + lift, at.z);
  _m.compose(_p, _q, scale);
  mesh.setMatrixAt(index, _m);
}

function buildTrees(spec, random) {
  const group = new THREE.Group();
  const t = spec.trees;
  if (!t || !t.count) return group;

  const trunkGeometry = new THREE.CylinderGeometry(0.1, 0.16, 1, 6).translate(0, 0.5, 0);
  let canopyGeometry;
  if (t.shape === 'pine') canopyGeometry = new THREE.ConeGeometry(0.9, 2.6, 7).translate(0, 1.3, 0);
  else if (t.shape === 'palm') canopyGeometry = new THREE.IcosahedronGeometry(1, 0).scale(1.5, 0.32, 1.5);
  else canopyGeometry = new THREE.IcosahedronGeometry(1, 1);

  const trunks = new THREE.InstancedMesh(trunkGeometry,
    new THREE.MeshStandardMaterial({ color: t.trunk, roughness: 0.9 }), t.count);
  const canopies = new THREE.InstancedMesh(canopyGeometry,
    new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }), t.count);
  const colour = new THREE.Color();

  for (let i = 0; i < t.count; i++) {
    // Most of them on the hills where they make a skyline, some on the plain.
    const onPlain = random() < 0.35;
    const at = onPlain
      ? scatter(random, 30, 66, spec.terrain, true)
      : scatter(random, 76, 190, spec.terrain, true);
    if (!at) continue;
    const size = 1.1 + random() * 1.4;
    const spin = random() * Math.PI * 2;
    const tall = t.shape === 'palm' ? 5.5 : t.shape === 'pine' ? 1.4 : 2.2;
    const tilt = t.shape === 'palm' ? (random() - 0.5) * 0.25 : 0;

    place(trunks, i, at, _s.set(size, size * tall, size), spin, tilt);
    const lift = size * tall * (t.shape === 'pine' ? 0.6 : 0.95);
    const spread = t.shape === 'round' ? 1.1 + random() * 0.4 : 1;
    place(canopies, i, at, _s.set(size * spread, size * (0.9 + random() * 0.3), size * spread), spin, 0, lift);
    colour.set(t.canopy[Math.floor(random() * t.canopy.length)]);
    colour.offsetHSL(0, 0, (random() - 0.5) * 0.06);
    canopies.setColorAt(i, colour);
  }
  trunks.castShadow = canopies.castShadow = true;
  group.add(trunks, canopies);
  return group;
}

function buildGrowth(spec, random) {
  const group = new THREE.Group();

  if (spec.grass) {
    // Short tufts lit a little from within, so their shaded sides do not read
    // as black spikes against the ground.
    const geometry = new THREE.ConeGeometry(0.045, 0.38, 3).translate(0, 0.19, 0);
    const grass = new THREE.Color(spec.grass.colour);
    const blades = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({
      color: grass, emissive: grass, emissiveIntensity: 0.35, roughness: 1,
    }), spec.grass.count);
    for (let i = 0; i < spec.grass.count; i++) {
      const at = scatter(random, 5, 70, spec.terrain, true) || new THREE.Vector3(0, -5, 0);
      const s = 0.7 + random() * 0.9;
      place(blades, i, at, _s.set(s, s, s), random() * 6.28, (random() - 0.5) * 0.5);
    }
    group.add(blades);
  }

  if (spec.flowers) {
    const f = spec.flowers;
    const geometry = new THREE.IcosahedronGeometry(0.1, 0).translate(0, 0.38, 0);
    const material = new THREE.MeshStandardMaterial({ roughness: 0.6 });
    if (f.glow) {
      material.emissive = new THREE.Color('#ffffff');
      material.emissiveIntensity = f.glow;
    }
    const heads = new THREE.InstancedMesh(geometry, material, f.count);
    const colour = new THREE.Color();
    for (let i = 0; i < f.count; i++) {
      // Flowers grow in patches, not evenly.
      const at = scatter(random, 6, 68, spec.terrain, true) || new THREE.Vector3(0, -5, 0);
      if (fbm(at.x * 0.08, at.z * 0.08) < 0.42) at.y = -5;
      const s = 0.8 + random() * 0.8;
      place(heads, i, at, _s.set(s, s, s), random() * 6.28);
      colour.set(f.colours[Math.floor(random() * f.colours.length)]);
      heads.setColorAt(i, colour);
    }
    if (f.glow) {
      // setColorAt tints the emissive too, since it multiplies the base colour.
      material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n totalEmissiveRadiance *= vColor;'
        );
      };
    }
    group.add(heads);
  }

  if (spec.rocks) {
    const r = spec.rocks;
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: r.colour, roughness: 0.95, flatShading: true }), r.count);
    for (let i = 0; i < r.count; i++) {
      const at = scatter(random, 26, 150, spec.terrain) || new THREE.Vector3(0, -9, 0);
      const s = 0.4 + random() * random() * 2.2;
      place(rocks, i, at, _s.set(s * (1 + random()), s * (0.5 + random() * 0.5), s),
        random() * 6.28, (random() - 0.5) * 0.4, -s * 0.25);
    }
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    group.add(rocks);
  }
  return group;
}

// --- something in the air -------------------------------------------------------------

function dotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

const AIR = {
  snow:      { count: 1600, size: 0.14, colour: '#ffffff', fall: 1.1, drift: 0.5, additive: false },
  petals:    { count: 700,  size: 0.13, colour: '#ffc4d6', fall: 0.55, drift: 0.9, additive: false },
  fireflies: { count: 260,  size: 0.2,  colour: '#ffe89a', fall: 0, drift: 0.35, additive: true },
  motes:     { count: 420,  size: 0.08, colour: '#fff1c4', fall: -0.08, drift: 0.2, additive: true },
};

class Air {
  constructor(kind) {
    this.kind = kind;
    this.spec = AIR[kind];
    const { count } = this.spec;
    const random = rng(kind);
    this.base = new Float32Array(count * 3);
    this.phase = new Float32Array(count);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.base[i * 3] = (random() - 0.5) * PARTICLE_BOX * 2;
      this.base[i * 3 + 1] = random() * (kind === 'fireflies' ? 3.5 : 18) + (kind === 'fireflies' ? 0.3 : 0);
      this.base[i * 3 + 2] = (random() - 0.5) * PARTICLE_BOX * 2;
      this.phase[i] = random() * 100;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.colours = new Float32Array(count * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colours, 3));
    this.material = new THREE.PointsMaterial({
      size: this.spec.size, map: dotTexture(), vertexColors: true, transparent: true,
      depthWrite: false, fog: !this.spec.additive,
      blending: this.spec.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.tint = new THREE.Color(this.spec.colour);
    this.time = 0;
  }

  /** `energy` is how loud the song is right now, 0..1: the air answers it. */
  update(dt, centre, energy) {
    this.time += dt;
    const { count, fall, drift } = this.spec;
    const box = PARTICLE_BOX;
    const position = this.points.geometry.attributes.position;
    const t = this.time;
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      const ph = this.phase[i];
      let y = this.base[k + 1];
      if (fall) {
        y -= fall * dt * (0.7 + (ph % 1) * 0.6);
        if (y < 0) y += 18;
        if (y > 18) y -= 18;
        this.base[k + 1] = y;
      }
      let x = this.base[k] + Math.sin(t * 0.4 + ph) * drift * 2;
      let z = this.base[k + 2] + Math.cos(t * 0.33 + ph * 1.3) * drift * 2;
      // Wrap around the walker so the air is always where you are.
      x = ((x - centre.x + box) % (box * 2) + box * 2) % (box * 2) - box + centre.x;
      z = ((z - centre.z + box) % (box * 2) + box * 2) % (box * 2) - box + centre.z;
      const bob = this.kind === 'fireflies' ? Math.sin(t * 0.9 + ph) * 0.6 : 0;
      position.setXYZ(i, x, y + bob, z);

      let light = 1;
      if (this.kind === 'fireflies') {
        light = Math.max(0, Math.sin(t * (0.8 + (ph % 1)) + ph)) ** 3 * (0.5 + energy * 1.2);
      } else if (this.kind === 'motes') {
        light = 0.35 + energy * 0.9;
      }
      this.colours[k] = this.tint.r * light;
      this.colours[k + 1] = this.tint.g * light;
      this.colours[k + 2] = this.tint.b * light;
    }
    position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.material.size = this.spec.size * (1 + energy * 0.35);
  }
}

// --- the landscape itself -----------------------------------------------------------

function dispose(object) {
  object.traverse((node) => {
    if (node.isInstancedMesh) node.dispose();
    node.geometry?.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material) continue;
      material.map?.dispose();
      material.dispose();
    }
  });
}

export class Landscape {
  constructor(scene, stage, seed) {
    this.scene = scene;
    this.stage = stage;
    this.seed = seed;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.provider = 'procedural';
    this.biome = null;
    this.bloom = 0.3;
    this.energy = 0;

    this.hemi = new THREE.HemisphereLight();
    this.sun = new THREE.DirectionalLight();
    this.sun.castShadow = true;
    const shadow = this.sun.shadow;
    shadow.mapSize.set(2048, 2048);
    Object.assign(shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 260 });
    shadow.bias = -0.0004;
    shadow.normalBias = 0.03;
    scene.add(this.hemi, this.sun, this.sun.target);
  }

  get label() {
    return BIOMES[this.biome]?.label || this.biome;
  }

  /** Put a landscape up, taking down whatever was there before. */
  set(name) {
    const spec = BIOMES[name] || BIOMES.meadow;
    this.biome = BIOMES[name] ? name : 'meadow';
    this.scene.remove(this.group);
    dispose(this.group);
    this.group = new THREE.Group();
    this.scene.add(this.group);

    const random = rng(`${this.seed}:${this.biome}`);
    this.sky = buildSky(spec);
    this.clouds = buildClouds(spec, random);
    this.group.add(this.sky, this.clouds, buildGround(spec), buildTrees(spec, random), buildGrowth(spec, random));
    if (spec.terrain === 'shore') this.group.add(buildSea(spec));

    this.air = spec.air ? new Air(spec.air) : null;
    if (this.air) this.group.add(this.air.points);

    this.scene.fog = new THREE.FogExp2(new THREE.Color(spec.horizon), spec.fog);
    this.scene.background = null;

    this.hemi.color.set(spec.hemi.sky);
    this.hemi.groundColor.set(spec.hemi.ground);
    this.hemi.intensity = spec.hemi.intensity;
    this.sun.color.set(spec.sun.colour);
    this.sun.intensity = spec.sun.intensity;
    this.sunDir = sunDirection(spec.sun);
    this.sun.position.copy(this.sunDir).multiplyScalar(120);

    this.stage.renderer.toneMappingExposure = spec.exposure;
    this.bloom = spec.bloom;
    return this.biome;
  }

  /** The next landscape in the list. */
  cycle() {
    const i = BIOME_ORDER.indexOf(this.biome);
    return this.set(BIOME_ORDER[(i + 1) % BIOME_ORDER.length]);
  }

  update(dt, camera, energy = 0) {
    this.energy += (energy - this.energy) * Math.min(1, dt * 4);
    if (this.sky) {
      this.sky.position.copy(camera.position);
      this.sky.material.uniforms.time.value += dt;
    }
    if (this.clouds) this.clouds.rotation.y += dt * 0.004;
    if (this.air) this.air.update(dt, camera.position, this.energy);
    // The world glows a little more when the song is loud.
    this.stage.setBloom?.(this.bloom * (0.8 + this.energy * 0.6));
  }
}

/** Marble (OpenCV) -> three.js (OpenGL). Documented in their export specs. */
export function openCVToOpenGL(object) {
  object.scale.multiply(new THREE.Vector3(1, -1, -1));
  return object;
}

/**
 * @param {Stage} stage
 * @param {object} env     world.json -> environment
 * @param {string} base    url the world's files hang off
 * @param {object} mix     world.json -> mix, for picking a landscape
 * @param {string} seed    anything stable per song, so its trees stay put
 */
export async function buildEnvironment(stage, env, base = '', mix = {}, seed = 'firstsong') {
  const scene = stage.scene;
  const asset = env.asset || {};

  if (asset.panorama || asset.collider_mesh) {
    const result = { provider: 'worldlabs', update() {}, cycle() { return null; } };
    const hemi = new THREE.HemisphereLight('#ffffff', '#444444', 0.7);
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(18, 30, 12);
    scene.add(hemi, key);
    if (asset.panorama) {
      try {
        const texture = await new THREE.TextureLoader().loadAsync(`${base}${asset.panorama}`);
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        scene.background = texture;
        scene.environment = texture;
      } catch (error) {
        console.warn('panorama failed', error);
      }
    }
    if (asset.collider_mesh) {
      try {
        const gltf = await new GLTFLoader().loadAsync(`${base}${asset.collider_mesh}`);
        const landscape = openCVToOpenGL(gltf.scene);
        landscape.traverse((node) => { if (node.isMesh) node.receiveShadow = true; });
        scene.add(landscape);
      } catch (error) {
        console.warn('collider mesh failed', error);
      }
    }
    return result;
  }

  const landscape = new Landscape(scene, stage, seed);
  landscape.set(chooseBiome(env, mix));
  return landscape;
}
