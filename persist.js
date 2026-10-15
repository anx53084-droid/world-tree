// 持久化：Cloudflare D1（经 REST API）。启动时同步拉取到 data/*.json，之后对这些文件的写入自动按条目差量写回 D1（内存缓存 + write-through）。
// 环境变量：D1_API_TOKEN、D1_ACCOUNT_ID、D1_DATABASE_ID；未设置则仅用本地文件。
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const E = process.env, ON = !!(E.D1_API_TOKEN && E.D1_ACCOUNT_ID && E.D1_DATABASE_ID);
const DIR = path.join(__dirname, 'data'), FILES = ['users.json', 'fulfillments.json', 'fund-ledger.json', 'moderator.json', 'payees.json', 'social.json', 'gates.json', 'ads.json'];
const URL_ = () => `https://api.cloudflare.com/client/v4/accounts/${E.D1_ACCOUNT_ID}/d1/database/${E.D1_DATABASE_ID}/query`;
async function q(sql, params = []) { const r = await fetch(URL_(), { method: 'POST', headers: { authorization: 'Bearer ' + E.D1_API_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ sql, params }) });
  const j = await r.json(); if (!j.success) throw new Error('D1 ' + JSON.stringify(j.errors)); return j.result[0].results; }
// 对象 → 行：顶层键 K；若值为普通对象则每个子键一行 "K/sub"（标记行 K = "{}"）
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function rows(o) { const m = new Map(); for (const [k, v] of Object.entries(o)) { if (isObj(v)) { m.set(k, '{}'); for (const [s, x] of Object.entries(v)) m.set(k + '/' + s, JSON.stringify(x)); } else m.set(k, JSON.stringify(v)); } return m; }
function unrows(list) { const o = {}; for (const { k, v } of list) if (!k.includes('/')) o[k] = JSON.parse(v);
  for (const { k, v } of list) { const i = k.indexOf('/'); if (i > 0) { const K = k.slice(0, i); if (!isObj(o[K])) o[K] = {}; o[K][k.slice(i + 1)] = JSON.parse(v); } } return o; }
async function pull() { await q('CREATE TABLE IF NOT EXISTS kv (f TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, t INTEGER, PRIMARY KEY (f, k))');
  const all = await q('SELECT f, k, v FROM kv'), by = {}; for (const r of all) (by[r.f] ||= []).push(r); fs.mkdirSync(DIR, { recursive: true });
  const out = {}; for (const f of FILES) { const p = path.join(DIR, f); if (by[f]) fs.writeFileSync(p, JSON.stringify(unrows(by[f]), null, 2), { mode: 0o600 }); out[f] = by[f]?.length || 0; } return out; }
const last = new Map(), pend = new Map(); let busy = Promise.resolve();
async function push(f, obj) { const cur = rows(obj), prev = last.get(f) || new Map(), up = [], del = [];
  for (const [k, v] of cur) if (prev.get(k) !== v) up.push([k, v]); for (const k of prev.keys()) if (!cur.has(k)) del.push(k);
  const t = Date.now(); for (let i = 0; i < up.length; i += 25) { const c = up.slice(i, i + 25);
    await q(`INSERT INTO kv (f, k, v, t) VALUES ${c.map(() => '(?,?,?,?)').join(',')} ON CONFLICT(f, k) DO UPDATE SET v = excluded.v, t = excluded.t`, c.flatMap(([k, v]) => [f, k, v, t])); }
  for (let i = 0; i < del.length; i += 90) { const c = del.slice(i, i + 90); await q(`DELETE FROM kv WHERE f = ? AND k IN (${c.map(() => '?').join(',')})`, [f, ...c]); }
  last.set(f, cur); }
function schedule(f, text) { pend.set(f, text); clearTimeout(pend.__t); pend.__t = setTimeout(flush, 150); }
function flush() { const jobs = [...pend]; pend.clear(); pend.__t = null; busy = busy.then(async () => { for (const [f, text] of jobs) { try { await push(f, JSON.parse(text)); } catch (e) { console.error('D1 write failed, retrying:', e.message); pend.set(f, text); setTimeout(flush, 5000); } } }); }
function init() { if (!ON) return console.log('persistence: local files (D1 not configured)');
  const r = spawnSync(process.execPath, [__filename, '--pull'], { env: E, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) { console.error('D1 pull failed:', (r.stderr || '').slice(0, 300)); process.exit(1); } // 不用空数据启动，避免覆盖 D1
  console.log('persistence: D1', r.stdout.trim());
  const cnt = JSON.parse(r.stdout.trim().split('\n').pop()); // 仅当 D1 中已有该文件时才以其为基线；否则把本地文件整份上传（首次部署）
  for (const f of FILES) { const p = path.join(DIR, f); if (!fs.existsSync(p)) continue; if (cnt[f]) { try { last.set(f, rows(JSON.parse(fs.readFileSync(p)))); } catch {} } else pend.set(f, fs.readFileSync(p, 'utf8')); }
  if (pend.size) flush();
  const w = fs.writeFileSync; fs.writeFileSync = function (p, data, ...a) { w.call(fs, p, data, ...a); const f = typeof p === 'string' && path.dirname(path.resolve(p)) === DIR && path.basename(p);
    if (f && FILES.includes(f)) schedule(f, String(data)); };
  const bye = () => { flush(); busy.finally(() => process.exit(0)); setTimeout(() => process.exit(0), 8000); }; process.once('SIGTERM', bye); process.once('SIGINT', bye); }
if (require.main === module && process.argv[2] === '--pull') pull().then(o => { console.log(JSON.stringify(o)); }, e => { console.error(e.message); process.exit(1); });
module.exports = { init, ON, flushNow: () => (flush(), busy), q };
