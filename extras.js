// t244：官方示范心愿（仅 ADMIN_KEY）、免费心愿（未上链，链下）、点亮（无金钱）、举报队列、卡片分享 OG 元数据。
// 平台从不代用户发交易 / 不补贴 gas / 不托管资产；免费心愿只存在光栖服务器，用户自行付费上链后才永久保存。
const crypto = require('crypto');
const coverOf = v => Math.min(9, Math.max(0, parseInt(v, 10) || 0)); // 光栖主题 10 套（0–9）
const CATS = ['经典', '风景', '人物', '动物', '卡通', '光栖'], SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/, OID = /^O[FS]_[0-9a-f]{12}$/;
const REASONS = ['spam', 'abuse', 'illegal', 'privacy', 'scam', 'other'];
const SECRET = process.env.FREE_SECRET || crypto.randomBytes(32).toString('hex'); // 未配置时进程级随机（重启后旧题目失效，无害）
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex'), hmac = s => crypto.createHmac('sha256', SECRET).update(s).digest('hex').slice(0, 32);
const B = new Map(); // 内存限速桶：key → [count, resetAt]
function hit(key, max, ms) { const now = Date.now(), b = B.get(key); if (!b || b[1] < now) { B.set(key, [1, now + ms]); return false; } if (b[0] >= max) return true; b[0]++; return false; }
setInterval(() => { const now = Date.now(); for (const [k, v] of B) if (v[1] < now) B.delete(k); }, 600000).unref();
const usedCid = new Map(); const DAY = 86400000;
const clean = s => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
const len = s => [...s].length, id12 = () => crypto.randomBytes(6).toString('hex');
function pub(st) { const hid = st.hidden || {};
  const samples = Object.values(st.samples || {}).filter(s => !hid['OS_' + s.id]).map(s => ({ id: 'OS_' + s.id, text: s.text, cat: s.cat, cover: s.cover, at: s.at }));
  const free = Object.values(st.free || {}).filter(f => !f.up && !hid['OF_' + f.id]).sort((a, b) => b.at - a.at).slice(0, 300).map(f => ({ id: 'OF_' + f.id, text: f.text, cat: f.cat, cover: f.cover, at: f.at }));
  const gifted = Object.values(st.vouchers || {}).filter(v => v.claimed && v.card && !hid[v.card.id]).sort((a, b) => b.card.at - a.card.at).slice(0, 300).map(v => ({ id: v.card.id, text: v.card.text, cat: v.card.cat, cover: v.card.cover, at: v.card.at, gifted: true, by: v.by || '', offchain: true }));
  return { samples, free, gifted, cheers: st.cheers || {}, hidden: Object.keys(hid) }; }
