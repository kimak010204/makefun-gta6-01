// SOLMAR CITY — original 3D open-world game (three.js).
// Marco Reyes owes $50,000 to Vera Kross. 6 missions, wanted 0-5, garage,
// gun shop, 3 side jobs. Fully procedural, no network requests.
import * as THREE from 'three';

// ---------------------------------------------------------------- util
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dist2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// RNG deterministik (mulberry32) — staging screenshot stabil per seed.
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') || 1);
const SHOT = params.get('shot') || '';
let rng = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const rand = (a, b) => a + rng() * (b - a);

// ---------------------------------------------------------------- state
const SAVE_KEY = 'solmar-city-save-v2';
const S = {
  started: false, paused: false, over: false,
  money: 300, debt: 50000,
  hp: 100, wanted: 0, wantedTimer: 0, crimeTimer: 0,
  mission: 0, missionStage: 0, missionTimer: 0, missionData: {},
  weapon: 'pistol', ammo: { pistol: Infinity, smg: 0, rifle: 0 }, mag: { pistol: 12, smg: 30, rifle: 20 },
  owned: { smg: false, rifle: false },
  upgrades: { engine: 0, armor: 0, tires: 0 },
  job: null, jobCooldown: 0,
  cashFound: 0, cashTotal: 12,
  gameTime: 8.0, // jam 08:00
  muted: false, radio: 0,
  kills: 0, deaths: 0,
};
const WEAPONS = {
  pistol: { name: 'Pistol', dmg: 34, rate: 3.2, mag: 12, auto: false, price: 0 },
  smg: { name: 'SMG', dmg: 20, rate: 9, mag: 30, auto: true, price: 800 },
  rifle: { name: 'Rifle', dmg: 55, rate: 5, mag: 20, auto: false, price: 1800 },
};
const UPGRADES = {
  engine: { name: 'Engine', desc: 'Top speed + acceleration', costs: [500, 1200, 2500] },
  armor: { name: 'Armor', desc: 'Survives crashes & bullets', costs: [500, 1200, 2500] },
  tires: { name: 'Tires', desc: 'Grip & sharper steering', costs: [400, 900, 1800] },
};
const MISSIONS = [
  { title: 'MISSION 1 — First Wheels', obj: "Steal a car and deliver it to Dex's Garage", reward: 800,
    dialog: ['Vera', "Marco. Your first car is waiting on the street. Take it — then bring it to Dex's Garage. Don't ask whose it is."] },
  { title: 'MISSION 2 — Courier Run', obj: 'Hit 4 checkpoints before time runs out (90 sec)', reward: 1200,
    dialog: ['Dex', 'This package has to arrive, fast. Four points, ninety seconds. Floor it, Marco!'] },
  { title: 'MISSION 3 — Shakedown', obj: 'Take down 4 gang members at the warehouse', reward: 2000,
    dialog: ['Mama Rosa', 'That gang shakes down my shop. Get in the warehouse, teach them a lesson. Careful — they are armed.'] },
  { title: 'MISSION 4 — Getaway', obj: 'Escape the cops (wanted 3) to the safehouse', reward: 1800,
    dialog: ['Vera', 'The cops are on your tail. Don\'t stop — the safehouse is at the west end. Get there and you are safe.'] },
  { title: 'MISSION 5 — The Drop', obj: 'Grab the package and deliver it while chased (wanted 2)', reward: 2500,
    dialog: ['Dex', "The package is at the pier. Grab it, take it to the drop point. The cops will stick to you — don't panic."] },
  { title: 'MISSION 6 — Payday', obj: 'Make the last 3 drops — debt paid off!', reward: 5000,
    dialog: ['Vera', 'This is the last one, Marco. Three drops, then your debt is clear. After this you are free. Don\'t die.'] },
];

// ---------------------------------------------------------------- audio (procedural WebAudio)
const AudioSys = {
  ctx: null, master: null, engineOsc: null, engineGain: null, sirenOsc: null, sirenGain: null, bassTimer: 0,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = S.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      // engine roar
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 60;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.0;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 400;
      this.engineOsc.connect(lp); lp.connect(this.engineGain); this.engineGain.connect(this.master);
      this.engineOsc.start();
      // two-tone siren
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'sine';
      this.sirenOsc.frequency.value = 700;
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
      this.sirenOsc.start();
    } catch (e) { /* audio unavailable — game still runs */ }
  },
  engine(speedRatio) {
    if (!this.ctx) return;
    this.engineOsc.frequency.value = 55 + speedRatio * 160;
    this.engineGain.gain.value = 0.02 + speedRatio * 0.05;
  },
  siren(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sirenGain.gain.cancelScheduledValues(t);
    if (on) {
      this.sirenGain.gain.setValueAtTime(0.05, t);
      this.sirenOsc.frequency.setValueAtTime(700, t);
      this.sirenOsc.frequency.setValueAtTime(950, t + 0.35);
      this.sirenOsc.frequency.setValueAtTime(700, t + 0.7);
    } else this.sirenGain.gain.setValueAtTime(0, t);
  },
  shot() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = this.ctx.sampleRate * 0.12;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900;
    const g = this.ctx.createGain(); g.gain.value = 0.5;
    src.connect(bp); bp.connect(g); g.connect(this.master); src.start(t);
  },
  chime() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [880, 1318].forEach((f, i) => {
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.25, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.25);
      o.connect(g); g.connect(this.master);
      o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.3);
    });
  },
  bass(note) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = note;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.45);
  },
  toggleMute() {
    S.muted = !S.muted;
    if (this.master) this.master.gain.value = S.muted ? 0 : 0.5;
    return S.muted;
  },
};
const RADIO_TRACKS = [
  { name: 'SOLMAR FM — Night Drive', bass: [55, 55, 65.4, 49] },
  { name: 'BEACH 92 — Sunset Cruise', bass: [65.4, 82.4, 73.4, 98] },
  { name: "VERA'S MIX — Street Heat", bass: [49, 58.3, 49, 73.4] },
];

// ---------------------------------------------------------------- three setup
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5e0);
scene.fog = new THREE.Fog(0x87b5e0, 180, 420);
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 800);
camera.position.set(0, 8, 14);

const sun = new THREE.DirectionalLight(0xfff2d0, 1.6);
sun.position.set(80, 140, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -160; sun.shadow.camera.right = 160;
sun.shadow.camera.top = 160; sun.shadow.camera.bottom = -160;
sun.shadow.camera.far = 500;
scene.add(sun);
scene.add(new THREE.AmbientLight(0x8090b0, 0.55));
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a3230, 0.65);
scene.add(hemi);

// ---------------------------------------------------------------- living sky: opaque clouds + birds
// Clouds are OPAQUE (MeshStandardMaterial) — transparent sky planes are
// far too slow under swiftshader software rendering.
const clouds = [];
{
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const puffGeo = new THREE.SphereGeometry(1, 8, 6);
  for (let i = 0; i < 7; i++) {
    const g = new THREE.Group();
    const n = 3 + Math.floor(rng() * 3);
    for (let j = 0; j < n; j++) {
      const p = new THREE.Mesh(puffGeo, cloudMat);
      p.position.set(j * 3.2 - n * 1.6, rand(-0.6, 0.6), rand(-1.5, 1.5));
      p.scale.set(rand(2.5, 4.5), rand(1.2, 1.8), rand(2, 3));
      g.add(p);
    }
    g.position.set(rand(-140, 140), rand(55, 80), rand(-140, 140));
    scene.add(g);
    clouds.push({ g, speed: rand(0.4, 0.9) });
  }
}
const birds = [];
{
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x222831, side: THREE.DoubleSide });
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    const w1 = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.28), birdMat);
    w1.rotation.z = 0.5; w1.position.x = -0.5; g.add(w1);
    const w2 = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.28), birdMat);
    w2.rotation.z = -0.5; w2.position.x = 0.5; g.add(w2);
    scene.add(g);
    birds.push({ g, a: rand(0, Math.PI * 2), r: rand(30, 90), h: rand(35, 60), sp: rand(0.05, 0.12), cx: rand(-40, 40), cz: rand(-40, 40) });
  }
}
function updateSky(dt) {
  for (const c of clouds) {
    c.g.position.x += c.speed * dt;
    if (c.g.position.x > 170) c.g.position.x = -170;
  }
  for (const b of birds) {
    b.a += b.sp * dt;
    b.g.position.set(b.cx + Math.cos(b.a) * b.r, b.h + Math.sin(b.a * 2.3) * 2, b.cz + Math.sin(b.a) * b.r);
    b.g.rotation.y = -b.a;
  }
}

// 12 facade variants: varied base colors, window grids and lit ratios,
// so the city reads lively instead of grey/brown.
function windowTexture(base, lit, cols, rows) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 256);
  const cw = 128 / cols, ch = 256 / rows;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      g.fillStyle = rng() < lit ? '#ffd76a' : '#1d2b45';
      g.fillRect(col * cw + cw * 0.18, r * ch + ch * 0.22, cw * 0.64, ch * 0.55);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const FACADE_VARIANTS = [
  ['#8a7f72', 0.25, 5, 9], ['#7d8a96', 0.3, 5, 9], ['#96705a', 0.2, 4, 8],
  ['#6f7d6a', 0.25, 5, 10], ['#8a6f7d', 0.3, 4, 9], ['#a08a5a', 0.2, 5, 8],
  ['#4a9a8a', 0.35, 5, 9], ['#c26a5a', 0.25, 4, 8], ['#c2a13a', 0.2, 6, 10],
  ['#7d9a6a', 0.3, 5, 9], ['#6a8ab0', 0.35, 6, 11], ['#9a6f8a', 0.25, 4, 8],
];
const buildingMats = FACADE_VARIANTS.map(([col, lit, cols, rows]) => new THREE.MeshStandardMaterial({
  map: windowTexture(col, lit, cols, rows), roughness: 0.9, metalness: 0.05,
}));
const roadMat = new THREE.MeshStandardMaterial({ color: 0x2b2e35, roughness: 0.95 });
const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x9a9a94, roughness: 0.95 });
const groundMat = new THREE.MeshStandardMaterial({ color: 0x6f7d5a, roughness: 1 });
const sandMat = new THREE.MeshStandardMaterial({ color: 0xdcc28a, roughness: 1 });
const waterMat = new THREE.MeshStandardMaterial({ color: 0x2a6f9e, roughness: 0.15, metalness: 0.4 });

// ---------------------------------------------------------------- city
const CITY = 100; // half city width (roads -100..100)
const ROAD_GAP = 20;
const colliders = []; // {x, z, r} circle or {x1,z1,x2,z2} box
const addBoxCollider = (x, z, hw, hd) => colliders.push({ x1: x - hw, z1: z - hd, x2: x + hw, z2: z + hd });
const addCircleCollider = (x, z, r) => colliders.push({ x, z, r });

