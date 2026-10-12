// 3D 世界树（Three.js + OrbitControls + UnrealBloom）· 参考图风格：虬曲发光古树 + 樱花穹冠 + 金色灯笼愿望卡 + 蓝金螺旋星河 + 星云
// 分层：树核（枝干/花冠/愿望卡）→ 中层螺旋星河 → 外层深空。千亿级：确定性分层地址 + 区域瓦片加载 + 三级 LOD（远：灯笼花团光簇 / 中：InstancedMesh 灯笼 / 近：可交互文字灯笼）
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
THREE.ColorManagement.enabled = false; // 全流程使用“原样”sRGB 数值，保证直出与 bloom 合成颜色一致

let renderer, scene, camera, controls, treeGroup, cardGroup, galaxy, petals, strings, raycaster = new THREE.Raycaster(), ptr = new THREE.Vector2();
let hovered = null, targetScale = 1, onPick = null, slot = null, cards = new Map(), texCache = new Map(), season = 'bloom', galaxyBright = .5;
let composer, bloom, useBloom = false, seasonV = 1; const BU = { uTime: { value: 0 }, uPR: { value: 1 }, uSeason: { value: 1 } }; // 花冠/花瓣共享 uniform
const rng = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const MOBILE = matchMedia('(pointer:coarse)').matches || innerWidth < 700, QS = new URLSearchParams(location.search);
const tr = (k, v) => window.I18N ? I18N.t(k, v) : k; // 国际化（见 i18n.js）
export const SEASONS = { green: { get name() { return tr('season.green'); }, v: 0 }, bloom: { get name() { return tr('season.bloom'); }, v: 1 }, fall: { get name() { return tr('season.fall'); }, v: 2 } };

const A = window.WTAddr, HUES = { 经典: 45, 风景: 200, 人物: 330, 动物: 155, 卡通: 28 };
const MID_CAP = MOBILE ? 3000 : 5000, NEAR_CAP = MOBILE ? 120 : 200, TILE_LRU = 800, COUNT_LRU = 300;
let cfg = { stress: false, total: 0 }, real = [], N = 0, focus = '', view = null, viewSeq = 0, inst, nearPool = [], clusters, labels = [], navEl, hlId = null, lastNav = 0, fly = null, dirty = true, loadTimer = 0;
const tiles = new Map(), countsCache = new Map(), inflight = new Set(), frameT = [];
const lruGet = (m, k) => { const v = m.get(k); if (v !== undefined) { m.delete(k); m.set(k, v); } return v; };
const lruSet = (m, k, v, cap) => { m.set(k, v); while (m.size > cap) m.delete(m.keys().next().value); };
const fmtN = n => { try { return new Intl.NumberFormat(window.I18N?.lang || 'zh-CN', { notation: 'compact', maximumFractionDigits: n >= 1e10 ? 0 : 2 }).format(n); } catch { return String(n); } };
const strHash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h / 4294967296; };
const camDist = () => { const a = camera.aspect || 1.6; return a < 1 ? Math.min(62, 25 / a) : 27; }; // 竖屏拉远以容纳整个花冠
const HOME_DIR = () => new THREE.Vector3(0, .17, 1).normalize();
function init() {
  renderer = new THREE.WebGLRenderer({ antialias: !MOBILE, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.25 : 1.5)); renderer.setClearColor(0x02030b); renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  BU.uPR.value = renderer.getPixelRatio();
  scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x050820, 0.004);
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 3000); camera.position.set(0, 12.6, 27);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 8, 0); controls.enableDamping = true; controls.minDistance = 1.2; controls.maxDistance = 220; controls.zoomToCursor = true; controls.screenSpacePanning = true;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }; // 单指旋转，双指捏合缩放+平移
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  scene.add(new THREE.AmbientLight(0x6070c0, 0.9));
  treeGroup = new THREE.Group(); cardGroup = new THREE.Group(); treeGroup.add(cardGroup); scene.add(treeGroup);
  deepSpace(); makeGalaxy(); makeTrunk(); makeCanopy(); makePetals(); makeInst(); controls.addEventListener('change', scheduleLoad);
  // Bloom：桌面全分辨率；移动端降低强度与内部分辨率，帧时过长时自动关闭（?bloom=0/1 可强制）
  useBloom = QS.get('bloom') ? QS.get('bloom') === '1' : true;
  composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), MOBILE ? .6 : .8, MOBILE ? .4 : .55, .8); composer.addPass(bloom); composer.addPass(new OutputPass());
  let down = null; const el = renderer.domElement; el.style.touchAction = 'none';
  el.addEventListener('pointerdown', e => down = [e.clientX, e.clientY]);
  el.addEventListener('pointerup', e => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 8) pick(e, true); down = null; }); // 轻点 = 射线拾取
  let pmT = 0; el.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && performance.now() - pmT > 50) { pmT = performance.now(); pick(e, false); } });
  el.addEventListener('pointerleave', () => window.WT_hover?.(null));
  new ResizeObserver(resize).observe(document.body); addEventListener('resize', resize); loop();
}
const canvasTex = (w, h, draw) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h); return new THREE.CanvasTexture(cv); };
const glowTex = (() => { let t; return () => t || (t = canvasTex(64, 64, (x) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.3, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); })); })();
const addSprite = (map, color, op, pos, sc, parent = scene) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, color, transparent: true, opacity: op, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  s.position.copy(pos); s.scale.setScalar(sc); parent.add(s); return s; };
function cloudTex(seed, c1, c2) { const r = rng(seed); return canvasTex(256, 256, (x) => { // 程序化星云：大量柔和径向团块叠加
  for (let i = 0; i < 90; i++) { const px = 128 + (r() - .5) * 150 * (1 + r() * .4), py = 128 + (r() - .5) * 110, rad = 18 + r() * 60, g = x.createRadialGradient(px, py, 0, px, py, rad), c = r() < .55 ? c1 : c2;
    g.addColorStop(0, `rgba(${c},${.05 + r() * .12})`); g.addColorStop(1, `rgba(${c},0)`); x.fillStyle = g; x.fillRect(0, 0, 256, 256); }
  for (let i = 0; i < 160; i++) { x.fillStyle = `rgba(255,240,255,${r() * .7})`; x.fillRect(r() * 256, r() * 256, 1, 1); }
  const m = x.createRadialGradient(128, 128, 30, 128, 128, 128); m.addColorStop(0, '#000'); m.addColorStop(1, 'rgba(0,0,0,0)'); x.globalCompositeOperation = 'destination-in'; x.fillStyle = m; x.fillRect(0, 0, 256, 256); }); }
function spiralTex(seed) { const r = rng(seed); return canvasTex(128, 128, (x) => { // 远处小螺旋星系
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 22); g.addColorStop(0, 'rgba(255,240,215,1)'); g.addColorStop(1, 'rgba(255,200,150,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) { const arm = i % 2, t = r(), a = arm * Math.PI + t * 4.2 + (r() - .5) * .5, d = 4 + t * 54; x.fillStyle = `rgba(${200 + r() * 55 | 0},${190 + r() * 50 | 0},255,${(1 - t) * .55})`;
    x.fillRect(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 1.4, 1.4); } }); }
