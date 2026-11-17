// SOLMAR CITY — open-world crime game (three.js, all original).
// Marco Reyes owes $50,000 to Vera Kross. Six jobs. One city.
// Written from scratch for make.fun gta6-01. No network at runtime.
import * as THREE from 'three';

// ---------------------------------------------------------------- utils
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'); // start | drive | chase | mission | null
const SEED = parseInt(params.get('seed') || '7', 10) || 7;
const rng = mulberry32(SEED);
const R = (a, b) => a + rng() * (b - a);
const RI = (a, b) => Math.floor(R(a, b + 1));
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const d2 = (x1, z1, x2, z2) => Math.hypot(x2 - x1, z2 - z1);
const el = (id) => document.getElementById(id);
const $ = (s) => document.querySelector(s);

// World: 11 roads each way, pitch 52, road width 12, block 40. City spans ±260.
const PITCH = 52, ROAD = 12, BLOCK = 40, HALF = 5, CITY = 260;
const roadCoord = (i) => i * PITCH;
const isRoadX = (x) => { for (let i = -HALF; i <= HALF; i++) if (Math.abs(x - roadCoord(i)) < ROAD / 2 + 1) return true; return false; };
const isRoadZ = (z) => isRoadX(z);
const onRoad = (x, z) => isRoadX(x) || isRoadZ(z);

// ---------------------------------------------------------------- state
const WEAPONS = {
  pistol: { name: 'PISTOL', dmg: 20, rate: 0.28, mag: 12, price: 0 },
  smg: { name: 'SMG', dmg: 12, rate: 0.09, mag: 30, price: 1500 },
  rifle: { name: 'RIFLE', dmg: 45, rate: 0.5, mag: 20, price: 3000 },
};
const UPGRADES = {
  engine: { name: 'Engine', prices: [800, 1600, 2800], max: 3 },
  armor: { name: 'Armor', prices: [700, 1400, 2400], max: 3 },
  tires: { name: 'Tires', prices: [600, 1200, 2000], max: 3 },
};
const G = {
  money: 250, health: 100, maxHealth: 100, wanted: 0, wantedTimer: 0, crimeTimer: 0,
  mission: 0, step: 0, debt: 50000, debtPaid: false, time: 8.0,
  upgrades: { engine: 0, armor: 0, tires: 0 },
  weapons: { cur: 'pistol', owned: { pistol: true, smg: false, rifle: false }, mag: { pistol: 12, smg: 0, rifle: 0 }, res: { pistol: 48, smg: 0, rifle: 0 } },
  job: null, muted: false, started: false, paused: false, over: false,
  shot: SHOT, seed: SEED, kills: 0, lastShot: 0, reloadUntil: 0,
  missionData: null, dialogQueue: [], dialogBusy: false, cashFound: 0,
};

// ---------------------------------------------------------------- save
const SAVE_KEY = 'solmar-save-v2';
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: G.money, health: G.health, mission: G.mission, time: G.time,
      upgrades: G.upgrades, weapons: G.weapons, debtPaid: G.debtPaid,
      cashFound: G.cashFound,
      px: player.pos.x, pz: player.pos.z, pyaw: player.yaw,
    }));
  } catch (e) { /* storage unavailable */ }
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}
function applySave(s) {
  if (!s) return false;
  G.money = s.money ?? 250; G.health = s.health ?? 100; G.mission = s.mission ?? 0;
  G.time = s.time ?? 8; G.debtPaid = !!s.debtPaid;
  G.cashFound = s.cashFound ?? 0;
  for (let i = 0; i < G.cashFound && i < cashBundles.length; i++) {
    cashBundles[i].taken = true; cashBundles[i].group.visible = false;
  }
  if (s.upgrades) G.upgrades = s.upgrades;
  if (s.weapons) G.weapons = s.weapons;
  player.pos.set(s.px ?? 0, 0, s.pz ?? 20); player.yaw = s.pyaw ?? 0;
  return true;
}

// ---------------------------------------------------------------- audio (procedural WebAudio only)
let AC = null, masterGain = null, engineOsc = null, engineGain = null, sirenOn = false, sirenTimer = null, musicTimer = null;
// Radio stations: three procedural grooves, N switches station.
const RADIO = [
  { name: 'SOLMAR FM — Night Drive', notes: [55, 55, 65.4, 49, 55, 55, 82.4, 73.4], wave: 'triangle', step: 450 },
  { name: 'BEACH 92 — Sunset Cruise', notes: [65.4, 82.4, 98, 82.4, 65.4, 73.4, 98, 110], wave: 'sine', step: 600 },
  { name: "VERA'S MIX — Street Heat", notes: [55, 65.4, 55, 49, 55, 82.4, 73.4, 65.4], wave: 'square', step: 320 },
];
let radioIdx = 0;
function audioInit() {
  if (AC || SHOT) return;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = AC.createGain(); masterGain.gain.value = G.muted ? 0 : 0.5; masterGain.connect(AC.destination);
    engineOsc = AC.createOscillator(); engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 60;
    engineGain = AC.createGain(); engineGain.gain.value = 0;
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
    engineOsc.connect(lp); lp.connect(engineGain); engineGain.connect(masterGain);
    engineOsc.start();
    startRadio();
  } catch (e) { AC = null; }
}
function startRadio() {
  if (musicTimer) clearInterval(musicTimer);
  const st = RADIO[radioIdx];
  let ni = 0;
  musicTimer = setInterval(() => {
    if (!AC || G.muted) return;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = st.wave; o.frequency.value = st.notes[ni % st.notes.length]; ni++;
    g.gain.setValueAtTime(st.wave === 'square' ? 0.05 : 0.12, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + (st.step - 30) / 1000);
    o.connect(g); g.connect(masterGain); o.start(); o.stop(AC.currentTime + st.step / 1000);
  }, st.step);
  const r = el('radio');
  if (r) r.textContent = '♪ ' + st.name;
}
function cycleRadio() {
  radioIdx = (radioIdx + 1) % RADIO.length;
  if (AC) startRadio();
  else {
    const r = el('radio');
    if (r) r.textContent = '♪ ' + RADIO[radioIdx].name;
  }
  showBanner('♪ ' + RADIO[radioIdx].name);
}
function setEngineSound(speedNorm, driving) {
  if (!AC || !engineOsc) return;
  engineOsc.frequency.value = 50 + speedNorm * 160;
  engineGain.gain.value = driving ? 0.05 + speedNorm * 0.06 : 0.0;
}
function noiseBurst(dur, freq, vol) {
  if (!AC) return;
  try {
    const len = Math.floor(AC.sampleRate * dur);
    const buf = AC.createBuffer(1, len, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = AC.createBufferSource(); src.buffer = buf;
    const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = AC.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(masterGain); src.start();
  } catch (e) { /* ignore */ }
}
function shotSound() { noiseBurst(0.12, 1800, 0.5); }
function chime() {
  if (!AC) return;
  try {
    [880, 1320].forEach((f, i) => {
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t = AC.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g); g.connect(masterGain); o.start(t); o.stop(t + 0.32);
    });
  } catch (e) { /* ignore */ }
}
function sirenStart() {
  if (!AC || sirenOn) return; sirenOn = true;
  let hi = false;
  sirenTimer = setInterval(() => {
    if (!AC || G.muted || G.wanted === 0) { sirenStop(); return; }
    try {
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = 'sine'; o.frequency.value = hi ? 960 : 720; hi = !hi;
      g.gain.setValueAtTime(0.06, AC.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + 0.4);
      o.connect(g); g.connect(masterGain); o.start(); o.stop(AC.currentTime + 0.42);
    } catch (e) { /* ignore */ }
  }, 420);
}
function sirenStop() { sirenOn = false; if (sirenTimer) { clearInterval(sirenTimer); sirenTimer = null; } }
function toggleMute() {
  G.muted = !G.muted;
  if (masterGain) masterGain.gain.value = G.muted ? 0 : 0.5;
}

// ---------------------------------------------------------------- three setup
const canvas = el('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ec9f2);
scene.fog = new THREE.Fog(0x9ec9f2, 300, 900);
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 1500);
const sun = new THREE.DirectionalLight(0xfff2cc, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -320; sun.shadow.camera.right = 320;
sun.shadow.camera.top = 320; sun.shadow.camera.bottom = -320;
sun.shadow.camera.far = 900;
scene.add(sun);
const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x3a2f22, 0.9);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0x8899ff, 0.0);
scene.add(moon);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- materials & textures
const MAT = {
  asphalt: new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.95 }),
  sidewalk: new THREE.MeshStandardMaterial({ color: 0x9a938a, roughness: 0.9 }),
  ground: new THREE.MeshStandardMaterial({ color: 0x4a6b3a, roughness: 1 }),
  sand: new THREE.MeshStandardMaterial({ color: 0xdcc98f, roughness: 1 }),
  water: new THREE.MeshStandardMaterial({ color: 0x1e6f8f, roughness: 0.25, metalness: 0.4 }),
  line: new THREE.MeshBasicMaterial({ color: 0xd8c95a }),
  curb: new THREE.MeshStandardMaterial({ color: 0x7a756c, roughness: 0.9 }),
};
function windowTexture(base, lit, rows, cols) {
  rows = rows || 12; cols = cols || 6;
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, 128, 256);
  const cw = 128 / cols, ch = 256 / rows;
  for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
    const on = rng() < lit;
    x.fillStyle = on ? '#ffd76a' : '#1c2733';
    x.fillRect(4 + col * cw, 5 + r * ch, cw - 7, ch - 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const buildingMats = [
  new THREE.MeshStandardMaterial({ map: windowTexture('#8a7f72', 0.35), roughness: 0.85 }),
  new THREE.MeshStandardMaterial({ map: windowTexture('#6f7d8c', 0.35), roughness: 0.85 }),
  new THREE.MeshStandardMaterial({ map: windowTexture('#a08a6a', 0.35), roughness: 0.85 }),
  new THREE.MeshStandardMaterial({ map: windowTexture('#5f6b5a', 0.35), roughness: 0.85 }),
  new THREE.MeshStandardMaterial({ map: windowTexture('#7a6a7d', 0.35), roughness: 0.85 }),
  // Vivid accent facades so the skyline reads less grey/brown.
  new THREE.MeshStandardMaterial({ map: windowTexture('#b5673f', 0.4), roughness: 0.85 }),
  new THREE.MeshStandardMaterial({ map: windowTexture('#3f8a8a', 0.4), roughness: 0.85 }),
  new THREE.MeshStandardMaterial({ map: windowTexture('#c9a44a', 0.4), roughness: 0.85 }),
  new THREE.MeshStandardMaterial({ map: windowTexture('#a86a72', 0.4), roughness: 0.85 }),
  new THREE.MeshStandardMaterial({ map: windowTexture('#4a6b8a', 0.45, 16, 7), roughness: 0.85 }),
  new THREE.MeshStandardMaterial({ map: windowTexture('#c97a5a', 0.35, 9, 6), roughness: 0.85 }),
  new THREE.MeshStandardMaterial({ map: windowTexture('#7a8a3f', 0.35, 11, 5), roughness: 0.85 }),
];
const SHOP_SIGNS = [
  ['TACOS', '#7a1a3a'], ['PIZZA', '#8a5a00'], ['BAR', '#0a4a3a'],
  ['24H MART', '#3a1a7a'], ['SURF SHOP', '#0a5a7a'], ['DONUTS', '#7a2a5a'],
  ['BURGER', '#5a3a00'], ['LAUNDRY', '#1a3a5a'],
  ['DONUT KING', '#8a2a6a'], ['TATTOO', '#1a1a1a'], ['COFFEE', '#4a2a0a'],
  ['PAWN SHOP', '#5a4a00'], ['FLOWERS', '#7a2a5a'], ['GYM', '#0a3a3a'],
  ['MOTEL', '#3a1a5a'], ['BARBER', '#2a4a7a'],
];
const solids = []; // {x0,z0,x1,z1} building footprints for collision
function addSolid(x, z, w, d) { solids.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 }); }
function collideCircle(x, z, r) {
  // Push a circle out of building AABBs; returns corrected [x,z].
  for (const s of solids) {
    const cx = clamp(x, s.x0, s.x1), cz = clamp(z, s.z0, s.z1);
    const dx = x - cx, dz = z - cz, dd = dx * dx + dz * dz;
    if (dd < r * r) {
      if (dd < 1e-6) { x = s.x1 + r; continue; }
      const push = (r - Math.sqrt(dd)) / Math.sqrt(dd);
      x += dx * push; z += dz * push;
    }
  }
  return [x, z];
}