function collideCircle(x, z, r) {
  for (const c of colliders) {
    if (c.r !== undefined) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz < (r + c.r) * (r + c.r)) return true;
    } else {
      const nx = clamp(x, c.x1, c.x2), nz = clamp(z, c.z1, c.z2);
      const dx = x - nx, dz = z - nz;
      if (dx * dx + dz * dz < r * r) return true;
    }
  }
  return false;
}

// ground: city concrete + east beach sand + sea
{
  const g = new THREE.Mesh(new THREE.PlaneGeometry(560, 560), groundMat);
  g.rotation.x = -Math.PI / 2; g.position.set(40, -0.05, 0); g.receiveShadow = true;
  scene.add(g);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(46, 560), sandMat);
  sand.rotation.x = -Math.PI / 2; sand.position.set(123, 0, 0); sand.receiveShadow = true;
  scene.add(sand);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(120, 560), waterMat);
  sea.rotation.x = -Math.PI / 2; sea.position.set(206, -0.4, 0);
  scene.add(sea);
}
// roads: asphalt strips + dashed lines
{
  const roadGeo = new THREE.PlaneGeometry(6.4, 220);
  const dashGeo = new THREE.PlaneGeometry(0.35, 2.2);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8d8c8 });
  for (let i = -5; i <= 5; i++) {
    const p = i * ROAD_GAP;
    const rx = new THREE.Mesh(roadGeo, roadMat);
    rx.rotation.x = -Math.PI / 2; rx.rotation.z = Math.PI / 2;
    rx.position.set(0, 0.02, p); rx.receiveShadow = true; scene.add(rx);
    const rz = new THREE.Mesh(roadGeo, roadMat);
    rz.rotation.x = -Math.PI / 2;
    rz.position.set(p, 0.02, 0); rz.receiveShadow = true; scene.add(rz);
    for (let d = -100; d <= 100; d += 8) {
      const dx = new THREE.Mesh(dashGeo, dashMat);
      dx.rotation.x = -Math.PI / 2; dx.position.set(d, 0.04, p); scene.add(dx);
      const dz = new THREE.Mesh(dashGeo, dashMat);
      dz.rotation.x = -Math.PI / 2; dz.rotation.z = Math.PI / 2;
      dz.position.set(p, 0.04, d); scene.add(dz);
    }
  }
  // sidewalks: grey blocks between roads (surface ~0.05 so feet don't sink)
  const walkGeo = new THREE.BoxGeometry(13.4, 0.24, 13.4);
  for (let bx = -5; bx <= 4; bx++) for (let bz = -5; bz <= 4; bz++) {
    const w = new THREE.Mesh(walkGeo, sidewalkMat);
    w.position.set(bx * ROAD_GAP + 10, -0.07, bz * ROAD_GAP + 10);
    w.receiveShadow = true; scene.add(w);
  }
}

// procedural buildings + palm trees + street lamps
const buildings = [];
const acMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.7, metalness: 0.4 });
const tankMat = new THREE.MeshStandardMaterial({ color: 0x8a6b48, roughness: 1 });
function makeBuilding(x, z, w, d, h, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, h / 2, z);
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  buildings.push(m);
  addBoxCollider(x, z, w / 2, d / 2);
  // rooftop props: AC unit on most, water tower on tall ones
  if (rng() < 0.65) {
    const ac = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 1.1), acMat);
    ac.position.set(x + rand(-w / 4, w / 4), h + 0.35, z + rand(-d / 4, d / 4));
    ac.castShadow = true; scene.add(ac);
  }
  if (h > 20 && rng() < 0.5) {
    const tank = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 8), tankMat);
    body.position.y = 1.4; tank.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.9, 8), tankMat);
    roof.position.y = 2.9; tank.add(roof);
    for (const [lx, lz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.2, 0.14), acMat);
      leg.position.set(lx, 0.6, lz); tank.add(leg);
    }
    tank.position.set(x + rand(-w / 4, w / 4), h, z + rand(-d / 4, d / 4));
    scene.add(tank);
  }
  return m;
}
const palms = [];
function makePalm(x, z) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.35, 6, 6),
    new THREE.MeshStandardMaterial({ color: 0x8a6b48, roughness: 1 }));
  trunk.position.y = 3; trunk.castShadow = true; g.add(trunk);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f8f4f, roughness: 1 });
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.4, 4), leafMat);
    const a = (i / 6) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 1.1, 6.2, Math.sin(a) * 1.1);
    leaf.rotation.z = Math.cos(a) * 0.9; leaf.rotation.x = -Math.sin(a) * 0.9;
    g.add(leaf);
  }
  g.position.set(x, 0, z);
  scene.add(g);
  palms.push(g);
  addCircleCollider(x, z, 0.5);
  return g;
}
const lampLights = [];
function makeLamp(x, z) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6),
    new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.6, metalness: 0.5 }));
  pole.position.y = 2.7; g.add(pole);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.22, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd76a, emissiveIntensity: 0 }));
  head.position.y = 5.4; g.add(head);
  const light = new THREE.PointLight(0xffd76a, 0, 26, 1.6);
  light.position.y = 5.2; g.add(light);
  g.position.set(x, 0, z);
  scene.add(g);
  lampLights.push({ head: head.material, light });
  return g;
}
// city blocks: random buildings, some blocks become parks
const PLAZAS = new Set(['-1,1', '2,-2']);
const SHOP_NAMES = [
  ['DONUT KING', '#ff9ecf'], ['MOTEL', '#9fe8ff'], ['BARBER', '#7dff8a'],
  ['GYM', '#ffb02e'], ['TATTOO', '#ff7b7b'], ['COFFEE', '#d8b13a'],
  ['PAWN SHOP', '#c2a13a'], ['FLOWERS', '#ff9ecf'], ['SURF SHOP', '#4a9a8a'],
];
let shopIdx = 0;
// View corridor: keep the strip south of the warehouse clear so the
// WAREHOUSE sign is never hidden behind another building in the mission shot.
const WAREHOUSE_VIEW = { x1: 42, z1: 26, x2: 80, z2: 54 };
function inViewCorridor(x, z) {
  return x > WAREHOUSE_VIEW.x1 && x < WAREHOUSE_VIEW.x2 && z > WAREHOUSE_VIEW.z1 && z < WAREHOUSE_VIEW.z2;
}
const benchMat = new THREE.MeshStandardMaterial({ color: 0x8a6b48, roughness: 1 });
const planterMat = new THREE.MeshStandardMaterial({ color: 0x6a4a3a, roughness: 1 });
function makeBench(x, z, ry) {
  const g = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.55), benchMat);
  seat.position.y = 0.45; g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.1), benchMat);
  back.position.set(0, 0.75, -0.24); g.add(back);
  for (const lx of [-0.9, 0.9]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.45, 0.5), acMat);
    leg.position.set(lx, 0.22, 0); g.add(leg);
  }
  g.position.set(x, 0, z); g.rotation.y = ry || 0;
  scene.add(g);
  return g;
}
function makePlanter(x, z) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 1.4), planterMat);
  box.position.y = 0.3; g.add(box);
  const bush = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x3f8f4f, roughness: 1 }));
  bush.position.y = 0.9; bush.scale.y = 0.7; g.add(bush);
  g.position.set(x, 0, z);
  scene.add(g);
  return g;
}
function makeFountain(x, z) {
  const g = new THREE.Group();
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.7, 16),
    new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 0.8 }));
  basin.position.y = 0.35; basin.castShadow = true; g.add(basin);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 0.15, 16), waterMat);
  water.position.y = 0.62; g.add(water);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.2, 8),
    new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.8 }));
  col.position.y = 1.4; g.add(col);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.9, 0.25, 12),
    new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.8 }));
  top.position.y = 2.6; g.add(top);
  const spray = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.0, 0.8, 8),
    new THREE.MeshStandardMaterial({ color: 0x9fd8ff, roughness: 0.2, metalness: 0.3 }));
  spray.position.y = 3.1; g.add(spray);
  g.position.set(x, 0, z);
  scene.add(g);
  addCircleCollider(x, z, 3.6);
  return g;
}
for (let bx = -5; bx <= 4; bx++) for (let bz = -5; bz <= 4; bz++) {
  const cx = bx * ROAD_GAP + 10, cz = bz * ROAD_GAP + 10;
  const key = `${bx},${bz}`;
  if (PLAZAS.has(key)) {
    // plaza: fountain + benches + planters + palms
    makeFountain(cx, cz);
    makeBench(cx - 5, cz + 4, Math.PI / 2); makeBench(cx + 5, cz - 4, -Math.PI / 2);
    makePlanter(cx - 5, cz - 5); makePlanter(cx + 5, cz + 5);
    for (let i = 0; i < 4; i++) makePalm(cx + rand(-5, 5), cz + rand(-5, 5));
    continue;
  }
  if (rng() < 0.12) continue; // empty lot
  const n = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const bx2 = cx + rand(-3, 3), bz2 = cz + rand(-3, 3);
    if (inViewCorridor(bx2, bz2)) continue; // keep warehouse sign visible
    const w = rand(5, 9), d = rand(5, 9), h = rand(7, 34);
    makeBuilding(bx2, bz2, w, d, h, pick(buildingMats));
    // ground-floor shop sign on the building's south face (English storefronts)
    if (shopIdx < SHOP_NAMES.length && h < 16 && rng() < 0.22) {
      makeSign(bx2, bz2 + d / 2 + 0.35, SHOP_NAMES[shopIdx][0], SHOP_NAMES[shopIdx][1]);
      shopIdx++;
    }
  }
  if (rng() < 0.5) makePalm(cx + rand(-6, 6), cz + rand(-6, 6));
}
// street lamps at intersections
for (let i = -5; i <= 5; i += 2) {
  makeLamp(i * ROAD_GAP + 4.4, -100); makeLamp(i * ROAD_GAP - 4.4, 100);
  makeLamp(-100, i * ROAD_GAP + 4.4); makeLamp(100, i * ROAD_GAP - 4.4);
}

