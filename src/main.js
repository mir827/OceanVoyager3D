import * as THREE from 'three';
import './style.css';

const canvas = document.querySelector('#scene');
const compactDevice = window.innerWidth <= 760 || window.matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
const pixelRatioCap = 1.75;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x80b8c6);
scene.fog = new THREE.FogExp2(0x8bb6bd, 0.0065);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 800);
const clock = new THREE.Clock();

scene.add(new THREE.HemisphereLight(0xc9f3ff, 0x69583a, 2.2));
const sun = new THREE.DirectionalLight(0xffe4aa, 3.1);
sun.position.set(-80, 120, -60);
sun.castShadow = true;
sun.shadow.mapSize.set(1536, 1536);
sun.shadow.camera.left = -80;
sun.shadow.camera.right = 80;
sun.shadow.camera.top = 80;
sun.shadow.camera.bottom = -80;
scene.add(sun);

const game = {
  started: false,
  ended: false,
  speed: 0,
  heading: 0,
  health: 100,
  treasures: 0,
  score: 0,
  supplies: 0,
  time: 0,
  cannonCooldown: 0,
  hitCooldown: 0,
  ultimateCharge: 40,
};

const keys = new Set();
const islands = [];
const enemies = [];
const cannonballs = [];
const particles = [];
const storms = [];
const items = [];
const joystick = { x: 0, y: 0, active: false, pointerId: null };
const MAX_CANNONBALLS = 44;
const MAX_HOSTILE_CANNONBALLS = 26;
const MAX_FRIENDLY_CANNONBALLS = 16;
const PROJECTILE_LIGHT_BATCH_SIZE = MAX_CANNONBALLS;
const PROJECTILE_LIGHT_LOCKED_SLOTS = 8;
const EFFECT_LIGHT_BATCH_SIZE = 14;
const ULTIMATE_CHARGE_MULTIPLIER = 1.45;
const ULTIMATE_TARGET_RANGE = 94;
const ENEMY_CHASE_RANGE_SQ = 55 * 55;
const ENEMY_FIRE_RANGE_SQ = 34 * 34;
const ENEMY_STANDOFF_RANGE_SQ = 18 * 18;
const yAxis = new THREE.Vector3(0, 1, 0);
const forwardAxis = new THREE.Vector3(0, 0, -1);
const cameraLookOffset = new THREE.Vector3(0, 4.5, 0);
const skyNightColor = new THREE.Color(0x17273f);
const skyDayColor = new THREE.Color(0x8ac4d0);
const skyFrameColor = new THREE.Color();
const tempDirection = new THREE.Vector3();
const tempPosition = new THREE.Vector3();
const tempToPlayer = new THREE.Vector3();
const tempPatrolTarget = new THREE.Vector3();
const tempCameraOffset = new THREE.Vector3();
const tempCameraTarget = new THREE.Vector3();
const tempCameraLook = new THREE.Vector3();
const tempFireDirection = new THREE.Vector3();
const tempParticlePosition = new THREE.Vector3();
const cannonballLaunchOffset = new THREE.Vector3(0, 2.2, 0);
const hiddenItemPosition = new THREE.Vector3(0, -9999, 0);
const muzzleUpAxis = new THREE.Vector3(0, 1, 0);
let audioContext;
let musicGain;
let cannonGain;
let cannonSoundBuffer;
let bgmStartPromise;
let musicMuted = false;
let lastCannonSoundAt = -1;
let renderFrame = 0;
let previousFrameCost = 0;
let combatRenderWarmed = false;
let shadowCooldownUntil = 0;
const SHADOW_UPDATE_INTERVAL = compactDevice ? 10 : 4;
const STARTUP_SHADOW_COOLDOWN = compactDevice ? 4.5 : 1.6;
const bgmUrl = `${import.meta.env.BASE_URL}audio/ocean-voyager-commercial-bgm.mp3`;
const bgm = new Audio(bgmUrl);
bgm.loop = true;
bgm.preload = 'auto';
bgm.volume = 0.74;
const bgmReady = new Promise((resolve) => {
  if (bgm.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
    resolve();
    return;
  }
  const finish = () => resolve();
  bgm.addEventListener('canplaythrough', finish, { once: true });
  bgm.addEventListener('error', finish, { once: true });
});
bgm.load();
const musicProfile = {
  style: 'commercial-high-seas',
  source: 'audio-file',
  asset: bgmUrl,
  tempoBpm: 126,
  layers: ['orchestral-brass', 'cinematic-strings', 'driving-percussion', 'synth-bass', 'tropical-accents'],
};
let missionTimer;
const ui = {
  audioToggle: document.querySelector('#audio-toggle'),
  danger: document.querySelector('#danger'),
  endScreen: document.querySelector('#end-screen'),
  endKicker: document.querySelector('#end-kicker'),
  endTitle: document.querySelector('#end-title'),
  endMessage: document.querySelector('#end-message'),
  fireButton: document.querySelector('#fire-button'),
  heading: document.querySelector('#heading'),
  health: document.querySelector('#health'),
  healthBar: document.querySelector('#health-bar'),
  joystick: document.querySelector('#joystick'),
  joystickKnob: document.querySelector('#joystick-knob'),
  mission: document.querySelector('#mission'),
  missionTitle: document.querySelector('#mission-title'),
  missionDetail: document.querySelector('#mission-detail'),
  needle: document.querySelector('#needle'),
  restartButton: document.querySelector('#restart-button'),
  score: document.querySelector('#score'),
  startButton: document.querySelector('#start-button'),
  startScreen: document.querySelector('#start-screen'),
  supplies: document.querySelector('#supplies'),
  treasure: document.querySelector('#treasure'),
  ultimate: document.querySelector('#ultimate'),
  ultimateBar: document.querySelector('#ultimate-bar'),
  ultimateButton: document.querySelector('#ultimate-button'),
  ultimateStat: document.querySelector('.ultimate-stat'),
};
const hudState = {
  health: '',
  healthWidth: '',
  treasure: '',
  score: '',
  supplies: '',
  ultimate: '',
  ultimateWidth: '',
  ultimateReady: null,
  needle: '',
  heading: '',
};
const frameProfile = { records: [] };

function countVisibleLights(lights) {
  let count = 0;
  for (const light of lights) {
    if (light.visible && light.intensity > 0) count += 1;
  }
  return count;
}

function profiledStep(name, run) {
  if (!globalThis.__OCEAN_PROFILE) {
    run();
    return;
  }
  const startedAt = performance.now();
  run();
  const cost = performance.now() - startedAt;
  if (cost > 5) {
    frameProfile.records.push({
      name,
      cost: Math.round(cost * 10) / 10,
      particles: particles.length,
      cannonballs: cannonballs.length,
      effectLights: countVisibleLights(effectLightPool) + particles.reduce((count, particle) => count + (particle.object?.userData?.pooledEffectLight && particle.object.visible && particle.object.intensity > 0 ? 1 : 0), 0),
      projectileLights: countVisibleLights(projectileLights),
    });
    if (frameProfile.records.length > 80) frameProfile.records.shift();
  }
}

const particleGeometry = {
  splash: new THREE.SphereGeometry(1, 5, 5),
  spark: new THREE.SphereGeometry(1, 6, 6),
  trail: new THREE.SphereGeometry(1, 6, 6),
  ring: new THREE.TorusGeometry(1, 0.04, 8, 36),
  muzzle: new THREE.ConeGeometry(0.34, 1.7, 8),
  cannonFriendly: new THREE.SphereGeometry(0.34, 10, 10),
  cannonHostile: new THREE.SphereGeometry(0.24, 10, 10),
};
const particleMaterialCache = new Map();
const particlePools = new Map();
const particleStatePool = [];
const cannonballStatePool = [];
const cannonballPools = { friendly: [], hostile: [] };
const effectLightPool = [];
const projectileLights = [];
const poolStats = {
  particlesCreated: 0,
  particlesReused: 0,
  particlesReleased: 0,
  cannonballsCreated: 0,
  cannonballsReused: 0,
  cannonballsReleased: 0,
  lightsCreated: 0,
  lightsReused: 0,
  lightsReleased: 0,
};
const MAX_PARTICLES = 140;

function cachedParticleMaterial(color, roughness = 0.55, emissiveIntensity = 0, transparent = false) {
  const key = `${color}:${roughness}:${emissiveIntensity}:${transparent}`;
  if (!particleMaterialCache.has(key)) {
    const mat = material(color, roughness);
    if (emissiveIntensity) {
      mat.emissive = new THREE.Color(color);
      mat.emissiveIntensity = emissiveIntensity;
    }
    mat.transparent = transparent;
    particleMaterialCache.set(key, mat);
  }
  return particleMaterialCache.get(key);
}

function addParticle(object, velocityX, velocityY, velocityZ, life, baseScale, maxLife = life, expand = 0) {
  const particle = particleStatePool.pop() ?? { velocity: new THREE.Vector3() };
  particle.object = object;
  particle.velocity.set(velocityX, velocityY, velocityZ);
  particle.life = life;
  particle.maxLife = maxLife;
  particle.baseScale = baseScale;
  particle.expand = expand;
  particles.push(particle);
  while (particles.length > MAX_PARTICLES) {
    releaseParticleState(particles.shift());
  }
}

