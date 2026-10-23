// t279：树洞 Tree Hollow v1 —— 门卡（链下灵魂绑定记录，D1）、匿名留言光（每人终身 1 条，计数方式同免费心愿）、「我听见了」点亮、智慧之海解锁进度。
// - 门卡 v1 不上链：记录在 D1 表 hollow_card（账户 → 卡），不可转让（没有任何转让接口）。
// - 留言：先验证码 → 长度 → 钓鱼黑名单 → 自动审核（被拒不计数）→ D1 容量守护 → 终身额度（IP / 设备 / 账户，键 hmsg:*，表 free_rate）。
// - 举报走 /api/report（id 前缀 HM_，automod 自动复审、违规自动隐藏）。
// - 智慧之海：链上已审核心愿 ≥3（chainStats）+ 为 ≥5 位不同用户点亮 + 收到 ≥3 位不同用户点亮；只计次数、不计金额；
//   只统计登录用户；同 IP / 同设备的账号合并为一人（与免费额度同一反刷思路）。
// 平台不代发交易、不托管、不承诺任何收益。
const fs = require('fs'), path = require('path'), crypto = require('crypto'), P = require('./persist'), Net = require('./network'), Free = require('./freestore');
const ON = P.ON, LF = path.join(Net.DATA_DIR, 'hollow.json'), DAY = 86400000;
const DOORS = ['first', 'sea', 'phoenix', 'lotus', 'star', 'dragon', 'forest', 'crystal', 'wind', 'eternal'], OPEN = ['first', 'sea'];
const NEED = { wishes: 3, gave: 5, got: 3 };
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex'), id12 = () => crypto.randomBytes(6).toString('hex');
const clean = s => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(), len = s => [...s].length;
const MAXLEN = Math.max(20, +process.env.HOLLOW_MAXLEN || 200);
// 关怀提示（不拦截、不评判；只给写的人和读的人一条温和的求助资源提示）
const CARE = /(kill myself|end my life|suicid|self[- ]?harm|want to die|cut myself|no reason to live|自杀|自殺|轻生|輕生|想死|不想活|自残|自殘|割腕|活不下去|死にたい|自殺|자살|죽고\s*싶|suicidio|quiero morir|suicide|me tuer|selbstmord|umbringen|suicídio|quero morrer|самоубий|хочу умереть|انتحار|خودکشی|आत्महत्या|bunuh diri|tự tử|ฆ่าตัวตาย|intihar|suicidio|zelfmoord|samobój|самогубств|আত্মহত্যা|خودکشی|magpakamatay|bunuh diri|kujiua)/i;
let local = null, ready = null;
const saveLocal = () => { try { fs.mkdirSync(path.dirname(LF), { recursive: true }); fs.writeFileSync(LF, JSON.stringify(local)); } catch (e) { console.error('hollow local save', e.message); } };
function init() { return ready ||= (async () => {
  if (!ON) { try { local = JSON.parse(fs.readFileSync(LF, 'utf8')); } catch { local = {}; } for (const k of ['card', 'msg', 'light', 'ev', 'seen']) local[k] ||= k === 'msg' ? [] : {}; const nx = {}; for (const m of [...local.msg].sort((a, b) => a.at - b.at)) if (m.slot == null) m.slot = nx[m.door] = Math.max(nx[m.door] ?? -1, ...local.msg.filter(x => x.door === m.door && x.slot != null).map(x => x.slot)) + 1; return; }
  for (const s of ['CREATE TABLE IF NOT EXISTS hollow_card (acct TEXT NOT NULL, card TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (acct, card))',
    'CREATE TABLE IF NOT EXISTS hollow_msg (id TEXT PRIMARY KEY, door TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL, ip TEXT, dev TEXT, acct TEXT, lights INTEGER NOT NULL DEFAULT 0, care INTEGER NOT NULL DEFAULT 0)',
    'CREATE INDEX IF NOT EXISTS hollow_msg_door ON hollow_msg(door, at)',
    'CREATE TABLE IF NOT EXISTS hollow_light (mid TEXT NOT NULL, who TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (mid, who))',
    'CREATE TABLE IF NOT EXISTS hollow_ev (giver TEXT NOT NULL, recv TEXT NOT NULL, src TEXT NOT NULL, ip TEXT, dev TEXT, at INTEGER NOT NULL, PRIMARY KEY (giver, recv, src))',
    'CREATE INDEX IF NOT EXISTS hollow_ev_recv ON hollow_ev(recv)',
    'CREATE TABLE IF NOT EXISTS hollow_seen (acct TEXT NOT NULL, k TEXT NOT NULL, PRIMARY KEY (acct, k))']) await P.q(s);
  // t281：每条光有固定的格位 slot（按门顺序编号 0,1,2…；前端换算成「区 N · 第 k 个挂点」）；老数据按时间回填
  try { await P.q('ALTER TABLE hollow_msg ADD COLUMN slot INTEGER'); } catch {}
  await P.q('UPDATE hollow_msg SET slot = (SELECT COUNT(*) FROM hollow_msg h2 WHERE h2.door = hollow_msg.door AND (h2.at < hollow_msg.at OR (h2.at = hollow_msg.at AND h2.id < hollow_msg.id))) WHERE slot IS NULL');
})().catch(e => { ready = null; throw e; }); }
// ---- 存储（D1 或本地文件）----
async function cards(acct) { await init(); if (!acct) return []; if (!ON) return Object.keys(local.card[acct] || {}); return (await P.q('SELECT card FROM hollow_card WHERE acct = ?', [acct])).map(r => r.card); }
async function grant(acct, card) { await init(); if (!ON) { (local.card[acct] ||= {})[card] ||= Date.now(); saveLocal(); return; } await P.q('INSERT OR IGNORE INTO hollow_card (acct, card, at) VALUES (?, ?, ?)', [acct, card, Date.now()]); }
async function putMsg(m) { await init(); if (!ON) { m.slot = Math.max(-1, ...local.msg.filter(x => x.door === m.door).map(x => x.slot ?? -1)) + 1; local.msg.push(m); saveLocal(); return; }
  await P.q('INSERT INTO hollow_msg (id, door, text, at, ip, dev, acct, lights, care, slot) SELECT ?,?,?,?,?,?,?,0,?, COALESCE(MAX(slot), -1) + 1 FROM hollow_msg WHERE door = ?', [m.id, m.door, m.text, m.at, m.ip, m.dev, m.acct, m.care ? 1 : 0, m.door]); // 单条语句内取下一个格位，避免并发撞位
  m.slot = (await P.q('SELECT slot FROM hollow_msg WHERE id = ?', [m.id]))[0]?.slot ?? 0; }