async function handle(req, res, url, C) { const { send, body, Soc, moderate, Block } = C, ip = C.ip(req), ipk = sha('ip|' + ip).slice(0, 16), admin = C.adminOk(req);
  if (url === '/api/offchain' && req.method === 'GET') { res.setHeader?.('cache-control', 'no-cache'); return send(res, 200, pub(Soc.load())), true; }
  if (url === '/api/free/challenge' && req.method === 'GET') { if (hit('ch|' + ipk, 30, 3600000)) return send(res, 429, { error: 'rate', code: 'rate' }), true;
    const a = 1 + crypto.randomInt(9), b = 1 + crypto.randomInt(9), ts = Date.now(), n = id12(); return send(res, 200, { cid: `${ts}.${n}.${hmac(`${a + b}|${ts}|${n}`)}`, q: `${a} + ${b} = ?` }), true; }
  if (url === '/api/free' && req.method === 'POST') { const b = await body(req, 4000), text = clean(b.text), cat = ['经典', '光栖'].includes(b.cat) ? b.cat : '经典', cover = cat === '光栖' ? coverOf(b.cover) : undefined, dev = String(b.dev || '').slice(0, 64);
    const [ts, n, mac] = String(b.cid || '').split('.'); if (!ts || !n || !mac || Date.now() - +ts > 600000 || usedCid.has(n) || hmac(`${parseInt(b.ans, 10)}|${ts}|${n}`) !== mac) return send(res, 400, { error: 'captcha', code: 'freeCaptcha' }), true;
    usedCid.set(n, Date.now()); if (usedCid.size > 5000) usedCid.clear();
    if (!text || len(text) > 140 || /[|~<>]/.test(text)) return send(res, 400, { error: 'len', code: 'len' }), true;
    if (hit('fw|' + ipk, 3, DAY) || (dev && hit('fwd|' + sha(dev).slice(0, 16), 3, DAY)) || hit('fw|all', 500, DAY)) return send(res, 429, { error: 'rate', code: 'freeRate' }), true;
    const bh = Block.check(text); if (bh) return send(res, 400, { error: 'blocked', code: 'blockPhish' }), true;
    const m = await moderate(text); if (!m.pass) return send(res, 400, { error: 'reject', code: 'reject' }), true;
    const st = Soc.load(), id = id12(), token = crypto.randomBytes(24).toString('base64url'); st.free ||= {}; st.free[id] = { id, text, cat, cover, at: Date.now(), tok: sha(token), ip: ipk };
    const ks = Object.keys(st.free); if (ks.length > 5000) for (const k of ks.sort((x, y) => st.free[x].at - st.free[y].at).slice(0, ks.length - 5000)) delete st.free[k];
    Soc.save(st); return send(res, 200, { id: 'OF_' + id, token, text, cat }), true; }
  if (url === '/api/free/claim' && req.method === 'POST') { const a = C.auth(req); if (!a) return send(res, 401, { error: '未登录', code: 'auth' }), true; const b = await body(req, 4000), id = String(b.id || '').replace(/^OF_/, '');
    const st = Soc.load(), f = st.free?.[id]; if (!f || f.tok !== sha(b.token || '')) return send(res, 403, { error: 'forbidden', code: 'forbidden' }), true; if (f.up) return send(res, 200, { ok: true, sig: f.up }), true;
    if (!SIG_RE.test(b.sig || '')) return send(res, 400, { error: 'param', code: 'param' }), true; const ti = await C.txInfo(b.sig);
    if (!ti || ti.author !== a.user.pubkey || !ti.memo || !C.verifyWishMemo(ti.memo) || ti.memo.split('|').slice(6).join('|') !== f.text) return send(res, 400, { error: 'verify', code: 'freeVerify' }), true;
    f.up = b.sig; f.upAt = Date.now(); Soc.save(st); return send(res, 200, { ok: true, sig: b.sig }), true; }
  if (url === '/api/cheer' && req.method === 'POST') { const b = await body(req, 2000), sig = String(b.sig || ''); if (!SIG_RE.test(sig) && !OID.test(sig) && !/^VG_[0-9a-f]{12}$/.test(sig)) return send(res, 400, { error: 'param', code: 'param' }), true;
    const a = C.auth(req), who = a ? 'u' + a.user.pubkey : ipk; if (hit('cheer|' + ipk, 60, 3600000)) return send(res, 429, { error: 'rate', code: 'rate' }), true;
    const st = Soc.load(); st.cheers ||= {}; if (hit('ch1|' + who + '|' + sig, 1, DAY)) return send(res, 200, { ok: true, dup: true, n: st.cheers[sig] || 0 }), true;
    st.cheers[sig] = (st.cheers[sig] || 0) + 1; Soc.save(st);
    if (SIG_RE.test(sig) && !hit('cheerNote|' + sig, 1, 3600000)) C.txInfo(sig).then(ti => { if (ti?.author && ti.author !== a?.user.pubkey && /^WTREE1\|W\|/.test(ti.memo || '')) { const db = C.load(); C.Acc.pushMsg(db, ti.author, { kind: 'cheer', sig, n: st.cheers[sig], text: (ti.memo.split('|')[6] || '').slice(0, 40) }); C.save(db); } }).catch(() => {});
    return send(res, 200, { ok: true, n: st.cheers[sig] }), true; }
  if (url === '/api/report' && req.method === 'POST') { const b = await body(req, 4000), sig = String(b.sig || ''), reason = REASONS.includes(b.reason) ? b.reason : null, note = clean(b.note).slice(0, 200);
    if ((!SIG_RE.test(sig) && !OID.test(sig)) || !reason) return send(res, 400, { error: 'param', code: 'param' }), true;
    if (hit('rep|' + ipk, 10, 3600000) || hit('rep1|' + ipk + '|' + sig, 1, DAY)) return send(res, 429, { error: 'rate', code: 'rate' }), true;
    const st = Soc.load(), rid = id12(); st.reports ||= {}; st.reports[rid] = { id: rid, sig, reason, note, at: Date.now(), by: ipk, status: 'open' }; const rk = Object.keys(st.reports); if (rk.length > 3000) for (const k of rk.sort((x, y) => st.reports[x].at - st.reports[y].at).slice(0, rk.length - 3000)) delete st.reports[k]; Soc.save(st); return send(res, 200, { ok: true }), true; }
  if (url.startsWith('/api/admin/reports') || url.startsWith('/api/admin/samples')) { if (!admin) return send(res, 403, { error: 'forbidden', code: 'admin' }), true; const st = Soc.load();
    if (url === '/api/admin/reports' && req.method === 'GET') { const all = Object.values(st.reports || {}).sort((a, b) => a.at - b.at); return send(res, 200, { open: all.filter(r => r.status === 'open'), recent: all.filter(r => r.status !== 'open').slice(-50) }), true; }
    if (url === '/api/admin/reports/resolve' && req.method === 'POST') { const b = await body(req, 2000), r = (st.reports || {})[b.id]; if (!r || !['hide', 'dismiss', 'unhide'].includes(b.action)) return send(res, 400, { error: 'param', code: 'param' }), true;
      st.hidden ||= {}; if (b.action === 'hide') st.hidden[r.sig] = Date.now(); if (b.action === 'unhide') delete st.hidden[r.sig]; for (const x of Object.values(st.reports)) if (x.sig === r.sig && x.status === 'open') x.status = b.action === 'hide' ? 'hidden' : 'dismissed'; Soc.save(st); return send(res, 200, { ok: true }), true; }
    if (url === '/api/admin/samples' && req.method === 'GET') return send(res, 200, { samples: Object.values(st.samples || {}) }), true;
    if (url === '/api/admin/samples' && req.method === 'POST') { const b = await body(req, 4000), text = clean(b.text), cat = ['经典', '光栖'].includes(b.cat) ? b.cat : '经典', cover = cat === '光栖' ? coverOf(b.cover) : undefined;
      if (!text || len(text) > 140 || /[|~<>]/.test(text) || Block.check(text)) return send(res, 400, { error: 'param', code: 'param' }), true;
      const id = id12(); st.samples ||= {}; st.samples[id] = { id, text, cat, cover, at: Date.now() }; Soc.save(st); return send(res, 200, { ok: true, id: 'OS_' + id }), true; }
    if (url === '/api/admin/samples/delete' && req.method === 'POST') { const b = await body(req, 2000), id = String(b.id || '').replace(/^OS_/, ''); if (!st.samples?.[id]) return send(res, 404, { error: 'nf', code: 'nf' }), true; delete st.samples[id]; Soc.save(st); return send(res, 200, { ok: true }), true; }
    return send(res, 404, { error: 'nf' }), true; }
  if (url.startsWith('/api/og-meta/') && req.method === 'GET') { const id = decodeURIComponent(url.slice(13)), st = Soc.load(); if (st.hidden?.[id]) return send(res, 404, { error: 'nf' }), true;
    if (OID.test(id)) { const o = id[1] === 'S' ? st.samples?.[id.slice(3)] : st.free?.[id.slice(3)]; return o ? send(res, 200, { text: o.text, cat: o.cat, cover: o.cover ?? null, official: id[1] === 'S', offchain: id[1] === 'F', cheers: st.cheers?.[id] || 0 }) : send(res, 404, { error: 'nf' }), true; }
    if (/^VG_[0-9a-f]{12}$/.test(id)) { const v = Object.values(st.vouchers || {}).find(x => x.card?.id === id); return v?.card ? send(res, 200, { text: v.card.text, cat: v.card.cat, cover: v.card.cover ?? null, gifted: true, by: v.by || '', offchain: true, cheers: st.cheers?.[id] || 0 }) : send(res, 404, { error: 'nf' }), true; }
    if (!SIG_RE.test(id)) return send(res, 400, { error: 'param' }), true; if (hit('og|' + ipk, 60, 60000)) return send(res, 429, { error: 'rate' }), true;
    const ti = await C.txInfo(id).catch(() => null), f = (ti?.memo || '').split('|'); if (f[1] !== 'W' || !C.verifyWishMemo(ti.memo)) return send(res, 404, { error: 'nf' }), true;
    const K = Soc.parseKind(f[5]); if (K.vis && K.vis !== 'public') return send(res, 200, { text: '', cat: '经典', cheers: 0 }), true; // 非公开卡不外泄正文
    const priv = /~F[0-9a-z]{2}P/.test(f[5]), img = (f[5].match(/~C([0-9a-f]{32})/) || [])[1];
    return send(res, 200, { text: priv ? '' : f.slice(6).join('|').slice(0, 140), cat: (f[5].split('~')[0] || '经典'), cover: (m => m ? parseInt(m[1], 36) : null)(f[5].match(/~[KF]([0-9a-z]{2})/)), img: img || null, cheers: st.cheers?.[id] || 0 }), true; }
  return false; }
module.exports = { handle, pub, REASONS };