function releaseParticleState(particle) {
  if (!particle?.object) return;
  releaseEffectObject(particle.object);
  particle.object = null;
  particleStatePool.push(particle);
}

function scaledEffectCount(count) {
  return count;
}

function particleMesh(geometry, mat, position, scale = 1, rotation = [0, 0, 0]) {
  const key = geometry.uuid;
  const pool = particlePools.get(key);
  const object = pool?.pop() ?? new THREE.Mesh(geometry, mat);
  if (!object.userData.particlePoolKey) {
    object.castShadow = false;
    object.receiveShadow = false;
    object.userData.particlePoolKey = key;
    scene.add(object);
    poolStats.particlesCreated += 1;
  } else {
    poolStats.particlesReused += 1;
  }
  object.material = mat;
  object.visible = true;
  object.position.copy(position);
  object.rotation.set(...rotation);
  object.quaternion.setFromEuler(object.rotation);
  object.scale.setScalar(scale);
  return object;
}

function effectLight(color, intensity, distance, decay, position) {
  const light = effectLightPool.pop();
  if (!light) return null;
  poolStats.lightsReused += 1;
  light.color.setHex(color);
  light.intensity = intensity;
  light.distance = distance;
  light.decay = decay;
  light.position.copy(position);
  light.visible = true;
  return light;
}

function releaseEffectObject(object) {
  if (object.userData?.pooledEffectLight) {
    object.visible = false;
    object.intensity = 0;
    object.position.copy(hiddenItemPosition);
    effectLightPool.push(object);
    poolStats.lightsReleased += 1;
    return;
  }
  object.visible = false;
  object.position.set(0, -9999, 0);
  const key = object.userData?.particlePoolKey;
  if (!key) return;
  if (!particlePools.has(key)) particlePools.set(key, []);
  particlePools.get(key).push(object);
  poolStats.particlesReleased += 1;
}

function initializeProjectileLights() {
  for (let i = 0; i < PROJECTILE_LIGHT_BATCH_SIZE; i += 1) {
    const light = new THREE.PointLight(0xff863d, 0, 12, 2);
    light.visible = false;
    light.position.copy(hiddenItemPosition);
    scene.add(light);
    projectileLights.push(light);
  }
}

function initializeEffectLights() {
  for (let i = 0; i < EFFECT_LIGHT_BATCH_SIZE; i += 1) {
    const light = new THREE.PointLight(0xff9b45, 0, 28, 2);
    light.userData.pooledEffectLight = true;
    light.visible = false;
    light.position.copy(hiddenItemPosition);
    scene.add(light);
    effectLightPool.push(light);
    poolStats.lightsCreated += 1;
  }
}

function syncProjectileLights() {
  for (let i = 0; i < projectileLights.length; i += 1) {
    const light = projectileLights[i];
    const ball = cannonballs[i];
    if (!ball?.object) {
      light.visible = false;
      light.intensity = 0;
      light.position.copy(hiddenItemPosition);
      continue;
    }
    light.visible = true;
    light.color.setHex(ball.hostile ? 0xd6442f : 0xff863d);
    light.intensity = ball.hostile ? 8 : 20;
    light.distance = ball.hostile ? 7 : 12;
    light.position.copy(ball.object.position);
  }
}

const oceanGeo = new THREE.PlaneGeometry(650, 650, 40, 40);
oceanGeo.rotateX(-Math.PI / 2);
const oceanBase = oceanGeo.attributes.position.array.slice();
let lastOceanUpdate = -Infinity;
const ocean = new THREE.Mesh(
  oceanGeo,
  new THREE.MeshPhysicalMaterial({
    color: 0x14657b,
    roughness: 0.28,
    metalness: 0.08,
    transmission: 0.05,
    transparent: true,
    opacity: 0.96,
    side: THREE.DoubleSide,
  }),
);
ocean.receiveShadow = true;
scene.add(ocean);

const seabed = new THREE.Mesh(
  new THREE.PlaneGeometry(650, 650).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x123f47, roughness: 1 }),
);
seabed.position.y = -6;
scene.add(seabed);

function material(color, roughness = 0.75) {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

function glowMaterial(color, roughness = 0.35, intensity = 1.2) {
  const mat = material(color, roughness);
  mat.emissive = new THREE.Color(color);
  mat.emissiveIntensity = intensity;
  return mat;
}

function mesh(geometry, mat, parent, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const object = new THREE.Mesh(geometry, mat);
  object.position.set(...position);
  object.rotation.set(...rotation);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

function createShip({ pirate = false, scale = 1 } = {}) {
  const ship = new THREE.Group();
  const wood = material(pirate ? 0x281d1b : 0x6c341e, 0.84);
  const trim = material(pirate ? 0x8b1f20 : 0xd49a42, 0.58);
  const sail = new THREE.MeshStandardMaterial({ color: pirate ? 0x252229 : 0xeee1bb, roughness: 0.95, side: THREE.DoubleSide });

  mesh(new THREE.BoxGeometry(4.6, 1.1, 11.5), wood, ship, [0, 1.25, 0]);
  mesh(new THREE.ConeGeometry(2.55, 5, 4), wood, ship, [0, 1.2, -7], [Math.PI / 2, Math.PI / 4, 0]);
  mesh(new THREE.BoxGeometry(5.1, 0.3, 8.8), trim, ship, [0, 1.92, 1]);
  mesh(new THREE.BoxGeometry(3.9, 1.5, 3.5), wood, ship, [0, 2.62, 4]);
  mesh(new THREE.BoxGeometry(0.32, 10.8, 0.32), material(0x4b2b1a), ship, [0, 7.2, 0]);
  mesh(new THREE.BoxGeometry(0.22, 7.8, 0.22), material(0x4b2b1a), ship, [0, 5.7, 4.2]);
  mesh(new THREE.PlaneGeometry(7.2, 5.7), sail, ship, [0, 8.6, 0.1], [0, 0, 0]);
  mesh(new THREE.PlaneGeometry(5.1, 3.8), sail, ship, [0, 6.8, 4.3], [0, 0, 0]);
  mesh(new THREE.CylinderGeometry(0.12, 0.12, 8), material(0x3b2418), ship, [0, 10.4, 0], [0, 0, Math.PI / 2]);

  const flag = mesh(new THREE.PlaneGeometry(2.3, 1.25), material(pirate ? 0x151216 : 0x9e2e28), ship, [1.12, 12.4, 0], [0, 0, 0]);
  flag.material.side = THREE.DoubleSide;
  for (const side of [-1, 1]) {
    for (const z of [-2.4, 0, 2.4]) {
      const cannon = mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.4, 8), material(0x20252a, 0.35), ship, [side * 2.55, 2.1, z], [0, 0, Math.PI / 2]);
      cannon.rotation.z = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
  }
  ship.scale.setScalar(scale);
  return ship;
}

const player = createShip({ scale: 0.55 });
player.position.set(0, 0.25, 32);
scene.add(player);

function createPalm(parent, x, z, scale = 1) {
  const trunk = mesh(new THREE.CylinderGeometry(0.18, 0.32, 4.5, 7), material(0x7a4b25), parent, [x, 3.1, z], [0.12, 0, -0.08]);
  const crown = new THREE.Group();
  crown.position.copy(trunk.position).add(new THREE.Vector3(0.22, 2.1, 0));
  parent.add(crown);
  for (let i = 0; i < 6; i += 1) {
    const leaf = mesh(new THREE.ConeGeometry(0.7, 4, 4), material(0x2f713b), crown, [0, 0, 0], [Math.PI / 2, 0, (i / 6) * Math.PI * 2]);
    leaf.scale.set(0.55, 1, 0.18);
  }
  crown.scale.setScalar(scale);
}

function createIsland(x, z, radius, index) {
  const group = new THREE.Group();
  group.position.set(x, -0.8, z);
  scene.add(group);
  mesh(new THREE.CylinderGeometry(radius * 0.72, radius, 3.2, 11), material(0xd8bc76), group, [0, 0.2, 0]);
  mesh(new THREE.CylinderGeometry(radius * 0.58, radius * 0.72, 2.1, 10), material(0x4d843e), group, [0, 2.3, 0]);
  const rockCount = Math.max(3, Math.floor(radius / 2));
  for (let i = 0; i < rockCount; i += 1) {
    const angle = (i / rockCount) * Math.PI * 2 + index;
    mesh(new THREE.DodecahedronGeometry(0.8 + (i % 3) * 0.35, 0), material(0x6f6a58), group, [Math.cos(angle) * radius * 0.65, 3.2, Math.sin(angle) * radius * 0.65]);
  }
  createPalm(group, -radius * 0.18, 0.5, 0.9);
  if (radius > 7) createPalm(group, radius * 0.25, -1.2, 0.75);

  const beacon = new THREE.Group();
  beacon.position.set(0, 5.2, 0);
  const ring = mesh(new THREE.TorusGeometry(1.1, 0.15, 8, 24), material(0xffc45d, 0.2), beacon, [0, 0, 0], [Math.PI / 2, 0, 0]);
  ring.material.emissive = new THREE.Color(0xd3841c);
  ring.material.emissiveIntensity = 2.5;
  const glow = new THREE.PointLight(0xffb647, 24, 24, 2);
  beacon.add(glow);
  group.add(beacon);
  islands.push({ group, radius, beacon, collected: false, index });
}

[
  [-58, -42, 8], [55, -68, 7], [78, 24, 9], [-70, 58, 8], [6, -105, 7],
].forEach(([x, z, radius], i) => createIsland(x, z, radius, i));

function createPort() {
  const port = new THREE.Group();
  port.position.set(0, 0, 50);
  scene.add(port);
  for (const x of [-5, 5]) {
    mesh(new THREE.BoxGeometry(2.2, 1, 18), material(0x6b4329), port, [x, 0.35, 0]);
    for (const z of [-7, -2, 3, 8]) mesh(new THREE.CylinderGeometry(0.2, 0.25, 2.8, 8), material(0x3c2b1c), port, [x, -0.7, z]);
  }
  const arch = mesh(new THREE.TorusGeometry(6.8, 0.4, 8, 24, Math.PI), material(0xd2aa61), port, [0, 4.2, 9], [0, 0, 0]);
  arch.scale.y = 1.3;
  const light = new THREE.PointLight(0xffcf78, 16, 30);
  light.position.set(0, 4, 5);
  port.add(light);
  return port;
}
const port = createPort();

function createEnemy(x, z, phase, patrolRadius = 10) {
  const ship = createShip({ pirate: true, scale: 0.72 });
  ship.position.set(x, 0.18, z);
  scene.add(ship);
  enemies.push({
    ship,
    phase,
    health: 3,
    maxHealth: 3,
    fireCooldown: 1.5 + (phase % 2.8),
    active: true,
    spawn: new THREE.Vector3(x, 0.18, z),
    patrolRadius,
    patrolSpeed: 0.2 + (phase % 1.7) * 0.035,
  });
}
[
  [-28, -72, 0.4, 11],
  [62, 62, 2.1, 13],
  [-92, 8, 4.4, 10],
  [96, -42, 1.2, 12],
  [-45, 98, 3.3, 11],
  [18, -125, 5.1, 14],
  [118, 36, 0.8, 10],
  [-118, -34, 2.8, 12],
  [42, 120, 4.9, 11],
  [-12, -138, 6.2, 13],
  [82, -104, 1.7, 12],
  [-86, -106, 3.8, 13],
  [132, -6, 5.6, 10],
  [-132, 48, 0.9, 11],
  [6, 118, 2.9, 14],
  [108, 100, 4.7, 10],
  [-110, 112, 6.8, 12],
  [52, -12, 7.6, 9],
  [-60, -8, 8.4, 9],
  [22, 74, 9.2, 11],
].forEach(([x, z, phase, patrolRadius]) => createEnemy(x, z, phase, patrolRadius));

function createMapItem(type, x, z, phase) {
  const group = new THREE.Group();
  const colors = { repair: 0x63d7b0, rum: 0xe3a14b, chart: 0x79c8f2, powder: 0xf06f55 };
  const glow = colors[type];
  if (type === 'repair') {
    mesh(new THREE.BoxGeometry(1.8, 1.4, 1.8), material(0x9b6b3f), group, [0, 0, 0]);
    mesh(new THREE.BoxGeometry(0.35, 1.7, 0.35), material(0xe6eee7), group, [0, 0.9, 0]);
    mesh(new THREE.BoxGeometry(1.7, 0.35, 0.35), material(0xe6eee7), group, [0, 0.9, 0]);
  } else if (type === 'rum') {
    mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.8, 10), material(0x85512f), group);
    mesh(new THREE.TorusGeometry(0.92, 0.08, 6, 16), material(0xd8b36b), group, [0, 0.45, 0], [Math.PI / 2, 0, 0]);
  } else if (type === 'chart') {
    mesh(new THREE.PlaneGeometry(2.2, 1.6), material(0xe8d29b), group, [0, 0, 0], [-Math.PI / 2, 0, 0]);
  } else {
    mesh(new THREE.SphereGeometry(0.85, 12, 12), material(0x24292e), group);
    mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.7, 6), material(0xe2a24a), group, [0, 0.9, 0], [0.2, 0, 0.2]);
  }
  const light = new THREE.PointLight(glow, 11, 16, 2);
  light.userData.baseIntensity = 11;
  light.position.y = 2;
  group.add(light);
  group.position.set(x, 2.2, z);
  scene.add(group);
  items.push({ type, group, phase, collected: false, spawn: new THREE.Vector3(x, 2.2, z) });
}