function deepSpace() {
  const n = MOBILE ? 4000 : 11000, pos = new Float32Array(n * 3), at = new Float32Array(n * 3), r = rng(42);
  for (let i = 0; i < n; i++) { const t = r() * Math.PI * 2, p = Math.acos(2 * r() - 1), d = i < n * .85 ? 380 + r() * 600 : 60 + r() * 200;
    pos.set([d * Math.sin(p) * Math.cos(t), d * Math.cos(p), d * Math.sin(p) * Math.sin(t)], i * 3); at.set([.6 + Math.pow(r(), 6) * 3.2, r(), r()], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('at', new THREE.BufferAttribute(at, 3));
  scene.add(new THREE.Points(g, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: BU,
    vertexShader: `attribute vec3 at; uniform float uTime,uPR; varying vec3 vC; varying float vA;
      void main(){ vA=.55+.45*sin(uTime*(.6+at.y*2.)+at.z*60.); vC=mix(vec3(.75,.82,1.),vec3(1.,.88,.75),at.z); gl_PointSize=at.x*uPR*1.6; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ float d=length(gl_PointCoord-.5)*2.; if(d>1.) discard; gl_FragColor=vec4(vC*vA*(1.2-d),1.); }` })));
  // 紫/粉星云（左下、右下、左上、远处）
  [[-190, -45, -120, 230, 1, '150,60,200', '255,110,190', .5], [200, -50, -90, 240, 2, '200,80,190', '120,70,210', .45], [-200, 120, -260, 300, 3, '110,50,190', '60,90,220', .4],
   [130, 150, -380, 340, 4, '255,90,170', '120,60,210', .32], [0, -90, 260, 300, 5, '90,60,200', '200,80,190', .3], [-60, 40, -480, 420, 6, '70,90,230', '160,60,200', .35]]
    .forEach(([x, y, z, s, sd, c1, c2, op]) => addSprite(cloudTex(sd, c1, c2), 0xffffff, op, V(x, y, z), s));
  const r2 = rng(77); for (let i = 0; i < 10; i++) { const th = r2() * Math.PI * 2, el = (r2() - .2) * 1.1, d = 260 + r2() * 220;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: spiralTex(100 + i), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, color: new THREE.Color(1.3, 1.2, 1.2) }));
    m.position.set(Math.cos(el) * Math.cos(th) * d, Math.sin(el) * d + 40, Math.cos(el) * Math.sin(th) * d); m.lookAt(0, 0, 0); m.rotateX((r2() - .5) * 2.2); m.rotateZ(r2() * 6); m.scale.setScalar(26 + r2() * 40); scene.add(m); }
}
function makeGalaxy() { // 蓝金螺旋星河：根部旋涡盘（差速旋转）+ 绕树升起的弧形星流；亮度/密度随卡片数缩放（uDensity 丢弃部分粒子）
  const n = MOBILE ? 9000 : 26000, par = new Float32Array(n * 4), col = new Float32Array(n * 3), r = rng(99);
  const gold = [1.35, .95, .42], blue = [.42, .66, 1.45], white = [1.2, 1.15, 1.3], gs = () => (r() + r() + r() - 1.5);
  for (let i = 0; i < n; i++) { let rad, th, y, sp, c;
    if (i < n * .62) { const arm = i % 4; rad = 1.8 + Math.pow(r(), 1.25) * 30; th = arm * Math.PI / 2 + Math.log(rad) * 2.3 + gs() * .32; y = -.25 + gs() * .25 * (1 + rad / 12) + .5 * Math.exp(-rad / 3);
      sp = .9 / (1 + rad * .18); c = rad < 4.5 ? gold : (arm % 2 ? blue : gold); }
    else { const k = i % 3, u = r(); th = k * 2.1 + .6 + u * 3.6 + gs() * .08; rad = 7 + u * 13 + gs() * .7 + Math.sin(u * 9 + k) * .8; y = .3 + Math.pow(u, 1.15) * 19 + gs() * .6; sp = .045; c = k === 1 ? blue : gold; }
    const m = r() < .12 ? white : c; par.set([rad, th, y, sp], i * 4); col.set(m.map(v => v * (.55 + r() * .6)), i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('par', new THREE.BufferAttribute(par, 4)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(Float32Array.from({ length: n }, () => r()), 1)); g.boundingSphere = new THREE.Sphere(V(0, 8, 0), 40);
  const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: BU.uTime, uBright: { value: .5 }, uDensity: { value: .4 }, uPR: BU.uPR },
    vertexShader: `attribute float seed; attribute vec4 par; attribute vec3 color; uniform float uTime,uDensity,uPR; varying float vA; varying vec3 vC;
      void main(){ vC=color; vA = seed < uDensity ? (0.5+0.5*sin(uTime*(1.0+seed*3.0)+seed*40.0)) : 0.0;
      float th=par.y+uTime*par.w; vec3 p=vec3(cos(th)*par.x, par.z, sin(th)*par.x);
      vec4 mv=modelViewMatrix*vec4(p,1.0); gl_PointSize=(1.6+seed*3.2)*uPR*(80.0/-mv.z); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform float uBright; varying float vA; varying vec3 vC; void main(){ if(vA<=0.0) discard; float d=length(gl_PointCoord-0.5); if(d>0.5) discard; gl_FragColor=vec4(vC*vA*uBright*pow(1.0-d*2.0,1.5),1.); }` });
  galaxy = new THREE.Points(g, m); scene.add(galaxy);
}
// ---------- 树干/树根：多股扭转的管状枝干（自定义 tube），树皮着色器内含金色发光裂纹（根部最亮） ----------
function tubes(list, radial = 8) { const P = [], Nn = [], U = [], I = []; let base = 0;
  for (const o of list) { const c = new THREE.CatmullRomCurve3(o.pts), seg = o.seg || 12, fr = c.computeFrenetFrames(seg, false), len = c.getLength();
    for (let i = 0; i <= seg; i++) { const t = i / seg, p = c.getPointAt(t), rr = o.rf(t), n = fr.normals[i], b = fr.binormals[i];
      for (let j = 0; j <= radial; j++) { const a = j / radial * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), nx = ca * n.x + sa * b.x, ny = ca * n.y + sa * b.y, nz = ca * n.z + sa * b.z, k = 1 + (o.knot != null ? .14 * Math.sin(a * 3 + t * 17 + o.knot) : 0);
        P.push(p.x + nx * rr * k, p.y + ny * rr * k, p.z + nz * rr * k); Nn.push(nx, ny, nz); U.push(t * len, j / radial); } }
    for (let i = 0; i < seg; i++) for (let j = 0; j < radial; j++) { const a = base + i * (radial + 1) + j, b2 = a + radial + 1; I.push(a, b2, a + 1, b2, b2 + 1, a + 1); }
    base += (seg + 1) * (radial + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); return g; }
