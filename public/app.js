// 世界树许愿树 前端（SPA，hash 路由）。链上为唯一事实来源；本文件只读链 + 发起签名。
let W3 = window.solanaWeb3; // web3.js 仅写链时按需加载（~480KB），不阻塞首屏
const needW3 = () => W3 ? Promise.resolve(W3) : (needW3.p ||= new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'vendor/web3.iife.min.js'; sc.onload = () => res(W3 = window.solanaWeb3); sc.onerror = rej; document.head.append(sc); }));
const TREE = 'pqaQKFsNjfJKewkwEyJaNYzoKxu3sh1hmNvAGKfz5Yb', MEMO = 'MemoSq4gqABAXKb96qnH8TuDybDJ9cKfTLqKE7Rbr8z', TAG = 'WTREE1|';
const RPC_READ = '/api/rpc'; // 读层：同源中继 → devnet RPC。换索引器（Helius/自建 Geyser）时只需改 loadWishes()
const RPC_WRITE = 'https://api.devnet.solana.com';
const EXPLORER = s => `https://explorer.solana.com/tx/${s}?cluster=devnet`;
const CATS = { 经典: 45, 风景: 200, 人物: 330, 动物: 155, 卡通: 28, 物质类: 270 }; // 分类 → 色相
const CAT_KEY = { 经典: 'classic', 风景: 'scenery', 人物: 'people', 动物: 'animals', 卡通: 'cartoon', 物质类: 'material' }; // 链上分类保持中文原值，仅显示时翻译
const MATERIAL = '物质类';
const catName = c => CAT_KEY[c] ? t('cat.' + CAT_KEY[c]) : c;
const MODCAT_KEY = { 违法: 'illegal', 侵权: 'infringement', 色情: 'sexual', 暴力: 'violence', 歧视: 'discrimination', 违法宣传: 'illegalPromo', 负面消极: 'negative', 'AI 语义审核': 'ai' };
const modCat = c => MODCAT_KEY[c] ? t('modcat.' + MODCAT_KEY[c]) : c;
const tErr = (code, msg) => code && I18N.dict['err.' + code] ? t('err.' + code, { msg: msg || '' }) : msg;
const num = n => Number(n).toLocaleString(I18N.locale());
const lbl = l => ({ 点赞: 'like', 祝福: 'bless', 许愿: 'wish' }[l] ? t('label.' + { 点赞: 'like', 祝福: 'bless', 许愿: 'wish' }[l]) : I18N.dict['label.' + l] ? t('label.' + l) : l);
const stat = s => ({ 已确认: 'ok', 失败: 'fail' }[s] ? t('tx.status_' + { 已确认: 'ok', 失败: 'fail' }[s]) : I18N.dict['tx.status_' + s] ? t('tx.status_' + s) : s);
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
const fmtT = t => t ? new Date(t * 1000).toLocaleString(I18N.locale(), { hour12: false, timeZone: 'Asia/Shanghai' }) : t('time.pending');
const sol = l => (l / 1e9).toFixed(4) + ' SOL';
const hex2b = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
// 卡片选项编码在分类字段后（向后兼容：旧客户端把未知分类当「经典」显示正文）：分类~F<封面2位36进制>[P]   F=折页卡  P=私密（正文为 E1: 密文）
// 自定义图片：~C<封面哈希32hex> ~N<内页哈希32hex>（图片存链下 /api/img/<hash>；旧客户端忽略多余段，显示内置封面）
const parseOpt = raw => { const [c, o = '', ...ex] = String(raw).split('~'), m = o.match(/^F([0-9a-z]{2})(P?)$/), g = k => (ex.find(x => new RegExp('^' + k + '[0-9a-f]{32}$').test(x)) || '').slice(1) || null,
  ii = (ex.find(x => /^I[0-9a-z]{2}$/.test(x)) || '');
  return { cat: CATS[c] !== undefined ? c : '经典', folded: !!m, cover: m ? parseInt(m[1], 36) : null, priv: !!(m && m[2]), cimg: m ? g('C') : null, nimg: m ? g('N') : null, inside: m && ii ? parseInt(ii.slice(1), 36) : null }; };
const encOpt = (cat, folded, cover, priv, cimg, nimg, inside) => folded ? `${cat}~F${(cover | 0).toString(36).padStart(2, '0')}${priv ? 'P' : ''}${cimg ? '~C' + cimg : ''}${nimg ? '~N' + nimg : ''}${!nimg && inside != null ? '~I' + ((inside | 0).toString(36).padStart(2, '0')) : ''}` : cat;
// 折页：封面/内页各自可选内置或上传；上传优先。内置内页用 ~Ixx；旧卡无 ~I 仅显示正文
const IMG = h => '/api/img/' + h;
// 上传前在浏览器内缩放压缩：最长边 ≤800px，webp（不支持则 jpeg），≤300KB
async function shrinkImg(file) { if (!/^image\//.test(file.type)) throw new Error(t('wish.upType')); const bm = await createImageBitmap(file), k = Math.min(1, 800 / Math.max(bm.width, bm.height)), c = document.createElement('canvas');
  c.width = Math.round(bm.width * k); c.height = Math.round(bm.height * k); c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
  for (const q of [.82, .7, .55, .4]) for (const ty of ['image/webp', 'image/jpeg']) { const b = await new Promise(r => c.toBlob(r, ty, q)); if (b && b.type === ty && b.size <= 300 * 1024) return b; }
  throw new Error(t('wish.upSize')); }
async function uploadImg(blob, encKey) { const u = new Uint8Array(await blob.arrayBuffer()), big = x => { let s = ''; for (let i = 0; i < x.length; i += 8192) s += String.fromCharCode(...x.subarray(i, i + 8192)); return btoa(s); };
  let cipher; if (encKey) { const iv = crypto.getRandomValues(new Uint8Array(12)), ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encKey, u)), o = new Uint8Array(12 + ct.length); o.set(iv); o.set(ct, 12); cipher = big(o); }
  const r = await fetch('/api/img', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mime: blob.type, data: big(u), cipher }) }).then(r => r.json());
  if (!r.hash) throw new Error(tErr(r.code, r.error) || r.error); return r.hash; }
async function decImg(h, k) { const u = new Uint8Array(await (await fetch(IMG(h))).arrayBuffer()), p = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, k, u.slice(12)); return URL.createObjectURL(new Blob([p])); }
// 私密卡：内容在浏览器内用 AES-GCM 加密后上链（链上只有密文）。密钥 = SHA-256(钱包对固定消息的 ed25519 签名)；托管模式由服务器以该用户密钥派生（服务器可解密）
const b64 = u => btoa(String.fromCharCode(...u)), unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const WTPriv = window.WTPriv = {
  msg: pk => new TextEncoder().encode(`WorldTree private card key v1\n${pk}`),
  async keyFromSig(sigBytes) { return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', sigBytes), 'AES-GCM', false, ['encrypt', 'decrypt']); },
  async key() { if (S.privKey && S.privKey.pk === S.pubkey) return S.privKey.k; let k;
    if (S.mode === 'self') { const r = await window.phantom.solana.signMessage(WTPriv.msg(S.pubkey), 'utf8'); k = await WTPriv.keyFromSig(r.signature || r); }
    else if (S.mode === 'host') { const r = await api('/api/privkey', {}); k = await WTPriv.keyFromSig(hex2b(r.key)); } else throw new Error('login');
    S.privKey = { pk: S.pubkey, k }; return k; },
  async enc(text, k) { const iv = crypto.getRandomValues(new Uint8Array(12)), ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(text))); const u = new Uint8Array(12 + ct.length); u.set(iv); u.set(ct, 12); return 'E1:' + b64(u); },
  async dec(c, k) { const u = unb64(c.slice(3)); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, k, u.slice(12))); } };
const sha256hex = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, '0')).join('');

const QS = new URLSearchParams(location.search);
const S = { stress: QS.has('stress') ? QS.get('stress') !== '0' : localStorage.wt_stress === '1', total: Math.min(2.75e11, Math.floor(+QS.get('stress') || +localStorage.wt_total || 1e11)), mode: 'guest', pubkey: null, email: null, token: localStorage.wt_token || null, txs: [], wishes: [], hidden: 0, offline: false, pending: [],
  history: JSON.parse(localStorage.wt_hist || '[]'), cfg: { minLamports: 6666667, solUsd: 150, priceSource: 'fallback', developer: '', treasury: '', moderator: window.WT_CONFIG?.moderatorPubkeyHex }, words: null, season: null, fulfill: {}, fulfillToast: JSON.parse(localStorage.wt_ful_toast || '{}') };
window.__S = S; // 测试/诊断用
const saveHist = () => localStorage.wt_hist = JSON.stringify(S.history.slice(0, 100));
// 调试控件：?debug=1|true 开启并写入 localStorage；?debug=0|false 清除；默认隐藏
(function applyDebug() {
  if (QS.has('debug')) {
    const v = String(QS.get('debug') || '').toLowerCase();
    if (v === '0' || v === 'false') localStorage.removeItem('wt_debug');
    else localStorage.wt_debug = '1';
  }
  document.body.classList.toggle('debug', localStorage.wt_debug === '1');
})();

