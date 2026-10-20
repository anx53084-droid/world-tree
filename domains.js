// 域名清单（后手方案）：域名被浏览器 / 钱包标记有问题时，管理员可一键换主域；前端启动时读取 /api/domains 提示并跳转。
// 数据 data/domains.json = { domains: { host: {status, primary, note, at} }, updatedAt }，经 persist.js 同步 D1。
// CORS 白名单 = 清单内全部域名（含 blocked：旧域上的用户仍需能拉到“请换域”的提示）+ ALLOWED_ORIGINS + CORS_ORIGIN_RE。
const fs = require('fs'), path = require('path');
const F = path.join(require('./network').DATA_DIR, 'domains.json'), STATUS = ['active', 'standby', 'blocked'], MAX = 50;
const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/; // 只接受域名（无端口 / 路径 / IP / 凭据）
const SEED = (process.env.DOMAINS_SEED || 'world-tree.pages.dev').split(',').map(x => x.trim().toLowerCase()).filter(x => HOST.test(x));
// 启动时补齐的内置域名（只补缺失项，且一律 standby；不改已有域名的状态 / 主域）。换主域仍走管理端点。要永久删除某个域，同时把它从 DOMAINS_ENSURE 去掉。
const ENSURE = (process.env.DOMAINS_ENSURE ?? 'guangqi.world,www.guangqi.world').split(',').map(x => x.trim().toLowerCase()).filter(x => HOST.test(x));
let D = null; const err = c => Object.assign(new Error(c), { code: c });
function load() { if (D) return D; let j = null; try { j = JSON.parse(fs.readFileSync(F, 'utf8')); } catch {}
  D = { domains: (j && j.domains && !Array.isArray(j.domains)) ? j.domains : {}, updatedAt: (j && j.updatedAt) || 0 };
  if (!Object.keys(D.domains).length) { SEED.forEach((h, i) => D.domains[h] = { status: 'active', primary: i === 0, note: 'seed', at: 0 }); if (SEED.length) save(); }
  let ch = false; for (const h of ENSURE) if (!D.domains[h] && Object.keys(D.domains).length < MAX) { D.domains[h] = { status: 'standby', primary: false, note: 'ensure', at: Math.floor(Date.now() / 1000) }; ch = true; } if (ch) save(); return D; }
function save() { D.updatedAt = Math.floor(Date.now() / 1000); fs.mkdirSync(path.dirname(F), { recursive: true }); fs.writeFileSync(F, JSON.stringify(D), { mode: 0o600 }); }
const norm = h => String(h || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
function ok(h) { h = norm(h); if (!HOST.test(h)) throw err('host'); return h; }
function list() { const d = load(); return { domains: Object.entries(d.domains).map(([host, v]) => ({ host, status: v.status, primary: !!v.primary })).sort((a, b) => b.primary - a.primary || (a.host < b.host ? -1 : 1)), updatedAt: d.updatedAt }; }
const primary = () => list().domains.find(x => x.primary) || null;
function add(host, status = 'standby', note = '') { host = ok(host); const d = load(); if (!STATUS.includes(status)) throw err('status'); if (d.domains[host]) throw err('exists'); if (Object.keys(d.domains).length >= MAX) throw err('limit');
  d.domains[host] = { status, primary: false, note: String(note).slice(0, 80), at: Math.floor(Date.now() / 1000) }; save(); return list(); }
function setPrimary(host) { host = ok(host); const d = load(), x = d.domains[host]; if (!x) throw err('nf'); if (x.status === 'blocked') throw err('blocked'); // 不能把已标记 blocked 的域设为主域
  for (const v of Object.values(d.domains)) v.primary = false; x.primary = true; x.status = 'active'; save(); return list(); }
function setStatus(host, status) { host = ok(host); const d = load(), x = d.domains[host]; if (!x) throw err('nf'); if (!STATUS.includes(status)) throw err('status');
  if (x.primary && status !== 'active') throw err('primary'); // 主域不能直接降级：先切换主域
  x.status = status; save(); return list(); }
function remove(host) { host = ok(host); const d = load(), x = d.domains[host]; if (!x) throw err('nf'); if (x.primary) throw err('primary'); delete d.domains[host]; save(); return list(); }
// 故障转移：当前主域不可用 / 被标 blocked 时，选一个健康的 active/standby 域为新主域（healthy: host→bool，缺省视为健康）
function failover(healthy = () => true) { const d = load(), cur = primary(); if (cur && healthy(cur.host) && d.domains[cur.host].status !== 'blocked') return { changed: false, ...list() };
  const next = list().domains.find(x => !x.primary && x.status !== 'blocked' && healthy(x.host)); if (!next) throw err('none');
  if (cur) d.domains[cur.host].status = 'blocked'; setPrimary(next.host); return { changed: true, from: cur?.host || null, to: next.host, ...list() }; }
// CORS
const CORS_RE = new RegExp(process.env.CORS_ORIGIN_RE || '^https://([a-z0-9]+\\.)?world-tree\\.pages\\.dev$'), EXTRA = (process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
function originOk(o) { if (!o) return false; if (CORS_RE.test(o) || EXTRA.includes(o)) return true; let u; try { u = new URL(o); } catch { return false; }
  return u.protocol === 'https:' && !u.port && o === 'https://' + u.host && !!load().domains[u.host]; }
// 健康检查：HEAD https://host/（8 秒超时）。2xx/3xx 视为可用。
async function probe(host, f = fetch) { const t0 = Date.now(); try { const r = await f('https://' + host + '/', { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) }); return { host, ok: r.status < 400, status: r.status, ms: Date.now() - t0 }; } catch (e) { return { host, ok: false, status: 0, ms: Date.now() - t0, error: String(e.message || e).slice(0, 80) }; } }
async function check(f) { return Promise.all(list().domains.map(x => probe(x.host, f))); }
const reset = () => { D = null; };
module.exports = { HOST, STATUS, load, list, primary, add, setPrimary, setStatus, remove, failover, originOk, probe, check, reset, norm };