const NOISE = `float h1(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float ns(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h1(i),h1(i+vec2(1,0)),f.x),mix(h1(i+vec2(0,1)),h1(i+1.),f.x),f.y);}`;
let barkMat; const bark = () => barkMat || (barkMat = new THREE.ShaderMaterial({ uniforms: { uTime: BU.uTime },
  vertexShader: `varying vec3 vP,vN; varying vec2 vUv; void main(){ vUv=uv; vP=position; vN=normal; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform float uTime; varying vec3 vP,vN; varying vec2 vUv; ${NOISE}
    void main(){ vec3 n=normalize(vN); float lam=.3+.7*max(dot(n,normalize(vec3(.35,.75,.55))),0.);
      float st=ns(vec2(vUv.y*12.,vUv.x*1.6))*.6+ns(vec2(vUv.y*36.,vUv.x*5.))*.4;
      vec3 c=mix(vec3(.07,.045,.04),vec3(.30,.19,.12),st)*lam + vec3(.10,.16,.45)*pow(max(-n.y,0.),2.)*.6 + vec3(.25,.14,.3)*pow(1.-abs(n.z),3.)*.25;
      float g=exp(-max(vP.y,0.)*.42)+.08, cr=smoothstep(.6,.78,ns(vec2(vUv.y*8.+vUv.x*.7,vUv.x*2.2-uTime*.06))), pulse=.82+.18*sin(uTime*1.4+vP.y*1.3);
      c+=vec3(1.8,1.12,.38)*cr*g*pulse*1.4 + vec3(.85,.48,.14)*exp(-max(vP.y,0.)*.9)*.55; gl_FragColor=vec4(c,1.); }` }));
function makeTrunk() { const r = rng(11), L = [], S = 12;
  for (let i = 0; i < S; i++) { const a0 = i / S * Math.PI * 2 + r() * .3, tw = 1.5 + r() * .9, pts = [];
    for (let k = 0; k <= 10; k++) { const t = k / 10, rr = .55 + 1.7 * Math.pow(1 - t, 2.4) + .18 * Math.sin(t * 9 + i), sp = t > .78 ? (t - .78) * 4.5 : 0, a = a0 + t * tw;
      pts.push(V(Math.cos(a) * (rr * .72 + sp * 1.3), -.4 + t * 6.9 + sp * .5, Math.sin(a) * (rr * .72 + sp * 1.3))); }
    L.push({ pts, rf: t => .36 + .5 * Math.pow(1 - t, 2) + .05 * Math.sin(t * 20 + i), seg: 44, knot: i }); }
  L.push({ pts: [V(0, -.4, 0), V(.1, 3, -.1), V(0, 6.4, 0)], rf: t => .85 + 1.1 * Math.pow(1 - t, 3), seg: 14 });
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2 + r() * .3, len = 3.5 + r() * 6.5, pts = [];
    for (let k = 0; k <= 8; k++) { const t = k / 8, d = 1.1 + t * len, w = Math.sin(t * 5 + i) * .35 * t; pts.push(V(Math.cos(a + w) * d, .95 * (1 - t) * (1 - t) - .12 - t * .18 + Math.sin(t * 7 + i) * .07, Math.sin(a + w) * d)); }
    L.push({ pts, rf: t => .52 * Math.pow(1 - t, 1.3) + .04, seg: 30, knot: i + 3 });
    const st = pts[3], dir = pts[4].clone().sub(pts[2]).normalize(), side = V(-dir.z, 0, dir.x).multiplyScalar(r() < .5 ? 1 : -1), sub = [];
    for (let k = 0; k <= 4; k++) sub.push(st.clone().addScaledVector(dir, k * .9).addScaledVector(side, k * .7 + Math.sin(k + i) * .2).setY(st.y * (1 - k / 4) - .15));
    L.push({ pts: sub, rf: t => .2 * (1 - t) + .03, seg: 14, knot: i }); }
  const m = new THREE.Mesh(tubes(L, 9), bark()); treeGroup.add(m);
  // 根部隆起的暗色根团 + 金色脉络 + 蓝色星屑
  const dg = new THREE.CircleGeometry(8, 64, 0, Math.PI * 2); dg.rotateX(-Math.PI / 2); const p = dg.attributes.position;
  for (let i = 0; i < p.count; i++) { const d = Math.hypot(p.getX(i), p.getZ(i)); p.setY(i, .85 * Math.pow(Math.max(0, 1 - d / 8), 2.2) - .25); } dg.computeVertexNormals();
  treeGroup.add(new THREE.Mesh(dg, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTime: BU.uTime },
    vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float uTime; varying vec3 vP; ${NOISE} void main(){ float d=length(vP.xz), a=atan(vP.z,vP.x);
      float v=pow(1.-abs(sin(a*11.+d*1.2+sin(d*2.3)*1.2)),14.)+pow(1.-abs(sin(a*23.-d*.8)),26.)*.6;
      float fall=exp(-d*.45), sp=step(.985,h1(floor(vP.xz*18.)))*(.5+.5*sin(uTime*3.+h1(floor(vP.xz*18.))*50.));
      vec3 c=vec3(.03,.035,.09)+vec3(1.6,1.0,.35)*v*fall*(.85+.15*sin(uTime*1.3-d))+vec3(.4,.6,1.4)*sp*(1.-fall)+vec3(.8,.45,.12)*exp(-d*1.2)*.6;
      gl_FragColor=vec4(c, smoothstep(8.,5.,d)*.96); }` })));
  addSprite(glowTex(), new THREE.Color(1.2, .85, .4), .7, V(0, .9, 0), 4.5, treeGroup); addSprite(glowTex(), new THREE.Color(.8, .45, .18), .32, V(0, .6, 0), 12, treeGroup);
}
// ---------- 樱花穹冠：数万个实例化花朵点（着色器绘制五瓣花形），季节由 uSeason 平滑过渡：0 新绿+花苞 / 1 盛放 / 2 飘落稀疏 ----------
let blossomMat; const blossom = () => blossomMat || (blossomMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: BU,
  vertexShader: `attribute vec4 bs; uniform float uTime,uPR,uSeason; varying vec3 vC; varying float vA,vR;
    void main(){ float g=1.-clamp(uSeason,0.,1.), f=clamp(uSeason-1.,0.,1.), bud=step(bs.x,.16);
      vec3 pink=mix(vec3(.74,.3,.55),vec3(1.,.84,.94),bs.w), green=mix(vec3(.12,.42,.18),vec3(.45,.85,.38),bs.w), budc=vec3(1.,.55,.75)*(.7+.3*bs.w);
      vC=mix(pink, mix(green,budc,bud), g); vA = (bs.x > 1.-.5*f) ? 0. : 1.; vR=bs.y;
      vec3 p=position; p.x+=sin(uTime*.7+p.y*.35+bs.y*6.)*.06; p.z+=cos(uTime*.6+p.x*.3)*.05;
      vec4 mv=modelViewMatrix*vec4(p,1.); gl_PointSize=bs.z*uPR*(300./-mv.z)*mix(1.,mix(.95,.55,bud),g); gl_Position=projectionMatrix*mv; }`,
  fragmentShader: `varying vec3 vC; varying float vA,vR; void main(){ if(vA<=0.) discard; vec2 q=gl_PointCoord-.5; float r=length(q)*2., a=atan(q.y,q.x)+vR*6.;
    float pet=.62+.38*abs(cos(a*2.5)); if(r>pet) discard; vec3 c=mix(vC,vec3(1.05,.9,.7),smoothstep(.3,0.,r)*.45); gl_FragColor=vec4(c,.72*(1.-r/pet*.4)); }` }));
function blossomPoints(pts) { const n = pts.length / 5, pos = new Float32Array(n * 3), bs = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { pos.set(pts.slice(i * 5, i * 5 + 3), i * 3); bs.set([pts[i * 5 + 3], (i * 0.618) % 1, pts[i * 5 + 4], .6], i * 4); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('bs', new THREE.BufferAttribute(bs, 4));
  const p = new THREE.Points(g, blossom()); p.renderOrder = 1; return p; }
function makeCanopy() { const r = rng(21), C = V(0, 11.2, 0), RX = 10.8, RY = 6.2, nC = 260, cl = [], out = [], n = MOBILE ? 18000 : 56000, gs = () => (r() + r() + r() - 1.5) / 1.5;
  for (let i = 0; i < nC; i++) { const u = r(), ph = Math.acos(1 - u * 1.25), th = r() * Math.PI * 2, s = .72 + .3 * r();
    cl.push([C.x + Math.sin(ph) * Math.cos(th) * RX * s, C.y + Math.cos(ph) * RY * s - (ph > 1.3 ? (ph - 1.3) * 3 : 0), C.z + Math.sin(ph) * Math.sin(th) * RX * s, 1.3 + r() * 1.3]); }
  for (let i = 0; i < n; i++) { const c = cl[i % nC], ox = gs() * c[3] * .8, oy = gs() * c[3] * .62, oz = gs() * c[3] * .8, y = c[1] + oy;
    const sh = Math.min(1, Math.max(0, .18 + oy / c[3] * .55 + (y - 10) / 9 + (r() - .5) * .35)); // 顶部/外侧更亮（白粉），底部更深（玫粉）
    out.push(c[0] + ox, y, c[2] + oz, r(), (.24 + r() * .24) * (MOBILE ? 1.35 : 1)); out.push; tmpSh.push(sh); }
  const p = blossomPoints(out); const bs = p.geometry.attributes.bs; tmpSh.forEach((v, i) => bs.setW(i, v)); tmpSh.length = 0; treeGroup.add(p);
}
const tmpSh = [];
function makePetals() { // 飘落花瓣（着色器内下落 + 漂移），数量随季节：盛放少量、下旬大量
  const n = MOBILE ? 900 : 2600, pos = new Float32Array(n * 3), r = rng(5);
  for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 13; pos.set([Math.cos(a) * d, r(), Math.sin(a) * d], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(Float32Array.from({ length: n }, () => r()), 1)); g.boundingSphere = new THREE.Sphere(V(0, 8, 0), 20);
  petals = new THREE.Points(g, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: BU,
    vertexShader: `attribute float seed; uniform float uTime,uPR,uSeason; varying float vA,vS;
      void main(){ float amt=clamp(uSeason-.9,0.,1.)*.95+.05*step(.5,uSeason); vA=step(seed,amt); vS=seed; float sp=.35+seed*.5, ph=fract(position.y-uTime*sp/15.);
        vec3 p=vec3(position.x+sin(uTime*.8+seed*30.)*.8*(1.-ph), 15.*ph-.2, position.z+cos(uTime*.6+seed*20.)*.8*(1.-ph));
        vec4 mv=modelViewMatrix*vec4(p,1.); gl_PointSize=(.28+seed*.18)*uPR*(300./-mv.z); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `uniform float uTime; varying float vA,vS; void main(){ if(vA<=0.) discard; vec2 q=gl_PointCoord-.5; float a=uTime*(1.+vS*2.)+vS*9.; q=mat2(cos(a),-sin(a),sin(a),cos(a))*q;
      if(length(q*vec2(1.,2.1))>.5) discard; gl_FragColor=vec4(1.,.72,.86,.85); }` })); petals.renderOrder = 2; treeGroup.add(petals);
}
export function setSeason(s) { if (!SEASONS[s]) return; season = s; seasonV = SEASONS[s].v; }
// ---------- 几何：节点位置只由相对路径决定（以当前焦点为根重建坐标，避免千亿级深度的浮点精度问题） ----------
const V = (x, y, z) => new THREE.Vector3(x, y, z), TRUNK = V(0, 6, 0);
function dirOf(theta, el) { return V(Math.cos(el) * Math.cos(theta), Math.sin(el), Math.cos(el) * Math.sin(theta)); }
function childEnd(reg, j) { const h = strHash(reg + A.HEX[j]), th = j / 16 * Math.PI * 2 + (h - .5) * .35; return { th, p: TRUNK.clone().addScaledVector(dirOf(th, .5 + h * .45), 6) }; }
function grandEnd(reg, j, g) { const c = childEnd(reg, j), h = strHash(reg + A.HEX[j] + A.HEX[g]), th = c.th + (g / 15 - .5) * 2.4; return c.p.clone().addScaledVector(dirOf(th, .15 + h * .7), 3.2); }
function slotPos(P, sz, s) { const k = s >> 2, a = (s & 3) * Math.PI / 2 + k * .45, r = sz * 1.15; return V(P.x + Math.cos(a) * r, P.y - sz * (1.1 + k * 1.2), P.z + Math.sin(a) * r); } // 4 股流苏垂挂，每股 ≤16 张