// ---------------------------------------------------------------- street props: hydrants, dumpsters, bus stops, traffic lights
const hydrantMat = new THREE.MeshStandardMaterial({ color: 0xc23b2e, roughness: 0.6 });
function makeHydrant(x, z) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.7, 8), hydrantMat);
  body.position.y = 0.35; g.add(body);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), hydrantMat);
  top.position.y = 0.75; g.add(top);
  g.position.set(x, 0, z);
  scene.add(g);
  addCircleCollider(x, z, 0.35);
  return g;
}
const dumpsterMat = new THREE.MeshStandardMaterial({ color: 0x2f6a3a, roughness: 0.8, metalness: 0.3 });
function makeDumpster(x, z, ry) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.3, 1.2), dumpsterMat);
  box.position.y = 0.65; box.castShadow = true; g.add(box);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x24522c, roughness: 0.8 }));
  lid.position.y = 1.35; lid.rotation.z = 0.15; g.add(lid);
  g.position.set(x, 0, z); g.rotation.y = ry || 0;
  scene.add(g);
  addBoxCollider(x, z, 1.2, 0.7);
  return g;
}
function makeBusStop(x, z, ry) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6), acMat);
  pole.position.y = 1.3; g.add(pole);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x1a5fb0, roughness: 0.6 }));
  sign.position.y = 2.5; g.add(sign);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.45), benchMat);
  bench.position.set(0.9, 0.45, 0); g.add(bench);
  g.position.set(x, 0, z); g.rotation.y = ry || 0;
  scene.add(g);
  return g;
}
const trafficLights = [];
function makeTrafficLight(x, z, ry) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 5.2, 6), acMat);
  pole.position.y = 2.6; g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.12), acMat);
  arm.position.set(0.8, 5.1, 0); g.add(arm);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.1, 0.45),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 }));
  box.position.set(1.5, 4.6, 0); g.add(box);
  const lampGeo = new THREE.SphereGeometry(0.13, 8, 6);
  const red = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xff4444 }));
  red.position.set(1.5, 4.95, 0.24); g.add(red);
  const yellow = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0x554411 }));
  yellow.position.set(1.5, 4.6, 0.24); g.add(yellow);
  const green = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0x114411 }));
  green.position.set(1.5, 4.25, 0.24); g.add(green);
  g.position.set(x, 0, z); g.rotation.y = ry || 0;
  scene.add(g);
  trafficLights.push({ red: red.material, yellow: yellow.material, green: green.material, phase: rng() * 12 });
  return g;
}
for (const [hx, hz] of [[-14, -30], [26, 10], [-46, 50], [70, -50], [-70, -10], [46, 70]]) makeHydrant(hx, hz);
for (const [dx, dz, ry] of [[-34, 44, 0.3], [54, -34, -0.2], [-74, 26, 0.5], [30, 66, 0]]) makeDumpster(dx, dz, ry);
for (const [bx, bz, ry] of [[-6, -84, 0], [84, 34, Math.PI / 2], [-84, -6, Math.PI], [6, 84, -Math.PI / 2]]) makeBusStop(bx, bz, ry);
for (const [tx, tz, ry] of [[-4.4, -20, 0], [20, 4.4, Math.PI / 2], [4.4, 40, Math.PI], [-40, -4.4, -Math.PI / 2], [60, 4.4, Math.PI / 2]]) makeTrafficLight(tx, tz, ry);
function updateTrafficLights() {
  // cycle: 5s green, 1.5s yellow, 5s red, offset per light
  const t = S.gameTime * 60; // game clock drives the cycle
  for (const l of trafficLights) {
    const ph = (t + l.phase) % 11.5;
    const greenOn = ph < 5, yellowOn = ph >= 5 && ph < 6.5;
    l.red.color.setHex(greenOn || yellowOn ? 0x331111 : 0xff4444);
    l.yellow.color.setHex(yellowOn ? 0xffcc22 : 0x554411);
    l.green.color.setHex(greenOn ? 0x33ff66 : 0x114411);
  }
}

// ---------------------------------------------------------------- key locations
const LOC = {
  hospital: { x: -88, z: -88 },
  garage: { x: -88, z: 88 },
  gunshop: { x: 88, z: -88 },
  safehouse: { x: -88, z: 8 },
  warehouse: { x: 60, z: 60 },
  taxiStand: { x: 8, z: -88 },
  pier: { x: 108, z: -40 },
};
function makeSign(x, z, text, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#101018'; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = color; g.lineWidth = 6; g.strokeRect(4, 4, 504, 120);
  g.fillStyle = color; g.font = 'bold 56px sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 2.25),
    new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
  // sign mounted on the building's south face → rotated to face south (-z),
  // so the text reads from the direction the player arrives (without mirrored text)
  m.rotation.y = Math.PI;
  m.position.set(x, 4.6, z);
  scene.add(m);
  return m;
}
function makeMarker(x, z, color) {
  // mission beacon: see-through cylinder + light
  const geo = new THREE.CylinderGeometry(2.2, 2.2, 30, 20, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, 15, z);
  scene.add(m);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.6, 2.4, 24),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.08, z);
  scene.add(ring);
  return { beacon: m, ring };
}
// mission 3 warehouse: big building with a bright interior
{
  const wh = new THREE.Group();
  const walls = new THREE.MeshStandardMaterial({ color: 0x7a6a58, roughness: 0.9 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xb8a888, roughness: 0.85 });
  const mkWall = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || walls);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; wh.add(m);
    return m;
  };
  mkWall(24, 0.3, 16, 0, 0.15, 0, floorMat); // bright floor
  mkWall(24, 8, 0.6, 0, 4, -8); mkWall(24, 8, 0.6, 0, 4, 8);
  mkWall(0.6, 8, 16, -12, 4, 0); mkWall(0.6, 8, 16, 12, 4, 0);
  mkWall(24, 0.4, 16, 0, 8.2, 0); // roof
  // three ceiling lights + one warm light by the door (bright mission area)
  for (const lx of [-7, 0, 7]) {
    const l = new THREE.PointLight(0xffe0a0, 60, 30, 1.4);
    l.position.set(lx, 6.5, 0); wh.add(l);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 0.3, 8),
      new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd76a, emissiveIntensity: 0.8 }));
    shade.position.set(lx, 7.6, 0); wh.add(shade);
  }
  wh.position.set(LOC.warehouse.x, 0, LOC.warehouse.z);
  scene.add(wh);
  const frontLight = new THREE.PointLight(0xffe8c0, 80, 40, 1.3);
  frontLight.position.set(LOC.warehouse.x, 7, LOC.warehouse.z - 14);
  scene.add(frontLight);
  addBoxCollider(LOC.warehouse.x - 12, LOC.warehouse.z, 0.4, 8);
  addBoxCollider(LOC.warehouse.x + 12, LOC.warehouse.z, 0.4, 8);
  addBoxCollider(LOC.warehouse.x, LOC.warehouse.z - 8, 12, 0.4);
  addBoxCollider(LOC.warehouse.x, LOC.warehouse.z + 8, 12, 0.4);
  makeSign(LOC.warehouse.x, LOC.warehouse.z - 8.8, 'WAREHOUSE', '#ffb02e');
}
// ---------------------------------------------------------------- graffiti (English, on known walls)
function makeGraffiti(x, z, text, color, ry) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 128);
  g.fillStyle = color; g.font = 'bold 64px sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 1.75),
    new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide }));
  m.rotation.y = ry === undefined ? Math.PI : ry;
  m.position.set(x, 1.8, z);
  scene.add(m);
  return m;
}
// Placed on the south faces of the fixed key buildings so they are never
// floating or cut off: garage, gun shop, hospital, warehouse side wall.
{
  makeGraffiti(LOC.garage.x - 3, LOC.garage.z - 4.9, 'STAY GOLD', '#ffd76a');
  makeGraffiti(LOC.gunshop.x + 2, LOC.gunshop.z - 4.4, 'SOLMAR', '#ff7b7b');
  makeGraffiti(LOC.hospital.x + 3, LOC.hospital.z - 4.9, 'VERA RULES', '#9fe8ff');
  makeGraffiti(LOC.warehouse.x + 8, LOC.warehouse.z - 8.4, 'NO MERCY', '#ff9ecf');
}
// Dex's garage, gun shop, hospital, safehouse: buildings + name signs
makeBuilding(LOC.garage.x, LOC.garage.z, 12, 9, 6, buildingMats[2]);
makeSign(LOC.garage.x, LOC.garage.z - 5.2, "DEX'S GARAGE", '#7dff8a');
makeBuilding(LOC.gunshop.x, LOC.gunshop.z, 10, 8, 6, buildingMats[4]);
makeSign(LOC.gunshop.x, LOC.gunshop.z - 4.8, 'GUN SHOP', '#ff7b7b');
makeBuilding(LOC.hospital.x, LOC.hospital.z, 12, 9, 10, buildingMats[1]);
makeSign(LOC.hospital.x, LOC.hospital.z - 5.2, 'HOSPITAL', '#ffffff');
makeBuilding(LOC.safehouse.x, LOC.safehouse.z, 9, 8, 7, buildingMats[3]);
makeSign(LOC.safehouse.x, LOC.safehouse.z - 4.8, 'SAFEHOUSE', '#9fe8ff');
// pier (mission 5) + stunt ramp
{
  const pier = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, 24), new THREE.MeshStandardMaterial({ color: 0x8a6b48 }));
  pier.position.set(LOC.pier.x, 0.25, LOC.pier.z); pier.castShadow = true; scene.add(pier);
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(5, 0.6, 8), new THREE.MeshStandardMaterial({ color: 0xd8b13a }));
  ramp.position.set(30, 0.9, -30); ramp.rotation.x = -0.42; ramp.castShadow = true; scene.add(ramp);
  addBoxCollider(30, -30, 2.5, 4);
}
// cash bundles (collectible) — 12 scattered spots
const cashPickups = [];
{
  const geo = new THREE.BoxGeometry(0.9, 0.5, 0.5);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2fae4e, emissive: 0x1a7a30, emissiveIntensity: 0.6 });
  for (let i = 0; i < S.cashTotal; i++) {
    const x = Math.round(rand(-90, 90) / 20) * 20 + rand(-3, 3);
    const z = Math.round(rand(-90, 90) / 20) * 20 + rand(-3, 3);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, 0.8, z);
    m.rotation.y = rand(0, Math.PI);
    scene.add(m);
    cashPickups.push({ mesh: m, x, z, taken: false });
  }
}

