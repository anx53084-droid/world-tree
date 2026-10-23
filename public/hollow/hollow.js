// t279：树洞 Tree Hollow v1 —— 第一人称门厅（十扇门卡门）+ 初心长廊 + 墙上的匿名光；手机 / 电脑 / WebXR 头显共用同一场景。
// 场景移植自用户提供的 Three.js 树洞（createHollow.ts）：根壁长廊、拱门、符文、火盆、金尘、低频环境音；文案全部走 i18n。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const $ = s => document.querySelector(s), t = (k, v) => (window.I18N ? I18N.t(k, v) : k);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const LOCAL = /^(localhost|127\.|\[::1\])/.test(location.hostname);
const DOORS = ['first', 'sea', 'phoenix', 'lotus', 'star', 'dragon', 'forest', 'crystal', 'wind', 'eternal'];
const ANG = [-14, 14, -42, 42, -70, 70, -98, 98, -126, 126];
// 每扇门的长廊主题：雾色 / 光色 / 金尘 / 花瓣
const THEME = {
  first: { fog: 0x0a0614, light: 0xffc56a, mote: 0xffe2b0, petal: 0xf4a8c4, rune: '#f0c36a', wall: 0xffd7a4 },
  sea: { fog: 0x030a1c, light: 0x7cc4ff, mote: 0xbfe6ff, petal: 0xa8c8f4, rune: '#9fd8ff', wall: 0x9fc8ff },
  phoenix: { fog: 0x140604, light: 0xff8a3c, mote: 0xffc080, petal: 0xffa07a, rune: '#ffb060', wall: 0xffb080 },
  lotus: { fog: 0x0a0a14, light: 0xffe6a8, mote: 0xfff0d0, petal: 0xf8c8dc, rune: '#ffe6a8', wall: 0xffe0c0 },
  star: { fog: 0x050616, light: 0xe8d090, mote: 0xfff4c0, petal: 0xd0c0ff, rune: '#f6e0a0', wall: 0xe0d0b0 },
  dragon: { fog: 0x060a10, light: 0xffd070, mote: 0xffe0a0, petal: 0xf4a8c4, rune: '#ffd070', wall: 0xe8c890 },
  forest: { fog: 0x040a06, light: 0xd8c070, mote: 0xe8ffb0, petal: 0xf4a8c4, rune: '#d8e070', wall: 0xc8d8a0 },
  crystal: { fog: 0x080616, light: 0xe0c8ff, mote: 0xf0e8ff, petal: 0xe0c0ff, rune: '#e0c8ff', wall: 0xe0d0ff },
  wind: { fog: 0x060814, light: 0xf0e0b0, mote: 0xffffff, petal: 0xf4c8d4, rune: '#f0e0b0', wall: 0xe8e0d0 },
  eternal: { fog: 0x0a0804, light: 0xfff0b0, mote: 0xfff8d8, petal: 0xf4a8c4, rune: '#fff0b0', wall: 0xfff0c8 }
};
const HALL_C = new THREE.Vector3(0, 0, -8), HALL_R = 13, HALL_WALK = 11.6, EYE = 1.62, WALK = 3.6, SPRINT = 6.6, CHUNK = 34, DEEP = 22;

// ---------- 网络 ----------
const devId = () => { try { return localStorage.wt_dev ||= (crypto.randomUUID?.() || String(Math.random()).slice(2)); } catch { return ''; } };
async function api(p, data) { const r = await fetch(p, { method: data ? 'POST' : 'GET', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (localStorage.wt_token || ''), 'x-wt-dev': devId() }, body: data ? JSON.stringify(data) : undefined });
  let j = {}; try { j = await r.json(); } catch {} if (!r.ok || j.error) throw Object.assign(new Error(j.code || j.error || r.status), { code: j.code, status: r.status, data: j }); return j; }
const S = { state: null, msgs: [], door: 'first', mode: 'hall', mine: (() => { try { return JSON.parse(localStorage.wt_hollow_mine || '[]'); } catch { return []; } })(), heard: (() => { try { return JSON.parse(localStorage.wt_hollow_heard || '{}'); } catch { return {}; } })() };
const saveMine = () => { try { localStorage.wt_hollow_mine = JSON.stringify(S.mine.slice(-20)); localStorage.wt_hollow_heard = JSON.stringify(S.heard); } catch {} };
let toastT; function toast(s) { const el = $('#toast'); el.textContent = s; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 3200); }
const isOpen = k => k === 'first' || (k === 'sea' && !!S.state?.cards?.includes('sea'));
const status = k => isOpen(k) ? 'open' : k === 'sea' ? 'locked' : 'soon';

// ---------- 画质 ----------
const mobile = matchMedia('(max-width: 820px), (pointer: coarse)').matches;
const weak = (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
let liteUser = null; try { liteUser = localStorage.wt_hollow_lite == null ? null : localStorage.wt_hollow_lite === '1'; } catch {}
let lite = liteUser ?? (mobile && weak) ?? false; if (new URLSearchParams(location.search).get('lite') === '1') lite = true;

// ---------- 渲染器 ----------
let renderer; try { renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' }); } catch { failed(); }
function failed() { $('#bstart').disabled = true; $('#bstart').innerHTML = esc(t('hollow.fail')); throw new Error('webgl'); }
const stage = $('#stage'); stage.appendChild(renderer.domElement);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
renderer.xr.enabled = true;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x05061a); scene.fog = new THREE.FogExp2(0x05061a, 0.022);
const camera = new THREE.PerspectiveCamera(70, 1, 0.08, 220); camera.rotation.order = 'YXZ';
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), mobile ? 0.5 : 0.62, 0.5, 0.82); composer.addPass(bloom); composer.addPass(new OutputPass());
function applyQuality() { renderer.setPixelRatio(lite ? 1 : Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.75)); resize(); $('#blite').setAttribute('aria-pressed', String(lite)); motesMat && (motesMat.size = lite ? 0.06 : 0.045); }
function resize() { const w = innerWidth, h = innerHeight; camera.aspect = w / h; camera.fov = camera.aspect < 0.9 ? 88 : 68; camera.updateProjectionMatrix(); if (!renderer.xr.isPresenting) renderer.setSize(w, h); composer.setSize(w, h); }
addEventListener('resize', resize);

