// 世界树许愿树 —— 本地服务：静态文件 + RPC 中继 + 【演示用】托管模式后端
// ⚠️ 托管模式仅限 devnet 演示：私钥明文存于 data/users.json。生产环境必须使用 KMS/HSM，且涉及合规问题。
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const web3 = require('@solana/web3.js');
const PORT = +process.env.PORT || 8080;
const RPC = process.env.SOLANA_RPC || process.env.RPC_URL || 'https://api.devnet.solana.com';
const TREE = new web3.PublicKey('pqaQKFsNjfJKewkwEyJaNYzoKxu3sh1hmNvAGKfz5Yb');
const MEMO = new web3.PublicKey('MemoSq4gqABAXKb96qnH8TuDybDJ9cKfTLqKE7Rbr8z');
const { moderate, RULES } = require('./moderation');
const Fulfill = require('./fulfillment');
const REJECT = '您的内容未通过审核（可能涉及违规或不符合正向要求），请修改后重新提交。';
const nacl = require('tweetnacl');
const WTA = require('./public/addr.js'); // 分层地址空间（与前端共用）
// 审核服务 ed25519 签名密钥（演示：本地生成并保存；生产应放 KMS/HSM，并升级为多节点门限签名）
const DATA_DIR = path.join(__dirname, 'data'); fs.mkdirSync(DATA_DIR, { recursive: true });
const MODKEY_F = path.join(DATA_DIR, 'moderator.json');
function parseSecret(v) { v = String(v).replace(/^\s*MODERATOR_SECRET\s*=\s*/,'').replace(/[\s`'"]/g,''); if (/^[0-9a-fA-F]{128}$/.test(v)) return Buffer.from(v, 'hex'); try { const b = require('bs58').decode(v); if (b.length === 64) return Buffer.from(b); } catch {} const b = Buffer.from(v, 'base64'); if (b.length === 64) return b; throw new Error('MODERATOR_SECRET must be a 64-byte ed25519 secret key (hex/base58/base64)'); }
let MODKEY;
if (process.env.MODERATOR_SECRET) { try { MODKEY = nacl.sign.keyPair.fromSecretKey(parseSecret(process.env.MODERATOR_SECRET)); console.log('moderator key: from MODERATOR_SECRET env'); } catch (e) { console.warn('WARNING: invalid MODERATOR_SECRET (' + e.message + '), falling back'); } }
if (!MODKEY) { try { MODKEY = nacl.sign.keyPair.fromSecretKey(Buffer.from(JSON.parse(fs.readFileSync(MODKEY_F)).secret, 'base64')); console.log('moderator key: from data/moderator.json'); }
  catch { MODKEY = nacl.sign.keyPair(); fs.writeFileSync(MODKEY_F, JSON.stringify({ secret: Buffer.from(MODKEY.secretKey).toString('base64') }), { mode: 0o600 });
    console.warn('⚠️  WARNING: no MODERATOR_SECRET env and no data/moderator.json — generated an EPHEMERAL moderator key. Previously signed wishes will fail verification after restart/redeploy. Set MODERATOR_SECRET.'); } }
const MOD_PUB = Buffer.from(MODKEY.publicKey).toString('hex');
fs.writeFileSync(path.join(__dirname, 'public', 'config.js'), `window.WT_CONFIG = { moderatorPubkeyHex: '${MOD_PUB}' };\n`);
const sha256hex = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
const attMsg = (hash, ts) => Buffer.from(`WTREE-ATT1|${hash}|pass|${ts}`, 'utf8');
function attest(text) { const hash = sha256hex(text), ts = Math.floor(Date.now() / 1000); return { hash, ts, sig: Buffer.from(nacl.sign.detached(attMsg(hash, ts), MODKEY.secretKey)).toString('hex'), moderator: MOD_PUB }; }
function verifyWishMemo(memo) { // WTREE1|W|hash|ts|sig|分类|正文  或  WTREE1|B|hash|ts|sig|愿望签名|祝福
  const m = memo.match(/^WTREE1\|[WB]\|([0-9a-f]{64})\|(\d{10})\|([0-9a-f]{128})\|([^|]{1,90}\|[^|]{1,600})$/u); if (!m) return false;
  return sha256hex(m[4]) === m[1] && nacl.sign.detached.verify(attMsg(m[1], m[2]), Buffer.from(m[3], 'hex'), MODKEY.publicKey);
}
const PAYEES_F = path.join(DATA_DIR, 'payees.json'); let PAYEES = null; try { PAYEES = JSON.parse(fs.readFileSync(PAYEES_F)); } catch {}
if (!PAYEES) { const d = web3.Keypair.generate(), t = web3.Keypair.generate(); PAYEES = { developer: { pubkey: d.publicKey.toBase58(), secret: Array.from(d.secretKey) }, treasury: { pubkey: t.publicKey.toBase58(), secret: Array.from(t.secretKey) } };
  if (!process.env.DEV_PUBKEY || !process.env.TREASURY_PUBKEY) { fs.writeFileSync(PAYEES_F, JSON.stringify(PAYEES, null, 2), { mode: 0o600 }); console.warn('⚠️  generated new devnet payee keypairs in data/payees.json (set DEV_PUBKEY / TREASURY_PUBKEY)'); } }
if (process.env.DEV_PUBKEY) PAYEES.developer = { pubkey: process.env.DEV_PUBKEY }; if (process.env.TREASURY_PUBKEY) PAYEES.treasury = { pubkey: process.env.TREASURY_PUBKEY }; // devnet 演示收款地址（开发者 20% / 项目金库 80%）
const DEV = new web3.PublicKey(PAYEES.developer.pubkey), TREASURY = new web3.PublicKey(PAYEES.treasury.pubkey);
const MIN_USD = 1, SOL_USD_FALLBACK = +process.env.SOL_USD || 150; let priceCache = { usd: SOL_USD_FALLBACK, src: 'fallback', at: 0 };
async function solPrice() { if (Date.now() - priceCache.at < 600000) return priceCache;
  try { const j = await (await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { signal: AbortSignal.timeout(3000) })).json(); if (j.solana.usd > 0) priceCache = { usd: j.solana.usd, src: 'coingecko', at: Date.now() }; }
  catch { priceCache = { usd: SOL_USD_FALLBACK, src: 'fallback', at: Date.now() }; } return priceCache; }
const minLamports = usd => Math.ceil(MIN_USD / usd * web3.LAMPORTS_PER_SOL);
const DB = path.join(__dirname, 'data', 'users.json');
const conn = new web3.Connection(RPC, 'confirmed');
const load = () => { try { return JSON.parse(fs.readFileSync(DB)); } catch { return { users: {}, sessions: {} }; } };
const save = d => { fs.mkdirSync(path.dirname(DB), { recursive: true }); fs.writeFileSync(DB, JSON.stringify(d, null, 2), { mode: 0o600 }); };
const MIME = { '.md': 'text/markdown; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const body = (req, max = 64000) => new Promise(r => { let b = ''; req.on('data', c => { b += c; if (b.length > max) { r({ tooBig: true }); req.destroy(); } }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });

// ---- 自定义图片（封面/内页模板）----
// ⚠️ Render 免费实例磁盘是临时的：重新部署/重启后 data/img 会丢失（卡片回退到内置封面）。持久化方案：Render Disk（付费）或对象存储 / IPFS（见 README）。
const Store = require('./storage'); console.log('image storage:', Store.kind);
const IMG_MAX = 300 * 1024, IMG_DIM = 1024;
function imgDims(b, mime) { // 解析图片头部得到宽高（不完整解码）
  if (mime === 'image/jpeg') { let i = 2; while (i + 9 < b.length) { if (b[i] !== 0xFF) return null; const m = b[i + 1], L = b.readUInt16BE(i + 2); if (m >= 0xC0 && m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(m)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; i += 2 + L; } return null; }
  const c = b.toString('ascii', 12, 16); if (c === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (c === 'VP8L') { const n = b.readUInt32LE(21); return [(n & 0x3fff) + 1, ((n >> 14) & 0x3fff) + 1]; } if (c === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)]; return null; }
// 可插拔 NSFW 检测：设置 NSFW_URL 后，把图片 POST 过去（期望返回 {nsfw: 0..1}），≥ NSFW_MAX(默认 .6) 拒绝；未配置时仅做基础检查（如实披露）
const NSFW = require('./nsfw'); // 默认：服务器内置开源分类器（nsfwjs）；NSFW_URL 可覆盖为外部服务
async function nsfwCheck(buf, mime) { if (!process.env.NSFW_URL) { try { return await NSFW.check(buf); } catch (e) { console.warn('nsfw error', e.message); return { pass: false, error: 'nsfw classifier unavailable' }; } }
  try { const j = await (await fetch(process.env.NSFW_URL, { method: 'POST', headers: { 'content-type': mime }, body: buf, signal: AbortSignal.timeout(15000) })).json(); const sc = +j.nsfw || +j.score || 0; return { pass: sc < (+process.env.NSFW_MAX || .6), score: sc, provider: 'remote' }; }
  catch (e) { return { pass: false, error: 'nsfw service unavailable' }; } } // 失败即拒绝（fail closed）
async function imgUpload(b) {
  if (b.tooBig) return { error: '图片过大', code: 'imgSize' };
  const mime = b.mime, raw = typeof b.data === 'string' ? Buffer.from(b.data, 'base64') : null; if (!raw || !['image/webp', 'image/jpeg'].includes(mime)) return { error: '仅支持 webp/jpeg', code: 'imgType' };
  if (raw.length > IMG_MAX) return { error: '图片过大', code: 'imgSize' };
  const isJ = raw[0] === 0xFF && raw[1] === 0xD8, isW = raw.toString('ascii', 0, 4) === 'RIFF' && raw.toString('ascii', 8, 12) === 'WEBP'; if (!(mime === 'image/jpeg' ? isJ : isW)) return { error: '文件内容与类型不符', code: 'imgType' };
  const d = imgDims(raw, mime); if (!d || d[0] < 16 || d[1] < 16 || d[0] > IMG_DIM || d[1] > IMG_DIM) return { error: '图片尺寸无效（需 16–1024px）', code: 'imgDim' };
  const ns = await nsfwCheck(raw, mime); if (!ns.pass) return { error: ns.error || '图片未通过审核', code: ns.error ? 'imgSvc' : 'imgReject' };
  // 私密卡内页：审核明文，只存客户端 AES-GCM 加密后的密文（服务器不保存明文）
  let store = raw, smime = mime; if (b.cipher != null) { const c = typeof b.cipher === 'string' ? Buffer.from(b.cipher, 'base64') : null; if (!c || c.length < 28 || c.length > IMG_MAX + 64) return { error: '参数无效', code: 'param' }; store = c; smime = 'application/octet-stream'; }
  const h = crypto.createHash('sha256').update(store).digest('hex').slice(0, 32);
  try { await Store.put(h, store, { mime: smime, w: d[0], h: d[1], enc: b.cipher != null, nsfw: ns.provider, at: Date.now() }); } catch (e) { return { error: '图片存储失败', code: 'imgStore' }; }
  return { hash: h, w: d[0], h: d[1], checks: ['type', 'magic', 'size', 'dims', 'nsfw:' + ns.provider] }; }

function buildMemoTx(payer, memo, lamports) {
  const tx = new web3.Transaction();
  if (lamports > 0) { const dev = Math.floor(lamports * 0.2); // 直接从用户账户转给收款方：20% 开发者 / 80% 金库
    tx.add(web3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: DEV, lamports: dev }), web3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: TREASURY, lamports: lamports - dev })); }
  // 0 lamport 转账给固定 TREE 地址，使该笔交易可通过 getSignaturesForAddress(TREE) 被索引
  tx.add(web3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: TREE, lamports: 0 }));
  tx.add(new web3.TransactionInstruction({ programId: MEMO, keys: [{ pubkey: payer, isSigner: true, isWritable: false }], data: Buffer.from(memo, 'utf8') }));
  return tx;
}
function auth(req, db) { const t = (req.headers.authorization || '').replace('Bearer ', ''); const e = db.sessions[t]; return e && db.users[e] ? { email: e, user: db.users[e] } : null; }

const RPCC = new Map();
async function api(req, res, url) {
  const db = load();
  if (url === '/api/rpc' && req.method === 'POST') { // 只读 RPC 中继（同源、无 CORS；可换为索引器）
    const b = await body(req), key = JSON.stringify([b.method, b.params]), hit = RPCC.get(key);
    // 缓存：已确认交易不可变（永久缓存，LRU 上限）；签名列表 15s 新鲜，RPC 失败时返回旧数据（stale-if-error）
    const ttl = b.method === 'getTransaction' ? Infinity : b.method === 'getSignaturesForAddress' ? 15000 : 0;
    if (hit && Date.now() - hit.at < ttl) return send(res, 200, { jsonrpc: '2.0', id: b.id, result: hit.result });
    try { const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b), signal: AbortSignal.timeout(8000) }); const j = await r.json();
      if (ttl && j && j.result != null && !j.error) { RPCC.set(key, { at: Date.now(), result: j.result }); if (RPCC.size > 3000) RPCC.delete(RPCC.keys().next().value); }
      if (j.error && hit) return send(res, 200, { jsonrpc: '2.0', id: b.id, result: hit.result }); return send(res, 200, j); }
    catch (e) { if (hit) return send(res, 200, { jsonrpc: '2.0', id: b.id, result: hit.result }); return send(res, 200, { jsonrpc: '2.0', id: b.id, error: { code: -1, message: 'RPC 不可达: ' + e.message } }); }
  }
  if (url === '/api/moderate' && req.method === 'POST') { // 上链前审核（两种模式都必须先通过）
    const { text, prefix, cipher } = await body(req); // prefix = 分类[~F封面[P]]（愿望）或 愿望签名（祝福）；私密卡附 cipher（E1: AES-GCM 密文），审核明文、证明绑定密文
    const priv = typeof prefix === 'string' && /~F[0-9a-z]{2}P(~|$)/.test(prefix);
    for (const h of (typeof prefix === 'string' ? prefix.match(/~[CN]([0-9a-f]{32})/g) || [] : [])) if (!(await Store.has(h.slice(2)).catch(() => false))) return send(res, 400, { pass: false, message: '图片未上传或未通过审核', code: 'img' }); // 引用的图片必须已通过上传审核
    if (priv && (typeof cipher !== 'string' || !/^E1:[A-Za-z0-9+/=]{24,560}$/.test(cipher) || [...(text || '')].length > 100)) return send(res, 400, { pass: false, message: '私密卡参数无效', code: 'param' });
    if (typeof text !== 'string' || !text.trim() || [...text].length > 140 || text.includes('|')) return send(res, 400, { pass: false, message: '内容需为 1–140 字，且不含字符 |', code: 'len' });
    if (typeof prefix !== 'string' || !/^[^|]{1,90}$/.test(prefix)) return send(res, 400, { pass: false, message: '参数无效', code: 'param' });
    const r = await moderate(text); return send(res, 200, r.pass ? { pass: true, attestation: attest(prefix + '|' + (priv ? cipher : text)) } : { pass: false, category: r.category, message: REJECT, code: 'reject' });
  }
  if (url === '/api/img' && req.method === 'POST') { // 用户自定义模板图片：链下存储（memo 仅存内容哈希），上传即自动审核
    const r = await imgUpload(await body(req, 700000)); return send(res, r.error ? 400 : 200, r); }
  if (url.startsWith('/api/img/') && req.method === 'GET') { const h = url.slice(9); if (!/^[0-9a-f]{32}$/.test(h)) return send(res, 400, { error: 'bad hash' });
    if (Store.publicUrl) { res.writeHead(302, { location: Store.publicUrl + '/' + h }); return res.end(); }
    try { const g = await Store.get(h); if (!g) throw 0; const d = g.data, m = g; res.writeHead(200, { 'content-type': m.mime, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' }); return res.end(d); }
    catch { return send(res, 404, { error: 'not found', code: 'gone' }); } }
  if (url === '/api/tiles' || url.startsWith('/api/tiles/')) { // 【模拟索引器】区域瓦片：确定性合成任意总量的卡片（真实后端见 README「扩展到千亿」）
    const q = new URL(req.url, 'http://x').searchParams, N = Math.min(WTA.CAPACITY, Math.max(0, Math.floor(+q.get('total') || 1e11))), level = q.get('level') || 'count';
    const regs = url === '/api/tiles' ? (q.get('regions') || '').split(',').slice(0, 64) : [decodeURIComponent(url.slice(11))];
    const one = r => { r = r === 'root' || r === '_' ? '' : r; if (!WTA.valid(r)) return { region: r, error: 'bad region' }; const c = WTA.count(r, N);
      if (level === 'cards') return { region: r, count: c, cards: c <= WTA.HANG ? WTA.cardsIn(r, N).map(WTA.synth) : [] };
      const kids = r.length < WTA.DEPTH ? [...WTA.HEX].map(h => WTA.count(r + h, N)) : [];
      return { region: r, count: c, children: kids, grand: r.length < WTA.DEPTH - 1 ? [...WTA.HEX].flatMap(a => [...WTA.HEX].map(b => WTA.count(r + a + b, N))) : [] }; };
    res.setHeader('cache-control', 'public, max-age=60');
    return send(res, 200, url === '/api/tiles' ? { total: N, level, tiles: regs.map(one) } : { total: N, level, ...one(regs[0]) });
  }
  if (url === '/api/config') { const p = await solPrice(); return send(res, 200, { developer: DEV.toBase58(), treasury: TREASURY.toBase58(), split: [20, 80], minUsd: MIN_USD, solUsd: p.usd, priceSource: p.src, minLamports: minLamports(p.usd), moderator: MOD_PUB }); }
  if (url === '/api/rules') return send(res, 200, { categories: Object.keys(RULES), words: RULES }); // 供前端展示过滤
  // —— 星愿大使 / 还愿（公开只读徽章；履约联系方式仅存链下）——
  if (url.startsWith('/api/fulfillments/') && req.method === 'GET') {
    const sig = decodeURIComponent(url.slice('/api/fulfillments/'.length).split('/')[0] || '');
    const v = Fulfill.publicView(sig); return v ? send(res, 200, v) : send(res, 404, { error: 'not found', code: 'nf' });
  }
  if (url === '/api/wish-paid' && req.method === 'POST') { // 付款成功后登记记账 +（物质类）可选收货/联系备注（永不入链）
    const b = await body(req);
    const r = Fulfill.registerWish({ wishSig: b.sig || b.wishSig, cat: b.cat, text: b.text, author: b.author, lamports: b.lamports, shippingNote: b.shippingNote, source: b.source || 'client' });
    if (r.error) return send(res, 400, r);
    return send(res, 200, { ok: true, material: !!r.material, status: r.status || null, fundBps: Fulfill.FULFILL_FUND_BPS });
  }
  if (url === '/api/admin/fulfillments' || url.startsWith('/api/admin/fulfillments')) {
    if (!Fulfill.ADMIN_KEY) return send(res, 403, { error: 'admin disabled (ADMIN_KEY unset)', code: 'admin' });
    if (!Fulfill.adminOk(req)) return send(res, 403, { error: 'forbidden', code: 'admin' });
    if (url === '/api/admin/fulfillments' && req.method === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams;
      const status = q.get('status') || 'pending';
      return send(res, 200, { fundBps: Fulfill.FULFILL_FUND_BPS, items: status === 'all' ? Fulfill.listAll() : status === 'pending' ? Fulfill.listPending() : Fulfill.listAll(status) });
    }
    if (url === '/api/admin/fulfillments/fulfill' && req.method === 'POST') {
      const b = await body(req);
      if (!b.wishSig || typeof b.wishSig !== 'string') return send(res, 400, { error: 'wishSig required', code: 'param' });
      const r = await Fulfill.markFulfilled({ wishSig: b.wishSig, note: b.note || '', tipLamports: b.tipLamports || 0, tipTo: b.tipTo, modKey: MODKEY, conn });
      return send(res, r.ok ? 200 : 400, r);
    }
    return send(res, 404, { error: 'not found' });
  }
  if (url === '/api/login' && req.method === 'POST') { // 演示：仅邮箱，无密码/验证码
    const { email } = await body(req);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '')) return send(res, 400, { error: '邮箱格式不正确', code: 'email' });
    if (!db.users[email]) { const kp = web3.Keypair.generate(); db.users[email] = { pubkey: kp.publicKey.toBase58(), secret: Buffer.from(kp.secretKey).toString('base64'), created: Date.now() }; }
    const token = crypto.randomBytes(24).toString('hex'); db.sessions[token] = email; save(db);
    return send(res, 200, { token, email, pubkey: db.users[email].pubkey });
  }
  const a = auth(req, db);
  if (url === '/api/me') return a ? send(res, 200, { email: a.email, pubkey: a.user.pubkey }) : send(res, 401, { error: '未登录', code: 'auth' });
  if (!a) return send(res, 401, { error: '未登录', code: 'auth' });
  const kp = web3.Keypair.fromSecretKey(Buffer.from(a.user.secret, 'base64'));
  if (url === '/api/privkey' && req.method === 'POST') return send(res, 200, { key: crypto.createHmac('sha256', Buffer.from(kp.secretKey)).update('WTREE-PRIV1').digest('hex') }); // 托管模式私密卡密钥（服务器可派生 → 托管模式下服务器可解密）
  if (url === '/api/airdrop' && req.method === 'POST') {
    try { const sig = await conn.requestAirdrop(kp.publicKey, 0.1 * web3.LAMPORTS_PER_SOL); return send(res, 200, { signature: sig }); }
    catch (e) { return send(res, 200, { error: '空投失败: ' + e.message, code: 'airdrop', detail: e.message }); }
  }
  if (url === '/api/memo' && req.method === 'POST') { // 托管签名：后端用该用户的 devnet 密钥签名
    const { memo, lamports = 0 } = await body(req);
    if (typeof memo !== 'string') return send(res, 400, { error: 'memo 无效', code: 'memo' });
    if (/^WTREE1\|[WB]\|/.test(memo)) { if (!verifyWishMemo(memo)) return send(res, 400, { error: '缺少或无效的审核证明（attestation）', code: 'att' }); }
    else if (!/^WTREE1\|L\|[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(memo)) return send(res, 400, { error: 'memo 格式无效', code: 'memo' });
    if (memo.startsWith('WTREE1|W|') && !(Number.isInteger(lamports) && lamports >= minLamports((await solPrice()).usd))) return send(res, 400, { error: '金额低于最低 1 美元等值 SOL', code: 'amount' });
    try { const wishLam = memo.startsWith('WTREE1|W|') ? lamports : 0; const sig = await web3.sendAndConfirmTransaction(conn, buildMemoTx(kp.publicKey, memo, wishLam), [kp], { commitment: 'confirmed' });
      if (wishLam > 0) { const parts = memo.split('|'); Fulfill.registerWish({ wishSig: sig, cat: parts[5].split('~')[0], text: /~F..P(~|$)/.test(parts[5]) ? '🔒' : parts[6], author: kp.publicKey.toBase58(), lamports: wishLam, source: 'host' }); }
      return send(res, 200, { signature: sig }); }
    catch (e) { return send(res, 200, { error: '上链失败: ' + e.message, code: 'chain', detail: e.message }); }
  }
  if (url === '/api/logout' && req.method === 'POST') { for (const [t, e] of Object.entries(db.sessions)) if (e === a.email) delete db.sessions[t]; save(db); return send(res, 200, { ok: true }); }
  send(res, 404, { error: 'not found' });
}

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (url.startsWith('/api/')) return api(req, res, url).catch(e => send(res, 500, { error: e.message }));
  let f = path.normalize(path.join(__dirname, 'public', url === '/' ? 'index.html' : url));
  if (!f.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  // 静态资源：ETag + 304；vendor（第三方库）长缓存，其余 no-cache（每次轻量校验，部署即生效）；压缩由 Render 边缘（brotli）完成
  fs.stat(f, (err, st) => { if (err || !st.isFile()) { res.writeHead(404); return res.end('404'); }
    const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`, cc = url.startsWith('/vendor/') || url.startsWith('/models/') ? 'public, max-age=604800, stale-while-revalidate=2592000' : 'no-cache';
    const h = { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': cc, etag, vary: 'accept-encoding', 'x-wt': '1' }; // x-wt：供 Service Worker 识别真实响应（排除 Render 冷启动等待页）
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, h); return res.end(); }
    fs.readFile(f, (e2, d) => { if (e2) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, h); res.end(d); }); });
}).listen(PORT, '0.0.0.0', () => console.log(`世界树许愿树 http://localhost:${PORT}  RPC=${RPC}`));