// ---------------------------------------------------------------- humanoids (low-poly people, not blocks)
// Proportional humanoid: head + hair, torso, articulated arms & legs that
// swing while walking. Limbs pivot at shoulder/hip so the walk reads.
const SKIN_TONES = [0xd9a066, 0x8a5a30, 0xe8c090, 0x6b4423, 0xf0c8a0];
const HAIR_COLORS = [0x2a1a0a, 0x111111, 0x5a3a1a, 0x888888, 0x8a5a20, 0x3a2a4a];
const SHIRT_COLORS = [0xd94f4f, 0x4fd97a, 0xd9c24f, 0x7a4fd9, 0x4fb8d9, 0xe8e8e8, 0x2a6bc2, 0xd97a2a, 0xff8ad9, 0x9a4fd9, 0x4fd9c2];
const PANTS_COLORS = [0x222831, 0x3a3f4a, 0x4a3a2a, 0x2a4a6b, 0x555555];
function makeHumanoid(o) {
  // o: { shirt, pants, skin, hair, cap } — cap: hex for a police cap, or null.
  const g = new THREE.Group();
  const shirt = o.shirt ?? pick(SHIRT_COLORS);
  const pants = o.pants ?? pick(PANTS_COLORS);
  const skin = o.skin ?? pick(SKIN_TONES);
  const hair = o.hair ?? pick(HAIR_COLORS);
  // Legs: pivot at the hip, geometry hanging below the pivot.
  const legGeo = new THREE.BoxGeometry(0.24, 0.78, 0.28);
  legGeo.translate(0, -0.39, 0);
  const legMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9 });
  const legL = new THREE.Group(); legL.position.set(-0.15, 0.8, 0);
  const legR = new THREE.Group(); legR.position.set(0.15, 0.8, 0);
  for (const pivot of [legL, legR]) {
    const m = new THREE.Mesh(legGeo, legMat);
    m.castShadow = true; pivot.add(m);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.42), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
    shoe.position.set(0, -0.78, 0.06); pivot.add(shoe);
    g.add(pivot);
  }
  // Torso + hips.
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.36), new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 }));
  torso.position.y = 1.16; torso.castShadow = true; g.add(torso);
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.22, 0.34), legMat);
  hips.position.y = 0.82; g.add(hips);
  // Arms: pivot at the shoulder, geometry hanging below.
  const armGeo = new THREE.BoxGeometry(0.19, 0.68, 0.22);
  armGeo.translate(0, -0.34, 0);
  const armMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });
  const armL = new THREE.Group(); armL.position.set(-0.41, 1.48, 0);
  const armR = new THREE.Group(); armR.position.set(0.41, 1.48, 0);
  for (const pivot of [armL, armR]) {
    const m = new THREE.Mesh(armGeo, armMat);
    m.castShadow = true; pivot.add(m);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), skinMat);
    hand.position.set(0, -0.7, 0); pivot.add(hand);
    g.add(pivot);
  }
  // Head + hair (flattened cap on the back/top of the skull).
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), skinMat);
  head.position.y = 1.74; head.castShadow = true; g.add(head);
  if (o.cap) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.29, 0.12, 12), new THREE.MeshStandardMaterial({ color: o.cap }));
    cap.position.y = 1.94; g.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.2), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    brim.position.set(0, 1.9, 0.26); g.add(brim);
  } else {
    const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 8), new THREE.MeshStandardMaterial({ color: hair, roughness: 1 }));
    hairM.scale.set(1, 0.75, 1); hairM.position.set(0, 1.8, -0.04); g.add(hairM);
  }
  // Optional variety: a sun hat and/or a shopping bag.
  if (o.hat) {
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.16, 10), new THREE.MeshStandardMaterial({ color: o.hat }));
    hat.position.y = 1.98; g.add(hat);
    const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 10), new THREE.MeshStandardMaterial({ color: o.hat }));
    hatBrim.position.y = 1.9; g.add(hatBrim);
  }
  if (o.bag) {
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.14), new THREE.MeshStandardMaterial({ color: o.bag, roughness: 0.9 }));
    bag.position.set(0, 1.15, -0.28); g.add(bag);
  }
  return { group: g, armL, armR, legL, legR, head, phase: 0 };
}
function animateHumanoid(h, speed, dt) {
  // Walk cycle: legs swing opposite, arms counter-swing. speed ~0 = idle.
  if (speed < 0.2) {
    h.legL.rotation.x *= 0.8; h.legR.rotation.x *= 0.8;
    h.armL.rotation.x *= 0.8; h.armR.rotation.x *= 0.8;
    return;
  }
  h.phase += dt * speed * 2.4;
  const s = Math.sin(h.phase), amp = 0.55;
  h.legL.rotation.x = s * amp; h.legR.rotation.x = -s * amp;
  h.armL.rotation.x = -s * amp * 0.8; h.armR.rotation.x = s * amp * 0.8;
}

// ---------------------------------------------------------------- city
const cityGroup = new THREE.Group();
scene.add(cityGroup);
const lampLights = [];
// One real headlight only: the player's car (perf: dozens of point lights
// would make the forward renderer crawl, on GPU and on swiftshader alike).
const playerHeadlight = new THREE.PointLight(0xfff2aa, 0, 34, 1.7);
scene.add(playerHeadlight);