// ---------- 材质 / 贴图 ----------
const loader = new THREE.TextureLoader(), aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const tex = (u, rep) => { const x = loader.load(u); x.colorSpace = THREE.SRGBColorSpace; x.anisotropy = aniso; if (rep) x.wrapS = x.wrapT = THREE.MirroredRepeatWrapping; return x; };
const barkT = tex('hollow/tex/bark.jpg', 1), stoneT = tex('hollow/tex/stone.jpg', 1);
const M = {
  bark: new THREE.MeshStandardMaterial({ map: barkT, emissiveMap: barkT, emissive: 0xffd7a4, emissiveIntensity: 0.75, roughness: 0.92, metalness: 0.04, side: THREE.DoubleSide }),
  ceil: new THREE.MeshStandardMaterial({ map: barkT, color: 0x6a5a48, emissiveMap: barkT, emissive: 0xc8a36a, emissiveIntensity: 0.45, roughness: 1, side: THREE.DoubleSide }),
  stone: new THREE.MeshStandardMaterial({ map: stoneT, emissiveMap: stoneT, emissive: 0xffe0aa, emissiveIntensity: 0.2, roughness: 0.62, metalness: 0.22, side: THREE.DoubleSide }),
  gold: new THREE.MeshStandardMaterial({ color: 0x3a2a12, emissive: 0xffc56a, emissiveIntensity: 1.15, roughness: 0.32, metalness: 0.6 }),
  fire: new THREE.MeshStandardMaterial({ color: 0x3a1406, emissive: 0xff7a2a, emissiveIntensity: 2.2, roughness: 0.45 })
};
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const x = new THREE.CanvasTexture(c); x.colorSpace = THREE.SRGBColorSpace; return x; }
const dotTex = canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 30); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
const petalTex = canvasTex(64, 64, (g) => { g.translate(32, 32); g.rotate(0.6); g.fillStyle = '#fff'; g.beginPath(); g.ellipse(0, 0, 26, 13, 0, 0, Math.PI * 2); g.fill(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(26, 0, 7, 0, Math.PI * 2); g.fill(); });
function runeTex(col) { return canvasTex(128, 512, (g) => { g.strokeStyle = col; g.lineWidth = 3; for (let i = 0; i < 8; i++) { const y = 36 + i * 58; g.globalAlpha = 0.85; g.beginPath(); g.arc(64, y, 16, 0, 7); g.stroke(); g.beginPath(); g.moveTo(64, y - 26); g.lineTo(64, y + 26); g.moveTo(42, y); g.lineTo(86, y); g.stroke(); g.beginPath(); g.arc(64, y, 5, 0, 7); g.stroke(); } }); }
const lightTex = canvasTex(256, 256, (g) => { const r = g.createRadialGradient(128, 128, 0, 128, 128, 126); r.addColorStop(0, 'rgba(255,250,235,1)'); r.addColorStop(0.18, 'rgba(255,220,150,.9)'); r.addColorStop(0.45, 'rgba(255,180,90,.28)'); r.addColorStop(1, 'rgba(255,160,60,0)'); g.fillStyle = r; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,240,200,.9)'; g.lineWidth = 3; g.beginPath(); g.arc(128, 128, 40, 0, 7); g.stroke(); g.beginPath(); g.moveTo(128, 70); g.lineTo(128, 186); g.moveTo(84, 128); g.lineTo(172, 128); g.stroke(); g.beginPath(); g.arc(128, 128, 12, 0, 7); g.stroke(); });
const disp = [];
const T = g => (disp.push(g), g);

// ---------- 灯光 ----------
scene.add(new THREE.HemisphereLight(0x8a7898, 0x140c18, 1.1));
const keyLight = new THREE.PointLight(0xffc56a, 46, 34, 1.4); scene.add(keyLight);
const fillLight = new THREE.PointLight(0xf4a8c4, 6, 18, 2); scene.add(fillLight);

// ---------- 门厅 ----------
const hall = new THREE.Group(); scene.add(hall);
const doorMeshes = [], doorLabels = {}, clickables = [];
function buildHall() {
  const floor = new THREE.Mesh(T(new THREE.CircleGeometry(HALL_R + 1, 64)), M.stone); floor.rotation.x = -Math.PI / 2; floor.position.copy(HALL_C); stoneT.repeat.set(1, 1); hall.add(floor);
  floor.userData.floor = 'hall'; clickables.push(floor);
  const wall = new THREE.Mesh(T(new THREE.CylinderGeometry(HALL_R + 0.6, HALL_R + 0.6, 9, 64, 1, true)), M.bark); wall.position.set(HALL_C.x, 4.5, HALL_C.z); hall.add(wall);
  // 金色根脉圆环
  for (const r of [2.2, 5.5, 9]) { const ring = new THREE.Mesh(T(new THREE.TorusGeometry(r, 0.025, 6, 96)), M.gold); ring.rotation.x = Math.PI / 2; ring.position.set(HALL_C.x, 0.03, HALL_C.z); hall.add(ring); }
  for (let i = 0; i < 10; i++) { const a = (ANG[i] * Math.PI) / 180, c = new THREE.CatmullRomCurve3([new THREE.Vector3(HALL_C.x + Math.sin(a) * 2.2, 0.03, HALL_C.z - Math.cos(a) * 2.2), new THREE.Vector3(HALL_C.x + Math.sin(a + 0.1) * 7, 0.03, HALL_C.z - Math.cos(a + 0.1) * 7), new THREE.Vector3(HALL_C.x + Math.sin(a) * (HALL_R - 1.2), 0.03, HALL_C.z - Math.cos(a) * (HALL_R - 1.2))]);
    hall.add(new THREE.Mesh(T(new THREE.TubeGeometry(c, 16, 0.018, 4, false)), M.gold)); }
  // 星河穹顶（蓝金）
  const n = lite ? 900 : 2200, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), cA = new THREE.Color(0x6fa8ff), cB = new THREE.Color(0xf6d38a), cC = new THREE.Color(0xb48cff);
  for (let i = 0; i < n; i++) { const arm = Math.random() < 0.7, th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.9), r = 16 + Math.random() * 6; let x = Math.sin(ph) * Math.cos(th) * r, z = Math.sin(ph) * Math.sin(th) * r, y = 6 + Math.cos(ph) * r * 0.5;
    if (arm) { const s = Math.random() * 18 - 9; x = s; z = s * 0.35 + (Math.random() - 0.5) * 4; y = 11 + Math.random() * 2; }
    pos.set([HALL_C.x + x, y, HALL_C.z + z], i * 3); const c = (Math.random() < 0.5 ? cA : Math.random() < 0.6 ? cB : cC); col.set([c.r, c.g, c.b], i * 3); }
  const g = T(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  hall.add(new THREE.Points(g, new THREE.PointsMaterial({ map: dotTex, size: 0.22, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
  // 十扇门
  DOORS.forEach((k, i) => { const a = (ANG[i] * Math.PI) / 180, grp = new THREE.Group(), w = 2.3, h = w / 0.711;
    grp.position.set(HALL_C.x + Math.sin(a) * HALL_R, 0, HALL_C.z - Math.cos(a) * HALL_R); grp.lookAt(HALL_C.x, 0, HALL_C.z);
    const mat = new THREE.MeshBasicMaterial({ map: tex('hollow/doors/' + k + '.webp'), toneMapped: false, fog: false }); const face = new THREE.Mesh(T(new THREE.PlaneGeometry(w, h)), mat); face.position.y = h / 2 + 0.15; grp.add(face);
    face.userData.door = k; clickables.push(face); doorMeshes.push(face);
    // 金框 + 尖拱
    const fr = M.gold, jamb = T(new THREE.BoxGeometry(0.1, h + 0.2, 0.12)); for (const sx of [-1, 1]) { const j = new THREE.Mesh(jamb, fr); j.position.set(sx * (w / 2 + 0.06), h / 2 + 0.15, 0.02); grp.add(j); }
    const top = new THREE.Mesh(T(new THREE.BoxGeometry(w + 0.22, 0.1, 0.12)), fr); top.position.set(0, h + 0.27, 0.02); grp.add(top);
    const arch = new THREE.Mesh(T(new THREE.TorusGeometry(w / 2 + 0.06, 0.05, 6, 32, Math.PI)), fr); arch.position.set(0, h + 0.27, 0.02); grp.add(arch);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: k === 'sea' ? 0x7cc4ff : 0xffc56a, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); halo.scale.set(w * 2.2, h * 1.6, 1); halo.position.set(0, h / 2 + 0.2, -0.2); grp.add(halo);
    const lab = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false })); lab.scale.set(2.6, 0.65, 1); lab.position.set(0, h + 1.05, 0.1); grp.add(lab);
    lab.userData.door = k; clickables.push(lab);
    doorLabels[k] = { lab, mat, halo, grp, face };
    hall.add(grp); });
  paintDoors();
  // 火盆
  for (const [x, z] of [[-6, -1.5], [6, -1.5]]) addBrazier(hall, x, z);
}
function paintDoors() { for (const k of DOORS) { const d = doorLabels[k]; if (!d) continue; const st = status(k);
  d.lab.material.map?.dispose(); d.lab.material.map = canvasTex(640, 160, (g, W, H) => { g.textAlign = 'center'; g.fillStyle = 'rgba(8,8,30,.72)'; roundRect(g, 20, 14, W - 40, H - 28, 40); g.fill(); g.strokeStyle = st === 'open' ? '#f6d38a' : '#6b6590'; g.lineWidth = 3; g.stroke();
    g.fillStyle = st === 'open' ? '#ffe9b5' : '#d8d0f0'; fitText(g, t('hollow.door.' + k), W - 90, 46, '600 ', 'Cinzel, Georgia, serif'); g.fillText(t('hollow.door.' + k), W / 2, 74);
    g.fillStyle = st === 'open' ? '#9fe6b0' : st === 'locked' ? '#9fd8ff' : '#bfb8d6'; g.font = '500 28px system-ui, sans-serif'; g.fillText((st === 'open' ? '✦ ' : '🔒 ') + t('hollow.' + st), W / 2, 118); }); d.lab.material.needsUpdate = true;
  d.mat.color.setHex(st === 'open' ? 0xffffff : st === 'locked' ? 0x8090b0 : 0x55506a); d.halo.material.opacity = st === 'open' ? 0.32 : 0; } }
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function fitText(g, s, max, size, w = '', fam = 'system-ui, sans-serif') { let f = size; do { g.font = `${w}${f}px ${fam}`; f -= 2; } while (g.measureText(s).width > max && f > 12); }
function addBrazier(par, x, z) { const g = new THREE.Group(); const ped = new THREE.Mesh(T(new THREE.CylinderGeometry(0.16, 0.28, 0.72, 6)), M.stone); ped.position.y = 0.36;
  const bowl = new THREE.Mesh(T(new THREE.CylinderGeometry(0.28, 0.18, 0.16, 7)), M.gold); bowl.position.y = 0.8; const fire = new THREE.Mesh(T(new THREE.SphereGeometry(0.1, 8, 6)), M.fire); fire.position.y = 0.97; fire.userData.fire = 1;
  g.add(ped, bowl, fire); g.position.set(x, 0, z); par.add(g); return g; }

// ---------- 长廊（移植自原树洞：随深度变宽的根壁、拱门、符文、火盆）----------
const corr = new THREE.Group(); corr.visible = false; scene.add(corr);
const chunks = new Map(); let runeMat = new THREE.MeshBasicMaterial({ map: runeTex('#f0c36a'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
const halfW = s => s <= 0 ? 3.4 : Math.min(9.5, 3.4 + s * 0.045), ceilH = s => Math.min(11, 5.4 + Math.max(0, s) * 0.035);
function strip(s0, s1, nS, nL, place) { const P = [], N = [], U = [], I = [], cols = nL + 1;
  for (let i = 0; i <= nS; i++) { const s = s0 + ((s1 - s0) * i) / nS; for (let j = 0; j <= nL; j++) { const o = place(j / nL, i / nS, s); P.push(o[0], o[1], o[2]); N.push(o[3], o[4], o[5]); U.push(o[6], o[7]); } }
  for (let i = 0; i < nS; i++) for (let j = 0; j < nL; j++) { const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1; I.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); return g; }
function makeArch(x, s, width, height, kind) { const hw = width / 2, pts = [new THREE.Vector3(-hw, 0.08, 0)];
  if (kind === 'round') { const sp = height * 0.58, rise = height - sp; pts.push(new THREE.Vector3(-hw, sp, 0)); for (let i = 0; i <= 14; i++) { const a = Math.PI - (i / 14) * Math.PI; pts.push(new THREE.Vector3(Math.cos(a) * hw, sp + Math.sin(a) * rise, 0)); } pts.push(new THREE.Vector3(hw, 0.08, 0)); }
  else { for (let i = 1; i <= 12; i++) { const q = i / 12; pts.push(new THREE.Vector3(-hw * (1 - q), 0.15 + Math.sin((q * Math.PI) / 2) * height, 0)); } for (let i = 1; i <= 12; i++) { const q = i / 12; pts.push(new THREE.Vector3(hw * q, 0.15 + Math.cos((q * Math.PI) / 2) * height, 0)); } }
  const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 36, 0.14, 5, false), M.bark)); const jg = new THREE.BoxGeometry(0.28, height * 0.62, 0.36);
  for (const sx of [-hw, hw]) { const j = new THREE.Mesh(jg, M.bark); j.position.set(sx, height * 0.31, 0); g.add(j); } g.position.set(x, 0, -s); return g; }
function buildChunk(i) { if (chunks.has(i)) return; const s0 = i === 0 ? -2.5 : i * CHUNK, s1 = (i + 1) * CHUNK, g = new THREE.Group();
  const fl = new THREE.Mesh(strip(s0, s1, 8, 8, (u, v, s) => { const hw = halfW(s), x = -hw + hw * 2 * u; return [x, 0, -s, 0, 1, 0, x * 0.16, s * 0.16]; }), M.stone); fl.userData.floor = 'corr'; clickables.push(fl);
  const L = new THREE.Mesh(strip(s0, s1, 8, 5, (u, v, s) => { const y = ceilH(s) * u, x = -halfW(s) + Math.sin(s * 0.5 + y * 1.2) * 0.42; return [x, y, -s, 1, 0, 0, s * 0.1, y * 0.1]; }), M.bark);
  const R = new THREE.Mesh(strip(s0, s1, 8, 5, (u, v, s) => { const y = ceilH(s) * u, x = halfW(s) - Math.sin(s * 0.47 + y) * 0.42; return [x, y, -s, -1, 0, 0, s * 0.1, y * 0.1]; }), M.bark);
  const C = new THREE.Mesh(strip(s0, s1, 6, 8, (u, v, s) => { const hw = halfW(s) * 0.98, x = -hw + hw * 2 * u, y = ceilH(s) - 0.28 * Math.sin(x * 0.45) * Math.sin(s * 0.35); return [x, y, -s, 0, -1, 0, x * 0.08, s * 0.08]; }), M.ceil);
  g.add(fl, L, R, C);
  for (const s of [s0 + 9, s1 - 8].filter(s => s > 4)) { const span = halfW(s) * 1.6, h = Math.min(ceilH(s) * 0.8, 4.6 + s * 0.01); g.add(makeArch(0, s, span, h, Math.round(s) % 2 ? 'round' : 'point'));
    for (const sd of [-1, 1]) { const sx = sd * span * 0.46, st = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.9, 0.3), M.bark); st.position.set(sx, 1.45, -s); const rn = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 2), runeMat); rn.position.set(sx, 1.7, -s + 0.18); g.add(st, rn); } }
  if (i % 2 === 1 || i === 0) addBrazier(g, (i % 4 < 2 ? -1 : 1) * (halfW(s0 + 14) - 1.2), -(s0 + 14));
  // 盘根
  for (const sd of [-1, 1]) { const s = s0 + CHUNK * 0.5, hw = halfW(s) - 0.4, c = new THREE.CatmullRomCurve3([new THREE.Vector3(sd * hw, 0.1, -(s - 10)), new THREE.Vector3(sd * (hw - 0.4), 1.6, -(s - 3)), new THREE.Vector3(sd * hw, 3.4, -(s + 4)), new THREE.Vector3(sd * (hw - 0.2), ceilH(s) - 0.5, -(s + 11))]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(c, 20, 0.3, 5, false), M.bark)); }
  corr.add(g); chunks.set(i, g); }