// ---------- 数据层：瓦片（区域）加载，LRU + 去抖 + 并发限制 ----------
const toUI = (raw, i) => { if (i < real.length) return Object.assign(real[i], { id: i });
  return { ...raw, hue: HUES[raw.cat], likers: new Set(), blessings: Array.from({ length: raw.blessN }, () => ({})), heat: raw.likes * 2 + raw.blessN * 3, sample: true }; };
const key = r => (cfg.stress ? 'S' + N : 'L' + N) + '|' + r;
async function getCounts(r) { const k = key(r), c = lruGet(countsCache, k); if (c) return c;
  let v; if (cfg.stress) { try { v = await (await fetch(`/api/tiles/${r || 'root'}?level=count&total=${N}`)).json(); } catch {} }
  if (!v || v.error) v = { count: A.count(r, N), children: [...A.HEX].map(h => A.count(r + h, N)), grand: r.length < A.DEPTH - 1 ? [...A.HEX].flatMap(a => [...A.HEX].map(b => A.count(r + a + b, N))) : [] };
  lruSet(countsCache, k, v, COUNT_LRU); return v; }
async function fetchTiles(regs) { // 批量拉取卡片瓦片；本地模式直接由真实愿望按序号映射
  if (!cfg.stress) { regs.forEach(r => lruSet(tiles, key(r), A.cardsIn(r, N).map(i => toUI(null, i)), TILE_LRU)); return; }
  regs.forEach(r => inflight.add(key(r)));
  try { const j = await (await fetch(`/api/tiles?level=cards&total=${N}&regions=${regs.join(',')}`)).json();
    j.tiles.forEach(t => lruSet(tiles, key(t.region), t.cards.map(c => toUI(c, c.id)), TILE_LRU)); }
  catch (e) { console.warn('tile load failed', e.message); } finally { regs.forEach(r => inflight.delete(key(r))); } }
function scheduleLoad() { clearTimeout(loadTimer); loadTimer = setTimeout(loadVisible, 150); } // 相机变化去抖
async function loadVisible() { // 只加载当前区域内、视锥中离相机最近的瓦片，直到中景卡片预算
  if (!view) return; const seq = viewSeq, fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const cam = camera.position, sc = treeGroup.scale.x, sph = new THREE.Sphere(), ts = view.hang.map(t => ({ t, w: t.P.clone().add(V(0, -t.sz * (1.1 + 0.6 * Math.ceil(t.count / 4)), 0)).applyMatrix4(treeGroup.matrixWorld) })) // 以整串流苏的包围球做视锥剔除
    .filter(o => fr.intersectsSphere(sph.set(o.w, o.t.sz * sc * (2 + 0.6 * Math.ceil(o.t.count / 4)))) || o.t.hl).sort((a, b) => a.w.distanceTo(cam) - b.w.distanceTo(cam));
  let budget = MID_CAP; const want = [];
  for (const { t } of ts) { if (budget <= 0) break; budget -= t.count; if (!tiles.has(key(t.region)) && !inflight.has(key(t.region))) want.push(t.region); }
  view.active = new Set(ts.filter((o, i) => i < 400).map(o => o.t.region)); view.hang.forEach(t => t.hl && view.active.add(t.region)); dirty = true;
  for (let i = 0; i < want.length && inflight.size < 64; i += 16) { const b = want.slice(i, i + 16); fetchTiles(b).then(() => { if (seq === viewSeq) dirty = true; }); }
}