async function getMsg(id) { await init(); if (!ON) return local.msg.find(m => m.id === id) || null; return (await P.q('SELECT * FROM hollow_msg WHERE id = ?', [id]))[0] || null; }
async function listMsgs(door, n) { await init(); if (!ON) return local.msg.filter(m => m.door === door).sort((a, b) => b.at - a.at).slice(0, n); return P.q('SELECT id, door, text, at, lights, care, slot FROM hollow_msg WHERE door = ? ORDER BY at DESC LIMIT ?', [door, n]); }
async function addLight(mid, whos) { await init(); whos = whos.filter(Boolean); if (!ON) { if (whos.some(w => local.light[mid + '|' + w])) return false; for (const w of whos) local.light[mid + '|' + w] = Date.now(); const m = local.msg.find(x => x.id === mid); if (m) m.lights = (m.lights || 0) + 1; saveLocal(); return true; }
  const had = await P.q(`SELECT who FROM hollow_light WHERE mid = ? AND who IN (${whos.map(() => '?').join(',')}) LIMIT 1`, [mid, ...whos]); if (had.length) return false;
  for (const w of whos) await P.q('INSERT OR IGNORE INTO hollow_light (mid, who, at) VALUES (?, ?, ?)', [mid, w, Date.now()]); await P.q('UPDATE hollow_msg SET lights = lights + 1 WHERE id = ?', [mid]); return true; }
async function seen(acct, keys) { await init(); keys = keys.filter(Boolean); if (!acct || !keys.length) return; if (!ON) { const s = local.seen[acct] ||= []; let ch = false; for (const k of keys) if (!s.includes(k)) { s.push(k); ch = true; } if (s.length > 40) s.splice(0, s.length - 40); if (ch) saveLocal(); return; }
  for (const k of keys) await P.q('INSERT OR IGNORE INTO hollow_seen (acct, k) VALUES (?, ?)', [acct, k]); }
async function seenOf(accts) { await init(); const out = {}; if (!accts.length) return out; if (!ON) { for (const a of accts) out[a] = local.seen[a] || []; return out; }
  for (let i = 0; i < accts.length; i += 50) { const part = accts.slice(i, i + 50); for (const r of await P.q(`SELECT acct, k FROM hollow_seen WHERE acct IN (${part.map(() => '?').join(',')})`, part)) (out[r.acct] ||= []).push(r.k); } return out; }
