/* 光栖卡面/门卡文字本地化：底图已去字，按访客语言把文字绘制回卡面（DOM 图片合成 + 3D 纹理共用同一排版） */
(() => {
const R = {"front-01":[[0.3,0.115,0.71,0.235],[0.2,0.745,0.82,0.86]],"front-02":[[0.29,0.135,0.71,0.235],[0.23,0.722,0.78,0.848]],"front-03":[[0.29,0.09,0.69,0.19],[0.23,0.738,0.77,0.84]],"front-04":[[0.2,0.09,0.81,0.216],[0.25,0.734,0.74,0.845]],"front-05":[[0.23,0.115,0.77,0.224],[0.23,0.713,0.77,0.836]],"front-06":[[0.3,0.12,0.7,0.21],[0.22,0.722,0.78,0.831]],"front-07":[[0.26,0.107,0.75,0.22],[0.18,0.708,0.8,0.795],[0.32,0.835,0.7,0.865]],"front-08":[[0.26,0.128,0.74,0.22],[0.22,0.747,0.79,0.815]],"front-09":[[0.24,0.115,0.76,0.225],[0.22,0.756,0.78,0.85]],"front-10":[[0.21,0.7,0.78,0.862]],"back-01":[[0.15,0.555,0.85,0.855]],"back-02":[[0.2,0.435,0.8,0.785]],"back-03":[[0.13,0.6,0.89,0.8]],"back-04":[[0.16,0.54,0.84,0.8]],"back-05":[[0.16,0.585,0.86,0.825]],"back-06":[[0.14,0.538,0.89,0.825]],"back-07":[[0.27,0.48,0.75,0.83]],"back-08":[[0.17,0.565,0.84,0.83]],"back-09":[[0.14,0.585,0.87,0.76]],"back-10":[[0.13,0.63,0.87,0.82]],"gate-first_light":[[0.23,0.045,0.6,0.14],[0.24,0.855,0.76,0.91],[0.31,0.933,0.7,0.966]],"gate-growth":[[0.23,0.04,0.77,0.17],[0.2,0.565,0.27,0.745],[0.73,0.565,0.8,0.745],[0.25,0.905,0.75,0.98]],"gate-resonance":[[0.21,0.045,0.59,0.142],[0.22,0.705,0.79,0.89]]};
const SUB = ['Wish of Reunion', 'Healing Wish', 'Eternal Love', 'Dream Wish', 'Guardian Wish', 'Freedom Wish', 'Wisdom Wish', 'Home Wish', 'Creation Wish', 'Rebirth Wish'];
const GSUB = { first_light: 'First Light', growth: 'Growth Gate', resonance: 'Resonance' };
const GEN = { gr: 'Every step of growth is the light toward the future.', rs: ['RESONANCE GATE CARD', 'When resonance rises, sakura becomes the gate.', 'All things answer, intent becomes the key.'] };
const FT = ['gqf1.t', 'gqf2.t', 'gqf3.t', 'gqf4.t', 'gqf5.t', 'gqf6.t', 'gqf7.t', 'gqf8.t', 'gqf9.t', 'gqf10.t'], F1 = ['gqf1.l1', 'gqf2.l1', 'gqf3.l1', 'gqf4.l1', 'gqf5.l1', 'gqf6.l1', 'gqf7.l1', 'gqf8.l1', 'gqf9.l1', 'gqf10.l1'], F2 = ['gqf1.l2', 'gqf2.l2', 'gqf3.l2', 'gqf4.l2', 'gqf5.l2', 'gqf6.l2', 'gqf7.l2', 'gqf8.l2', 'gqf9.l2', 'gqf10.l2'], FM = ['gqf1.m', 'gqf2.m', 'gqf3.m', 'gqf4.m', 'gqf5.m', 'gqf6.m', 'gqf7.m', 'gqf8.m', 'gqf9.m', 'gqf10.m'], BK = ['gqb1', 'gqb2', 'gqb3', 'gqb4', 'gqb5', 'gqb6', 'gqb7', 'gqb8', 'gqb9', 'gqb10'];
const T = k => (window.t ? window.t(k) : k), lang = () => window.I18N?.lang || 'zh-CN', en = () => /^en/.test(lang());
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
const LAT = 'Georgia,"Noto Serif","Times New Roman"', CJKF = '"Noto Serif SC","Noto Serif CJK SC","Noto Serif JP","Noto Serif KR","Noto Serif CJK KR"', OTH = '"Noto Naskh Arabic","Noto Serif Devanagari","Noto Sans Devanagari","Noto Serif Thai","Noto Sans Thai"';
const FONT = () => (/^(zh|ja|ko)/.test(lang()) ? CJKF + ',' + LAT : LAT + ',' + OTH + ',' + CJKF) + ',serif'; // 拉丁字体优先，避免 ’ 等标点落到 CJK 全角字形
const SEG = {}, seg = (g) => { const k = lang() + g; if (!(k in SEG)) { try { SEG[k] = new Intl.Segmenter(lang(), { granularity: g }); } catch { SEG[k] = null; } } return SEG[k]; };
const words = s => { const sg = seg('word'); return sg ? Array.from(sg.segment(s), x => x.segment) : (CJK.test(s) ? Array.from(s) : s.split(/(\s+)/)); };
const graph = s => { const sg = seg('grapheme'); return sg ? Array.from(sg.segment(s), x => x.segment) : Array.from(s); };
const it = (s, z, b) => s ? { s, z, b } : null;
function blocks(key, tree) { // [{r, items, rot}]
  const rs = R[key]; if (!rs) return []; let m;
  if ((m = /^front-(\d+)$/.exec(key))) { const i = +m[1] - 1, sub = en() ? null : SUB[i], ti = [it(T(FT[i]), 1, 1), it(sub, .42)], ln = [it(T(F1[i]), .8), it(T(F2[i]), .8)], mo = it(T(FM[i]), .95, 1), X = r => [Math.max(.1, r[0] - .05), r[1] - .015, Math.min(.9, r[2] + .05), Math.min(.875, r[3] + .012)];
    if (tree) return [{ r: [.1, rs[0][1] - .02, .9, rs[0][3] + .03], items: [ti[0]] }, { r: [.1, .72, .9, .855], items: [{ ...mo, z: 1 }] }];
    if (rs.length === 1) return [{ r: X(rs[0]), items: [...ln, mo, ...ti.map(x => x && { ...x, z: x.z * .8 })] }];
    if (rs.length === 3) return [{ r: rs[0], items: ti }, { r: [Math.max(.08, rs[1][0] - .06), rs[1][1] - .01, Math.min(.92, rs[1][2] + .06), rs[1][3] + .02], items: ln }, { r: [rs[2][0] - .05, rs[2][1] + .005, rs[2][2] + .05, rs[2][3] + .03], items: [mo] }];
    return [{ r: rs[0], items: ti }, { r: X(rs[1]), items: [...ln, mo] }]; }
  if ((m = /^back-(\d+)$/.exec(key)) && tree) return [{ r: [.12, .6, .88, .85], items: [it(T(FT[+m[1] - 1]), 1, 1), it(T(FM[+m[1] - 1]), .85)], back: 1 }];
  if ((m = /^back-(\d+)$/.exec(key))) { const r = rs[0]; return [{ r: [Math.max(.1, r[0] - .03), r[1] - .025, Math.min(.9, r[2] + .03), Math.min(.88, r[3] + .03)], items: T(BK[+m[1] - 1]).split('\n').map(s => it(s, 1)), back: 1 }]; }
  const g = key.slice(5), sub = en() ? null : GSUB[g];
  if (g === 'first_light') return [{ r: rs[0], items: [it(T('gc.fl.t'), 1, 1), it(sub, .45)] }, { r: rs[1], items: [it(T('gc.fl.l1'), 1), it(T('gc.fl.l2'), 1)] }, { r: rs[2], items: [it(T('gc.fl.m'), 1, 1)] }];
  if (g === 'growth') return [{ r: rs[0], items: [it(T('gc.gr.t'), 1, 1), it(sub, .42)] }, { r: rs[1], items: [it(T('gc.gr.p1'), 1, 1)], rot: 1 }, { r: rs[2], items: [it(T('gc.gr.p2'), 1, 1)], rot: 1 }, { r: rs[3], items: [it(T('gc.gr.l1'), 1, 1), en() ? null : it(GEN.gr, .7)] }];
  if (g === 'resonance') return [{ r: rs[0], items: [it(T('gc.rs.t'), 1, 1), it(sub, .42)] }, { r: rs[1], items: [it(T('gc.rs.h'), 1.15, 1), en() ? null : it(GEN.rs[0], .6), it(T('gc.rs.l1'), .9), it(T('gc.rs.l2'), .9), ...(en() ? [] : [it(GEN.rs[1], .62), it(GEN.rs[2], .62)])] }];
  return []; }
function wrap(x, s, maxW) { // 按宽度断行：CJK 逐字，其余按词（超长词再逐字）
  const toks = words(s), out = []; let cur = '';
  for (const tk of toks) { const nx = cur + tk; if (!cur || x.measureText(nx).width <= maxW) { cur = nx; continue; } out.push(cur.trim()); cur = tk.trimStart(); }
  if (cur.trim()) out.push(cur.trim()); return out.flatMap(l => { if (x.measureText(l).width <= maxW * 1.02) return [l]; const r = []; let c = ''; for (const ch of graph(l)) { if (c && x.measureText(c + ch).width > maxW) { r.push(c); c = ch; } else c += ch; } if (c) r.push(c); return r; }); }
function layout(x, b, W, H) { // 二分求可容纳的最大字号
  const items = b.items.filter(Boolean), r = b.r; let bw = (r[2] - r[0]) * W, bh = (r[3] - r[1]) * H, vert = false;
  if (b.rot) { const s = items[0].s; if (CJK.test(s)) { vert = true; items[0] = { ...items[0], s: Array.from(s.replace(/[·・\s]/g, '')).join('\n') }; } else[bw, bh] = [bh, bw]; }
  const LH = 1.32, run = f => { const ls = []; for (const i of items) { x.font = `${i.b ? 700 : 500} ${f * i.z}px ${FONT()}`; for (const p of i.s.split('\n')) { const w = vert ? [p] : wrap(x, p, bw); if (w.length > 1 && x.measureText(w[w.length - 1]).width < bw * .3) ls.orphan = 1; for (const l of w) ls.push({ t: l, f: f * i.z, b: i.b }); } } return ls; };
  let lo = 4, hi = bh, best = run(lo);
  for (let k = 0; k < 14; k++) { const f = (lo + hi) / 2, ls = run(f), h = ls.reduce((a, l) => a + l.f * LH, 0), wOK = ls.every(l => { x.font = `${l.b ? 700 : 500} ${l.f}px ${FONT()}`; return x.measureText(l.t).width <= bw * 1.02; }); if (h <= bh && wOK && !ls.orphan) { lo = f; best = ls; } else hi = f; }
  return { ls: best, bw, bh, cx: (r[0] + r[2]) / 2 * W, cy: (r[1] + r[3]) / 2 * H, rot: b.rot && !vert, LH }; }
function panel(x, r, dx, dy, W, H) { // 背面：取文字区平均底色画柔边面板，彻底盖住残留原字
  const px = dx + r[0] * W, py = dy + r[1] * H, w = (r[2] - r[0]) * W, h = (r[3] - r[1]) * H; let c = [238, 228, 240];
  try { const d = x.getImageData(px | 0, py | 0, Math.max(1, w | 0), Math.max(1, h | 0)).data; let a = [0, 0, 0], n = 0; for (let i = 0; i < d.length; i += 16) { a[0] += d[i]; a[1] += d[i + 1]; a[2] += d[i + 2]; n++; } c = a.map(v => Math.min(255, v / n + 8) | 0); } catch {}
  x.save(); x.translate(px + w / 2, py + h / 2); x.scale(w * .8, h * .82); const g = x.createRadialGradient(0, 0, 0, 0, 0, 1), C = `${c[0]},${c[1]},${c[2]}`; g.addColorStop(0, `rgba(${C},.96)`); g.addColorStop(.82, `rgba(${C},.93)`); g.addColorStop(1, `rgba(${C},0)`); x.fillStyle = g; x.beginPath(); x.arc(0, 0, 1, 0, 7); x.fill(); x.restore(); }
function plate(x, L, tot) { let mw = 0; for (const l of L.ls) { x.font = `${l.b ? 700 : 500} ${l.f}px ${FONT()}`; mw = Math.max(mw, x.measureText(l.t).width); }
  const pw = mw + 28, ph = tot + 18; x.save(); x.shadowColor = '#1a0f2e'; x.shadowBlur = 22; x.fillStyle = 'rgba(32,20,58,.42)'; x.beginPath(); x.roundRect(-pw / 2, -ph / 2, pw, ph, Math.min(18, ph / 2)); x.fill(); x.restore(); }
function draw(x, key, dx, dy, W, H, tree) { // 在 (dx,dy,W,H) 的卡面区域绘制本地化文字
  const back = /^back-/.test(key); x.save(); x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = /^ar/.test(lang()) ? 'rtl' : 'ltr';
  for (const b of blocks(key, tree)) { const L = layout(x, b, W, H), tot = L.ls.reduce((a, l) => a + l.f * L.LH, 0); x.save(); x.translate(dx + L.cx, dy + L.cy); if (L.rot) x.rotate(Math.PI / 2); let y = -tot / 2;
    if (b.back) plate(x, L, tot); // t249：不再整块雾化遮罩，只在文字块后放一块小的柔边暗色衬底，卡面保持清晰
    for (const l of L.ls) { y += l.f * L.LH / 2; x.font = `${l.b ? 700 : 500} ${l.f}px ${FONT()}`;
      if (back) { x.shadowColor = '#1a0f2ecc'; x.shadowBlur = Math.max(3, l.f * .45); x.fillStyle = '#fff4d6'; }
      else { x.shadowColor = '#000c'; x.shadowBlur = Math.max(2, l.f * .3); const g = x.createLinearGradient(0, y - l.f / 2, 0, y + l.f / 2); g.addColorStop(0, '#fff6d2'); g.addColorStop(.55, '#f2cf7a'); g.addColorStop(1, '#c99740'); x.fillStyle = g; }
      x.fillText(l.t, 0, y); y += l.f * L.LH / 2; }
    x.restore(); }
  x.restore(); }
const RE = /(?:^|\/)(?:themes\/guangqi\/(front|back)-(\d\d)(?:-s)?|gate\/(first_light|growth|resonance))\.webp/;
const keyOf = src => { const m = RE.exec(src || ''); return m ? (m[3] ? 'gate-' + m[3] : m[1] + '-' + m[2]) : null; };
const IM = new Map(), OUT = new Map();
function base(src) { const u = src.replace(/-s\.webp/, '.webp'); if (!IM.has(u)) IM.set(u, new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = u; })); return IM.get(u); }
function compose(src) { const key = keyOf(src), ck = key + '|' + lang(); if (!OUT.has(ck)) OUT.set(ck, base(src).then(async im => { try { await document.fonts?.ready; } catch {} const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d'); x.drawImage(im, 0, 0); draw(x, key, 0, 0, c.width, c.height); return new Promise(ok => c.toBlob(b => ok(URL.createObjectURL(b)), 'image/webp', .9)); })); return OUT.get(ck); }
function fix(img) { const s = img.getAttribute('src'); if (s && keyOf(s)) img.dataset.ctSrc = s; const o = img.dataset.ctSrc; if (!o || (s && s.startsWith('blob:') && img.dataset.ctLang === lang())) return; const L = lang(); img.style.visibility = 'hidden'; compose(o).then(u => { if (img.dataset.ctSrc !== o || lang() !== L) return; img.dataset.ctLang = L; img.src = u; img.style.visibility = ''; }, () => { img.style.visibility = ''; }); }
const scan = (root = document) => root.querySelectorAll?.('img').forEach(i => { if (keyOf(i.getAttribute('src')) || i.dataset.ctSrc) fix(i); });
new MutationObserver(ms => { for (const m of ms) { if (m.type === 'attributes') { const s = m.target.getAttribute('src'); if (keyOf(s)) fix(m.target); } else m.addedNodes.forEach(n => { if (n.nodeType !== 1) return; if (n.tagName === 'IMG') { if (keyOf(n.getAttribute('src'))) fix(n); } else scan(n); }); } }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
addEventListener('langchange', () => scan()); addEventListener('DOMContentLoaded', () => scan());
window.WTCardText = { draw, blocks, keyOf, compose, scan };
})();
