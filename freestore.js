// t276：免费心愿独立存储 + 持久化每日限额。
// - 有 D1：表 free_wish（每条一行，不再整份放进 social.json / 内存），内存只保留最新 FREE_MEM_N 条供首页列表；按 id 查询走 D1。
// - 免费额度（每 IP / 每设备 / 每账户终身 1 条；全站按天）存在 D1 表 free_rate，重启、休眠、重新部署都不会清零；D1 出错时退回内存计数（不阻塞用户）。
// - 容量守护：D1 接近 D1_WARN_BYTES（默认 450MB，D1 免费单库 500MB）时告警日志；超过 D1_STOP_BYTES（默认 490MB）暂停新免费心愿，而不是崩溃。
// - 无 D1（本地开发/测试）：data/free-wishes.json 本地文件。
const fs = require('fs'), path = require('path'), P = require('./persist'), Net = require('./network');
const E = process.env, num = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);
const CFG = { perLife: num(E.FREE_PER_PERSON, 1), dayCap: num(E.FREE_DAY_CAP, 5e10), keep: num(E.FREE_KEEP_CAP, 5e11), memN: num(E.FREE_MEM_N, 300), warn: num(E.D1_WARN_BYTES, 450e6), stop: num(E.D1_STOP_BYTES, 490e6) };
const ON = P.ON, LF = path.join(Net.DATA_DIR, 'free-wishes.json');
let mem = [], local = null, count = 0, ready = null, warnAt = 0; const cache = new Map(); // cache：最近按 id 查到的旧心愿（小 LRU）
const row = r => r && { id: r.id, text: r.text, cat: r.cat, cover: r.cover == null ? undefined : r.cover, at: r.at, tok: r.tok, ip: r.ip, up: r.up || undefined, upAt: r.upAt || undefined };
const saveLocal = () => { try { fs.mkdirSync(path.dirname(LF), { recursive: true }); fs.writeFileSync(LF, JSON.stringify(local)); } catch (e) { console.error('free local save', e.message); } };
function remember(f) { if (f.up) { mem = mem.filter(x => x.id !== f.id); return; } mem = [f, ...mem.filter(x => x.id !== f.id)].sort((a, b) => b.at - a.at).slice(0, CFG.memN); }
function guard() { const sz = P.size(); if (sz > CFG.warn && Date.now() - warnAt > 3600000) { warnAt = Date.now(); console.error(`⚠️ ADMIN: D1 size ${(sz / 1e6).toFixed(0)}MB ≥ warn ${(CFG.warn / 1e6).toFixed(0)}MB — free wishes ${sz > CFG.stop ? 'PAUSED' : 'still on'}; clean up or upgrade storage`); } }
const full = () => { guard(); return ON && P.size() > CFG.stop; };
// legacy：把 social.json 里旧的 st.free 迁移出来（一次性），返回是否迁移
async function init(st) { return ready ||= (async () => {
  if (!ON) { try { local = JSON.parse(fs.readFileSync(LF, 'utf8')); } catch { local = {}; } }
  else { await P.q('CREATE TABLE IF NOT EXISTS free_wish (id TEXT PRIMARY KEY, text TEXT NOT NULL, cat TEXT, cover INTEGER, at INTEGER NOT NULL, tok TEXT, ip TEXT, up TEXT, upAt INTEGER)');
    await P.q('CREATE INDEX IF NOT EXISTS free_wish_at ON free_wish(at)');
    await P.q('CREATE TABLE IF NOT EXISTS free_rate (k TEXT PRIMARY KEY, n INTEGER NOT NULL, exp INTEGER NOT NULL)'); }
  const old = Object.values(st?.free || {}); for (const f of old) await put(f, true);
  if (ON) { mem = (await P.q('SELECT * FROM free_wish WHERE up IS NULL ORDER BY at DESC LIMIT ?', [CFG.memN])).map(row); count = (await P.q('SELECT COUNT(*) AS n FROM free_wish'))[0]?.n || 0; }
  else { mem = []; for (const f of Object.values(local)) remember(f); count = Object.keys(local).length; }
  console.log(`free wishes: ${ON ? 'D1 table' : 'local file'}, total ${count}, in memory ${mem.length}, caps day=${CFG.dayCap} keep=${CFG.keep} perPersonLifetime=${CFG.perLife} warn=${CFG.warn} stop=${CFG.stop}`);
  return old.length > 0; })(); }
