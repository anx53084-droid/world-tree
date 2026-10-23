// t260：卡片内容自动翻译（仅用于显示，不修改链上/存储原文）。
// 免费提供方链（无需密钥）：Google gtx 公共端点 → MyMemory 免费 API → Lingva（公共实例）。
// 缓存：内存 + data/translations.json（经 persist.js 写回 D1），键 = sha256(text)|target。限流：每 IP + 全局每日字符预算。
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const Net = require('./network'), FILE = path.join(Net.DATA_DIR, 'translations.json');
const LANGS = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi', 'id', 'th', 'tr', 'vi', 'it', 'nl', 'pl', 'uk', 'fa', 'bn', 'ur', 'fil', 'ms', 'sw'];
const MAX_ITEMS = 20, MAX_LEN = 600, CAP = 20000, DAY_BUDGET = +(process.env.TRANSLATE_DAY_CHARS || 300000);
const base = l => (l || '').toLowerCase().split('-')[0];
const same = (a, b) => { a = (a || '').toLowerCase(); b = (b || '').toLowerCase(); return !!a && (a === b || (base(a) === base(b) && base(a) !== 'zh') || (base(a) === 'zh' && base(b) === 'zh' && (a === 'zh' || b === 'zh' || a.replace('zh-hans', 'zh-cn').replace('zh-hant', 'zh-tw') === b))); };
let C = null, dirty = false, saveT = null;
function load() { if (C) return C; try { C = JSON.parse(fs.readFileSync(FILE, 'utf8')).c || {}; } catch { C = {}; } return C; }
function persist() { dirty = true; if (saveT) return; saveT = setTimeout(() => { saveT = null; if (!dirty) return; dirty = false;
  const keys = Object.keys(C); if (keys.length > CAP) keys.sort((a, b) => C[a][2] - C[b][2]).slice(0, keys.length - CAP).forEach(k => delete C[k]);
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify({ c: C }), { mode: 0o600 }); } catch (e) { console.error('translate save', e.message); } }, 3000); }
const hkey = (s, tl) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32) + '|' + tl;
const B = new Map(); function hit(key, max, ms) { const now = Date.now(), b = B.get(key); if (!b || b[1] < now) { B.set(key, [1, now + ms]); return false; } if (b[0] >= max) return true; b[0]++; return false; }
let day = { d: '', n: 0 }; const budget = n => { const d = new Date().toISOString().slice(0, 10); if (day.d !== d) day = { d, n: 0 }; if (day.n + n > DAY_BUDGET) return false; day.n += n; return true; };
const stat = { gtx: 0, mymemory: 0, lingva: 0, fail: 0, cache: 0 };
const ft = (u, ms = 8000) => fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (guangqi.world translate)' }, signal: AbortSignal.timeout(ms) });
const G = l => l === 'fil' ? 'tl' : l, UG = l => l === 'tl' ? 'fil' : l; // Filipino：服务商用 tl
async function gtx(s, sl, tl) { sl = sl && G(sl); tl = G(tl); const r = await ft(`https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${sl || 'auto'}&tl=${tl}&q=${encodeURIComponent(s)}`);
  if (!r.ok) throw new Error('gtx ' + r.status); const j = await r.json(); const out = (j[0] || []).map(x => x[0] || '').join(''); if (!out) throw new Error('gtx empty'); return { t: out, src: UG(j[2] || sl || '') }; }
async function mym(s, sl, tl) { sl = sl && G(sl); tl = G(tl); const r = await ft(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(s)}&langpair=${sl || 'autodetect'}|${tl}`);
  const j = await r.json(); if (!r.ok || j.quotaFinished || +j.responseStatus !== 200) throw new Error('mymemory ' + (j.responseStatus || r.status));
  const out = j.responseData?.translatedText; if (!out || /MYMEMORY WARNING|INVALID/i.test(out)) throw new Error('mymemory bad'); return { t: out, src: UG(j.responseData?.detectedLanguage || sl || '') }; }
const lv = l => l === 'zh-CN' ? 'zh' : l === 'zh-TW' ? 'zh_HANT' : l === 'fil' ? 'tl' : l;
async function lingva(s, sl, tl) { const r = await ft(`https://lingva.ml/api/v1/${sl ? lv(sl) : 'auto'}/${lv(tl)}/${encodeURIComponent(s)}`);
  if (!r.ok) throw new Error('lingva ' + r.status); const j = await r.json(); if (!j.translation) throw new Error('lingva empty'); return { t: j.translation, src: UG(j.info?.detectedSource || sl || '') }; }
let gtxOffUntil = 0;
async function one(s, sl, tl) {
  if (Date.now() > gtxOffUntil) { try { const r = await gtx(s, sl, tl); stat.gtx++; return { ...r, p: 'gtx' }; } catch (e) { if (/429|403/.test(e.message)) gtxOffUntil = Date.now() + 10 * 60000; } }
  try { const r = await mym(s, sl, tl); stat.mymemory++; return { ...r, p: 'mymemory' }; } catch {}
  try { const r = await lingva(s, sl, tl); stat.lingva++; return { ...r, p: 'lingva' }; } catch {}
  stat.fail++; return null; }
const SRC_OK = /^(zh-CN|zh-TW|zh|en|ja|ko|es|fr|de|pt|ru|ar|hi|id|th|tr|vi|it|nl|pl|uk|fa|bn|ur|fil|ms|sw)$/;
async function handle(req, res, url, X) {
  const { send, body, ip } = X;
  if (url === '/api/translate/stats' && req.method === 'GET') return send(res, 200, { ...stat, cached: Object.keys(load()).length, today: day }), true;
  if (url !== '/api/translate' || req.method !== 'POST') return false;
  const b = await body(req, 20000), tl = String(b.target || ''), sl = SRC_OK.test(b.source || '') ? b.source : '';
  if (!LANGS.includes(tl)) return send(res, 400, { error: 'target' }), true;
  const items = (Array.isArray(b.texts) ? b.texts : []).slice(0, MAX_ITEMS).map(s => String(s || '').slice(0, MAX_LEN));
  const c = load(), out = [], need = [];
  items.forEach((s, i) => { if (!s.trim()) return out[i] = null; const e = c[hkey(s, tl)]; if (e) { stat.cache++; e[2] = Date.now(); out[i] = e[1] === '=' ? { same: true } : { t: e[0], src: e[1] }; } else need.push(i); });
  if (need.length) {
    const who = ip(req), chars = need.reduce((n, i) => n + items[i].length, 0);
    if (hit('tr:' + who, 40, 10 * 60000) || hit('trc:' + who, 20000, 3600000) || !budget(chars)) { need.forEach(i => out[i] = null); return send(res, 200, { items: out, limited: true }), true; }
    let q = need.slice(); const run = async () => { while (q.length) { const i = q.shift(), s = items[i], r = await one(s, sl, tl);
      if (!r) { out[i] = null; continue; }
      const isSame = same(r.src, tl) || r.t.trim() === s.trim(); c[hkey(s, tl)] = isSame ? ['', '=', Date.now()] : [r.t, r.src, Date.now()]; persist();
      out[i] = isSame ? { same: true } : { t: r.t, src: r.src }; } };
    await Promise.all([run(), run(), run()]);
  }
  return send(res, 200, { items: out }), true;
}
module.exports = { handle, LANGS };