[
  ['repair', -18, -48], ['rum', 32, -36], ['chart', 72, -92], ['powder', -82, -72],
  ['repair', 95, 72], ['rum', -104, 28], ['chart', -42, 82], ['powder', 24, -112],
  ['repair', 54, 8], ['rum', -8, 92], ['chart', 112, -12], ['powder', -65, 10],
].forEach(([type, x, z], index) => createMapItem(type, x, z, index * 0.7));

function setItemVisual(item, visible) {
  item.group.visible = true;
  item.group.position.copy(visible ? item.spawn : hiddenItemPosition);
  item.group.traverse((child) => {
    if (child.isLight) {
      child.visible = visible;
      child.intensity = visible ? child.userData.baseIntensity : 0;
    }
  });
}

function createStorm(x, z, radius) {
  const cloud = new THREE.Group();
  cloud.position.set(x, 20, z);
  for (let i = 0; i < 11; i += 1) {
    const puff = mesh(new THREE.DodecahedronGeometry(4 + (i % 4), 1), material(0x35434d), cloud, [(i - 5) * 2.8, Math.sin(i) * 2, Math.cos(i * 2) * 4]);
    puff.material.transparent = true;
    puff.material.opacity = 0.83;
  }
  scene.add(cloud);
  storms.push({ cloud, center: new THREE.Vector3(x, 0, z), radius, phase: Math.random() * 6 });
}
createStorm(-22, -18, 18);
createStorm(44, -15, 15);

const starGeo = new THREE.BufferGeometry();
const starPositions = [];
for (let i = 0; i < 250; i += 1) starPositions.push((Math.random() - 0.5) * 600, 65 + Math.random() * 100, (Math.random() - 0.5) * 600);
starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xfff2c8, size: 0.55, transparent: true, opacity: 0 }));
scene.add(stars);

function spawnSplash(position, color = 0xbcecff, count = 10) {
  const mat = cachedParticleMaterial(color, 0.72);
  const actualCount = scaledEffectCount(count);
  for (let i = 0; i < actualCount; i += 1) {
    const life = 0.8 + Math.random() * 0.6;
    const drop = particleMesh(particleGeometry.splash, mat, tempParticlePosition.set(position.x, 0.4, position.z), 0.08 + Math.random() * 0.12);
    addParticle(drop, (Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 5, life, drop.scale.x);
  }
}

function spawnExplosion(position, radius = 1, count = 24) {
  const burst = position.clone();
  burst.y = Math.max(1.2, burst.y);
  const colors = [0xfff0a6, 0xff9b43, 0xe64f35, 0x2f3740];
  const actualCount = scaledEffectCount(count, 4);
  for (let i = 0; i < actualCount; i += 1) {
    const color = colors[i % colors.length];
    const baseScale = (0.12 + Math.random() * 0.26) * radius;
    const spark = particleMesh(
      particleGeometry.spark,
      cachedParticleMaterial(color, 0.45, i % 4 === 3 ? 0.2 : 1.2, true),
      burst,
      baseScale,
    );
    const angle = Math.random() * Math.PI * 2;
    const force = (5 + Math.random() * 11) * radius;
    addParticle(spark, Math.cos(angle) * force, 4 + Math.random() * 8, Math.sin(angle) * force, 0.75 + Math.random() * 0.8, baseScale, 1.35);
  }
  for (let i = 0; i < 2; i += 1) {
    const ring = particleMesh(
      particleGeometry.ring,
      cachedParticleMaterial(i ? 0xffe4a2 : 0xff673d, 0.3, 1.5, true),
      tempParticlePosition.set(burst.x, 0.45 + i * 0.25, burst.z),
      radius * (1.5 + i * 0.8),
      [Math.PI / 2, 0, 0],
    );
    addParticle(ring, 0, 0.25, 0, 0.7, ring.scale.x, 0.7, 1.9 + i * 0.7);
  }
  const light = effectLight(0xff9b45, 45 * radius, 28 * radius, 2, burst);
  if (light) addParticle(light, 0, 0, 0, 0.32, 1);
}

function spawnShockwave(position, radius = 1, rings = 2) {
  const base = tempParticlePosition.set(position.x, Math.max(0.45, position.y), position.z);
  const colors = [0x94f4ff, 0xffe4a2, 0xff673d];
  for (let i = 0; i < rings; i += 1) {
    const ring = particleMesh(
      particleGeometry.ring,
      cachedParticleMaterial(colors[i % colors.length], 0.28, 1.8, true),
      base,
      radius * (2.25 + i * 0.85),
      [Math.PI / 2, 0, 0],
    );
    addParticle(ring, 0, 0.18, 0, 0.85 + i * 0.12, ring.scale.x, 0.95 + i * 0.12, 2.5 + i * 0.55);
  }
  const light = effectLight(0x64e6ff, 38 * radius, 34 * radius, 2, base);
  if (light) addParticle(light, 0, 0, 0, 0.42, 1);
}

function spawnMuzzleFlash(position, direction, hostile = false) {
  const flashColor = hostile ? 0xe84d38 : 0xffb25a;
  const flash = particleMesh(
    particleGeometry.muzzle,
    cachedParticleMaterial(flashColor, 0.28, 2, true),
    tempParticlePosition.set(position.x, position.y, position.z),
  );
  flash.quaternion.setFromUnitVectors(muzzleUpAxis, direction);
  flash.position.addScaledVector(direction, 1.3);
  addParticle(flash, direction.x * 5, direction.y * 5, direction.z * 5, 0.16, flash.scale.x);
  spawnSplash(position, hostile ? 0xd54e3b : 0xffb66c, compactDevice ? 1 : 2);
}

function playTone(frequency, duration, volume = 0.035, type = 'sine', delay = 0) {
  if (!audioContext || musicMuted) return;
  const start = audioContext.currentTime + delay;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(musicGain);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);
}