// ---------- 星空背景：CSS Paint Worklet，回退 canvas（同算法：上限 180、密度≤2.5、按尺寸播种、count≤0 直接返回） ----------
(function sky() {
  if (window.CSS && CSS.paintWorklet) { CSS.paintWorklet.addModule('starfield-worklet.js'); document.documentElement.classList.add('paint'); return; }
  const c = $('#sky-fallback'), x = c.getContext('2d');
  const draw = () => { c.width = innerWidth; c.height = innerHeight; x.clearRect(0, 0, c.width, c.height); const n = Math.min(180, Math.floor(c.width * c.height / 12000 * Math.min(2.5, 1.6))); if (n <= 0) return;
    let s = (c.width * 73856093 ^ c.height * 19349663) >>> 0 || 1; const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < n; i++) { const X = r() * c.width, Y = r() * c.height, R = r() * 1.4 + .3; x.fillStyle = `rgba(255,255,230,${0.3 + r() * 0.7})`; x.beginPath(); x.arc(X, Y, R, 0, 7); x.fill(); } };
  draw(); addEventListener('resize', draw);
})();

// ---------- 读层：RPC + 本地缓存（交易不可变 → 按签名永久缓存） ----------
let rid = 0;
async function rpcAt(url, method, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }), signal: AbortSignal.timeout?.(10000) }); // 超时 10s，避免链上读取卡住
  if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { net: true });
  const j = await r.json().catch(() => { throw Object.assign(new Error('bad json'), { net: true }); });
  if (j.error) throw Object.assign(new Error(j.error.message), { net: j.error.code === -1 }); return j.result;
}
let relayDown = false; // 中继不可达时回退：浏览器直连 devnet
async function rpc(method, params) {
  if (!relayDown) { try { return await rpcAt(RPC_READ, method, params); } catch (e) { if (!e.net && !(e instanceof TypeError)) throw e; relayDown = true; } }
  return rpcAt(RPC_WRITE, method, params);
}
let txCache = {}; try { txCache = JSON.parse(localStorage.wt_txcache || '{}'); } catch {}
async function verifyAtt(memo) { // 校验审核证明：sha256(内容) == hash 且 审核服务 ed25519 签名有效；缺失/无效一律拒绝
  const m = memo.match(/^WTREE1\|[WB]\|([0-9a-f]{64})\|(\d{10})\|([0-9a-f]{128})\|([^|]{1,90}\|[^|]{1,600})$/u);
  if (!m || !S.cfg.moderator || !window.nacl) return false;
  if (await sha256hex(m[4]) !== m[1]) return false;
  return nacl.sign.detached.verify(new TextEncoder().encode(`WTREE-ATT1|${m[1]}|pass|${m[2]}`), hex2b(m[3]), hex2b(S.cfg.moderator));
}
async function parseTx(sig, tx) {
  if (!tx || tx.meta?.err) return null;
  const ins = tx.transaction.message.instructions, ix = ins.find(i => i.programId === MEMO || i.program === 'spl-memo');
  const memo = typeof ix?.parsed === 'string' ? ix.parsed : null; if (!memo || !memo.startsWith(TAG)) return null;
  const k0 = tx.transaction.message.accountKeys[0], author = k0.pubkey || k0;
  let paid = 0, devPaid = 0; for (const i of ins) if (i.program === 'system' && i.parsed?.type === 'transfer') { const d = i.parsed.info.destination;
    if (d === S.cfg.treasury) paid += i.parsed.info.lamports; if (d === S.cfg.developer) { paid += i.parsed.info.lamports; devPaid += i.parsed.info.lamports; } }
  return { sig, author, memo, time: tx.blockTime, paid, devPaid, verified: memo.startsWith(TAG + 'L|') || await verifyAtt(memo) };
}
async function loadWishes(force) {
  if (!force && S.loadedAt && Date.now() - S.loadedAt < 30000) return;
  try {
    if (QS.get('sample') === '1') throw new Error('sample=1');
    const sigs = await rpc('getSignaturesForAddress', [TREE, { limit: 500 }]);
    const need = sigs.filter(s => !(s.signature in txCache) && !s.err).map(s => s.signature);
    for (let i = 0; i < need.length; i += 10) {
      const res = await Promise.all(need.slice(i, i + 10).map(s => rpc('getTransaction', [s, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]).catch(() => undefined)));
      for (let k = 0; k < res.length; k++) if (res[k] !== undefined) txCache[need[i + k]] = await parseTx(need[i + k], res[k]);
    }
    try { localStorage.wt_txcache = JSON.stringify(txCache); localStorage.wt_sigs = JSON.stringify(sigs.filter(s => !s.err).map(s => s.signature)); } catch {}
    S.txs = sigs.map(s => txCache[s.signature]).filter(Boolean); S.offline = false;
  } catch (e) { S.offline = true; S.offlineMsg = e.message; if (!S.txs.length || S.txs === SAMPLE || QS.get('sample') === '1') S.txs = SAMPLE; } // 读取失败：保留上次缓存的真实数据，无缓存才用示例
  S.loadedAt = Date.now(); aggregate();
}
const clientBlocked = t => S.words && Object.values(S.words).flat().some(w => t.toLowerCase().includes(w.toLowerCase())); // 前端二次过滤：链上无法删除，但前端不展示
function aggregate() {
  const all = [...S.txs, ...S.pending.filter(p => !S.txs.some(t => t.sig === p.sig))].sort((a, b) => (a.time || 9e9) - (b.time || 9e9));
  const W = {}, likes = [], bless = []; let hidden = 0;
  for (const t of all) { const f = t.memo.split('|');
    if (f[1] === 'W') { if (!t.verified || clientBlocked(f[6])) { hidden++; continue; }
      const o = parseOpt(f[5]), priv = o.priv && /^E1:/.test(f[6]); if (!priv && [...f[6]].length > 140) { hidden++; continue; }
      W[t.sig] = { ...t, cat: o.cat, hue: CATS[o.cat], folded: o.folded, cover: o.cover ?? WTCovers.forCat(o.cat)[0], inside: o.inside, cimg: o.cimg, nimg: o.nimg, priv, cipher: priv ? f[6] : null, text: priv ? '🔒 ' + I18N.t('card.privateShort') : f[6], plain: t.plain, likers: new Set(), blessings: [] }; }
    else if (f[1] === 'L') likes.push([f[2], t]); else if (f[1] === 'B' && t.verified && !clientBlocked(f[6])) bless.push([f[5], t, f[6]]); }
  for (const [ws, t] of likes) W[ws]?.likers.add(t.author); // 每地址对每愿望只计 1 赞
  for (const [ws, t, text] of bless) W[ws]?.blessings.push({ author: t.author, text, time: t.time, sig: t.sig, pending: t.pending });
  S.hidden = hidden;
  // 还愿 memo：WTREE1|F|wishSig|noteHash|ts|attestation
  for (const t of all) { const f = t.memo.split('|'); if (f[1] === 'F' && f[2] && W[f[2]]) W[f[2]].fulfilled = { noteHash: f[3], ts: +f[4], attestation: f[5], sig: t.sig, onChain: true }; }
  for (const [sig, fv] of Object.entries(S.fulfill || {})) if (fv?.fulfilled && W[sig]) W[sig].fulfilled = Object.assign({}, W[sig].fulfilled || {}, { badge: true, note: fv.fulfillNote || '', ts: fv.fulfillTs || 0, tx: fv.fulfillTx, server: true });
  S.wishes = Object.values(W).map(w => Object.assign(w, { likes: w.likers.size, heat: w.likers.size * 2 + w.blessings.length * 3 })).sort((a, b) => (b.time || 9e9) - (a.time || 9e9));
}
const SAMPLE = (() => { // 仅当 RPC 不可达时展示的离线示例（非链上数据）
  const ws = [['经典', '愿家人平安喜乐'], ['风景', '希望明年能去冰岛看极光'], ['人物', '考研上岸，不负自己！'], ['动物', '愿流浪猫猫都有温暖的家'], ['卡通', '代码一次就跑通'], ['经典', '早日找到喜欢的工作'],
    ['风景', '和你一起看遍山川湖海'], ['人物', '妈妈生日快乐，永远年轻'], ['卡通', '愿星愿成真'], ['动物', '小狗健康长寿'], ['经典', '愿世界和平'], ['风景', '去看一次富士山的日出'], ['物质类', '想要一本好书陪伴冬天']];
  const out = ws.map(([c, t], i) => ({ sig: 'SAMPLE' + i, author: 'Demo' + String(i).repeat(40).slice(0, 40), time: 1791000000 + i * 3600, paid: 6666667, memo: `WTREE1|W|x|x|x|${c}|${t}`, verified: true, sample: true }));
  [0, 0, 0, 8, 8, 2, 3, 3, 3, 3].forEach((w, i) => out.push({ sig: 'SL' + i, author: 'DemoLiker' + i, time: 1791100000, memo: 'WTREE1|L|SAMPLE' + w, verified: true }));
  [['风景', 1, '愿和你在海边看一次月亮升起'], ['动物', 6, '希望家里的猫咪一直健康'], ['卡通', 11, '有一天能坐火箭去看看地球'], ['经典', 13, '新的一年万事顺遂']].forEach(([c, cv, tx], i) =>
    out.push({ sig: 'SAMPLEF' + i, author: 'DemoF' + String(i).repeat(40).slice(0, 40), time: 1791050000 + i * 3600, paid: 6666667, memo: `WTREE1|W|x|x|x|${encOpt(c, 1, cv, 0, null, null, WTInsides.forCat(c)[0])}|${tx}`, verified: true, sample: true }));
  out.push({ sig: 'SAMPLEP0', author: 'DemoP' + '7'.repeat(39), time: 1791090000, paid: 6666667, memo: `WTREE1|W|x|x|x|${encOpt('人物', 1, 3, 1)}|E1:q7m3N0sZ2hX1vR9kTq0bVhJmZ8Yp1cWf4uLx6eSa2dG3oK5n`, verified: true, sample: true });
  out.push({ sig: 'SB0', author: 'DemoBless1', time: 1791200000, memo: 'WTREE1|B|x|x|x|SAMPLE0|一定会的，祝福你们！', verified: true });
  return out; })();