function syncChunks(s) { const idx = Math.max(0, Math.floor(s / CHUNK)), keep = new Set(); for (let i = Math.max(0, idx - 1); i <= idx + (lite ? 1 : 2); i++) keep.add(i);
  for (const i of keep) buildChunk(i);
  for (const [i, g] of chunks) if (!keep.has(i)) { corr.remove(g); g.traverse(o => { if (o.geometry) { o.geometry.dispose(); const k = clickables.indexOf(o); if (k >= 0) clickables.splice(k, 1); } }); chunks.delete(i); } }
// 回门厅的门（长廊起点身后）
const backDoor = new THREE.Group(); corr.add(backDoor);
let backFace;
function buildBackDoor(k) { backDoor.clear(); const w = 2.2, h = w / 0.711; backFace = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex('hollow/doors/' + k + '.webp'), toneMapped: false, color: 0xbbbbbb }));
  backFace.position.set(0, h / 2 + 0.1, 2.4); backFace.rotation.y = Math.PI; backFace.userData.back = 1; backDoor.add(backFace);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(9, 8), M.bark); wall.position.set(0, 4, 2.5); backDoor.add(wall); }
// 墙上的光
const lightsG = new THREE.Group(); corr.add(lightsG); const lightSprites = [];
function slot(i) { const side = i % 2 ? 1 : -1, s = DEEP + 6 + i * 5.2, hw = halfW(s); return new THREE.Vector3(side * (hw - 0.75), 1.45 + ((i * 7) % 5) * 0.22, -s); }
function layoutLights() { lightsG.clear(); lightSprites.length = 0; const th = THEME[S.door];
  S.msgs.forEach((m, i) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: lightTex, color: th.light, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    const sc = 0.75 + Math.min(0.7, Math.log2(1 + (m.lights || 0)) * 0.18); sp.scale.set(sc, sc, 1); sp.position.copy(m._pos || slot(i)); sp.userData.msg = m; sp.userData.ph = Math.random() * 6; sp.userData.sc = sc; lightsG.add(sp); lightSprites.push(sp); }); }