async function put(f, migrate) {
  if (ON) await P.q('INSERT INTO free_wish (id, text, cat, cover, at, tok, ip, up, upAt) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET up = excluded.up, upAt = excluded.upAt', [f.id, f.text, f.cat, f.cover ?? null, f.at, f.tok, f.ip, f.up || null, f.upAt || null]);
  else { local[f.id] = f; saveLocal(); }
  if (!migrate) { count++; remember(f); guard(); if (count > CFG.keep) trim(); } }
async function trim() { const n = count - CFG.keep; if (n <= 0) return; // 仅在超过（默认 5000 亿）保留上限时删除最旧的
  if (ON) await P.q('DELETE FROM free_wish WHERE id IN (SELECT id FROM free_wish ORDER BY at ASC LIMIT ?)', [n]); else { Object.values(local).sort((a, b) => a.at - b.at).slice(0, n).forEach(f => delete local[f.id]); saveLocal(); } count -= n; }
async function get(id) { await ready; const m = mem.find(x => x.id === id) || cache.get(id); if (m) return m;
  const f = ON ? row((await P.q('SELECT * FROM free_wish WHERE id = ?', [id]))[0]) : local[id]; if (f) { cache.set(id, f); if (cache.size > 500) cache.delete(cache.keys().next().value); } return f || null; }
async function markUp(id, sig) { const f = await get(id); if (!f) return null; f.up = sig; f.upAt = Date.now();
  if (ON) await P.q('UPDATE free_wish SET up = ?, upAt = ? WHERE id = ?', [sig, f.upAt, id]); else { local[id] = f; saveLocal(); } remember(f); return f; }
// 每日计数（UTC 自然日）。返回 true = 已超限
const MB = new Map(); const day = () => new Date().toISOString().slice(0, 10).replace(/-/g, ''), FOREVER = 4102444800000; // 2100 年
function memTake(k, max) { const n = (MB.get(k) || 0) + 1; MB.set(k, n); if (MB.size > 50000) MB.clear(); return n > max; }
async function take(k, max, life) { const key = life ? 'life:' + k : k + '|' + day(); if (!ON) return memTake(key, max);
  try { const r = await P.q('INSERT INTO free_rate (k, n, exp) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n', [key, life ? FOREVER : Date.now() + 2 * 86400000]); return (r[0]?.n || 1) > max; }
  catch (e) { console.error('free_rate D1', e.message); return memTake(key, max); } }
// t277：每个 IP / 设备 / 登录账户终身仅 1 条免费心愿（不按天重置）；全站仍按天计
async function overLimit(ipk, devk, acct) { await ready; if (await take('ip:' + ipk, CFG.perLife, 1)) return 'mine'; if (devk && await take('dev:' + devk, CFG.perLife, 1)) return 'mine'; if (acct && await take('acct:' + acct, CFG.perLife, 1)) return 'mine'; return (await take('all', CFG.dayCap)) ? 'all' : false; } // 'mine' = 本人额度已用；'all' = 全站上限
if (ON) setInterval(() => P.q('DELETE FROM free_rate WHERE exp < ?', [Date.now()]).catch(() => {}), 3600000).unref();
module.exports = { CFG, init, recent: () => mem, get, put, markUp, overLimit, full, take: async (k, max, life) => { await ready; return take(k, max, life); }, stats: () => ({ total: count, mem: mem.length, d1Bytes: P.size(), warn: P.size() > CFG.warn, paused: full() }) };
