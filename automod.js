// t263：全自动内容治理（无人工审核）。举报 → AI/关键词复审 → 违规自动隐藏；作者一键申诉 → 自动复审 → 通过即恢复。
// 举报次数只作为「触发复审」的信号，绝不单独作为隐藏理由；隐藏只来自 AI/关键词/图片模型的判定。
// 防滥用：须登录（钱包或账号）；同 IP / 同设备 / 同时段注册的账号对同一卡只计一次；每账号每日上限；新账号低权重；
// 举报信用分（被采纳 +，被驳回 −，过低忽略，屡犯禁止举报）；付费上链或已过 AI 的卡需更高权重；判定干净后同理由 7 天内不再触发；
// 新号集中举报同卡/同作者 → 冻结这些举报并通知管理员（卡片不受影响）。管理员接口仅作可选覆盖。
const crypto = require('crypto');
const Mod = require('./moderation');
const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/, OID = /^O[FS]_[0-9a-f]{12}$/, VG = /^VG_[0-9a-f]{12}$/;
const REASONS = ['spam', 'abuse', 'illegal', 'privacy', 'scam', 'other'];
const H = 3600000, DAY = 24 * H, NEW_AGE = 3 * DAY, CLUSTER_WIN = 10 * 60000, COOLDOWN = 7 * DAY;
const P = { dailyCap: 5, credit0: 50, low: 25, upheld: 5, rejected: -10, appealLost: -15, threshold: 1, protectedThreshold: 3, burst: 3 };
const clean = s => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
const id12 = () => crypto.randomBytes(6).toString('hex');
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
function S(Soc) { const st = Soc.load(); st.reports ||= {}; st.hidden ||= {}; st.mod ||= {}; st.repCredit ||= {}; st.modNotices ||= []; return st; }
const cred = (st, uid) => st.repCredit[uid] ||= { c: P.credit0, up: 0, down: 0, ban: false };
function adjust(st, uid, d) { const c = cred(st, uid); c.c = Math.max(-50, Math.min(100, c.c + d)); if (d > 0) c.up++; else c.down++; if (c.c <= 0 || (c.down >= 5 && c.up === 0)) c.ban = true; }
// 读取卡片可审内容：文本 + 公开图片（私密/加密内容不外发，只看公开部分）
async function content(st, sig, C) {
  if (/^OF_/.test(sig)) { const f = st.free?.[sig.slice(3)]; return f && { text: f.text, imgs: [], author: null, freeTok: f.tok }; }
  if (/^OS_/.test(sig)) { const f = st.samples?.[sig.slice(3)]; return f && { text: f.text, imgs: [], author: null, official: true }; }
  if (VG.test(sig)) { const v = Object.values(st.vouchers || {}).find(v => v.card?.id === sig); return v && { text: v.card.text, imgs: [], author: v.claimer || v.giver, giver: v.giver }; }
  if (!SIG_RE.test(sig)) return null; const ti = await C.txInfo(sig).catch(() => null); if (!ti?.memo) return null; const f = ti.memo.split('|'); if (f[1] !== 'W') return null;
  const opt = f[5] || '', body = f.slice(6).join('|'), priv = /~F[0-9a-z]{2}P/.test(opt) && /^E1:/.test(body);
  const imgs = [...opt.matchAll(/~([CR])([0-9a-f]{32})/g)].map(m => m[2]); if (!/~F[0-9a-z]{2}P/.test(opt)) { const n = /~N([0-9a-f]{32})/.exec(opt); if (n) imgs.push(n[1]); }
  return { text: priv ? '' : body + '\n' + opt.replace(/~[A-Z][0-9a-zA-Z]*/g, ' '), imgs, author: ti.author, onchain: true };
}
async function review(c, C) { const t = await Mod.moderate(c.text || ''); if (!t.pass) return { pass: false, category: t.category, provider: t.provider || 'keyword', strong: true };
  let strong = Mod.aiOn() && t.provider === 'openai';
  for (const h of (c.imgs || []).slice(0, 3)) { const g = await C.getImg?.(h).catch(() => null); if (!g?.data || !/^image\//.test(g.mime || '')) continue;
    const a = await Mod.aiSemanticReview('', { buf: g.data, mime: g.mime }); if (!a.pass) return { pass: false, category: a.category, provider: 'openai', strong: true }; if (a.provider !== 'openai') strong = false;
    if (C.nsfw) { const n = await C.nsfw(g.data).catch(() => null); if (n && n.pass === false && !n.error) return { pass: false, category: '色情', provider: 'nsfwjs', strong: true }; } }
  return { pass: true, provider: strong ? 'openai' : (Mod.aiOn() ? 'fallback' : 'keyword'), strong }; }
function notify(st, C, m) { st.modNotices.unshift({ id: id12(), at: Date.now(), ...m }); if (st.modNotices.length > 300) st.modNotices.length = 300; if (process.env.ADMIN_PUBKEY && C.pushInbox) try { C.pushInbox(process.env.ADMIN_PUBKEY, { kind: 'modAlert', ...m }); } catch {} }
const running = new Set();
async function rereview(Soc, C, sig, why) {
  if (running.has(sig)) return; running.add(sig);
  try { let st = S(Soc); const c = await content(st, sig, C); if (!c) return; const v = await review(c, C); st = S(Soc); const now = Date.now(), m = st.mod[sig] ||= {};
    m.author = c.author || m.author; m.at = now; m.provider = v.provider;
    const open = Object.values(st.reports).filter(r => r.sig === sig && r.status === 'open');
    if (!v.pass) { st.hidden[sig] = now; m.state = 'hidden'; m.category = v.category; m.by = 'auto'; m.byAi = v.provider === 'openai'; for (const r of open) { r.status = 'upheld'; if (r.w > 0) adjust(st, r.uid, P.upheld); } }
    else { m.state = 'clean'; m.strong = v.strong; for (const r of open) { r.status = 'rejected'; if (v.strong && r.w > 0) adjust(st, r.uid, P.rejected); (m.cool ||= {})[r.reason] = now + (v.strong ? COOLDOWN : DAY); } }
    m.log = [...(m.log || []).slice(-9), { at: now, why, pass: v.pass, provider: v.provider, cat: v.category || null }]; Soc.save(st);
    if (!v.pass && c.author && C.pushInbox) try { C.pushInbox(c.author, { kind: 'modHidden', sig, cat: v.category }); } catch {}
  } finally { running.delete(sig); } }
async function handle(req, res, url, C) {
  const { send, body, Soc } = C, now = Date.now();
  if (url === '/api/report' && req.method === 'POST') {
    const a = C.auth(req); if (!a) return send(res, 401, { error: 'auth', code: 'repAuth' }), true;
    const b = await body(req, 4000), sig = String(b.sig || ''), reason = REASONS.includes(b.reason) ? b.reason : null, note = clean(b.note).slice(0, 200);
    if ((!SIG_RE.test(sig) && !OID.test(sig) && !VG.test(sig)) || !reason) return send(res, 400, { error: 'param', code: 'param' }), true;
    const st = S(Soc), uid = a.uid, cr = cred(st, uid); if (cr.ban) return send(res, 403, { error: 'banned', code: 'repBanned' }), true;
    const ip = C.ip(req), dev = String(req.headers['x-wt-dev'] || '').replace(/[^0-9a-zA-Z_-]/g, '').slice(0, 40), created = a.user.created || 0, age = now - created;
    const mine = Object.values(st.reports).filter(r => r.uid === uid && now - r.at < DAY); if (mine.length >= P.dailyCap) return send(res, 429, { error: 'rate', code: 'repCap' }), true;
    if (mine.some(r => r.sig === sig)) return send(res, 200, { ok: true, dup: true }), true;
    if (st.hidden[sig]) return send(res, 200, { ok: true, already: true }), true;
    const m = st.mod[sig] || {}, same = Object.values(st.reports).filter(r => r.sig === sig && now - r.at < 30 * DAY);
    let w = age < H ? .15 : age < NEW_AGE ? .3 : 1, status = 'open';
    if (cr.c < P.low) { w = 0; status = 'lowcredit'; }
    else if (same.some(r => r.uid !== uid && r.w > 0 && ((ip && r.ip === sha(ip)) || (dev && r.dev === dev) || (created && r.created && Math.abs(r.created - created) < CLUSTER_WIN)))) { w = 0; status = 'dup'; }
    else if (m.cool?.[reason] > now) { w = 0; status = 'cooldown'; }
    const rid = id12(), r = st.reports[rid] = { id: rid, sig, reason, note, at: now, uid, ip: ip ? sha(ip) : '', dev, created, w, status, author: m.author || null };
    if (status !== 'open') r.status = status === 'dup' || status === 'cooldown' ? 'dropped-' + status : 'ignored-' + status;
    // 攻击检测：1 小时内新号集中举报同一卡或同一作者
    const recentNew = Object.values(st.reports).filter(x => now - x.at < H && x.created && x.at - x.created < NEW_AGE && (x.sig === sig || (r.author && x.author === r.author)));
    if (recentNew.length >= P.burst && now - created < NEW_AGE) { for (const x of recentNew) if (x.status === 'open' || /^dropped/.test(x.status)) { x.status = 'frozen'; x.w = 0; }
      if (!st.mod[sig]?.alertAt || now - st.mod[sig].alertAt > H) { (st.mod[sig] ||= {}).alertAt = now; notify(st, C, { kind: 'reportBurst', sig, author: r.author, n: recentNew.length }); } }
    const ks = Object.keys(st.reports); if (ks.length > 5000) for (const k of ks.sort((x, y) => st.reports[x].at - st.reports[y].at).slice(0, ks.length - 5000)) delete st.reports[k];
    const weight = Object.values(st.reports).filter(x => x.sig === sig && x.status === 'open').reduce((s, x) => s + (x.w || 0), 0);
    const protectedCard = SIG_RE.test(sig) || m.state === 'clean' || VG.test(sig), need = protectedCard ? P.protectedThreshold : P.threshold;
    Soc.save(st); let queued = false;
    if (r.status === 'open' && weight >= need - 1e-9) { queued = true; const p = rereview(Soc, C, sig, 'report'); if (C.awaitReview) await p; else p.catch(e => console.warn('rereview', e.message)); }
    return send(res, 200, { ok: true, queued }), true; }
  if (url === '/api/appeal' && req.method === 'POST') {
    const b = await body(req, 2000), sig = String(b.sig || ''), st = S(Soc); if (!st.hidden[sig]) return send(res, 400, { error: 'not hidden', code: 'apNotHidden' }), true;
    const m = st.mod[sig] ||= {}; if (m.appealed) return send(res, 409, { error: 'used', code: 'apUsed' }), true;
    const c = await content(st, sig, C); if (!c) return send(res, 404, { error: 'nf', code: 'nf' }), true;
    const a = C.auth(req), isAuthor = (c.freeTok && b.token && sha(b.token) === c.freeTok) || (a && (a.user.pubkey === c.author || a.user.pubkey === c.giver));
    if (!isAuthor) return send(res, 403, { error: 'forbidden', code: 'apAuthor' }), true;
    const v = await review(c, C); if (v.pass && !v.strong && m.byAi) return send(res, 503, { error: 'retry', code: 'apRetry' }), true; // AI 判的隐藏，需 AI 可用时才能复审
    const st2 = S(Soc), m2 = st2.mod[sig] ||= {}; m2.appealed = now; m2.log = [...(m2.log || []).slice(-9), { at: now, why: 'appeal', pass: v.pass, provider: v.provider, cat: v.category || null }];
    if (v.pass) { delete st2.hidden[sig]; m2.state = 'clean'; m2.strong = v.strong; m2.restoredAt = now; for (const r of Object.values(st2.reports)) if (r.sig === sig && r.status === 'upheld') { r.status = 'overturned'; adjust(st2, r.uid, P.appealLost - P.upheld); } (m2.cool ||= {}); for (const k of REASONS) m2.cool[k] = now + COOLDOWN; }
    else { m2.category = v.category; }
    Soc.save(st2); return send(res, 200, { ok: true, restored: v.pass, category: v.pass ? null : v.category }), true; }
  if (url === '/api/mod/status' && req.method === 'GET') return send(res, 200, { ai: Mod.aiOn(), stat: { ...Mod.stat } }), true;
  if (url.startsWith('/api/admin/moderation')) { if (!C.adminOk(req)) return send(res, 403, { error: 'forbidden', code: 'admin' }), true; const st = S(Soc);
    if (req.method === 'GET') return send(res, 200, { ai: Mod.aiOn(), notices: st.modNotices.slice(0, 100), mod: st.mod, credit: st.repCredit, reports: Object.values(st.reports).sort((a, b) => b.at - a.at).slice(0, 200) }), true;
    if (req.method === 'POST' && url === '/api/admin/moderation/credit') { const b = await body(req, 2000), c = cred(st, String(b.uid || '')); if (b.c != null) c.c = +b.c; if (b.ban != null) c.ban = !!b.ban; Soc.save(st); return send(res, 200, { ok: true, credit: c }), true; } }
  return false; }
module.exports = { handle, rereview, P, content };