function setTheme(k) { const th = THEME[k]; scene.fog.color.setHex(th.fog); scene.background.setHex(th.fog); keyLight.color.setHex(th.light); M.bark.emissive.setHex(th.wall); motesMat.color.setHex(th.mote); petalMat.color.setHex(th.petal);
  runeMat.map.dispose(); runeMat.map = runeTex(th.rune); runeMat.needsUpdate = true; }

// ---------- 粒子：金尘 + 樱花瓣 ----------
const MN = lite ? 260 : 600, motePos = new Float32Array(MN * 3); for (let i = 0; i < MN; i++) motePos.set([(Math.random() - 0.5) * 14, Math.random() * 5, -Math.random() * 30], i * 3);
const moteG = new THREE.BufferGeometry(); moteG.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
const motesMat = new THREE.PointsMaterial({ map: dotTex, color: 0xffe2b0, size: 0.045, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
const motes = new THREE.Points(moteG, motesMat); motes.frustumCulled = false; scene.add(motes);
const PN = lite ? 70 : 160, petPos = new Float32Array(PN * 3), petSeed = new Float32Array(PN); for (let i = 0; i < PN; i++) { petPos.set([(Math.random() - 0.5) * 20, Math.random() * 8, -Math.random() * 26], i * 3); petSeed[i] = Math.random(); }
const petG = new THREE.BufferGeometry(); petG.setAttribute('position', new THREE.BufferAttribute(petPos, 3));
const petalMat = new THREE.PointsMaterial({ map: petalTex, color: 0xf4a8c4, size: 0.16, transparent: true, opacity: 0.85, depthWrite: false, alphaTest: 0.05 });
const petals = new THREE.Points(petG, petalMat); petals.frustumCulled = false; scene.add(petals);

// ---------- 音频（低频环境音）----------
const audio = (() => { let ctx = null, master = null, on = (() => { try { return localStorage.wt_hollow_sound !== '0'; } catch { return true; } })();
  return { get on() { return on; }, start() { if (ctx) return; try { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = on ? 0.14 : 0; master.connect(ctx.destination);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260; const g = ctx.createGain(); g.gain.value = 0.22; g.connect(f); f.connect(master);
      for (const [hz, ty] of [[52, 'sine'], [78, 'triangle'], [104.5, 'sine']]) { const o = ctx.createOscillator(); o.type = ty; o.frequency.value = hz; o.connect(g); o.start(); } } catch {} },
    set(v) { on = v; try { localStorage.wt_hollow_sound = v ? '1' : '0'; } catch {} if (master) master.gain.setTargetAtTime(v ? 0.14 : 0, ctx.currentTime, 0.05); },
    chime() { if (!ctx || !on) return; const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(master); o.start(); o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9); o.stop(ctx.currentTime + 1); } }; })();

// ---------- 玩家 / 输入 ----------
const P = { x: 0, s: -3, yaw: 0, pitch: 0.02 }; let playing = false, panelOpen = false;
const keys = new Set(), joy = { id: -1, ox: 0, oy: 0, dx: 0, dy: 0 }, look = { id: -1, x: 0, y: 0, sx: 0, sy: 0, t: 0, moved: 0 };
addEventListener('keydown', e => { if (panelOpen || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; keys.add(e.code); if (/^(Arrow|Key[WASD]|Space)/.test(e.code)) e.preventDefault(); });
addEventListener('keyup', e => keys.delete(e.code)); addEventListener('blur', () => keys.clear());
const cv = renderer.domElement;
cv.addEventListener('pointerdown', e => { if (!playing || panelOpen) return; const touchLeft = e.pointerType === 'touch' && e.clientX < innerWidth * 0.45;
  if (touchLeft && joy.id < 0) { joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.dx = joy.dy = 0; const j = $('#joy'); j.classList.add('on'); j.style.left = e.clientX + 'px'; j.style.top = (e.clientY - innerHeight) + 'px'; j.style.bottom = 'auto'; j.style.top = ''; j.style.bottom = (innerHeight - e.clientY) + 'px'; }
  else if (look.id < 0) { look.id = e.pointerId; look.x = look.sx = e.clientX; look.y = look.sy = e.clientY; look.t = performance.now(); look.moved = 0; }
  cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', e => { if (e.pointerId === joy.id) { joy.dx = clamp(e.clientX - joy.ox, -56, 56); joy.dy = clamp(e.clientY - joy.oy, -56, 56); $('#knob').style.transform = `translate(${joy.dx}px,${joy.dy}px)`; }
  else if (e.pointerId === look.id) { const dx = e.clientX - look.x, dy = e.clientY - look.y; look.x = e.clientX; look.y = e.clientY; look.moved += Math.abs(dx) + Math.abs(dy); const k = e.pointerType === 'touch' ? 0.0042 : 0.0032; P.yaw -= dx * k; P.pitch = clamp(P.pitch - dy * k, -1.1, 1.1); } });
const endPtr = e => { if (e.pointerId === joy.id) { joy.id = -1; joy.dx = joy.dy = 0; $('#joy').classList.remove('on'); $('#knob').style.transform = ''; }
  if (e.pointerId === look.id) { look.id = -1; if (e.type === 'pointerup' && look.moved < 12 && performance.now() - look.t < 450) tap(e.clientX, e.clientY); } };
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick(origin, dir) { ray.set(origin, dir); ray.camera = camera; ray.far = 40; const list = [...clickables.filter(o => o.visible && isShown(o)), ...lightSprites, ...(backFace && S.mode === 'corr' ? [backFace] : []), ...(vrPanel.visible ? [vrPanel] : [])];
  return ray.intersectObjects(list, false)[0] || null; }
const isShown = o => { let p = o; while (p) { if (!p.visible) return false; p = p.parent; } return true; };
function tap(x, y) { ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); const h = pick(ray.ray.origin.clone(), ray.ray.direction.clone()); if (h) act(h); }
function act(h, vr) { const u = h.object.userData;
  if (h.object === vrPanel) return vrClick(h.uv);
  if (u.door) return vr ? vrDoor(u.door) : openDoor(u.door);
  if (u.msg) return vr ? vrRead(u.msg) : openRead(u.msg);
  if (u.back) return toHall();
  if (u.floor && vr && h.distance < 18) { const p = h.point; if (S.mode === 'hall') { const d = new THREE.Vector2(p.x - HALL_C.x, p.z - HALL_C.z); if (d.length() > HALL_WALK) d.setLength(HALL_WALK); P.x = HALL_C.x + d.x; P.s = -(HALL_C.z + d.y); } else { P.s = Math.max(-0.5, -p.z); P.x = clamp(p.x, -halfW(P.s) + 0.5, halfW(P.s) - 0.5); } } }
function blockedHall(x, s) { const dx = x - HALL_C.x, dz = -s - HALL_C.z; return Math.hypot(dx, dz) > HALL_WALK; }
function move(dt) { let f = 0, r = 0; if (keys.has('KeyW') || keys.has('ArrowUp')) f++; if (keys.has('KeyS') || keys.has('ArrowDown')) f--; if (keys.has('KeyD')) r++; if (keys.has('KeyA')) r--;
  if (keys.has('ArrowLeft')) P.yaw += dt * 1.8; if (keys.has('ArrowRight')) P.yaw -= dt * 1.8;
  if (joy.id >= 0) { const nx = joy.dx / 56, ny = joy.dy / 56; if (Math.hypot(nx, ny) > 0.12) { r += nx; f -= ny; } }
  const xr = xrAxes(); if (xr) { r += xr.x; f -= xr.y; }
  f = clamp(f, -1, 1); r = clamp(r, -1, 1); if (!f && !r) return 0;
  const yaw = renderer.xr.isPresenting ? headYaw() : P.yaw, sp = keys.has('ShiftLeft') || keys.has('ShiftRight') ? SPRINT : WALK;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw); let mx = fx * f + rx * r, mz = fz * f + rz * r; const mag = Math.hypot(mx, mz); if (mag > 1) { mx /= mag; mz /= mag; }
  const nx = P.x + mx * sp * dt, ns = P.s - mz * sp * dt;
  if (S.mode === 'hall') { if (!blockedHall(nx, ns)) { P.x = nx; P.s = ns; } else if (!blockedHall(P.x, ns)) P.s = ns; else if (!blockedHall(nx, P.s)) P.x = nx; checkDoorWalk(); }
  else { P.s = Math.max(-0.6, ns); P.x = clamp(nx, -halfW(P.s) + 0.45, halfW(P.s) - 0.45); }
  return sp; }