function box(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  (parent || cityGroup).add(m);
  return m;
}
function buildCity() {
  // Ground + beach + water (east side, x > 272).
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), MAT.ground);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; cityGroup.add(ground);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(90, 1200), MAT.sand);
  sand.rotation.x = -Math.PI / 2; sand.position.set(315, 0.05, 0); sand.receiveShadow = true; cityGroup.add(sand);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(260, 1200), MAT.water);
  water.rotation.x = -Math.PI / 2; water.position.set(480, 0.02, 0); cityGroup.add(water);

  // Roads: dark planes along each grid line, plus dashed center lines.
  for (let i = -HALF; i <= HALF; i++) {
    const c = roadCoord(i);
    const hRoad = new THREE.Mesh(new THREE.PlaneGeometry(2 * CITY + 30, ROAD), MAT.asphalt);
    hRoad.rotation.x = -Math.PI / 2; hRoad.position.set(0, 0.1, c); hRoad.receiveShadow = true; cityGroup.add(hRoad);
    const vRoad = new THREE.Mesh(new THREE.PlaneGeometry(ROAD, 2 * CITY + 30), MAT.asphalt);
    vRoad.rotation.x = -Math.PI / 2; vRoad.position.set(c, 0.1, 0); vRoad.receiveShadow = true; cityGroup.add(vRoad);
    for (let k = -CITY; k < CITY; k += 16) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.5), MAT.line);
      dash.rotation.x = -Math.PI / 2; dash.position.set(k, 0.12, c); cityGroup.add(dash);
      const dash2 = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 6), MAT.line);
      dash2.rotation.x = -Math.PI / 2; dash2.position.set(c, 0.12, k); cityGroup.add(dash2);
    }
  }
  // Sidewalks: light slabs inside each block.
  for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
    const cx = roadCoord(i) + PITCH / 2, cz = roadCoord(j) + PITCH / 2;
    const sw = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK + 4, BLOCK + 4), MAT.sidewalk);
    sw.rotation.x = -Math.PI / 2; sw.position.set(cx, 0.08, cz); sw.receiveShadow = true; cityGroup.add(sw);
  }

  // Buildings: 1-3 per block, procedural heights, some blocks left as parks.
  for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
    const cx = roadCoord(i) + PITCH / 2, cz = roadCoord(j) + PITCH / 2;
    if (rng() < 0.12) { // park or plaza: palms + benches instead of a building
      if (rng() < 0.5) {
        // Plaza: round pavement, fountain, benches, palms.
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 0.3, 20), new THREE.MeshStandardMaterial({ color: 0xb0a89a, roughness: 0.95 }));
        disc.position.set(cx, 0.15, cz); disc.receiveShadow = true; cityGroup.add(disc);
        const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 0.9, 14), new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.7 }));
        basin.position.set(cx, 0.45, cz); cityGroup.add(basin);
        const fwater = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 0.2, 14), new THREE.MeshStandardMaterial({ color: 0x3f9ac9, roughness: 0.2, metalness: 0.3 }));
        fwater.position.set(cx, 0.85, cz); cityGroup.add(fwater);
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2;
          makeBench(cx + Math.cos(a) * 8, cz + Math.sin(a) * 8);
        }
        for (let k = 0; k < 3; k++) makePalm(cx + R(-12, 12), cz + R(-12, 12));
      } else {
        for (let k = 0; k < 5; k++) makePalm(cx + R(-14, 14), cz + R(-14, 14));
        makeBench(cx - 6, cz + 6); makeBench(cx + 7, cz - 5);
      }
      continue;
    }
    const n = RI(1, 2);
    for (let k = 0; k < n; k++) {
      const w = R(12, 20), d = R(12, 20), h = R(10, 55);
      const bx = cx + (n === 1 ? 0 : (k === 0 ? -9 : 9));
      const bz = cz + (n === 1 ? 0 : (k === 0 ? 8 : -8));
      const b = box(w, h, d, pick(buildingMats), bx, h / 2, bz);
      b.castShadow = true;
      addSolid(bx, bz, w + 1, d + 1);
      // Roof box for silhouette variety.
      if (rng() < 0.5) box(w * 0.5, 2.5, d * 0.5, MAT.curb, bx, h + 1.2, bz);
      // Setback: tall towers step in on top, so the skyline isn't flat slabs.
      if (h > 30) {
        const sw = w * 0.55, sd = d * 0.55, sh = R(6, 14);
        box(sw, sh, sd, pick(buildingMats), bx + R(-2, 2), h + sh / 2, bz + R(-2, 2));
        if (rng() < 0.5) box(sw * 0.5, 2, sd * 0.5, MAT.curb, bx, h + sh + 1, bz);
      }
      // Rooftop clutter: AC units + water towers.
      if (rng() < 0.45) box(R(2, 3), 1.2, R(2, 3), new THREE.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.7, metalness: 0.4 }), bx + R(-w / 4, w / 4), h + 0.6, bz + R(-d / 4, d / 4));
      if (rng() < 0.22 && h > 18) {
        const tx = bx + R(-w / 4, w / 4), tz = bz + R(-d / 4, d / 4);
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 3.2, 10), new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 0.9 }));
        tank.position.set(tx, h + 2.6, tz); tank.castShadow = true; cityGroup.add(tank);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.4, 10), new THREE.MeshStandardMaterial({ color: 0x5a3a28, roughness: 0.9 }));
        cone.position.set(tx, h + 4.9, tz); cityGroup.add(cone);
        for (const [lx, lz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.2, 0.18), new THREE.MeshStandardMaterial({ color: 0x4a4a4a }));
          leg.position.set(tx + lx, h + 0.6, tz + lz); cityGroup.add(leg);
        }
      }
      // Neon shop sign on the south face of some buildings (street-level
      // colour accent; plane faces +z, readable from the road south of it).
      if (rng() < 0.22) {
        const [txt, col] = pick(SHOP_SIGNS);
        const sg = sign(txt, bx, 4.6, bz + d / 2 + 0.15, col);
        sg.rotation.y = 0;
        // Sloped awning over the shop front.
        const awn = new THREE.Mesh(new THREE.BoxGeometry(11, 0.18, 2.6), new THREE.MeshStandardMaterial({ color: pick([0xd94f4f, 0x2a6bc2, 0x4f9a4f, 0xd9a44a]), roughness: 0.8 }));
        awn.position.set(bx, 5.9, bz + d / 2 + 1.3);
        awn.rotation.x = -0.35;
        awn.castShadow = true; cityGroup.add(awn);
      }
    }
  }

  // Palms along the beach + scattered.
  for (let z = -280; z < 280; z += 26) makePalm(278 + R(-4, 4), z + R(-6, 6));
  for (let k = 0; k < 24; k++) makePalm(R(-250, 250), R(-250, 250));

  // Street lamps at intersections (varied height + bulb warmth so the
  // streets don't read as copy-paste), plus planters at some corners.
  for (let i = -HALF; i <= HALF; i++) for (let j = -HALF; j <= HALF; j++) {
    if ((i + j) % 2 !== 0) continue;
    const x = roadCoord(i) + 8, z = roadCoord(j) + 8;
    const lh = R(6, 8);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, lh, 6), new THREE.MeshStandardMaterial({ color: 0x333944 }));
    pole.position.set(x, lh / 2, z); cityGroup.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: pick([0xffe9a8, 0xcfe4ff, 0xffd0a0]) }));
    bulb.position.set(x, lh, z); cityGroup.add(bulb);
    // Real light only on a sparse subset (9 lamps): the rest are emissive bulbs.
    if (i % 4 === 0 && j % 4 === 0) {
      const pl = new THREE.PointLight(0xffd98a, 0, 26, 1.6);
      pl.position.set(x, lh - 0.2, z); cityGroup.add(pl);
      lampLights.push(pl);
    }
    // Round planter with a shrub at a third of the corners.
    if ((i * 7 + j * 3) % 3 === 0) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 1, 10), new THREE.MeshStandardMaterial({ color: 0x7a6a58, roughness: 0.9 }));
      pot.position.set(x + 5, 0.5, z + 5); cityGroup.add(pot);
      const bush = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 6), new THREE.MeshStandardMaterial({ color: 0x2f7a33, roughness: 1 }));
      bush.position.set(x + 5, 1.6, z + 5); bush.scale.y = 0.75; cityGroup.add(bush);
    }
  }

  // Street props: hydrants, dumpsters and bus stops along the avenues.
  for (let k = 0; k < 10; k++) {
    makeHydrant(roadCoord(RI(-HALF, HALF)) + 8, R(-CITY, CITY));
  }
  for (let k = 0; k < 8; k++) {
    makeDumpster(roadCoord(RI(-HALF, HALF - 1)) + PITCH / 2 + R(-14, 14), roadCoord(RI(-HALF, HALF - 1)) + PITCH / 2 + R(-14, 14));
  }
  for (let k = 0; k < 6; k++) {
    makeBusStop(roadCoord(RI(-HALF, HALF)) + 8, roadCoord(RI(-HALF, HALF)) + R(-20, 20));
  }
  // Traffic lights at five busy intersections; they cycle red-yellow-green.
  for (const [tx, tz] of [[0, 0], [104, -104], [-104, 104], [52, 52], [-52, -52]]) {
    makeTrafficLight(tx + 8, tz + 8);
  }

  // Landmarks.
  buildWarehouse();   // gang hideout, NW
  buildGarage();      // Dex's workshop, SW
  buildGunshop();     // weapon shop, center-north
  buildHospital();    // respawn point, SE
  buildSafehouse();   // getaway target, NE
  buildDocks();       // final mission, east beach road
  buildRamps();       // stunt jumps
  // Beach-front billboards facing the city (visible down the main avenues).
  billboard(276, -104, 'SOLMAR CITY', '#0a2a4a');
  billboard(276, 0, 'PORT SOLANO', '#3a1a1a');
  billboard(276, 104, "VERA'S", '#1a3a1a');
  // Street art: spray-painted tags on landmark walls.
  graffiti('STAY GOLD', LAND.warehouse.x - 4, 2.6, LAND.warehouse.z + 11.2, '#ffd75e');
  graffiti('VERA RULES', LAND.warehouse.x + 9, 2.6, LAND.warehouse.z + 11.2, '#ff8ad9');
  graffiti('RIDE OR DIE', LAND.garage.x - 6, 2.4, LAND.garage.z + 10.2, '#ff5a5a');
  graffiti('PORT LIFE', LAND.docks.x - 10, 4.5, LAND.docks.z - 13.8, '#4fb8d9');
  graffiti('SOLMAR', LAND.gunshop.x - 5, 2.4, LAND.gunshop.z + 7.2, '#4fd97a');
  graffiti('STREET KINGS', LAND.safehouse.x + 4, 2.4, LAND.safehouse.z + 7.2, '#d9c24f');
}
function makeBench(x, z) {
  const bm = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(3, 0.18, 1), bm);
  seat.position.set(x, 0.55, z); seat.castShadow = true; cityGroup.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(3, 0.9, 0.15), bm);
  back.position.set(x, 0.95, z - 0.5); cityGroup.add(back);
  for (const sx of [-1.3, 1.3]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.55, 0.9), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    leg.position.set(x + sx, 0.28, z); cityGroup.add(leg);
  }
}
// Spray-painted tag on a wall: bold italic letters, transparent background.
function graffiti(text, x, y, z, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g2 = c.getContext('2d');
  g2.clearRect(0, 0, 512, 128);
  g2.fillStyle = color; g2.font = 'italic bold 62px sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
  g2.fillText(text, 256, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), new THREE.MeshBasicMaterial({ map: t, transparent: true }));
  m.position.set(x, y, z); cityGroup.add(m);
  return m;
}
// Street props: red hydrant, green dumpster, bus stop, cycling traffic light.
const trafficLights = []; // {red, yellow, green, phase}
function makeHydrant(x, z) {
  const red = new THREE.MeshStandardMaterial({ color: 0xc22a2a, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.9, 10), red);
  body.position.set(x, 0.45, z); body.castShadow = true; cityGroup.add(body);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), red);
  cap.position.set(x, 1, z); cityGroup.add(cap);
  for (const sx of [-0.45, 0.45]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.3, 8), red);
    nozzle.rotation.z = Math.PI / 2; nozzle.position.set(x + sx, 0.55, z); cityGroup.add(nozzle);
  }
}
function makeDumpster(x, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 1.4), new THREE.MeshStandardMaterial({ color: 0x2a4a2a, roughness: 0.9 }));
  m.position.set(x, 0.7, z); m.castShadow = true; m.rotation.y = R(0, Math.PI); cityGroup.add(m);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 1.4), new THREE.MeshStandardMaterial({ color: 0x1a3a1a, roughness: 0.9 }));
  lid.position.set(x, 1.45, z); lid.rotation.y = m.rotation.y; cityGroup.add(lid);
}
function makeBusStop(x, z) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3, 6), new THREE.MeshStandardMaterial({ color: 0x555555 }));
  pole.position.set(x, 1.5, z); cityGroup.add(pole);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.08), new THREE.MeshStandardMaterial({ color: 0x0a4a7a, roughness: 0.6 }));
  panel.position.set(x, 3.1, z); cityGroup.add(panel);
  makeBench(x + 1.5, z + 1);
}
function makeTrafficLight(x, z) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 5.5, 6), new THREE.MeshStandardMaterial({ color: 0x222222 }));
  pole.position.set(x, 2.75, z); cityGroup.add(pole);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.2, 0.7), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  housing.position.set(x, 5.6, z); cityGroup.add(housing);
  const mk = (color, y) => {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), new THREE.MeshBasicMaterial({ color }));
    l.position.set(x, y, z + 0.38); cityGroup.add(l);
    return l;
  };
  const red = mk(0x330000, 6.2), yellow = mk(0x443300, 5.6), green = mk(0x33ff55, 5.0);
  trafficLights.push({ red, yellow, green, phase: R(0, 9) });
}
function updateTrafficLights(t) {
  for (const tl of trafficLights) {
    const cyc = (t + tl.phase) % 9;
    const state = cyc < 4.5 ? 'green' : cyc < 5.5 ? 'yellow' : 'red';
    tl.red.material.color.setHex(state === 'red' ? 0xff2222 : 0x330000);
    tl.yellow.material.color.setHex(state === 'yellow' ? 0xffcc22 : 0x443300);
    tl.green.material.color.setHex(state === 'green' ? 0x33ff55 : 0x003300);
  }
}
function billboard(x, z, text, bg) {
  for (const sx of [-6, 6]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 11, 0.6), new THREE.MeshStandardMaterial({ color: 0x333944 }));
    post.position.set(x + sx, 5.5, z); cityGroup.add(post);
  }
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const g2 = c.getContext('2d');
  g2.fillStyle = bg; g2.fillRect(0, 0, 512, 160);
  g2.fillStyle = '#ffd75e'; g2.font = 'bold 60px sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
  g2.fillText(text, 256, 82);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(16, 5), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
  m.position.set(x, 13, z); m.rotation.y = -Math.PI / 2; cityGroup.add(m);
}
function makePalm(x, z) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, 7, 6), new THREE.MeshStandardMaterial({ color: 0x7a5a38 }));
  trunk.position.set(x, 3.5, z); trunk.castShadow = true; cityGroup.add(trunk);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f7a33, roughness: 0.9 });
  for (let k = 0; k < 6; k++) {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(5, 0.15, 1.1), leafMat);
    leaf.position.set(x, 7, z);
    leaf.rotation.y = (k / 6) * Math.PI * 2;
    leaf.rotation.z = 0.45;
    leaf.translateX(2.2);
    cityGroup.add(leaf);
  }
}
function sign(text, x, y, z, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = color || '#101828'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = '#ffd75e'; g.font = 'bold 52px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.6), new THREE.MeshBasicMaterial({ map: t }));
  m.position.set(x, y, z); cityGroup.add(m);
  return m;
}
// Landmark positions (shared by missions/shops): warehouse NW, garage SW, gunshop N-center,
// hospital SE, safehouse NE, docks east.
const LAND = {
  warehouse: new THREE.Vector3(-208, 0, -208),
  garage: new THREE.Vector3(-208, 0, 208),
  gunshop: new THREE.Vector3(0, 0, -208),
  hospital: new THREE.Vector3(208, 0, 208),
  safehouse: new THREE.Vector3(208, 0, -208),
  docks: new THREE.Vector3(238, 0, 52),
  rampA: new THREE.Vector3(104, 0, 208),
  rampB: new THREE.Vector3(-52, 0, -104),
};
function buildWarehouse() {
  const p = LAND.warehouse;
  // Warm light-tan facade (was dark brown: the mission shot's wall read
  // almost black). Lighter concrete apron in front so the player and the
  // gang stand on bright ground, not dark asphalt.
  box(30, 10, 22, new THREE.MeshStandardMaterial({ color: 0x9c7a55, roughness: 0.85 }), p.x, 5, p.z);
  addSolid(p.x, p.z, 31, 23);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(38, 30), new THREE.MeshStandardMaterial({ color: 0xb5ab9c, roughness: 0.95 }));
  apron.rotation.x = -Math.PI / 2; apron.position.set(p.x, 0.12, p.z + 26); apron.receiveShadow = true; cityGroup.add(apron);
  // Bright accent band along the top of the front (+z) face.
  const band = new THREE.Mesh(new THREE.BoxGeometry(30.4, 1.1, 0.4), new THREE.MeshStandardMaterial({ color: 0xffd75e, roughness: 0.6 }));
  band.position.set(p.x, 9.2, p.z + 11.1); cityGroup.add(band);
  // Wall lamps (emissive) on the front face + one real yard light so the
  // gang in front of the warehouse is lit at any hour.
  for (const dx of [-11, 0, 11]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
    lamp.position.set(p.x + dx, 8.2, p.z + 11.3); cityGroup.add(lamp);
    const shade = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    shade.position.set(p.x + dx, 8.75, p.z + 11.2); cityGroup.add(shade);
  }
  const yardLight = new THREE.PointLight(0xffd98a, 7, 42, 1.6);
  yardLight.position.set(p.x, 7, p.z + 20); scene.add(yardLight);
  // Sign ON the front wall (was floating 1.5 above the roof, out of frame).
  const s = sign('WAREHOUSE', p.x, 6.4, p.z + 11.5, '#3a1a1a');
  s.rotation.y = 0;
}
function buildGarage() {
  const p = LAND.garage;
  box(26, 8, 20, new THREE.MeshStandardMaterial({ color: 0x2a4a6b, roughness: 0.85 }), p.x, 4, p.z);
  addSolid(p.x, p.z, 27, 21);
  sign("DEX'S GARAGE", p.x, 9.5, p.z + 10.5, '#0a2a4a');
  // Open bay: a flat pad in front where the upgrade menu works.
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), new THREE.MeshStandardMaterial({ color: 0x3a3f46 }));
  pad.rotation.x = -Math.PI / 2; pad.position.set(p.x, 0.15, p.z + 18); pad.receiveShadow = true; cityGroup.add(pad);
}
function buildGunshop() {
  const p = LAND.gunshop;
  box(18, 7, 14, new THREE.MeshStandardMaterial({ color: 0x4a2a2a, roughness: 0.85 }), p.x, 3.5, p.z);
  addSolid(p.x, p.z, 19, 15);
  sign('AMMO-NATION', p.x, 8.5, p.z + 7.5, '#2a0a0a');
}
function buildHospital() {
  const p = LAND.hospital;
  box(24, 16, 18, new THREE.MeshStandardMaterial({ color: 0xdde3e8, roughness: 0.8 }), p.x, 8, p.z);
  addSolid(p.x, p.z, 25, 19);
  const cross = box(8, 2.4, 1, new THREE.MeshBasicMaterial({ color: 0xd22 }), p.x, 18, p.z + 9.6);
  cross.rotation.y = 0;
  box(2.4, 8, 1, new THREE.MeshBasicMaterial({ color: 0xd22 }), p.x, 18, p.z + 9.6);
}
function buildSafehouse() {
  const p = LAND.safehouse;
  box(16, 8, 14, new THREE.MeshStandardMaterial({ color: 0x6b5a2a, roughness: 0.85 }), p.x, 4, p.z);
  addSolid(p.x, p.z, 17, 15);
  sign('SAFEHOUSE', p.x, 9.5, p.z + 7.5, '#2a2a0a');
}
function buildDocks() {
  const p = LAND.docks;
  for (let k = 0; k < 4; k++) {
    box(8, 8, 8, pick([new THREE.MeshStandardMaterial({ color: 0x7a3a2a }), new THREE.MeshStandardMaterial({ color: 0x2a5a7a }), new THREE.MeshStandardMaterial({ color: 0x5a7a2a })]), p.x - 10 + k * 0, 4, p.z - 18 + k * 12);
  }
  addSolid(p.x, p.z, 14, 52);
  sign('DOCKS', p.x, 10, p.z - 26, '#0a2a2a');
}
function buildRamps() {
  for (const p of [LAND.rampA, LAND.rampB]) {
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 14), new THREE.MeshStandardMaterial({ color: 0xc25e2a, roughness: 0.8 }));
    ramp.position.set(p.x, 1.2, p.z); ramp.rotation.x = -0.35; ramp.castShadow = true; cityGroup.add(ramp);
    const flag = new THREE.Mesh(new THREE.ConeGeometry(1, 4, 4), new THREE.MeshBasicMaterial({ color: 0xffd75e }));
    flag.position.set(p.x, 6, p.z - 8); cityGroup.add(flag);
  }
}
buildCity();

// ---------------------------------------------------------------- sky life: birds & drifting clouds
const birds = [];
const clouds = [];
function buildSky() {
  // Birds: small dark "V" shapes crossing the sky.
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x222831 });
  for (let k = 0; k < 9; k++) {
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.3), birdMat);
      wing.position.x = s * 0.5;
      wing.rotation.z = s * 0.45;
      g.add(wing);
    }
    g.position.set(R(-280, 280), R(45, 90), R(-280, 280));
    scene.add(g);
    birds.push({ group: g, speed: R(6, 12), dir: R(0, Math.PI * 2) });
  }
  // Clouds: flat white puffs drifting slowly.
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.85 });
  for (let k = 0; k < 8; k++) {
    const g = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(R(4, 8), 10, 8), cloudMat);
      puff.position.set(R(-8, 8), R(-1.5, 1.5), R(-4, 4));
      puff.scale.y = 0.45;
      g.add(puff);
    }
    g.position.set(R(-280, 280), R(70, 110), R(-280, 280));
    scene.add(g);
    clouds.push({ group: g, speed: R(1, 2.5) });
  }
}
function updateSky(dt) {
  for (const b of birds) {
    b.group.position.x += Math.cos(b.dir) * b.speed * dt;
    b.group.position.z += Math.sin(b.dir) * b.speed * dt;
    b.group.rotation.y = -b.dir;
    if (Math.abs(b.group.position.x) > 300 || Math.abs(b.group.position.z) > 300) {
      b.group.position.x = -Math.sign(b.group.position.x) * 290;
      b.group.position.z = -Math.sign(b.group.position.z) * 290;
    }
  }
  for (const c of clouds) {
    c.group.position.x += c.speed * dt;
    if (c.group.position.x > 320) c.group.position.x = -320;
  }
}
buildSky();

