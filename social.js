// 交友卡 / 礼品卡：链下元数据（联系方式、邀请、密码哈希、礼品索引、粗粒度位置备份）。持久化经 persist.js → D1。
const fs = require('fs'), path = require('path'), crypto = require('crypto'), bs58 = require('bs58');
const b58 = bs58.default || bs58;
const F = path.join(require('./network').DATA_DIR, 'social.json');
const VIS = { P: 'public', N: 'nearby', R: 'recent', I: 'invite', L: 'locked' };
const DEL = { T: 'tree', O: 'off', B: 'both' };
function load() {
  try {
    const d = JSON.parse(fs.readFileSync(F));
    return { contacts: d.contacts || {}, gifts: d.gifts || {}, giftSeen: d.giftSeen || {}, meta: d.meta || {}, unlocks: d.unlocks || {}, goods: d.goods || {}, att: d.att || {}, ctPaid: d.ctPaid || {}, ctUsed: d.ctUsed || {}, ctQuotes: d.ctQuotes || {}, biz: d.biz || {} };
  } catch { return { contacts: {}, gifts: {}, giftSeen: {}, meta: {}, unlocks: {}, goods: {}, att: {}, ctPaid: {}, ctUsed: {}, ctQuotes: {}, biz: {} }; }
}
function save(d) { fs.mkdirSync(path.dirname(F), { recursive: true }); fs.writeFileSync(F, JSON.stringify(d), { mode: 0o600 }); }
const solOk = a => { if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a || '')) return false; try { return b58.decode(a).length === 32; } catch { return false; } };
const evmOk = a => /^0x[0-9a-fA-F]{40}$/.test(a || '');
const addrKey = a => evmOk(a) ? a.toLowerCase() : a;
const len = s => [...String(s || '')].length;
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);
const cleanLoc = s => String(s || '').trim().replace(/[~|]/g, '').slice(0, 20);
// 分类字段：~S/~G + ~v可见性 + ~d投递(礼品) + ~A国家~B省~Y市(交友，可选) + 既有字段
function parseKind(prefix) { // 与前端 parseOpt 对齐：~S/~G/~H 可与 ~F 折页段并存；星语星愿亦可带 ~v/~A/~B/~Y
  const [, ...segs] = String(prefix || '').split('~');
  const kindTok = segs.find(x => x === 'S' || x === 'G' || x === 'H' || x === 'Q' || x === 'E');
  const rest = segs.filter(x => x !== kindTok && !/^F[0-9a-z]{2}P?$/.test(x));
  const f = p => { const x = rest.find(s => s[0] === p); return x == null ? '' : x.slice(1); };
  const vis = VIS[f('v')] || 'public', deliver = DEL[f('d')] || 'tree';
  const loc = { country: cleanLoc(f('A')), province: cleanLoc(f('B')), city: cleanLoc(f('Y')) };
  if (kindTok === 'Q') return { kind: 'gate', vis: 'public', deliver: 'tree', gateId: f('g'), name: f('n'), to: f('T'), expireAt: parseInt(f('e'), 10) || 0, hash: f('h') }; // 门卡：~Q ~g编号 ~n名称 ~T持有人 ~e到期秒(0/缺省=永久) ~h权益哈希
  if (kindTok === 'S') return { kind: 'social', vis, deliver: 'tree', tags: f('t') ? f('t').split(',').filter(Boolean).slice(0, 5) : [], intro: f('i'), looking: f('l'), ...loc };
  if (kindTok === 'E') return { kind: 'biz', vis, deliver: 'tree', name: f('n'), domain: f('D'), ...loc }; // 企业展示卡：~E ~n公司名 ~D官网域名（简介 / 完整网址存链下）
  if (kindTok === 'H') return { kind: 'goods', vis, deliver: 'tree', domain: f('D').slice(0, 40), pid: f('P').slice(0, 24), ...loc };
  if (kindTok === 'G') return { kind: 'gift', vis, deliver, to: f('T'), note: f('M'), ...loc };
  return { kind: 'wish', vis, deliver: 'tree', ...loc };
}
function validate(K) {
  if (K.kind === 'social') {
    if (!['public', 'nearby', 'recent'].includes(K.vis || 'public')) return 'vis';
    if (K.tags.length > 5 || K.tags.some(t => !t.trim() || len(t) > 10) || len(K.intro) > 80 || len(K.looking) > 30) return 'field';
    if (len(K.country) > 20 || len(K.province) > 20 || len(K.city) > 20) return 'field';
    if (K.vis === 'nearby' && !(K.city || K.province || K.country)) return 'cityNeed';
  }
  if (K.kind === 'gate') {
    if (!/^[a-z0-9][a-z0-9_-]{0,23}$/.test(K.gateId || '')) return 'gateId';
    if (!(solOk(K.to) || evmOk(K.to))) return 'giftTo';
    if (!K.name || len(K.name) > 20 || /[<>]/.test(K.name)) return 'field';
    if (!/^[0-9a-f]{16}$/.test(K.hash || '')) return 'field';
    if (K.expireAt && K.expireAt < Date.now() / 1000) return 'gateExp';
  }
  if (K.kind === 'gift') {
    if (!(solOk(K.to) || evmOk(K.to))) return 'giftTo';
    if (len(K.note) > 50) return 'field';
    if (!['public', 'nearby', 'recent', 'invite', 'locked'].includes(K.vis || 'public')) return 'vis';
    if (!['tree', 'off', 'both'].includes(K.deliver || 'tree')) return 'vis';
  }
  if (K.kind === 'biz') {
    if (!['public', 'nearby', 'recent'].includes(K.vis || 'public')) return 'vis';
    if (!K.name || len(K.name) > 30 || /[<>]/.test(K.name) || !/^[a-z0-9.-]{3,80}$/.test(K.domain || '') || !K.domain.includes('.')) return 'field';
    if (K.vis === 'nearby' && !(K.city || K.province || K.country)) return 'cityNeed';
  }
  if (K.kind === 'wish' || K.kind === 'goods') {
    if (!['public', 'nearby', 'recent'].includes(K.vis || 'public')) return 'vis';
    if (len(K.country || '') > 20 || len(K.province || '') > 20 || len(K.city || '') > 20) return 'field';
    if (K.vis === 'nearby' && !(K.city || K.province || K.country)) return 'cityNeed';
  }
  return null;
}
function locMatch(a, b) { // 优先同城，其次同省，再次同国家
  if (!a || !b) return false;
  if (a.city && b.city && norm(a.city) === norm(b.city)) return true;
  if (a.province && b.province && norm(a.province) === norm(b.province) && !a.city && !b.city) return true;
  if (a.country && b.country && norm(a.country) === norm(b.country) && !a.city && !b.city && !a.province && !b.province) return true;
  return false;
}
function hashPass(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(password), s, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt: s, hash: h };
}
function checkPass(password, salt, hash) {
  if (!salt || !hash || typeof password !== 'string' || !password) return false;
  try {
    const a = Buffer.from(hash, 'hex'), b = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}
module.exports = { load, save, solOk, evmOk, addrKey, parseKind, validate, len, norm, normCity: norm, cleanLoc, locMatch, hashPass, checkPass, VIS, DEL };