// ---------- 视图构建：虬曲枝干 / 枝头花簇 / 远景灯笼花团光簇 / 标签 ----------
const bend = (a, b, h, amt) => { const m = a.clone().lerp(b, .5); m.y += amt * (.4 + h * .6); m.x += (h - .5) * amt; m.z += (strHash(String(h)) - .5) * amt; return m; };
async function buildView(reg) {
  const seq = ++viewSeq, c = await getCounts(reg); if (seq !== viewSeq) return;
  treeGroup.children.filter(o => o.userData.branch).forEach(o => { treeGroup.remove(o); o.geometry.dispose(); if (o.material !== barkMat && o.material !== blossomMat) o.material.dispose?.(); });
  labels.forEach(l => { treeGroup.remove(l); l.material.map.dispose(); l.material.dispose(); }); labels = [];
  const L = [], hang = [], clus = [], leafPts = [], thick = .34 + Math.log10(N + 10) * .025;
  c.children.forEach((cn, j) => { if (!cn) return; const { p: ce, th } = childEnd(reg, j), r1 = reg + A.HEX[j], h = strHash(r1), st = V(Math.cos(th) * .5, 5.3 + h * 1.2, Math.sin(th) * .5);
    L.push({ pts: [st, bend(st, ce, h, .9), ce], rf: t => thick * (1 - t * .62), seg: 16, knot: j }); leafPts.push(ce);
    if (cn <= A.HANG) { hang.push({ region: r1, P: ce, sz: N <= 256 ? 1.3 : .6, count: cn }); return; }
    labels.push(makeLabel(`${A.HEX[j]} · ${fmtN(cn)}`, ce, r1));
    for (let g = 0; g < 16; g++) { const gn = c.grand[j * 16 + g]; if (!gn) continue; const ge = grandEnd(reg, j, g), r2 = r1 + A.HEX[g];
      L.push({ pts: [ce, bend(ce, ge, strHash(r2), .45), ge], rf: t => .11 * (1 - t * .6), seg: 6 }); leafPts.push(ge);
      if (gn <= A.HANG) hang.push({ region: r2, P: ge, sz: .24, count: gn }); else clus.push({ region: r2, P: ge, count: gn }); } });
  const mesh = new THREE.Mesh(tubes(L, L.length > 64 ? 5 : 8), bark()); mesh.userData.branch = true; treeGroup.add(mesh);
  const r = rng(7), per = leafPts.length > 64 ? 14 : 70, sp = leafPts.length > 64 ? .7 : 1.5, bp = []; // 枝头花簇（随区域重建）
  leafPts.forEach(t => { for (let k = 0; k < per; k++) bp.push(t.x + (r() - .5) * sp * 2, t.y + (r() - .3) * sp * 1.2, t.z + (r() - .5) * sp * 2, r(), .22 + r() * .25); });
  const lb = blossomPoints(bp); for (let i = 0; i < lb.geometry.attributes.bs.count; i++) lb.geometry.attributes.bs.setW(i, .45 + r() * .5); lb.userData.branch = true; treeGroup.add(lb);
  buildClusters(clus, hang); view = { reg, counts: c, hang, clus, active: new Set() }; nearPool.forEach(s => s.visible = false); dirty = true; renderNav(); scheduleLoad();
}
function buildClusters(clus, hang) { // 远景：每个聚合区域 = 一团金色灯笼核心 + 粉色花瓣光点（大小∝log 数量）；未加载的挂卡区显示暗金占位
  const pts = []; const r = rng(3);
  clus.forEach(o => { const sz = 9 + Math.log10(o.count) * 3, h = strHash(o.region); pts.push([o.P, sz, h, 1, 1]);
    for (let k = 0; k < 12; k++) pts.push([o.P.clone().add(V((r() - .5) * 1.6, (r() - .5) * 1.2, (r() - .5) * 1.6)), 2 + r() * 3.5, r(), .8, 0]);
    for (let k = 0; k < 3; k++) pts.push([o.P.clone().add(V((r() - .5) * 1.2, -.5 - r() * .9, (r() - .5) * 1.2)), 4 + r() * 2, h, .9, 1]); });
  hang.forEach(o => pts.push([o.P, 5 + o.count * .1, strHash(o.region), .4, 1]));
  const n = Math.max(1, pts.length), pos = new Float32Array(n * 3), size = new Float32Array(n), col = new Float32Array(n * 3), seed = new Float32Array(n), kind = new Float32Array(n);
  pts.forEach(([p, s, h, a, k], i) => { pos.set([p.x, p.y, p.z], i * 3); size[i] = s * a; seed[i] = h; kind[i] = k;
    col.set(k ? [.95, .66 + h * .12, .3 + h * .15] : [1.0, .55 + h * .2, .78], i * 3); });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('size', new THREE.BufferAttribute(size, 1)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1)); g.setAttribute('kind', new THREE.BufferAttribute(kind, 1));
  clusters = new THREE.Points(g, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, uniforms: { uTime: BU.uTime, uPR: BU.uPR },
    vertexShader: `attribute float size,seed,kind; attribute vec3 color; uniform float uTime,uPR; varying vec3 vC; varying float vA,vK;
      void main(){ vC=color; vK=kind; vA=.65+.35*sin(uTime*1.7+seed*60.); vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=size*uPR*(22./-mv.z)*(.9+.1*vA); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vC; varying float vA,vK; void main(){ vec2 q=gl_PointCoord-.5; float d=length(q)*2.; if(d>1.) discard;
      float a=pow(1.-d,2.4)*vA, lan=vK*smoothstep(.03,0.,max(abs(q.x)-.07,abs(q.y)-.11)); // 核心：小灯笼形
      gl_FragColor=vec4(vC*a + vec3(1.25,.95,.45)*lan*vA, 1.); }` }));
  clusters.userData.branch = true; clusters.frustumCulled = false; clusters.renderOrder = 4; treeGroup.add(clusters);
}
function makeLabel(text, P, region) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d'); x.fillStyle = 'rgba(20,10,30,.75)'; x.strokeStyle = '#e8b85a'; x.lineWidth = 2; x.beginPath(); x.roundRect(3, 9, 250, 46, 23); x.fill(); x.stroke();
  x.fillStyle = '#ffe2a0'; x.font = 'bold 26px "Noto Sans CJK SC",sans-serif'; x.textAlign = 'center'; x.fillText('🏮 ' + text, 128, 42);
  const t = new THREE.CanvasTexture(c); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  s.position.copy(P).add(V(0, 1.4, 0)); s.scale.set(2.4, .6, 1); s.renderOrder = 5; s.userData.region = region; treeGroup.add(s); return s;
}