let walkCool = 0;
function checkDoorWalk() { if (walkCool > performance.now()) return; for (const k of DOORS) { if (!isOpen(k)) continue; const d = doorLabels[k].grp.position; if (Math.hypot(P.x - d.x, -P.s - d.z) < 1.7) { walkCool = performance.now() + 2000; return enter(k); } } }

// ---------- 场景切换 ----------
let fade = 0, fadeTo = null; const fadeEl = Object.assign(document.createElement('div'), { style: 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:15;transition:opacity .45s' }); document.body.append(fadeEl);
function transition(fn) { fadeEl.style.opacity = 1; setTimeout(() => { fn(); fadeEl.style.opacity = 0; }, renderer.xr.isPresenting ? 0 : 460); }
function enter(k) { if (!isOpen(k)) return openDoor(k); closePanel(); transition(() => { S.mode = 'corr'; S.door = k; hall.visible = false; corr.visible = true; setTheme(k); buildBackDoor(k); for (const [i, g] of chunks) { corr.remove(g); chunks.delete(i); } P.x = 0; P.s = 0.6; P.yaw = 0; P.pitch = 0.02; syncChunks(0); loadMsgs(); ui(); }); }
function toHall() { closePanel(); transition(() => { S.mode = 'hall'; hall.visible = true; corr.visible = false; setTheme('first'); scene.fog.color.setHex(0x05061a); scene.background.setHex(0x05061a); const i = DOORS.indexOf(S.door), a = (ANG[i] * Math.PI) / 180;
  P.x = HALL_C.x + Math.sin(a) * (HALL_R - 3.2); P.s = -(HALL_C.z - Math.cos(a) * (HALL_R - 3.2)); P.yaw = Math.PI - a; P.yaw = -a + Math.PI; P.yaw = Math.atan2(-(HALL_C.x - P.x), -(HALL_C.z + P.s)); walkCool = performance.now() + 2500; ui(); }); }
async function loadMsgs() { try { const r = await api('/api/hollow/msgs?door=' + S.door); S.msgs = r.items || []; } catch { S.msgs = []; toast(t('hollow.offline')); } layoutLights(); }
async function loadState() { try { S.state = await api('/api/hollow/state'); if (S.state.seaNew) toast('✦ ' + t('hollow.seaNew')); } catch { S.state = null; } paintDoors(); }

// ---------- HUD ----------
const DL = [[0, 'd1'], [10, 'd2'], [DEEP, 'd5'], [70, 'd3'], [110, 'd4'], [170, 'd6'], [250, 'd7'], [380, 'd8'], [540, 'd9']];
let lastLine = '';
function ui() { const deep = S.mode === 'corr' && P.s > DEEP - 4; $('#bwrite').hidden = !deep || !playing; $('#bhall').hidden = S.mode !== 'corr' || !playing;
  let k = 'd0'; if (S.mode === 'corr') for (const [at, key] of DL) if (P.s >= at) k = key; const line = t('hollow.' + k);
  if (line !== lastLine) { lastLine = line; $('#depth').textContent = line; } $('#hint').textContent = playing ? (S.mode === 'corr' && deep && !S.msgs.length ? t('hollow.empty') : t(mobile ? 'hollow.hintTouch' : 'hollow.hintDesk')) : ''; }

// ---------- 面板 ----------
const pbox = $('#pbox');
function openPanel(html) { pbox.innerHTML = `<button type=button class=x data-close aria-label="${esc(t('hollow.close'))}">×</button>` + html; $('#panel').hidden = false; panelOpen = true; keys.clear(); pbox.focus(); }
function closePanel() { $('#panel').hidden = true; panelOpen = false; }
$('#panel').addEventListener('click', e => { if (e.target.id === 'panel' || e.target.closest('[data-close]')) closePanel(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && panelOpen) closePanel(); });
const loginUrl = '/';
function doorHtml(k) { const st = status(k), s = S.state, login = !!s?.login, has = s?.cards?.includes(k);
  let body = `<div class=drow><img src="hollow/doors/${k}.webp" alt="" width=112 height=158><div><span class="badge ${st === 'open' ? '' : 'lock'}">${st === 'open' ? '✦ ' : '🔒 '}${esc(t('hollow.' + st))}</span><h2>${esc(t('hollow.door.' + k))}</h2><p class=poem>${esc(t('hollow.poem.' + k))}</p></div></div>`;
  if (k === 'first') { body += `<p class=note>${esc(t('hollow.freeNote'))}</p><div class=btns><button type=button class="pill gold" data-walk=first>${esc(t('hollow.walk'))}</button>${has ? `<span class=badge>✓ ${esc(t('hollow.claimed'))}</span>` : login ? `<button type=button class=pill data-claim=first>${esc(t('hollow.claim'))}</button>` : `<a class=pill href="${loginUrl}">${esc(t('hollow.login'))}</a>`}</div>${login ? '' : `<p class=note>${esc(t('hollow.loginNeed'))}</p>`}<p class=note>${esc(t('hollow.cardNote'))}</p>`; }
  else if (k === 'sea') { const p = s?.sea, n = p?.need || s?.need || { wishes: 3, gave: 5, got: 3 };
    if (has) body += `<p class=note>✦ ${esc(t('hollow.seaDone'))}</p><div class=btns><button type=button class="pill gold" data-walk=sea>${esc(t('hollow.walk'))}</button></div>`;
    body += `<div class=prog id=seaprog><b>${esc(t('hollow.seaTitle'))}</b>${[['wishes', 'seaWishes'], ['gave', 'seaGave'], ['got', 'seaGot']].map(([f, key]) => { const v = Math.min(p?.[f] || 0, n[f]); return `<div class="prow ${v >= n[f] ? 'ok' : ''}" data-f=${f}><div class=lbl><span>${esc(t('hollow.' + key, { n: v, m: n[f] }))}</span><b>${v >= n[f] ? '✓' : ''}</b></div><div class=bar><i style="width:${(v / n[f]) * 100}%"></i></div></div>`; }).join('')}<p class=note>${esc(t('hollow.seaRule'))}</p>${login ? '' : `<p class=note>${esc(t('hollow.loginNeed'))} <a href="${loginUrl}" style="color:var(--gold)">${esc(t('hollow.login'))}</a></p>`}</div><p class=note>${esc(t('hollow.cardNote'))}</p>`; }
  else body += `<p class=note>${esc(t('hollow.soonNote'))}</p>`;
  return body; }
function openDoor(k) { openPanel(doorHtml(k)); }
pbox.addEventListener('click', async e => { const w = e.target.closest('[data-walk]'); if (w) return enter(w.dataset.walk);
  const c = e.target.closest('[data-claim]'); if (c) { c.disabled = true; try { const r = await api('/api/hollow/claim', { card: c.dataset.claim }); S.state.cards = r.cards; toast('✦ ' + t('hollow.claimed')); openDoor(c.dataset.claim); } catch (er) { c.disabled = false; toast(er.status === 401 ? t('hollow.loginNeed') : t('hollow.err')); } return; }
  const h = e.target.closest('[data-heard]'); if (h) return heard(h.dataset.heard, h);
  const rp = e.target.closest('[data-rep]'); if (rp) { $('#repbox').hidden = false; rp.hidden = true; return; }
  const rs = e.target.closest('[data-repsend]'); if (rs) return report(rs.dataset.repsend, rs);
  if (e.target.closest('[data-send]')) return sendMsg(); });
const careHtml = () => `<div class=care role=note>💗 ${esc(t('hollow.care'))} <a href="https://findahelpline.com/" target=_blank rel=noopener>${esc(t('hollow.careLink'))} ↗</a></div>`;
function fmtDate(at) { try { return new Date(at).toLocaleDateString(I18N.lang, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return ''; } }
function readHtml(m) { const mine = S.mine.includes(m.id), done = S.heard[m.id];
  return `<h2>${esc(t('hollow.readTitle'))}</h2><div data-utc><p class=msg>${window.WTTr ? WTTr.span(m.text) : esc(m.text)}</p></div><p class=meta>${esc(t('hollow.anon'))} · ${esc(fmtDate(m.at))} · <span id=hn>${esc(t('hollow.lights', { n: m.lights || 0 }))}</span></p>${m.care ? careHtml() : ''}
  <div class=btns>${mine ? `<span class=badge>✦ ${esc(t('hollow.own'))}</span>` : `<button type=button class="pill gold" data-heard="${esc(m.id)}" ${done ? 'disabled' : ''}>${esc(t(done ? 'hollow.heardDone' : 'hollow.heard'))}</button>`}<button type=button class="pill ghost" data-rep>🚩 ${esc(t('rep.btn'))}</button></div>
  <div id=repbox hidden><p class=note>${esc(t('rep.hint'))}</p><label>${esc(t('rep.reason'))} <select id=rpr>${['spam', 'abuse', 'illegal', 'privacy', 'scam', 'other'].map(r => `<option value=${r}>${esc(t('rep.r.' + r))}</option>`).join('')}</select></label><div class=btns><button type=button class=pill data-repsend="${esc(m.id)}">${esc(t('rep.send'))}</button></div></div>`; }
function openRead(m) { openPanel(readHtml(m)); window.WTTr?.scan?.(pbox); }
async function heard(id, btn) { btn.disabled = true; try { const r = await api('/api/hollow/light', { id }); if (r.own) { toast(t('hollow.own')); return; } S.heard[id] = 1; saveMine(); const m = S.msgs.find(x => x.id === id); if (m) { m.lights = r.n; } btn.textContent = t('hollow.heardDone'); const hn = $('#hn'); if (hn) hn.textContent = t('hollow.lights', { n: r.n }); audio.chime(); pulse(id); }
  catch (er) { btn.disabled = false; toast(er.status === 404 ? t('hollow.err') : t('hollow.err')); } }
function pulse(id) { const sp = lightSprites.find(x => x.userData.msg.id === id); if (sp) sp.userData.boost = 1.6; }
async function report(id, btn) { btn.disabled = true; try { const r = await api('/api/report', { sig: id, reason: $('#rpr').value }); toast(t(r.queued ? 'rep.queued' : 'rep.ok')); closePanel(); } catch (er) { btn.disabled = false; toast(er.status === 401 ? t('rep.needLogin') : t('hollow.err')); } }
let cid = null;
async function openWrite() { openPanel(`<h2>✦ ${esc(t('hollow.writeTitle'))}</h2><p class=note>${esc(t('hollow.writeNote'))}</p><textarea id=hmt maxlength=200 placeholder="${esc(t('hollow.ph'))}"></textarea><div class=cnt id=hmc>0/200</div><p class=note>${esc(t('hollow.writeNote2'))}</p>
  <label class=note id=hcap>…</label> <input type=text id=hans inputmode=numeric size=4 autocomplete=off><div id=hcare></div><div class=btns><button type=button class="pill gold" data-send>${esc(t('hollow.send'))}</button><button type=button class=pill data-close>${esc(t('hollow.cancel'))}</button></div>`);
  $('#hmt').addEventListener('input', e => { $('#hmc').textContent = [...e.target.value].length + '/200'; }); setTimeout(() => $('#hmt')?.focus(), 50);
  try { const c = await api('/api/free/challenge'); cid = c.cid; $('#hcap').textContent = t('hollow.captcha', { q: c.q }); } catch { $('#hcap').textContent = t('hollow.offline'); } }
async function sendMsg() { const text = $('#hmt').value.trim(); if (!text) return $('#hmt').focus(); const b = pbox.querySelector('[data-send]'); b.disabled = true;
  try { const r = await api('/api/hollow/msg', { text, door: S.door, cid, ans: $('#hans').value, dev: devId() }); const m = r.item; S.mine.push(m.id); saveMine();
    m._pos = new THREE.Vector3((P.x > 0 ? 1 : -1) * (halfW(P.s + 3) - 0.75), 1.8, -(P.s + 3)); S.msgs.unshift(m); layoutLights(); audio.chime();
    if (r.care) { openPanel(`<h2>✦ ${esc(t('hollow.sent'))}</h2>${careHtml()}<div class=btns><button type=button class=pill data-close>${esc(t('hollow.close'))}</button></div>`); } else { closePanel(); toast('✦ ' + t('hollow.sent')); } }
  catch (er) { b.disabled = false; const c = er.code, care = er.data?.care; if (care) $('#hcare').innerHTML = careHtml();
    if (c === 'freeCaptcha') { toast(t('hollow.err')); try { const x = await api('/api/free/challenge'); cid = x.cid; $('#hcap').textContent = t('hollow.captcha', { q: x.q }); $('#hans').value = ''; } catch {} }
    else if (c === 'hUsed') { openPanel(`<p class=note style="font-size:15px">${esc(t('hollow.used'))}</p>${care ? careHtml() : ''}<div class=btns><button type=button class=pill data-close>${esc(t('hollow.close'))}</button></div>`); }
    else if (c === 'hFull' || c === 'rate') toast(t('hollow.full')); else if (c === 'reject' || c === 'blockPhish' || c === 'len') toast(t('hollow.reject')); else toast(t('hollow.err')); } }
$('#bwrite').onclick = openWrite; $('#bhall').onclick = toHall;

// ---------- WebXR ----------
const vrPanel = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.75), new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, fog: false, depthTest: false })); vrPanel.visible = false; vrPanel.renderOrder = 10; scene.add(vrPanel);
let vrBtns = [];
function vrShow(title, body, btns) { vrBtns = btns; const W = 1024, H = 640; vrPanel.material.map?.dispose(); vrPanel.material.map = canvasTex(W, H, g => { g.fillStyle = 'rgba(12,10,40,.94)'; roundRect(g, 4, 4, W - 8, H - 8, 36); g.fill(); g.strokeStyle = '#f6d38a'; g.lineWidth = 4; g.stroke();
    g.fillStyle = '#f6d38a'; g.textAlign = 'center'; fitText(g, title, W - 80, 52, '600 ', 'Cinzel, Georgia, serif'); g.fillText(title, W / 2, 84); g.fillStyle = '#f3ecff'; g.font = '30px system-ui, sans-serif';
    const lines = []; for (const para of String(body).split('\n')) { let cur = ''; for (const ch of para.split(/(\s+)/).flatMap(w => w.length > 18 ? [...w] : [w])) { if (g.measureText(cur + ch).width > W - 120) { lines.push(cur.trim()); cur = ch; } else cur += ch; } lines.push(cur.trim()); }
    lines.slice(0, 10).forEach((l, i) => g.fillText(l, W / 2, 150 + i * 40));
    btns.forEach((b, i) => { const bw = 360, x = W / 2 - (btns.length * bw + (btns.length - 1) * 30) / 2 + i * (bw + 30); b.r = [x / W, (H - 130) / H, (x + bw) / W, (H - 40) / H]; g.fillStyle = b.gold ? '#e8be68' : 'rgba(255,255,255,.1)'; roundRect(g, x, H - 130, bw, 90, 45); g.fill(); g.fillStyle = b.gold ? '#2a1606' : '#f6d38a'; fitText(g, b.label, bw - 40, 34, '600 '); g.fillText(b.label, x + bw / 2, H - 73); }); });
  vrPanel.material.needsUpdate = true; const cam = renderer.xr.getCamera(), p = new THREE.Vector3(), q = new THREE.Quaternion(); cam.getWorldPosition(p); cam.getWorldQuaternion(q); const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q); fwd.y = 0; fwd.normalize();
  vrPanel.position.copy(p).addScaledVector(fwd, 1.5); vrPanel.position.y = p.y - 0.1; vrPanel.lookAt(p.x, vrPanel.position.y, p.z); vrPanel.visible = true; }