function playDrum(frequency, duration, volume = 0.08, delay = 0) {
  if (!audioContext || musicMuted) return;
  const start = audioContext.currentTime + delay;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = 'square';
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(28, frequency * 0.35), start + duration);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(musicGain);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

function ensureCannonSoundBuffer() {
  if (cannonSoundBuffer || !audioContext) return;
  const duration = 0.25;
  const sampleRate = audioContext.sampleRate;
  const buffer = audioContext.createBuffer(1, Math.ceil(sampleRate * duration), sampleRate);
  const data = buffer.getChannelData(0);
  let phase = 0;
  for (let i = 0; i < data.length; i += 1) {
    const t = i / sampleRate;
    const progress = t / duration;
    const frequency = 90 * (30 / 90) ** progress;
    phase += (frequency / sampleRate) * Math.PI * 2;
    const saw = ((phase / Math.PI) % 2) - 1;
    data[i] = saw * 0.11 * (1 - progress) ** 2.4;
  }
  cannonSoundBuffer = buffer;
}

async function startAudio() {
  audioContext ??= new AudioContext();
  musicGain ??= audioContext.createGain();
  cannonGain ??= audioContext.createGain();
  if (!musicGain.__connected) {
    musicGain.gain.value = 1;
    musicGain.connect(audioContext.destination);
    musicGain.__connected = true;
  }
  if (!cannonGain.__connected) {
    cannonGain.gain.value = 1;
    cannonGain.connect(audioContext.destination);
    cannonGain.__connected = true;
  }
  ensureCannonSoundBuffer();
  if (audioContext.state !== 'running') await audioContext.resume();
  if (!musicMuted) {
    bgm.muted = false;
    bgmStartPromise ??= bgmReady
      .then(() => bgm.play())
      .catch(() => {
        bgmStartPromise = null;
      });
  }
  ui.audioToggle.textContent = '♫';
  ui.audioToggle.classList.remove('muted');
  ui.audioToggle.setAttribute('aria-label', '배경 음악 끄기');
}

function playCannonSound() {
  if (!audioContext || musicMuted) return;
  if (audioContext.currentTime - lastCannonSoundAt < 0.12) return;
  lastCannonSoundAt = audioContext.currentTime;
  ensureCannonSoundBuffer();
  if (!cannonSoundBuffer) return;
  const source = audioContext.createBufferSource();
  source.buffer = cannonSoundBuffer;
  source.connect(cannonGain ?? audioContext.destination);
  source.start();
}

function acquireCannonballMesh(hostile) {
  const type = hostile ? 'hostile' : 'friendly';
  const pool = cannonballPools[type];
  const ball = pool.pop() ?? new THREE.Mesh(
    hostile ? particleGeometry.cannonHostile : particleGeometry.cannonFriendly,
    cachedParticleMaterial(hostile ? 0xd6442f : 0xff7c35, 0.18, hostile ? 0.7 : 1.8),
  );
  if (!ball.userData.cannonballType) {
    ball.userData.cannonballType = type;
    ball.castShadow = true;
    ball.receiveShadow = false;
    const ember = new THREE.PointLight(hostile ? 0xd6442f : 0xff863d, hostile ? 8 : 20, hostile ? 7 : 12, 2);
    ember.userData.baseIntensity = hostile ? 8 : 20;
    ember.visible = false;
    ember.intensity = 0;
    ball.add(ember);
    scene.add(ball);
    poolStats.cannonballsCreated += 1;
  } else {
    poolStats.cannonballsReused += 1;
  }
  ball.visible = true;
  ball.position.set(0, 0, 0);
  ball.rotation.set(0, 0, 0);
  ball.scale.setScalar(1);
  for (const child of ball.children) {
    if (!child.isLight) continue;
    child.visible = false;
    child.intensity = 0;
  }
  return ball;
}

function releaseCannonballMesh(ball) {
  const type = ball.userData?.cannonballType;
  if (!type) return;
  ball.visible = false;
  ball.position.set(0, -9999, 0);
  for (const child of ball.children) {
    if (child.isLight) {
      child.visible = false;
      child.intensity = 0;
    }
  }
  cannonballPools[type].push(ball);
  poolStats.cannonballsReleased += 1;
}

function fireCannon(owner, hostile = false) {
  if (owner === player && (!game.started || game.ended || game.cannonCooldown > 0)) return false;
  const activeBalls = cannonballs.length;
  const sameSideBalls = cannonballs.reduce((count, ball) => count + (ball.hostile === hostile ? 1 : 0), 0);
  if (activeBalls >= MAX_CANNONBALLS) return false;
  if (hostile && sameSideBalls >= MAX_HOSTILE_CANNONBALLS) return false;
  if (!hostile && sameSideBalls >= MAX_FRIENDLY_CANNONBALLS) return false;
  const direction = tempFireDirection.copy(forwardAxis).applyQuaternion(owner.quaternion).normalize();
  const ball = acquireCannonballMesh(hostile);
  ball.position.copy(owner.position).addScaledVector(direction, 5).add(cannonballLaunchOffset);
  const shot = cannonballStatePool.pop() ?? { velocity: new THREE.Vector3() };
  shot.object = ball;
  shot.velocity.copy(direction).multiplyScalar(hostile ? 25 : 39);
  shot.hostile = hostile;
  shot.life = 4;
  shot.trailTimer = 0;
  cannonballs.push(shot);
  spawnMuzzleFlash(ball.position, direction, hostile);
  if (owner === player) {
    game.cannonCooldown = game.supplies > 0 ? 0.28 : 0.45;
    playCannonSound();
  }
  return true;
}

function collectItem(item) {
  item.collected = true;
  setItemVisual(item, false);
  shadowCooldownUntil = Math.max(shadowCooldownUntil, game.time + 1.4);
  // Keep pickup work allocation-free on the render frame. Creating a temporary
  // dispatch object and first-use 3D particles caused visible mobile frame spikes.
  if (item.type === 'repair') {
    game.health = Math.min(100, game.health + 28);
    chargeUltimate(6);
    showDanger('수리 키트 — 선체 회복!');
  } else if (item.type === 'rum') {
    game.score += 300;
    chargeUltimate(8);
    showDanger('럼주 보급 — 항해 점수 +300');
  } else if (item.type === 'chart') {
    game.score += 450;
    chargeUltimate(10);
    showDanger('비밀 해도 — 항로 발견!');
  } else {
    game.supplies += 1;
    chargeUltimate(15);
    showDanger('화약 상자 — 대포 재장전 강화!');
  }
}

function chargeUltimate(amount) {
  game.ultimateCharge = Math.min(100, game.ultimateCharge + amount * ULTIMATE_CHARGE_MULTIPLIER);
}

function sinkEnemy(enemy, reward = true) {
  enemy.active = false;
  enemy.ship.visible = false;
  game.score += 500;
  if (reward) chargeUltimate(18);
  const sinkPosition = enemy.ship.position.clone();
  requestAnimationFrame(() => spawnExplosion(sinkPosition, 1.35, 18));
  showDanger('해적선 격침!');
}