// 点亮事件（进度用）：giver/recv 都是登录账户；ip/dev 为哈希
async function lightEv(giver, recv, src, ipk, devk) { try { if (!giver || !recv || giver === recv) return; await init(); await seen(giver, ['i:' + ipk, devk && 'd:' + devk]);
  if (!ON) { const k = giver + '|' + recv + '|' + src; if (!local.ev[k]) { local.ev[k] = { giver, recv, src, ip: ipk, dev: devk || '', at: Date.now() }; saveLocal(); } return; }
  await P.q('INSERT OR IGNORE INTO hollow_ev (giver, recv, src, ip, dev, at) VALUES (?,?,?,?,?,?)', [giver, recv, src, ipk, devk || '', Date.now()]); } catch (e) { console.error('hollow ev', e.message); } }
async function evs(col, acct) { await init(); if (!ON) return Object.values(local.ev).filter(e => e[col] === acct); return P.q(`SELECT giver, recv, ip, dev FROM hollow_ev WHERE ${col} = ? LIMIT 2000`, [acct]); }
// 把共享 IP / 设备的账号合并成一个「人」（并查集），再数人数；与自己共享 IP / 设备的账号不计
function people(list, mine) { const par = new Map(), f = x => { while (par.get(x) !== x) x = par.get(x); return x; }, u = (a, b) => par.set(f(a), f(b));
  for (const { id } of list) par.set(id, id); const byKey = new Map();
  for (const { id, keys } of list) for (const k of keys) { if (byKey.has(k)) u(id, byKey.get(k)); else byKey.set(k, id); }
  const roots = new Set(); for (const { id, keys } of list) if (!keys.some(k => mine.has(k))) roots.add(f(id)); return roots.size; }
async function progress(acct, C) { const myKeys = new Set((await seenOf([acct]))[acct] || []);
  const gave = await evs('giver', acct), got = await evs('recv', acct);
  for (const e of gave) { myKeys.add('i:' + e.ip); if (e.dev) myKeys.add('d:' + e.dev); }
  const rs = [...new Set(gave.map(e => e.recv))], rSeen = await seenOf(rs);
  const gaveN = people(rs.map(id => ({ id, keys: rSeen[id] || [] })), myKeys);
  const gm = new Map(); for (const e of got) { const s = gm.get(e.giver) || new Set(); s.add('i:' + e.ip); if (e.dev) s.add('d:' + e.dev); gm.set(e.giver, s); }
  const gotN = people([...gm].map(([id, s]) => ({ id, keys: [...s] })), myKeys);
  let wishes = 0; try { wishes = (await C.chainStats(acct, C.user)).wishes || 0; } catch {}
  return { wishes: Math.min(wishes, 99), gave: gaveN, got: gotN, need: NEED, done: wishes >= NEED.wishes && gaveN >= NEED.gave && gotN >= NEED.got }; }
