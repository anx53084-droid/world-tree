// 账户安全 + 站内信：钱包签名登录（SIWE / Sign-In-With-Solana 风格）、会话设备管理、邮箱验证、TOTP 两步验证、大额支付确认、站内信与消息设置
// 非托管：钱包私钥永不离开钱包；服务器只验证签名。EVM 钱包用于登录与在测试网支付（愿望仍记录在 Solana devnet）。
const crypto = require('crypto'), nacl = require('tweetnacl'), bs58 = require('bs58');
const { secp256k1 } = require('@noble/curves/secp256k1'), { keccak_256 } = require('@noble/hashes/sha3');
const b58 = bs58.default || bs58;
const hex = u => Buffer.from(u).toString('hex'), unhex = h => Uint8Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex'));

// ---- EVM 测试网（可用 EVM_RPC_<chainId> 覆盖 RPC）----
const CHAINS = { 97: { key: 'bsc', name: 'BNB Smart Chain Testnet', sym: 'tBNB', coin: 'binancecoin', rpc: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545', exp: 'https://testnet.bscscan.com' },
  84532: { key: 'base', name: 'Base Sepolia', sym: 'ETH', coin: 'ethereum', rpc: 'https://sepolia.base.org', exp: 'https://sepolia.basescan.org' },
  11155111: { key: 'eth', name: 'Sepolia', sym: 'ETH', coin: 'ethereum', rpc: 'https://ethereum-sepolia-rpc.publicnode.com', exp: 'https://sepolia.etherscan.io' },
  421614: { key: 'arb', name: 'Arbitrum Sepolia', sym: 'ETH', coin: 'ethereum', rpc: 'https://sepolia-rollup.arbitrum.io/rpc', exp: 'https://sepolia.arbiscan.io' } };
for (const id in CHAINS) if (process.env['EVM_RPC_' + id]) CHAINS[id].rpc = process.env['EVM_RPC_' + id];
const isAddr = a => /^0x[0-9a-fA-F]{40}$/.test(a || '');
const EVM_DEV = isAddr(process.env.EVM_DEV_ADDRESS) ? process.env.EVM_DEV_ADDRESS.toLowerCase() : '', EVM_TREASURY = isAddr(process.env.EVM_TREASURY_ADDRESS) ? process.env.EVM_TREASURY_ADDRESS.toLowerCase() : '';
const EVM_PAY = !!(EVM_DEV && EVM_TREASURY);

// ---- 签名登录 ----
const NONCES = new Map(); // nonce → 过期时间（一次性，5 分钟）
function nonce() { const n = crypto.randomBytes(12).toString('hex'); NONCES.set(n, Date.now() + 300000); if (NONCES.size > 5000) for (const [k, v] of NONCES) if (v < Date.now()) NONCES.delete(k); return n; }
function parseSiwe(msg) { // 解析 EIP-4361 风格消息（Solana 同格式）
  if (typeof msg !== 'string' || msg.length > 1500) return null; const L = msg.split('\n');
  const m = L[0].match(/^(\S+) wants you to sign in with your (Ethereum|Solana) account:$/); if (!m) return null;
  const f = k => (L.find(l => l.startsWith(k + ': ')) || '').slice(k.length + 2);
  return { domain: m[1], kind: m[2] === 'Ethereum' ? 'evm' : 'sol', address: L[1], uri: f('URI'), chainId: f('Chain ID'), nonce: f('Nonce'), issuedAt: f('Issued At') }; }
function evmRecover(msg, sigHex) { const s = unhex(sigHex); if (s.length !== 65) throw new Error('bad sig'); let v = s[64]; if (v >= 27) v -= 27;
  const m = Buffer.from(msg, 'utf8'), h = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${m.length}`), m]));
  const pub = secp256k1.Signature.fromCompact(s.slice(0, 64)).addRecoveryBit(v).recoverPublicKey(h).toRawBytes(false);
  return '0x' + hex(keccak_256(pub.slice(1)).slice(-20)); }
function verifyLogin({ message, signature }, allowHost) { // → { kind, address } 或抛错
  const p = parseSiwe(message); if (!p) throw Object.assign(new Error('bad message'), { code: 'siwe' });
  if (!allowHost(p.domain)) throw Object.assign(new Error('domain mismatch'), { code: 'siwe' });
  const exp = NONCES.get(p.nonce); if (!exp || exp < Date.now()) throw Object.assign(new Error('nonce expired'), { code: 'nonce' }); NONCES.delete(p.nonce);
  if (Math.abs(Date.now() - Date.parse(p.issuedAt)) > 600000) throw Object.assign(new Error('stale'), { code: 'nonce' });
  if (p.kind === 'evm') { if (!isAddr(p.address) || evmRecover(message, signature).toLowerCase() !== p.address.toLowerCase()) throw Object.assign(new Error('signature invalid'), { code: 'sig' }); return { kind: 'evm', address: p.address.toLowerCase() }; }
  let pk, sg; try { pk = b58.decode(p.address); sg = /^[0-9a-f]{128}$/i.test(signature) ? unhex(signature) : b58.decode(signature); } catch { throw Object.assign(new Error('signature invalid'), { code: 'sig' }); }
  if (pk.length !== 32 || sg.length !== 64 || !nacl.sign.detached.verify(Buffer.from(message, 'utf8'), sg, pk)) throw Object.assign(new Error('signature invalid'), { code: 'sig' });
  return { kind: 'sol', address: p.address }; }

// ---- TOTP（RFC 6238，兼容 Google Authenticator）----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32enc = b => { let bits = 0, v = 0, o = ''; for (const x of b) { v = (v << 8) | x; bits += 8; while (bits >= 5) { o += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) o += B32[(v << (5 - bits)) & 31]; return o; };
const b32dec = s => { let bits = 0, v = 0; const o = []; for (const c of s.replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(c); if (i < 0) continue; v = (v << 5) | i; bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(o); };
function hotp(secret, ctr) { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(ctr)); const h = crypto.createHmac('sha1', b32dec(secret)).update(c).digest(), o = h[19] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0'); }
const totpNow = (secret, t = Date.now()) => hotp(secret, Math.floor(t / 30000));
function totpOk(user, code) { const s = user.totp?.on && user.totp.secret; if (!s || !/^\d{6}$/.test(String(code || ''))) return false; const c = Math.floor(Date.now() / 30000);
  for (const d of [-1, 0, 1]) if (c + d > (user.totp.last || 0) && crypto.timingSafeEqual(Buffer.from(hotp(s, c + d)), Buffer.from(String(code)))) { user.totp.last = c + d; return true; } return false; } // 同一时间步不可重放

// ---- 邮件（可选：RESEND_API_KEY + MAIL_FROM；未配置时无法发送验证码）----
const MAIL_ON = !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM), ECHO = process.env.EMAIL_DEV_ECHO === '1';
async function sendMail(to, subject, text) { if (!MAIL_ON) return false;
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ from: process.env.MAIL_FROM, to, subject, text }), signal: AbortSignal.timeout(10000) });
  return r.ok; }

// ---- 会话 ----
const tokHash = t => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
function normSessions(db) { for (const [t, v] of Object.entries(db.sessions || {})) if (typeof v === 'string') db.sessions[t] = { uid: v, at: 0, last: 0, ua: '' }; }
function newSession(db, uid, req) { const token = crypto.randomBytes(24).toString('hex'), others = Object.values(db.sessions).filter(s => s.uid === uid).length;
  db.sessions[token] = { uid, at: Date.now(), last: Date.now(), ua: String(req.headers['user-agent'] || '').slice(0, 200) };
  const u = db.users[uid]; if (others && u?.pubkey) pushMsg(db, u.pubkey, { kind: 'login', ua: db.sessions[token].ua }); return token; }

// ---- 站内信（按收件人 Solana 地址归档：托管账户为其 devnet 地址，钱包账户为钱包地址）----
function pushMsg(db, pubkey, m) { db.inbox = db.inbox || {}; const L = db.inbox[pubkey] = db.inbox[pubkey] || [];
  L.unshift({ id: crypto.randomBytes(6).toString('hex'), at: Date.now(), read: false, ...m }); if (L.length > 200) L.length = 200; }
function prefs(u) { return { fulfil: u?.notify?.fulfil !== false, system: u?.notify?.system !== false }; }
function inboxOf(db, u) { const p = prefs(u), own = (db.inbox?.[u.pubkey] || []).filter(m => m.kind !== 'fulfil' || p.fulfil), rd = new Set(u.sysRead || []);
  const sys = p.system ? (db.sys || []).filter(m => m.at >= (u.created || 0) - 30 * 86400000).map(m => ({ ...m, kind: 'system', read: rd.has(m.id) })) : [];
  const items = [...own, ...sys].sort((a, b) => b.at - a.at).slice(0, 100); return { items, unread: items.filter(m => !m.read).length }; }
function notifyFulfil(db, author, info) { // 星愿大使标记还愿 → 给愿望主人发站内信（尊重其消息设置）
  if (!author) return 0; const owners = Object.values(db.users).filter(u => u.pubkey === author); if (owners.length && owners.every(u => !prefs(u).fulfil)) return 0;
  pushMsg(db, author, { kind: 'fulfil', sig: info.sig, text: String(info.text || '').slice(0, 140), note: String(info.note || '').slice(0, 280) }); return 1; }

// ---- EVM 付款校验（测试网原生币转账：20% 开发者 / 80% 金库）----
async function evmRpc(chainId, method, params) { const r = await fetch(CHAINS[chainId].rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10000) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result; }
async function verifyEvmPay(db, { chainId, txs }, from, usdPer, minUsd) {
  chainId = +chainId; if (!EVM_PAY) throw Object.assign(new Error('EVM payment disabled'), { code: 'evmOff' }); if (!CHAINS[chainId]) throw Object.assign(new Error('unsupported chain'), { code: 'evmChain' });
  if (!Array.isArray(txs) || txs.length !== 2 || !txs.every(h => /^0x[0-9a-fA-F]{64}$/.test(h)) || txs[0].toLowerCase() === txs[1].toLowerCase()) throw Object.assign(new Error('bad tx'), { code: 'evmTx' });
  db.usedEvm = db.usedEvm || {}; let dev = 0n, tre = 0n;
  for (const h of txs) { const k = chainId + ':' + h.toLowerCase(); if (db.usedEvm[k]) throw Object.assign(new Error('tx already used'), { code: 'evmUsed' });
    const [tx, rc] = await Promise.all([evmRpc(chainId, 'eth_getTransactionByHash', [h]), evmRpc(chainId, 'eth_getTransactionReceipt', [h])]);
    if (!tx || !rc || rc.status !== '0x1') throw Object.assign(new Error('tx not confirmed'), { code: 'evmPending' });
    if ((tx.from || '').toLowerCase() !== from || (tx.chainId && +tx.chainId !== chainId)) throw Object.assign(new Error('tx sender mismatch'), { code: 'evmTx' });
    const to = (tx.to || '').toLowerCase(), v = BigInt(tx.value); if (to === EVM_DEV) dev += v; else if (to === EVM_TREASURY) tre += v; else throw Object.assign(new Error('wrong recipient'), { code: 'evmTx' }); }
  const tot = dev + tre; if (!dev || !tre || dev * 100n < tot * 19n || dev * 100n > tot * 21n) throw Object.assign(new Error('split must be 20/80'), { code: 'evmSplit' });
  const usd = Number(tot) / 1e18 * usdPer; if (!(usd >= minUsd * 0.98)) throw Object.assign(new Error('amount below minimum'), { code: 'amount' });
  for (const h of txs) db.usedEvm[chainId + ':' + h.toLowerCase()] = Date.now(); return { usd, wei: tot.toString(), sym: CHAINS[chainId].sym }; }

module.exports = { CHAINS, EVM_DEV, EVM_TREASURY, EVM_PAY, MAIL_ON, ECHO, nonce, verifyLogin, evmRecover, parseSiwe, b32enc, totpNow, totpOk, sendMail, tokHash, normSessions, newSession, pushMsg, prefs, inboxOf, notifyFulfil, verifyEvmPay };
