// 交友卡联系方式（仅链下，按卡片签名 + 所有者存储，可随时修改/删除）与礼品卡索引（接收方 → 卡片签名）。持久化经 persist.js 写回 D1。
const fs = require('fs'), path = require('path'), bs58 = require('bs58');
const b58 = bs58.default || bs58;
const F = path.join(__dirname, 'data', 'social.json');
function load() { try { const d = JSON.parse(fs.readFileSync(F)); return { contacts: d.contacts || {}, gifts: d.gifts || {}, giftSeen: d.giftSeen || {} }; } catch { return { contacts: {}, gifts: {}, giftSeen: {} }; } }
function save(d) { fs.mkdirSync(path.dirname(F), { recursive: true }); fs.writeFileSync(F, JSON.stringify(d), { mode: 0o600 }); }
const solOk = a => { if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a || '')) return false; try { return b58.decode(a).length === 32; } catch { return false; } };
const evmOk = a => /^0x[0-9a-fA-F]{40}$/.test(a || '');
const addrKey = a => evmOk(a) ? a.toLowerCase() : a;
const len = s => [...String(s || '')].length;
// 分类字段：分类~S~t标签,标签~i简介~l想认识   或   分类~G~T地址~M赠言   （旧客户端忽略未知段，按普通心愿显示）
function parseKind(prefix) { const [, o = '', ...ex] = String(prefix || '').split('~'), f = p => { const x = ex.find(s => s[0] === p); return x == null ? '' : x.slice(1); };
  if (o === 'S') return { kind: 'social', tags: f('t') ? f('t').split(',') : [], intro: f('i'), looking: f('l') };
  if (o === 'G') return { kind: 'gift', to: f('T'), note: f('M') };
  return { kind: 'wish' }; }
function validate(K) { // → 错误码或 null
  if (K.kind === 'social') { if (K.tags.length > 5 || K.tags.some(t => !t.trim() || len(t) > 10) || len(K.intro) > 80 || len(K.looking) > 30) return 'field'; }
  if (K.kind === 'gift') { if (!(solOk(K.to) || evmOk(K.to))) return 'giftTo'; if (len(K.note) > 50) return 'field'; }
  return null; }
module.exports = { load, save, solOk, evmOk, addrKey, parseKind, validate, len };
