import * as THREE from 'three';
import './style.css';

const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
sun.shadow.mapSize.set(2048, 2048);
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
let audioContext;
let musicGain;
let musicTimer;
let musicMuted = false;
let missionTimer;

const oceanGeo = new THREE.PlaneGeometry(650, 650, 128, 128);
oceanGeo.rotateX(-Math.PI / 2);
const oceanBase = oceanGeo.attributes.position.array.slice();
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

function createEnemy(x, z, phase) {
  const ship = createShip({ pirate: true, scale: 0.72 });
  ship.position.set(x, 0.18, z);
  scene.add(ship);
  enemies.push({ ship, phase, health: 3, maxHealth: 3, fireCooldown: 1.5 + phase, active: true, spawn: new THREE.Vector3(x, 0.18, z) });
}
createEnemy(-28, -72, 0.4);
createEnemy(62, 62, 2.1);
createEnemy(-92, 8, 4.4);
createEnemy(96, -42, 1.2);
createEnemy(-45, 98, 3.3);
createEnemy(18, -125, 5.1);
createEnemy(118, 36, 0.8);
createEnemy(-118, -34, 2.8);
createEnemy(42, 120, 4.9);
createEnemy(-12, -138, 6.2);

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
  for (let i = 0; i < count; i += 1) {
    const drop = mesh(new THREE.SphereGeometry(0.08 + Math.random() * 0.12, 5, 5), material(color), scene, [position.x, 0.4, position.z]);
    particles.push({ object: drop, velocity: new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 5), life: 0.8 + Math.random() * 0.6 });
  }
}

function spawnExplosion(position, radius = 1, count = 24) {
  const burst = position.clone();
  burst.y = Math.max(1.2, burst.y);
  const colors = [0xfff0a6, 0xff9b43, 0xe64f35, 0x2f3740];
  for (let i = 0; i < count; i += 1) {
    const color = colors[i % colors.length];
    const spark = mesh(new THREE.SphereGeometry((0.12 + Math.random() * 0.26) * radius, 6, 6), material(color, 0.45), scene, [burst.x, burst.y, burst.z]);
    spark.material.emissive = new THREE.Color(color);
    spark.material.emissiveIntensity = i % 4 === 3 ? 0.2 : 1.2;
    spark.material.transparent = true;
    const angle = Math.random() * Math.PI * 2;
    const force = (5 + Math.random() * 11) * radius;
    particles.push({
      object: spark,
      velocity: new THREE.Vector3(Math.cos(angle) * force, 4 + Math.random() * 8, Math.sin(angle) * force),
      life: 0.75 + Math.random() * 0.8,
      maxLife: 1.35,
    });
  }
  for (let i = 0; i < 2; i += 1) {
    const ring = mesh(new THREE.TorusGeometry(radius * (1.5 + i * 0.8), 0.06 * radius, 8, 36), material(i ? 0xffe4a2 : 0xff673d, 0.3), scene, [burst.x, 0.45 + i * 0.25, burst.z], [Math.PI / 2, 0, 0]);
    ring.material.emissive = new THREE.Color(i ? 0xffd26a : 0xff5533);
    ring.material.emissiveIntensity = 1.5;
    ring.material.transparent = true;
    particles.push({ object: ring, velocity: new THREE.Vector3(0, 0.25, 0), life: 0.7, maxLife: 0.7, expand: 1.9 + i * 0.7 });
  }
  const light = new THREE.PointLight(0xff9b45, 45 * radius, 28 * radius, 2);
  light.position.copy(burst);
  scene.add(light);
  particles.push({ object: light, velocity: new THREE.Vector3(), life: 0.32, maxLife: 0.32 });
}