// ---------------------------------------------------------------- cash stashes: 12 bundles of $150 to collect
const CASH_TOTAL = 12, CASH_VALUE = 150;
const cashBundles = [];
function buildCash() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a8a3a, roughness: 0.6, emissive: 0x0a3a0a });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0xd9c24f, roughness: 0.6 });
  for (let k = 0; k < CASH_TOTAL; k++) {
    // On sidewalks near corners, so they read as hidden stashes.
    const cx = roadCoord(RI(-HALF, HALF - 1)) + PITCH / 2 + R(-14, 14);
    const cz = roadCoord(RI(-HALF, HALF - 1)) + PITCH / 2 + R(-14, 14);
    const g = new THREE.Group();
    const stack = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 0.5), mat);
    stack.position.y = 0.15; stack.castShadow = true; g.add(stack);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.1, 0.18), bandMat);
    band.position.y = 0.15; g.add(band);
    g.position.set(cx, 0, cz);
    scene.add(g);
    cashBundles.push({ group: g, x: cx, z: cz, taken: false, spin: R(0, Math.PI * 2) });
  }
}
function updateCash(dt) {
  const px = playerCar ? playerCar.group.position.x : player.pos.x;
  const pz = playerCar ? playerCar.group.position.z : player.pos.z;
  for (const c of cashBundles) {
    if (c.taken) continue;
    c.spin += dt;
    c.group.rotation.y = c.spin;
    c.group.position.y = 0.15 + Math.sin(c.spin * 2) * 0.1;
    if (d2(px, pz, c.x, c.z) < 2.2) {
      c.taken = true;
      c.group.visible = false;
      G.money += CASH_VALUE;
      G.cashFound = (G.cashFound || 0) + 1;
      chime();
      showBanner('CASH +$' + CASH_VALUE + '!');
      saveGame();
    }
  }
}
buildCash();

// ---------------------------------------------------------------- cars
const CAR_COLORS = [0xc0392b, 0x2980b9, 0x27ae60, 0xf39c12, 0x8e44ad, 0x16a085, 0xd35400, 0x7f8c8d, 0xececec, 0x2c3e50];
function makeCar(color, isPolice, isBike) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x18242e, roughness: 0.15, metalness: 0.6 });
  if (isBike) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 2.2), bodyMat);
    body.position.y = 0.7; body.castShadow = true; g.add(body);
    // Seated rider: humanoid with thighs forward, arms reaching the bars.
    const rider = makeHumanoid({ shirt: isPolice ? 0x10203a : 0x333333, pants: 0x1a1a1a, skin: 0xd9a066, cap: isPolice ? 0x10203a : null });
    rider.group.position.set(0, 0.35, -0.2);
    rider.legL.rotation.x = -1.25; rider.legR.rotation.x = -1.25;
    rider.armL.rotation.x = -1.0; rider.armR.rotation.x = -1.0;
    rider.group.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    g.add(rider.group);
    const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.2, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const wm = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const w1 = new THREE.Mesh(wheelGeo, wm); w1.position.set(0, 0.35, 0.8); g.add(w1);
    const w2 = new THREE.Mesh(wheelGeo, wm); w2.position.set(0, 0.35, -0.8); g.add(w2);
    if (isPolice) {
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.4), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
      light.position.set(0, 1.1, 0.6); g.add(light);
    }
    scene.add(g);
    return { group: g, wheels: [w1, w2], color, speed: 0, yaw: 0, maxSpeed: 34, damage: 0, isPolice, isBike: true, axis: 'x', dir: 1, lane: 0 };
  }
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 4.4), bodyMat);
  body.position.y = 0.65; body.castShadow = true; g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.2), glassMat);
  cabin.position.set(0, 1.25, -0.2); cabin.castShadow = true; g.add(cabin);
  if (isPolice) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 0.5), new THREE.MeshBasicMaterial({ color: 0x2244ff }));
    bar.position.set(0, 1.65, -0.2); g.add(bar);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.5), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    door.position.set(0, 0.7, 0); door.rotation.y = Math.PI / 2; g.add(door);
  }
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wm = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const wheels = [];
  for (const [wx, wz] of [[-1, 1.4], [1, 1.4], [-1, -1.4], [1, -1.4]]) {
    const w = new THREE.Mesh(wheelGeo, wm);
    w.position.set(wx, 0.38, wz); g.add(w); wheels.push(w);
  }
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
  for (const sx of [-0.6, 0.6]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.1), beamMat);
    beam.position.set(sx, 0.65, 2.21); g.add(beam);
  }
  scene.add(g);
  return { group: g, wheels, color, speed: 0, yaw: 0, maxSpeed: 30, damage: 0, isPolice, isBike: false, axis: 'x', dir: 1, lane: 0 };
}

// Smoke pool (damage smoke).
const smokePool = [];
for (let i = 0; i < 24; i++) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshStandardMaterial({ color: 0x888888, transparent: true, opacity: 0 }));
  m.visible = false; scene.add(m);
  smokePool.push({ mesh: m, life: 0 });
}
function spawnSmoke(x, y, z) {
  const s = smokePool.find((p) => p.life <= 0);
  if (!s) return;
  s.mesh.position.set(x + R(-0.5, 0.5), y, z + R(-0.5, 0.5));
  s.mesh.visible = true; s.life = 1;
}
function updateSmoke(dt) {
  for (const s of smokePool) {
    if (s.life <= 0) continue;
    s.life -= dt * 0.8;
    s.mesh.position.y += dt * 2.2;
    s.mesh.material.opacity = Math.max(0, s.life * 0.55);
    const sc = 1 + (1 - s.life) * 1.5;
    s.mesh.scale.set(sc, sc, sc);
    if (s.life <= 0) s.mesh.visible = false;
  }
}

// ---------------------------------------------------------------- player
const player = {
  pos: new THREE.Vector3(0, 0, 20), yaw: 0, vy: 0, onGround: true,
  mesh: null, speed: 0, camYaw: 0, camPitch: 0.32, punchUntil: 0,
};
let playerCar = null;
function buildPlayerMesh() {
  const h = makeHumanoid({ shirt: 0x2a6bc2, pants: 0x222831, skin: 0xd9a066, hair: 0x2a1a0a });
  h.group.position.copy(player.pos);
  scene.add(h.group);
  player.mesh = h.group;
  player.limbs = h;
}
buildPlayerMesh();

// ---------------------------------------------------------------- traffic & parked cars
const trafficCars = [];
const parkedCars = [];
const policeCars = [];
function spawnTrafficCar() {
  const axis = rng() < 0.5 ? 'x' : 'z';
  const road = RI(-HALF, HALF);
  const dir = rng() < 0.5 ? 1 : -1;
  const car = makeCar(pick(CAR_COLORS), false, false);
  car.axis = axis; car.dir = dir; car.lane = dir > 0 ? 3 : -3;
  car.speed = R(8, 14);
  const along = R(-CITY, CITY);
  if (axis === 'x') { car.group.position.set(along, 0, roadCoord(road) + car.lane); car.yaw = dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
  else { car.group.position.set(roadCoord(road) + car.lane, 0, along); car.yaw = dir > 0 ? 0 : Math.PI; }
  car.group.rotation.y = car.yaw;
  trafficCars.push(car);
  return car;
}
function spawnParkedCar() {
  const road = RI(-HALF, HALF);
  const along = R(-CITY + 20, CITY - 20);
  const horizontal = rng() < 0.5;
  const car = makeCar(pick(CAR_COLORS), false, false);
  car.speed = 0;
  if (horizontal) { car.group.position.set(along, 0, roadCoord(road) + 5.5); car.yaw = Math.PI / 2; }
  else { car.group.position.set(roadCoord(road) + 5.5, 0, along); car.yaw = 0; }
  car.group.rotation.y = car.yaw;
  parkedCars.push(car);
  return car;
}
for (let i = 0; i < 20; i++) spawnTrafficCar();
for (let i = 0; i < 10; i++) spawnParkedCar();

function updateTraffic(dt) {
  for (const car of trafficCars) {
    const p = car.group.position;
    const step = car.speed * car.dir * dt;
    if (car.axis === 'x') {
      p.x += step;
      if (Math.abs(p.x) > CITY + 20) { p.x = -Math.sign(p.x) * (CITY + 20); }
      // Turn at intersections sometimes (staged shot cars never turn).
      for (let i = -HALF; i <= HALF; i++) {
        if (!car.noTurn && Math.abs(p.x - roadCoord(i)) < 1.2 && rng() < 0.006) {
          car.axis = 'z'; car.dir = rng() < 0.5 ? 1 : -1;
          car.lane = car.dir > 0 ? 3 : -3;
          p.z = roadCoord(i) + car.lane; p.x = roadCoord(i);
          car.yaw = car.dir > 0 ? 0 : Math.PI;
          car.group.rotation.y = car.yaw;
          break;
        }
      }
    } else {
      p.z += step;
      if (Math.abs(p.z) > CITY + 20) { p.z = -Math.sign(p.z) * (CITY + 20); }
      for (let i = -HALF; i <= HALF; i++) {
        if (!car.noTurn && Math.abs(p.z - roadCoord(i)) < 1.2 && rng() < 0.006) {
          car.axis = 'x'; car.dir = rng() < 0.5 ? 1 : -1;
          car.lane = car.dir > 0 ? 3 : -3;
          p.x = roadCoord(i) + car.lane; p.z = roadCoord(i);
          car.yaw = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
          car.group.rotation.y = car.yaw;
          break;
        }
      }
    }
    // Wheels spin.
    for (const w of car.wheels) w.rotation.x += car.speed * dt * 1.5;
    // Traffic car hit by player car: shove + smoke.
    if (playerCar) {
      const pp = playerCar.group.position;
      const dd = d2(p.x, p.z, pp.x, pp.z);
      if (dd < 4.5 && Math.abs(playerCar.speed) > 4) {
        const push = (4.5 - dd);
        const nx = (p.x - pp.x) / (dd || 1), nz = (p.z - pp.z) / (dd || 1);
        p.x += nx * push; p.z += nz * push;
        if (rng() < 0.1) spawnSmoke(p.x, 1.5, p.z);
      }
    }
  }
}

// ---------------------------------------------------------------- pedestrians
const peds = [];
function makePed(x, z) {
  const opts = {};
  if (rng() < 0.25) opts.hat = pick([0xd94f4f, 0x2a6bc2, 0xd9c24f, 0x4f9a4f, 0xe8e8e8]);
  if (rng() < 0.3) opts.bag = pick([0x8a5a20, 0x2a2a2a, 0xd94f4f, 0x4f9a4f]);
  const h = makeHumanoid(opts);
  h.group.position.set(x, 0, z);
  scene.add(h.group);
  return { mesh: h.group, limbs: h, x, z, yaw: R(0, Math.PI * 2), speed: R(1, 1.8), tx: x, tz: z, flee: 0, retarget: 0 };
}
for (let i = 0; i < 32; i++) {
  const road = RI(-HALF, HALF - 1);
  peds.push(makePed(roadCoord(road) + PITCH / 2 + R(-8, 8), roadCoord(RI(-HALF, HALF - 1)) + PITCH / 2 + R(-8, 8)));
}
function updatePeds(dt) {
  for (const p of peds) {
    p.retarget -= dt;
    if (p.flee > 0) {
      p.flee -= dt;
      p.x += Math.sin(p.yaw) * 5 * dt; p.z += Math.cos(p.yaw) * 5 * dt;
    } else {
      if (p.retarget <= 0 || d2(p.x, p.z, p.tx, p.tz) < 1) {
        p.tx = clamp(p.x + R(-40, 40), -CITY, CITY);
        p.tz = clamp(p.z + R(-40, 40), -CITY, CITY);
        p.retarget = R(4, 9);
      }
      const dx = p.tx - p.x, dz = p.tz - p.z, dd = Math.hypot(dx, dz) || 1;
      p.yaw = Math.atan2(dx, dz);
      p.x += (dx / dd) * p.speed * dt; p.z += (dz / dd) * p.speed * dt;
    }
    // Flee gunshots / speeding cars.
    const px = playerCar ? playerCar.group.position.x : player.pos.x;
    const pz = playerCar ? playerCar.group.position.z : player.pos.z;
    if (d2(p.x, p.z, px, pz) < 9 && (playerCar ? Math.abs(playerCar.speed) > 10 : false)) {
      p.flee = 2; p.yaw = Math.atan2(p.x - px, p.z - pz);
    }
    p.x = clamp(p.x, -CITY, CITY); p.z = clamp(p.z, -CITY, CITY);
    const c = collideCircle(p.x, p.z, 0.6);
    p.x = c[0]; p.z = c[1];
    p.mesh.position.set(p.x, 0, p.z);
    p.mesh.rotation.y = p.yaw;
    animateHumanoid(p.limbs, p.flee > 0 ? 5 : p.speed, dt);
  }
}
function scarePeds(x, z, radius) {
  for (const p of peds) {
    if (d2(p.x, p.z, x, z) < radius) { p.flee = 3; p.yaw = Math.atan2(p.x - x, p.z - z); }
  }
}

// ---------------------------------------------------------------- police
function spawnPoliceCar() {
  const car = makeCar(0x101418, true, false);
  car.maxSpeed = 32 + G.wanted * 1.5;
  const a = R(0, Math.PI * 2);
  const px = playerCar ? playerCar.group.position.x : player.pos.x;
  const pz = playerCar ? playerCar.group.position.z : player.pos.z;
  car.group.position.set(px + Math.sin(a) * 70, 0, pz + Math.cos(a) * 70);
  car.group.rotation.y = car.yaw;
  policeCars.push(car);
  return car;
}
function spawnPoliceBike() {
  const bike = makeCar(0x101418, true, true);
  bike.maxSpeed = 36;
  const a = R(0, Math.PI * 2);
  const px = playerCar ? playerCar.group.position.x : player.pos.x;
  const pz = playerCar ? playerCar.group.position.z : player.pos.z;
  bike.group.position.set(px + Math.sin(a) * 60, 0, pz + Math.cos(a) * 60);
  policeCars.push(bike);
  return bike;
}
function updatePolice(dt) {
  const wantCars = Math.min(G.wanted, 4);
  const wantBikes = G.wanted >= 2 ? Math.min(G.wanted - 1, 3) : 0;
  const curCars = policeCars.filter((c) => !c.isBike).length;
  const curBikes = policeCars.filter((c) => c.isBike).length;
  for (let i = curCars; i < wantCars; i++) spawnPoliceCar();
  for (let i = curBikes; i < wantBikes; i++) spawnPoliceBike();
  // Remove extras when wanted drops.
  while (policeCars.filter((c) => !c.isBike).length > wantCars) {
    const c = policeCars.find((x) => !x.isBike);
    if (!c) break;
    scene.remove(c.group); policeCars.splice(policeCars.indexOf(c), 1);
  }
  while (policeCars.filter((c) => c.isBike).length > wantBikes) {
    const c = policeCars.find((x) => x.isBike);
    if (!c) break;
    scene.remove(c.group); policeCars.splice(policeCars.indexOf(c), 1);
  }
  const tx = playerCar ? playerCar.group.position.x : player.pos.x;
  const tz = playerCar ? playerCar.group.position.z : player.pos.z;
  for (const car of policeCars) {
    const p = car.group.position;
    const dx = tx - p.x, dz = tz - p.z, dd = Math.hypot(dx, dz) || 1;
    const targetYaw = Math.atan2(dx, dz);
    let dy = targetYaw - car.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    car.yaw += clamp(dy, -2.2 * dt, 2.2 * dt);
    car.speed = Math.min(car.speed + 14 * dt, car.maxSpeed);
    p.x += Math.sin(car.yaw) * car.speed * dt;
    p.z += Math.cos(car.yaw) * car.speed * dt;
    car.group.position.copy(p);
    car.group.rotation.y = car.yaw;
    for (const w of car.wheels) w.rotation.x += car.speed * dt * 1.5;
    // Ram the player.
    if (dd < 3.2) {
      if (playerCar) {
        damagePlayerCar(6 + G.wanted);
        const nx = dx / dd, nz = dz / dd;
        playerCar.group.position.x -= nx * 1.2;
        playerCar.group.position.z -= nz * 1.2;
        car.speed *= 0.4;
        spawnSmoke(p.x, 1.5, p.z);
      } else if (G.wanted >= 3 && dd < 2.2) {
        busted();
      } else if (dd < 2.2) {
        hurtPlayer(10);
        player.pos.x -= (dx / dd) * 2; player.pos.z -= (dz / dd) * 2;
      }
    }
    const c = collideCircle(p.x, p.z, 2);
    p.x = c[0]; p.z = c[1];
  }
}
function damagePlayerCar(amount) {
  if (!playerCar) return;
  const armor = G.upgrades.armor;
  const reduced = amount * (1 - armor * 0.12);
  playerCar.damage += reduced;
  if (playerCar.damage > 40 && rng() < 0.3) {
    const p = playerCar.group.position;
    spawnSmoke(p.x, 1.2, p.z);
  }
  if (playerCar.damage >= 100) {
    // Car wrecked: kick the player out, car becomes a smoking wreck.
    const p = playerCar.group.position;
    spawnSmoke(p.x, 1.5, p.z);
    exitCar();
    playerCar = null;
    showBanner('CAR WRECKED!');
  }
}

// ---------------------------------------------------------------- input
const keys = {};
let mouseDX = 0, mouseDY = 0, pointerLocked = false;
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Escape') togglePause();
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyN') cycleRadio();
  if (e.code === 'KeyR') reloadWeapon();
  if (e.code === 'KeyE') tryEnterExitCar();
  if (e.code === 'KeyF') punch();
  if (e.code === 'KeyB') tryOpenWorkshop();
  if (e.code === 'KeyG') tryOpenGunshop();
  if (e.code === 'KeyT') tryStartJob();
  if (e.code === 'Digit1') switchWeapon('pistol');
  if (e.code === 'Digit2') switchWeapon('smg');
  if (e.code === 'Digit3') switchWeapon('rifle');
  if (e.code === 'Enter' && G.dialogBusy) advanceDialog();
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
canvas.addEventListener('click', () => {
  if (!G.started || G.paused || G.over || SHOT) return;
  if (!pointerLocked) { canvas.requestPointerLock?.(); return; }
  shoot();
});
document.addEventListener('pointerlockchange', () => { pointerLocked = document.pointerLockElement === canvas; });
document.addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  mouseDX += e.movementX; mouseDY += e.movementY;
});
el('dialog').addEventListener('click', advanceDialog);