// ---------- 写层：两种模式（同一份链上数据格式） ----------
function memoTx(payer, memo, lamports) {
  const p = new W3.PublicKey(payer), tx = new W3.Transaction();
  if (lamports > 0) { const dev = Math.floor(lamports * 0.2); // 资金直接从用户钱包转出：20% 开发者 / 80% 项目金库，平台不经手
    tx.add(W3.SystemProgram.transfer({ fromPubkey: p, toPubkey: new W3.PublicKey(S.cfg.developer), lamports: dev }), W3.SystemProgram.transfer({ fromPubkey: p, toPubkey: new W3.PublicKey(S.cfg.treasury), lamports: lamports - dev })); }
  tx.add(W3.SystemProgram.transfer({ fromPubkey: p, toPubkey: new W3.PublicKey(TREE), lamports: 0 })); // 0 lamport：让交易可按 TREE 地址索引
  tx.add(new W3.TransactionInstruction({ programId: new W3.PublicKey(MEMO), keys: [{ pubkey: p, isSigner: true, isWritable: false }], data: new TextEncoder().encode(memo) }));
  return tx;
}
async function moderateThenMemo(kind, prefix, text, cipher) { // 先审核（上链/付款之前），得到审核证明；私密卡：审核明文，证明绑定上链的密文
  const r = await fetch('/api/moderate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, prefix, cipher }) }).then(r => r.json());
  if (!r.pass) { const msg = r.category ? `${esc(t('mod.reject'))}<br><span class=reject>${esc(t('mod.hitCategory', { cat: modCat(r.category) }))}</span>` : esc(tErr(r.code, r.message) || t('mod.reject')); throw Object.assign(new Error(msg), { html: true }); }
  const a = r.attestation; return `WTREE1|${kind}|${a.hash}|${a.ts}|${a.sig}|${prefix}|${cipher || text}`;
}
async function submit(memo, lk, lamports = 0) { const label = t('label.' + lk);
  if (S.mode === 'guest') { toast(esc(t('tx.needLogin')), 'err'); return; }
  const tt = toast(esc(t('tx.waitSign', { label })));
  try {
    let sig;
    if (S.mode === 'self') { await needW3(); // 自托管：Phantom 签名并发送，私钥永不离开钱包
      const conn = new W3.Connection(RPC_WRITE, 'confirmed'), tx = memoTx(S.pubkey, memo, lamports);
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash(); tx.recentBlockhash = blockhash; tx.feePayer = new W3.PublicKey(S.pubkey);
      ({ signature: sig } = await window.phantom.solana.signAndSendTransaction(tx));
      addPending(sig, memo, lamports); tt.update(`${esc(t('tx.submitted', { label }))} <a target=_blank href="${EXPLORER(sig)}">${short(sig)}</a>`);
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    } else { tt.update(esc(t('tx.hostSigning', { label }))); sig = (await api('/api/memo', { memo, lamports })).signature; addPending(sig, memo, lamports); }
    tt.update(`✅ ${esc(t('tx.confirmed', { label }))} <a target=_blank href="${EXPLORER(sig)}">${esc(t('tx.viewTx'))}</a>`, 'ok');
    S.history.unshift({ sig, memo, label: lk, lamports, mode: S.mode, who: S.pubkey, at: Date.now(), status: 'ok' }); saveHist();
    S.pending = S.pending.map(p => p.sig === sig ? { ...p, pending: false } : p); await loadWishes(true); route(); return sig;
  } catch (e) { tt.update(`❌ ${esc(t('tx.failed', { label }))}${e.html ? e.message : esc(e.message || e)}`, 'err'); S.history.unshift({ memo, label: lk, mode: S.mode, who: S.pubkey, at: Date.now(), status: 'fail' }); saveHist(); }
}
function addPending(sig, memo, paid) { S.pending.push({ sig, memo, author: S.pubkey, time: null, paid, pending: true, verified: true }); aggregate(); route(); }
async function api(url, data) {
  const r = await fetch(url, { method: data ? 'POST' : 'GET', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (S.token || '') }, body: data ? JSON.stringify(data) : undefined });
  const j = await r.json(); if (!r.ok || j.error) throw new Error(tErr(j.code, j.detail) || j.error || r.status); return j;
}

// ---------- 登录 ----------
async function connectPhantom() {
  const p = window.phantom?.solana; if (!p?.isPhantom) { window.open('https://phantom.app/', '_blank'); return toast(esc(t('login.noPhantom')), 'err'); }
  const r = await p.connect(); S.mode = 'self'; S.pubkey = r.publicKey.toString(); S.email = null; renderMode(); route();
}
function emailLogin() {
  modal(`<h3>${esc(t('login.emailTitle'))}</h3><p class="notice">⚠️ ${esc(t('login.emailWarn'))}</p>
    <input id=em type=email placeholder="you@example.com" style="width:100%" dir=ltr><div class=row style="margin-top:12px"><button class=primary id=emok>${esc(t('login.btn'))}</button><button data-close>${esc(t('common.cancel'))}</button></div>`);
  $('#emok').onclick = async () => { try { const r = await api('/api/login', { email: $('#em').value.trim() }); S.token = localStorage.wt_token = r.token; S.mode = 'host'; S.email = r.email; S.pubkey = r.pubkey; closeModal(); renderMode(); route(); toast(esc(t('login.ok', { addr: short(r.pubkey) })), 'ok'); }
    catch (e) { toast(esc(t('login.fail', { msg: e.message })), 'err'); } };
}
async function logout() { if (S.mode === 'host') await api('/api/logout', {}).catch(() => {}); if (S.mode === 'self') window.phantom?.solana?.disconnect?.(); S.mode = 'guest'; S.pubkey = S.email = S.token = null; localStorage.removeItem('wt_token'); renderMode(); route(); }
async function airdrop() { const tt = toast(esc(t('airdrop.req'))); try { const r = await api('/api/airdrop', {}); tt.update(esc(t('airdrop.ok', { sig: short(r.signature) })), 'ok'); } catch (e) { tt.update(esc(e.message), 'err'); } }
function renderMode() {
  const m = { guest: `<span class="badge">${esc(t('mode.guest'))}</span>`, self: `<span class="badge b-self">${esc(t('mode.self', { addr: short(S.pubkey) }))}</span>`, host: `<span class="badge b-host">${esc(t('mode.host', { email: S.email, addr: short(S.pubkey) }))}</span>` }[S.mode];
  $('#mode').innerHTML = m + (S.mode === 'guest' ? `<button id=bp class=mlink>${esc(t('btn.phantom'))}</button><button id=be class=mlink>${esc(t('btn.email'))}</button>` : (S.mode === 'host' ? `<button id=ba class=mlink>${esc(t('btn.airdrop'))}</button>` : '') + `<button id=bo class=mlink>${esc(t('btn.logout'))}</button>`);
  $('#bp')?.addEventListener('click', connectPhantom); $('#be')?.addEventListener('click', emailLogin); $('#bo')?.addEventListener('click', logout); $('#ba')?.addEventListener('click', airdrop);
}


// ---------- 星愿大使还愿徽章（公开；收货信息永不进入前端展示逻辑之外的公开文案） ----------
async function loadFulfillment(sig) {
  if (!sig || /^SAMPLE|^SYN|^SL|^SB/.test(sig)) return null;
  try { const r = await fetch('/api/fulfillments/' + encodeURIComponent(sig)); if (!r.ok) return null; const j = await r.json(); S.fulfill[sig] = j; return j; } catch { return null; }
}
async function hydrateFulfillments(wishList) {
  const mats = (wishList || S.wishes).filter(w => w.cat === MATERIAL || w.fulfilled).slice(0, 40);
  await Promise.all(mats.map(w => loadFulfillment(w.sig)));
  aggregate();
}
function fulfillBadge(w) {
  if (!w?.fulfilled) return '';
  return `<span class="tag fulfill-badge" title="${esc(w.fulfilled.note || '')}">✨ ${esc(t('fulfill.badge'))}</span>`;
}
function maybeFulfillToast(w) {
  if (!w?.fulfilled || !w.sig) return;
  if (S.fulfillToast[w.sig]) return;
  S.fulfillToast[w.sig] = 1; try { localStorage.wt_ful_toast = JSON.stringify(S.fulfillToast); } catch {}
  toast(`✨ ${esc(t('fulfill.toast'))}`, 'ok celebrate');
}
// ---------- 滑出菜单 ----------
function setMenu(open) { const m = $('#menu'), bd = $('#menu-bd'), b = $('#burger'); if (!m) return;
  document.body.classList.toggle('menu-open', open); bd.hidden = !open; m.inert = !open; m.setAttribute('aria-hidden', !open); b.setAttribute('aria-expanded', open);
  ['#view', 'footer'].forEach(s => { const e = $(s); if (e) e.inert = open; }); window.WT_hover?.(null);
  if (open) setTimeout(() => $('#menu-x').focus(), 50); else if (document.activeElement && m.contains(document.activeElement)) b.focus(); }