// ---------- 中景：InstancedMesh 金色灯笼卡（1 次 draw call，着色器 billboard + 程序化纹样）+ 细吊绳 ----------
const CW = .8, CH = 1.25; // 卡片宽高（相对 sz）
function makeInst() {
  const g = new THREE.PlaneGeometry(1, 1); inst = new THREE.InstancedMesh(g, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTime: BU.uTime },
    vertexShader: `attribute vec3 iPos,iCol; attribute float iSize; varying vec2 vUv; varying vec3 vC; varying float vF;
      void main(){ vUv=uv; vC=iCol; vF=fract(iPos.x*7.13+iPos.z*3.7); vec4 mv=modelViewMatrix*vec4(iPos,1.); mv.xy+=position.xy*vec2(${CW},${CH})*iSize; gl_Position=projectionMatrix*mv; if(iSize<=0.) gl_Position=vec4(2.,2.,2.,1.); }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vC; varying float vF; void main(){ vec2 p=vUv-.5;
      float body=step(abs(p.x),.42)*step(-.44,p.y)*step(p.y,.36), cap=step(abs(p.x),.26)*step(.36,p.y)*step(p.y,.46), ring=step(abs(length(p-vec2(0.,.48))-.03),.012);
      if(body+cap+ring<.5) discard; float e=min(.42-abs(p.x),min(p.y+.44,.36-p.y)); // 到边距离
      float glow=1.-length(p*vec2(1.6,1.))*1.1, pulse=.88+.12*sin(uTime*2.+vF*40.);
      vec3 c=mix(vec3(.85,.52,.18),vec3(1.18,.92,.5),clamp(glow,0.,1.))*pulse;
      float bd=step(e,.035)+step(abs(e-.07),.008); c=mix(c,vec3(1.25,1.0,.6),clamp(bd,0.,1.)*.8); // 双描边
      float lat=step(.9,abs(sin((p.x+p.y)*55.))*abs(sin((p.x-p.y)*55.)))*step(.09,e); c=mix(c,vec3(.55,.28,.08),lat*.35); // 菱格纹
      float ln=step(.5,fract(p.y*9.))*step(abs(p.x),.24)*step(abs(p.y+.04),.24); c=mix(c,vec3(.35,.16,.05),ln*.28); // 文字行示意
      c=mix(c, vC, .14); if(cap>.5) c=vec3(.75,.42,.12)*pulse; if(ring>.5) c=vec3(1.4,1.1,.6);
      gl_FragColor=vec4(c,.97); }` }), MID_CAP);
  ['iPos', 'iCol'].forEach(n => g.setAttribute(n, new THREE.InstancedBufferAttribute(new Float32Array(MID_CAP * 3), 3).setUsage(THREE.DynamicDrawUsage)));
  g.setAttribute('iSize', new THREE.InstancedBufferAttribute(new Float32Array(MID_CAP), 1).setUsage(THREE.DynamicDrawUsage));
  inst.count = 0; inst.frustumCulled = false; inst.userData.cards = []; inst.renderOrder = 3; treeGroup.add(inst);
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MID_CAP * 6), 3).setUsage(THREE.DynamicDrawUsage)); sg.setDrawRange(0, 0);
  strings = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: new THREE.Color(1.0, .78, .42), transparent: true, opacity: .55, depthWrite: false })); strings.frustumCulled = false; strings.renderOrder = 2; treeGroup.add(strings);
  for (let i = 0; i < NEAR_CAP; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false })); s.visible = false; s.renderOrder = 3; nearPool.push(s); cardGroup.add(s); }
}
function rebuildInst() { // 把已加载、处于当前区域的瓦片写入实例缓冲（上限 MID_CAP），同时生成吊绳
  dirty = false; if (!view) return; const g = inst.geometry, P = g.attributes.iPos.array, C = g.attributes.iCol.array, S = g.attributes.iSize.array, SP = strings.geometry.attributes.position.array, list = []; const col = new THREE.Color();
  for (const t of view.hang) { if (!view.active.has(t.region) && view.active.size) continue; const cs = tiles.get(key(t.region)); if (!cs) continue;
    for (let s = 0; s < cs.length && list.length < MID_CAP; s++) { const w = cs[s], p = slotPos(t.P, t.sz, s), n = list.length, top = s < 4 ? t.P : slotPos(t.P, t.sz, s - 4).add(V(0, -CH * t.sz * .44, 0)); list.push({ w, p, sz: t.sz });
      SP.set([top.x, top.y, top.z, p.x, p.y + CH * t.sz * .5, p.z], n * 6);
      P.set([p.x, p.y, p.z], n * 3); col.setHSL(((w.hue ?? 200) % 360) / 360, .85, w.id === hlId ? .85 : .68); C.set([col.r, col.g, col.b], n * 3); S[n] = t.sz * (w.id === hlId ? 1.5 : 1); } }
  inst.count = list.length; inst.userData.cards = list; ['iPos', 'iCol', 'iSize'].forEach(a => g.attributes[a].needsUpdate = true);
  strings.geometry.attributes.position.needsUpdate = true; strings.geometry.setDrawRange(0, list.length * 2); updateNear(true);
}
// ---------- 近景：离相机最近的 ≤200 张卡升级为带文字的可交互灯笼卡 ----------
let nearAt = 0; const wp = new THREE.Vector3();
function updateNear(force) { const now = performance.now(); if (!force && now - nearAt < 250) return; nearAt = now;
  const cards = inst.userData.cards, cam = camera.position, sc = treeGroup.scale.x, cand = [];
  for (let i = 0; i < cards.length; i++) { wp.copy(cards[i].p).multiplyScalar(sc); const d = wp.distanceTo(cam) / (cards[i].sz * sc); if (d < 26 || cards.length <= NEAR_CAP) cand.push([d, i]); } // 卡片总数很少时全部以近景文字卡展示
  cand.sort((a, b) => a[0] - b[0]); const S = inst.geometry.attributes.iSize.array, keep = new Set(cand.slice(0, NEAR_CAP).map(c => c[1]));
  cards.forEach((c, i) => { const want = keep.has(i) ? 0 : c.sz * (c.w.id === hlId ? 1.5 : 1); if (S[i] !== want) { S[i] = want; inst.geometry.attributes.iSize.needsUpdate = true; } });
  let k = 0; for (const i of keep) { const s = nearPool[k++], c = cards[i]; if (s.userData.wish !== c.w) { s.material.map = cardTexture(c.w); s.material.needsUpdate = true; s.userData.wish = c.w; s.userData.grow = s.userData.grow || 0; }
    s.position.copy(c.p); s.userData.sz = c.sz; s.visible = true; const hl = c.w.id === hlId; s.renderOrder = hl ? 6 : 3; s.material.depthTest = !hl; }
  for (; k < nearPool.length; k++) { nearPool[k].visible = false; nearPool[k].userData.wish = null; }
}
function cardTexture(w) { // 金色灯笼签：顶帽 + 吊环 + 渐变内发光 + 双描边与角花 + 文字
  const key = (window.I18N?.lang || '') + '|' + w.sig + '|' + w.likes + '|' + (w.pending ? 1 : 0) + '|' + (w.id === hlId ? 1 : 0); if (texCache.has(key)) return lruGet(texCache, key);
  const c = document.createElement('canvas'); c.width = 192; c.height = 300; const x = c.getContext('2d'), X0 = 16, Y0 = 34, W = 160, H = 252;
  x.fillStyle = '#c98a2c'; x.beginPath(); x.roundRect(52, 14, 88, 22, 6); x.fill(); x.strokeStyle = '#ffe3a0'; x.lineWidth = 3; x.beginPath(); x.arc(96, 9, 7, 0, Math.PI * 2); x.stroke();
  const g = x.createRadialGradient(96, 150, 10, 96, 150, 150), hue = w.pending ? 220 : w.hue;
  g.addColorStop(0, w.pending ? '#b8ccf5' : '#f7dc96'); g.addColorStop(.55, w.pending ? '#7090e0' : '#e0aa48'); g.addColorStop(1, w.pending ? '#2a3a90' : '#9a5814');
  x.fillStyle = g; x.beginPath(); x.roundRect(X0, Y0, W, H, 10); x.fill();
  x.strokeStyle = w.id === hlId ? '#ffffff' : '#fff0c0'; x.lineWidth = w.id === hlId ? 6 : 3; x.stroke(); x.strokeStyle = '#8a4e12'; x.lineWidth = 1.5; x.strokeRect(X0 + 9, Y0 + 9, W - 18, H - 18);
  x.fillStyle = '#8a4e12'; [[X0 + 9, Y0 + 9], [X0 + W - 9, Y0 + 9], [X0 + 9, Y0 + H - 9], [X0 + W - 9, Y0 + H - 9]].forEach(([a, b]) => { x.beginPath(); x.moveTo(a, b - 7); x.lineTo(a + 7, b); x.lineTo(a, b + 7); x.lineTo(a - 7, b); x.fill(); });
  x.fillStyle = `hsl(${hue},80%,45%)`; x.fillRect(X0 + 40, Y0 + 16, W - 80, 4);
  x.fillStyle = '#3a1a06'; x.font = 'bold 19px "Noto Sans CJK SC",sans-serif'; let line = '', y = Y0 + 48;
  for (const ch of w.text) { if (x.measureText(line + ch).width > 124) { x.fillText(line, X0 + 18, y); y += 26; line = ''; if (y > Y0 + 190) { line = '…'; break; } } line += ch; }
  x.fillText(line, X0 + 18, y); x.font = '14px sans-serif'; x.fillText(w.pending ? '⏳ ' + tr('scene.confirming') : '💖 ' + w.likes + ' 🙏 ' + w.blessings.length, X0 + 18, Y0 + H - 34); if (w.id != null) x.fillText('#' + w.id, X0 + 18, Y0 + H - 16);
  const tex = new THREE.CanvasTexture(c); texCache.set(key, tex);
  if (texCache.size > NEAR_CAP * 2) { const used = new Set(nearPool.map(s => s.material.map)); for (const [k, v] of texCache) { if (texCache.size <= NEAR_CAP * 2) break; if (!used.has(v)) { v.dispose(); texCache.delete(k); } } } // GPU 纹理 LRU 释放
  return tex;
}