function useUltimate() {
  if (!game.started || game.ended || game.ultimateCharge < 100) return false;
  game.ultimateCharge = 0;
  showDanger('왕실 폭풍 포격 — 전 해역 초토화!');
  spawnShockwave(player.position, 2.1, compactDevice ? 2 : 3);
  spawnExplosion(player.position, 2.45, compactDevice ? 24 : 34);
  if (audioContext && !musicMuted) {
    playDrum(132, 0.32, 0.16);
    playTone(392, 0.24, 0.09, 'square', 0.02);
    playTone(523.25, 0.28, 0.08, 'triangle', 0.14);
    playDrum(86, 0.42, 0.13, 0.18);
    playTone(659.25, 0.32, 0.07, 'sawtooth', 0.24);
  }

  const delayedStrikes = [];
  for (const enemy of enemies) {
    if (!enemy.active) continue;
    const distance = enemy.ship.position.distanceTo(player.position);
    if (distance > ULTIMATE_TARGET_RANGE) continue;
    enemy.health -= distance < ULTIMATE_TARGET_RANGE ? 3 : 2;
    const strikePosition = enemy.ship.position.clone();
    delayedStrikes.push({ position: strikePosition, distance });
    spawnExplosion(strikePosition, 1.15, compactDevice ? 10 : 16);
    if (distance < 70 || delayedStrikes.length % 2 === 0) {
      spawnShockwave(strikePosition, 1.05, compactDevice ? 1 : 2);
    }
    if (enemy.health <= 0) sinkEnemy(enemy, false);
  }

  delayedStrikes
    .sort((a, b) => a.distance - b.distance)
    .slice(0, compactDevice ? 4 : 7)
    .forEach(({ position }, index) => {
      window.setTimeout(() => {
        if (!game.started || game.ended) return;
        spawnExplosion(position, 0.9 + index * 0.04, compactDevice ? 5 : 8);
        if (index % 2 === 0) spawnShockwave(position, 0.8, 1);
      }, 80 + index * 70);
    });

  for (let i = cannonballs.length - 1; i >= 0; i -= 1) {
    const ball = cannonballs[i];
    if (!ball.hostile || ball.object.position.distanceTo(player.position) > 90) continue;
    spawnSplash(ball.object.position, 0x94f4ff, 10);
    releaseCannonballMesh(ball.object);
    ball.object = null;
    cannonballStatePool.push(ball);
    cannonballs.splice(i, 1);
  }
  return true;
}

function damage(amount, message) {
  if (game.hitCooldown > 0 || game.ended) return;
  game.health = Math.max(0, game.health - amount);
  game.hitCooldown = 0.75;
  showDanger(message);
  spawnSplash(player.position, 0xff8a5c, 8);
  if (game.health <= 0) endGame(false);
}

let dangerTimer;
let dangerFlushTimer;
let lastDangerAt = 0;
let pendingDangerText = '';

function applyDangerText(text) {
  const now = performance.now();
  if (ui.danger.textContent !== text) ui.danger.textContent = text;
  if (!ui.danger.classList.contains('show') || now - lastDangerAt > 220) {
    ui.danger.classList.add('show');
  }
  lastDangerAt = now;
  clearTimeout(dangerTimer);
  dangerTimer = setTimeout(() => ui.danger.classList.remove('show'), 1600);
}

function showDanger(text) {
  const now = performance.now();
  const wait = 190 - (now - lastDangerAt);
  if (wait > 0) {
    pendingDangerText = text;
    clearTimeout(dangerFlushTimer);
    dangerFlushTimer = setTimeout(() => {
      applyDangerText(pendingDangerText);
      pendingDangerText = '';
    }, wait);
    return;
  }
  applyDangerText(text);
}

function expandMission(duration = 5000) {
  ui.mission.classList.remove('collapsed');
  ui.mission.setAttribute('aria-expanded', 'true');
  clearTimeout(missionTimer);
  missionTimer = window.setTimeout(() => {
    ui.mission.classList.add('collapsed');
    ui.mission.setAttribute('aria-expanded', 'false');
  }, duration);
}

function collectTreasure(island) {
  island.collected = true;
  island.beacon.visible = false;
  game.treasures += 1;
  game.score += 750;
  chargeUltimate(12);
  spawnSplash(island.group.position, 0xffc45d, 12);
  showDanger(`보물 발견 — ${game.treasures} / 5`);
  if (game.treasures === islands.length) {
    ui.missionTitle.textContent = '왕실 항구로 귀환하십시오';
    ui.missionDetail.textContent = '남쪽의 황금 부두가 당신의 귀환을 기다립니다.';
    expandMission();
  }
}

function endGame(victory) {
  game.ended = true;
  game.speed = 0;
  ui.endKicker.textContent = victory ? 'VOYAGE COMPLETE' : 'THE SEA CLAIMS ANOTHER';
  ui.endTitle.textContent = victory ? '전설의 항해자' : '침몰한 꿈';
  ui.endMessage.textContent = victory
    ? `모든 보물을 되찾았습니다. 항해 점수 ${String(Math.round(game.score)).padStart(4, '0')}점으로 왕실의 전설이 되었습니다.`
    : '선체가 파괴되었습니다. 바람과 파도를 읽어 다시 도전하십시오.';
  ui.endScreen.classList.remove('hidden');
}

function updateOcean(time) {
  if (time - lastOceanUpdate < 0.08) return;
  lastOceanUpdate = time;
  const positions = oceanGeo.attributes.position.array;
  for (let i = 0; i < positions.length; i += 3) {
    const x = oceanBase[i];
    const z = oceanBase[i + 2];
    positions[i + 1] = Math.sin(x * 0.095 + time * 1.2) * 0.38 + Math.cos(z * 0.075 + time * 0.85) * 0.32;
  }
  oceanGeo.attributes.position.needsUpdate = true;
}

function shapeInput(value) {
  return Math.sign(value) * Math.min(1, Math.max(0, (Math.abs(value) - 0.025) / 0.975) ** 0.72);
}

function updatePlayer(dt, time) {
  const forward = keys.has('KeyW') || keys.has('ArrowUp');
  const reverse = keys.has('KeyS') || keys.has('ArrowDown');
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  const keyboardTurn = (left ? 1 : 0) - (right ? 1 : 0);
  const turn = joystick.active ? -shapeInput(joystick.x) : keyboardTurn;
  const throttle = joystick.active ? -shapeInput(joystick.y) : (forward ? 1 : reverse ? -1 : 0);
  const acceleration = throttle > 0.025 ? 15 * throttle : throttle < -0.025 ? 12 * throttle : -Math.sign(game.speed) * 2.2;
  game.speed = THREE.MathUtils.clamp(game.speed + acceleration * dt, -3.2, 11.5);
  if (Math.abs(throttle) <= 0.025 && Math.abs(game.speed) < 0.12) game.speed = 0;
  game.heading += turn * dt * (1.35 + Math.abs(game.speed) * 0.045) * (game.speed >= 0 ? 1 : -1);
  player.rotation.y = game.heading;
  const direction = tempDirection.copy(forwardAxis).applyAxisAngle(yAxis, game.heading);
  player.position.addScaledVector(direction, game.speed * dt);
  player.position.x = THREE.MathUtils.clamp(player.position.x, -145, 145);
  player.position.z = THREE.MathUtils.clamp(player.position.z, -145, 145);
  player.position.y = 0.28 + Math.sin(time * 2.2 + player.position.x * 0.04) * 0.18;
  player.rotation.z = THREE.MathUtils.lerp(player.rotation.z, -turn * 0.09 + Math.sin(time * 1.5) * 0.018, dt * 3);
  if (Math.abs(game.speed) > 2.5 && Math.random() < dt * 10) {
    spawnSplash(tempPosition.copy(player.position).addScaledVector(direction, -5), 0xc9f4ff, 2);
  }

  for (const island of islands) {
    const reefRange = island.radius + 3.6;
    const distanceSq = player.position.distanceToSquared(island.group.position);
    if (distanceSq < reefRange * reefRange) {
      if (!island.collected) collectTreasure(island);
      const distance = Math.sqrt(distanceSq);
      if (distance < island.radius + 0.7) damage(7, '암초 충돌!');
    }
    island.beacon.rotation.y += dt * 1.5;
    island.beacon.position.y = 5.2 + Math.sin(time * 2 + island.index) * 0.5;
  }
  for (const item of items) {
    if (item.collected) continue;
    item.group.rotation.y += dt * 1.2;
    item.group.position.y = item.spawn.y + Math.sin(time * 2.4 + item.phase) * 0.45;
    if (player.position.distanceToSquared(item.group.position) < 17.64) collectItem(item);
  }
  if (game.treasures === islands.length && player.position.distanceToSquared(port.position) < 144) endGame(true);
}