// ---------------------------------------------------------------- vehicles & characters
const CAR_COLORS = [0xc23b2e, 0x2e6fc2, 0xe0a92e, 0x3fae5a, 0x8a5fc2, 0xd8d8d8, 0x222831, 0xe07840];
function makeCarMesh(color) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.62, 4.4), bodyMat);
  body.position.y = 0.55; body.castShadow = true; g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.2),
    new THREE.MeshStandardMaterial({ color: 0x1a2436, roughness: 0.15, metalness: 0.6 }));
  cabin.position.set(0, 1.1, -0.2); cabin.castShadow = true; g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  const wheels = [];
  for (const [x, z] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2; w.position.set(x, 0.36, z); g.add(w); wheels.push(w);
  }
  // headlights
  const hl = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 0.1),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2b0, emissiveIntensity: 0 }));
  hl.position.set(0, 0.62, 2.22); g.add(hl);
  const beam = new THREE.SpotLight(0xfff2b0, 0, 30, 0.5, 0.5, 1.2);
  beam.position.set(0, 0.7, 2.2);
  const beamTarget = new THREE.Object3D();
  beamTarget.position.set(0, 0, 12);
  g.add(beamTarget); beam.target = beamTarget; g.add(beam);
  g.userData = { wheels, headlightMat: hl.material, beam };
  return g;
}
const HAIR_COLORS = [0x1a1a1a, 0x4a2f1a, 0x8a6b3a, 0xd8d8d8, 0x6a3a1a];
function makePersonMesh(shirt, pants, skin, style) {
  // style: 'hair' | 'cap' | 'bandana' | 'none' — humans, not blocks
  const g = new THREE.Group();
  const legMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.24), legMat);
  legL.position.set(-0.14, 0.4, 0); g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.14; g.add(legR);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.75, 0.34), bodyMat);
  torso.position.y = 1.18; torso.castShadow = true; g.add(torso);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 0.18), bodyMat);
  armL.position.set(-0.4, 1.18, 0); g.add(armL);
  const armR = armL.clone(); armR.position.x = 0.4; g.add(armR);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), skinMat);
  head.position.y = 1.78; head.castShadow = true; g.add(head);
  const s = style || pick(['hair', 'hair', 'cap', 'none']);
  if (s === 'hair') {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({ color: pick(HAIR_COLORS), roughness: 1 }));
    hair.position.y = 1.84; g.add(hair);
  } else if (s === 'cap') {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.26, 0.12, 10),
      new THREE.MeshStandardMaterial({ color: pick([0xc23b2e, 0x2e6fc2, 0x1a1a1a, 0xe0a92e]), roughness: 0.9 }));
    cap.position.y = 1.96; g.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.25), cap.material);
    brim.position.set(0, 1.92, 0.3); g.add(brim);
  } else if (s === 'bandana') {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xc23b2e, roughness: 0.9 }));
    band.position.y = 1.88; g.add(band);
  }
  g.userData = { legL, legR, armL, armR };
  return g;
}

// ---- player
const player = {
  mesh: makePersonMesh(0x2e6fc2, 0x2a2f3a, 0xd9a066, 'cap'),
  pos: new THREE.Vector3(0, 0, 6), vel: new THREE.Vector3(),
  heading: 0, onGround: true, inCar: null, walkPhase: 0,
};
scene.add(player.mesh);
const camYaw = { v: 0 }; const camPitch = { v: 0.32 };

// ---- car
function makeCar(x, z, heading, color, isTraffic) {
  const mesh = makeCarMesh(color);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  scene.add(mesh);
  return {
    mesh, pos: mesh.position, heading, speed: 0,
    color, isTraffic: !!isTraffic, hp: 100, smoke: 0,
    driver: null, ai: isTraffic ? { axis: 'x', dir: 1, lane: 0, targetSpeed: rand(6, 10) } : null,
  };
}
const cars = [];
// parked cars
for (let i = 0; i < 14; i++) {
  const road = Math.floor(rand(-5, 5)) * ROAD_GAP;
  const along = rand(-95, 95);
  const horizontal = rng() < 0.5;
  cars.push(makeCar(
    horizontal ? along : road + (rng() < 0.5 ? 4.6 : -4.6),
    horizontal ? road + (rng() < 0.5 ? 4.6 : -4.6) : along,
    horizontal ? (rng() < 0.5 ? 0 : Math.PI) : (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2),
    pick(CAR_COLORS), false));
}
// traffic AI — 20 cars
const traffic = [];
for (let i = 0; i < 20; i++) {
  const horizontal = rng() < 0.5;
  const road = Math.floor(rand(-5, 5)) * ROAD_GAP;
  const along = rand(-95, 95);
  const dir = rng() < 0.5 ? 1 : -1;
  const lane = dir > 0 ? 1.6 : -1.6;
  const c = makeCar(
    horizontal ? along : road + lane,
    horizontal ? road + lane : along,
    horizontal ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI),
    pick(CAR_COLORS), true);
  c.ai.axis = horizontal ? 'x' : 'z';
  c.ai.dir = dir;
  c.ai.lane = lane;
  c.speed = c.ai.targetSpeed;
  cars.push(c); traffic.push(c);
}
// police
const police = [];
function spawnPolice(x, z, bike) {
  const mesh = bike ? makePersonMesh(0x1a2a44, 0x1a2a44, 0xd9a066, 'cap') : makeCarMesh(0x1a2a44);
  if (!bike) {
    // white stripe + strobe light
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.2, 4.42),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4 }));
    stripe.position.y = 0.7; mesh.add(stripe);
  }
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  const p = { mesh, pos: mesh.position, heading: rng() * Math.PI * 2, speed: 0, bike: !!bike, hp: 100 };
  police.push(p);
  return p;
}
function updatePoliceCount() {
  const want = S.wanted === 0 ? 0 : Math.min(4, S.wanted);
  while (police.filter((p) => !p.bike).length < want) {
    const a = rng() * Math.PI * 2;
    spawnPolice(player.pos.x + Math.cos(a) * 45, player.pos.z + Math.sin(a) * 45, false);
  }
  while (police.filter((p) => !p.bike).length > want) {
    const i = police.findIndex((p) => !p.bike);
    if (i < 0) break;
    scene.remove(police[i].mesh); police.splice(i, 1);
  }
  const wantBike = S.wanted >= 2 ? 1 : 0;
  while (police.filter((p) => p.bike).length < wantBike) {
    const a = rng() * Math.PI * 2;
    spawnPolice(player.pos.x + Math.cos(a) * 40, player.pos.z + Math.sin(a) * 40, true);
  }
  while (police.filter((p) => p.bike).length > wantBike) {
    const i = police.findIndex((p) => p.bike);
    if (i < 0) break;
    scene.remove(police[i].mesh); police.splice(i, 1);
  }
}

// ---- pedestrians — 32 people
const peds = [];
const SKINS = [0xd9a066, 0xb07a4a, 0x8a5a34, 0xe8b88a];
const SHIRTS = [0xc23b2e, 0x2e6fc2, 0x3fae5a, 0xe0a92e, 0x8a5fc2, 0xd8d8d8, 0xe07840, 0x4a9a8a];
for (let i = 0; i < 32; i++) {
  const mesh = makePersonMesh(pick(SHIRTS), pick([0x2a2f3a, 0x4a3a2a, 0x333a4a]), pick(SKINS));
  const road = Math.floor(rand(-5, 5)) * ROAD_GAP;
  const along = rand(-95, 95);
  const horizontal = rng() < 0.5;
  mesh.position.set(
    horizontal ? along : road + (rng() < 0.5 ? 7.5 : -7.5),
    0,
    horizontal ? road + (rng() < 0.5 ? 7.5 : -7.5) : along);
  scene.add(mesh);
  peds.push({
    mesh, pos: mesh.position, heading: rng() * Math.PI * 2,
    speed: rand(1.2, 2.2), flee: 0, fleeX: 0, fleeZ: 0, phase: rand(0, 6),
  });
}
// ---- mission 3 enemies (warehouse)
const enemies = [];
function spawnEnemies() {
  // enemies stand IN FRONT of the warehouse (south side, z 43-46) — not inside
  // the building (walls are closed, the player can't enter/see inside).
  // Spread wide so all 4 are in frame for the mission screenshot.
  for (const [dx, dz] of [[-8, -16], [-3, -14], [3, -15], [8, -17]]) {
    const mesh = makePersonMesh(0x3a1a1a, 0x222222, pick(SKINS), 'bandana');
    mesh.position.set(LOC.warehouse.x + dx, 0, LOC.warehouse.z + dz);
    scene.add(mesh);
    // health bar di atas kepala
    const barBg = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.16),
      new THREE.MeshBasicMaterial({ color: 0x330000, side: THREE.DoubleSide }));
    barBg.position.y = 2.25; mesh.add(barBg);
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff4444, side: THREE.DoubleSide }));
    bar.position.set(0, 2.25, 0.01); mesh.add(bar);
    enemies.push({ mesh, pos: mesh.position, hp: 100, bar, alive: true, shootCd: rand(1, 2) });
  }
}

// ---------------------------------------------------------------- input
const keys = {};
let mouseDX = 0, mouseDY = 0, mouseDown = false, lastShot = 0;
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (!S.started || S.paused || S.over) return;
  if (e.code === 'KeyE') tryEnterExitCar();
  if (e.code === 'KeyR') reloadWeapon();
  if (e.code === 'KeyF') punch();
  if (e.code === 'KeyB') tryOpenGarage();
  if (e.code === 'KeyG') tryOpenGunshop();
  if (e.code === 'KeyT') openSidejobs();
  if (e.code === 'KeyN') nextRadio();
  if (e.code === 'KeyM') { const m = AudioSys.toggleMute(); toast(m ? 'Sound off' : 'Sound on'); }
  if (e.code === 'Escape') togglePause();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
// safe pointer lock: failing without a gesture must not throw an unhandled rejection
function lockPointer() {
  try {
    const p = canvas.requestPointerLock?.();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* pointer lock tidak tersedia */ }
}
canvas.addEventListener('click', () => {
  if (!S.started || S.paused || S.over) return;
  AudioSys.init();
  if (document.pointerLockElement !== canvas) lockPointer();
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) { mouseDX += e.movementX; mouseDY += e.movementY; }
});
addEventListener('mousedown', (e) => { if (e.button === 0) mouseDown = true; });
addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- HUD helpers
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.opacity = 0; }, 2200);
}
let bannerTimer = null;
function banner(msg) {
  const b = $('banner');
  b.textContent = msg; b.classList.remove('hidden');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.add('hidden'), 2400);
}
let dialogTimer = null;
function showDialog(name, text) {
  $('dialog-name').textContent = name;
  $('dialog-text').textContent = text;
  $('dialog').classList.remove('hidden');
  clearTimeout(dialogTimer);
  dialogTimer = setTimeout(() => $('dialog').classList.add('hidden'), 6000);
}
function setObjective(title, text) {
  $('obj-title').textContent = title;
  $('obj-text').textContent = text;
}
function nextRadio() {
  S.radio = (S.radio + 1) % RADIO_TRACKS.length;
  $('radio').textContent = '♪ ' + RADIO_TRACKS[S.radio].name;
}

// ---------------------------------------------------------------- wanted
function addWanted(n, reason) {
  if (S.wanted >= 5) return;
  S.wanted = Math.min(5, S.wanted + n);
  S.crimeTimer = 0;
  updatePoliceCount();
  if (S.wanted > 0) toast(`Wanted level up! ${reason || ''}`);
}
function updateWanted(dt) {
  S.crimeTimer += dt;
  if (S.wanted > 0 && S.crimeTimer > 20) {
    let nearest = 1e9;
    for (const p of police) nearest = Math.min(nearest, dist2d(p.pos, player.pos));
    if (nearest > 40) {
      S.wantedTimer += dt;
      if (S.wantedTimer > 5) { S.wanted--; S.wantedTimer = 0; updatePoliceCount(); }
    }
  }
  AudioSys.siren(S.wanted > 0 && police.length > 0);
}

