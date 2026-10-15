// 合作内容（Partner / 「合作」卡）：配置 + 聚合点击统计。
// 统计仅为计数器：不存 IP、地址、UA 等任何个人数据；键为「日期|事件|卡片/广告 id|名次|位置」。持久化经 persist.js 同步 D1（kv 表）。
const fs = require('fs'), path = require('path');
const F = path.join(__dirname, 'data', 'ads.json'), PAGE = 100, SLOTS = 20, MAX_KEYS = 20000;
let D = null;
const load = () => D || (D = (() => { try { const j = JSON.parse(fs.readFileSync(F, 'utf8')); return { ads: j.ads || {}, stats: j.stats || {} }; } catch { return { ads: {}, stats: {} }; } })());
let t = null; const save = () => { clearTimeout(t); t = setTimeout(() => { fs.mkdirSync(path.dirname(F), { recursive: true }); fs.writeFileSync(F, JSON.stringify(load()), { mode: 0o600 }); }, 5000); t.unref?.(); }; // 5 秒合并写，降低 D1 写入
const ID = /^[a-z0-9][a-z0-9_-]{1,31}$/, SIG = /^[A-Za-z0-9_-]{8,100}$/, day = (n = Date.now()) => new Date(n).toISOString().slice(0, 10);
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
function norm(b) { // 管理员配置校验；外链必须 https
  const id = String(b.id || '').toLowerCase(); if (!ID.test(id)) return { error: 'id' };
  const a = { id, brand: clean(b.brand, 24), title: clean(b.title, 40), text: clean(b.text, 140), cover: Math.max(0, Math.min(999, Math.floor(+b.cover || 0))), image: '', rank: [1, 2, 3].includes(+b.rank) ? +b.rank : 0, mode: b.mode === 'external' ? 'external' : 'inline', url: '', enabled: b.enabled !== false, until: Math.max(0, Math.floor(+b.until || 0)) };
  if (!a.title || !a.text) return { error: 'text' };
  if (b.image) { if (!/^https:\/\/[^\s"'<>]{4,300}$/.test(String(b.image))) return { error: 'image' }; a.image = String(b.image); }
  if (a.mode === 'external') { let u; try { u = new URL(String(b.url || '')); } catch { return { error: 'url' }; } if (u.protocol !== 'https:' || u.username || u.password) return { error: 'url' }; a.url = u.href.slice(0, 500); }
  return { ad: a }; }
const live = (a, now) => a.enabled && (!a.until || a.until > now);
const pub = a => ({ id: a.id, brand: a.brand, title: a.title, text: a.text, cover: a.cover, image: a.image, rank: a.rank, mode: a.mode, url: a.mode === 'external' ? a.url : '' });
const list = (now = Math.floor(Date.now() / 1000)) => Object.values(load().ads).filter(a => live(a, now)).sort((x, y) => (x.rank || 9) - (y.rank || 9) || x.id.localeCompare(y.id)).map(pub);
// 每页（PAGE 张）最多 SLOTS 个广告位，均匀分布；名次高的广告先占位，广告不足则循环（同一页不重复）。无广告配置时 feed 完全不变。
function slots(ads, count) { const n = Math.min(SLOTS, ads.length, Math.floor(count / 5)); const out = []; for (let i = 0; i < n; i++) out.push({ at: Math.floor((i + 1) * count / (n + 1)), ad: ads[i] }); return out; }
const hits = new Map(); // ip → [窗口起点, 计数]；仅内存，用于限流，不落盘
function limited(ip, max = 90) { const n = Date.now(), h = hits.get(ip); if (!h || n - h[0] > 60000) { hits.set(ip, [n, 1]); if (hits.size > 5000) for (const [k, v] of hits) if (n - v[0] > 60000) hits.delete(k); return false; } return ++h[1] > max; }
function track(b) { const ev = b.ev, S = load().stats, d = day(); if (!['card_click', 'ad_click', 'card_view'].includes(ev)) return { error: 'ev' };
  const id = String(b.id || ''), isAd = /^AD:/.test(id), aid = isAd ? id.slice(3) : ''; if (isAd ? !load().ads[aid] : !SIG.test(id)) return { error: 'id' };
  const bump = k => { if (!(k in S) && Object.keys(S).length >= MAX_KEYS) return; S[k] = (S[k] || 0) + 1; };
  bump(`${d}|${ev}|*`); // 汇总计数（卡片 id 不入库：自然卡只记总数）
  if (isAd) { const rank = [0, 1, 2, 3].includes(+b.rank) ? +b.rank : 0, pos = Math.max(0, Math.min(999, Math.floor(+b.pos) || 0)); bump(`${d}|${ev}|${aid}|r${rank}|p${pos}`); if (ev !== 'ad_click') { /* card_click/card_view on ad also counted above */ } }
  save(); return { ok: true }; }
function summary(days = 7) { const S = load().stats, from = day(Date.now() - days * 864e5), out = {}; for (const [k, v] of Object.entries(S)) if (k.slice(0, 10) >= from) { const [d, ev, ...r] = k.split('|'); (out[ev] ||= {})[r.join('|') || '*'] = (out[ev][r.join('|') || '*'] || 0) + v; } return out; }
function upsert(b) { const r = norm(b); if (r.error) return r; load().ads[r.ad.id] = r.ad; save(); return r; }
function remove(id) { const A = load().ads; const had = !!A[id]; delete A[id]; save(); return had; }
module.exports = { PAGE, SLOTS, list, slots, track, limited, summary, upsert, remove, norm, load, flush: () => { clearTimeout(t); fs.mkdirSync(path.dirname(F), { recursive: true }); fs.writeFileSync(F, JSON.stringify(load()), { mode: 0o600 }); } };