function spawnMuzzleFlash(position, direction, hostile = false) {
  const flashColor = hostile ? 0xe84d38 : 0xffb25a;
  const flash = mesh(new THREE.ConeGeometry(0.34, 1.7, 8), glowMaterial(flashColor, 0.28, 2), scene, [position.x, position.y, position.z]);
  flash.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  flash.position.addScaledVector(direction, 1.3);
  flash.material.transparent = true;
  particles.push({ object: flash, velocity: direction.clone().multiplyScalar(5), life: 0.16, maxLife: 0.16 });
  spawnSplash(position, hostile ? 0xd54e3b : 0xffb66c, hostile ? 5 : 11);
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

function scheduleMusic() {
  if (!audioContext || musicTimer) return;
  const melody = [196, 246.94, 293.66, 329.63, 392, 329.63, 293.66, 246.94];
  const bass = [49, 49, 65.41, 73.42, 49, 82.41, 73.42, 65.41];
  let step = 0;
  const playPhrase = () => {
    if (!game.started || game.ended) return;
    const root = melody[step % melody.length];
    playDrum(step % 4 === 0 ? 96 : 68, 0.12, step % 4 === 0 ? 0.1 : 0.055);
    playTone(bass[step % bass.length], 0.34, 0.08, 'sawtooth');
    playTone(root, 0.22, 0.055, step % 2 ? 'triangle' : 'square', 0.08);
    if (step % 4 === 2) playTone(root * 1.5, 0.18, 0.04, 'triangle', 0.16);
    step += 1;
  };
  playPhrase();
  musicTimer = window.setInterval(playPhrase, 430);
}

async function startAudio() {
  audioContext ??= new AudioContext();
  musicGain ??= audioContext.createGain();
  if (!musicGain.__connected) {
    musicGain.gain.value = 1;
    musicGain.connect(audioContext.destination);
    musicGain.__connected = true;
  }
  if (audioContext.state !== 'running') await audioContext.resume();
  scheduleMusic();
  const button = document.querySelector('#audio-toggle');
  button.textContent = '♫';
  button.classList.remove('muted');
  button.setAttribute('aria-label', '배경 음악 끄기');
}

function playCannonSound() {
  if (!audioContext || musicMuted) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = 'sawtooth';
  oscillator.frequency.setValueAtTime(90, audioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(30, audioContext.currentTime + 0.22);
  gain.gain.setValueAtTime(0.11, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.24);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.25);
}

function fireCannon(owner, hostile = false) {
  if (owner === player && (!game.started || game.ended || game.cannonCooldown > 0)) return false;
  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(owner.quaternion).normalize();
  const ball = mesh(new THREE.SphereGeometry(hostile ? 0.24 : 0.34, 10, 10), glowMaterial(hostile ? 0xd6442f : 0xff7c35, 0.18, hostile ? 0.7 : 1.8), scene);
  ball.position.copy(owner.position).addScaledVector(direction, 5).add(new THREE.Vector3(0, 2.2, 0));
  const ember = new THREE.PointLight(hostile ? 0xd6442f : 0xff863d, hostile ? 8 : 20, hostile ? 7 : 12, 2);
  ball.add(ember);
  cannonballs.push({ object: ball, velocity: direction.multiplyScalar(hostile ? 25 : 39), hostile, life: 4, trailTimer: 0 });
  spawnMuzzleFlash(ball.position, direction, hostile);
  if (owner === player) {
    game.cannonCooldown = game.supplies > 0 ? 0.28 : 0.45;
    playCannonSound();
  }
  return true;
}

function collectItem(item) {
  item.collected = true;
  item.group.visible = false;
  const effects = {
    repair: () => { game.health = Math.min(100, game.health + 28); chargeUltimate(6); showDanger('수리 키트 — 선체 회복!'); },
    rum: () => { game.score += 300; chargeUltimate(8); showDanger('럼주 보급 — 항해 점수 +300'); },
    chart: () => { game.score += 450; chargeUltimate(10); showDanger('비밀 해도 — 항로 발견!'); },
    powder: () => { game.supplies += 1; chargeUltimate(15); showDanger('화약 상자 — 대포 재장전 강화!'); },
  };
  effects[item.type]();
  spawnSplash(item.group.position, 0xffd36b, 18);
}

function chargeUltimate(amount) {
  game.ultimateCharge = Math.min(100, game.ultimateCharge + amount);
}

function sinkEnemy(enemy, reward = true) {
  enemy.active = false;
  enemy.ship.visible = false;
  game.score += 500;
  if (reward) chargeUltimate(18);
  spawnExplosion(enemy.ship.position, 1.35, 30);
  showDanger('해적선 격침!');
}

function useUltimate() {
  if (!game.started || game.ended || game.ultimateCharge < 100) return false;
  game.ultimateCharge = 0;
  showDanger('폭풍 포격 — 전방위 일제사격!');
  spawnExplosion(player.position, 2.2, 46);
  if (audioContext && !musicMuted) {
    playDrum(132, 0.32, 0.16);
    playTone(392, 0.24, 0.09, 'square', 0.02);
    playTone(523.25, 0.28, 0.08, 'triangle', 0.14);
  }

  for (const enemy of enemies) {
    if (!enemy.active) continue;
    const distance = enemy.ship.position.distanceTo(player.position);
    if (distance > 82) continue;
    enemy.health -= distance < 82 ? 3 : 2;
    spawnExplosion(enemy.ship.position, 1.05, 22);
    if (enemy.health <= 0) sinkEnemy(enemy, false);
  }

  for (let i = cannonballs.length - 1; i >= 0; i -= 1) {
    const ball = cannonballs[i];
    if (!ball.hostile || ball.object.position.distanceTo(player.position) > 90) continue;
    spawnSplash(ball.object.position, 0x94f4ff, 10);
    scene.remove(ball.object);
    cannonballs.splice(i, 1);
  }
  return true;
}

function damage(amount, message) {
  if (game.hitCooldown > 0 || game.ended) return;
  game.health = Math.max(0, game.health - amount);
  game.hitCooldown = 0.75;
  showDanger(message);
  spawnSplash(player.position, 0xff8a5c, 16);
  if (game.health <= 0) endGame(false);
}

let dangerTimer;
function showDanger(text) {
  const element = document.querySelector('#danger');
  element.textContent = text;
  element.classList.add('show');
  clearTimeout(dangerTimer);
  dangerTimer = setTimeout(() => element.classList.remove('show'), 1600);
}

function expandMission(duration = 5000) {
  const element = document.querySelector('#mission');
  element.classList.remove('collapsed');
  element.setAttribute('aria-expanded', 'true');
  clearTimeout(missionTimer);
  missionTimer = window.setTimeout(() => {
    element.classList.add('collapsed');
    element.setAttribute('aria-expanded', 'false');
  }, duration);
}

function collectTreasure(island) {
  island.collected = true;
  island.beacon.visible = false;
  game.treasures += 1;
  game.score += 750;
  chargeUltimate(12);
  spawnSplash(island.group.position, 0xffc45d, 24);
  showDanger(`보물 발견 — ${game.treasures} / 5`);
  if (game.treasures === islands.length) {
    document.querySelector('#mission-title').textContent = '왕실 항구로 귀환하십시오';
    document.querySelector('#mission-detail').textContent = '남쪽의 황금 부두가 당신의 귀환을 기다립니다.';
    expandMission();
  }
}

function endGame(victory) {
  game.ended = true;
  game.speed = 0;
  const screen = document.querySelector('#end-screen');
  document.querySelector('#end-kicker').textContent = victory ? 'VOYAGE COMPLETE' : 'THE SEA CLAIMS ANOTHER';
  document.querySelector('#end-title').textContent = victory ? '전설의 항해자' : '침몰한 꿈';
  document.querySelector('#end-message').textContent = victory
    ? `모든 보물을 되찾았습니다. 항해 점수 ${String(Math.round(game.score)).padStart(4, '0')}점으로 왕실의 전설이 되었습니다.`
    : '선체가 파괴되었습니다. 바람과 파도를 읽어 다시 도전하십시오.';
  screen.classList.remove('hidden');
}

function updateOcean(time) {
  const positions = oceanGeo.attributes.position.array;
  for (let i = 0; i < positions.length; i += 3) {
    const x = oceanBase[i];
    const z = oceanBase[i + 2];
    positions[i + 1] = Math.sin(x * 0.095 + time * 1.2) * 0.38 + Math.cos(z * 0.075 + time * 0.85) * 0.32;
  }
  oceanGeo.attributes.position.needsUpdate = true;
  oceanGeo.computeVertexNormals();
}

function updatePlayer(dt, time) {
  const forward = keys.has('KeyW') || keys.has('ArrowUp');
  const reverse = keys.has('KeyS') || keys.has('ArrowDown');
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  const keyboardTurn = (left ? 1 : 0) - (right ? 1 : 0);
  const shapeInput = (value) => Math.sign(value) * Math.min(1, Math.max(0, (Math.abs(value) - 0.025) / 0.975) ** 0.72);
  const turn = joystick.active ? -shapeInput(joystick.x) : keyboardTurn;
  const throttle = joystick.active ? -shapeInput(joystick.y) : (forward ? 1 : reverse ? -1 : 0);
  const acceleration = throttle > 0.025 ? 15 * throttle : throttle < -0.025 ? 12 * throttle : -Math.sign(game.speed) * 2.2;
  game.speed = THREE.MathUtils.clamp(game.speed + acceleration * dt, -3.2, 11.5);
  if (Math.abs(throttle) <= 0.025 && Math.abs(game.speed) < 0.12) game.speed = 0;
  game.heading += turn * dt * (1.35 + Math.abs(game.speed) * 0.045) * (game.speed >= 0 ? 1 : -1);
  player.rotation.y = game.heading;
  const direction = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), game.heading);
  player.position.addScaledVector(direction, game.speed * dt);
  player.position.x = THREE.MathUtils.clamp(player.position.x, -145, 145);
  player.position.z = THREE.MathUtils.clamp(player.position.z, -145, 145);
  player.position.y = 0.28 + Math.sin(time * 2.2 + player.position.x * 0.04) * 0.18;
  player.rotation.z = THREE.MathUtils.lerp(player.rotation.z, -turn * 0.09 + Math.sin(time * 1.5) * 0.018, dt * 3);
  if (Math.abs(game.speed) > 2.5 && Math.random() < dt * 10) spawnSplash(player.position.clone().addScaledVector(direction, -5), 0xc9f4ff, 2);

  for (const island of islands) {
    const distance = player.position.distanceTo(island.group.position);
    if (distance < island.radius + 3.6) {
      if (!island.collected) collectTreasure(island);
      if (distance < island.radius + 0.7) damage(7, '암초 충돌!');
    }
    island.beacon.rotation.y += dt * 1.5;
    island.beacon.position.y = 5.2 + Math.sin(time * 2 + island.index) * 0.5;
  }
  for (const item of items) {
    if (item.collected) continue;
    item.group.rotation.y += dt * 1.2;
    item.group.position.y = item.spawn.y + Math.sin(time * 2.4 + item.phase) * 0.45;
    if (player.position.distanceTo(item.group.position) < 4.2) collectItem(item);
  }
  if (game.treasures === islands.length && player.position.distanceTo(port.position) < 12) endGame(true);
}