// ---------------------------------------------------------------- player movement & driving
function carTopSpeed() {
  const base = 30;
  return base + G.upgrades.engine * 6;
}
function carAccel() { return 16 + G.upgrades.engine * 4; }
function updatePlayer(dt) {
  if (!G.started || G.paused || G.over || G.dialogBusy) return;
  // Camera orbit from mouse.
  player.camYaw -= mouseDX * 0.0028;
  player.camPitch = clamp(player.camPitch + mouseDY * 0.0022, -0.15, 0.9);
  mouseDX = 0; mouseDY = 0;

  if (playerCar) { updateDriving(dt); return; }
  // On foot.
  const run = keys['ShiftLeft'] || keys['ShiftRight'];
  const speed = run ? 9 : 5;
  let fx = 0, fz = 0;
  const sy = Math.sin(player.camYaw), cy = Math.cos(player.camYaw);
  if (keys['KeyW']) { fx += -sy; fz += -cy; }
  if (keys['KeyS']) { fx += sy; fz += cy; }
  if (keys['KeyA']) { fx += -cy; fz += sy; }
  if (keys['KeyD']) { fx += cy; fz += -sy; }
  const len = Math.hypot(fx, fz) || 1;
  if (fx || fz) {
    player.pos.x += (fx / len) * speed * dt;
    player.pos.z += (fz / len) * speed * dt;
    player.yaw = Math.atan2(fx / len, fz / len);
    player.speed = speed;
  } else player.speed = 0;
  // Jump + gravity.
  if (keys['Space'] && player.onGround) { player.vy = 8; player.onGround = false; }
  if (!player.onGround) {
    player.vy -= 22 * dt;
    player.pos.y += player.vy * dt;
    if (player.pos.y <= 0) { player.pos.y = 0; player.vy = 0; player.onGround = true; }
  }
  player.pos.x = clamp(player.pos.x, -CITY - 30, 360);
  player.pos.z = clamp(player.pos.z, -CITY - 30, CITY + 30);
  const c = collideCircle(player.pos.x, player.pos.z, 0.6);
  player.pos.x = c[0]; player.pos.z = c[1];
  player.mesh.position.copy(player.pos);
  player.mesh.rotation.y = player.yaw;
  animateHumanoid(player.limbs, player.speed, dt);
  // Punch: right arm swings forward while the punch is active.
  if (performance.now() / 1000 < player.punchUntil) player.limbs.armR.rotation.x = -1.5;
  setEngineSound(0, false);
}
function updateDriving(dt) {
  const car = playerCar;
  const p = car.group.position;
  const steer = (keys['KeyA'] ? 1 : 0) - (keys['KeyD'] ? 1 : 0);
  const grip = 1 + G.upgrades.tires * 0.15;
  if (keys['KeyW']) car.speed += carAccel() * dt;
  if (keys['KeyS']) car.speed -= (car.speed > 0 ? 22 : 10) * dt;
  if (keys['Space']) car.speed -= Math.sign(car.speed) * 30 * dt;
  car.speed = clamp(car.speed, -12, carTopSpeed());
  if (!keys['KeyW'] && !keys['KeyS']) car.speed *= Math.max(0, 1 - 0.6 * dt);
  if (Math.abs(car.speed) > 0.3) {
    car.yaw += steer * 1.9 * grip * dt * Math.sign(car.speed) * clamp(Math.abs(car.speed) / 10, 0.4, 1);
  }
  p.x += Math.sin(car.yaw) * car.speed * dt;
  p.z += Math.cos(car.yaw) * car.speed * dt;
  p.x = clamp(p.x, -CITY - 30, 360);
  p.z = clamp(p.z, -CITY - 30, CITY + 30);
  const c = collideCircle(p.x, p.z, 2.2);
  if (c[0] !== p.x || c[1] !== p.z) {
    if (Math.abs(car.speed) > 8) { damagePlayerCar(Math.abs(car.speed) * 0.5); spawnSmoke(p.x, 1.2, p.z); }
    car.speed *= 0.4;
    p.x = c[0]; p.z = c[1];
  }
  car.group.rotation.y = car.yaw;
  for (const w of car.wheels) w.rotation.x += car.speed * dt * 1.5;
  // Run over pedestrians.
  for (const ped of peds) {
    if (Math.abs(car.speed) > 5 && d2(p.x, p.z, ped.x, ped.z) < 2.4) {
      ped.x = R(-CITY, CITY); ped.z = R(-CITY, CITY);
      ped.mesh.position.set(ped.x, 0, ped.z);
      addWanted(1);
      scarePeds(p.x, p.z, 20);
      showBanner('PEDESTRIAN RUN OVER!');
    }
  }
  // Stunt air: ramps launch the car.
  for (const rp of [LAND.rampA, LAND.rampB]) {
    if (d2(p.x, p.z, rp.x, rp.z) < 4 && Math.abs(car.speed) > 18) {
      car.airTime = 0; car.airborne = true;
    }
  }
  if (car.airborne) {
    car.airTime = (car.airTime || 0) + dt;
    p.y = Math.sin(Math.min(car.airTime / 0.9, 1) * Math.PI) * 3;
    if (car.airTime > 0.9) { car.airborne = false; p.y = 0; stuntLanded(car.airTime); }
  }
  setEngineSound(Math.abs(car.speed) / carTopSpeed(), true);
  if (car.damage > 40 && rng() < dt * 6) spawnSmoke(p.x, 1.4, p.z);
}
function nearestEnterableCar(maxD) {
  let best = null, bestD = maxD;
  const all = [...parkedCars, ...trafficCars];
  for (const car of all) {
    const p = car.group.position;
    const dd = d2(player.pos.x, player.pos.z, p.x, p.z);
    if (dd < bestD) { bestD = dd; best = car; }
  }
  return best;
}
function tryEnterExitCar() {
  if (!G.started || G.paused || G.over || G.dialogBusy) return;
  if (playerCar) { exitCar(); return; }
  const car = nearestEnterableCar(4.5);
  if (!car) return;
  const wasTraffic = trafficCars.includes(car);
  if (wasTraffic) {
    trafficCars.splice(trafficCars.indexOf(car), 1);
    // Stealing: wanted if witnessed by a ped or police nearby.
    const witnessed = peds.some((p) => d2(p.x, p.z, player.pos.x, player.pos.z) < 30) || policeCars.length > 0;
    if (witnessed) { addWanted(1); showBanner('CAR STOLEN — SPOTTED!'); }
    else showBanner('Car stolen — keep it quiet.');
  }
  playerCar = car;
  car.damage = car.damage || 0;
  player.mesh.visible = false;
}
function exitCar() {
  if (!playerCar) return;
  const p = playerCar.group.position;
  player.pos.set(p.x + Math.sin(playerCar.yaw + Math.PI / 2) * 2.5, 0, p.z + Math.cos(playerCar.yaw + Math.PI / 2) * 2.5);
  player.mesh.visible = true;
  player.mesh.position.copy(player.pos);
  playerCar.speed = 0;
  if (!trafficCars.includes(playerCar) && !parkedCars.includes(playerCar) && !policeCars.includes(playerCar)) {
    parkedCars.push(playerCar);
  }
  playerCar = null;
  setEngineSound(0, false);
}

