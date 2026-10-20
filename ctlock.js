// 交友卡「联系方式 + 详情」可选保护：加锁（交友意向金，链上付款解锁）/ 加密（客户端 PBKDF2 + AES-GCM，服务端仅存密文）
// 加锁费用规则（单一配置源）：平台技术服务费 = 金额 × feePct，且不低于 feeMinUsd（不超过金额本身）；其余全部转给卡片作者钱包。
// 该费用是平台技术服务费，不是网络 gas；网络 gas 由付款人自己的钱包支付。
const crypto = require('crypto');
const CFG = { minUsd: 2, maxUsd: 30, feePct: 0.30, feeMinUsd: 1, quoteMin: 15 };
const r2 = x => Math.round(x * 100) / 100;
const feeUsd = usd => r2(Math.min(usd, Math.max(CFG.feeMinUsd, usd * CFG.feePct)));
const usdOk = u => typeof u === 'number' && Number.isFinite(u) && u >= CFG.minUsd && u <= CFG.maxUsd && r2(u) === u;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
function encOk(e) { // 客户端加密参数：salt / iv / ct 为 base64；ak = 由密码派生的“校验密钥”（与加密密钥分离），服务端只存其 scrypt 哈希
  return !!e && typeof e === 'object' && B64.test(e.salt || '') && e.salt.length <= 44 && Number.isInteger(e.iter) && e.iter >= 100000 && e.iter <= 2000000
    && B64.test(e.iv || '') && e.iv.length === 16 && B64.test(e.ct || '') && e.ct.length <= 4000 && /^[0-9a-f]{64}$/.test(e.ak || ''); }
function hashAk(ak) { const s = crypto.randomBytes(16).toString('hex'); return { akSalt: s, akHash: crypto.scryptSync(ak, s, 32, { N: 16384, r: 8, p: 1 }).toString('hex') }; }
function checkAk(ak, s, h) { if (!/^[0-9a-f]{64}$/.test(ak || '') || !s || !h) return false; const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(ak, s, 32, { N: 16384, r: 8, p: 1 }); return a.length === b.length && crypto.timingSafeEqual(a, b); }
const breakdown = usd => { const f = feeUsd(usd); return { usd, feeUsd: f, restUsd: r2(usd - f) }; };
const tries = new Map(); // 密码尝试限速：同一卡 + 来源 10 分钟内最多 5 次失败
function limited(key) { const now = Date.now(), a = (tries.get(key) || []).filter(t => now - t < 600000); tries.set(key, a); if (tries.size > 20000) tries.clear(); return a.length >= 5; }
const fail = key => { const a = tries.get(key) || []; a.push(Date.now()); tries.set(key, a); };
module.exports = { CFG, feeUsd, usdOk, encOk, hashAk, checkAk, breakdown, limited, fail, r2 };