function vrClick(uv) { const x = uv.x, y = 1 - uv.y; for (const b of vrBtns) if (x >= b.r[0] && x <= b.r[2] && y >= b.r[1] && y <= b.r[3]) { vrPanel.visible = false; return b.fn?.(); } }
function vrDoor(k) { const st = status(k), p = S.state?.sea, n = S.state?.need || { wishes: 3, gave: 5, got: 3 };
  const body = t('hollow.poem.' + k) + '\n\n' + (st === 'open' ? '' : k === 'sea' ? [t('hollow.seaWishes', { n: p?.wishes || 0, m: n.wishes }), t('hollow.seaGave', { n: p?.gave || 0, m: n.gave }), t('hollow.seaGot', { n: p?.got || 0, m: n.got })].join('\n') : t('hollow.soonNote'));
  vrShow(t('hollow.door.' + k) + ' · ' + t('hollow.' + st), body, [...(st === 'open' ? [{ label: t('hollow.walk'), gold: 1, fn: () => enter(k) }] : []), { label: t('hollow.close') }]); }
async function vrRead(m) { let txt = m.text; try { if (window.WTTr?.on?.()) { const r = await fetch('/api/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: I18N.lang, texts: [m.text] }) }).then(r => r.json()); if (r.items?.[0]?.t && !r.items[0].same) txt = r.items[0].t; } } catch {}
  const mine = S.mine.includes(m.id); vrShow(t('hollow.readTitle'), txt + '\n\n' + t('hollow.anon') + ' · ' + t('hollow.lights', { n: m.lights || 0 }) + (m.care ? '\n\n' + t('hollow.care') : ''), [...(mine || S.heard[m.id] ? [] : [{ label: t('hollow.heard'), gold: 1, fn: () => heard(m.id, { set textContent(v) {}, disabled: false }) }]), ...(txt !== m.text ? [{ label: t('tr.showOrig'), fn: () => vrShow(t('hollow.readTitle'), m.text, [{ label: t('hollow.close') }]) }] : []), { label: t('hollow.close') }]); }
const ctrls = [0, 1].map(i => { const c = renderer.xr.getController(i); const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0xf6d38a, transparent: true, opacity: 0.8 })); line.scale.z = 6; c.add(line);
  c.addEventListener('select', () => { const o = new THREE.Vector3(), q = new THREE.Quaternion(); c.getWorldPosition(o); c.getWorldQuaternion(q); const h = pick(o, new THREE.Vector3(0, 0, -1).applyQuaternion(q)); if (h) act(h, true); else vrPanel.visible = false; });
  c.addEventListener('connected', e => { c.userData.src = e.data; }); c.addEventListener('disconnected', () => { c.userData.src = null; }); rig.add(c); return c; });