// ---------------------------------------------------------------- vehicles: enter/exit, driving
function nearestCar(maxD) {
  let best = null, bd = maxD;
  for (const c of cars) {
    const d = dist2d(c.pos, player.pos);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
function tryEnterExitCar() {
  if (player.inCar) {
    const car = player.inCar;
    player.inCar = null;
    player.pos.set(car.pos.x + 3, 0, car.pos.z);
    player.mesh.visible = true;
    $('hint').textContent = 'E: enter car · Click: shoot · F: punch';
    return;
  }
  const car = nearestCar(4.5);
  if (!car) return;
  if (car.isTraffic) addWanted(1, 'Stole a car!');
  player.inCar = car;
  car.driver = player;
  player.mesh.visible = false;
  $('hint').textContent = 'WASD: drive · Space: brake · E: exit';
  AudioSys.init();
}
function carTopSpeed() { return 26 * (1 + 0.15 * S.upgrades.engine); }
function carAccel() { return 14 * (1 + 0.12 * S.upgrades.engine); }
function carTurn() { return 1.9 * (1 + 0.18 * S.upgrades.tires); }
function updatePlayerCar(dt) {
  const car = player.inCar;
  const fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const steer = (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0);
  const target = fwd * carTopSpeed();
  car.speed = lerp(car.speed, target, clamp(carAccel() * dt / carTopSpeed(), 0, 1));
  if (keys.Space) car.speed = lerp(car.speed, 0, clamp(6 * dt, 0, 1));
  if (Math.abs(car.speed) > 0.5) car.heading += steer * carTurn() * dt * Math.sign(car.speed) * clamp(Math.abs(car.speed) / 8, 0.3, 1);
  const nx = car.pos.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.pos.z + Math.cos(car.heading) * car.speed * dt;
  if (!collideCircle(nx, nz, 1.7)) { car.pos.x = nx; car.pos.z = nz; }
  else {
    if (Math.abs(car.speed) > 6) { damageCar(car, Math.abs(car.speed) * 1.2); addWanted(0); }
    car.speed *= 0.4;
  }
  // ramp stunt: jumping
  if (car.y === undefined) { car.y = 0; car.vy = 0; car.airTime = 0; }
  const onRamp = Math.abs(car.pos.x - 30) < 3.5 && Math.abs(car.pos.z + 30) < 5;
  if (onRamp && car.y <= 0.01 && Math.abs(car.speed) > 12) car.vy = 5 + Math.abs(car.speed) * 0.18;
  if (car.y > 0 || car.vy > 0) {
    car.vy -= 22 * dt; car.y += car.vy * dt; car.airTime += dt;
    if (car.y <= 0) {
      car.y = 0;
      if (S.job && S.job.type === 'stunt' && car.airTime > 0.8) finishStunt(car.airTime);
      car.airTime = 0; car.vy = 0;
    }
  }
  car.mesh.position.set(car.pos.x, car.y, car.pos.z);
  car.mesh.rotation.y = car.heading;
  car.mesh.rotation.z = -steer * 0.06 * Math.sign(car.speed);
  player.pos.copy(car.pos);
  player.heading = car.heading;
  // damage smoke
  if (car.hp < 55) spawnSmoke(car.pos.x, car.pos.y + 1.2, car.pos.z);
  AudioSys.engine(Math.abs(car.speed) / carTopSpeed());
}
function damageCar(car, dmg) {
  const reduced = dmg * (1 - 0.18 * S.upgrades.armor);
  car.hp -= reduced;
  if (car.hp <= 0) {
    car.hp = 0;
    if (car === player.inCar) {
      toast('Your car is wrecked!');
      player.inCar = null; car.driver = null;
      player.pos.set(car.pos.x + 3, 0, car.pos.z);
      player.mesh.visible = true;
    }
  }
}
// smoke: pool of transparent spheres
const smokePool = [];
function spawnSmoke(x, y, z) {
  if (smokePool.length > 24) return;
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.45 }));
  m.position.set(x + rand(-0.5, 0.5), y, z + rand(-0.5, 0.5));
  scene.add(m);
  smokePool.push({ m, life: 1 });
}
function updateSmoke(dt) {
  for (let i = smokePool.length - 1; i >= 0; i--) {
    const s = smokePool[i];
    s.life -= dt;
    s.m.position.y += dt * 1.6;
    s.m.material.opacity = Math.max(0, s.life * 0.45);
    s.m.scale.setScalar(1 + (1 - s.life) * 1.6);
    if (s.life <= 0) { scene.remove(s.m); smokePool.splice(i, 1); }
  }
}

// ---- player on foot
function updatePlayerOnFoot(dt) {
  const run = keys.ShiftLeft || keys.ShiftRight;
  const speed = run ? 10 : 6;
  let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  let iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const len = Math.hypot(ix, iz) || 1;
  ix /= len; iz /= len;
  const sin = Math.sin(camYaw.v), cos = Math.cos(camYaw.v);
  const vx = (ix * cos - iz * sin) * speed;
  const vz = (ix * sin + iz * cos) * speed;
  const nx = player.pos.x + vx * dt;
  const nz = player.pos.z + vz * dt;
  if (!collideCircle(nx, player.pos.z, 0.5)) player.pos.x = nx;
  if (!collideCircle(player.pos.x, nz, 0.5)) player.pos.z = nz;
  if (ix !== 0 || iz !== 0) {
    player.heading = Math.atan2(vx, vz);
    player.walkPhase += dt * (run ? 11 : 8);
    const sw = Math.sin(player.walkPhase) * 0.5;
    player.mesh.userData.legL.rotation.x = sw;
    player.mesh.userData.legR.rotation.x = -sw;
    player.mesh.userData.armL.rotation.x = -sw * 0.7;
    player.mesh.userData.armR.rotation.x = sw * 0.7;
  } else {
    player.mesh.userData.legL.rotation.x *= 0.8;
    player.mesh.userData.legR.rotation.x *= 0.8;
  }
  // jump + gravity
  if (keys.Space && player.onGround) { player.vel.y = 8; player.onGround = false; }
  player.vel.y -= 22 * dt;
  player.pos.y += player.vel.y * dt;
  if (player.pos.y <= 0) { player.pos.y = 0; player.vel.y = 0; player.onGround = true; }
  player.pos.x = clamp(player.pos.x, -135, 145);
  player.pos.z = clamp(player.pos.z, -115, 115);
  player.mesh.position.copy(player.pos);
  player.mesh.rotation.y = player.heading;
  AudioSys.engine(0);
  // pick up cash bundles
  for (const c of cashPickups) {
    if (!c.taken && dist2d(player.pos, c) < 1.6) {
      c.taken = true; c.mesh.visible = false;
      S.money += 150; S.cashFound++;
      AudioSys.chime(); toast('+$150 cash!');
    }
  }
}

// ---------------------------------------------------------------- combat
const raycaster = new THREE.Raycaster();
function currentWeapon() { return WEAPONS[S.weapon]; }
function reloadWeapon() {
  const w = currentWeapon();
  if (S.weapon === 'pistol') { S.mag.pistol = w.mag; return; }
  if (S.ammo[S.weapon] <= 0) { toast('Out of ammo — buy at the gun shop [G]'); return; }
  const need = w.mag - S.mag[S.weapon];
  const take = Math.min(need, S.ammo[S.weapon]);
  S.ammo[S.weapon] -= take; S.mag[S.weapon] += take;
  toast('Reloading...');
}
function shoot() {
  const now = performance.now() / 1000;
  const w = currentWeapon();
  if (now - lastShot < 1 / w.rate) return;
  if (S.mag[S.weapon] <= 0) { reloadWeapon(); return; }
  lastShot = now;
  S.mag[S.weapon]--;
  AudioSys.shot();
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  raycaster.far = 120;
  const targets = [];
  for (const e of enemies) if (e.alive) targets.push(e.mesh);
  for (const p of peds) targets.push(p.mesh);
  for (const c of cars) if (c !== player.inCar) targets.push(c.mesh);
  const hits = raycaster.intersectObjects(targets, true);
  if (hits.length > 0) {
    let obj = hits[0].object;
    while (obj.parent && obj.parent !== scene) obj = obj.parent;
    const en = enemies.find((e) => e.mesh === obj);
    if (en) {
      en.hp -= w.dmg;
      en.bar.scale.x = Math.max(0, en.hp / 100);
      if (en.hp <= 0) {
        en.alive = false; en.mesh.visible = false;
        S.kills++;
        toast('Enemy down!');
      }
    } else {
      const ped = peds.find((p) => p.mesh === obj);
      if (ped) {
        scene.remove(ped.mesh);
        peds.splice(peds.indexOf(ped), 1);
        addWanted(1, 'Shot a civilian!');
        scarePeds(player.pos.x, player.pos.z);
      } else {
        const car = cars.find((c) => c.mesh === obj);
        if (car) damageCar(car, w.dmg * 0.5);
      }
    }
  }
  if (S.wanted === 0 && rng() < 0.5) addWanted(1, 'Gunfire heard!');
}
function punch() {
  const range = 2.4;
  for (const e of enemies) {
    if (!e.alive) continue;
    if (dist2d(e.pos, player.pos) < range) {
      e.hp -= 25; e.bar.scale.x = Math.max(0, e.hp / 100);
      if (e.hp <= 0) { e.alive = false; e.mesh.visible = false; S.kills++; }
      toast('Punch landed!');
      return;
    }
  }
  for (const p of [...peds]) {
    if (dist2d(p.pos, player.pos) < range) {
      scene.remove(p.mesh); peds.splice(peds.indexOf(p), 1);
      addWanted(1, 'Assaulted a civilian!');
      scarePeds(player.pos.x, player.pos.z);
      return;
    }
  }
}
function scarePeds(x, z) {
  for (const p of peds) {
    if (dist2d(p.pos, { x, z }) < 25) {
      p.flee = 4; p.fleeX = x; p.fleeZ = z;
    }
  }
}