// ---------------------------------------------------------------- combat
const raycaster = new THREE.Raycaster();
const hittables = []; // meshes with userData.ref = {kind:'enemy'|'ped'|'police', obj}
function shoot() {
  if (!G.started || G.paused || G.over || G.dialogBusy || playerCar) return;
  const w = WEAPONS[G.weapons.cur];
  const now = performance.now() / 1000;
  if (now - G.lastShot < w.rate) return;
  if (G.weapons.mag[G.weapons.cur] <= 0) { reloadWeapon(); return; }
  G.lastShot = now;
  G.weapons.mag[G.weapons.cur]--;
  shotSound();
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  raycaster.far = 70;
  const hits = raycaster.intersectObjects(hittables.filter((m) => m.visible !== false), false);
  if (hits.length > 0) {
    const ref = hits[0].object.userData.ref;
    if (ref) damageTarget(ref, w.dmg);
  }
  // Muzzle flash light pulse.
  scarePeds(player.pos.x, player.pos.z, 25);
  if (policeCars.some((c) => d2(c.group.position.x, c.group.position.z, player.pos.x, player.pos.z) < 30)) addWanted(1);
}
function reloadWeapon() {
  const cur = G.weapons.cur;
  const w = WEAPONS[cur];
  const need = w.mag - G.weapons.mag[cur];
  const avail = Math.min(need, G.weapons.res[cur]);
  if (avail <= 0 || need <= 0) return;
  G.weapons.mag[cur] += avail;
  G.weapons.res[cur] -= avail;
}
function switchWeapon(key) {
  if (!G.weapons.owned[key]) return;
  G.weapons.cur = key;
  showBanner(WEAPONS[key].name + ' EQUIPPED');
}
function punch() {
  if (!G.started || G.paused || G.over || G.dialogBusy || playerCar) return;
  const now = performance.now() / 1000;
  if (now - player.punchUntil < 0) return;
  player.punchUntil = now + 0.45;
  for (const e of enemies) {
    if (e.hp <= 0) continue;
    const dd = d2(player.pos.x, player.pos.z, e.mesh.position.x, e.mesh.position.z);
    if (dd < 2.4) { damageEnemy(e, 15); break; }
  }
}
function damageTarget(ref, dmg) {
  if (ref.kind === 'enemy') damageEnemy(ref.obj, dmg);
  else if (ref.kind === 'ped') {
    const p = ref.obj;
    p.x = R(-CITY, CITY); p.z = R(-CITY, CITY);
    p.mesh.position.set(p.x, 0, p.z);
    addWanted(1);
    showBanner('PEDESTRIAN SHOT!');
  } else if (ref.kind === 'police') {
    addWanted(1);
    showBanner('COP SHOT!');
  }
}

// ---------------------------------------------------------------- enemies
const enemies = [];
function spawnEnemy(x, z, hp) {
  const h = makeHumanoid({ shirt: 0xd93838, pants: 0x2a2a2a, skin: pick(SKIN_TONES), hair: 0x111111 });
  const g = h.group;
  // Hi-vis vest stripe over the torso.
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.26, 0.4), new THREE.MeshBasicMaterial({ color: 0xffd75e }));
  vest.position.y = 1.22; g.add(vest);
  // Gun parented to the raised right arm so it tracks the aim.
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.9), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  gun.position.set(0, -0.68, 0.25); h.armR.add(gun);
  h.armR.rotation.x = -1.25; // aiming forward
  // Health bar with a white frame so it pops on any background.
  const barFrame = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.24, 0.04), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  barFrame.position.y = 2.28; g.add(barFrame);
  const barBg = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  barBg.position.y = 2.28; g.add(barBg);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.09, 0.06), new THREE.MeshBasicMaterial({ color: 0x33ff55 }));
  bar.position.set(0, 2.28, 0.02); g.add(bar);
  g.position.set(x, 0, z);
  g.traverse((m) => { if (m.isMesh) { m.userData.ref = { kind: 'enemy', obj: null }; hittables.push(m); } });
  scene.add(g);
  const e = { mesh: g, limbs: h, hp, maxHp: hp, bar, shootTimer: R(0.5, 1.5) };
  g.traverse((m) => { if (m.userData.ref) m.userData.ref.obj = e; });
  enemies.push(e);
  return e;
}
function damageEnemy(e, dmg) {
  e.hp -= dmg;
  e.bar.scale.x = Math.max(0, e.hp / e.maxHp);
  e.bar.material.color.setHex(e.hp / e.maxHp > 0.5 ? 0x33ff55 : 0xffaa00);
  if (e.hp <= 0) {
    e.mesh.visible = false;
    G.kills++;
    chime();
  }
}
function updateEnemies(dt) {
  const tx = playerCar ? playerCar.group.position.x : player.pos.x;
  const tz = playerCar ? playerCar.group.position.z : player.pos.z;
  for (const e of enemies) {
    if (e.hp <= 0) continue;
    const p = e.mesh.position;
    const dd = d2(p.x, p.z, tx, tz);
    if (dd < 40 && dd > 6) {
      const dx = (tx - p.x) / dd, dz = (tz - p.z) / dd;
      p.x += dx * 4.5 * dt; p.z += dz * 4.5 * dt;
    }
    e.mesh.rotation.y = Math.atan2(tx - p.x, tz - p.z);
    animateHumanoid(e.limbs, (dd < 40 && dd > 6) ? 4.5 : 0, dt);
    e.limbs.armR.rotation.x = -1.25; // keep the gun arm raised while walking
    e.shootTimer -= dt;
    if (e.shootTimer <= 0 && dd < 28) {
      e.shootTimer = R(1.0, 1.8);
      noiseBurst(0.08, 1200, 0.25);
      if (rng() < 0.5) {
        if (playerCar) damagePlayerCar(5);
        else hurtPlayer(7);
      }
    }
  }
}
function clearEnemies() {
  for (const e of enemies) { scene.remove(e.mesh); }
  for (const m of [...hittables]) { if (m.userData.ref && m.userData.ref.kind === 'enemy') hittables.splice(hittables.indexOf(m), 1); }
  enemies.length = 0;
}

// ---------------------------------------------------------------- health / wanted / busted
function hurtPlayer(n) {
  if (G.over) return;
  G.health -= n;
  if (G.health <= 0) { G.health = 0; wasted(); }
}
function addWanted(n) {
  G.wanted = Math.min(5, G.wanted + n);
  G.wantedTimer = 20;
  if (G.wanted > 0) sirenStart();
}
function updateWanted(dt) {
  if (G.wanted <= 0) return;
  G.wantedTimer -= dt;
  if (G.wantedTimer > 0) return;
  const tx = playerCar ? playerCar.group.position.x : player.pos.x;
  const tz = playerCar ? playerCar.group.position.z : player.pos.z;
  const nearPolice = policeCars.some((c) => d2(c.group.position.x, c.group.position.z, tx, tz) < 45);
  if (nearPolice) { G.wantedTimer = 8; return; }
  G.wanted--;
  G.wantedTimer = 20;
  if (G.wanted === 0) sirenStop();
}
function busted() {
  if (G.over) return;
  G.over = true;
  const lost = Math.floor(G.money * 0.15);
  G.money -= lost;
  showOver('CAUGHT', `The cops caught you. Fine $${lost}. You wake up in the hospital.`);
}
function wasted() {
  if (G.over) return;
  G.over = true;
  const lost = Math.floor(G.money * 0.2);
  G.money -= lost;
  showOver('FLATLINED', `You went down. Hospital bill $${lost}.`);
}
function respawnHospital() {
  G.over = false;
  G.health = G.maxHealth;
  G.wanted = 0; sirenStop();
  if (playerCar) { playerCar = null; }
  player.pos.set(LAND.hospital.x, 0, LAND.hospital.z + 16);
  player.mesh.visible = true;
  player.mesh.position.copy(player.pos);
  el('over').classList.add('hidden');
  el('hud').classList.remove('hidden');
  saveGame();
}
function showOver(title, text) {
  el('over-title').textContent = title;
  el('over-text').textContent = text;
  el('over').classList.remove('hidden');
  el('hud').classList.add('hidden');
  saveGame();
}

// ---------------------------------------------------------------- beacon & banners
const beacon = new THREE.Group();
const beaconCyl = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 40, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true, opacity: 0.28, side: THREE.DoubleSide }));
beaconCyl.position.y = 20; beacon.add(beaconCyl);
const beaconCone = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3, 4), new THREE.MeshBasicMaterial({ color: 0xffd75e }));
beaconCone.position.y = 42; beaconCone.rotation.x = Math.PI; beacon.add(beaconCone);
beacon.visible = false; scene.add(beacon);
function setBeacon(x, z) {
  beacon.position.set(x, 0, z);
  beacon.visible = true;
}
function hideBeacon() { beacon.visible = false; }
let bannerTimer = null;
function showBanner(text, ms) {
  const b = el('banner');
  b.textContent = text;
  b.style.opacity = '1';
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.style.opacity = '0'; }, ms || 2600);
}
function setObjective(text) { el('objective').textContent = text; }
function setJob(text) {
  const j = el('job');
  if (!text) { j.textContent = ''; j.style.display = 'none'; return; }
  j.style.display = 'block'; j.textContent = text;
}

// ---------------------------------------------------------------- dialogs
function queueDialog(lines) {
  G.dialogQueue.push(...lines);
  if (!G.dialogBusy) advanceDialog();
}
function advanceDialog() {
  const next = G.dialogQueue.shift();
  if (!next) {
    G.dialogBusy = false;
    el('dialog').classList.add('hidden');
    return;
  }
  G.dialogBusy = true;
  el('dialog-name').textContent = next[0];
  el('dialog-text').textContent = next[1];
  el('dialog').classList.remove('hidden');
}

// ---------------------------------------------------------------- missions
const MISSIONS = [
  {
    name: 'First Wheels', reward: 2000,
    intro: [['Vera Kross', 'Marco. Fifty grand. Six jobs and we are square. First one: steal any car, bring it to Dex\u2019s garage. Don\u2019t get seen.'], ['Marco', 'One car. Easy.']],
    steps: [
      { type: 'goto', text: 'Steal a car (E) and bring it to Dex\u2019s garage', target: [LAND.garage.x, LAND.garage.z + 18], radius: 10, needCar: true },
    ],
    outro: [['Dex', 'Nice ride. Vera sent your pay. Good work, Marco.']],
  },
  {
    name: 'Courier Run', reward: 3000,
    intro: [['Mama Rosa', 'Sweetheart, these packages have to arrive before lunch. Four stops, don\u2019t be late!']],
    steps: [
      { type: 'timed', text: 'Checkpoint 1/4 — deliver the package (90s)', target: [104, -104], radius: 9, time: 90 },
      { type: 'timed', text: 'Checkpoint 2/4 — deliver the package', target: [-104, -104], radius: 9, time: 60 },
      { type: 'timed', text: 'Checkpoint 3/4 — deliver the package', target: [-104, 104], radius: 9, time: 60 },
      { type: 'timed', text: 'Checkpoint 4/4 — deliver the package', target: [208, 52], radius: 9, time: 60 },
    ],
    outro: [['Mama Rosa', 'Right on time! Rosa always knows a good driver.']],
  },
  {
    name: 'Shakedown', reward: 5000,
    intro: [['Vera Kross', 'The Beach Gang is messing with our deliveries. Go to their warehouse. Make them understand who runs Solmar.']],
    steps: [
      { type: 'goto', text: 'Reach the warehouse in the northwest', target: [LAND.warehouse.x, LAND.warehouse.z], radius: 14 },
      { type: 'combat', text: 'Take down 4 gang members!', target: [LAND.warehouse.x, LAND.warehouse.z], radius: 16, count: 4 },
    ],
    outro: [['Vera Kross', 'That warehouse is ours now. $5,000 for you.']],
  },
  {
    name: 'Getaway', reward: 8000,
    intro: [['Dex', 'The cops are on your tail, Marco! Wanted level 3! Run to the safehouse in the northeast — don\u2019t get caught!']],
    steps: [
      { type: 'goto', text: 'ESCAPE! Reach the safehouse (wanted 3)', target: [LAND.safehouse.x, LAND.safehouse.z], radius: 12, setWanted: 3 },
    ],
    outro: [['Marco', 'Made it... for now. Vera will be pleased.']],
  },
  {
    name: 'The Drop', reward: 12000,
    intro: [['Vera Kross', 'A package at the docks. Take it to the gun shop. The cops already smell it — they will chase you. Don\u2019t stop.']],
    steps: [
      { type: 'goto', text: 'Pick up the package at the docks', target: [LAND.docks.x, LAND.docks.z], radius: 10 },
      { type: 'goto', text: 'Deliver the package to the gun shop (cops on your tail!)', target: [LAND.gunshop.x, LAND.gunshop.z], radius: 10, setWanted: 2 },
    ],
    outro: [['Vera Kross', 'Package delivered. $12,000. Twenty grand left, Marco.']],
  },
  {
    name: 'Payday', reward: 20000,
    intro: [['Vera Kross', 'Last job. The Beach Gang hits the docks tonight. Hold the line, then bring the take to me at the warehouse. After this, your debt is PAID.']],
    steps: [
      { type: 'combat', text: 'Hold the docks — take down 6 attackers!', target: [LAND.docks.x, LAND.docks.z], radius: 18, count: 6 },
      { type: 'goto', text: 'Bring the take to Vera at the warehouse', target: [LAND.warehouse.x, LAND.warehouse.z], radius: 12 },
    ],
    outro: [['Vera Kross', 'Fifty thousand. Paid in full. You are free, Marco. Solmar City is yours now.'], ['Marco', 'Free... at last.']],
  },
];
function startMission(i) {
  G.mission = i; G.step = 0;
  const m = MISSIONS[i];
  if (!m) { setObjective('FREE ROAM — debt paid. Enjoy Solmar City!'); hideBeacon(); return; }
  showBanner('MISSION ' + (i + 1) + ': ' + m.name.toUpperCase());
  queueDialog(m.intro);
  setupStep();
}
function setupStep() {
  const m = MISSIONS[G.mission];
  if (!m) return;
  const s = m.steps[G.step];
  if (!s) { completeMission(); return; }
  setObjective('MISSION ' + (G.mission + 1) + ' — ' + m.name + ': ' + s.text);
  setBeacon(s.target[0], s.target[1]);
  G.missionData = { timer: s.time || 0, spawned: false };
  if (s.setWanted) addWanted(s.setWanted);
  if (s.type === 'combat' && !G.missionData.spawned) {
    G.missionData.spawned = true;
    for (let k = 0; k < s.count; k++) {
      spawnEnemy(s.target[0] + R(-10, 10), s.target[1] + R(-10, 10), 100);
    }
  }
}
function missionTargetPos() {
  const m = MISSIONS[G.mission];
  if (!m) return null;
  const s = m.steps[G.step];
  return s ? { x: s.target[0], z: s.target[1], r: s.radius } : null;
}
function updateMission(dt) {
  const m = MISSIONS[G.mission];
  if (!m || G.dialogBusy) return;
  const s = m.steps[G.step];
  if (!s) return;
  if (s.type === 'timed') {
    G.missionData.timer -= dt;
    setObjective('MISSION ' + (G.mission + 1) + ' — ' + m.name + ': ' + s.text + ' (' + Math.ceil(G.missionData.timer) + 's)');
    if (G.missionData.timer <= 0) { failMission('Time up!'); return; }
  }
  const px = playerCar ? playerCar.group.position.x : player.pos.x;
  const pz = playerCar ? playerCar.group.position.z : player.pos.z;
  if (s.type === 'goto' || s.type === 'timed') {
    if (s.needCar && !playerCar) return;
    if (d2(px, pz, s.target[0], s.target[1]) < s.radius) {
      chime();
      G.step++;
      setupStep();
    }
  } else if (s.type === 'combat') {
    const alive = enemies.filter((e) => e.hp > 0).length;
    setObjective('MISSION ' + (G.mission + 1) + ' — ' + m.name + ': ' + s.text + ' (' + alive + ' left)');
    if (alive === 0) { G.step++; setupStep(); }
  }
}
function completeMission() {
  const m = MISSIONS[G.mission];
  G.money += m.reward;
  G.debt = Math.max(0, G.debt - m.reward);
  G.health = Math.min(G.maxHealth, G.health + 50);
  showBanner('MISSION COMPLETE! +$' + m.reward + '  ·  DEBT LEFT $' + G.debt, 4000);
  chime();
  queueDialog(m.outro);
  clearEnemies();
  hideBeacon();
  if (G.debt <= 0) {
    G.debtPaid = true;
    showBanner('DEBT PAID! SOLMAR CITY IS YOURS!', 5000);
    setObjective('FREE ROAM — debt paid. Enjoy Solmar City!');
    G.mission = MISSIONS.length;
  } else {
    G.mission++;
    G.step = 0;
    setTimeout(() => { if (G.started && !G.over) startMission(G.mission); }, 2500);
  }
  saveGame();
}
function failMission(reason) {
  showBanner('MISSION FAILED: ' + reason + ' — try again', 3500);
  G.wanted = 0; sirenStop();
  clearEnemies();
  setTimeout(() => { if (G.started && !G.over) startMission(G.mission); }, 2000);
}