function updateEnemies(dt, time) {
  for (const enemy of enemies) {
    if (!enemy.active) continue;
    const toPlayer = tempToPlayer.subVectors(player.position, enemy.ship.position);
    const distanceSq = toPlayer.lengthSq();
    if (distanceSq < ENEMY_CHASE_RANGE_SQ) {
      const desired = Math.atan2(-toPlayer.x, -toPlayer.z);
      enemy.ship.rotation.y = THREE.MathUtils.lerp(enemy.ship.rotation.y, desired, dt * 0.8);
      if (distanceSq > ENEMY_STANDOFF_RANGE_SQ) enemy.ship.position.addScaledVector(toPlayer.normalize(), dt * 3.7);
      enemy.fireCooldown -= dt;
      if (distanceSq < ENEMY_FIRE_RANGE_SQ && enemy.fireCooldown <= 0) {
        fireCannon(enemy.ship, true);
        enemy.fireCooldown = 3.15 + Math.random() * 2.35;
      }
    } else {
      tempPatrolTarget.set(
        enemy.spawn.x + Math.sin(time * enemy.patrolSpeed + enemy.phase) * enemy.patrolRadius,
        enemy.spawn.y,
        enemy.spawn.z + Math.cos(time * (enemy.patrolSpeed * 0.85) + enemy.phase) * enemy.patrolRadius * 0.72,
      );
      tempDirection.subVectors(tempPatrolTarget, enemy.ship.position);
      const patrolDistanceSq = tempDirection.lengthSq();
      if (patrolDistanceSq > 0.04) {
        const desired = Math.atan2(-tempDirection.x, -tempDirection.z);
        enemy.ship.rotation.y = THREE.MathUtils.lerp(enemy.ship.rotation.y, desired, dt * 0.9);
        enemy.ship.position.addScaledVector(tempDirection.normalize(), Math.min(dt * 3.1, Math.sqrt(patrolDistanceSq)));
      }
    }
    enemy.ship.position.y = 0.2 + Math.sin(time * 2 + enemy.phase) * 0.14;
  }
}

function updateCannonballs(dt) {
  for (let i = cannonballs.length - 1; i >= 0; i -= 1) {
    const ball = cannonballs[i];
    ball.life -= dt;
    ball.trailTimer -= dt;
    ball.velocity.y -= 2.5 * dt;
    ball.object.position.addScaledVector(ball.velocity, dt);
    if (ball.trailTimer <= 0 && particles.length < MAX_PARTICLES * 0.72) {
      ball.trailTimer = ball.hostile ? 0.18 : 0.2;
      const trailColor = ball.hostile ? 0xbf3b32 : 0xffa45a;
      const life = ball.hostile ? 0.4 : 0.62;
      const baseScale = ball.hostile ? 0.11 : 0.16;
      const trail = particleMesh(
        particleGeometry.trail,
        cachedParticleMaterial(trailColor, 0.55, ball.hostile ? 0.5 : 1.1, true),
        ball.object.position,
        baseScale,
      );
      addParticle(trail, (Math.random() - 0.5) * 1.8, 0.6 + Math.random() * 1.4, (Math.random() - 0.5) * 1.8, life, baseScale);
    } else if (ball.trailTimer <= 0) {
      ball.trailTimer = ball.hostile ? 0.22 : 0.24;
    }
    if (ball.hostile && ball.object.position.distanceToSquared(player.position) < 14.44) {
      damage(14, '해적의 포격!');
      ball.life = 0;
    } else if (!ball.hostile) {
      for (const enemy of enemies) {
        if (enemy.active && ball.object.position.distanceToSquared(enemy.ship.position) < 16) {
          enemy.health -= 1;
          chargeUltimate(7);
          ball.life = 0;
          spawnExplosion(enemy.ship.position, enemy.health <= 0 ? 1.55 : 1.05, enemy.health <= 0 ? 20 : 12);
          if (enemy.health <= 0) sinkEnemy(enemy);
          break;
        }
      }
    }
    if (ball.object.position.y < 0 || ball.life <= 0) {
      spawnSplash(ball.object.position, ball.hostile ? 0xff7b64 : 0xffcf8a, ball.hostile ? 5 : 6);
      if (!ball.hostile) spawnExplosion(ball.object.position, 0.52, 4);
      releaseCannonballMesh(ball.object);
      ball.object = null;
      cannonballStatePool.push(ball);
      cannonballs.splice(i, 1);
    }
  }
}

function updateStorms(dt, time) {
  for (const storm of storms) {
    storm.cloud.position.x += Math.sin(time * 0.08 + storm.phase) * dt * 0.5;
    storm.cloud.rotation.y += dt * 0.025;
    storm.center.x = storm.cloud.position.x;
    const distance = player.position.distanceTo(storm.center);
    if (distance < storm.radius) {
      game.speed *= 1 - dt * 0.55;
      if (Math.random() < dt * 0.35) damage(5, '폭풍 해역 — 선체 손상!');
      scene.fog.density = THREE.MathUtils.lerp(scene.fog.density, 0.018, dt * 2);
    }
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const particle = particles[i];
    particle.life -= dt;
    if (particle.object.isLight) {
      particle.object.intensity *= Math.max(0, 1 - dt * 5.5);
    } else {
      particle.velocity.y -= 7 * dt;
      particle.object.position.addScaledVector(particle.velocity, dt);
      if (particle.expand) particle.object.scale.addScalar(particle.expand * dt);
      else {
        const lifeRatio = Math.max(0, particle.life / (particle.maxLife ?? 1));
        particle.object.scale.setScalar(Math.max(0.01, (particle.baseScale ?? 1) * lifeRatio));
      }
    }
    if (particle.life <= 0) {
      releaseParticleState(particle);
      particles.splice(i, 1);
    }
  }
}

function updateCamera(dt) {
  tempCameraOffset.set(0, 22, 38).applyAxisAngle(yAxis, game.heading);
  tempCameraTarget.copy(player.position).add(tempCameraOffset);
  camera.position.lerp(tempCameraTarget, 1 - Math.pow(0.001, dt));
  tempCameraLook.copy(player.position).add(cameraLookOffset);
  camera.lookAt(tempCameraLook);
}

function updateHUD() {
  const health = String(Math.ceil(game.health));
  if (hudState.health !== health) {
    hudState.health = health;
    ui.health.textContent = health;
  }
  const healthWidth = `${Math.round(game.health)}%`;
  if (hudState.healthWidth !== healthWidth) {
    hudState.healthWidth = healthWidth;
    ui.healthBar.style.width = healthWidth;
  }
  const treasure = String(game.treasures);
  if (hudState.treasure !== treasure) {
    hudState.treasure = treasure;
    ui.treasure.textContent = treasure;
  }
  const score = String(Math.round(game.score)).padStart(4, '0');
  if (hudState.score !== score) {
    hudState.score = score;
    ui.score.textContent = score;
  }
  const supplies = String(game.supplies);
  if (hudState.supplies !== supplies) {
    hudState.supplies = supplies;
    ui.supplies.textContent = supplies;
  }
  const ultimate = `${Math.round(game.ultimateCharge)}%`;
  if (hudState.ultimate !== ultimate) {
    hudState.ultimate = ultimate;
    ui.ultimate.textContent = ultimate;
  }
  if (hudState.ultimateWidth !== ultimate) {
    hudState.ultimateWidth = ultimate;
    ui.ultimateBar.style.width = ultimate;
  }
  const ultimateReady = game.ultimateCharge >= 100;
  if (hudState.ultimateReady !== ultimateReady) {
    hudState.ultimateReady = ultimateReady;
    ui.ultimateStat.classList.toggle('ready', ultimateReady);
    ui.ultimateButton.classList.toggle('ready', ultimateReady);
  }
  const degrees = ((-THREE.MathUtils.radToDeg(game.heading) % 360) + 360) % 360;
  const heading = `${String(Math.round(degrees)).padStart(3, '0')}°`;
  if (hudState.heading !== heading) {
    hudState.heading = heading;
    ui.heading.textContent = heading;
  }
  const needle = `rotate(${Math.round(degrees)}deg)`;
  if (hudState.needle !== needle) {
    hudState.needle = needle;
    ui.needle.style.transform = needle;
  }
}

function updateSky(time) {
  const dayCycle = (Math.sin(time * 0.018 - 0.7) + 1) / 2;
  skyFrameColor.lerpColors(skyNightColor, skyDayColor, dayCycle);
  scene.background.copy(skyFrameColor);
  scene.fog.color.copy(skyFrameColor);
  scene.fog.density = THREE.MathUtils.lerp(scene.fog.density, 0.0065, 0.015);
  stars.material.opacity = THREE.MathUtils.clamp((0.45 - dayCycle) * 2.4, 0, 0.8);
  sun.intensity = 1 + dayCycle * 2.2;
}