// ---------------------------------------------------------------- missions
const missionMarker = makeMarker(0, 0, 0xffd76a);
missionMarker.beacon.visible = false; missionMarker.ring.visible = false;
let missionTarget = null;
function setMissionTarget(x, z) {
  missionTarget = { x, z };
  missionMarker.beacon.position.set(x, 15, z);
  missionMarker.ring.position.set(x, 0.08, z);
  missionMarker.beacon.visible = true; missionMarker.ring.visible = true;
}
function clearMissionTarget() {
  missionTarget = null;
  missionMarker.beacon.visible = false; missionMarker.ring.visible = false;
}
function startMission(i) {
  const m = MISSIONS[i];
  S.mission = i; S.missionStage = 0; S.missionData = {};
  setObjective(m.title, m.obj);
  showDialog(m.dialog[0], m.dialog[1]);
  banner(m.title);
  if (i === 0) {
    // mission car: parked near spawn
    const mc = cars[0];
    mc.pos.set(0, 0, 14); mc.mesh.position.set(0, 0, 14);
    setMissionTarget(0, 14);
  } else if (i === 1) {
    S.missionData.points = [];
    for (let k = 0; k < 4; k++) S.missionData.points.push({ x: Math.floor(rand(-4, 4)) * 20, z: Math.floor(rand(-4, 4)) * 20 });
    S.missionData.idx = 0; S.missionTimer = 90;
    setMissionTarget(S.missionData.points[0].x, S.missionData.points[0].z);
  } else if (i === 2) {
    setMissionTarget(LOC.warehouse.x, LOC.warehouse.z);
  } else if (i === 3) {
    S.wanted = 3; updatePoliceCount();
    setMissionTarget(LOC.safehouse.x, LOC.safehouse.z);
  } else if (i === 4) {
    setMissionTarget(LOC.pier.x, LOC.pier.z);
  } else if (i === 5) {
    S.wanted = 4; updatePoliceCount();
    S.missionData.points = [];
    for (let k = 0; k < 3; k++) S.missionData.points.push({ x: Math.floor(rand(-4, 4)) * 20, z: Math.floor(rand(-4, 4)) * 20 });
    S.missionData.idx = 0;
    setMissionTarget(S.missionData.points[0].x, S.missionData.points[0].z);
  }
}
function completeMission() {
  const m = MISSIONS[S.mission];
  S.money += m.reward;
  toast(`Mission complete! +$${m.reward}`);
  AudioSys.chime();
  banner('MISSION COMPLETE');
  clearMissionTarget();
  saveGame();
  if (S.mission === 5) {
    S.debt = 0;
    banner('DEBT PAID OFF!');
    showDialog('Vera', 'Paid in full, Marco. You are free. Solmar City is yours now — take good care of it.');
    setObjective('FREE ROAM', 'Debt paid off — explore the city, take side jobs, have fun.');
    S.mission = 6;
    return;
  }
  startMission(S.mission + 1);
}
function updateMission(dt) {
  if (S.mission >= 6) return;
  const m = S.mission;
  const near = (x, z, r) => dist2d(player.pos, { x, z }) < r;
  if (m === 0) {
    if (S.missionStage === 0) {
      if (player.inCar) { S.missionStage = 1; setMissionTarget(LOC.garage.x, LOC.garage.z); setObjective(m.title, "Deliver the car to Dex's Garage"); }
    } else if (near(LOC.garage.x, LOC.garage.z, 8)) completeMission();
  } else if (m === 1) {
    S.missionTimer -= dt;
    const p = S.missionData.points[S.missionData.idx];
    if (near(p.x, p.z, 5)) {
      S.missionData.idx++;
      AudioSys.chime();
      if (S.missionData.idx >= 4) completeMission();
      else setMissionTarget(S.missionData.points[S.missionData.idx].x, S.missionData.points[S.missionData.idx].z);
    } else if (S.missionTimer <= 0) {
      toast("Time's up — try again!");
      S.missionTimer = 90; S.missionData.idx = 0;
      setMissionTarget(S.missionData.points[0].x, S.missionData.points[0].z);
    }
  } else if (m === 2) {
    if (S.missionStage === 0) {
      if (near(LOC.warehouse.x, LOC.warehouse.z, 10)) {
        S.missionStage = 1; spawnEnemies();
        setObjective(m.title, 'Take down the 4 gang members!');
      }
    } else if (enemies.length > 0 && enemies.every((e) => !e.alive)) completeMission();
  } else if (m === 3) {
    if (near(LOC.safehouse.x, LOC.safehouse.z, 6)) {
      S.wanted = 0; updatePoliceCount();
      completeMission();
    }
  } else if (m === 4) {
    if (S.missionStage === 0) {
      if (near(LOC.pier.x, LOC.pier.z, 5)) {
        S.missionStage = 1; S.wanted = Math.max(S.wanted, 2); updatePoliceCount();
        const d = { x: Math.floor(rand(-4, 4)) * 20, z: Math.floor(rand(-4, 4)) * 20 };
        S.missionData.drop = d; setMissionTarget(d.x, d.z);
        setObjective(m.title, 'Deliver the package to the drop point!');
        toast('Package picked up!');
      }
    } else if (near(S.missionData.drop.x, S.missionData.drop.z, 5)) completeMission();
  } else if (m === 5) {
    const p = S.missionData.points[S.missionData.idx];
    if (near(p.x, p.z, 5)) {
      S.missionData.idx++;
      AudioSys.chime();
      if (S.missionData.idx >= 3) completeMission();
      else setMissionTarget(S.missionData.points[S.missionData.idx].x, S.missionData.points[S.missionData.idx].z);
    }
  }
}

// ---------------------------------------------------------------- side jobs
function openSidejobs() {
  const p = $('sidejobs');
  p.classList.toggle('hidden');
  if (p.classList.contains('hidden')) return;
  const box = $('sidejob-items');
  box.innerHTML = '';
  const jobs = [
    ['taxi', 'Taxi', 'Drive a passenger — $150+ (needs a car)'],
    ['package', 'Package', 'Pick up + deliver a package — $200'],
    ['stunt', 'Stunt Jump', 'Jump off the ramp — airtime = $'],
  ];
  for (const [type, name, desc] of jobs) {
    const row = document.createElement('div');
    row.className = 'shop-row';
    row.innerHTML = `<span>${name}<small>${desc}</small></span>`;
    const b = document.createElement('button');
    b.textContent = 'Start';
    b.onclick = () => { startJob(type); p.classList.add('hidden'); };
    row.appendChild(b);
    box.appendChild(row);
  }
}
function startJob(type) {
  if (type === 'taxi' && !player.inCar) { toast('Taxi needs a car — get in one first!'); return; }
  if (type === 'taxi') {
    const from = { x: Math.floor(rand(-4, 4)) * 20, z: Math.floor(rand(-4, 4)) * 20 };
    const to = { x: Math.floor(rand(-4, 4)) * 20, z: Math.floor(rand(-4, 4)) * 20 };
    S.job = { type, stage: 0, from, to, timer: 90 };
    setMissionTarget(from.x, from.z);
    $('job').textContent = 'TAXI: pick up the passenger (90 sec)';
    toast('A passenger is waiting — go pick them up!');
  } else if (type === 'package') {
    const from = { x: Math.floor(rand(-4, 4)) * 20, z: Math.floor(rand(-4, 4)) * 20 };
    const to = { x: Math.floor(rand(-4, 4)) * 20, z: Math.floor(rand(-4, 4)) * 20 };
    S.job = { type, stage: 0, from, to, timer: 120 };
    setMissionTarget(from.x, from.z);
    $('job').textContent = 'PACKAGE: pick up the package (120 sec)';
  } else {
    S.job = { type, stage: 0, timer: 60 };
    setMissionTarget(30, -30);
    $('job').textContent = 'STUNT: jump off the yellow ramp (60 sec)!';
    toast('Hit the yellow ramp and jump!');
  }
}
function updateJob(dt) {
  if (!S.job) return;
  const j = S.job;
  j.timer -= dt;
  if (j.timer <= 0) {
    toast('Job failed — out of time.');
    S.job = null; $('job').textContent = ' '; clearMissionTarget();
    if (S.mission < 6) startMissionTargetRestore();
    return;
  }
  const near = (x, z, r) => dist2d(player.pos, { x, z }) < r;
  if (j.type === 'taxi' || j.type === 'package') {
    if (j.stage === 0) {
      if (near(j.from.x, j.from.z, 5)) {
        j.stage = 1;
        setMissionTarget(j.to.x, j.to.z);
        $('job').textContent = j.type === 'taxi' ? 'TAXI: drop off the passenger!' : 'PACKAGE: deliver to the destination!';
        AudioSys.chime();
      }
    } else if (near(j.to.x, j.to.z, 5)) {
      const pay = j.type === 'taxi' ? 150 + Math.floor(j.timer) : 200;
      S.money += pay;
      toast(`Job done! +$${pay}`);
      AudioSys.chime();
      S.job = null; $('job').textContent = ' ';
      clearMissionTarget();
      if (S.mission < 6) startMissionTargetRestore();
    }
  }
}
function finishStunt(airTime) {
  if (!S.job || S.job.type !== 'stunt') return;
  const pay = Math.floor(airTime * 60);
  S.money += pay;
  toast(`Stunt! ${airTime.toFixed(1)} sec in the air — +$${pay}`);
  AudioSys.chime();
  S.job = null; $('job').textContent = ' ';
  clearMissionTarget();
  if (S.mission < 6) startMissionTargetRestore();
}
function startMissionTargetRestore() {
  // restore the mission marker after a job ends (simple: restart the active mission marker)
  const m = S.mission;
  if (m === 0) setMissionTarget(player.inCar ? LOC.garage.x : 0, player.inCar ? LOC.garage.z : 14);
  else if (m === 1) { const p = S.missionData.points[S.missionData.idx]; setMissionTarget(p.x, p.z); }
  else if (m === 2) setMissionTarget(LOC.warehouse.x, LOC.warehouse.z);
  else if (m === 3) setMissionTarget(LOC.safehouse.x, LOC.safehouse.z);
  else if (m === 4) setMissionTarget(S.missionStage === 0 ? LOC.pier.x : S.missionData.drop.x, S.missionStage === 0 ? LOC.pier.z : S.missionData.drop.z);
  else if (m === 5) { const p = S.missionData.points[S.missionData.idx]; setMissionTarget(p.x, p.z); }
}