// ---------- 导航：缩放进入子区 / 拉远返回上级 / 面包屑 / 搜索跳转 ----------
function setFocus(reg, camDir) { focus = reg; const s = treeGroup.scale.x; lastNav = performance.now();
  const d = (camDir || camera.position.clone().sub(controls.target).normalize()).multiplyScalar(camDist() * s); controls.target.set(0, (camera.aspect < 1 ? 5.2 : 6.6) * s, 0); camera.position.copy(controls.target).add(d); buildView(reg); }
function checkNav() { if (!view || fly || performance.now() - lastNav < 900) return; const s = treeGroup.scale.x, dist = camera.position.distanceTo(controls.target);
  if (dist > 72 * s && focus.length) return setFocus(focus.slice(0, -1));
  const cand = []; view.counts.children.forEach((c, j) => { if (c > A.HANG) cand.push([childEnd(focus, j).p.multiplyScalar(s).distanceTo(camera.position), j]); }); cand.sort((a, b) => a[0] - b[0]);
  if (cand[0] && (cand[0][0] < 4.5 * s || dist < 4.2)) setFocus(focus + A.HEX[cand[0][1]]); }
function renderNav() { if (!navEl) return; const parts = [`<button data-nav="">🌳 ${tr('scene.root')}</button>`];
  for (let i = 1; i <= focus.length; i++) parts.push(`<button data-nav="${focus.slice(0, i)}">${focus[i - 1]}</button>`);
  navEl.innerHTML = `<div class=crumbs>${parts.join('›')}${focus ? `<button data-nav="up">⬆ ${tr('scene.up')}</button>` : ''}</div>
    <div class=muted>${cfg.stress ? tr('home.stress') + ' · ' : ''}${tr('scene.stats', { n: fmtN(N), c: fmtN(view?.counts.count ?? 0), d: focus.length, D: A.DEPTH })}</div>`; }
function onNavClick(e) { const b = e.target.closest('[data-nav]'); if (!b) return; const v = b.dataset.nav; setFocus(v === 'up' ? focus.slice(0, -1) : v); }
export async function jumpTo(id) { // 按卡片序号跳转：O(深度) 计算路径，无需加载其它卡片
  id = Math.floor(+id); if (!(id >= 0 && id < N)) return false; const path = A.pathOf(id).region; let h = 1; while (h < A.DEPTH && A.count(path.slice(0, h), N) > A.HANG) h++;
  const reg = path.slice(0, h - 1), hangReg = path.slice(0, h), M = A.B ** h, s = Math.round((id - A.prefixVal(hangReg)) / M);
  hlId = id; if (reg !== focus || !view) { focus = reg; await buildView(reg); }
  const t = view.hang.find(t => t.region === hangReg) || view.hang.find(t => hangReg.startsWith(t.region)); if (!t) return false;
  const p = slotPos(t.P, t.sz, s), sc = 1, tgt = p.clone(), dir = V(p.x, 0, p.z).normalize(); if (!dir.lengthSq()) dir.set(0, 0, 1);
  const s0 = treeGroup.scale.x; fly = { t0: performance.now(), dur: 900, fT: controls.target.clone().divideScalar(s0), fP: camera.position.clone().divideScalar(s0), // 局部坐标插值，避免与对数生长缩放冲突
    tT: tgt, tP: tgt.clone().addScaledVector(dir, 4.2 * t.sz + .4).add(V(0, .5 * t.sz, 0)) };
  view.hang.forEach(x => x.hl = x === t); lastNav = performance.now() + 1500; renderNav(); await fetchTiles([t.region]); dirty = true;
  const w = tiles.get(key(t.region))?.[s]; return w ? { id, region: t.region, slot: s, wish: w } : false;
}
export function cardById(id) { id = +id; if (id < real.length) return toUI(null, id); return toUI(A.synth(id), id); }