async function warmCombatRenderVariants() {
  if (combatRenderWarmed) return;
  combatRenderWarmed = true;
  const warmPosition = player.position.clone();
  const offscreen = hiddenItemPosition;
  const warmParticles = [];
  const warmCannonballs = [];
  const warmLights = [];
  const particlePlan = [
    [particleGeometry.splash, cachedParticleMaterial(0xffcf8a, 0.72), 12, 0.12],
    [particleGeometry.trail, cachedParticleMaterial(0xffa45a, 0.55, 1.1, true), 12, 0.16],
    [particleGeometry.spark, cachedParticleMaterial(0xff9b43, 0.45, 1.2, true), 12, 0.16],
    [particleGeometry.ring, cachedParticleMaterial(0xff673d, 0.3, 1.5, true), 4, 0.8],
    [particleGeometry.ring, cachedParticleMaterial(0x94f4ff, 0.28, 1.8, true), 4, 0.9],
    [particleGeometry.muzzle, cachedParticleMaterial(0xffb25a, 0.28, 2, true), 4, 1],
  ];

  for (const [geometry, mat, count, scale] of particlePlan) {
    for (let i = 0; i < count; i += 1) {
      warmParticles.push(particleMesh(
        geometry,
        mat,
        tempParticlePosition.set(warmPosition.x + (i % 6) * 0.1, warmPosition.y + 1 + (i % 3) * 0.08, warmPosition.z - (i % 8) * 0.1),
        scale,
      ));
    }
  }
  for (let i = 0; i < 5; i += 1) {
    const ball = acquireCannonballMesh(false);
    ball.position.set(warmPosition.x + i, warmPosition.y + 2, warmPosition.z - 4 - i);
    warmCannonballs.push(ball);
  }
  for (let i = 0; i < 2; i += 1) {
    const light = effectLight(0xff9b45, 45, 28, 2, tempParticlePosition.set(warmPosition.x + i, warmPosition.y + 2, warmPosition.z - i));
    if (light) warmLights.push(light);
  }

  const setWarmState = (particleCount, cannonballCount, lightCount) => {
    warmParticles.forEach((object, index) => {
      object.visible = index < particleCount;
      object.position.copy(index < particleCount ? warmPosition : offscreen);
    });
    warmCannonballs.forEach((ball, index) => {
      const active = index < cannonballCount;
      ball.visible = active;
      ball.position.copy(active ? warmPosition : offscreen);
      for (const child of ball.children) {
        if (!child.isLight) continue;
        child.visible = false;
        child.intensity = 0;
      }
    });
    projectileLights.forEach((light, index) => {
      const active = index < cannonballCount;
      light.visible = active;
      light.intensity = active ? 20 : 0;
      light.distance = 12;
      light.position.copy(active ? warmPosition : offscreen);
    });
    warmLights.forEach((light, index) => {
      const active = index < lightCount;
      light.visible = active;
      light.intensity = active ? 45 : 0;
      light.position.copy(active ? warmPosition : offscreen);
    });
  };

  const variants = [
    [0, PROJECTILE_LIGHT_LOCKED_SLOTS, 0],
    [6, 2, 1],
    [13, 4, 2],
    [44, 5, 2],
  ];
  for (const [particleCount, cannonballCount, lightCount] of variants) {
    setWarmState(particleCount, cannonballCount, lightCount);
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  for (const object of warmParticles) releaseEffectObject(object);
  for (const ball of warmCannonballs) releaseCannonballMesh(ball);
  for (const light of warmLights) releaseEffectObject(light);

  for (let i = 0; i < PROJECTILE_LIGHT_LOCKED_SLOTS; i += 1) {
    const light = projectileLights[i];
    light.visible = true;
    light.intensity = 20;
    light.distance = 12;
    light.position.copy(warmPosition);
  }
  spawnMuzzleFlash(warmPosition, forwardAxis, false);
  spawnMuzzleFlash(warmPosition, forwardAxis, true);
  spawnExplosion(warmPosition, 0.52, 4);
  spawnExplosion(warmPosition, 1.05, 12);
  spawnExplosion(warmPosition, 1.05, 12);
  spawnExplosion(warmPosition, 1.05, 12);
  spawnExplosion(warmPosition, 1.05, 12);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  while (particles.length) releaseParticleState(particles.pop());

  projectileLights.forEach((light) => {
    light.visible = false;
    light.intensity = 0;
    light.position.copy(offscreen);
  });
}

function animate() {
  const frameStartedAt = performance.now();
  renderFrame += 1;
  const dt = Math.min(clock.getDelta(), 0.04);
  if (game.started && !game.ended) {
    game.time += dt;
    game.cannonCooldown = Math.max(0, game.cannonCooldown - dt);
    game.hitCooldown = Math.max(0, game.hitCooldown - dt);
    game.score += dt * Math.max(0, game.speed) * 0.55;
    if (keys.has('Space')) fireCannon(player);
    profiledStep('player', () => updatePlayer(dt, game.time));
    profiledStep('enemies', () => updateEnemies(dt, game.time));
    profiledStep('cannonballs', () => updateCannonballs(dt));
    profiledStep('storms', () => updateStorms(dt, game.time));
  }
  profiledStep('ocean', () => updateOcean(game.time));
  profiledStep('particles', () => updateParticles(dt));
  profiledStep('projectile-lights', syncProjectileLights);
  profiledStep('camera', () => updateCamera(dt));
  profiledStep('sky', () => updateSky(game.time));
  profiledStep('hud', updateHUD);
  const transientEffectsActive = cannonballs.length > 0 || particles.length > 0;
  const shadowFrame = !compactDevice && renderFrame % SHADOW_UPDATE_INTERVAL === 0;
  renderer.shadowMap.needsUpdate = !transientEffectsActive && shadowFrame && previousFrameCost < 45 && game.time >= shadowCooldownUntil;
  profiledStep('render', () => renderer.render(scene, camera));
  previousFrameCost = performance.now() - frameStartedAt;
  requestAnimationFrame(animate);
}

async function resetGame() {
  Object.assign(game, { started: false, ended: false, speed: 0, heading: 0, health: 100, treasures: 0, score: 0, supplies: 0, time: 0, cannonCooldown: 0, hitCooldown: 0, ultimateCharge: 40 });
  while (cannonballs.length) {
    const ball = cannonballs.pop();
    releaseCannonballMesh(ball.object);
    ball.object = null;
    cannonballStatePool.push(ball);
  }
  while (particles.length) releaseParticleState(particles.pop());
  player.position.set(0, 0.25, 32);
  player.rotation.set(0, 0, 0);
  islands.forEach((island) => { island.collected = false; island.beacon.visible = true; });
  enemies.forEach((enemy) => { enemy.active = true; enemy.health = enemy.maxHealth; enemy.ship.visible = true; enemy.ship.position.copy(enemy.spawn); });
  items.forEach((item) => {
    item.collected = false;
    item.group.position.copy(item.spawn);
    setItemVisual(item, true);
  });
  ui.missionTitle.textContent = '잃어버린 왕관의 보물 5개를 찾으십시오';
  ui.missionDetail.textContent = '빛나는 섬 가까이 항해하면 보물을 발견할 수 있습니다.';
  ui.endScreen.classList.add('hidden');
  bgm.currentTime = 0;
  showDanger('항해 준비 중 — 음악을 불러옵니다');
  try {
    await startAudio();
  } catch {
    showDanger('소리 버튼을 눌러 음악을 시작하세요');
  }
  await warmCombatRenderVariants();
  shadowCooldownUntil = Math.max(shadowCooldownUntil, game.time + STARTUP_SHADOW_COOLDOWN);
  expandMission();
  game.started = true;
  ui.startScreen.classList.add('hidden');
  showDanger('돛을 올려라 — 항해 시작!');
}

ui.startButton.addEventListener('click', resetGame);
ui.restartButton.addEventListener('click', resetGame);
ui.mission.addEventListener('click', () => {
  if (game.started && ui.mission.classList.contains('collapsed')) expandMission();
});
ui.mission.addEventListener('keydown', (event) => {
  if (!['Enter', 'Space'].includes(event.code)) return;
  event.preventDefault();
  if (game.started) expandMission();
});
window.addEventListener('keydown', (event) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.code === 'Space' && !event.repeat) fireCannon(player);
  if (event.code === 'KeyE' && !event.repeat) useUltimate();
});
window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('blur', () => keys.clear());

ui.fireButton.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  fireCannon(player);
});
ui.ultimateButton.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  useUltimate();
});

const joystickElement = ui.joystick;
const joystickKnob = ui.joystickKnob;

function updateJoystick(event) {
  const bounds = joystickElement.getBoundingClientRect();
  const radius = bounds.width * 0.36;
  let x = event.clientX - (bounds.left + bounds.width / 2);
  let y = event.clientY - (bounds.top + bounds.height / 2);
  const length = Math.hypot(x, y);
  if (length > radius) {
    x = (x / length) * radius;
    y = (y / length) * radius;
  }
  joystick.x = x / radius;
  joystick.y = y / radius;
  joystickKnob.style.transform = `translate(${x}px, ${y}px)`;
}

function releaseJoystick(event) {
  if (event && joystick.pointerId !== event.pointerId) return;
  joystick.active = false;
  joystick.pointerId = null;
  joystick.x = 0;
  joystick.y = 0;
  joystickKnob.style.transform = 'translate(0, 0)';
}

joystickElement.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  joystick.active = true;
  joystick.pointerId = event.pointerId;
  joystickElement.setPointerCapture(event.pointerId);
  updateJoystick(event);
});
joystickElement.addEventListener('pointermove', (event) => {
  if (joystick.active && joystick.pointerId === event.pointerId) updateJoystick(event);
});
joystickElement.addEventListener('pointerup', releaseJoystick);
joystickElement.addEventListener('pointercancel', releaseJoystick);

ui.audioToggle.addEventListener('click', () => {
  musicMuted = !musicMuted;
  ui.audioToggle.classList.toggle('muted', musicMuted);
  ui.audioToggle.textContent = musicMuted ? '♩' : '♫';
  ui.audioToggle.setAttribute('aria-pressed', String(musicMuted));
  ui.audioToggle.setAttribute('aria-label', musicMuted ? '배경 음악 켜기' : '배경 음악 끄기');
  if (musicMuted) {
    bgm.pause();
    bgmStartPromise = null;
  }
  if (!musicMuted) startAudio().catch(() => {});
});

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
camera.position.set(0, 18, 62);
camera.lookAt(player.position);
initializeProjectileLights();
initializeEffectLights();