// ---------------------------------------------------------------- side jobs
const JOB_DEFS = {
  taxi: { name: 'TAXI', pay: 180, time: 75 },
  package: { name: 'PACKAGE', pay: 220, time: 90 },
  stunt: { name: 'STUNT JUMP', pay: 150, time: 120 },
};
function tryStartJob() {
  if (!G.started || G.paused || G.over || G.dialogBusy || G.job) return;
  const types = ['taxi', 'package', 'stunt'];
  const type = types[G.mission % 3]; // rotate by progress for variety
  const def = JOB_DEFS[type];
  if (type === 'stunt') {
    const ramp = rng() < 0.5 ? LAND.rampA : LAND.rampB;
    G.job = { type, stage: 0, target: [ramp.x, ramp.z], timer: def.time, pay: def.pay, best: 0 };
    setJob('STUNT JUMP: jump off the yellow ramp! ' + def.time + 's on the clock');
  } else if (type === 'taxi') {
    const ped = pick(peds);
    G.job = { type, stage: 0, target: [ped.x, ped.z], timer: def.time, pay: def.pay, ped };
    setJob('TAXI: pick up the passenger (green marker)!');
  } else {
    const lm = pick([LAND.docks, LAND.garage, LAND.hospital, LAND.safehouse]);
    G.job = { type, stage: 0, target: [lm.x, lm.z], timer: def.time, pay: def.pay };
    setJob('PACKAGE: grab the package at the green marker!');
  }
  setBeacon(G.job.target[0], G.job.target[1]);
  beaconCyl.material.color.setHex(0x33ff88);
  showBanner('SIDE JOB: ' + def.name);
}
function updateJob(dt) {
  if (!G.job) return;
  const j = G.job;
  j.timer -= dt;
  if (j.timer <= 0) { endJob(false, 'Time up!'); return; }
  const px = playerCar ? playerCar.group.position.x : player.pos.x;
  const pz = playerCar ? playerCar.group.position.z : player.pos.z;
  const d = d2(px, pz, j.target[0], j.target[1]);
  if (j.type === 'stunt') {
    setJob('STUNT JUMP: jump the ramp! Best air: ' + j.best.toFixed(1) + 's · ' + Math.ceil(j.timer) + 's left');
    if (d < 8) setJob('STUNT JUMP: floor it and JUMP! · ' + Math.ceil(j.timer) + 's left');
    return;
  }
  if (j.stage === 0) {
    setJob((j.type === 'taxi' ? 'TAXI: pick up the passenger' : 'PACKAGE: grab the package') + ' — ' + Math.round(d) + 'm · ' + Math.ceil(j.timer) + 's');
    if (d < 7) {
      j.stage = 1;
      if (j.type === 'taxi') {
        const dest = pick([LAND.hospital, LAND.docks, LAND.safehouse, LAND.gunshop, LAND.garage]);
        j.target = [dest.x, dest.z];
        setJob('TAXI: drive the passenger to the destination!');
      } else {
        const dest = pick([LAND.warehouse, LAND.hospital, LAND.safehouse, LAND.gunshop]);
        j.target = [dest.x, dest.z];
        setJob('PACKAGE: deliver the package!');
      }
      setBeacon(j.target[0], j.target[1]);
      chime();
    }
  } else {
    setJob((j.type === 'taxi' ? 'TAXI: drop off the passenger' : 'PACKAGE: deliver the package') + ' — ' + Math.round(d) + 'm · ' + Math.ceil(j.timer) + 's');
    if (d < 8) endJob(true, null);
  }
}
function endJob(success, reason) {
  const j = G.job;
  G.job = null;
  setJob(null);
  beaconCyl.material.color.setHex(0xffd75e);
  if (success) {
    const bonus = j.type === 'stunt' ? Math.round(j.best * 120) : Math.round(j.timer) * 2;
    const pay = j.pay + bonus;
    G.money += pay;
    showBanner('JOB DONE! +$' + pay, 3000);
    chime();
  } else {
    showBanner('JOB FAILED: ' + reason, 2500);
  }
  hideBeacon();
  const t = missionTargetPos();
  if (t) setBeacon(t.x, t.z);
  saveGame();
}
function stuntLanded(airTime) {
  if (!G.job || G.job.type !== 'stunt') return;
  G.job.best = Math.max(G.job.best, airTime);
  showBanner('STUNT! ' + airTime.toFixed(1) + 's of air!');
  if (airTime > 0.9) endJob(true, null);
}

// ---------------------------------------------------------------- shops
let shopKind = null;
function shopHTML(kind) {
  const rows = [];
  if (kind === 'workshop') {
    rows.push('<h3>DEX\'S GARAGE — WORKSHOP &amp; UPGRADES</h3>');
    rows.push('<p>Your cash: $' + G.money + ' · Car: ' + (playerCar ? 'in the garage' : 'none') + '</p>');
    for (const key of ['engine', 'armor', 'tires']) {
      const u = UPGRADES[key];
      const lvl = G.upgrades[key];
      const maxed = lvl >= u.max;
      const price = maxed ? 0 : u.prices[lvl];
      rows.push(`<div class="item"><span>${u.name} — Lv ${lvl}/${u.max}</span><button data-buy="up:${key}" ${maxed || G.money < price ? 'disabled' : ''}>${maxed ? 'MAX' : 'BUY $' + price}</button></div>`);
    }
    const rep = playerCar ? Math.floor(playerCar.damage * 4) : 0;
    rows.push(`<div class="item"><span>Repair car (${playerCar ? Math.floor(playerCar.damage) + '% damaged' : '-'})</span><button data-buy="repair" ${!playerCar || playerCar.damage < 1 || G.money < rep ? 'disabled' : ''}>REPAIR $${rep}</button></div>`);
  } else {
    rows.push('<h3>AMMO-NATION — GUN SHOP</h3>');
    rows.push('<p>Your cash: $' + G.money + '</p>');
    for (const key of ['smg', 'rifle']) {
      const w = WEAPONS[key];
      const owned = G.weapons.owned[key];
      rows.push(`<div class="item"><span>${w.name} — dmg ${w.dmg} · ${w.mag} rounds/mag</span><button data-buy="gun:${key}" ${owned || G.money < w.price ? 'disabled' : ''}>${owned ? 'OWNED' : 'BUY $' + w.price}</button></div>`);
    }
    rows.push(`<div class="item"><span>Pistol Ammo ×24</span><button data-buy="ammo:pistol" ${G.money < 50 ? 'disabled' : ''}>BUY $50</button></div>`);
    rows.push(`<div class="item"><span>SMG Ammo ×60</span><button data-buy="ammo:smg" ${!G.weapons.owned.smg || G.money < 80 ? 'disabled' : ''}>BUY $80</button></div>`);
    rows.push(`<div class="item"><span>Rifle Ammo ×40</span><button data-buy="ammo:rifle" ${!G.weapons.owned.rifle || G.money < 120 ? 'disabled' : ''}>BUY $120</button></div>`);
  }
  rows.push('<div class="close">click outside / press Esc to close · 1/2/3 switch weapon</div>');
  return rows.join('');
}
function openShop(kind) {
  shopKind = kind;
  const s = el('shop');
  s.innerHTML = shopHTML(kind);
  s.classList.remove('hidden');
  s.querySelectorAll('[data-buy]').forEach((b) => {
    b.addEventListener('click', () => {
      const [what, key] = b.dataset.buy.split(':');
      if (what === 'up') buyUpgrade(key);
      else if (what === 'gun') buyWeapon(key);
      else if (what === 'ammo') buyAmmo(key);
      else if (what === 'repair') repairCar();
      el('shop').innerHTML = shopHTML(kind);
      el('shop').querySelectorAll('[data-buy]').forEach((b2) => b2.addEventListener('click', () => openShop(kind)));
    });
  });
}
function closeShop() { shopKind = null; el('shop').classList.add('hidden'); }
function buyUpgrade(key) {
  const u = UPGRADES[key];
  const lvl = G.upgrades[key];
  if (lvl >= u.max) return;
  const price = u.prices[lvl];
  if (G.money < price) return;
  G.money -= price; G.upgrades[key]++;
  chime();
  showBanner(u.name + ' upgraded to Lv ' + G.upgrades[key] + '!');
  saveGame();
}
function buyWeapon(key) {
  const w = WEAPONS[key];
  if (G.weapons.owned[key] || G.money < w.price) return;
  G.money -= w.price;
  G.weapons.owned[key] = true;
  G.weapons.mag[key] = w.mag; G.weapons.res[key] = w.mag * 2;
  G.weapons.cur = key;
  chime();
  showBanner(w.name + ' BOUGHT!');
  saveGame();
}
function buyAmmo(key) {
  const pack = { pistol: [24, 50], smg: [60, 80], rifle: [40, 120] }[key];
  if (!pack || G.money < pack[1]) return;
  if (key !== 'pistol' && !G.weapons.owned[key]) return;
  G.money -= pack[1];
  G.weapons.res[key] += pack[0];
  chime();
  showBanner('Ammo: ' + WEAPONS[key].name + ' +' + pack[0]);
  saveGame();
}
function repairCar() {
  if (!playerCar || playerCar.damage < 1) return;
  const cost = Math.floor(playerCar.damage * 4);
  if (G.money < cost) return;
  G.money -= cost; playerCar.damage = 0;
  chime();
  showBanner('Car repaired!');
  saveGame();
}
function tryOpenWorkshop() {
  if (!G.started || G.paused || G.over) return;
  const px = playerCar ? playerCar.group.position.x : player.pos.x;
  const pz = playerCar ? playerCar.group.position.z : player.pos.z;
  if (d2(px, pz, LAND.garage.x, LAND.garage.z + 18) < 22) {
    if (shopKind === 'workshop') closeShop(); else openShop('workshop');
  }
}
function tryOpenGunshop() {
  if (!G.started || G.paused || G.over) return;
  if (d2(player.pos.x, player.pos.z, LAND.gunshop.x, LAND.gunshop.z) < 20) {
    if (shopKind === 'gunshop') closeShop(); else openShop('gunshop');
  }
}