export function stage(n) { return n < 10 ? 0 : n < 50 ? 1 : n < 200 ? 2 : n < 1000 ? 3 : 4; }
export function update(wishes, pickCb, opts = {}) { // wishes：真实愿望（新→旧）；序号按时间旧→新，新卡追加不改变旧卡地址
  if (!renderer) init(); onPick = pickCb;
  const r2 = [...wishes].reverse(), nc = { stress: !!opts.stress, total: opts.stress ? Math.min(A.CAPACITY, Math.max(r2.length, Math.floor(+opts.total || 1e11))) : r2.length };
  const changed = nc.stress !== cfg.stress || nc.total !== N || r2.length !== real.length || r2.some((w, i) => real[i].sig !== w.sig || real[i].likes !== w.likes || real[i].pending !== w.pending);
  real = r2; cfg = nc; N = nc.total;
  targetScale = Math.min(2, 0.8 + Math.log2(N + 2) * 0.035); // 树的视觉尺寸随总数对数增长
  galaxyBright = Math.min(1.1, .45 + Math.log2(N + 1) * .03); galaxy.material.uniforms.uDensity.value = Math.min(1, .3 + Math.log10(N + 1) / 11 * .7);
  if (changed) { tiles.clear(); countsCache.clear(); if (A.count(focus, N) <= A.HANG) focus = ''; buildView(focus); } else renderNav();
}
export function attach(el) { slot = el; if (!renderer) init(); el.appendChild(renderer.domElement);
  if (!navEl) { navEl = document.createElement('div'); navEl.className = 'scene-nav'; navEl.addEventListener('click', onNavClick); } el.appendChild(navEl); renderNav(); resize(); }
let framed = false;
function resize() { if (!slot) return; const w = slot.clientWidth || innerWidth, h = slot.clientHeight || innerHeight; renderer.setSize(w, h); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (!framed) { framed = true; const s = treeGroup.scale.x; controls.target.set(0, (camera.aspect < 1 ? 5.2 : 6.6) * s, 0); camera.position.copy(controls.target).addScaledVector(HOME_DIR(), camDist() * s); } }
const scr = (p, r) => { const v = p.clone().applyMatrix4(treeGroup.matrixWorld).project(camera); return v.z > 1 ? null : [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; };
function pick(e, click) {
  const r = renderer.domElement.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ptr, camera); const hit = raycaster.intersectObjects([...nearPool.filter(s => s.visible), ...labels])[0]?.object;
  let w = hit?.userData.wish, reg = hit?.userData.region;
  if (!hit) { let best = 1e9, bc = null; const cards = inst.userData.cards; // 中景卡：屏幕空间最近
    for (let i = 0; i < cards.length; i++) { const s = scr(cards[i].p, r); if (!s) continue; const d = Math.hypot(s[0] - e.clientX, s[1] - e.clientY); if (d < best) { best = d; bc = cards[i]; } }
    if (bc && best < 14) w = bc.w;
    else if (click && view) { best = 1e9; for (const c of view.clus) { const s = scr(c.P, r); if (!s) continue; const d = Math.hypot(s[0] - e.clientX, s[1] - e.clientY); if (d < best) { best = d; reg = c.region; } } if (best > 36) reg = null; } }
  renderer.domElement.style.cursor = w || reg ? 'pointer' : 'grab'; if (!click) hovered = w ? w.sig : null;
  if (click && reg && !w) { window.WT_hover?.(null); return setFocus(reg); }
  if (click && w) { window.WT_hover?.(null); onPick?.(w); } else window.WT_hover?.(w, e);
}
let lastT = performance.now(), pickT = 0, slowN = 0;
function loop() {
  requestAnimationFrame(loop); const now = performance.now(); if (!slot || !slot.isConnected) { lastT = now; return; } // 离开首页时暂停渲染
  const dt = now - lastT; frameT.push(dt); if (frameT.length > 240) frameT.shift(); lastT = now;
  if (MOBILE && useBloom && !QS.get('bloom')) { slowN = dt > 55 ? slowN + 1 : Math.max(0, slowN - 1); if (slowN > 90) { useBloom = false; console.info('bloom disabled (perf)'); } } // 移动端帧时持续过长则关闭 bloom
  const t = now / 1000, s0 = treeGroup.scale.x, s = s0 + (targetScale - s0) * 0.04; treeGroup.scale.setScalar(s); treeGroup.updateMatrixWorld(); // 平滑生长
  if (!fly && Math.abs(s - s0) > 1e-5) { controls.target.multiplyScalar(s / s0); camera.position.multiplyScalar(s / s0); }
  BU.uTime.value = t; BU.uSeason.value += (seasonV - BU.uSeason.value) * (1 - Math.exp(-Math.min(dt, 1000) / 350)); const u = galaxy.material.uniforms; u.uBright.value += (galaxyBright - u.uBright.value) * .03; galaxy.scale.setScalar(s);
  if (fly) { const k = Math.min(1, (now - fly.t0) / fly.dur), e = k * k * (3 - 2 * k); controls.target.lerpVectors(fly.fT, fly.tT, e).multiplyScalar(s); camera.position.lerpVectors(fly.fP, fly.tP, e).multiplyScalar(s); if (k >= 1) { fly = null; scheduleLoad(); } }
  if (dirty) rebuildInst(); else updateNear(false);
  nearPool.forEach(c => { if (!c.visible) return; c.userData.grow = Math.min(1, c.userData.grow + 0.05); const hv = c.userData.wish?.sig === hovered; c.userData.hl = (c.userData.hl || 0) + ((hv ? 1 : 0) - (c.userData.hl || 0)) * .2; // 悬停高亮
    c.material.color.setScalar(.96 + c.userData.hl * .45); const g = c.userData.grow * (1 + c.userData.hl * .25) * c.userData.sz * (c.userData.wish?.id === hlId ? 1.5 : 1); c.scale.set(CW * 1.2 * g, CH * 1.2 * g, 1); });
  if (now - pickT > 200) { pickT = now; checkNav(); }
  controls.update(); if (useBloom) composer.render(); else renderer.render(scene, camera);
}
export function cardScreenPos(i = 0) { // 测试辅助：返回第 i 张近景卡在屏幕上的坐标
  const c = nearPool.filter(s => s.visible)[i]; if (!c) return null; const v = c.getWorldPosition(new THREE.Vector3()).project(camera), r = renderer.domElement.getBoundingClientRect();
  return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }
export function stats() { if (!renderer) return {}; const bl = useBloom; const ft = [...frameT].sort((a, b) => a - b), avg = ft.reduce((a, b) => a + b, 0) / (ft.length || 1);
  return { N, focus, depth: focus.length, fps: +(1000 / avg).toFixed(1), frameAvgMs: +avg.toFixed(2), frameP95Ms: +(ft[Math.floor(ft.length * .95)] || 0).toFixed(2), drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    clusters: view?.clus.length || 0, hangTiles: view?.hang.length || 0, midCards: inst.count, nearCards: nearPool.filter(s => s.visible).length, tilesCached: tiles.size, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries,
    bloom: bl, season, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null }; }
export function camTo(dist) { const d = camera.position.clone().sub(controls.target).setLength(dist * treeGroup.scale.x); camera.position.copy(controls.target).add(d); lastNav = performance.now() + 1e5; scheduleLoad(); } // 测试辅助
export const camInfo = () => ({ cam: camera.position.toArray().map(v => +v.toFixed(2)), target: controls.target.toArray().map(v => +v.toFixed(2)), fly: !!fly, scale: treeGroup.scale.x });
export const resetStats = () => { frameT.length = 0; };
export const descend = r => setFocus(r);
function relabel() { renderNav(); }
window.WT3D = { relabel, cardScreenPos, update, attach, setSeason, stage, SEASONS, jumpTo, cardById, stats, camInfo, resetStats, camTo, descend, addr: A, _dbg: () => ({ scene, camera, treeGroup, renderer }) }; window.dispatchEvent(new Event('wt3d-ready'));
