// t252 / t259：朋友代付（非托管）。作者写好心愿（已通过审核）→ 生成 24 小时、一次性的代付链接；
// 朋友用自己的钱包签名并支付（网络费由朋友钱包承担），资金直接转入官方收款地址；平台不发交易、不托管、不涉及法币。
// t259：作者可选「允许朋友查看心愿内容」（默认开）；关闭时付款页与分享图不展示正文。
const crypto = require('crypto');
const TTL = 24 * 3600000, SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const clean = s => String(s || '').replace(/[\u0000-\u001f\u007f|]/g, ' ').trim();
const fpMemo = (id, author, name) => `WTFP1|${id}|${author}|${clean(name).slice(0, 24)}`;
const state = (f, now) => f.used ? 'used' : now > f.exp ? 'expired' : 'open';
const view = (f, now, forAuthor) => {
  const p = f.memo.split('|'), show = f.showText !== false, text = p.slice(6).join('|'), priv = /^E1:/.test(text);
  return { id: f.id, state: state(f, now), exp: f.exp, lamports: f.lamports, author: f.author, cat: p[5] || '', showText: show,
    text: (forAuthor || show) && !priv ? text : '', priv, hidden: !show && !forAuthor, sig: f.used ? f.sig : null, by: f.used ? f.by || '' : null, at: f.at };
};
function prune(db, now) { for (const [k, f] of Object.entries(db.fpay || {})) if (now - f.exp > 30 * 86400000) delete db.fpay[k]; }
async function handle(req, res, url, C) { const { send, body, db, save } = C, now = Date.now(); db.fpay = db.fpay || {};
  if (url === '/api/fpay' && req.method === 'POST') { const a = C.auth(req); if (!a || !a.user.pubkey) return send(res, 401, { error: 'auth', code: 'auth' }), true;
    const b = await body(req, 4000), memo = String(b.memo || ''), lamports = Math.floor(+b.lamports || 0), showText = b.showText !== false && b.showText !== 0 && b.showText !== '0';
    if (!/^WTREE1\|W\|/.test(memo) || !C.verifyWishMemo(memo)) return send(res, 400, { error: 'memo', code: 'fpMemo' }), true;
    if (!(lamports >= await C.minLamports())) return send(res, 400, { error: 'amount', code: 'fpAmount' }), true;
    const mine = Object.values(db.fpay).filter(f => f.author === a.user.pubkey && state(f, now) === 'open'); if (mine.length >= 10) return send(res, 429, { error: 'rate', code: 'rate' }), true;
    prune(db, now); const id = crypto.randomBytes(8).toString('hex'); db.fpay[id] = { id, memo, lamports, author: a.user.pubkey, at: now, exp: now + TTL, used: false, showText }; save(db);
    return send(res, 200, { id, exp: now + TTL, path: '/#/fpay/' + id, showText }), true; }
  if (url === '/api/fpay/mine' && req.method === 'GET') { const a = C.auth(req); if (!a || !a.user.pubkey) return send(res, 401, { error: 'auth', code: 'auth' }), true;
    const L = Object.values(db.fpay).filter(f => f.author === a.user.pubkey).sort((x, y) => y.at - x.at).slice(0, 50).map(f => view(f, now, true));
    return send(res, 200, { items: L }), true; }
  if (url === '/api/fpay/done' && req.method === 'GET') { const o = {}; for (const f of Object.values(db.fpay)) if (f.used) o[f.sig] = { author: f.author, payer: f.payer, by: f.by || '' }; res.setHeader?.('cache-control', 'no-cache'); return send(res, 200, o), true; }
  let m = url.match(/^\/api\/fpay\/([0-9a-f]{16})$/);
  if (m && req.method === 'GET') { const f = db.fpay[m[1]]; if (!f) return send(res, 404, { error: 'notfound', code: 'fpGone' }), true;
    const a = C.auth(req), mine = !!(a && a.user.pubkey === f.author);
    return send(res, 200, { ...view(f, now, mine), memo: state(f, now) === 'open' ? f.memo : null, receive: C.receive(), tag: fpMemo(f.id, f.author, '') }), true; }
  m = url.match(/^\/api\/fpay\/([0-9a-f]{16})\/cancel$/);
  if (m && req.method === 'POST') { const a = C.auth(req); if (!a) return send(res, 401, { error: 'auth', code: 'auth' }), true;
    const f = db.fpay[m[1]]; if (!f || f.author !== a.user.pubkey) return send(res, 404, { error: 'notfound', code: 'fpGone' }), true;
    if (f.used) return send(res, 409, { error: 'used', code: 'fpUsed' }), true; f.exp = now - 1; save(db); return send(res, 200, { ok: true }), true; }
  m = url.match(/^\/api\/fpay\/([0-9a-f]{16})\/confirm$/);
  if (m && req.method === 'POST') { const f = db.fpay[m[1]]; if (!f) return send(res, 404, { error: 'notfound', code: 'fpGone' }), true; const b = await body(req, 2000);
    if (f.used) return send(res, f.sig === b.sig ? 200 : 409, f.sig === b.sig ? { ok: true, sig: f.sig } : { error: 'used', code: 'fpUsed' }), true;
    if (!SIG_RE.test(b.sig || '')) return send(res, 400, { error: 'param', code: 'param' }), true;
    const tx = await C.fpTx(b.sig); if (!tx) return send(res, 400, { error: 'verify', code: 'fpVerify' }), true;
    if (tx.blockTime && tx.blockTime * 1000 > f.exp + 120000) return send(res, 410, { error: 'expired', code: 'fpExpired' }), true;
    const tag = tx.memos.find(x => x.startsWith(`WTFP1|${f.id}|${f.author}|`));
    if (tx.memos[0] !== f.memo || !tag || tx.paid < f.lamports) return send(res, 400, { error: 'verify', code: 'fpVerify' }), true;
    if (now > f.exp + 120000 && !tx.blockTime) return send(res, 410, { error: 'expired', code: 'fpExpired' }), true;
    Object.assign(f, { used: true, sig: b.sig, payer: tx.payer, by: tag.split('|').slice(3).join('|'), usedAt: now });
    db.inbox = db.inbox || {}; const L = db.inbox[f.author] = db.inbox[f.author] || []; const vv = view(f, now, true);
    L.unshift({ id: crypto.randomBytes(6).toString('hex'), at: now, read: false, kind: 'fpay', sig: b.sig, text: vv.priv ? '' : vv.text.slice(0, 140), by: f.by, payer: tx.payer }); if (L.length > 200) L.length = 200;
    save(db); return send(res, 200, { ok: true, sig: b.sig }), true; }
  return false; }
module.exports = { handle, fpMemo, TTL };
