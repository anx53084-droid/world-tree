// 世界树许愿树 —— 本地服务：静态文件 + RPC 中继 + 【演示用】托管模式后端
// ⚠️ 托管模式仅限 devnet 演示：私钥明文存于 data/users.json。生产环境必须使用 KMS/HSM，且涉及合规问题。
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
require('./persist').init(); // D1 持久化：先拉取数据到 data/，再加载各模块
const web3 = require('@solana/web3.js');
const PORT = +process.env.PORT || 8080;
const RPC = process.env.SOLANA_RPC || process.env.RPC_URL || 'https://api.devnet.solana.com';
const TREE = new web3.PublicKey('pqaQKFsNjfJKewkwEyJaNYzoKxu3sh1hmNvAGKfz5Yb');
const MEMO = new web3.PublicKey('MemoSq4gqABAXKb96qnH8TuDybDJ9cKfTLqKE7Rbr8z');
const { moderate, RULES } = require('./moderation');
const Fulfill = require('./fulfillment');
const Acc = require('./account');
const Block = require('./blocklist');
const Goods = require('./goods'); // 心愿卡商品链接预览（SSRF 防护）
const Gate = require('./gate'), Ads = require('./ads'); const Soc = require('./social'); // 交友卡联系方式（链下）+ 礼品卡索引 // 钓鱼 / 短链黑名单（服务器端权威）
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
  const m = memo.match(/^WTREE1\|[WB]\|([0-9a-f]{64})\|(\d{10})\|([0-9a-f]{128})\|([^|]{1,400}\|[^|]{1,600})$/u); if (!m) return false;
  return sha256hex(m[4]) === m[1] && nacl.sign.detached.verify(attMsg(m[1], m[2]), Buffer.from(m[3], 'hex'), MODKEY.publicKey);
}
const PAYEES_F = path.join(DATA_DIR, 'payees.json'); let PAYEES = null; try { PAYEES = JSON.parse(fs.readFileSync(PAYEES_F)); } catch {}
if (!PAYEES) { const r = web3.Keypair.generate(); PAYEES = { receive: { pubkey: r.publicKey.toBase58(), secret: Array.from(r.secretKey) }, developer: { pubkey: r.publicKey.toBase58() }, treasury: { pubkey: r.publicKey.toBase58() } };
  if (!process.env.RECEIVE_PUBKEY && !process.env.TREASURY_PUBKEY && !process.env.DEV_PUBKEY) { fs.writeFileSync(PAYEES_F, JSON.stringify(PAYEES, null, 2), { mode: 0o600 }); console.warn('⚠️  generated new devnet receive keypair in data/payees.json (set RECEIVE_PUBKEY)'); } }
// 单一 Solana 收款地址（全额）；优先 RECEIVE_PUBKEY，其次 TREASURY_PUBKEY / DEV_PUBKEY / 本地 payees
const recvStr = process.env.RECEIVE_PUBKEY || process.env.TREASURY_PUBKEY || process.env.DEV_PUBKEY || PAYEES.receive?.pubkey || PAYEES.treasury?.pubkey || PAYEES.developer?.pubkey;
PAYEES.receive = { pubkey: recvStr }; PAYEES.developer = { pubkey: recvStr }; PAYEES.treasury = { pubkey: recvStr };
const RECEIVE = new web3.PublicKey(recvStr), DEV = RECEIVE, TREASURY = RECEIVE;
const MIN_USD = 1, SOL_USD_FALLBACK = +process.env.SOL_USD || 150; let priceCache = { usd: SOL_USD_FALLBACK, src: 'fallback', at: 0 };
const COIN_FB = { ethereum: +process.env.ETH_USD || 3000, binancecoin: +process.env.BNB_USD || 600 }; priceCache.coins = { ...COIN_FB };
async function solPrice() { if (Date.now() - priceCache.at < 600000) return priceCache;
  try { const j = await (await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana,ethereum,binancecoin&vs_currencies=usd', { signal: AbortSignal.timeout(3000) })).json(); if (j.solana.usd > 0) priceCache = { usd: j.solana.usd, src: 'coingecko', at: Date.now(), coins: { ethereum: j.ethereum?.usd || COIN_FB.ethereum, binancecoin: j.binancecoin?.usd || COIN_FB.binancecoin } }; }
  catch { priceCache = { usd: SOL_USD_FALLBACK, src: 'fallback', at: Date.now(), coins: { ...COIN_FB } }; } return priceCache; }
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
  if (lamports > 0) // 全额转入单一收款地址（无 20/80 拆分）
    tx.add(web3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: RECEIVE, lamports }));
  // 0 lamport 转账给固定 TREE 地址，使该笔交易可通过 getSignaturesForAddress(TREE) 被索引
  tx.add(web3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: TREE, lamports: 0 }));
  tx.add(new web3.TransactionInstruction({ programId: MEMO, keys: [{ pubkey: payer, isSigner: true, isWritable: false }], data: Buffer.from(memo, 'utf8') }));
  return tx;
}
function auth(req, db) { const t = (req.headers.authorization || '').replace('Bearer ', ''), s = t && db.sessions[t]; if (!s || !db.users[s.uid]) return null;
  if (Date.now() - (s.last || 0) > 300000) { s.last = Date.now(); s.ua = String(req.headers['user-agent'] || s.ua || '').slice(0, 200); save(db); } // 最近活跃（5 分钟粒度）
  return { email: s.uid, uid: s.uid, user: db.users[s.uid], token: t, sess: s }; }
const kindOf = uid => uid.startsWith('evm:') ? 'evm' : uid.startsWith('sol:') ? 'sol' : 'email';
const meOf = (uid, u) => ({ uid, kind: kindOf(uid), email: kindOf(uid) === 'email' ? uid : null, pubkey: u.pubkey, evm: u.evm || null, verified: !!u.verified, totp: !!u.totp?.on, custodial: !!u.secret, largeUsd: u.largeUsd || 20, country: u.country || '', province: u.province || '', city: u.city || '' });
function allowHost(req) { const hs = new Set([req.headers.host]); const o = req.headers.origin; if (o && (CORS_RE.test(o) || ALLOWED.includes(o))) try { hs.add(new URL(o).host); } catch {} return d => hs.has(d); }
const fail = (res, e, code = 400) => send(res, code, { error: e.message, code: e.code || 'err' });