// ---------------------------------------------------------------- shops
function shopRow(name, desc, price, owned, buy) {
  const row = document.createElement('div');
  row.className = 'shop-row';
  row.innerHTML = `<span>${name}<small>${desc}</small></span>`;
  const b = document.createElement('button');
  b.textContent = owned ? 'Owned' : `$${price}`;
  b.disabled = owned || S.money < price;
  b.onclick = () => { if (S.money >= price) { S.money -= price; buy(); } };
  row.appendChild(b);
  return row;
}
function tryOpenGarage() {
  if (dist2d(player.pos, LOC.garage) > 12 || !player.inCar) {
    if (dist2d(player.pos, LOC.garage) <= 12) toast('Get in a car to upgrade!');
    return;
  }
  const p = $('garage');
  p.classList.toggle('hidden');
  if (p.classList.contains('hidden')) return;
  $('garage-money').textContent = `Your cash: $${S.money}`;
  const box = $('garage-items');
  box.innerHTML = '';
  for (const [key, u] of Object.entries(UPGRADES)) {
    const lvl = S.upgrades[key];
    const maxed = lvl >= 3;
    const row = document.createElement('div');
    row.className = 'shop-row';
    row.innerHTML = `<span>${u.name} Lv${lvl}<small>${u.desc}</small></span>`;
    const b = document.createElement('button');
    b.textContent = maxed ? 'MAX' : `$${u.costs[lvl]}`;
    b.disabled = maxed || S.money < u.costs[lvl];
    b.onclick = () => {
      S.money -= u.costs[lvl]; S.upgrades[key]++;
      AudioSys.chime(); toast(`${u.name} upgraded to Lv${S.upgrades[key]}!`);
      tryOpenGarage(); tryOpenGarage(); // refresh panel
    };
    row.appendChild(b);
    box.appendChild(row);
  }
}
function tryOpenGunshop() {
  if (dist2d(player.pos, LOC.gunshop) > 10) return;
  const p = $('gunshop');
  p.classList.toggle('hidden');
  if (p.classList.contains('hidden')) return;
  $('gunshop-money').textContent = `Your cash: $${S.money}`;
  const box = $('gunshop-items');
  box.innerHTML = '';
  box.appendChild(shopRow('SMG', 'Damage 20 · high fire rate · mag 30', 800, S.owned.smg, () => {
    S.owned.smg = true; S.ammo.smg += 60; S.weapon = 'smg'; S.mag.smg = 30; tryOpenGunshop(); tryOpenGunshop();
  }));
  box.appendChild(shopRow('Rifle', 'Damage 55 · mag 20', 1800, S.owned.rifle, () => {
    S.owned.rifle = true; S.ammo.rifle += 40; S.weapon = 'rifle'; S.mag.rifle = 20; tryOpenGunshop(); tryOpenGunshop();
  }));
  const ammoRow = document.createElement('div');
  ammoRow.className = 'shop-row';
  ammoRow.innerHTML = '<span>Ammo<small>30 rounds for the active weapon (not pistol)</small></span>';
  const ab = document.createElement('button');
  ab.textContent = '$50';
  ab.disabled = S.weapon === 'pistol' || S.money < 50;
  ab.onclick = () => { S.money -= 50; S.ammo[S.weapon] += 30; toast('+30 ammo'); };
  ammoRow.appendChild(ab);
  box.appendChild(ammoRow);
  // switch weapon
  const swRow = document.createElement('div');
  swRow.className = 'shop-row';
  swRow.innerHTML = '<span>Switch weapon<small>Click to use a weapon you own</small></span>';
  const sw = document.createElement('button');
  sw.textContent = 'Pistol / SMG / Rifle';
  sw.onclick = () => {
    const owned = ['pistol', ...(S.owned.smg ? ['smg'] : []), ...(S.owned.rifle ? ['rifle'] : [])];
    const i = owned.indexOf(S.weapon);
    S.weapon = owned[(i + 1) % owned.length];
    toast(`Weapon: ${WEAPONS[S.weapon].name}`);
  };
  swRow.appendChild(sw);
  box.appendChild(swRow);
}
document.querySelectorAll('.close-panel').forEach((b) => {
  b.addEventListener('click', () => b.closest('.panel').classList.add('hidden'));
});

// ---------------------------------------------------------------- update AI
function updateTraffic(dt) {
  for (const c of traffic) {
    if (c === player.inCar) continue;
    // waypoint: persimpangan terdekat di depan
    if (!c.wp || dist2d(c.pos, c.wp) < 4) {
      const gx = Math.round(c.pos.x / ROAD_GAP) * ROAD_GAP;
      const gz = Math.round(c.pos.z / ROAD_GAP) * ROAD_GAP;
      const dirs = [[20, 0], [-20, 0], [0, 20], [0, -20]];
      const d = pick(dirs);
      c.wp = {
        x: clamp(gx + d[0], -100, 100),
        z: clamp(gz + d[1], -100, 100),
      };
    }
    const want = Math.atan2(c.wp.x - c.pos.x, c.wp.z - c.pos.z);
    let dh = want - c.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    c.heading += clamp(dh, -1.8 * dt, 1.8 * dt);
    c.speed = lerp(c.speed, c.ai.targetSpeed, dt);
    c.pos.x += Math.sin(c.heading) * c.speed * dt;
    c.pos.z += Math.cos(c.heading) * c.speed * dt;
    c.pos.x = clamp(c.pos.x, -104, 104);
    c.pos.z = clamp(c.pos.z, -104, 104);
    c.mesh.position.copy(c.pos);
    c.mesh.rotation.y = c.heading;
  }
  // car-on-car collision: push apart
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 3.4 && d > 0.01) {
        const push = (3.4 - d) / 2;
        const nx = dx / d, nz = dz / d;
        a.pos.x -= nx * push; a.pos.z -= nz * push;
        b.pos.x += nx * push; b.pos.z += nz * push;
        a.mesh.position.copy(a.pos); b.mesh.position.copy(b.pos);
      }
    }
  }
}
function updatePeds(dt) {
  for (const p of peds) {
    if (p.flee > 0) {
      p.flee -= dt;
      const a = Math.atan2(p.pos.x - p.fleeX, p.pos.z - p.fleeZ);
      p.pos.x += Math.sin(a) * 5 * dt;
      p.pos.z += Math.cos(a) * 5 * dt;
      p.heading = a;
    } else {
      if (rng() < dt * 0.1) p.heading += pick([-Math.PI / 2, Math.PI / 2, Math.PI, 0]);
      p.pos.x += Math.sin(p.heading) * p.speed * dt;
      p.pos.z += Math.cos(p.heading) * p.speed * dt;
      if (Math.abs(p.pos.x) > 104 || Math.abs(p.pos.z) > 104) p.heading += Math.PI;
    }
    p.pos.x = clamp(p.pos.x, -104, 104);
    p.pos.z = clamp(p.pos.z, -104, 104);
    p.phase += dt * 7;
    const sw = Math.sin(p.phase) * 0.45;
    p.mesh.userData.legL.rotation.x = sw;
    p.mesh.userData.legR.rotation.x = -sw;
    p.mesh.userData.armL.rotation.x = -sw * 0.8;
    p.mesh.userData.armR.rotation.x = sw * 0.8;
    p.mesh.position.copy(p.pos);
    p.mesh.rotation.y = p.heading;
  }
}
function updatePolice(dt) {
  for (const p of police) {
    const d = dist2d(p.pos, player.pos);
    const want = Math.atan2(player.pos.x - p.pos.x, player.pos.z - p.pos.z);
    let dh = want - p.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    p.heading += clamp(dh, -2.4 * dt, 2.4 * dt);
    const spd = p.bike ? 20 : 16;
    p.speed = lerp(p.speed, d > 6 ? spd : spd * 0.5, dt * 2);
    const nx = p.pos.x + Math.sin(p.heading) * p.speed * dt;
    const nz = p.pos.z + Math.cos(p.heading) * p.speed * dt;
    if (!collideCircle(nx, nz, p.bike ? 0.7 : 1.7)) { p.pos.x = nx; p.pos.z = nz; }
    else p.heading += Math.PI / 2 * dt * 3;
    p.mesh.position.copy(p.pos);
    p.mesh.rotation.y = p.heading;
    if (p.bike) {
      p.mesh.userData.legL.rotation.x = Math.sin(performance.now() / 90) * 0.5;
      p.mesh.userData.legR.rotation.x = -Math.sin(performance.now() / 90) * 0.5;
    }
    // run over the player
    if (d < 2.6) {
      if (!player.inCar) {
        if (S.wanted >= 3) return busted('The cops caught you!');
        S.hp -= 10 * dt;
        const dx = player.pos.x - p.pos.x, dz = player.pos.z - p.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        player.pos.x += (dx / len) * 2 * dt;
        player.pos.z += (dz / len) * 2 * dt;
      } else {
        damageCar(player.inCar, 12 * dt);
        player.inCar.speed *= 0.92;
      }
    }
  }
}
function updateEnemies(dt) {
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = dist2d(e.pos, player.pos);
    e.bar.lookAt(camera.position);
    if (d < 26) {
      const want = Math.atan2(player.pos.x - e.pos.x, player.pos.z - e.pos.z);
      e.heading = want;
      e.mesh.rotation.y = want;
      if (d > 4) {
        e.pos.x += Math.sin(want) * 3 * dt;
        e.pos.z += Math.cos(want) * 3 * dt;
        e.mesh.position.copy(e.pos);
      }
      e.shootCd -= dt;
      if (e.shootCd <= 0 && d < 24) {
        e.shootCd = rand(1.4, 2.4);
        if (rng() < 0.6) {
          S.hp -= 8;
          toast('Shot!');
          AudioSys.shot();
        }
      }
    }
  }
}