// ---------------------------------------------------------------- HUD & minimap
const mm = el('minimap').getContext('2d');
function updateHUD() {
  el('money').textContent = '$' + G.money + (G.debt > 0 ? ' · DEBT $' + G.debt : ' · PAID OFF');
  el('cash').textContent = '$' + ((G.cashFound || 0) * CASH_VALUE) + ' · CASH ' + (G.cashFound || 0) + '/' + CASH_TOTAL;
  let stars = '';
  for (let i = 0; i < 5; i++) stars += i < G.wanted ? '★' : '☆';
  el('stars').textContent = stars;
  const hh = Math.floor(G.time) % 24, mm2 = Math.floor((G.time % 1) * 60);
  el('clock').textContent = String(hh).padStart(2, '0') + ':' + String(mm2).padStart(2, '0');
  const hp = el('health-bar');
  hp.style.width = G.health + '%';
  hp.style.background = G.health > 50 ? 'linear-gradient(90deg,#44cc44,#88ff88)' : G.health > 25 ? 'linear-gradient(90deg,#ffaa22,#ffcc55)' : 'linear-gradient(90deg,#ff4444,#ff8844)';
  el('health-text').textContent = Math.ceil(G.health);
  const w = WEAPONS[G.weapons.cur];
  el('weapon').textContent = w.name + ' · ' + G.weapons.mag[G.weapons.cur] + '/' + G.weapons.res[G.weapons.cur] + (playerCar ? '  ·  CAR ' + Math.max(0, Math.round(100 - playerCar.damage)) + '%' : '');
  if (playerCar) {
    el('speedo').textContent = Math.round(Math.abs(playerCar.speed) * 3.6) + ' km/h';
  } else el('speedo').textContent = '';
  el('upgrades').textContent = 'ENG ' + G.upgrades.engine + ' · ARM ' + G.upgrades.armor + ' · TIRES ' + G.upgrades.tires;
}
function drawMinimap() {
  const ctx = mm, S = 180, scale = S / (2 * (CITY + 40));
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#0b1526'; ctx.fillRect(0, 0, S, S);
  const toMap = (x, z) => [(x + CITY + 40) * scale, (z + CITY + 40) * scale];
  // Beach.
  ctx.fillStyle = '#c9b078';
  ctx.fillRect(toMap(272, -CITY - 40)[0], 0, S - toMap(272, -CITY - 40)[0], S);
  ctx.fillStyle = '#1e6f8f';
  ctx.fillRect(toMap(360, -CITY - 40)[0], 0, S - toMap(360, -CITY - 40)[0], S);
  // Roads.
  ctx.strokeStyle = '#5a6270'; ctx.lineWidth = 3;
  for (let i = -HALF; i <= HALF; i++) {
    const [x1, y1] = toMap(roadCoord(i), -CITY);
    const [x2, y2] = toMap(roadCoord(i), CITY);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const [a1, b1] = toMap(-CITY, roadCoord(i));
    const [a2, b2] = toMap(CITY, roadCoord(i));
    ctx.beginPath(); ctx.moveTo(a1, b1); ctx.lineTo(a2, b2); ctx.stroke();
  }
  // Landmarks.
  ctx.fillStyle = '#ffd75e';
  for (const k of ['warehouse', 'garage', 'gunshop', 'hospital', 'safehouse']) {
    const [x, y] = toMap(LAND[k].x, LAND[k].z);
    ctx.fillRect(x - 2, y - 2, 4, 4);
  }
  // Objective marker + GPS arrow.
  const t = G.job ? { x: G.job.target[0], z: G.job.target[1] } : missionTargetPos();
  const px = playerCar ? playerCar.group.position.x : player.pos.x;
  const pz = playerCar ? playerCar.group.position.z : player.pos.z;
  if (t) {
    const [x, y] = toMap(t.x, t.z);
    ctx.fillStyle = G.job ? '#33ff88' : '#ffd75e';
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    const [mx, my] = toMap(px, pz);
    const ang = Math.atan2(x - mx, y - my);
    ctx.strokeStyle = '#ffd75e'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(mx, my);
    ctx.lineTo(mx + Math.sin(ang) * 16, my + Math.cos(ang) * 16); ctx.stroke();
  }
  // Police (flashing).
  const flash = Math.floor(performance.now() / 300) % 2 === 0;
  ctx.fillStyle = flash ? '#ff3333' : '#3388ff';
  for (const c of policeCars) {
    const [x, y] = toMap(c.group.position.x, c.group.position.z);
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  }
  // Traffic dots.
  ctx.fillStyle = '#dddddd';
  for (const c of trafficCars) {
    const [x, y] = toMap(c.group.position.x, c.group.position.z);
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }
  // Player arrow.
  const [pxm, pzm] = toMap(px, pz);
  ctx.save();
  ctx.translate(pxm, pzm);
  ctx.rotate(playerCar ? playerCar.yaw : player.yaw);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- day / night
function updateDayNight(dt) {
  G.time += dt * 0.02; // full day ~ 50 min real time
  if (G.time >= 24) G.time -= 24;
  const t = G.time;
  // Sun elevation: noon high, midnight low.
  const sunAngle = ((t - 6) / 12) * Math.PI;
  const elev = Math.sin(sunAngle);
  sun.position.set(Math.cos(sunAngle) * 300, Math.max(20, elev * 400), 150);
  const day = clamp(elev, 0, 1);
  sun.intensity = 0.3 + day * 2.1;
  moon.intensity = day < 0.15 ? 0.5 : 0;
  hemi.intensity = 0.4 + day * 0.65;
  const skyDay = new THREE.Color(0x9ec9f2), skyNight = new THREE.Color(0x0a1030), skyDusk = new THREE.Color(0xc25e2a);
  let sky;
  if (day > 0.6) sky = skyDay;
  else if (day > 0.15) sky = skyDay.clone().lerp(skyDusk, (0.6 - day) / 0.45);
  else sky = skyNight.clone().lerp(skyDusk, clamp(day / 0.15, 0, 1) * 0.4);
  scene.background = sky;
  scene.fog.color.copy(sky);
  const night = day < 0.25;
  for (const pl of lampLights) pl.intensity = night ? 14 : 0;
  if (playerCar && night) {
    const p = playerCar.group.position;
    playerHeadlight.position.set(p.x + Math.sin(playerCar.yaw) * 2.4, 1.2, p.z + Math.cos(playerCar.yaw) * 2.4);
    playerHeadlight.intensity = 10;
  } else playerHeadlight.intensity = 0;
}

// ---------------------------------------------------------------- camera
function updateCamera(dt) {
  if (!G.started) return;
  const target = playerCar ? playerCar.group.position : player.pos;
  const yaw = playerCar ? playerCar.yaw + Math.PI : player.camYaw;
  const dist = playerCar ? 13 : 8;
  const height = 4.5 + player.camPitch * 4;
  const cx = target.x - Math.sin(yaw) * dist;
  const cz = target.z - Math.cos(yaw) * dist;
  const desired = new THREE.Vector3(cx, target.y + height, cz);
  // Screenshot mode: snap the camera (virtual-time dt makes the lerp
  // converge unreliably, leaving the camera mid-flight).
  if (SHOT) camera.position.copy(desired);
  else camera.position.lerp(desired, 1 - Math.pow(0.0001, dt));
  camera.lookAt(target.x, target.y + 1.6, target.z);
}

// ---------------------------------------------------------------- pause / start / over
function togglePause() {
  if (!G.started || G.over || SHOT) return;
  G.paused = !G.paused;
  el('pause').classList.toggle('hidden', !G.paused);
  if (!G.paused) closeShop();
  if (G.paused) { document.exitPointerLock?.(); saveGame(); }
}
function startGame(fromSave) {
  audioInit();
  el('start').classList.add('hidden');
  el('hud').classList.remove('hidden');
  G.started = true;
  G.paused = false;
  if (fromSave) {
    const s = loadGame();
    if (s) { applySave(s); showBanner('WELCOME BACK, MARCO'); }
  }
  if (!SHOT) {
    if (G.mission < MISSIONS.length) startMission(G.mission);
    else setObjective('FREE ROAM — debt paid. Enjoy Solmar City!');
  }
  if (SHOT === 'drive' || SHOT === 'chase' || SHOT === 'mission') stageShot();
  saveGame();
}
el('btn-new').addEventListener('click', () => { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} startGame(false); });
el('btn-continue').addEventListener('click', () => startGame(true));
el('btn-resume').addEventListener('click', togglePause);
el('btn-quit').addEventListener('click', () => {
  saveGame();
  G.started = false; G.paused = false;
  el('pause').classList.add('hidden');
  el('hud').classList.add('hidden');
  el('start').classList.remove('hidden');
  el('btn-continue').classList.remove('hidden');
});
el('btn-retry').addEventListener('click', respawnHospital);
if (loadGame()) el('btn-continue').classList.remove('hidden');

// ---------------------------------------------------------------- shot staging (deterministic, for screenshots)
function stageShot() {
  // Screenshot mode: no story dialogs (they would freeze the scene).
  G.dialogQueue = []; G.dialogBusy = false;
  el('dialog').classList.add('hidden');
  if (SHOT === 'start') return; // start screen stays visible
  G.started = true;
  el('start').classList.add('hidden');
  el('hud').classList.remove('hidden');
  G.time = 10.5; // late morning light
  if (SHOT === 'drive') {
    const car = spawnParkedCar();
    car.group.position.set(0, 0, 104);
    car.yaw = 0; car.group.rotation.y = 0;
    playerCar = car;
    player.mesh.visible = false;
    car.speed = 12;
    // Dense traffic on the main avenue.
    for (let k = 0; k < 6; k++) {
      const t = spawnTrafficCar();
      t.noTurn = true;
      t.group.position.set(R(-100, 100), 0, 104 + (k % 2 === 0 ? 3 : -3));
      t.axis = 'x'; t.dir = k % 2 === 0 ? 1 : -1; t.speed = 10;
      t.yaw = t.dir > 0 ? Math.PI / 2 : -Math.PI / 2; t.group.rotation.y = t.yaw;
    }
    // Avenue traffic ahead, in frame: cars driving away on the same road.
    for (let k = 0; k < 4; k++) {
      const t = spawnTrafficCar();
      t.noTurn = true;
      t.group.position.set(k % 2 === 0 ? 3 : -3, 0, 130 + k * 22);
      t.axis = 'z'; t.dir = 1; t.speed = 9;
      t.yaw = 0; t.group.rotation.y = 0;
    }
    G.money = 12500; G.health = 100;
    setObjective('MISSION 2 — Courier Run: deliver the package to the checkpoint (90s)');
    setBeacon(104, -104);
    player.camYaw = Math.PI;
  } else if (SHOT === 'chase') {
    const car = spawnParkedCar();
    car.group.position.set(0, 0, 0);
    car.yaw = 0; car.group.rotation.y = 0;
    playerCar = car;
    player.mesh.visible = false;
    car.speed = 18; car.damage = 55;
    G.money = 8400; G.health = 72;
    G.wanted = 3; G.wantedTimer = 20;
    spawnPoliceCar(); spawnPoliceCar(); spawnPoliceBike();
    for (const c of policeCars) { c.group.position.set(R(-30, 30), 0, R(-30, 30)); }
    setObjective('MISSION 4 — Getaway: ESCAPE to the safehouse!');
    setBeacon(LAND.safehouse.x, LAND.safehouse.z);
    player.camYaw = Math.PI;
  } else if (SHOT === 'mission') {
    // Stage on the road north of the warehouse: player, enemies and camera
    // all on open road, warehouse + gang in frame.
    player.pos.set(LAND.warehouse.x, 0, LAND.warehouse.z + 28);
    player.yaw = Math.PI; // face the warehouse (south)
    player.mesh.position.copy(player.pos);
    player.camYaw = Math.PI;
    for (let k = 0; k < 4; k++) spawnEnemy(LAND.warehouse.x + R(-7, 7), LAND.warehouse.z + 14 + R(-4, 4), 100);
    G.money = 15200; G.health = 85;
    G.weapons.cur = 'smg'; G.weapons.owned.smg = true;
    G.weapons.mag.smg = 30; G.weapons.res.smg = 90;
    setObjective('MISSION 3 — Shakedown: take down 4 gang members! (4 left)');
    setBeacon(LAND.warehouse.x, LAND.warehouse.z);
  }
}

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock();
let saveTimer = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (G.started && !G.paused && !G.over && !G.dialogBusy) {
    updatePlayer(dt);
    updateTraffic(dt);
    updatePeds(dt);
    updatePolice(dt);
    updateEnemies(dt);
    updateMission(dt);
    updateJob(dt);
    updateCash(dt);
    updateWanted(dt);
    updateDayNight(dt);
    updateSmoke(dt);
    beaconCone.position.y = 42 + Math.sin(performance.now() / 300) * 1.5;
    saveTimer += dt;
    if (saveTimer > 15) { saveTimer = 0; saveGame(); }
  }
  updateSky(dt);
  updateTrafficLights(performance.now() / 1000);
  updateCamera(dt);
  if (G.started && !G.paused) { updateHUD(); drawMinimap(); }
  renderer.render(scene, camera);
}
animate();

// Auto-start for screenshot staging (no user gesture in headless).
if (SHOT) {
  G.time = 10.5;
  if (SHOT === 'start') {
    // Keep the title screen; frame a nice view behind it.
    camera.position.set(-40, 26, 120);
    camera.lookAt(0, 0, 0);
  } else {
    startGame(false);
  }
}