let snapCool = 0;
function xrAxes() { if (!renderer.xr.isPresenting) return null; const s = renderer.xr.getSession(); let mv = null;
  for (const src of s.inputSources) { const a = src.gamepad?.axes; if (!a) continue; const x = a.length >= 4 ? a[2] : a[0], y = a.length >= 4 ? a[3] : a[1];
    if (src.handedness === 'right') { if (Math.abs(x) > 0.7 && performance.now() > snapCool) { rig.rotation.y -= Math.sign(x) * Math.PI / 6; snapCool = performance.now() + 350; } }
    else if (Math.hypot(x, y) > 0.15) mv = { x, y }; } return mv; }
function headYaw() { const q = new THREE.Quaternion(); renderer.xr.getCamera().getWorldQuaternion(q); return new THREE.Euler().setFromQuaternion(q, 'YXZ').y; }
async function setupVR() { if (!navigator.xr?.isSessionSupported) return; let ok = false; try { ok = await navigator.xr.isSessionSupported('immersive-vr'); } catch {} if (!ok) return; const b = $('#bvr'); b.hidden = false;
  b.onclick = async () => { if (renderer.xr.isPresenting) return renderer.xr.getSession().end(); try { const s = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] }); renderer.xr.setReferenceSpaceType('local-floor'); await renderer.xr.setSession(s); start(); toast(t('hollow.vrHint'));
      s.addEventListener('end', () => { rig.rotation.set(0, 0, 0); vrPanel.visible = false; resize(); }); } catch (e) { toast(t('hollow.err')); } }; }