const goodsCache = new Map(), goodsRate = new Map(); // 预览缓存（10 分钟）与每用户限速（20 次/10 分钟）
async function goodsImage(u) { // 商品图：安全抓取 → sharp 转 webp ≤800px → 与用户上传同一管线（NSFW + R2）
  const r = await Goods.fetchSafe(u, Block, Goods.MAX_IMG, 'image/avif,image/webp,image/png,image/jpeg,image/*'); if (!/^image\//i.test(r.type) && r.buf.length < 64) throw Object.assign(new Error('not image'), { code: 'goodsImg' });
  const sharp = require('sharp'); let out; try { out = await sharp(r.buf, { limitInputPixels: 4e7 }).rotate().resize(800, 800, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer(); } catch { throw Object.assign(new Error('bad image'), { code: 'goodsImg' }); }
  if (out.length > IMG_MAX) out = await sharp(out).resize(512, 512, { fit: 'inside' }).webp({ quality: 65 }).toBuffer();
  const up = await imgUpload({ mime: 'image/webp', data: out.toString('base64') }); if (up.error) throw Object.assign(new Error(up.error), { code: up.code }); return up.hash; }
async function goodsPreview(u) {
  const hit = goodsCache.get(u); if (hit && Date.now() - hit.fetchedAt < 600000) return hit;
  const r = await Goods.fetchSafe(u, Block); const html = Goods.decodeHtml(r.buf, r.type), x = Goods.extract(html, r.url);
  const bh = Block.check(r.url); if (bh) throw Object.assign(new Error('blocked'), { code: bh.type === 'shortener' ? 'blockShort' : 'blockPhish' });
  let titleOk = true; if (x.title) { const bt = Block.check(x.title), m = bt ? { pass: false } : await moderate(x.title); if (!m.pass) { x.title = ''; titleOk = false; } }
  let image = null, imgErr = null; if (x.image) try { image = await goodsImage(x.image); } catch (e) { imgErr = e.code || 'goodsImg'; }
  const k = Goods.productKey(u), out = { url: u, finalUrl: r.url, domain: k.domain, pid: k.pid, title: x.title, price: x.price, currency: x.currency, image, imgErr, titleOk, source: x.source, fetchedAt: Date.now() };
  goodsCache.set(u, out); if (goodsCache.size > 500) goodsCache.delete(goodsCache.keys().next().value); return out; }
async function checkContact(c) { // 联系方式：1–60 字，审核 + 钓鱼/短链/地址黑名单
  if (typeof c !== 'string' || !c.trim() || Soc.len(c.trim()) > 60) return { error: 'bad contact', code: 'contactLen' };
  const bh = Block.check(c); if (bh) return { error: 'blocked', code: bh.type === 'shortener' ? 'blockShort' : bh.type === 'address' ? 'blockAddr' : 'blockPhish', detail: bh.domain };
  const r = await moderate(c); return r.pass ? null : { error: REJECT, code: 'reject' }; }
function applyMeta(st, sig, owner, K, b) { // 写入链下可见性元数据；密码仅存 scrypt 哈希；位置优先用链上字段
  const vis = K.vis || 'public', deliver = K.deliver || 'tree';
  const country = Soc.cleanLoc(b.country || K.country), province = Soc.cleanLoc(b.province || K.province), city = Soc.cleanLoc(b.city || K.city);
  let invite = []; if (Array.isArray(b.invite)) invite = [...new Set(b.invite.map(a => String(a).trim()).filter(a => Soc.solOk(a) || Soc.evmOk(a)).map(Soc.addrKey))].slice(0, 30);
  if (vis === 'nearby' && !(city || province || country)) return { error: 'location required', code: 'cityNeed' };
  if (vis === 'invite' && !invite.length) return { error: 'invite list required', code: 'inviteNeed' };
  if (vis === 'locked' && !(typeof b.password === 'string' && b.password.length >= 4 && b.password.length <= 64)) return { error: 'password 4–64', code: 'passNeed' };
  const prev = st.meta[sig] || {}, meta = { owner, vis, deliver, country, province, city, at: Date.now() };
  if (vis === 'invite') meta.invite = invite;
  if (vis === 'locked') { const h = Soc.hashPass(b.password, prev.passSalt); meta.passHash = h.hash; meta.passSalt = h.salt; }
  else if (prev.passHash && b.keepPass) { meta.passHash = prev.passHash; meta.passSalt = prev.passSalt; }
  // 交友卡可选资料（链下）：年龄段 / 性别 / 职业 — 仅详情可见
  if (K.kind === 'social') {
    const age = String(b.age || '').trim(), gender = String(b.gender || '').trim(), job = String(b.job || '').trim().replace(/[~|<>]/g, '').slice(0, 20);
    if (age && !/^(18-24|25-34|35-44|45-54|55\+)$/.test(age)) return { error: 'bad age', code: 'field' };
    if (gender && !/^[MFX]$/.test(gender)) return { error: 'bad gender', code: 'field' };
    if ([...job].length > 20) return { error: 'bad job', code: 'field' };
    if (age) meta.age = age; if (gender) meta.gender = gender; if (job) meta.job = job;
  }
  st.meta[sig] = meta; return null; }
async function txInfo(sig) { // 读取自己刚上链的交易（最多重试 4 次）：作者 + memo
  for (let i = 0; i < 4; i++) { try { const tx = await conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
    if (tx && !tx.meta?.err) { const k = tx.transaction.message.accountKeys[0], author = k.pubkey?.toBase58?.() || String(k.pubkey || k);
      const ix = tx.transaction.message.instructions.find(x => x.program === 'spl-memo' || x.programId?.toBase58?.() === MEMO.toBase58()); return { author, memo: typeof ix?.parsed === 'string' ? ix.parsed : null }; } } catch {}
    await new Promise(r => setTimeout(r, 1500)); } return null; }

// ================= 合作卡出价：支付核验 =================
const ADS_MOCK = process.env.ADS_MOCK_PAY === '1'; // 仅测试：用 data/ads-mock-pay.json 模拟支付核验，不读链、不发交易
const adsMockFile = n => path.join(DATA_DIR, n), adsMockRead = n => { try { return JSON.parse(fs.readFileSync(adsMockFile(n))); } catch { return {}; } };
const adsMockFlag = k => !!adsMockRead('ads-mock-flags.json')[k];
function adsMockPay(signer, lamports) { const sig = 'MOCK' + crypto.randomBytes(8).toString('hex'), m = adsMockRead('ads-mock-pay.json'); m[sig] = { signer, lamports }; fs.writeFileSync(adsMockFile('ads-mock-pay.json'), JSON.stringify(m)); return sig; }
async function verifySolPay(sig, signer) { // 核验：交易成功、签名者 = 商家地址、转账收款方 = 收款地址；金额取转入收款地址的总额
  if (ADS_MOCK) { const m = adsMockRead('ads-mock-pay.json')[sig]; return m && m.signer === signer ? { lamports: m.lamports, time: Math.floor(Date.now() / 1000) } : null; }
  for (let i = 0; i < 4; i++) { try { const tx = await conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
    if (tx && !tx.meta?.err) { const k = tx.transaction.message.accountKeys[0], from = k.pubkey?.toBase58?.() || String(k.pubkey || k); if (from !== signer) return null;
      let lam = 0; for (const ix of tx.transaction.message.instructions) { const p = ix.parsed; if (ix.program === 'system' && p?.type === 'transfer' && p.info.destination === RECEIVE.toBase58() && p.info.source === signer) lam += +p.info.lamports; }
      return lam > 0 ? { lamports: lam, time: tx.blockTime || Math.floor(Date.now() / 1000) } : null; } } catch {} await new Promise(r => setTimeout(r, 1500)); } return null; }
Ads.setVerifier(verifySolPay);
async function creditEvm(db, U, id, evm, now) { // EVM 链：原生币转入该链收款地址；折算为 SOL 等值计入（服务端核验：收款方 / 发送者 / 金额 / 一笔交易只能用一次）
  if (!U.evm) throw Object.assign(new Error('not an EVM account'), { code: 'param' }); const ad = Ads.load().ads[id]; if (!ad || ad.owner !== U.pubkey) return { error: 'owner' }; const P = await solPrice(), coin = P.coins[Acc.CHAINS[+evm.chainId]?.coin] || 0; if (!coin) throw Object.assign(new Error('no price'), { code: 'evmChain' });
  const key = 'evm:' + evm.chainId + ':' + String((evm.txs || [])[0] || '').toLowerCase(); if (Ads.load().paid[key]) return Ads.creditLocal(id, U.pubkey, key, 0, now, 'topup'); // 已入账：幂等返回
  const ev = await Acc.verifyEvmPay(db, evm, U.evm, coin, Ads.cfg().minTopupSol * P.usd), lam = Math.round(ev.usd / P.usd * 1e9); save(db); return Ads.creditLocal(id, U.pubkey, key, lam, now, 'topup'); }

// ================= 门卡（Gate Card）=================
const GATE_MOCK = process.env.GATE_MOCK_STATS === '1'; // 仅测试：从 data/gate-mock-stats.json 读取统计，不读链
const statsCache = new Map();
async function chainStats(addr, user) { // 条件统计：心愿数 / 收到的有效祝福 / 账号天数 / 本月新心愿。链上数据 5 分钟缓存
  const now = Math.floor(Date.now() / 1000);
  if (GATE_MOCK) { let m = {}; try { m = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'gate-mock-stats.json')))[addr] || {}; } catch {} return { wishes: m.wishes || 0, blessings: m.blessings || 0, ageDays: m.ageDays || 0, monthWishes: m.monthWishes || 0 }; }
  const hit = statsCache.get(addr); if (hit && Date.now() - hit.at < 300000) return hit.v;
  const v = { wishes: 0, blessings: 0, ageDays: 0, monthWishes: 0 }; let first = 0;
  try { const pk = new web3.PublicKey(addr), sigs = (await conn.getSignaturesForAddress(pk, { limit: 200 })).filter(x => !x.err), mine = new Set();
    for (let i = 0; i < sigs.length; i += 25) { const txs = await conn.getParsedTransactions(sigs.slice(i, i + 25).map(x => x.signature), { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
      txs.forEach((tx, j) => { if (!tx) return; const k = tx.transaction.message.accountKeys[0], au = k.pubkey?.toBase58?.() || String(k.pubkey || k); if (au !== addr) return;
        const ix = tx.transaction.message.instructions.find(x => x.program === 'spl-memo'), memo = typeof ix?.parsed === 'string' ? ix.parsed : ''; if (!/^WTREE1\|W\|/.test(memo) || !verifyWishMemo(memo)) return;
        const bt = sigs[i + j].blockTime || 0; mine.add(sigs[i + j].signature); v.wishes++; if (bt >= Gate.monthStart(now)) v.monthWishes++; if (!first || bt < first) first = bt; }); }
    if (mine.size) { const ts = (await conn.getSignaturesForAddress(TREE, { limit: 300 })).filter(x => !x.err); const who = new Set();
      for (let i = 0; i < ts.length; i += 25) { const txs = await conn.getParsedTransactions(ts.slice(i, i + 25).map(x => x.signature), { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
        for (const tx of txs) { if (!tx) continue; const ix = tx.transaction.message.instructions.find(x => x.program === 'spl-memo'), memo = typeof ix?.parsed === 'string' ? ix.parsed : ''; const f = memo.split('|');
          if (f[1] === 'B' && mine.has(f[5]) && verifyWishMemo(memo)) { const k = tx.transaction.message.accountKeys[0], au = k.pubkey?.toBase58?.() || String(k.pubkey || k); if (au !== addr) v.blessings++; } } } }
  } catch (e) { console.error('gate stats:', e.message); if (hit) return hit.v; }
  const created = Math.floor((user?.created || 0) / 1000), t0 = [first, created].filter(Boolean).sort((a, b) => a - b)[0] || now; v.ageDays = Math.floor((now - t0) / 86400);
  statsCache.set(addr, { at: Date.now(), v }); return v; }
const gateAddrs = U => [U.pubkey, U.evm].filter(Boolean);
const gateNotice = (db, pk, m) => { const owners = Object.values(db.users).filter(u => u.pubkey === pk); if (owners.length && owners.every(u => !Acc.prefs(u).gate)) return 0; Acc.pushMsg(db, pk, m); return 1; };
const gateRecip = (db, owner) => Soc.evmOk(owner) ? [...new Set(Object.values(db.users).filter(u => u.evm === owner.toLowerCase()).map(u => u.pubkey))] : [owner];
function gateSweep(db, G) { const now = Math.floor(Date.now() / 1000); let n = 0; for (const { card, kind } of Gate.sweep(G, now)) for (const pk of gateRecip(db, card.owner)) n += gateNotice(db, pk, { kind, cardId: card.id, gateId: card.gateId, name: card.name, expireAt: card.expireAt }); return n; }
const gateLoad = () => Gate.seed(Gate.load());
const TH_MAX = 140, TH_DAY_LIMIT = 10; // 树洞：仅持有效成就门卡的地址可读写；内容存服务端（链下），读取接口逐次校验门卡
const achOf = (G, k, st) => Object.values(G.rules).filter(r => r.enabled && !G.claims[k]?.[r.id]).map(r => ({ rule: pubRuleOf(r), ...Gate.evalRule(r, st), claimable: !!G.claimable[k]?.[r.id] }));
const pubRuleOf = r => ({ id: r.id, name: r.name, benefit: r.benefit, cond: r.cond, validity: r.validity, claimDays: r.claimDays, enabled: r.enabled, unlocks: r.unlocks || [] });
async function gateApi(req, res, url, db) { // 返回 true 表示已处理
  const q = new URL(req.url, 'http://x').searchParams, now = Math.floor(Date.now() / 1000), admin = Fulfill.ADMIN_KEY && Fulfill.adminOk(req);
  const A = () => auth(req, db), deny = (st, code, extra = {}) => send(res, st, { error: code, code, ...extra });
  const pubRule = pubRuleOf;
  if (url === '/api/gate/rules' && req.method === 'GET') { const G = gateLoad(); return send(res, 200, { rules: Object.values(G.rules).filter(r => r.enabled).map(pubRule) }), true; }
  if (url === '/api/gate/me' && req.method === 'GET') { const a = A(); if (!a) return deny(401, 'NOT_LOGIN'), true; const U = a.user, G = gateLoad(); let changed = false;
    const st = await chainStats(U.pubkey, U); const created = Gate.scan(G, U.pubkey, st, now);
    for (const r of created) { gateNotice(db, U.pubkey, { kind: 'gate_claimable', gateId: r.id, name: r.name }); changed = true; }
    if (gateSweep(db, G)) changed = true;
    const k = Gate.addrKey(U.pubkey), cl = Object.values(G.claimable[k] || {}).map(c => ({ ...c, rule: pubRule(G.rules[c.ruleId]) }));
    const progress = achOf(G, k, st);
    const cooldownUntil = G.claims[k]?._last ? G.claims[k]._last + Gate.COOL : 0;
    if (created.length || changed) { Gate.save(G); save(db); }
    return send(res, 200, { cards: Gate.cardsOf(G, gateAddrs(U)).map(c => Gate.view(c, now)).sort((x, y) => y.issuedAt - x.issuedAt), claimable: cl, progress, unlocked: Gate.check(G, gateAddrs(U), Gate.unlockIds(G, 'treehole'), now).ok, stats: st, cooldownUntil, now }), true; }
  if (url === '/api/gate/claim' && req.method === 'POST') { const a = A(); if (!a) return deny(401, 'NOT_LOGIN'), true; const U = a.user, { ruleId } = await body(req), G = gateLoad();
    statsCache.delete(U.pubkey); const st2 = await chainStats(U.pubkey, U); // 领取前强制重新读取并复核
    const r = Gate.claim(G, U.pubkey, String(ruleId || ''), st2, now); Gate.save(G);
    if (r.error) return send(res, 400, r), true;
    // 链上记录：演示/托管模式下由服务端发行记录（recipient=当前用户）；真实 memo 锚定走 anchor 钩子（一期未开启）
    gateNotice(db, U.pubkey, { kind: 'gate_received', cardId: r.card.id, gateId: r.card.gateId, name: r.card.name, expireAt: r.card.expireAt }); save(db);
    return send(res, 200, { ok: true, card: Gate.view(r.card, now) }), true; }
  if (url === '/api/gate/check' && req.method === 'GET') { const gate = String(q.get('gate') || ''); const a = A(); if (!a) return deny(401, 'NOT_LOGIN'), true;
    const G = gateLoad(), ids = G.rules[gate] ? gate : Gate.unlockIds(G, gate), r = Gate.check(G, gateAddrs(a.user), ids, now, q.get('card') || ''), rule = G.rules[gate];
    const out = { ok: r.ok, code: r.code, gate, name: r.card?.name || rule?.name || gate, card: r.card ? Gate.view(r.card, now) : null, rule: rule ? pubRule(rule) : null };
    if (r.code === 'NO_GATE' && rule) { out.progress = Gate.evalRule(rule, await chainStats(a.user.pubkey, a.user)).progress; }
    if (r.code === 'REVOKED' || r.code === 'EXPIRED') out.issuer = r.card.issuer;
    return send(res, 200, out), true; }
  if (url.startsWith('/api/treehole')) { const a = A(); if (!a) return deny(401, 'NOT_LOGIN'), true; const U = a.user, G = gateLoad(), ids = Gate.unlockIds(G, 'treehole'); // 后端强制：每次读写都校验地址持有有效门卡
    const r = Gate.check(G, gateAddrs(U), ids, now, q.get('card') || ''), me = gateAddrs(U).map(Gate.addrKey);
    if (!r.ok) { const st = await chainStats(U.pubkey, U); return send(res, 403, { error: r.code, code: r.code, gateId: r.card?.gateId, name: r.card?.name, issuer: r.card?.issuer, achievements: achOf(G, Gate.addrKey(U.pubkey), st) }), true; }
    const mineSet = new Set(me), view = p => ({ id: p.id, text: p.text, at: p.at, author: p.author.slice(0, 4) + '…' + p.author.slice(-4), mine: mineSet.has(Gate.addrKey(p.author)), likes: p.likes.length, liked: p.likes.some(x => mineSet.has(x)) });
    if (url === '/api/treehole' && req.method === 'GET') { const sort = q.get('sort') || 'new'; let L = Object.values(G.posts).filter(p => !p.hidden); if (sort === 'mine') L = L.filter(p => mineSet.has(Gate.addrKey(p.author)));
      L.sort(sort === 'hot' ? (x, y) => y.likes.length - x.likes.length || y.at - x.at : (x, y) => y.at - x.at);
      const cards = Gate.cardsOf(G, gateAddrs(U)).filter(c => ids.includes(c.gateId) && Gate.statusOf(c, now) === 'valid').map(c => Gate.view(c, now));
      return send(res, 200, { ok: true, cards, posts: L.slice(0, 100).map(view) }), true; }
    if (url === '/api/treehole/post' && req.method === 'POST') { const b = await body(req), text = String(b.text || '').trim(); if (!text || [...text].length > TH_MAX || text.includes('|')) return deny(400, 'len'), true;
      const day = Object.values(G.posts).filter(p => Gate.addrKey(p.author) === Gate.addrKey(U.pubkey) && now - p.at < 86400).length; if (day >= TH_DAY_LIMIT) return deny(429, 'rate'), true;
      const bh = Block.check(text); if (bh) return send(res, 400, { error: 'blocked', code: bh.type === 'shortener' ? 'blockShort' : bh.type === 'address' ? 'blockAddr' : 'blockPhish', detail: bh.domain }), true;
      const mr = await moderate(text); if (!mr.pass) return send(res, 400, { error: REJECT, code: 'reject' }), true; // 与上链卡片同一套正向内容审核
      const id = 'th_' + crypto.randomBytes(6).toString('hex'); G.posts[id] = { id, author: U.pubkey, text, at: now, likes: [] }; Gate.save(G); return send(res, 200, { ok: true, post: view(G.posts[id]) }), true; }
    if (url === '/api/treehole/like' && req.method === 'POST') { const b = await body(req), p = G.posts[String(b.id || '')]; if (!p || p.hidden) return deny(404, 'nf'), true; const k = Gate.addrKey(U.pubkey), i = p.likes.indexOf(k); if (i >= 0) p.likes.splice(i, 1); else p.likes.push(k); Gate.save(G); return send(res, 200, { ok: true, likes: p.likes.length, liked: i < 0 }), true; }
    if (url === '/api/treehole/delete' && req.method === 'POST') { const b = await body(req), p = G.posts[String(b.id || '')]; if (!p || Gate.addrKey(p.author) !== Gate.addrKey(U.pubkey)) return deny(403, 'forbidden'), true; delete G.posts[p.id]; Gate.save(G); return send(res, 200, { ok: true }), true; }
    return deny(404, 'nf'), true; }
  if (url === '/api/gate-sent' && req.method === 'POST') { const b = await body(req), sig = b.sig; if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig || '')) return deny(400, 'param'), true; // 用户经 memo 上链发行后登记
    const ti = await txInfo(sig); if (!ti || !ti.memo || !verifyWishMemo(ti.memo)) return deny(400, 'nf'), true;
    const parts = ti.memo.split('|'), K = Soc.parseKind(parts[5]); if (K.kind !== 'gate' || Soc.validate(K)) return deny(400, 'param'), true;
    const a = A(); if (a && a.user.pubkey !== ti.author) return deny(403, 'forbidden'), true;
    const benefit = parts.slice(6).join('|'); if (Gate.sha16(Gate.clean(benefit, 140)) !== K.hash && Gate.sha16(benefit) !== K.hash) return deny(400, 'hash'), true; // 链上哈希必须匹配权益说明（即 memo 正文）
    const G = gateLoad(), had = !!G.cards[sig]; Gate.issue(G, { id: sig, gateId: K.gateId, name: K.name, owner: K.to, issuer: ti.author, expireAt: K.expireAt, benefit, source: 'user', sig }, now); Gate.save(G);
    let n = 0; if (!had) { for (const pk of gateRecip(db, K.to)) n += gateNotice(db, pk, { kind: 'gate_received', cardId: sig, gateId: K.gateId, name: K.name, expireAt: K.expireAt, from: ti.author }); if (n) save(db); }
    return send(res, 200, { ok: true, notified: n }), true; }
  if (url === '/api/gate/revoke' && req.method === 'POST') { const b = await body(req), a = A(); if (!admin && !a) return deny(401, 'NOT_LOGIN'), true; const G = gateLoad();
    const r = Gate.revoke(G, String(b.id || ''), admin ? 'admin' : a.user.pubkey, b.reason, now); if (r.error) return send(res, r.code === 'forbidden' ? 403 : 400, r), true; Gate.save(G);
    for (const pk of gateRecip(db, r.card.owner)) gateNotice(db, pk, { kind: 'gate_revoked', cardId: r.card.id, gateId: r.card.gateId, name: r.card.name, reason: r.card.reason }); save(db); return send(res, 200, { ok: true, card: Gate.view(r.card, now) }), true; }
  if (url.startsWith('/api/admin/gate/')) { if (!Fulfill.ADMIN_KEY) return deny(403, 'admin'), true; if (!admin) return deny(403, 'admin'), true; const G = gateLoad(), sub = url.slice(16);
    if (sub === 'rules' && req.method === 'GET') return send(res, 200, { rules: Object.values(G.rules) }), true;
    if (sub === 'rules' && req.method === 'POST') { const r = Gate.normRule(await body(req)); if (r.error) return send(res, 400, r), true; G.rules[r.rule.id] = { ...(G.rules[r.rule.id] || {}), ...r.rule }; Gate.save(G); return send(res, 200, { ok: true, rule: G.rules[r.rule.id] }), true; }
    if (sub === 'issue' && req.method === 'POST') { const b = await body(req), gid = String(b.gateId || '').toLowerCase(), list = Array.isArray(b.addresses) ? b.addresses.map(x => String(x).trim()).filter(Boolean) : []; // 批量发放：地址列表 + 共用参数
      if (!Gate.ID_RE.test(gid) || !list.length || list.length > 500) return deny(400, 'param'), true; const rule = G.rules[gid], nm = Gate.clean(b.name || rule?.name, 20); if (!nm) return deny(400, 'param'), true;
      const exp = b.expireAt ? Math.floor(+b.expireAt) : b.days ? now + Math.floor(+b.days) * 86400 : rule ? Gate.expireFor(rule, now) : 0; if (exp && exp <= now) return deny(400, 'gateExp'), true;
      const bad = list.filter(x => !(Soc.solOk(x) || Soc.evmOk(x))); if (bad.length) return send(res, 400, { error: 'bad address', code: 'giftTo', bad: bad.slice(0, 10) }), true;
      const out = { issued: 0, skipped: 0, ids: [] }; for (const ad of new Set(list.map(Soc.addrKey))) { const has = Gate.cardsOf(G, [ad]).some(c => c.gateId === gid && Gate.statusOf(c, now) === 'valid'); if (has) { out.skipped++; continue; }
        const c = Gate.issue(G, { gateId: gid, name: nm, owner: ad, issuer: 'admin', expireAt: exp, benefit: b.benefit || rule?.benefit, source: 'admin', ruleId: rule?.id }, now); out.issued++; out.ids.push(c.id);
        for (const pk of gateRecip(db, ad)) gateNotice(db, pk, { kind: 'gate_received', cardId: c.id, gateId: gid, name: nm, expireAt: exp }); }
      Gate.save(G); save(db); return send(res, 200, { ok: true, ...out }), true; }
    if (sub === 'sweep' && req.method === 'POST') { const n = gateSweep(db, G); Gate.save(G); save(db); return send(res, 200, { ok: true, notices: n }), true; }
    return deny(404, 'nf'), true; }
  return false; }
setInterval(() => { try { const db = load(), G = gateLoad(); if (gateSweep(db, G)) { Gate.save(G); save(db); } else Gate.save(G); } catch (e) { console.error('gate sweep', e.message); } }, 3600000).unref?.(); // 每小时到期提醒
const RPCC = new Map();
async function api(req, res, url) {
  const db = load(); Acc.normSessions(db);
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
    if (typeof prefix !== 'string' || !/^[^|]{1,400}$/.test(prefix)) return send(res, 400, { pass: false, message: '参数无效', code: 'param' });
    const K = Soc.parseKind(prefix); if (K.kind === 'wish' && prefix.length > 90) return send(res, 400, { pass: false, message: '参数无效', code: 'param' });
    if ((K.kind !== 'wish') && priv) return send(res, 400, { pass: false, message: '参数无效', code: 'param' });
    const ve = Soc.validate(K); if (ve) return send(res, 400, { pass: false, message: '参数无效', code: ve });
    if (Buffer.byteLength(prefix + '|' + (priv ? cipher : text), 'utf8') > 600) return send(res, 400, { pass: false, message: '内容过长', code: 'memoSize' });
    if ((K.kind === 'gift' || K.kind === 'gate') && Block.addrBlocked(K.to)) return send(res, 200, { pass: false, code: 'giftBlocked', message: '该地址已被拦截' });
    const extra = K.kind === 'social' ? [...K.tags, K.intro, K.looking].join('\n') : K.kind === 'gift' ? K.note : K.kind === 'goods' ? 'https://' + K.domain + '/' : K.kind === 'gate' ? K.name : '';
    const bh = Block.check(extra ? text + '\n' + extra : text); if (bh) return send(res, 200, { pass: false, type: bh.type, code: bh.type === 'shortener' ? 'blockShort' : bh.type === 'address' ? 'blockAddr' : 'blockPhish', domain: bh.domain, message: '内容包含被拦截的链接或地址：' + bh.domain }); // 在审核证明之前拦截
    const r = await moderate(extra ? text + '\n' + extra : text); return send(res, 200, r.pass ? { pass: true, attestation: attest(prefix + '|' + (priv ? cipher : text)) } : { pass: false, category: r.category, message: REJECT, code: 'reject' });
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
  if (url === '/api/config') { const p = await solPrice();
    const chains = Object.fromEntries(Object.entries(Acc.CHAINS).map(([id, c]) => [id, { key: c.key, name: c.name, sym: c.sym, coin: c.coin, exp: c.exp, rpc: c.rpc, receive: Acc.EVM_RECV[c.key] || null }]));
    const routes = {};
    for (const [id, c] of Object.entries(Acc.CHAINS)) if (Acc.EVM_RECV[c.key]) routes[c.key] = { chainId: +id, key: c.key, name: c.name, sym: c.sym, coin: c.coin, receive: Acc.EVM_RECV[c.key] };
    return send(res, 200, { receive: RECEIVE.toBase58(), developer: RECEIVE.toBase58(), treasury: RECEIVE.toBase58(), split: [100], minUsd: MIN_USD, solUsd: p.usd, priceSource: p.src, minLamports: minLamports(p.usd), moderator: MOD_PUB,
    evm: { pay: Acc.EVM_PAY, recipients: { ...Acc.EVM_RECV }, routes, uniChainImplemented: Acc.UNI_CHAIN_IMPLEMENTED, usd: p.coins, chains }, mail: Acc.MAIL_ON || Acc.ECHO, largeUsdDefault: 20 }); }
  if (url === '/api/nonce') return send(res, 200, { nonce: Acc.nonce() });
  if (url === '/api/login/wallet' && req.method === 'POST') { // 钱包签名登录：EVM（personal_sign，EIP-4361 格式）或 Solana（signMessage）；不涉及私钥、不发交易
    const lb = await body(req); let v; try { v = Acc.verifyLogin(lb, allowHost(req)); } catch (e) { return fail(res, e, 401); }
    const uid = v.kind + ':' + v.address;
    if (!db.users[uid]) { if (v.kind === 'evm') { const kp = web3.Keypair.generate(); db.users[uid] = { evm: v.address, pubkey: kp.publicKey.toBase58(), secret: Buffer.from(kp.secretKey).toString('base64'), created: Date.now() }; } // EVM 账户：愿望记录在 Solana devnet，由托管的 devnet 密钥签名 memo
      else db.users[uid] = { pubkey: v.address, created: Date.now() }; }
    if (db.users[uid].totp?.on && !(lb.totp && Acc.check2fa(db.users[uid], lb.totp))) { save(db); return send(res, 401, { error: '需要两步验证码', code: 'totp', ticket: Acc.issueTicket(uid, 'login') }); } // 签名已通过，第二步：验证码
    const token = Acc.newSession(db, uid, req); save(db); return send(res, 200, { token, ...meOf(uid, db.users[uid]) }); }
  if (url === '/api/login/totp' && req.method === 'POST') { const { ticket, code } = await body(req), x = Acc.peekTicket(ticket, 'login'); if (!x || !db.users[x.uid]) return send(res, 401, { error: 'expired', code: 'nonce' });
    if (!Acc.check2fa(db.users[x.uid], code)) { x.tries++; save(db); return send(res, 401, { error: '验证码错误', code: 'totpBad' }); } Acc.useTicket(ticket, x.uid, 'login');
    const token = Acc.newSession(db, x.uid, req); save(db); return send(res, 200, { token, ...meOf(x.uid, db.users[x.uid]) }); }
  if (url === '/api/blocklist/info') return send(res, 200, Block.info());
  if (url === '/api/rules') return send(res, 200, { categories: Object.keys(RULES), words: RULES }); // 供前端展示过滤
  // —— 心愿实现（公开只读徽章；履约联系方式仅存链下）——
  if (url.startsWith('/api/fulfillments/') && req.method === 'GET') {
    const sig = decodeURIComponent(url.slice('/api/fulfillments/'.length).split('/')[0] || '');
    const v = Fulfill.publicView(sig); return v ? send(res, 200, v) : send(res, 404, { error: 'not found', code: 'nf' });
  }
  // —— 心愿卡：商品链接预览 + 链下商品元数据 ——
  if (url === '/api/goods/preview' && req.method === 'POST') { const a = auth(req, db); if (!a) return send(res, 401, { error: '未登录', code: 'auth' });
    const now = Date.now(), rl = (goodsRate.get(a.uid) || []).filter(t => now - t < 600000); if (rl.length >= 20) return send(res, 429, { error: 'rate', code: 'rate' }); rl.push(now); goodsRate.set(a.uid, rl);
    const { url: u } = await body(req); if (typeof u !== 'string' || u.length > 1000) return send(res, 400, { error: 'bad url', code: 'goodsUrl' });
    let x; try { x = Goods.checkUrl(u.trim(), Block); } catch (e) { return fail(res, e); }
    try { return send(res, 200, await goodsPreview(x.href)); } catch (e) { const k = Goods.productKey(x.href); return send(res, 200, { url: x.href, domain: k.domain, pid: k.pid, title: '', price: '', currency: '', image: null, failed: e.code || 'goodsFetch', fetchedAt: Date.now() }); } }
  if (url === '/api/goods-meta' && req.method === 'POST') { const a = auth(req, db); if (!a) return send(res, 401, { error: '未登录', code: 'auth' });
    const b = await body(req), sig = b.sig; if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig || '')) return send(res, 400, { error: 'bad sig', code: 'param' });
    const ti = await txInfo(sig); if (!ti || ti.author !== a.user.pubkey || !ti.memo || !verifyWishMemo(ti.memo)) return send(res, 403, { error: 'forbidden', code: 'forbidden' });
    const K = Soc.parseKind(ti.memo.split('|')[5]); if (K.kind !== 'goods') return send(res, 400, { error: 'param', code: 'param' });
    let x; try { x = Goods.checkUrl(String(b.url || '').trim(), Block); } catch (e) { return fail(res, e); }
    const k = Goods.productKey(x.href); if (k.domain !== K.domain || k.pid !== K.pid) return send(res, 400, { error: 'url mismatch', code: 'goodsMismatch' });
    const title = Goods.clean(b.title, 80), price = Goods.normPrice(b.price), currency = Goods.normCur(b.currency) || (price ? 'CNY' : '');
    if (title) { const bt = Block.check(title); if (bt) return send(res, 400, { error: 'blocked', code: 'blockPhish' }); const m = await moderate(title); if (!m.pass) return send(res, 400, { error: REJECT, code: 'reject' }); }
    const c = goodsCache.get(x.href), image = /^[0-9a-f]{32}$/.test(b.image || '') && c && c.image === b.image ? b.image : (c?.image || null);
    const edited = !c || c.title !== title || c.price !== price;
    const st = Soc.load(); st.goods[sig] = { owner: a.user.pubkey, url: x.href, domain: k.domain, title, price, currency, image, fetchedAt: c?.fetchedAt || Date.now(), edited, at: Date.now() }; Soc.save(st);
    return send(res, 200, { ok: true }); }
  if (url === '/api/goods-meta/batch' && req.method === 'POST') { const { sigs } = await body(req), list = Array.isArray(sigs) ? sigs.slice(0, 200) : [], st = Soc.load(), out = {};
    for (const sig of list) { const g = st.goods[sig]; if (g) out[sig] = { url: g.url, domain: g.domain, title: g.title, price: g.price, currency: g.currency, image: g.image, fetchedAt: g.fetchedAt, edited: !!g.edited }; }
    return send(res, 200, { meta: out }); }
  // —— 交友卡 / 礼品卡：联系方式、可见性元数据、礼品索引 ——
  if (url === '/api/contact/check' && req.method === 'POST') { const { contact } = await body(req); const r = await checkContact(contact); return send(res, r ? 400 : 200, r || { ok: true }); }
  if (url.startsWith('/api/contact/') && req.method === 'GET') { const sig = decodeURIComponent(url.slice(13)); const c = Soc.load().contacts[sig]; if (!c) return send(res, 200, {});
    const me = auth(req, db); if (me && me.user.pubkey === c.owner) return send(res, 200, { contact: c.contact, show: !!c.show, mine: true });
    return send(res, 200, c.show ? { contact: c.contact } : {}); }
  if (url === '/api/gifts' && req.method === 'GET') { const to = new URL(req.url, 'http://x').searchParams.get('to') || ''; if (!(Soc.solOk(to) || Soc.evmOk(to))) return send(res, 400, { error: 'bad address', code: 'giftTo' });
    return send(res, 200, { sigs: (Soc.load().gifts[Soc.addrKey(to)] || []).slice(-500) }); }
  if (url === '/api/card-meta/batch' && req.method === 'POST') { // 批量取链下可见性元数据（城市哈希、是否上锁/邀请，不含密码）
    const { sigs } = await body(req), list = Array.isArray(sigs) ? sigs.slice(0, 200) : [], st = Soc.load(), me = auth(req, db), out = {};
    for (const sig of list) { if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig)) continue; const m = st.meta[sig]; if (!m) continue;
      const mine = me && me.user.pubkey === m.owner, unlocked = me && !!(st.unlocks[sig] && st.unlocks[sig][me.user.pubkey]);
      const addrs = me ? [me.user.pubkey, me.user.evm].filter(Boolean).map(Soc.addrKey) : [];
      const invited = !!(m.invite && addrs.some(a => m.invite.includes(a)));
      const viewerLoc = me ? { country: me.user.country, province: me.user.province, city: me.user.city } : null;
      const cardLoc = { country: m.country, province: m.province, city: m.city };
      out[sig] = { vis: m.vis || 'public', deliver: m.deliver || 'tree', country: m.country || '', province: m.province || '', city: m.city || '',
        cityMatch: !!(viewerLoc && Soc.locMatch(viewerLoc, cardLoc)), locked: !!m.passHash, unlocked: !!unlocked || !!mine,
        invite: !!(m.invite && m.invite.length), invited, inv: mine ? (m.invite || []) : undefined, hasPass: !!m.passHash, offTree: m.deliver === 'off',
        age: m.age || '', gender: m.gender || '', job: m.job || '' }; }
    return send(res, 200, { meta: out }); }
  if (url === '/api/gift-sent' && req.method === 'POST') { // 礼品卡上链后登记 + 可选链下元数据（密码/邀请/城市）；投递 both/off 时通知收礼人
    const b = await body(req), sig = b.sig; if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig || '')) return send(res, 400, { error: 'bad sig', code: 'param' });
    const st = Soc.load(), ti = await txInfo(sig); if (!ti || !ti.memo || !verifyWishMemo(ti.memo)) return send(res, 400, { error: 'not found', code: 'nf' });
    const parts = ti.memo.split('|'), K = Soc.parseKind(parts[5]); if (K.kind !== 'gift' || Soc.validate(K)) return send(res, 400, { error: 'not a gift', code: 'param' });
    const me = auth(req, db); if (me && me.user.pubkey !== ti.author) return send(res, 403, { error: 'forbidden', code: 'forbidden' });
    const metaErr = applyMeta(st, sig, ti.author, K, b); if (metaErr) return send(res, 400, metaErr);
    const key = Soc.addrKey(K.to); st.gifts[key] = [...(st.gifts[key] || []).filter(x => x !== sig), sig];
    let n = 0; if (!st.giftSeen[sig] && (K.deliver === 'off' || K.deliver === 'both' || true)) { // 始终索引；通知：off/both 必发，tree 也发（收礼人可在「收到的礼物」看到）
      const tos = Soc.evmOk(K.to) ? Object.values(db.users).filter(u => u.evm === key).map(u => u.pubkey) : [K.to];
      for (const pk of new Set(tos)) { const owners = Object.values(db.users).filter(u => u.pubkey === pk); if (owners.length && owners.every(u => !Acc.prefs(u).system)) continue;
        Acc.pushMsg(db, pk, { kind: 'gift', sig, from: ti.author, note: K.note.slice(0, 50), deliver: K.deliver }); n++; }
      if (n) save(db); }
    st.giftSeen[sig] = Date.now(); Soc.save(st); return send(res, 200, { ok: true, notified: n, already: false }); }
  if (url === '/api/card-meta' && req.method === 'POST') { // 交友卡上链后登记链下可见性（城市等）
    const b = await body(req), a = auth(req, db); if (!a) return send(res, 401, { error: '未登录', code: 'auth' });
    const sig = b.sig; if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig || '')) return send(res, 400, { error: 'bad sig', code: 'param' });
    const ti = await txInfo(sig); if (!ti || ti.author !== a.user.pubkey || !ti.memo || !verifyWishMemo(ti.memo)) return send(res, 403, { error: 'forbidden', code: 'forbidden' });
    const K = Soc.parseKind(ti.memo.split('|')[5]); // 四类卡均可登记可见性/位置；交友卡另含年龄/性别/职业
    if (!['social', 'gift', 'wish', 'goods'].includes(K.kind)) return send(res, 400, { error: 'param', code: 'param' });
    if (K.kind === 'social') { const job = String(b.job || '').trim().slice(0, 20); if (job) { const bh = Block.check(job); if (bh) return send(res, 400, { error: 'blocked', code: bh.type === 'shortener' ? 'blockShort' : 'blockPhish' }); const mr = await moderate(job); if (!mr.pass) return send(res, 400, { error: REJECT, code: 'reject' }); } }
    const st = Soc.load(), err = applyMeta(st, sig, a.user.pubkey, K, b); if (err) return send(res, 400, err); Soc.save(st); return send(res, 200, { ok: true }); }
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
      if (r.ok && !r.already) { const w = Fulfill.listAll().find(x => x.wishSig === b.wishSig) || {}; let author = w.author || b.author || '';
        if (!author) try { const tx = await conn.getParsedTransaction(b.wishSig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }); const k = tx?.transaction.message.accountKeys[0]; author = k?.pubkey?.toBase58?.() || ''; } catch {}
        const db2 = load(); r.notified = Acc.notifyFulfil(db2, author, { sig: b.wishSig, text: w.text, note: b.note }); save(db2); }
      return send(res, r.ok ? 200 : 400, r);
    }
    return send(res, 404, { error: 'not found' });
  }
  if (url === '/api/ads' && req.method === 'GET') { const q = new URL(req.url, 'http://x').searchParams, now = Math.floor(Date.now() / 1000); // 公开：不含得分；单个广告 ?id=，分页广告位 ?page=n
    if (q.get('id')) { const ad = Ads.one(String(q.get('id')), now); return ad ? send(res, 200, { ad }) : send(res, 404, { error: 'nf', code: 'nf' }); }
    return send(res, 200, { ...Ads.pageSlots(+q.get('page') || 1, now), per: Ads.PAGE, step: Ads.STEP }); }
  if (url === '/api/track' && req.method === 'POST') { const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); // IP 仅用于内存限流，不存储
    if (Ads.limited(ip)) return send(res, 429, { error: 'rate', code: 'rate' }); const b = await body(req, 1000); const r = Ads.track(b || {}); return send(res, r.error ? 400 : 200, r); }
  if (url.startsWith('/api/ads/') && url !== '/api/ads/') { const a = auth(req, db); if (!a) return send(res, 401, { error: 'NOT_LOGIN', code: 'NOT_LOGIN' }); const U = a.user, now = Math.floor(Date.now() / 1000), owner = U.pubkey;
    const E = r => send(res, r.error === 'nf' ? 404 : r.error === 'owner' ? 403 : r.error === 'busy' ? 409 : 400, { error: r.error, code: r.error, min: Ads.cfg().minTopupSol });
    if (url === '/api/ads/mine' && req.method === 'GET') return send(res, 200, { ...Ads.mine(owner, now), receive: RECEIVE.toBase58(), solUsd: (await solPrice()).usd });
    if (url === '/api/ads/rank' && req.method === 'GET') { const id = String(new URL(req.url, 'http://x').searchParams.get('id') || ''), ad = Ads.load().ads[id]; if (!ad || ad.owner !== owner) return send(res, 403, { error: 'owner', code: 'owner' }); return send(res, 200, { ad: Ads.view(ad, now), recomputedAt: Ads.board(now).at }); } // 仅所有者（会话鉴权后）可读自己的名次与得分
    if (url === '/api/ads/credit' && req.method === 'POST') { const b = await body(req, 4000), id = String(b.id || ''), kind = 'topup'; // 记账 / 补单：按交易签名核验后入账，幂等
      let r; try { r = b.evm ? await creditEvm(db, U, id, b.evm, now) : await Ads.credit(id, owner, String(b.sig || ''), kind, now); } catch (e) { return send(res, 400, { error: e.code || 'verify', code: e.code || 'verify', detail: e.message }); }
      if (r.error) return E(r); return send(res, 200, { ...r, board: Ads.mine(owner, now).board }); }
    if (url === '/api/ads/pay' && req.method === 'POST') { // 托管账户：服务端用该用户的 devnet 密钥签名并转账到收款地址（全额，无分成），随后核验入账
      const b = await body(req, 2000), id = String(b.id || ''), sol = +b.sol, ad = Ads.load().ads[id]; if (!ad || ad.owner !== owner) return send(res, 403, { error: 'owner', code: 'owner' });
      if (!(sol >= Ads.cfg().minTopupSol) || sol > 1000) return send(res, 400, { error: 'amount', code: 'amount', min: Ads.cfg().minTopupSol });
      const P = ADS_MOCK ? { usd: 0 } : await solPrice(); if (sol * P.usd >= (U.largeUsd || 20)) return send(res, 400, { error: 'large', code: 'large' });
      if (!U.secret) return send(res, 400, { error: 'not custodial', code: 'param' }); const kp = web3.Keypair.fromSecretKey(Buffer.from(U.secret, 'base64')), lam = Math.round(sol * 1e9);
      let sig; try { sig = ADS_MOCK ? adsMockPay(owner, lam) : await web3.sendAndConfirmTransaction(conn, buildMemoTx(kp.publicKey, 'WTREE1|AD|' + id, lam), [kp], { commitment: 'confirmed' }); }
      catch (e) { return send(res, 200, { error: 'chain', code: 'chain', detail: e.message }); }
      try { if (ADS_MOCK && adsMockFlag('failCredit')) throw new Error('mock record failure'); const r = await Ads.credit(id, owner, sig, 'topup', now); if (r.error) return send(res, 200, { error: 'record', code: 'record', signature: sig, reason: r.error }); return send(res, 200, { ...r, signature: sig, board: Ads.mine(owner, now).board }); }
      catch (e) { return send(res, 200, { error: 'record', code: 'record', signature: sig, detail: e.message }); } } // 已付款但记账失败：返回签名，供用户补单
    if (url === '/api/ads/launch' && req.method === 'POST') { const b = await body(req, 6000), c = b.ad || {}; const n = Ads.norm({ ...c, id: String(c.id || '').toLowerCase() }); if (n.error) return send(res, 400, { error: n.error, code: n.error });
      const txt = [n.ad.title, n.ad.text, n.ad.brand, n.ad.url].join('\n'), bh = Block.check(txt); if (bh) return send(res, 400, { error: 'blocked', code: bh.type === 'shortener' ? 'blockShort' : 'blockPhish', detail: bh.domain });
      const mr = await moderate(n.ad.title + '\n' + n.ad.text); if (!mr.pass) return send(res, 400, { error: REJECT, code: 'reject' }); // 正向内容审核
      const r = await Ads.launch(owner, c, String(b.sig || ''), now); if (r.error) return E(r); return send(res, 200, r); }
    return send(res, 404, { error: 'not found' }); }
  if (url.startsWith('/api/admin/ads')) { if (!Fulfill.ADMIN_KEY || !Fulfill.adminOk(req)) return send(res, 403, { error: 'forbidden', code: 'admin' });
    if (url === '/api/admin/ads' && req.method === 'GET') return send(res, 200, { ...Ads.adminList(), stats: Ads.summary(+new URL(req.url, 'http://x').searchParams.get('days') || 7) });
    if (url === '/api/admin/ads/config' && req.method === 'POST') { try { return send(res, 200, { cfg: Ads.setConfig(await body(req)) }); } catch (e) { return send(res, 400, { error: e.code || 'param', code: e.code || 'param' }); } }
    if (url === '/api/admin/ads' && req.method === 'POST') { const b = await body(req); if (b.delete) return send(res, 200, { ok: Ads.remove(String(b.id || '')) });
      const r = Ads.norm(b); if (r.error) return send(res, 400, { error: r.error, code: r.error });
      const bh = Block.check([r.ad.title, r.ad.text, r.ad.brand, r.ad.url].join('\n')); if (bh) return send(res, 400, { error: 'blocked', code: bh.type === 'shortener' ? 'blockShort' : 'blockPhish', detail: bh.domain }); // 外链/文案先过钓鱼黑名单
      const u = Ads.upsert(b, +b.bidSol || 0); return send(res, 200, { ok: true, ad: Ads.view(u.ad, Math.floor(Date.now() / 1000)) }); }
    return send(res, 404, { error: 'not found' }); }
  if ((url.startsWith('/api/gate') || url.startsWith('/api/treehole')) && (await gateApi(req, res, url, db))) return;
  if (url.startsWith('/api/admin/gate/') && (await gateApi(req, res, url, db))) return;
  if (url === '/api/admin/notice' && req.method === 'GET') { if (!Fulfill.ADMIN_KEY || !Fulfill.adminOk(req)) return send(res, 403, { error: 'forbidden', code: 'admin' }); return send(res, 200, { items: db.sys || [] }); }
  if (url === '/api/admin/notice/delete' && req.method === 'POST') { if (!Fulfill.ADMIN_KEY || !Fulfill.adminOk(req)) return send(res, 403, { error: 'forbidden', code: 'admin' });
    const { id } = await body(req), n = (db.sys || []).length; db.sys = (db.sys || []).filter(m => m.id !== id); save(db); return send(res, 200, { ok: true, deleted: n - db.sys.length }); }
  if (url === '/api/admin/notice' && req.method === 'POST') { // 系统通知（星愿大使/运营后台）：所有开启「系统通知」的用户可见
    if (!Fulfill.ADMIN_KEY || !Fulfill.adminOk(req)) return send(res, 403, { error: 'forbidden', code: 'admin' });
    const b = await body(req); if (typeof b.title !== 'string' || !b.title.trim()) return send(res, 400, { error: 'title required', code: 'param' });
    db.sys = db.sys || []; const m = { id: crypto.randomBytes(6).toString('hex'), at: Date.now(), title: b.title.slice(0, 120), body: String(b.body || '').slice(0, 2000) }; db.sys.unshift(m); db.sys.length = Math.min(db.sys.length, 100); save(db); return send(res, 200, { ok: true, id: m.id }); }
  if (url === '/api/login' && req.method === 'POST') { // 演示：仅邮箱，无密码/验证码
    const { email, totp } = await body(req);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '') || /^(evm|sol):/.test(email)) return send(res, 400, { error: '邮箱格式不正确', code: 'email' });
    if (db.users[email]?.totp?.on) { if (!totp) return send(res, 401, { error: '需要两步验证码', code: 'totp' }); if (!Acc.check2fa(db.users[email], totp)) { save(db); return send(res, 401, { error: '验证码错误', code: 'totpBad' }); } }
    if (!db.users[email]) { const kp = web3.Keypair.generate(); db.users[email] = { pubkey: kp.publicKey.toBase58(), secret: Buffer.from(kp.secretKey).toString('base64'), created: Date.now() }; }
    const token = Acc.newSession(db, email, req); save(db);
    return send(res, 200, { token, ...meOf(email, db.users[email]) });
  }
  const a = auth(req, db);
  if (url === '/api/me') return a ? send(res, 200, meOf(a.uid, a.user)) : send(res, 401, { error: '未登录', code: 'auth' });
  if (!a) return send(res, 401, { error: '未登录', code: 'auth' });
  const U = a.user, isEmail = kindOf(a.uid) === 'email';
  // —— 安全设置 ——
  if (url === '/api/security') return send(res, 200, { ...meOf(a.uid, U), recoveryLeft: U.totp?.rc?.length ?? null, mail: Acc.MAIL_ON || Acc.ECHO, largeUsd: U.largeUsd || 20,
    sessions: Object.entries(db.sessions).filter(([, s]) => s.uid === a.uid).map(([t, s]) => ({ id: Acc.tokHash(t), ua: s.ua, at: s.at, last: s.last, current: t === a.token })).sort((x, y) => y.last - x.last) });
  const need2fa = code => { if (!U.totp?.on || Acc.check2fa(U, code)) return null; save(db); send(res, 401, { error: '需要两步验证码', code: code ? 'totpBad' : 'totp' }); return true; }; // 开启 2FA 后敏感操作需验证码（服务器强制）
  if (url === '/api/sessions/revoke' && req.method === 'POST') { const { id, others, code } = await body(req); let n = 0; if (need2fa(code)) return;
    for (const [t, s] of Object.entries(db.sessions)) if (s.uid === a.uid && t !== a.token && (others || Acc.tokHash(t) === id)) { delete db.sessions[t]; n++; } save(db); return send(res, 200, { ok: true, revoked: n }); }
  if (url === '/api/security/large' && req.method === 'POST') { const { usd, code } = await body(req); if (need2fa(code)) return; if (!(+usd >= 1 && +usd <= 100000)) return send(res, 400, { error: 'bad amount', code: 'param' }); U.largeUsd = Math.round(+usd); save(db); return send(res, 200, { ok: true, largeUsd: U.largeUsd }); }
  if (url === '/api/email/send' && req.method === 'POST') { if (!isEmail) return send(res, 400, { error: 'not an email account', code: 'param' }); if (U.verified) return send(res, 200, { ok: true, verified: true });
    if (U.ev && Date.now() - U.ev.sent < 60000) return send(res, 429, { error: 'too frequent', code: 'rate' });
    if (!Acc.MAIL_ON && !Acc.ECHO) return send(res, 503, { error: 'mail service not configured', code: 'mailOff' });
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0'); U.ev = { h: crypto.createHash('sha256').update(code).digest('hex'), exp: Date.now() + 600000, sent: Date.now(), tries: 0 }; save(db);
    if (Acc.MAIL_ON) { try { if (!await Acc.sendMail(a.uid, 'World Tree verification code', `Your World Tree verification code: ${code}\n(valid for 10 minutes)`)) throw 0; } catch { return send(res, 502, { error: 'mail send failed', code: 'mailFail' }); } }
    return send(res, 200, { ok: true, ...(Acc.ECHO && !Acc.MAIL_ON ? { devCode: code } : {}) }); }
  if (url === '/api/email/verify' && req.method === 'POST') { const { code } = await body(req); const ev = U.ev;
    if (!ev || ev.exp < Date.now() || ev.tries >= 5) return send(res, 400, { error: 'code expired', code: 'codeExp' }); ev.tries++;
    if (crypto.createHash('sha256').update(String(code || '')).digest('hex') !== ev.h) { save(db); return send(res, 400, { error: 'wrong code', code: 'codeBad' }); }
    U.verified = true; delete U.ev; save(db); return send(res, 200, { ok: true, verified: true }); }
  if (url === '/api/2fa/ticket' && req.method === 'POST') { const { code } = await body(req); if (!U.totp?.on) return send(res, 200, { ticket: null }); // 大额支付预授权：验证码先验证，换 10 分钟一次性票据（链上确认较慢）
    if (!Acc.check2fa(U, code)) { save(db); return send(res, 401, { error: '验证码错误', code: 'totpBad' }); } save(db); return send(res, 200, { ticket: Acc.issueTicket(a.uid, 'pay', 600000) }); }
  if (url === '/api/2fa/setup' && req.method === 'POST') { if (U.totp?.on) return send(res, 400, { error: 'already on', code: 'totpOn' });
    const secret = Acc.b32enc(crypto.randomBytes(20)); U.totpPending = secret; save(db);
    return send(res, 200, { secret, uri: `otpauth://totp/${encodeURIComponent('World Tree:' + (isEmail ? a.uid : (U.evm || U.pubkey).slice(0, 6) + '…' + (U.evm || U.pubkey).slice(-4)))}?secret=${secret}&issuer=${encodeURIComponent('World Tree')}&algorithm=SHA1&digits=6&period=30` }); }
  if (url === '/api/2fa/enable' && req.method === 'POST') { const { code } = await body(req); if (!U.totpPending) return send(res, 400, { error: 'setup first', code: 'param' });
    const tmp = { totp: { on: true, secret: U.totpPending } }; if (!Acc.totpOk(tmp, code)) return send(res, 400, { error: 'wrong code', code: 'totpBad' });
    const rc = Acc.genRecovery(); U.totp = { ...tmp.totp, rc: rc.hashes }; delete U.totpPending; Acc.pushMsg(db, U.pubkey, { kind: 'totpOn' }); save(db); return send(res, 200, { ok: true, totp: true, recovery: rc.plain }); } // 恢复码只返回这一次
  if (url === '/api/2fa/disable' && req.method === 'POST') { const { code } = await body(req); if (!U.totp?.on) return send(res, 200, { ok: true, totp: false });
    if (!Acc.check2fa(U, code)) { save(db); return send(res, 400, { error: 'wrong code', code: 'totpBad' }); } delete U.totp; Acc.pushMsg(db, U.pubkey, { kind: 'totpOff' }); save(db); return send(res, 200, { ok: true, totp: false }); }
  // —— 站内信 / 消息设置（打开页面或菜单时拉取，无轮询）——
  if (url === '/api/inbox') return send(res, 200, Acc.inboxOf(db, U));
  if (url === '/api/inbox/read' && req.method === 'POST') { const { ids, all } = await body(req), want = all ? null : new Set(Array.isArray(ids) ? ids : []);
    for (const m of db.inbox?.[U.pubkey] || []) if (!want || want.has(m.id)) m.read = true;
    const sr = new Set(U.sysRead || []); for (const m of db.sys || []) if (!want || want.has(m.id)) sr.add(m.id); U.sysRead = [...sr].slice(-300); save(db); return send(res, 200, Acc.inboxOf(db, U)); }
  if (url === '/api/notify') { if (req.method === 'POST') { const b = await body(req); U.notify = { fulfil: b.fulfil !== false, system: b.system !== false, gate: b.gate !== false }; save(db); } return send(res, 200, Acc.prefs(U)); }
  if (url === '/api/logout' && req.method === 'POST') { delete db.sessions[a.token]; save(db); return send(res, 200, { ok: true }); } // 只退出当前设备；其他设备在安全设置中退出
  if (url === '/api/me/loc' && req.method === 'POST') { // 查看者位置（国家/省/市自由填写，用于「附近」匹配；非 GPS）
    const b = await body(req); U.country = Soc.cleanLoc(b.country); U.province = Soc.cleanLoc(b.province); U.city = Soc.cleanLoc(b.city); save(db);
    return send(res, 200, { ok: true, country: U.country, province: U.province, city: U.city }); }
  if (url === '/api/card-unlock' && req.method === 'POST') { // 礼品卡密码解锁（scrypt 校验；仅 UI 层，链上 memo 仍公开可读）
    const { sig, password } = await body(req), st = Soc.load(), m = st.meta[sig];
    if (!m?.passHash) return send(res, 400, { error: 'not locked', code: 'param' });
    if (!Soc.checkPass(password, m.passSalt, m.passHash)) return send(res, 401, { error: 'bad password', code: 'passBad' });
    st.unlocks[sig] = st.unlocks[sig] || {}; st.unlocks[sig][U.pubkey] = Date.now(); Soc.save(st); return send(res, 200, { ok: true, unlocked: true }); }
  if (url === '/api/contact' && req.method === 'POST') { // 设置/修改交友卡联系方式：仅卡片作者；审核 + 黑名单
    const { sig, contact, show } = await body(req); if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig || '')) return send(res, 400, { error: 'bad sig', code: 'param' });
    const bad = await checkContact(contact); if (bad) return send(res, 400, bad);
    const st = Soc.load(), cur = st.contacts[sig];
    if (cur) { if (cur.owner !== U.pubkey) return send(res, 403, { error: 'forbidden', code: 'forbidden' }); }
    else { const ti = await txInfo(sig); if (!ti || ti.author !== U.pubkey || !ti.memo || !verifyWishMemo(ti.memo) || Soc.parseKind(ti.memo.split('|')[5]).kind !== 'social') return send(res, 403, { error: 'forbidden', code: 'forbidden' }); }
    st.contacts[sig] = { owner: U.pubkey, contact: String(contact).trim(), show: !!show, at: Date.now() }; Soc.save(st); return send(res, 200, { ok: true, contact: st.contacts[sig].contact, show: !!show }); }
  if (url === '/api/contact/delete' && req.method === 'POST') { const { sig } = await body(req), st = Soc.load(), cur = st.contacts[sig];
    if (!cur) return send(res, 200, { ok: true }); if (cur.owner !== U.pubkey) return send(res, 403, { error: 'forbidden', code: 'forbidden' });
    delete st.contacts[sig]; Soc.save(st); return send(res, 200, { ok: true }); }
  if (!U.secret) return send(res, 403, { error: 'wallet account: sign with your wallet', code: 'noCustody' });
  const kp = web3.Keypair.fromSecretKey(Buffer.from(U.secret, 'base64'));
  if (url === '/api/privkey' && req.method === 'POST') return send(res, 200, { key: crypto.createHmac('sha256', Buffer.from(kp.secretKey)).update('WTREE-PRIV1').digest('hex') }); // 托管模式私密卡密钥（服务器可派生 → 托管模式下服务器可解密）
  if (url === '/api/airdrop' && req.method === 'POST') {
    try { const sig = await conn.requestAirdrop(kp.publicKey, 0.1 * web3.LAMPORTS_PER_SOL); return send(res, 200, { signature: sig }); }
    catch (e) { return send(res, 200, { error: '空投失败: ' + e.message, code: 'airdrop', detail: e.message }); }
  }
  if (url === '/api/memo' && req.method === 'POST') { // 托管签名：后端用该用户的 devnet 密钥签名
    const { memo, lamports = 0, evm, confirmLarge, totp, payTicket } = await body(req); const payOk = () => !U.totp?.on || (payTicket && Acc.useTicket(payTicket, a.uid, 'pay')) || Acc.check2fa(U, totp); const isW = typeof memo === 'string' && memo.startsWith('WTREE1|W|'), P = await solPrice();
    if (typeof memo !== 'string') return send(res, 400, { error: 'memo 无效', code: 'memo' });
    if (/^WTREE1\|[WB]\|/.test(memo)) { if (!verifyWishMemo(memo)) return send(res, 400, { error: '缺少或无效的审核证明（attestation）', code: 'att' }); }
    else if (!/^WTREE1\|L\|[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(memo)) return send(res, 400, { error: 'memo 格式无效', code: 'memo' });
    let evmPaid = null; // EVM 账户：心愿费用在 EVM 测试网以原生币直接转给开发者/金库（20/80），服务器核验后用其 devnet 托管密钥上链（Solana 为唯一事实来源）
    if (isW && evm) { if (!U.evm) return send(res, 400, { error: 'not an EVM account', code: 'param' });
      try { evmPaid = await Acc.verifyEvmPay(db, evm, U.evm, P.coins[Acc.CHAINS[+evm.chainId]?.coin] || 0, MIN_USD); } catch (e) { return fail(res, e); }
      if (evmPaid.usd >= (U.largeUsd || 20) && (!confirmLarge || !payOk())) return send(res, 401, { error: '需要两步验证码', code: U.totp?.on ? 'totp' : 'large' }); save(db); }
    else { if (isW && !(Number.isInteger(lamports) && lamports >= minLamports(P.usd))) return send(res, 400, { error: '金额低于最低 1 美元等值 SOL', code: 'amount' });
      if (isW && lamports / 1e9 * P.usd >= (U.largeUsd || 20)) { // 大额支付确认（开启两步验证时需验证码）
        if (!confirmLarge) return send(res, 400, { error: 'large payment needs confirmation', code: 'large' });
        if (!payOk()) { save(db); return send(res, 401, { error: '验证码错误', code: 'totpBad' }); } save(db); } }
    try { const wishLam = isW && !evmPaid ? lamports : 0; const sig = await web3.sendAndConfirmTransaction(conn, buildMemoTx(kp.publicKey, memo, wishLam), [kp], { commitment: 'confirmed' });
      if (wishLam > 0 || evmPaid) { const parts = memo.split('|'); Fulfill.registerWish({ wishSig: sig, cat: parts[5].split('~')[0], text: /~F..P(~|$)/.test(parts[5]) ? '🔒' : parts[6], author: kp.publicKey.toBase58(), lamports: wishLam || Math.round(evmPaid.usd / P.usd * 1e9), source: evmPaid ? 'evm:' + evm.chainId : 'host' }); }
      return send(res, 200, { signature: sig }); }
    catch (e) { return send(res, 200, { error: '上链失败: ' + e.message, code: 'chain', detail: e.message }); }
  }
  send(res, 404, { error: 'not found' });
}

const CORS_RE = new RegExp(process.env.CORS_ORIGIN_RE || '^https://([a-z0-9]+\\.)?world-tree\\.pages\\.dev$'), ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (url.startsWith('/api/')) { // CORS：允许 Cloudflare Pages 前端（*.pages.dev 的 world-tree 项目及预览）与 ALLOWED_ORIGINS（自定义域名）；鉴权用 Bearer token，不用 cookie
    const o = req.headers.origin; if (o && (CORS_RE.test(o) || ALLOWED.includes(o))) { res.setHeader('access-control-allow-origin', o); res.setHeader('vary', 'origin'); res.setHeader('access-control-allow-headers', 'content-type, authorization'); res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS'); res.setHeader('access-control-max-age', '86400'); }
    else if (url.startsWith('/api/img/')) res.setHeader('access-control-allow-origin', '*'); // 公开图片（私密卡内页为密文）
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    return api(req, res, url).catch(e => send(res, 500, { error: e.message })); }
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