// ---------------------------------------------------------------- HUD + minimap
const mm = $('minimap').getContext('2d');
function drawMinimap() {
  const W = 180, sc = W / 230;
  const toX = (x) => (x + 115) * sc, toY = (z) => (z + 115) * sc;
  mm.clearRect(0, 0, W, W);
  mm.fillStyle = '#141824'; mm.fillRect(0, 0, W, W);
  // sea + beach
  mm.fillStyle = '#2a6f9e'; mm.fillRect(toX(100), 0, W - toX(100), W);
  mm.fillStyle = '#dcc28a'; mm.fillRect(toX(100), 0, toX(106) - toX(100), W);
  // roads
  mm.strokeStyle = '#5a5e68'; mm.lineWidth = 3;
  for (let i = -5; i <= 5; i++) {
    mm.beginPath(); mm.moveTo(toX(i * 20), 0); mm.lineTo(toX(i * 20), W); mm.stroke();
    mm.beginPath(); mm.moveTo(0, toY(i * 20)); mm.lineTo(W, toY(i * 20)); mm.stroke();
  }
  // mission marker
  if (missionTarget) {
    const pulse = 4 + Math.sin(performance.now() / 200) * 1.5;
    mm.fillStyle = '#ffd76a';
    mm.beginPath(); mm.arc(toX(missionTarget.x), toY(missionTarget.z), pulse, 0, 7); mm.fill();
  }
  // traffic cars
  mm.fillStyle = '#9aa7d4';
  for (const c of traffic) { mm.fillRect(toX(c.pos.x) - 1.5, toY(c.pos.z) - 1.5, 3, 3); }
  // police
  mm.fillStyle = '#ff4444';
  for (const p of police) { mm.beginPath(); mm.arc(toX(p.pos.x), toY(p.pos.z), 3, 0, 7); mm.fill(); }
  // player (arrow)
  mm.save();
  mm.translate(toX(player.pos.x), toY(player.pos.z));
  mm.rotate(-player.heading + Math.PI);
  mm.fillStyle = '#fff';
  mm.beginPath(); mm.moveTo(0, -7); mm.lineTo(5, 6); mm.lineTo(-5, 6); mm.closePath(); mm.fill();
  mm.restore();
}
function updateHUD() {
  $('health-bar').style.width = `${clamp(S.hp, 0, 100)}%`;
  $('health-text').textContent = Math.ceil(S.hp);
  $('money').textContent = `$${S.money.toLocaleString('en-US')}`;
  $('debt').textContent = S.debt > 0 ? `Debt: $${S.debt.toLocaleString('en-US')}` : 'Debt: PAID OFF';
  let stars = '';
  for (let i = 0; i < 5; i++) stars += i < S.wanted ? '★' : '<span class="dim">★</span>';
  $('wanted').innerHTML = stars;
  const w = currentWeapon();
  $('weapon').textContent = S.weapon === 'pistol'
    ? `${w.name} · ${S.mag.pistol}/∞`
    : `${w.name} · ${S.mag[S.weapon]}/${S.ammo[S.weapon]}`;
  $('cash').textContent = `Cash: $${S.cashFound * 150} · CASH ${S.cashFound}/${S.cashTotal}`;
  const hh = Math.floor(S.gameTime) % 24;
  const mi = Math.floor((S.gameTime % 1) * 60);
  $('clock').textContent = `${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  $('radio').textContent = '♪ ' + RADIO_TRACKS[S.radio].name;
  if (player.inCar) $('speed').textContent = `${Math.round(Math.abs(player.inCar.speed) * 3.6)} km/h`;
  else $('speed').textContent = '';
  drawMinimap();
}

// ---------------------------------------------------------------- siang / malam
function updateDayNight() {
  const t = S.gameTime % 24;
  const dayF = clamp(Math.sin(((t - 6) / 12) * Math.PI), 0, 1); // 0 malam, 1 siang
  sun.intensity = 0.25 + dayF * 1.45;
  const sunAngle = ((t - 6) / 12) * Math.PI;
  sun.position.set(Math.cos(sunAngle) * 120, Math.max(12, Math.sin(sunAngle) * 140), 40);
  const daySky = new THREE.Color(0x87b5e0), nightSky = new THREE.Color(0x0b1026);
  scene.background.copy(nightSky).lerp(daySky, dayF);
  scene.fog.color.copy(scene.background);
  hemi.intensity = 0.15 + dayF * 0.4;
  const night = dayF < 0.25;
  for (const l of lampLights) {
    l.head.emissiveIntensity = night ? 1.6 : 0;
    l.light.intensity = night ? 22 : 0;
  }
  for (const c of cars) {
    const u = c.mesh.userData;
    if (!u.headlightMat) continue;
    u.headlightMat.emissiveIntensity = night ? 2 : 0;
    u.beam.intensity = night ? 55 : 0;
  }
}

// ---------------------------------------------------------------- kamera
function updateCamera(dt) {
  camYaw.v -= mouseDX * 0.0032;
  camPitch.v = clamp(camPitch.v + mouseDY * 0.0028, -0.15, 1.1);
  mouseDX = 0; mouseDY = 0;
  const target = player.inCar ? player.inCar.pos : player.pos;
  const back = player.inCar ? 10.5 : 8.5;
  const height = player.inCar ? 4.2 : 3.6;
  const cx = target.x - Math.sin(camYaw.v) * Math.cos(camPitch.v) * back;
  const cz = target.z - Math.cos(camYaw.v) * Math.cos(camPitch.v) * back;
  const cy = (target.y || 0) + height + Math.sin(camPitch.v) * back * 0.6;
  camera.position.lerp(new THREE.Vector3(cx, cy, cz), clamp(8 * dt, 0, 1));
  camera.lookAt(target.x, (target.y || 0) + 1.6, target.z);
  if (!player.inCar && (keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD)) {
    // camera follows the movement direction while on foot
    camYaw.v = lerp(camYaw.v, player.heading + Math.PI, clamp(2 * dt, 0, 1));
  }
}

// ---------------------------------------------------------------- save / load
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: S.money, debt: S.debt, mission: S.mission,
      upgrades: S.upgrades, owned: S.owned, weapon: S.weapon,
      ammo: S.ammo, cashFound: S.cashFound,
      x: player.pos.x, z: player.pos.z, time: S.gameTime,
    }));
  } catch (e) { /* abaikan */ }
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    S.money = d.money; S.debt = d.debt; S.mission = d.mission;
    S.upgrades = d.upgrades; S.owned = d.owned; S.weapon = d.weapon;
    S.ammo = d.ammo; S.cashFound = d.cashFound;
    S.gameTime = d.time ?? 8;
    player.pos.set(d.x ?? 0, 0, d.z ?? 6);
    player.mesh.position.copy(player.pos);
    return true;
  } catch (e) { return false; }
}

// ---------------------------------------------------------------- alur game
function startGame(fromSave) {
  AudioSys.init();
  $('start-screen').classList.add('hidden');
  $('pause-screen').classList.add('hidden');
  $('hud').classList.remove('hidden');
  S.started = true;
  S.paused = false;
  if (fromSave) loadGame();
  else { S.money = 300; S.debt = 50000; S.mission = 0; }
  startMission(S.mission >= 6 ? 6 : S.mission);
  if (S.mission >= 6) setObjective('FREE ROAM', 'Debt paid off — explore the city.');
  $('hint').textContent = 'E: enter car · Click: shoot · F: punch';
  lockPointer();
}
function togglePause() {
  if (!S.started || S.over) return;
  S.paused = !S.paused;
  $('pause-screen').classList.toggle('hidden', !S.paused);
  if (S.paused) { saveGame(); document.exitPointerLock?.(); }
  else lockPointer();
}
function busted(msg) {
  if (S.over) return;
  S.over = true;
  S.deaths++;
  const lost = Math.floor(S.money * 0.2);
  S.money -= lost;
  $('busted-title').textContent = msg.includes('cops') ? 'CAUGHT' : 'FLATLINED';
  $('busted-text').textContent = `${msg} You lost $${lost}.`;
  $('busted').classList.remove('hidden');
  document.exitPointerLock?.();
  setTimeout(() => {
    $('busted').classList.add('hidden');
    S.hp = 100; S.wanted = 0; updatePoliceCount();
    player.inCar = null; player.mesh.visible = true;
    player.pos.set(LOC.hospital.x, 0, LOC.hospital.z);
    player.mesh.position.copy(player.pos);
    S.over = false;
    if (S.mission === 3) startMission(3);
    saveGame();
  }, 2600);
}
$('btn-new').addEventListener('click', () => startGame(false));
$('btn-continue').addEventListener('click', () => startGame(true));
$('btn-resume').addEventListener('click', togglePause);
$('btn-quit').addEventListener('click', () => {
  S.paused = false; S.started = false;
  $('pause-screen').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('start-screen').classList.remove('hidden');
  saveGame();
});
if (localStorage.getItem(SAVE_KEY)) $('btn-continue').classList.remove('hidden');

// ---------------------------------------------------------------- staging screenshot (?shot=...)
function applyShotStaging() {
  if (!SHOT) return;
  // city already built with the seed — deterministic staging
  if (SHOT === 'start') {
    // title screen in front of the city: lighter overlay, high view of the
    // skyline so the city (not empty road) fills the frame
    $('start-screen').style.background = 'linear-gradient(180deg, rgba(8,10,26,.35), rgba(30,10,40,.45))';
    camera.position.set(36, 16, 48);
    camera.lookAt(0, 5, -15);
    return;
  }
  startGame(false);
  if (SHOT === 'drive') {
    const car = cars[0];
    car.pos.set(0, 0, 0); car.heading = 0;
    car.mesh.position.set(0, 0, 0); car.mesh.rotation.y = 0;
    player.inCar = car; car.driver = player; player.mesh.visible = false;
    car.speed = 12;
    // dense traffic nearby
    for (let i = 0; i < 6 && i < traffic.length; i++) {
      traffic[i].pos.set((i - 3) * 7, 0, (i % 2 ? -14 : 14));
      traffic[i].mesh.position.copy(traffic[i].pos);
    }
    camYaw.v = Math.PI; camPitch.v = 0.3;
  } else if (SHOT === 'chase') {
    const car = cars[0];
    car.pos.set(0, 0, 0); car.heading = 0; car.hp = 45;
    car.mesh.position.set(0, 0, 0); car.mesh.rotation.y = 0;
    player.inCar = car; car.driver = player; player.mesh.visible = false;
    car.speed = 16;
    S.wanted = 3; updatePoliceCount();
    // police IN FRONT of the car (visible in frame, coming to block)
    if (police[0]) { police[0].pos.set(-6, 0, 18); police[0].heading = Math.PI; }
    if (police[1]) { police[1].pos.set(7, 0, 24); police[1].heading = Math.PI; }
    camYaw.v = Math.PI; camPitch.v = 0.3;
  } else if (SHOT === 'mission') {
    S.mission = 2; S.missionStage = 1;
    startMission(2);
    spawnEnemies();
    S.missionStage = 1;
    // player centered on the WAREHOUSE sign, enemies between player and
    // warehouse; the view corridor south of the warehouse is kept clear of
    // buildings, so the sign reads fully in frame.
    // Clear the staging area: hide any palm near the camera, any car or ped
    // crowding the player, so nothing blocks the sign or the enemies.
    const px = LOC.warehouse.x, pz = LOC.warehouse.z - 24;
    for (const palm of palms) {
      if (Math.hypot(palm.position.x - px, palm.position.z - (pz - 8)) < 15) palm.visible = false;
    }
    for (const c of cars) {
      if (Math.hypot(c.pos.x - px, c.pos.z - pz) < 13) c.mesh.visible = false;
    }
    for (const p of peds) {
      if (Math.hypot(p.pos.x - px, p.pos.z - pz) < 10) p.mesh.visible = false;
    }
    player.pos.set(px, 0, pz);
    player.mesh.position.copy(player.pos);
    player.heading = 0; camYaw.v = 0; camPitch.v = 0.3;
  }
}

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock();
let saveTimer = 0, bassTimer = 0, bassStep = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (S.started && !S.paused && !S.over) {
    // game time: 1 hour per 75 seconds
    S.gameTime = (S.gameTime + dt / 75) % 24;
    if (mouseDown) shoot();
    if (player.inCar) updatePlayerCar(dt);
    else updatePlayerOnFoot(dt);
    updateTraffic(dt);
    updatePeds(dt);
    updatePolice(dt);
    updateEnemies(dt);
    updateWanted(dt);
    updateMission(dt);
    updateJob(dt);
    // slow HP regen while safe
    if (S.wanted === 0 && S.hp < 100 && S.hp > 0) S.hp = Math.min(100, S.hp + dt * 1.5);
    if (S.hp <= 0) busted('You went down!');
    // procedural bass music
    bassTimer += dt;
    if (bassTimer > 0.55) {
      bassTimer = 0;
      const track = RADIO_TRACKS[S.radio];
      AudioSys.bass(track.bass[bassStep % track.bass.length]);
      bassStep++;
    }
    saveTimer += dt;
    if (saveTimer > 30) { saveTimer = 0; saveGame(); }
  }
  updateSmoke(dt);
  updateDayNight();
  updateSky(dt);
  updateTrafficLights();
  // beacon missions berputar
  if (missionMarker.beacon.visible) {
    missionMarker.beacon.rotation.y += dt * 0.8;
    missionMarker.beacon.position.y = 15 + Math.sin(performance.now() / 400) * 1.2;
  }
  for (const c of cashPickups) if (!c.taken) c.mesh.rotation.y += dt * 1.5;
  updateCamera(dt);
  if (S.started) updateHUD();
  renderer.render(scene, camera);
}
applyShotStaging();
loop();