// ---------- 主循环 ----------
const clock = new THREE.Clock(); let last = 0, fpsN = 0, fpsT = 0, autoLiteChecked = liteUser != null || lite;
function tick(now) { const dt = Math.min(clock.getDelta(), 0.05), el = clock.elapsedTime, xr = renderer.xr.isPresenting;
  if (!xr && lite && now - last < 1000 / 31) return; last = now;
  if (playing && !panelOpen) move(dt);
  if (S.mode === 'corr') syncChunks(P.s);
  rig.position.set(P.x, xr ? 0 : 0, -P.s); if (!xr) { camera.position.set(0, EYE + Math.sin(el * 1.6) * 0.012, 0); camera.rotation.set(P.pitch, P.yaw, 0); } else camera.rotation.order = 'XYZ';
  keyLight.position.set(P.x, 3.2, -P.s - 2.5); fillLight.position.set(P.x - 2, 2, -P.s + 1);
  // 粒子跟随
  const mp = moteG.attributes.position.array; for (let i = 0; i < MN; i++) { let y = mp[i * 3 + 1] + dt * 0.12; if (y > 5.5) y = 0.2; mp[i * 3 + 1] = y; const dz = mp[i * 3 + 2] - -P.s; if (dz > 6) mp[i * 3 + 2] -= 30; else if (dz < -24) mp[i * 3 + 2] += 30; const dx = mp[i * 3] - P.x; if (Math.abs(dx) > 8) mp[i * 3] -= Math.sign(dx) * 16; } moteG.attributes.position.needsUpdate = true;
  const pp = petG.attributes.position.array; for (let i = 0; i < PN; i++) { let y = pp[i * 3 + 1] - dt * (0.25 + petSeed[i] * 0.3); if (y < 0) y = 7.5; pp[i * 3 + 1] = y; pp[i * 3] += Math.sin(el * 0.7 + petSeed[i] * 9) * dt * 0.3; const dz = pp[i * 3 + 2] - -P.s; if (dz > 6) pp[i * 3 + 2] -= 26; else if (dz < -20) pp[i * 3 + 2] += 26; const dx = pp[i * 3] - P.x; if (Math.abs(dx) > 10) pp[i * 3] -= Math.sign(dx) * 20; } petG.attributes.position.needsUpdate = true;
  for (const sp of lightSprites) { const u = sp.userData; u.boost = Math.max(1, (u.boost || 1) - dt * 0.6); const k = u.sc * u.boost * (1 + Math.sin(el * 1.5 + u.ph) * 0.08); sp.scale.set(k, k, 1); }
  for (const k of DOORS) { const d = doorLabels[k]; if (d && isOpen(k)) d.halo.material.opacity = 0.26 + Math.sin(el * 1.4 + k.length) * 0.08; }
  if (playing) { fpsN++; if (now - fpsT > 1000) { if (!autoLiteChecked && liteUser == null && !lite && el > 4) { autoLiteChecked = true; if (fpsN < 28) { lite = true; applyQuality(); toast('⚡ ' + t('hollow.liteTip')); } } fpsN = 0; fpsT = now; } ui(); }
  if (xr || lite) renderer.render(scene, camera); else composer.render(); }

// ---------- 启动 ----------
function start() { if (playing) return; playing = true; $('#intro').classList.add('gone'); audio.start(); $('#bsound').setAttribute('aria-pressed', String(audio.on)); ui(); }
$('#bstart').onclick = start;
$('#blite').onclick = () => { lite = !lite; try { localStorage.wt_hollow_lite = lite ? '1' : '0'; } catch {} autoLiteChecked = true; applyQuality(); toast(t('hollow.liteTip') + (lite ? ' ✓' : ' ✗')); };
$('#bsound').onclick = () => { audio.start(); audio.set(!audio.on); $('#bsound').setAttribute('aria-pressed', String(audio.on)); };
$('#bsound').setAttribute('aria-pressed', String(audio.on));
addEventListener('langchange', () => { paintDoors(); lastLine = ''; ui(); if (panelOpen) closePanel(); });
if (LOCAL) $('#mocklbl').hidden = false;
buildHall(); applyQuality(); setTheme('first'); scene.fog.color.setHex(0x05061a); scene.background.setHex(0x05061a);
renderer.setAnimationLoop(tick); setupVR(); loadState();
const ready = () => { $('#bstart').disabled = false; $('#bstart').innerHTML = esc(t('hollow.start')); $('#ihint').textContent = t(mobile ? 'hollow.hintTouch' : 'hollow.hintDesk'); };
THREE.DefaultLoadingManager.onLoad = ready; setTimeout(ready, 6000);
// 测试钩子（verify-t279 用；不影响用户）
window.__hollow = { scene, S, P, enter, toHall, openDoor, openRead, openWrite, start, get lite() { return lite; }, get mode() { return S.mode; }, lights: () => lightSprites.length, xr: () => renderer.xr.enabled, setPose: (x, s, yaw = 0, pitch = 0.02) => { P.x = x; P.s = s; P.yaw = yaw; P.pitch = pitch; }, tapAt: tap, loadState };
