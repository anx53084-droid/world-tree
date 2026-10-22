// t259：买后送（预付卡券）。送礼人先付卡券费到官方收款地址（memo = WTVC1|<id>），收卡人无钱包创作并立刻挂树；
// 平台不代付 gas、不托管、不法币。链接默认 7 天、单次领取；过期可取消或由送礼人领回自填；不上链退款。
const crypto = require('crypto');
const TTL = 7 * 86400000, SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/, ID = /^[0-9a-f]{16}$/;
const clean = s => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
const len = s => [...s].length;
const vcMemo = id => `WTVC1|${id}`;
const state = (v, now) => v.claimed ? 'claimed' : v.cancelled ? 'cancelled' : v.voided ? 'voided' : !v.paid ? 'unpaid' : now > v.exp ? 'expired' : 'open';
const pub = (v, now, role) => {
  const st = state(v, now), base = { id: v.id, state: st, exp: v.exp, lamports: v.lamports, at: v.at, giver: v.giver, by: v.by || '', cat: v.cat || '经典', paid: !!v.paid, sig: v.sig || null };
  if (st === 'claimed' && v.card) return { ...base, card: { id: v.card.id, text: v.card.text, cat: v.card.cat, cover: v.card.cover, at: v.card.at, by: v.by || '' }, claimable: false };
  if (role === 'giver') return { ...base, claimable: false, reclaimable: st === 'expired' || st === 'cancelled', path: '/#/voucher/' + v.id };
  return { ...base, claimable: st === 'open', path: '/#/voucher/' + v.id };
};
function store(Soc) { const st = Soc.load(); st.vouchers ||= {}; return st; }
async function handle(req, res, url, C) {
  const { send, body, Soc, moderate, Block } = C, now = Date.now(), a = C.auth(req);
  // 创建未付款卡券（需登录）；返回付款 memo
  if (url === '/api/voucher' && req.method === 'POST') {
    if (!a || !a.user.pubkey) return send(res, 401, { error: 'auth', code: 'auth' }), true;
    const b = await body(req, 2000), lamports = Math.floor(+b.lamports || 0), by = clean(b.by).slice(0, 24);
    if (!(lamports >= await C.minLamports())) return send(res, 400, { error: 'amount', code: 'vcAmount' }), true;
    const st = store(Soc), mine = Object.values(st.vouchers).filter(v => v.giver === a.user.pubkey && !v.claimed && !v.cancelled && now < (v.exp || 0) + TTL);
    if (mine.length >= 20) return send(res, 429, { error: 'rate', code: 'rate' }), true;
    const id = crypto.randomBytes(8).toString('hex');
    st.vouchers[id] = { id, giver: a.user.pubkey, by, lamports, at: now, exp: now + TTL, paid: false, claimed: false, cancelled: false, tok: crypto.randomBytes(16).toString('hex') };
    Soc.save(st); return send(res, 200, { id, exp: now + TTL, lamports, memo: vcMemo(id), path: '/#/voucher/' + id, tok: st.vouchers[id].tok }), true;
  }
  if (url === '/api/voucher/mine' && req.method === 'GET') {
    if (!a || !a.user.pubkey) return send(res, 401, { error: 'auth', code: 'auth' }), true;
    const st = store(Soc), mine = [], gifted = [];
    for (const v of Object.values(st.vouchers)) {
      if (v.giver === a.user.pubkey) mine.push(pub(v, now, 'giver'));
      if (v.claimed && v.card && v.card.dev === C.devId?.(req)) gifted.push(pub(v, now, 'claim'));
    }
    // 用 token 列表识别「送给我的」：客户端带 claimToks
    return send(res, 200, { given: mine.sort((x, y) => y.at - x.at).slice(0, 50), received: gifted.slice(0, 50) }), true;
  }
  if (url === '/api/voucher/gifted' && req.method === 'GET') {
    // 公开列表：已领取挂树的赠送卡（与 offchain free 类似）
    const st = store(Soc), hid = st.hidden || {};
    const cards = Object.values(st.vouchers).filter(v => v.claimed && v.card && !hid[v.card.id])
      .sort((a, b) => b.card.at - a.card.at).slice(0, 300)
      .map(v => ({ id: v.card.id, text: v.card.text, cat: v.card.cat, cover: v.card.cover, at: v.card.at, gifted: true, by: v.by || '', giver: v.giver, offchain: true, voucher: v.id }));
    res.setHeader?.('cache-control', 'no-cache'); return send(res, 200, { cards }), true;
  }
  let m = url.match(/^\/api\/voucher\/([0-9a-f]{16})$/);
  if (m && req.method === 'GET') {
    const st = store(Soc), v = st.vouchers[m[1]]; if (!v) return send(res, 404, { error: 'notfound', code: 'vcGone' }), true;
    const mine = !!(a && a.user.pubkey === v.giver), role = mine ? 'giver' : 'guest';
    const out = { ...pub(v, now, role), receive: C.receive(), memo: !v.paid ? vcMemo(v.id) : null, tok: mine ? v.tok : undefined };
    return send(res, 200, out), true;
  }
  m = url.match(/^\/api\/voucher\/([0-9a-f]{16})\/confirm$/);
  if (m && req.method === 'POST') {
    if (!a || !a.user.pubkey) return send(res, 401, { error: 'auth', code: 'auth' }), true;
    const st = store(Soc), v = st.vouchers[m[1]]; if (!v || v.giver !== a.user.pubkey) return send(res, 404, { error: 'notfound', code: 'vcGone' }), true;
    const b = await body(req, 2000); if (v.paid) return send(res, v.sig === b.sig ? 200 : 409, v.sig === b.sig ? { ok: true, ...pub(v, now, 'giver') } : { error: 'paid', code: 'vcPaid' }), true;
    if (!SIG_RE.test(b.sig || '')) return send(res, 400, { error: 'param', code: 'param' }), true;
    const tx = await C.fpTx(b.sig); if (!tx) return send(res, 400, { error: 'verify', code: 'vcVerify' }), true;
    const tag = tx.memos.find(x => x === vcMemo(v.id) || x.startsWith(vcMemo(v.id) + '|'));
    if (!tag || tx.paid < v.lamports || tx.payer !== v.giver) return send(res, 400, { error: 'verify', code: 'vcVerify' }), true;
    Object.assign(v, { paid: true, sig: b.sig, paidAt: now, exp: now + TTL }); Soc.save(st);
    return send(res, 200, { ok: true, ...pub(v, now, 'giver'), path: '/#/voucher/' + v.id }), true;
  }
  m = url.match(/^\/api\/voucher\/([0-9a-f]{16})\/cancel$/);
  if (m && req.method === 'POST') {
    if (!a || !a.user.pubkey) return send(res, 401, { error: 'auth', code: 'auth' }), true;
    const st = store(Soc), v = st.vouchers[m[1]]; if (!v || v.giver !== a.user.pubkey) return send(res, 404, { error: 'notfound', code: 'vcGone' }), true;
    if (v.claimed) return send(res, 409, { error: 'claimed', code: 'vcClaimed' }), true;
    v.cancelled = true; v.cancelAt = now; Soc.save(st); return send(res, 200, { ok: true }), true;
  }
  m = url.match(/^\/api\/voucher\/([0-9a-f]{16})\/claim$/);
  if (m && req.method === 'POST') {
    const st = store(Soc), v = st.vouchers[m[1]]; if (!v) return send(res, 404, { error: 'notfound', code: 'vcGone' }), true;
    const b = await body(req, 8000), reclaim = !!b.reclaim;
    if (reclaim) {
      if (!a || a.user.pubkey !== v.giver) return send(res, 403, { error: 'forbidden', code: 'forbidden' }), true;
      if (v.claimed) return send(res, 409, { error: 'claimed', code: 'vcClaimed' }), true;
      if (!(v.cancelled || now > v.exp)) return send(res, 400, { error: 'notyet', code: 'vcNotExpired' }), true;
    } else {
      if (!v.paid) return send(res, 400, { error: 'unpaid', code: 'vcUnpaid' }), true;
      if (v.cancelled) return send(res, 410, { error: 'cancelled', code: 'vcCancelled' }), true;
      if (now > v.exp) return send(res, 410, { error: 'expired', code: 'vcExpired' }), true;
      if (v.claimed) return send(res, 409, { error: 'claimed', code: 'vcClaimed' }), true;
    }
    const text = clean(b.text), cat = ['经典', '光栖'].includes(b.cat) ? b.cat : '经典', cover = cat === '光栖' ? Math.min(9, Math.max(0, parseInt(b.cover, 10) || 0)) : undefined;
    if (len(text) < 2 || len(text) > 140) return send(res, 400, { error: 'text', code: 'vcText' }), true;
    if (Block?.check?.(text)) return send(res, 400, { error: 'blocked', code: 'blockPhish' }), true;
    const mod = await moderate(text); if (!mod.pass) return send(res, 400, { error: 'reject', code: 'reject', category: mod.category }), true;
    const cid = 'VG_' + crypto.randomBytes(6).toString('hex'), tok = crypto.randomBytes(24).toString('base64url');
    v.claimed = true; v.claimedAt = now; v.card = { id: cid, text, cat, cover, at: now, tok: crypto.createHash('sha256').update(tok).digest('hex'), reclaim: !!reclaim, dev: String(b.dev || '').slice(0, 64) };
    if (reclaim && !v.by) v.by = ''; Soc.save(st);
    // 站内信给送礼人（非领回）
    if (!reclaim && C.pushInbox) C.pushInbox(v.giver, { kind: 'vclaim', text: text.slice(0, 140), by: v.by, voucher: v.id, card: cid });
    return send(res, 200, { ok: true, id: cid, token: tok, text, cat, cover, by: v.by || '', gifted: !reclaim }), true;
  }
  return false; }
module.exports = { handle, TTL, vcMemo };