const B = new Map(); function hit(key, max, ms) { const now = Date.now(), b = B.get(key); if (!b || b[1] < now) { B.set(key, [1, now + ms]); return false; } if (b[0] >= max) return true; b[0]++; return false; }
setInterval(() => { const now = Date.now(); for (const [k, v] of B) if (v[1] < now) B.delete(k); }, 600000).unref();
// t280：站长 / 管理员钱包白名单（服务端配置，env HOLLOW_OWNERS 逗号分隔可覆盖）；只认钱包签名登录产生的会话（uid = sol:<地址>），不信任客户端传的地址
const OWNERS = new Set(String(process.env.HOLLOW_OWNERS || '2Xjes9L3kePHUKyQaFfueHr933d6V71rPSSF3zZxL6pc').split(',').map(x => x.trim()).filter(Boolean));
const isOwner = a => !!(a && typeof a.uid === 'string' && a.uid.startsWith('sol:') && OWNERS.has(a.uid.slice(4)) && a.user?.pubkey === a.uid.slice(4));
const pubMsg = (m, hid) => ({ id: 'HM_' + m.id, door: m.door, text: m.text, at: m.at, lights: m.lights || 0, care: !!m.care, slot: m.slot ?? 0 });
async function handle(req, res, url, C) { if (!url.startsWith('/api/hollow/')) return false;
  const { send, body, Soc } = C, ip = C.ip(req), ipk = sha('ip|' + ip).slice(0, 16), a = C.auth(req), acct = a?.user?.pubkey || null;
  const devRaw = String(req.headers['x-wt-dev'] || '').replace(/[^0-9a-zA-Z_-]/g, '').slice(0, 64), devk = devRaw ? sha(devRaw).slice(0, 16) : '';
  try { await init(); } catch (e) { return send(res, 503, { error: 'store', code: 'rate' }), true; }
  if (acct) seen(acct, ['i:' + ipk, devk && 'd:' + devk]).catch(() => {});
  const owner = isOwner(a), doorOk = d => OPEN.includes(d) || (owner && DOORS.includes(d));
  const hidden = () => Soc.load().hidden || {};
  if (url === '/api/hollow/state' && req.method === 'GET') {
    const out = { doors: DOORS, open: OPEN, need: NEED, login: !!acct, cards: [], storage: Free.full() ? 'paused' : 'ok', offchain: true };
    if (acct) { out.cards = await cards(acct);
      if (owner) { out.owner = true; out.open = DOORS; out.cards = [...DOORS]; out.sea = { wishes: NEED.wishes, gave: NEED.gave, got: NEED.got, need: NEED, done: true }; return send(res, 200, out), true; } out.sea = await progress(acct, { ...C, user: a.user }); if (out.sea.done && !out.cards.includes('sea')) { await grant(acct, 'sea'); out.cards.push('sea'); out.seaNew = true; } }
    return send(res, 200, out), true; }
  if (url === '/api/hollow/claim' && req.method === 'POST') { if (!acct) return send(res, 401, { error: 'auth', code: 'hAuth' }), true;
    const b = await body(req, 1000), card = String(b.card || 'first'); if (owner && DOORS.includes(card)) return send(res, 200, { ok: true, cards: [...DOORS] }), true; if (card === 'first') { await grant(acct, 'first'); return send(res, 200, { ok: true, cards: await cards(acct) }), true; }
    if (card === 'sea') { const p = await progress(acct, { ...C, user: a.user }); if (!p.done) return send(res, 403, { error: 'locked', code: 'hLocked', sea: p }), true; await grant(acct, 'sea'); return send(res, 200, { ok: true, cards: await cards(acct) }), true; }
    return send(res, 400, { error: 'param', code: 'hSoon' }), true; }
  if (url.startsWith('/api/hollow/msgs') && req.method === 'GET') { const door = new URL(url, 'http://x').searchParams.get('door') || 'first'; if (!doorOk(door)) return send(res, 200, { items: [] }), true;
    const hid = hidden(); const items = (await listMsgs(door, 120)).filter(m => !hid['HM_' + m.id]).map(pubMsg); res.setHeader?.('cache-control', 'no-cache'); return send(res, 200, { items }), true; }
  if (url === '/api/hollow/msg' && req.method === 'POST') { const b = await body(req, 4000), text = clean(b.text), door = doorOk(b.door) ? b.door : 'first';
    if (!C.checkCid(b)) return send(res, 400, { error: 'captcha', code: 'freeCaptcha' }), true;
    if (!text || len(text) > MAXLEN || /[<>]/.test(text)) return send(res, 400, { error: 'len', code: 'len' }), true;
    const care = CARE.test(text);
    if (C.Block.check(text)) return send(res, 400, { error: 'blocked', code: 'blockPhish', care }), true;
    const m = await C.moderate(text); if (!m.pass) return send(res, 400, { error: 'reject', code: 'reject', care }), true;
    if (Free.full()) return send(res, 503, { error: 'rate', code: 'hFull' }), true;
    if (!owner) for (const k of ['ip:' + ipk, devk && 'dev:' + devk, acct && 'acct:' + acct].filter(Boolean)) if (await Free.take('hmsg:' + k, 1, 1)) return send(res, 429, { error: 'rate', code: 'hUsed', care }), true;
    const msg = { id: id12(), door, text, at: Date.now(), ip: ipk, dev: devk, acct, lights: 0, care }; await putMsg(msg);
    return send(res, 200, { ok: true, item: pubMsg(msg), care }), true; }
  if (url === '/api/hollow/light' && req.method === 'POST') { const b = await body(req, 1000), id = String(b.id || '').replace(/^HM_/, '');
    if (!/^[0-9a-f]{12}$/.test(id)) return send(res, 400, { error: 'param', code: 'param' }), true;
    if (hit('hl|' + ipk, 60, 3600000)) return send(res, 429, { error: 'rate', code: 'rate' }), true;
    const m = await getMsg(id); if (!m || hidden()['HM_' + id]) return send(res, 404, { error: 'nf', code: 'nf' }), true;
    if (m.ip === ipk || (devk && m.dev === devk) || (acct && m.acct === acct)) return send(res, 200, { ok: true, own: true, n: m.lights || 0 }), true;
    // 同一人（IP / 设备 / 账户任一相同）只能点亮一次
    const fresh = await addLight(id, ['i:' + ipk, devk && 'd:' + devk, acct && 'a:' + acct]);
    const n = (await getMsg(id))?.lights || 0;
    if (acct && m.acct) await lightEv(acct, m.acct, 'h:' + id, ipk, devk);
    return send(res, 200, { ok: true, dup: !fresh, n }), true; }
  return false; }
module.exports = { isOwner, OWNERS, handle, lightEv, getMsg, progress, people, CARE, DOORS, OPEN, NEED };
