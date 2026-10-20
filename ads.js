// 合作内容（Partner / 「合作」卡）：配置 + 排名 / 追加出价（top-up）+ 聚合点击统计。
// 规则（详见 docs/ads-ranking.md）：广告卡上链后永久存在，只会随时间后移；商家追加链上价值（出价）来提升排名。
//   得分 score = totalBid × decay，decay = 1 / (1 + rate × hoursOnline)，下限 totalBid × floor；
//   hoursOnline 自「首次上线（第一笔出价确认）」起算；totalBid 跨追加累计；追加后立即重算。
// 统计仅为计数器：不存 IP、地址、UA 等个人数据。持久化经 persist.js 同步 D1（kv 表）。
const fs = require('fs'), path = require('path');
const F = path.join(require('./network').DATA_DIR, 'ads.json'), PAGE = 100, STEP = 5, SLOTS = PAGE / STEP, MAX_KEYS = 20000, LAM = 1e9;
const DEF = { rate: 0.03, floor: 0.1, intervalMin: 15, cap: 3, minTopupSol: 0.01 };
let D = null;
const load = () => D || (D = (() => { try { const j = JSON.parse(fs.readFileSync(F, 'utf8')); return { ads: j.ads || {}, stats: j.stats || {}, cfg: j.cfg || {}, paid: j.paid || {} }; } catch { return { ads: {}, stats: {}, cfg: {}, paid: {} }; } })());
let t = null; const save = () => { clearTimeout(t); t = setTimeout(flush, 5000); t.unref?.(); }; // 5 秒合并写（统计）；出价记录立即写
function flush() { clearTimeout(t); fs.mkdirSync(path.dirname(F), { recursive: true }); fs.writeFileSync(F, JSON.stringify(load()), { mode: 0o600 }); }
const cfg = () => ({ ...DEF, ...load().cfg });
const ID = /^[a-z0-9][a-z0-9_-]{1,31}$/, SIG = /^[A-Za-z0-9_-]{8,100}$/, day = (n = Date.now()) => new Date(n).toISOString().slice(0, 10);
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
function norm(b) { // 内容校验；外链必须 https
  const id = String(b.id || '').toLowerCase(); if (!ID.test(id)) return { error: 'id' };
  const a = { id, brand: clean(b.brand, 24), title: clean(b.title, 40), text: clean(b.text, 140), cover: Math.max(0, Math.min(999, Math.floor(+b.cover || 0))), image: '', mode: b.mode === 'external' ? 'external' : 'inline', url: '', enabled: b.enabled !== false };
  if (!a.title || !a.text) return { error: 'text' };
  if (b.image) { if (!/^https:\/\/[^\s"'<>]{4,300}$/.test(String(b.image))) return { error: 'image' }; a.image = String(b.image); }
  if (a.mode === 'external') { let u; try { u = new URL(String(b.url || '')); } catch { return { error: 'url' }; } if (u.protocol !== 'https:' || u.username || u.password) return { error: 'url' }; a.url = u.href.slice(0, 500); }
  return { ad: a }; }
// ---- 得分 / 排名 ----
const decay = (hours, rate) => 1 / (1 + rate * Math.max(0, hours));
function score(totalLam, launchAt, now, c = cfg()) { const bid = totalLam / LAM; return Math.max(bid * decay((now - launchAt) / 3600, c.rate), bid * c.floor); }
const forecast = (ad, now, c = cfg()) => ({ h24: score(ad.totalBid, ad.launchAt, now + 86400, c), h72: score(ad.totalBid, ad.launchAt, now + 259200, c), d7: score(ad.totalBid, ad.launchAt, now + 604800, c) });
// 全局排名：每个商家只有得分最高的 cap 张参与；按得分降序，同分按上线时间早者在前（再按 id 稳定排序）
function rankAds(ads, now, c = cfg()) { const cmp = (x, y) => y.score - x.score || x.launchAt - y.launchAt || (x.id < y.id ? -1 : 1);
  const all = ads.filter(a => a.enabled && a.totalBid > 0).map(a => ({ id: a.id, owner: a.owner || '', launchAt: a.launchAt, score: score(a.totalBid, a.launchAt, now, c) })).sort(cmp), per = {}, part = [];
  for (const x of all) { const k = x.owner || 'id:' + x.id; per[k] = (per[k] || 0) + 1; if (per[k] <= c.cap) part.push(x); }
  part.forEach((x, i) => x.rank = i + 1); return part; }
let snap = null, dirty = true;
function recompute(now = Math.floor(Date.now() / 1000)) { const part = rankAds(Object.values(load().ads), now); snap = { at: now, part, byId: new Map(part.map(x => [x.id, x])) }; dirty = false; return snap; }
function board(now = Math.floor(Date.now() / 1000)) { if (dirty || !snap || now - snap.at >= cfg().intervalMin * 60) recompute(now); return snap; } // 定时重算（默认 15 分钟）+ 追加后立即重算
const markDirty = () => { dirty = true; };
const pub = (a, rank) => ({ id: a.id, brand: a.brand, title: a.title, text: a.text, cover: a.cover, image: a.image, rank: rank || 0, mode: a.mode, url: a.mode === 'external' ? a.url : '' });
const rankInfo = (a, now, S = board(now)) => { const r = S.byId.get(a.id); return { rank: r ? r.rank : 0, page: r ? Math.ceil(r.rank / SLOTS) : 0, pos: r ? ((r.rank - 1) % SLOTS + 1) * STEP : 0, participates: !!r }; };
// 第 p 页的广告位：位置 5,10,…,100（每页 20 个），第 p 页取全局名次 (p-1)*20+1 … p*20；名次不足的位置由自然卡填充（客户端按现有顺序补齐）
function pageSlots(p, now) { const S = board(now), A = load().ads, out = []; p = Math.max(1, Math.floor(p) || 1);
  for (let k = 1; k <= SLOTS; k++) { const r = S.part[(p - 1) * SLOTS + k - 1]; if (r) out.push({ pos: k * STEP, rank: r.rank, ad: pub(A[r.id], r.rank) }); }
  return { page: p, slots: out, ranked: S.part.length, hasMoreAds: S.part.length > p * SLOTS, recomputedAt: S.at }; }
const one = (id, now) => { const a = load().ads[id]; if (!a || !a.enabled) return null; return pub(a, rankInfo(a, now).rank); };
// ---- 出价 ----
let verifier = async () => null; const setVerifier = fn => { verifier = fn; };
const minLam = () => Math.round(cfg().minTopupSol * LAM);
const inflight = new Set();
// 记账：幂等（同一笔交易签名只记一次）；owner 必须与广告所有者一致；金额 ≥ 最小追加额
function creditLocal(adId, owner, sig, lam, at, kind) { const d = load(), a = d.ads[adId];
  if (d.paid[sig]) return { ok: true, dup: true, ad: a && view(a, at) };
  if (!a) return { error: 'nf' }; if ((a.owner || '') !== owner) return { error: 'owner' }; if (!(lam >= minLam())) return { error: 'amount' };
  a.totalBid += lam; a.bids.push({ sig, lamports: lam, at, kind }); d.paid[sig] = adId; markDirty(); flush(); const nv = view(a, at); return { ok: true, dup: false, ad: nv }; }
async function credit(adId, owner, sig, kind = 'topup', now = Math.floor(Date.now() / 1000)) {
  if (!SIG.test(String(sig || ''))) return { error: 'sig' }; const d = load(); if (d.ads[adId] && (d.ads[adId].owner || '') !== owner) return { error: 'owner' }; if (d.paid[sig]) return d.paid[sig] === adId ? creditLocal(adId, owner, sig, 0, now, kind) : { error: 'used' };
  if (inflight.has(sig)) return { error: 'busy' }; inflight.add(sig);
  try { const a = d.ads[adId]; if (!a) return { error: 'nf' }; if ((a.owner || '') !== owner) return { error: 'owner' };
    const v = await verifier(sig, owner); if (!v) return { error: 'verify' }; return creditLocal(adId, owner, sig, v.lamports, v.time || now, kind); }
  finally { inflight.delete(sig); } }
// 首次上线：支付确认后创建广告（内容审核由调用方先完成）；launchAt = 首笔出价确认时间
async function launch(owner, content, sig, now = Math.floor(Date.now() / 1000)) { const r = norm(content); if (r.error) return r; const d = load();
  if (d.paid[sig]) return { error: 'used' }; if (d.ads[r.ad.id]) return { error: 'exists' }; if (!SIG.test(String(sig || ''))) return { error: 'sig' };
  if (inflight.has(sig)) return { error: 'busy' }; inflight.add(sig);
  try { const v = await verifier(sig, owner); if (!v) return { error: 'verify' }; if (!(v.lamports >= minLam())) return { error: 'amount' }; if (d.ads[r.ad.id]) return { error: 'exists' };
    const at = v.time || now; d.ads[r.ad.id] = { ...r.ad, owner, launchAt: at, createdAt: at, totalBid: 0, bids: [] }; return creditLocal(r.ad.id, owner, sig, v.lamports, at, 'launch'); }
  finally { inflight.delete(sig); } }
function view(a, now) { const S = board(now), ri = rankInfo(a, now, S), c = cfg(); return { id: a.id, brand: a.brand, title: a.title, text: a.text, cover: a.cover, image: a.image, mode: a.mode, enabled: a.enabled, ...ri,
  score: score(a.totalBid, a.launchAt, now, c), totalBid: a.totalBid / LAM, launchAt: a.launchAt, bids: a.bids.length, forecast: forecast(a, now, c) }; }
const mine = (owner, now = Math.floor(Date.now() / 1000)) => { const c = cfg(), S = board(now); return { cfg: { rate: c.rate, floor: c.floor, intervalMin: c.intervalMin, cap: c.cap, minTopupSol: c.minTopupSol }, now, recomputedAt: S.at, board: S.part.map(x => +x.score.toFixed(6)),
  ads: Object.values(load().ads).filter(a => owner && a.owner === owner).sort((x, y) => x.launchAt - y.launchAt).map(a => view(a, now)) }; };
// 预估追加后的名次：按当前得分板计算（不含自己），仅为估算
function estimate(ad, addSol, board_, now, c) { const nb = (ad.totalBid + addSol) , sc = score(Math.round(nb * LAM), ad.launchAt, now, c); return { score: sc, rank: 1 + board_.filter(s => s > sc).length }; }
// ---- 管理 ----
function setConfig(b) { const o = {}, num = (k, lo, hi, int) => { if (b[k] == null) return; const v = +b[k]; if (!(v >= lo && v <= hi) || (int && !Number.isInteger(v))) throw Object.assign(new Error(k), { code: k }); o[k] = v; };
  num('rate', 0, 10); num('floor', 0, 1); num('intervalMin', 1, 1440, true); num('cap', 1, 100, true); num('minTopupSol', 0.000001, 1000); Object.assign(load().cfg, o); markDirty(); flush(); return cfg(); }
function upsert(b, adminBidSol) { const r = norm(b); if (r.error) return r; const d = load(), old = d.ads[r.ad.id], now = Math.floor(Date.now() / 1000);
  const a = old ? { ...old, ...r.ad } : { ...r.ad, owner: '', launchAt: now, createdAt: now, totalBid: 0, bids: [] }; if (b.owner != null) a.owner = String(b.owner).slice(0, 100); d.ads[a.id] = a;
  if (adminBidSol > 0) { const lam = Math.round(adminBidSol * LAM), sig = 'admin-' + a.id + '-' + now + '-' + a.bids.length; a.totalBid += lam; a.bids.push({ sig, lamports: lam, at: now, kind: 'admin' }); d.paid[sig] = a.id; } // 运营授予的演示出价，非链上支付
  markDirty(); flush(); return { ad: a }; }
function remove(id) { const A = load().ads; const had = !!A[id]; delete A[id]; markDirty(); flush(); return had; } // 仅运营下架违规内容（广告本身不会因时间而消失）
const adminList = (now = Math.floor(Date.now() / 1000)) => ({ cfg: cfg(), recomputedAt: board(now).at, ads: Object.values(load().ads).map(a => ({ ...view(a, now), owner: a.owner, url: a.url })).sort((x, y) => (x.rank || 1e9) - (y.rank || 1e9)) });
// ---- 统计（仅聚合计数）----
const hits = new Map();
function limited(ip, max = 90) { const n = Date.now(), h = hits.get(ip); if (!h || n - h[0] > 60000) { hits.set(ip, [n, 1]); if (hits.size > 5000) for (const [k, v] of hits) if (n - v[0] > 60000) hits.delete(k); return false; } return ++h[1] > max; }
function track(b) { const ev = b.ev, S = load().stats, d = day(); if (!['card_click', 'ad_click', 'card_view'].includes(ev)) return { error: 'ev' };
  const id = String(b.id || ''), isAd = /^AD:/.test(id), aid = isAd ? id.slice(3) : ''; if (isAd ? !load().ads[aid] : !SIG.test(id)) return { error: 'id' };
  const bump = k => { if (!(k in S) && Object.keys(S).length >= MAX_KEYS) return; S[k] = (S[k] || 0) + 1; };
  bump(`${d}|${ev}|*`); if (isAd) { const rank = Math.max(0, Math.min(9999, Math.floor(+b.rank) || 0)), pos = Math.max(0, Math.min(999, Math.floor(+b.pos) || 0)); bump(`${d}|${ev}|${aid}|r${rank}|p${pos}`); }
  save(); return { ok: true }; }
function summary(days = 7) { const S = load().stats, from = day(Date.now() - days * 864e5), out = {}; for (const [k, v] of Object.entries(S)) if (k.slice(0, 10) >= from) { const [, ev, ...r] = k.split('|'); (out[ev] ||= {})[r.join('|') || '*'] = (out[ev][r.join('|') || '*'] || 0) + v; } return out; }
module.exports = { PAGE, STEP, SLOTS, DEF, cfg, setConfig, norm, score, decay, forecast, rankAds, recompute, board, markDirty, pageSlots, one, setVerifier, credit, launch, creditLocal, mine, view, estimate, upsert, remove, adminList, limited, track, summary, load, flush, minLam, reset: () => { D = null; snap = null; dirty = true; } };