function updateEnemies(dt, time) {
  for (const enemy of enemies) {
    if (!enemy.active) continue;
    const toPlayer = player.position.clone().sub(enemy.ship.position);
    const distance = toPlayer.length();
    if (distance < 55) {
      const desired = Math.atan2(-toPlayer.x, -toPlayer.z);
      enemy.ship.rotation.y = THREE.MathUtils.lerp(enemy.ship.rotation.y, desired, dt * 0.8);
      if (distance > 18) enemy.ship.position.addScaledVector(toPlayer.normalize(), dt * 3.7);
      enemy.fireCooldown -= dt;
      if (distance < 34 && enemy.fireCooldown <= 0) {
        fireCannon(enemy.ship, true);
        enemy.fireCooldown = 2.8 + Math.random() * 2;
      }
    } else {
      enemy.ship.position.x += Math.sin(time * 0.3 + enemy.phase) * dt * 1.4;
      enemy.ship.position.z += Math.cos(time * 0.25 + enemy.phase) * dt * 1.4;
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
    if (ball.trailTimer <= 0) {
      ball.trailTimer = ball.hostile ? 0.09 : 0.045;
      const trailColor = ball.hostile ? 0xbf3b32 : 0xffa45a;
      const trail = mesh(new THREE.SphereGeometry(ball.hostile ? 0.11 : 0.16, 6, 6), glowMaterial(trailColor, 0.55, ball.hostile ? 0.5 : 1.1), scene, [ball.object.position.x, ball.object.position.y, ball.object.position.z]);
      trail.material.transparent = true;
      particles.push({ object: trail, velocity: new THREE.Vector3((Math.random() - 0.5) * 1.8, 0.6 + Math.random() * 1.4, (Math.random() - 0.5) * 1.8), life: ball.hostile ? 0.4 : 0.62, maxLife: ball.hostile ? 0.4 : 0.62 });
    }
    if (ball.hostile && ball.object.position.distanceTo(player.position) < 3.8) {
      damage(14, '해적의 포격!');
      ball.life = 0;
    } else if (!ball.hostile) {
      for (const enemy of enemies) {
        if (enemy.active && ball.object.position.distanceTo(enemy.ship.position) < 4) {
          enemy.health -= 1;
          chargeUltimate(7);
          ball.life = 0;
          spawnExplosion(enemy.ship.position, enemy.health <= 0 ? 1.55 : 1.05, enemy.health <= 0 ? 44 : 30);
          if (enemy.health <= 0) sinkEnemy(enemy);
          break;
        }
      }
    }
    if (ball.object.position.y < 0 || ball.life <= 0) {
      spawnSplash(ball.object.position, ball.hostile ? 0xff7b64 : 0xffcf8a, ball.hostile ? 8 : 12);
      if (!ball.hostile) spawnExplosion(ball.object.position, 0.52, 14);
      scene.remove(ball.object);
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
      else particle.object.scale.setScalar(Math.max(0.01, particle.life));
      if (particle.object.material?.transparent) particle.object.material.opacity = Math.max(0, particle.life / (particle.maxLife ?? 1));
    }
    if (particle.life <= 0) {
      scene.remove(particle.object);
      particles.splice(i, 1);
    }
  }
}

function updateCamera(dt) {
  const offset = new THREE.Vector3(0, 22, 38).applyAxisAngle(new THREE.Vector3(0, 1, 0), game.heading);
  const targetPosition = player.position.clone().add(offset);
  camera.position.lerp(targetPosition, 1 - Math.pow(0.001, dt));
  const look = player.position.clone().add(new THREE.Vector3(0, 4.5, 0));
  camera.lookAt(look);
}

function updateHUD() {
  document.querySelector('#health').textContent = Math.ceil(game.health);
  document.querySelector('#health-bar').style.width = `${game.health}%`;
  document.querySelector('#treasure').textContent = game.treasures;
  document.querySelector('#score').textContent = String(Math.round(game.score)).padStart(4, '0');
  document.querySelector('#supplies').textContent = game.supplies;
  document.querySelector('#ultimate').textContent = `${Math.round(game.ultimateCharge)}%`;
  document.querySelector('#ultimate-bar').style.width = `${game.ultimateCharge}%`;
  document.querySelector('.ultimate-stat').classList.toggle('ready', game.ultimateCharge >= 100);
  document.querySelector('#ultimate-button').classList.toggle('ready', game.ultimateCharge >= 100);
  const degrees = ((-THREE.MathUtils.radToDeg(game.heading) % 360) + 360) % 360;
  document.querySelector('#needle').style.transform = `rotate(${degrees}deg)`;
  document.querySelector('#heading').textContent = `${String(Math.round(degrees)).padStart(3, '0')}°`;
}

function updateSky(time) {
  const dayCycle = (Math.sin(time * 0.018 - 0.7) + 1) / 2;
  const sky = new THREE.Color().lerpColors(new THREE.Color(0x17273f), new THREE.Color(0x8ac4d0), dayCycle);
  scene.background.copy(sky);
  scene.fog.color.copy(sky);
  scene.fog.density = THREE.MathUtils.lerp(scene.fog.density, 0.0065, 0.015);
  stars.material.opacity = THREE.MathUtils.clamp((0.45 - dayCycle) * 2.4, 0, 0.8);
  sun.intensity = 1 + dayCycle * 2.2;
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.04);
  if (game.started && !game.ended) {
    game.time += dt;
    game.cannonCooldown = Math.max(0, game.cannonCooldown - dt);
    game.hitCooldown = Math.max(0, game.hitCooldown - dt);
    game.score += dt * Math.max(0, game.speed) * 0.55;
    if (keys.has('Space')) fireCannon(player);
    updatePlayer(dt, game.time);
    updateEnemies(dt, game.time);
    updateCannonballs(dt);
    updateStorms(dt, game.time);
  }
  updateOcean(game.time);
  updateParticles(dt);
  updateCamera(dt);
  updateSky(game.time);
  updateHUD();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function resetGame() {
  Object.assign(game, { started: true, ended: false, speed: 0, heading: 0, health: 100, treasures: 0, score: 0, supplies: 0, time: 0, cannonCooldown: 0, hitCooldown: 0, ultimateCharge: 40 });
  player.position.set(0, 0.25, 32);
  player.rotation.set(0, 0, 0);
  islands.forEach((island) => { island.collected = false; island.beacon.visible = true; });
  enemies.forEach((enemy) => { enemy.active = true; enemy.health = enemy.maxHealth; enemy.ship.visible = true; enemy.ship.position.copy(enemy.spawn); });
  items.forEach((item) => { item.collected = false; item.group.visible = true; item.group.position.copy(item.spawn); });
  document.querySelector('#mission-title').textContent = '잃어버린 왕관의 보물 5개를 찾으십시오';
  document.querySelector('#mission-detail').textContent = '빛나는 섬 가까이 항해하면 보물을 발견할 수 있습니다.';
  expandMission();
  document.querySelector('#start-screen').classList.add('hidden');
  document.querySelector('#end-screen').classList.add('hidden');
  showDanger('돛을 올려라 — 항해 시작!');
  startAudio().catch(() => showDanger('소리 버튼을 눌러 음악을 시작하세요'));
}

document.querySelector('#start-button').addEventListener('click', resetGame);
document.querySelector('#restart-button').addEventListener('click', resetGame);
document.querySelector('#mission').addEventListener('click', () => {
  if (game.started && document.querySelector('#mission').classList.contains('collapsed')) expandMission();
});
document.querySelector('#mission').addEventListener('keydown', (event) => {
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

document.querySelector('#fire-button').addEventListener('pointerdown', (event) => {
  event.preventDefault();
  fireCannon(player);
});
document.querySelector('#ultimate-button').addEventListener('pointerdown', (event) => {
  event.preventDefault();
  useUltimate();
});

const joystickElement = document.querySelector('#joystick');
const joystickKnob = document.querySelector('#joystick-knob');

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

document.querySelector('#audio-toggle').addEventListener('click', () => {
  musicMuted = !musicMuted;
  const button = document.querySelector('#audio-toggle');
  button.classList.toggle('muted', musicMuted);
  button.textContent = musicMuted ? '♩' : '♫';
  button.setAttribute('aria-pressed', String(musicMuted));
  button.setAttribute('aria-label', musicMuted ? '배경 음악 켜기' : '배경 음악 끄기');
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
animate();

window.__oceanVoyager = {
  game, player, islands, enemies, items, cannonballs, joystick, resetGame, fireCannon, useUltimate, chargeUltimate,
  expandMission,
  get particleCount() { return particles.length; },
  get audio() { return { context: audioContext?.state ?? 'not-started', muted: musicMuted, active: Boolean(musicTimer), gain: musicGain?.gain.value ?? 0 }; },
};