function prewarmRuntimeObjects() {
  const compilePosition = player.position.clone();
  const offscreen = new THREE.Vector3(0, -9999, 0);
  const prewarmMeshes = [
    [particleGeometry.splash, cachedParticleMaterial(0xc9f4ff, 0.72), 32],
    [particleGeometry.splash, cachedParticleMaterial(0xffcf8a, 0.72), 18],
    [particleGeometry.splash, cachedParticleMaterial(0xbcecff, 0.72), 18],
    [particleGeometry.splash, cachedParticleMaterial(0xff8a5c, 0.72), 12],
    [particleGeometry.splash, cachedParticleMaterial(0xff7b64, 0.72), 12],
    [particleGeometry.splash, cachedParticleMaterial(0x94f4ff, 0.72), 12],
    [particleGeometry.splash, cachedParticleMaterial(0xffb66c, 0.72), 10],
    [particleGeometry.splash, cachedParticleMaterial(0xd54e3b, 0.72), 10],
    [particleGeometry.spark, cachedParticleMaterial(0xfff0a6, 0.45, 1.2, true), 20],
    [particleGeometry.spark, cachedParticleMaterial(0xff9b43, 0.45, 1.2, true), 20],
    [particleGeometry.spark, cachedParticleMaterial(0xe64f35, 0.45, 1.2, true), 20],
    [particleGeometry.spark, cachedParticleMaterial(0x2f3740, 0.45, 0.2, true), 20],
    [particleGeometry.trail, cachedParticleMaterial(0xffa45a, 0.55, 1.1, true), 24],
    [particleGeometry.trail, cachedParticleMaterial(0xbf3b32, 0.55, 0.5, true), 24],
    [particleGeometry.ring, cachedParticleMaterial(0xff673d, 0.3, 1.5, true), 8],
    [particleGeometry.ring, cachedParticleMaterial(0xffe4a2, 0.3, 1.5, true), 8],
    [particleGeometry.ring, cachedParticleMaterial(0x94f4ff, 0.28, 1.8, true), 8],
    [particleGeometry.muzzle, cachedParticleMaterial(0xffb25a, 0.28, 2, true), 10],
    [particleGeometry.muzzle, cachedParticleMaterial(0xe84d38, 0.28, 2, true), 10],
  ];

  const compileSamples = [];
  for (let i = particleStatePool.length; i < MAX_PARTICLES; i += 1) {
    particleStatePool.push({ velocity: new THREE.Vector3() });
  }
  for (let i = cannonballStatePool.length; i < MAX_CANNONBALLS; i += 1) {
    cannonballStatePool.push({ velocity: new THREE.Vector3() });
  }
  for (const [geometry, mat, count] of prewarmMeshes) {
    const sample = particleMesh(geometry, mat, compilePosition, 0.01);
    compileSamples.push(sample);
    for (let i = 1; i < count; i += 1) {
      const pooled = particleMesh(geometry, mat, offscreen, 0.01);
      releaseEffectObject(pooled);
    }
  }
  const friendlyCannonballs = [];
  const hostileCannonballs = [];
  const burstLights = [];
  for (let i = 0; i < MAX_FRIENDLY_CANNONBALLS; i += 1) {
    const ball = acquireCannonballMesh(false);
    ball.position.copy(i < 2 ? compilePosition : offscreen);
    friendlyCannonballs.push(ball);
  }
  for (let i = 0; i < MAX_HOSTILE_CANNONBALLS; i += 1) {
    const ball = acquireCannonballMesh(true);
    ball.position.copy(i < 2 ? compilePosition : offscreen);
    hostileCannonballs.push(ball);
  }
  for (let i = 0; i < 14; i += 1) {
    const light = effectLight(0xff9b45, i < 4 ? 0.01 : 0, 1, 2, i < 4 ? compilePosition : offscreen);
    if (!light) continue;
    light.visible = i < 4;
    burstLights.push(light);
  }
  const setCannonballCompileState = (ball, active) => {
    ball.visible = active;
    ball.position.copy(active ? compilePosition : offscreen);
    for (const child of ball.children) {
      if (!child.isLight) continue;
      child.visible = false;
      child.intensity = 0;
    }
  };
  const compileLightVariant = (friendlyCount, hostileCount, burstCount, warmShadow = false) => {
    friendlyCannonballs.forEach((ball, index) => setCannonballCompileState(ball, index < friendlyCount));
    hostileCannonballs.forEach((ball, index) => setCannonballCompileState(ball, index < hostileCount));
    projectileLights.forEach((light, index) => {
      const active = index < friendlyCount + hostileCount;
      light.visible = active;
      light.intensity = active ? 20 : 0;
      light.distance = 12;
      light.position.copy(active ? compilePosition : offscreen);
    });
    burstLights.forEach((light, index) => {
      const active = index < burstCount;
      light.visible = active;
      light.intensity = active ? 0.01 : 0;
      light.position.copy(active ? compilePosition : offscreen);
    });
    renderer.compile(scene, camera);
    if (warmShadow) {
      renderer.shadowMap.needsUpdate = true;
      renderer.render(scene, camera);
    }
  };
  compileLightVariant(0, 0, 0);
  compileLightVariant(1, 0, 0, true);
  compileLightVariant(2, 0, 1, true);
  compileLightVariant(1, 1, 1, true);
  compileLightVariant(4, 0, 2, true);
  compileLightVariant(6, 0, 3, true);
  compileLightVariant(8, 0, 4, true);
  compileLightVariant(4, 4, 4, true);
  compileLightVariant(2, 2, 8, true);
  compileLightVariant(MAX_FRIENDLY_CANNONBALLS, MAX_HOSTILE_CANNONBALLS, 4, true);
  compileLightVariant(0, 0, 0, true);

  for (let hiddenItems = 0; hiddenItems <= items.length; hiddenItems += 1) {
    items.forEach((item, index) => setItemVisual(item, index >= hiddenItems));
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
  }
  items.forEach((item) => setItemVisual(item, true));

  for (const object of compileSamples) releaseEffectObject(object);
  for (const ball of friendlyCannonballs) releaseCannonballMesh(ball);
  for (const ball of hostileCannonballs) releaseCannonballMesh(ball);
  for (const light of burstLights) releaseEffectObject(light);
  projectileLights.forEach((light) => {
    light.visible = false;
    light.intensity = 0;
    light.position.copy(offscreen);
  });
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
}

prewarmRuntimeObjects();
animate();

window.__oceanVoyager = {
  game, player, islands, enemies, items, cannonballs, joystick, resetGame, fireCannon, useUltimate, chargeUltimate, collectItem,
  expandMission,
  get particleCount() { return particles.length; },
  get performanceProfile() {
    return {
      compactDevice,
      pixelRatio: renderer.getPixelRatio(),
      pixelRatioCap,
      shadows: renderer.shadowMap.enabled,
      shadowAutoUpdate: renderer.shadowMap.autoUpdate,
      shadowUpdateInterval: SHADOW_UPDATE_INTERVAL,
      adaptiveShadowTimeSlicing: true,
      shadowMapSize: sun.shadow.mapSize.x,
      antialias: renderer.getContext().getContextAttributes().antialias,
      maxParticles: MAX_PARTICLES,
      maxCannonballs: MAX_CANNONBALLS,
      ultimateChargeMultiplier: ULTIMATE_CHARGE_MULTIPLIER,
      ultimateTargetRange: ULTIMATE_TARGET_RANGE,
      projectileLightBatchSize: PROJECTILE_LIGHT_BATCH_SIZE,
      projectileLightLockedSlots: PROJECTILE_LIGHT_LOCKED_SLOTS,
      effectLightBatchSize: EFFECT_LIGHT_BATCH_SIZE,
      rendererInfo: {
        memory: { ...renderer.info.memory },
        render: { ...renderer.info.render },
      },
      pools: {
        stats: { ...poolStats },
        particles: [...particlePools.values()].reduce((sum, pool) => sum + pool.length, 0),
        friendlyCannonballs: cannonballPools.friendly.length,
        hostileCannonballs: cannonballPools.hostile.length,
        lights: effectLightPool.length,
      },
      frameProfile: frameProfile.records.slice(-80),
    };
  },
  get audio() {
    return {
      context: audioContext?.state ?? 'not-started',
      muted: musicMuted,
      active: !bgm.paused,
      gain: musicGain?.gain.value ?? 0,
      source: musicProfile.source,
      asset: musicProfile.asset,
      style: musicProfile.style,
      tempoBpm: musicProfile.tempoBpm,
      layers: musicProfile.layers.length,
      currentTime: bgm.currentTime,
      duration: Number.isFinite(bgm.duration) ? bgm.duration : 0,
      readyState: bgm.readyState,
    };
  },
};