$('#burger').addEventListener('click', () => setMenu(true)); $('#menu-x').addEventListener('click', () => setMenu(false)); $('#menu-bd').addEventListener('click', () => setMenu(false));
['pointerdown', 'wheel', 'touchmove'].forEach(ev => $('#menu-bd').addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }, { passive: false }));
$('#gq').addEventListener('click', () => { const sub = $('#gqsub'), o = sub.hidden; sub.hidden = !o; $('#gq').setAttribute('aria-expanded', o); });
$('#menu').addEventListener('click', e => { if (e.target.closest('nav a, #mode button')) setMenu(false); });
addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('menu-open')) { const lm = $('#langmenu'); if (lm && !lm.hidden) return; setMenu(false); } });
// ---------- UI 工具 ----------
function toast(html, cls = '') { const d = document.createElement('div'); d.className = 'toast ' + cls; d.innerHTML = html; $('#toasts').append(d);
  const kill = () => setTimeout(() => d.remove(), 9000); if (cls) kill(); d.update = (h, c = '') => { d.innerHTML = h; d.className = 'toast ' + c; if (c) kill(); }; return d; }
function modal(html, cat) { $('#modal-box').innerHTML = html; $('#modal-box').dataset.cat = cat || ''; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });
// 世界树光谱：由交易签名哈希确定性生成的唯一 SVG（灵魂绑定记录：绑定作者地址的链上交易，非代币、不可转让）
function spectrum(sig, size = 96) {
  let h = 2166136261; for (const c of sig) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const r = () => (h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296, hues = Array.from({ length: 6 }, () => Math.floor(r() * 360)), id = 'g' + sig.slice(0, 8).replace(/\W/g, '');
  const rings = hues.map((hu, i) => `<circle cx="50" cy="50" r="${46 - i * 7}" fill="none" stroke="hsl(${hu},90%,${60 + i * 4}%)" stroke-width="${2 + r() * 4}" stroke-dasharray="${1 + r() * 20} ${r() * 8}" opacity=".9"/>`).join('');
  return `<svg class=spectrum width=${size} height=${size} viewBox="0 0 100 100"><defs><radialGradient id="${id}"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="hsl(${hues[0]},100%,70%)"/><stop offset="1" stop-color="hsl(${hues[5]},80%,10%)"/></radialGradient></defs><circle cx=50 cy=50 r=50 fill="url(#${id})"/>${rings}</svg>`;
}
const likeBtn = w => `<button data-like="${esc(w.sig)}" ${w.pending || w.sample ? 'disabled' : ''}>${S.pubkey && w.likers.has(S.pubkey) ? '💖 ' + esc(t('card.liked')) : '🤍 ' + esc(t('label.like'))} ${w.likes}</button>`;
const wishCard = w => `<div class="card hover" data-cat="${w.cat}"><div>${w.pending ? '⏳ ' : ''}${esc(w.text)} ${fulfillBadge(w)}</div><div class="row muted" style="margin-top:6px">
  <span class=tag>${esc(catName(w.cat))}</span><span>${esc(t('card.author', { addr: short(w.author) }))}</span><span>${fmtT(w.time)}</span><span>🔥 ${w.heat}</span>${likeBtn(w)}<a class=btn href="#/w/${encodeURIComponent(w.sig)}">${esc(t('card.details'))}</a></div></div>`;
document.addEventListener('click', e => { const s = e.target.closest('[data-like]')?.dataset.like; if (!s) return;
  const w = S.wishes.find(x => x.sig === s); if (S.pubkey && w?.likers.has(S.pubkey)) return toast(esc(t('card.alreadyLiked'))); submit(TAG + 'L|' + s, 'like'); });
window.WT_hover = (w, e) => { const tip = $('#tip'); if (!w) { tip.hidden = true; return; } tip.hidden = false; tip.dataset.cat = w.cat;
  tip.innerHTML = `<span class=tag>${esc(catName(w.cat))}</span> <bdi>${esc(w.text)}</bdi><div class=muted>${short(w.author)} · 💖 ${w.likes} · 🙏 ${w.blessings.length}${w.pending ? ' · ⏳' + esc(t('time.pending')) : ''}</div>`;
  tip.style.left = Math.min(e.clientX + 14, innerWidth - 290) + 'px'; tip.style.top = e.clientY + 14 + 'px'; };
const isMine = w => S.pubkey && w.author === S.pubkey;
function openCardPopup(w) { if (w.folded) return openFolded(w); maybeFulfillToast(w); modal(`<div class=row>${spectrum(w.sig, 72)}<div><span class=tag>${esc(catName(w.cat))}</span> ${fulfillBadge(w)}<p style="font-size:18px;margin:.4em 0" dir=auto>${esc(w.text)}</p>
  <div class=muted>${esc(t('card.author', { addr: short(w.author) }))} · 💖 ${w.likes} · 🙏 ${w.blessings.length}</div></div></div>
  <div class=row style="margin-top:14px">${likeBtn(w)}<a class="btn primary" href="#/w/${encodeURIComponent(w.sig)}" data-close>${esc(t('card.viewDetails'))}</a><button data-close>${esc(t('common.close'))}</button></div>`, w.cat); }

// ---------- 月度树态（Asia/Shanghai 日期自动选择） ----------
function autoSeason() { const d = +new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', day: 'numeric' }).format(new Date()); return d <= 10 ? 'green' : d <= 20 ? 'bloom' : 'fall'; }
const SEASON_KEYS = ['green', 'bloom', 'fall'], seasonName = k => t('season.' + k);
const stageName = i => t('stage.' + i), STAGE_N = 5;
const stageOf = n => n < 10 ? 0 : n < 50 ? 1 : n < 200 ? 2 : n < 1000 ? 3 : 4;

// ---------- 页面 ----------
const E = (k, v) => esc(t(k, v)); // 转义后的翻译文本
const prevail = () => I18N.isZh() ? '' : `<p class="notice prevail">⚖️ ${E('legal.prevail')}</p>`;
function home() {
  const hot = [...S.wishes].sort((a, b) => b.heat - a.heat).slice(0, 5), cur = S.season || autoSeason();
  return `<div class=scene id=scene><div class="scene-ui debug-only">${SEASON_KEYS.map(k => `<button data-season=${k} class="${k === cur ? 'on' : ''}">${E('season.' + k)}${k === autoSeason() ? E('season.current') : ''}</button>`).join('')}</div></div>
  <button id=qbtn class=qbtn type=button title="${E('search.open')}" aria-label="${E('search.open')}"><svg viewBox="0 0 24 24" width=22 height=22 fill=none stroke=currentColor stroke-width=2 stroke-linecap=round><circle cx=10.5 cy=10.5 r=6.5 /><path d="M15.5 15.5 21 21"/></svg></button>
  <div class=home-spacer></div>
  <div class="home-dock debug-only"><form class="row scene-tools" id=sf><label class=agree><input type=checkbox id=stress ${S.stress ? 'checked' : ''}> ${E('home.stress')}</label><input id=stotal type=number min=1 max=275000000000 step=1 value="${S.total}" title="${E('home.stressTotal')}" style="width:150px">
  <input id=sid placeholder="${E('home.jumpPh')}" style="flex:1;min-width:160px"><button>${E('home.locate')}</button></form>
  <p class=muted style="text-align:center;margin:4px 0"><span class=stage>${E('home.stage', { stage: stageName(stageOf(S.stress ? S.total : S.wishes.length)) })}</span> · ${S.stress ? E('home.countStress', { total: num(S.total), real: num(S.wishes.length) }) : E('home.count', { n: num(S.wishes.length) })}${S.hidden ? ' · ' + E('home.hidden', { n: num(S.hidden) }) : ''}</p>
  <div class=scene-hint>${E('home.hint')} <span class=debug-only>· <a href="#lists" onclick="document.getElementById('lists').scrollIntoView({behavior:'smooth'});return false">⌄ ${E('home.rank')}</a></span></div></div>
  <div class="cols home-lists debug-only" id=lists><div class=glass><h2>🔥 ${E('home.hot')}</h2>${hot.map(wishCard).join('') || `<p class=muted>${E('common.none')}</p>`}</div><div class=glass><h2>🆕 ${E('home.new')}</h2>${S.wishes.slice(0, 5).map(wishCard).join('') || `<p class=muted>${E('common.none')}</p>`}</div></div>`;
}
function list(q) {
  const kw = q.get('q') || '', sort = q.get('sort') || 'new', cat = q.get('cat') || '', days = +q.get('days') || 0, minHeat = +q.get('heat') || 0, now = Date.now() / 1000;
  let ws = S.wishes.filter(w => (!kw || w.text.includes(kw) || w.author.startsWith(kw)) && (!cat || w.cat === cat) && (!days || (w.time || now) > now - days * 86400) && w.heat >= minHeat);
  if (sort === 'hot') ws = [...ws].sort((a, b) => b.heat - a.heat); if (sort === 'old') ws = [...ws].reverse();
  const opt = (arr, v) => arr.map(([k, l]) => `<option value="${k}" ${String(k) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('');
  return `<h2>${E('list.title')}</h2><form class=row id=lf><input name=q placeholder="${E('list.kwPh')}" value="${esc(kw)}">
  <select name=cat>${opt([['', t('list.allCats')], ...Object.keys(CATS).map(c => [c, catName(c)])], cat)}</select>
  <select name=days>${opt([[0, t('list.allTime')], [1, t('list.h24')], [7, t('list.d7')], [30, t('list.d30')]], days)}</select>
  <select name=heat>${opt([[0, t('list.heatAny')], [2, t('list.heatMin', { n: 2 })], [10, t('list.heatMin', { n: 10 })]], minHeat)}</select>
  <select name=sort>${opt([['new', t('home.new')], ['hot', t('home.hot')], ['old', t('list.sortOld')]], sort)}</select><button>${E('list.filter')}</button><button type=button id=rf>${E('list.refresh')}</button></form>
  <p class=muted>${E('list.count', { n: num(ws.length) })}</p>${ws.map(wishCard).join('')}`;
}
function detail(sig) {
  const w = S.wishes.find(x => x.sig === sig) || (/^SYN\d+$/.test(sig) && window.WT3D?.cardById(sig.slice(3))); if (!w) return `<p>${E('detail.notFound')}</p>`;
  maybeFulfillToast(w);
  if (!S.fulfill[sig] && !/^SAMPLE|^SYN|^SL|^SB/.test(sig)) loadFulfillment(sig).then(fv => { if (fv?.fulfilled) { aggregate(); if (!document.querySelector('textarea:focus') && $('#modal').hidden) route(); } });
  return `<h2>${E('detail.title')}</h2><div class=card data-cat="${w.cat}"><div class=row>${spectrum(w.sig, 120)}<div style="flex:1"><span class=tag>${esc(catName(w.cat))}</span> ${fulfillBadge(w)}<p style="font-size:22px" dir=auto>${esc(w.text)}</p></div></div>
  <p>${E('detail.author')} <code>${esc(w.author)}</code></p><p>${E('detail.time')} ${fmtT(w.time)} ${w.pending ? '（⏳ ' + E('time.pending') + '）' : ''} · ${E('detail.paid')} ${sol(w.paid || 0)} · 🔥 ${E('detail.heat', { n: w.heat })}</p>
  <p class=muted>🌈 ${E('detail.spectrum')}</p>
  <div class=row>${likeBtn(w)}<button id=share>${E('detail.share')}</button></div>
  <p>${E('detail.likers')} ${[...w.likers].map(short).join(', ') || E('common.none')}</p>
  <p>${w.sample ? E('detail.sample') : `${E('detail.chainTx')} <a target=_blank href="${EXPLORER(w.sig)}">${esc(short(w.sig))} ↗</a>`}</p></div>
  <h3>🙏 ${E('detail.blessings', { n: w.blessings.length })}</h3>${w.blessings.map(b => `<div class=card>${b.pending ? '⏳ ' : ''}<bdi>${esc(b.text)}</bdi><div class=muted>${short(b.author)} · ${fmtT(b.time)}</div></div>`).join('') || `<p class=muted>${E('detail.noBless')}</p>`}
  ${S.mode === 'guest' ? `<p class=muted>${E('detail.loginToBless')}</p>` : `<div class=card><textarea id=bt maxlength=140 dir=auto placeholder="${E('detail.blessPh')}"></textarea><button id=bs data-sig="${esc(w.sig)}" ${w.sample ? 'disabled' : ''}>${E('detail.sendBless')}</button></div>`}`;
}
function sharePng(w) { // 生成分享图（本地 canvas → PNG）+ 链接
  const c = document.createElement('canvas'); c.width = 720; c.height = 960; const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 960);
  g.addColorStop(0, '#0a0f2a'); g.addColorStop(1, `hsl(${w.hue},60%,25%)`); x.fillStyle = g; x.fillRect(0, 0, 720, 960);
  for (let i = 0; i < 120; i++) { x.fillStyle = `rgba(255,255,230,${Math.random()})`; x.fillRect(Math.random() * 720, Math.random() * 960, 2, 2); }
  x.fillStyle = `hsl(${w.hue},90%,75%)`; x.font = 'bold 40px "Noto Sans CJK SC",sans-serif'; x.fillText('🌳 ' + t('brand') + ' · ' + catName(w.cat), 50, 100);
  x.fillStyle = '#fff'; x.font = '44px "Noto Sans CJK SC",sans-serif'; let line = '', y = 260;
  for (const ch of w.text) { if (x.measureText(line + ch).width > 620) { x.fillText(line, 50, y); y += 64; line = ''; } line += ch; } x.fillText(line, 50, y);
  x.font = '26px sans-serif'; x.fillStyle = '#bbc'; x.fillText(`${t('card.author', { addr: short(w.author) })} · 💖 ${w.likes} · 🙏 ${w.blessings.length}`, 50, 860); x.fillText(location.origin + '/#/w/' + short(w.sig), 50, 905);
  const url = location.origin + '/#/w/' + encodeURIComponent(w.sig);
  modal(`<h3>${E('detail.share')}</h3><img src="${c.toDataURL('image/png')}" style="width:100%;border-radius:12px"><div class=row style="margin-top:10px">
    <a class="btn primary" download="world-tree-${w.sig.slice(0, 8)}.png" href="${c.toDataURL('image/png')}">${E('share.download')}</a><button id=cp>${E('share.copy')}</button><button data-close>${E('common.close')}</button></div>`, w.cat);
  $('#cp').onclick = () => navigator.clipboard?.writeText(url).then(() => toast(E('share.copied'), 'ok'), () => toast(esc(url)));
}
function foldInner(w, text) { const bg = w.nimg && (!w.priv || w.nimgUrl) ? (w.priv ? w.nimgUrl : IMG(w.nimg)) : (w.inside != null && window.WTInsides ? WTInsides.url(w.inside, 300, 400) : '');
  return `${bg ? `<div class=fold-inbg style="background-image:url('${bg}')"></div>` : ''}<div class=fold-inbody><span class=tag>${esc(catName(w.cat))}</span> ${fulfillBadge(w)}<p class=fold-text dir=auto>${esc(text)}</p>
  <div class=muted>${esc(t('card.author', { addr: short(w.author) }))} · 💖 ${w.likes} · 🙏 ${w.blessings.length}</div>
  <div class=row style="margin-top:12px">${likeBtn(w)}<a class="btn primary" href="#/w/${encodeURIComponent(w.sig)}" data-close>${esc(t('card.viewDetails'))}</a><button data-close>${esc(t('common.close'))}</button></div></div>`; }
function openFolded(w) { // 折页卡：封面 → 3D 翻开动画 → 内页；私密卡仅作者可解锁
  const locked = w.priv && !w.plain, mine = isMine(w);
  modal(`<div class="fold${locked ? ' locked' : ''}" id=fold><div class=fold-page id=foldPage>${locked ? `<div class=fold-lockmsg>🔒 <b>${esc(t('card.privateTitle'))}</b><p class=muted>${esc(t(mine ? 'card.privateMine' : 'card.privateOther'))}</p>
    ${mine ? `<button class=primary id=unlock>🔓 ${esc(t('card.unlock'))}</button>` : ''}<div class=row style="margin-top:10px"><button data-close>${esc(t('common.close'))}</button></div></div>` : foldInner(w, w.plain || w.text)}</div>
    <div class=fold-cover id=foldCover><div class=fold-front><img alt="" src="${w.cimg ? IMG(w.cimg) : WTCovers.url(w.cover, 300, 400)}" onerror="this.onerror=null;this.src='${WTCovers.url(w.cover, 300, 400)}'">${w.priv ? '<span class=fold-lock>🔒</span>' : ''}<span class=fold-hint>${esc(t(locked && !mine ? 'card.privateShort' : 'card.tapOpen'))}</span></div><div class=fold-back></div></div></div>`, w.cat);
  const f = $('#fold'), open = () => f.classList.add('open');
  $('#foldCover').addEventListener('click', () => { if (locked && !mine) { f.classList.add('shake'); setTimeout(() => f.classList.remove('shake'), 500); return; } open(); });
  if (!locked) setTimeout(open, 450); else if (mine) setTimeout(open, 450);
  $('#unlock')?.addEventListener('click', async () => { try { const k = await WTPriv.key(); w.plain = await WTPriv.dec(w.cipher, k); if (w.nimg && !w.nimgUrl) w.nimgUrl = await decImg(w.nimg, k).catch(() => null); $('#foldPage').innerHTML = foldInner(w, w.plain); f.classList.remove('locked'); }
    catch (e) { toast(esc(t('card.unlockFail')), 'err'); } }); }
// 光栖起源：原文（中文，所有语言均不翻译），极简 Markdown 渲染：**粗体**、### 小节、- 列表、行尾两空格换行
function mdRender(md) { const inl = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); let html = '', list = false, para = [];
  const flush = () => { if (para.length) { html += `<p>${para.map(inl).join('<br>')}</p>`; para = []; } };
  for (const raw of md.split('\n')) { const l = raw.replace(/\s+$/, '');
    if (/^\s*$/.test(l)) { flush(); continue; }
    if (l.startsWith('### ')) { flush(); if (list) { html += '</ul>'; list = false; } html += `<h3>${inl(l.slice(4))}</h3>`; continue; }
    if (/^- /.test(l)) { flush(); if (!list) { html += '<ul>'; list = true; } html += `<li>${inl(l.slice(2))}`; continue; }
    if (list && /^\s+/.test(raw)) { html += '<br>' + inl(l.trim()); continue; }
    if (list) { html += '</ul>'; list = false; } para.push(l); }
  flush(); if (list) html += '</ul>'; return html.replace(/^<p><b>([^<]+)<\/b><\/p>/, '<h1>$1</h1>'); }
function origin() { const lang = I18N.lang; fetch(`origin.${lang}.md`).then(r => r.ok ? r.text() : fetch('origin.md').then(r => r.text())).then(md => { const el = $('#origin'); if (el && el.lang === lang) el.innerHTML = mdRender(md); });
  return `<article id=origin class=origin lang="${lang}" dir="${document.documentElement.dir}"></article>`; }
const MK = () => /^#\/wish\/make/.test(location.hash); // 制作页有独立路由，任何重渲染都保持打开
function myWish() { // 我的星愿：已有心愿 + 制作我的心愿卡
  const mine = S.mode === 'guest' ? [] : S.wishes.filter(isMine);
  const thumb = w => `<button type=button class=mw data-sig="${esc(w.sig)}"><img alt="" src="${w.cimg ? IMG(w.cimg) : w.folded ? WTCovers.url(w.cover, 120, 160) : WTCovers.url(WTCovers.forCat(w.cat)[0], 120, 160)}" onerror="this.onerror=null;this.src='${WTCovers.url(w.cover ?? 0, 120, 160)}'">${w.priv ? '<i>🔒</i>' : ''}<span dir=auto>${esc(w.priv && !w.plain ? t('card.privateShort') : (w.plain || w.text))}</span></button>`;
  return `<h2>${E('nav.wish')}</h2><section class=card><h3>${E('mine.have')}</h3>${S.mode === 'guest' ? `<p class=muted>${t('mine.guest')}</p>` : mine.length ? `<div class=mw-grid>${mine.map(thumb).join('')}</div>` : `<p class=muted>${E('mine.empty')}</p>`}</section>
  <section class=card><h3>${E('mine.make')}</h3><button id=mkbtn class="primary breathe"${MK() ? ' hidden' : ''}>✨ ${E('mine.make')}</button><div id=maker${MK() ? '' : ' hidden'}>${wishPanel()}</div></section>`; }
function wishPanel() {
  if (S.mode === 'guest') return `<h2>${E('wish.title')}</h2><div class="card notice">${t('wish.guest')}</div>`;
  const min = S.cfg.minLamports, agreedTerms = localStorage.wt_terms === '1';
  return `<h2>${E('wish.title')}</h2><div class=card>
  <p class=muted>${E('wish.mode')} ${S.mode === 'self' ? '🔐 ' + E('wish.modeSelf') : '⚠️ ' + E('wish.modeHost')}</p>
  <div class=row><label>${E('wish.cat')} <select id=wc2>${Object.keys(CATS).map(c => `<option value="${c}">${esc(catName(c))}</option>`).join('')}</select></label></div>
  <div class=row><label>${E('wish.cardType')} <select id=ctype><option value=single>${E('wish.typeSingle')}</option><option value=folded>${E('wish.typeFolded')}</option></select></label></div>
  <div id=coverWrap hidden>
    <div class=muted>${E('wish.cover')}</div><div class=cover-grid id=covers>${WTCovers.list.map((c, i) => `<button type=button data-cover=${i} title="${esc(catName(c[0]))}"><img alt="" src="${WTCovers.url(i)}"></button>`).join('')}</div>
    <div class=up-row><label class=up-box sm><input type=file id=upC accept="image/*" hidden><img id=upCi alt="" hidden><span>🖼️ ${E('wish.upCover')}</span></label><button type=button id=clrC class=link hidden>${E('wish.clearUp')}</button></div>
    <div class=muted style="margin-top:10px">${E('wish.inside')}</div><div class=cover-grid id=insides>${WTInsides.list.map((c, i) => `<button type=button data-inside=${i} title="${esc(catName(c[0]))}"><img alt="" src="${WTInsides.url(i)}"></button>`).join('')}</div>
    <div class=up-row><label class=up-box sm><input type=file id=upN accept="image/*" hidden><img id=upNi alt="" hidden><span>📄 ${E('wish.upInner')}</span></label><button type=button id=clrN class=link hidden>${E('wish.clearUp')}</button></div>
    <p class=muted style="margin:4px 0">${E('wish.mixHint')}</p>
    <label class=agree><input type=checkbox id=priv> <span>🔒 ${E('wish.private')}</span></label><p class=muted style="margin:4px 0">${E('wish.privateHint')}${S.mode === 'host' ? ' ' + E('wish.privateHostNote') : ''} ${E('wish.upPrivNote')}</p></div>
  <div id=shipWrap hidden><label>${E('wish.shipping')}<textarea id=ship maxlength=500 dir=auto placeholder="${E('wish.shippingPh')}" rows=2 style="width:100%;margin-top:4px"></textarea></label>
  <p class=muted style="margin:4px 0">${E('wish.shippingHint')}</p></div>
  <textarea id=wt maxlength=140 dir=auto placeholder="${E('wish.ph')}"></textarea><div class=muted id=wc>0/140</div>
  <div class=row style="margin:8px 0"><label>${E('wish.amount')} <input id=amt type=number step=0.0001 min="${min / 1e9}" value="${(min / 1e9).toFixed(4)}"></label>
  <span class=muted>${E('wish.min', { min: sol(min), usd: S.cfg.solUsd, src: t(S.cfg.priceSource === 'fallback' ? 'wish.srcFallback' : 'wish.srcLive') })}</span></div>
  <p class=muted id=split></p>
  <div class=notice>${E('mod.notice')}</div>
  ${agreedTerms ? '' : `<label class=agree><input type=checkbox id=ag2> <span>${E('wish.agreeTerms', { doc: '\u0001' }).replace('\u0001', `<a href="#/terms" target=_blank>${E('terms.title')}</a>`)}</span></label>`}
  <label class=agree><input type=checkbox id=ag> <span>${E('mod.agree')}</span></label>
  <button id=ws class=primary disabled>✨ ${E('wish.submit')}</button></div>`;
}
function me() {
  if (S.mode === 'guest') return `<h2>${E('nav.me')}</h2><div class=card>${E('me.loginFirst')}</div>`;
  const mine = S.wishes.filter(w => w.author === S.pubkey), total = mine.reduce((s, w) => s + (w.paid || 0), 0);
  return `<h2>${E('nav.me')}</h2><div class=card>${E('me.addr')} <code>${esc(S.pubkey)}</code><br>${E('me.mode')} ${S.mode === 'self' ? E('me.modeSelf') : E('me.modeHost', { email: S.email })}
  <p>${E('me.stats', { n: mine.length, sum: sol(total) })}</p>
  ${S.mode === 'host' ? `<p class=muted>💡 ${E('me.tip')}</p>` : ''}</div>
  <h3>🌈 ${E('me.spectrum')}</h3><div class=row>${mine.map(w => `<a href="#/w/${encodeURIComponent(w.sig)}" title="${esc(w.text)}">${spectrum(w.sig, 72)}</a>`).join('') || `<span class=muted>${E('common.none')}</span>`}</div>
  <h3>${E('me.cards')}</h3>${mine.map(wishCard).join('') || `<p class=muted>${E('common.none')}</p>`}
  <h3>${E('me.history')}</h3>${S.history.filter(h => h.who === S.pubkey).map(h => `<div class="card muted">${new Date(h.at).toLocaleString(I18N.locale(), { hour12: false })} · ${esc(lbl(h.label))} · ${esc(stat(h.status))} ${h.lamports ? '· ' + sol(h.lamports) : ''} ${h.sig ? `<a target=_blank href="${EXPLORER(h.sig)}">${E('me.tx')}</a>` : ''}</div>`).join('') || `<p class=muted>${E('common.none')}</p>`}`;
}
const RULES_LIST = () => `<ul>${[1, 2, 3, 4, 5].map(i => `<li>${E('rules.' + i)}</li>`).join('')}</ul>`;
const help = () => `<h2>${E('nav.help')}</h2>${prevail()}
<div class="card" data-cat="经典"><h3>${E('help.rulesTitle')}</h3>${RULES_LIST()}</div>
<div class=card><h3>🔐 ${E('help.selfTitle')}</h3>${E('help.selfBody')}</div>
<div class="card notice"><h3>⚠️ ${E('help.hostTitle')}</h3>${E('help.hostBody')}</div>
<div class=card><h3>👀 ${E('help.guestTitle')}</h3>${E('help.guestBody')}</div>
<div class=card><h3>💰 ${E('help.feeTitle')}</h3>${E('help.feeBody')}<br><span class=muted>${E('help.developer')} ${esc(S.cfg.developer)}<br>${E('help.treasury')} ${esc(S.cfg.treasury)}</span></div>
<div class=card><h3>🛡️ ${E('help.modTitle')}</h3>${E('help.modBody')} ${E('help.modPub')} <code style="word-break:break-all">${esc(S.cfg.moderator || '')}</code></div>
<div class=card><h3>🌳 ${E('help.stageTitle')}</h3>${E('help.stageBody', { stages: Array.from({ length: STAGE_N }, (_, i) => `${stageName(i)} (≥${[0, 10, 50, 200, 1000][i]})`).join(' → '), green: seasonName('green'), bloom: seasonName('bloom'), fall: seasonName('fall') })}</div>
<div class=card><h3>📜 ${E('help.riskTitle')}</h3>${E('help.riskBody')}</div>`;
const terms = () => `<h2>${E('terms.title')}</h2>${prevail()}<div class=card>
<ol><li>${E('terms.1')}</li><li>${E('mod.notice')}</li><li>${E('terms.3')}${RULES_LIST()}</li>
${[4, 5, 6, 7, 8].map(i => `<li>${E('terms.' + i)}</li>`).join('')}</ol>
${localStorage.wt_terms === '1' ? `<p class=muted>✅ ${E('terms.agreed')}</p>` : `<button id=agreeTerms class="primary breathe">${E('terms.agreeBtn')}</button>`}</div>`;

// ---------- 路由 ----------
let ready3d = false;
async function route() {
  const [p, qs] = (location.hash.slice(1) || '/').split('?'), q = new URLSearchParams(qs || ''), v = $('#view');
  $('#banner').innerHTML = S.offline ? `⚠️ ${E('route.offline', { msg: S.offlineMsg || '' })}` : '';
  const pages = { '/': home, '': home, '/list': () => list(q), '/wish': myWish, '/wish/make': myWish, '/me': me, '/help': help, '/terms': terms, '/origin': origin };
  v.innerHTML = p.startsWith('/w/') ? detail(decodeURIComponent(p.slice(3))) : (pages[p] || (() => '<p>404</p>'))();
  document.body.classList.toggle('home', !!$('#scene')); document.querySelectorAll('#menu nav a').forEach(x => x.classList.toggle('cur', x.getAttribute('href') === '#' + (p || '/'))); document.body.style.setProperty('--hdr', (document.querySelector('header').offsetHeight + $('#banner').offsetHeight) + 'px'); if ($('#scene')) mount3d();
  $('#lf')?.addEventListener('submit', e => { e.preventDefault(); location.hash = '#/list?' + new URLSearchParams(new FormData(e.target)); });
  $('#rf')?.addEventListener('click', async () => { await loadWishes(true); route(); });
  document.querySelectorAll('[data-season]').forEach(b => b.onclick = () => { S.season = b.dataset.season; window.WT3D?.setSeason(S.season); document.querySelectorAll('[data-season]').forEach(x => x.classList.toggle('on', x === b)); });
  $('#stress')?.addEventListener('change', e => { S.stress = e.target.checked; localStorage.wt_stress = S.stress ? '1' : ''; route(); });
  $('#stotal')?.addEventListener('change', e => { S.total = Math.max(1, Math.min(2.75e11, Math.floor(+e.target.value) || 1e11)); localStorage.wt_total = S.total; if (S.stress) route(); });
  $('#sf')?.addEventListener('submit', async e => { e.preventDefault(); const v = $('#sid').value.trim().replace(/^#|^SYN/, ''), n = S.stress ? S.total : S.wishes.length;
    if (!/^\d+$/.test(v) || +v >= n) return toast(E('jump.range', { max: num(n - 1) }), 'err');
    const r = await WT3D.jumpTo(+v); if (!r) return toast(E('jump.fail'), 'err'); toast(E('jump.ok', { id: v, region: r.region, slot: r.slot }), 'ok'); setTimeout(() => openCardPopup(r.wish), 1000); });
  $('#agreeTerms')?.addEventListener('click', () => { localStorage.wt_terms = '1'; toast(E('terms.agreedToast'), 'ok'); route(); });
  const w = p.startsWith('/w/') && S.wishes.find(x => x.sig === decodeURIComponent(p.slice(3))); $('#share')?.addEventListener('click', () => sharePng(w));
  $('#bs')?.addEventListener('click', async e => { const txt = $('#bt').value.trim(); if (!txt) return; e.target.disabled = true;
    try { await submit(await moderateThenMemo('B', e.target.dataset.sig, txt), 'bless'); } catch (er) { toast(er.html ? er.message : esc(er.message), 'err'); } e.target.disabled = false; });
  document.querySelectorAll('.mw').forEach(b => b.onclick = () => { const w = S.wishes.find(x => x.sig === b.dataset.sig); if (w) openCardPopup(w); });
  $('#mkbtn')?.addEventListener('click', () => { location.hash = '#/wish/make'; });
  const ta = $('#wt'); if (ta) {
    const catSel = $('#wc2');
    const syncShip = () => { const on = catSel?.value === MATERIAL; if ($('#shipWrap')) $('#shipWrap').hidden = !on; };
    const pickCover = i => $('#covers')?.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.cover === i));
    const syncCard = () => { const f = $('#ctype')?.value === 'folded'; if ($('#coverWrap')) $('#coverWrap').hidden = !f; const ta2 = $('#wt'); if (ta2) { ta2.maxLength = f && $('#priv')?.checked ? 100 : 140; $('#wc').textContent = [...ta2.value].length + '/' + ta2.maxLength; } };
    const D = S.draft ||= {}, up = D.up ||= { C: null, N: null };
    const pickInside = i => $('#insides')?.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.inside === i));
    const showUp = (k, blob) => { const im = $('#up' + k + 'i'), clr = $('#clr' + k); if (blob) { im.src = URL.createObjectURL(blob); im.hidden = false; if (clr) clr.hidden = false; } else { im.removeAttribute('src'); im.hidden = true; if (clr) clr.hidden = true; } };
    let saveD = () => {};
    ['C', 'N'].forEach(k => { $('#up' + k)?.addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; try { up[k] = await shrinkImg(f); showUp(k, up[k]); saveD(); } catch (er) { up[k] = null; showUp(k, null); toast(esc(er.message), 'err'); } });
      $('#clr' + k)?.addEventListener('click', () => { up[k] = null; $('#up' + k).value = ''; showUp(k, null); saveD(); }); });
    $('#ctype')?.addEventListener('change', syncCard); $('#priv')?.addEventListener('change', syncCard);
    $('#covers')?.addEventListener('click', e => { const b = e.target.closest('[data-cover]'); if (b) { pickCover(+b.dataset.cover); $('#covers').dataset.auto = '0'; } });
    $('#insides')?.addEventListener('click', e => { const b = e.target.closest('[data-inside]'); if (b) { pickInside(+b.dataset.inside); $('#insides').dataset.auto = '0'; } });
    catSel?.addEventListener('change', () => { if (!$('#covers .on') || $('#covers').dataset.auto !== '0') pickCover(WTCovers.forCat(catSel.value)[0]); if (!$('#insides .on') || $('#insides').dataset.auto !== '0') pickInside(WTInsides.forCat(catSel.value)[0]); });
    pickCover(WTCovers.forCat(catSel?.value || '经典')[0]); pickInside(WTInsides.forCat(catSel?.value || '经典')[0]); syncCard();
    catSel?.addEventListener('change', syncShip);
    // 表单草稿：后台刷新/语言切换/钱包事件会重新渲染页面，这里把用户的选择写入 S.draft 并在重渲染后恢复
    const F = { wc2: 'value', ctype: 'value', priv: 'checked', wt: 'value', amt: 'value', ship: 'value', ag: 'checked', ag2: 'checked' };
    saveD = () => { D.f = Object.fromEntries(Object.entries(F).filter(([id]) => $('#' + id)).map(([id, p]) => [id, $('#' + id)[p]])); D.cover = $('#covers .on')?.dataset.cover; D.inside = $('#insides .on')?.dataset.inside; D.auto = $('#covers')?.dataset.auto; D.iauto = $('#insides')?.dataset.auto; };
    if (D.f) { for (const [id, v] of Object.entries(D.f)) { const el = $('#' + id); if (el) el[F[id]] = v; }
      if (D.cover != null) pickCover(+D.cover); if (D.inside != null) pickInside(+D.inside); if (D.auto) $('#covers').dataset.auto = D.auto; if (D.iauto) $('#insides').dataset.auto = D.iauto; ['C', 'N'].forEach(k => showUp(k, up[k])); syncCard(); }
    syncShip(); const fc = ta.closest('.card'); fc.addEventListener('input', saveD); fc.addEventListener('change', saveD); ['#covers', '#insides'].forEach(sel => $(sel)?.addEventListener('click', () => setTimeout(saveD)));
    const upd = () => { const ok = $('#ag').checked && (!$('#ag2') || $('#ag2').checked); $('#ws').disabled = !ok; $('#ws').classList.toggle('breathe', ok);
      const l = Math.round(+$('#amt').value * 1e9) || 0; $('#split').textContent = t('wish.split', { dev: sol(Math.floor(l * .2)), tre: sol(l - Math.floor(l * .2)) }); };
    fetch('/api/config').then(r => r.json()).then(c => { Object.assign(S.cfg, c); const a = $('#amt'); if (a) { a.min = c.minLamports / 1e9; if (+a.value * 1e9 < c.minLamports) a.value = (Math.ceil(c.minLamports / 1e5) / 1e4).toFixed(4); upd(); } }).catch(() => {});
    ta.addEventListener('input', () => $('#wc').textContent = [...ta.value].length + '/' + ta.maxLength); ['#ag', '#ag2', '#amt'].forEach(s => $(s)?.addEventListener('input', upd)); upd();
    $('#ws').addEventListener('click', async () => { const txt = ta.value.trim(), lam = Math.round(+$('#amt').value * 1e9), cat = $('#wc2').value;
      const shippingNote = cat === MATERIAL ? ($('#ship')?.value || '').trim() : '';
      if (!txt || [...txt].length > 140 || txt.includes('|')) return toast(E('wish.invalid'), 'err');
      if (!(lam >= S.cfg.minLamports)) return toast(E('wish.lowAmount', { min: sol(S.cfg.minLamports) }), 'err');
      $('#ws').disabled = true; const tt = toast(E('wish.moderating'));
      const folded = $('#ctype').value === 'folded', cover = +($('#covers .on')?.dataset.cover ?? WTCovers.forCat(cat)[0]), inside = +($('#insides .on')?.dataset.inside ?? WTInsides.forCat(cat)[0]), priv = folded && $('#priv').checked; let cipher, cimg = null, nimg = null;
      if (folded && (up.C || up.N)) try { tt.update(E('wish.upChecking')); const k = priv && up.N ? await WTPriv.key() : null; if (up.C) cimg = await uploadImg(up.C); if (up.N) nimg = await uploadImg(up.N, k); } catch (e) { $('#ws').disabled = false; return tt.update('❌ ' + E('wish.upFail') + ' ' + esc(e.message || ''), 'err'); }
      if (priv) { if ([...txt].length > 100) return toast(E('wish.privateLen'), 'err'); try { cipher = await WTPriv.enc(txt, await WTPriv.key()); } catch (e) { return toast(esc(t('card.unlockFail')) + ' ' + esc(e.message || ''), 'err'); } }
      let memo; try { memo = await moderateThenMemo('W', encOpt(cat, folded, cover, priv, cimg, nimg, nimg ? null : inside), txt, cipher); tt.update('✅ ' + E('wish.passed'), 'ok'); } catch (e) { tt.update(e.html ? e.message : esc(e.message), 'err'); $('#ws').disabled = false; return; }
      if ($('#ag2')) localStorage.wt_terms = '1';
      const sig = await submit(memo, 'wish', lam);
      if (sig) {
        // 链下登记：记账 +（物质类）收货/联系备注；备注永不入链
        fetch('/api/wish-paid', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (S.token || '') },
          body: JSON.stringify({ sig, cat, text: priv ? '🔒' : txt, author: S.pubkey, lamports: lam, shippingNote, source: S.mode }) }).catch(() => {});
        S.draft = null; location.hash = '#/';
      } else $('#ws').disabled = false;
    });
  }
}
// ---------- 首页放大镜：搜索（正文 / #序号 / 地址）+ 分页（每页 200 张） ----------
const idOfSig = sig => [...S.wishes].reverse().findIndex(w => w.sig === sig);
function openSearch() { const pi = window.WT3D?.pageInfo?.() || { page: 0, pages: 1, total: 0, per: 200 };
  modal(`<h3 style="margin-top:0">🔍 ${E('search.title')}</h3><form id=qf class=row style="flex-wrap:nowrap"><input id=qi style="flex:1;min-width:0" dir=auto placeholder="${E('search.ph')}" autocomplete=off><button class=primary>${E('search.go')}</button></form>
    <div id=qr class=qres></div><div class=pager><button id=pgp ${pi.page <= 0 ? 'disabled' : ''}>‹ ${E('page.prev')}</button><span id=pgl>${E('page.label', { p: num(pi.page + 1), n: num(pi.pages) })}</span><button id=pgn ${pi.page >= pi.pages - 1 ? 'disabled' : ''}>${E('page.next')} ›</button></div>
    <form id=pgf class="row pager"><label>${E('page.goto')} <input id=pgi type=number min=1 max=${pi.pages} value=${pi.page + 1} style="width:110px"></label><button>${E('page.go')}</button><span class=muted>${E('page.per', { n: pi.per, total: num(pi.total) })}</span></form>
    <div class=row style="justify-content:flex-end;margin-top:8px"><button data-close>${E('common.close')}</button></div>`);
  const go = p => { WT3D.setPage(p); closeModal(); };
  $('#pgp').onclick = () => go(pi.page - 1); $('#pgn').onclick = () => go(pi.page + 1); $('#pgf').onsubmit = e => { e.preventDefault(); go((+$('#pgi').value || 1) - 1); };
  const open = async id => { closeModal(); const r = await WT3D.jumpTo(id); if (r) setTimeout(() => openCardPopup(r.wish), 1000); else toast(E('jump.fail'), 'err'); };
  $('#qf').onsubmit = e => { e.preventDefault(); const q = $('#qi').value.trim().replace(/^#/, ''), out = $('#qr'); if (!q) return;
    const res = []; if (/^\d+$/.test(q) && +q < pi.total) res.push({ id: +q, text: '#' + q, sub: '' });
    for (const w of S.wishes) { if (res.length >= 30) break; if ((!w.priv && w.text.includes(q)) || (q.length >= 3 && w.author.startsWith(q))) res.push({ id: idOfSig(w.sig), text: w.text, sub: short(w.author) + ' · ' + catName(w.cat) }); }
    out.innerHTML = res.length ? res.map(r => `<button type=button class=qhit data-id=${r.id}><bdi>${esc(r.text)}</bdi> <span class=muted>${esc(r.sub)} · #${r.id}</span></button>`).join('') : `<p class=muted>${E('search.none')} <a href="#/wish/make" id=qmake>✨ ${E('search.make')}</a></p>`; $('#qmake')?.addEventListener('click', () => closeModal());
    out.querySelectorAll('[data-id]').forEach(b => b.onclick = () => open(+b.dataset.id)); };
  setTimeout(() => $('#qi')?.focus(), 50); }
document.addEventListener('click', e => { if (e.target.closest('#qbtn')) openSearch(); });
function syncChip(on) { let c = $('#sync'); if (!c) { c = document.createElement('div'); c.id = 'sync'; document.body.append(c); } c.textContent = '⏳ ' + t('route.loading'); c.hidden = !on; }
function refreshView() { // 后台数据到达：首页只更新 3D 数据，其他页面在用户未编辑时重渲染
  if ($('#scene') && window.WT3D) { WT3D.update(S.wishes, openCardPopup, { stress: S.stress, total: S.total }); $('#banner').innerHTML = S.offline ? `⚠️ ${E('route.offline', { msg: S.offlineMsg || '' })}` : ''; return; }
  if (!document.querySelector('textarea:focus,input:focus,select:focus') && $('#modal').hidden && !($('#wt') && $('#maker') && !$('#maker').hidden)) route(); }
function mount3d() { if (!window.WT3D) { if (!ready3d) { ready3d = true; addEventListener('wt3d-ready', () => $('#scene') && mount3d()); } return; }
  WT3D.attach($('#scene')); WT3D.setSeason(S.season || autoSeason()); WT3D.update(S.wishes, openCardPopup, { stress: S.stress, total: S.total }); }
addEventListener('hashchange', () => { closeModal(); $('#tip').hidden = true; route(); });
addEventListener('langchange', () => { renderMode(); if (window.WT3D?.relabel) WT3D.relabel(); if (!document.querySelector('textarea:focus') && $('#modal').hidden) route(); });
if ('serviceWorker' in navigator && !/localhost|127\.0\.0\.1/.test(location.hostname) || QS.get('sw') === '1') navigator.serviceWorker?.register('sw.js').catch(() => {});
(async () => {
  await I18N.ready; renderMode();
  fetch('/api/config').then(r => r.json()).then(c => Object.assign(S.cfg, c)).catch(() => {}).then(() => fetch('/api/rules')).then(r => r.json()).then(r => S.words = r.words).catch(() => {});
  if (S.token) api('/api/me').then(r => { S.mode = 'host'; S.email = r.email; S.pubkey = r.pubkey; renderMode(); route(); }).catch(() => localStorage.removeItem('wt_token'));
  window.phantom?.solana?.connect?.({ onlyIfTrusted: true }).then(r => { if (S.mode === 'guest') { S.mode = 'self'; S.pubkey = r.publicKey.toString(); renderMode(); route(); } }).catch(() => {});
  // 首屏立即渲染：先用上次缓存的链上数据（localStorage）画出世界树，链上读取在后台进行，完成后无感刷新
  try { const sigs = JSON.parse(localStorage.wt_sigs || '[]'); S.txs = sigs.map(x => txCache[x]).filter(Boolean); } catch {} aggregate(); route(); syncChip(true);
  (async () => { await loadWishes(); syncChip(false); await hydrateFulfillments(); refreshView(); })();
  setInterval(async () => { await loadWishes(true); refreshView(); }, 30000); // 正在填写心愿卡时不重渲染
})();
