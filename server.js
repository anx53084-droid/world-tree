// 世界树许愿树 —— 本地服务：静态文件 + RPC 中继 + 【演示用】托管模式后端
// ⚠️ 托管模式仅限 devnet 演示：私钥明文存于 data/users.json。生产环境必须使用 KMS/HSM，且涉及合规问题。
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const web3 = require('@solana/web3.js');
const PORT = +process.env.PORT || 8080;
const RPC = process.env.SOLANA_RPC || process.env.RPC_URL || 'https://api.devnet.solana.com';
const TREE = new web3.PublicKey('pqaQKFsNjfJKewkwEyJaNYzoKxu3sh1hmNvAGKfz5Yb');
const MEMO = new web3.PublicKey('MemoSq4gqABAXKb96qnH8TuDybDJ9cKfTLqKE7Rbr8z');
const { moderate, RULES } = require('./moderation');
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
  const m = memo.match(/^WTREE1\|[WB]\|([0-9a-f]{64})\|(\d{10})\|([0-9a-f]{128})\|([^|]{1,90}\|[^|]{1,140})$/u); if (!m) return false;
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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const body = req => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });

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

async function api(req, res, url) {
  const db = load();
  if (url === '/api/rpc' && req.method === 'POST') { // 只读 RPC 中继（同源、无 CORS；可换为索引器）
    const b = await body(req);
    try { const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b), signal: AbortSignal.timeout(10000) }); return send(res, 200, await r.json()); }
    catch (e) { return send(res, 200, { jsonrpc: '2.0', id: b.id, error: { code: -1, message: 'RPC 不可达: ' + e.message } }); }
  }
  if (url === '/api/moderate' && req.method === 'POST') { // 上链前审核（两种模式都必须先通过）
    const { text, prefix } = await body(req); // prefix = 分类（愿望）或 愿望签名（祝福）
    if (typeof text !== 'string' || !text.trim() || [...text].length > 140 || text.includes('|')) return send(res, 400, { pass: false, message: '内容需为 1–140 字，且不含字符 |' });
    if (typeof prefix !== 'string' || !/^[^|]{1,90}$/.test(prefix)) return send(res, 400, { pass: false, message: '参数无效' });
    const r = await moderate(text); return send(res, 200, r.pass ? { pass: true, attestation: attest(prefix + '|' + text) } : { pass: false, category: r.category, message: REJECT });
  }
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
  if (url === '/api/login' && req.method === 'POST') { // 演示：仅邮箱，无密码/验证码
    const { email } = await body(req);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '')) return send(res, 400, { error: '邮箱格式不正确' });
    if (!db.users[email]) { const kp = web3.Keypair.generate(); db.users[email] = { pubkey: kp.publicKey.toBase58(), secret: Buffer.from(kp.secretKey).toString('base64'), created: Date.now() }; }
    const token = crypto.randomBytes(24).toString('hex'); db.sessions[token] = email; save(db);
    return send(res, 200, { token, email, pubkey: db.users[email].pubkey });
  }
  const a = auth(req, db);
  if (url === '/api/me') return a ? send(res, 200, { email: a.email, pubkey: a.user.pubkey }) : send(res, 401, { error: '未登录' });
  if (!a) return send(res, 401, { error: '未登录' });
  const kp = web3.Keypair.fromSecretKey(Buffer.from(a.user.secret, 'base64'));
  if (url === '/api/airdrop' && req.method === 'POST') {
    try { const sig = await conn.requestAirdrop(kp.publicKey, 0.1 * web3.LAMPORTS_PER_SOL); return send(res, 200, { signature: sig }); }
    catch (e) { return send(res, 200, { error: '空投失败: ' + e.message }); }
  }
  if (url === '/api/memo' && req.method === 'POST') { // 托管签名：后端用该用户的 devnet 密钥签名
    const { memo, lamports = 0 } = await body(req);
    if (typeof memo !== 'string') return send(res, 400, { error: 'memo 无效' });
    if (/^WTREE1\|[WB]\|/.test(memo)) { if (!verifyWishMemo(memo)) return send(res, 400, { error: '缺少或无效的审核证明（attestation）' }); }
    else if (!/^WTREE1\|L\|[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(memo)) return send(res, 400, { error: 'memo 格式无效' });
    if (memo.startsWith('WTREE1|W|') && !(Number.isInteger(lamports) && lamports >= minLamports((await solPrice()).usd))) return send(res, 400, { error: '金额低于最低 1 美元等值 SOL' });
    try { const sig = await web3.sendAndConfirmTransaction(conn, buildMemoTx(kp.publicKey, memo, memo.startsWith('WTREE1|W|') ? lamports : 0), [kp], { commitment: 'confirmed' }); return send(res, 200, { signature: sig }); }
    catch (e) { return send(res, 200, { error: '上链失败: ' + e.message }); }
  }
  if (url === '/api/logout' && req.method === 'POST') { for (const [t, e] of Object.entries(db.sessions)) if (e === a.email) delete db.sessions[t]; save(db); return send(res, 200, { ok: true }); }
  send(res, 404, { error: 'not found' });
}

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (url.startsWith('/api/')) return api(req, res, url).catch(e => send(res, 500, { error: e.message }));
  let f = path.normalize(path.join(__dirname, 'public', url === '/' ? 'index.html' : url));
  if (!f.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, d) => { if (err) { res.writeHead(404); return res.end('404'); } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
}).listen(PORT, '0.0.0.0', () => console.log(`世界树许愿树 http://localhost:${PORT}  RPC=${RPC}`));
