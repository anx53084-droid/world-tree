// 门卡（Gate Card）一期：不可转让的链上「线上访问凭证」。非资产、无实体卡、不承诺收益。
// 记录模型：链上最小字段 = cardId / owner / gateType(ruleId) / expireAt(秒，0=永久) / status(active|revoked) / issuer，memo 分类字段 ~Q（见 social.js parseKind）。
// 状态与撤销以服务端记录（persist.js → D1：data/gates.json）为权威，原因：撤销必须即时、可由发行方/管理员执行，且链上 memo 不可改写；
// 链上锚定（撤销后追加 memo）为可选钩子 anchor()，默认关闭（GATE_ANCHOR=1 时由后续阶段实现，需要签名与手续费）。
// 到期完全按时间戳判定，前后端一致。
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const F = path.join(__dirname, 'data', 'gates.json');
const DAY = 86400, COOL = 86400, CLAIM_DAYS = 30, PRE = [3 * DAY, DAY];
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/;
const addrKey = a => /^0x[0-9a-fA-F]{40}$/.test(a || '') ? a.toLowerCase() : String(a || '');
const clean = (s, n) => String(s || '').replace(/[~|<>]/g, '').trim().slice(0, n);
const sha16 = t => crypto.createHash('sha256').update(String(t), 'utf8').digest('hex').slice(0, 16);
// ---- 存储 ----
function load() { let d = {}; try { d = JSON.parse(fs.readFileSync(F)); } catch {}
  return { cards: d.cards || {}, claimable: d.claimable || {}, claims: d.claims || {}, rules: d.rules || {}, seeded: d.seeded || {}, posts: d.posts || {} }; }
function save(d) { fs.mkdirSync(path.dirname(F), { recursive: true }); fs.writeFileSync(F, JSON.stringify(d), { mode: 0o600 }); }
// ---- 规则 ----
const SEEDS = [ // 成就门卡（解锁「树洞」）：初心 / 成长默认启用；共鸣 / 月度 / 活动限定默认停用，可由管理员配置启用
  { id: 'first_light', name: '初心门卡', benefit: '在链上留下第 1 张心愿卡，解锁「树洞」', cond: { mode: 'all', wishes: 1 }, validity: { type: 'permanent' }, unlocks: ['treehole'], enabled: true },
  { id: 'growth', name: '成长门卡', benefit: '累计 5 张心愿卡，解锁「树洞」', cond: { mode: 'all', wishes: 5 }, validity: { type: 'permanent' }, unlocks: ['treehole'], enabled: true },
  { id: 'resonance', name: '共鸣门卡', benefit: '累计收到 10 条有效祝福，解锁「树洞」（180 天）', cond: { mode: 'all', blessings: 10 }, validity: { type: 'days', days: 180 }, unlocks: ['treehole'], enabled: false },
  { id: 'monthly', name: '月度门卡', benefit: '单月新增 3 张心愿卡，有效至月底后 30 天，解锁「树洞」', cond: { mode: 'all', monthWishes: 3 }, validity: { type: 'monthEnd', extraDays: 30 }, unlocks: ['treehole'], enabled: false },
  { id: 'event', name: '活动限定', benefit: '限定活动参与凭证（由运营指定条件）', cond: { mode: 'all', ageDays: 7 }, validity: { type: 'custom', until: 0 }, unlocks: [], enabled: false }];
function seed(d) { for (const s of SEEDS) if (!d.seeded[s.id] && !d.rules[s.id]) { d.rules[s.id] = { ...s, claim: 'manual', limit: 1, claimDays: CLAIM_DAYS, at: Date.now() }; d.seeded[s.id] = 1; } return d; }
function normRule(b) { // 校验管理员提交的规则
  const id = String(b.id || '').toLowerCase(); if (!ID_RE.test(id)) return { error: 'bad id', code: 'param' };
  const name = clean(b.name, 20); if (!name) return { error: 'name required', code: 'param' };
  const c = b.cond || b.conditions || {}, n = k => Math.max(0, Math.min(1e6, Math.floor(+c[k] || 0)));
  const cond = { mode: c.mode === 'any' ? 'any' : 'all', wishes: n('wishes'), blessings: n('blessings'), ageDays: n('ageDays'), monthWishes: n('monthWishes') };
  if (!(cond.wishes || cond.blessings || cond.ageDays || cond.monthWishes)) return { error: 'condition required', code: 'param' };
  const v = b.validity || {}, type = ['permanent', 'days', 'monthEnd', 'custom'].includes(v.type) ? v.type : 'permanent';
  const validity = { type, days: type === 'days' ? Math.max(1, Math.min(3650, Math.floor(+v.days || 30))) : undefined, until: type === 'custom' ? Math.floor(+v.until || 0) : undefined, extraDays: type === 'monthEnd' ? Math.max(0, Math.min(365, Math.floor(+v.extraDays || 0))) : undefined };
  const unlocks = (Array.isArray(b.unlocks) ? b.unlocks : []).filter(x => x === 'treehole');
  return { rule: { id, name, benefit: clean(b.benefit, 140), cond, validity, unlocks, enabled: !!b.enabled, claim: 'manual', limit: 1, claimDays: Math.max(1, Math.min(365, Math.floor(+b.claimDays || CLAIM_DAYS))), at: Date.now() } }; }
const monthStart = now => { const d = new Date(now * 1000); return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000); };
const monthEnd = now => { const d = new Date(now * 1000); return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000); }; // 次月 1 日 0 点（UTC）= 本月结束
function expireFor(rule, now) { const v = rule.validity || {}; if (v.type === 'days') return now + v.days * DAY; if (v.type === 'monthEnd') return monthEnd(now) + (v.extraDays || 0) * DAY; if (v.type === 'custom') return v.until > now ? v.until : 0; return 0; }
// stats = { wishes, blessings, ageDays, monthWishes }；返回 { ok, progress:[{key,have,need,met}] }
function evalRule(rule, st) { const c = rule.cond || {}, keys = ['wishes', 'blessings', 'ageDays', 'monthWishes'].filter(k => c[k] > 0);
  const progress = keys.map(k => ({ key: k, have: Math.floor(+st[k] || 0), need: c[k], met: (+st[k] || 0) >= c[k] }));
  return { ok: !!progress.length && (c.mode === 'any' ? progress.some(p => p.met) : progress.every(p => p.met)), progress }; }
// ---- 状态 / 校验 ----
function statusOf(card, now) { if (card.status === 'revoked') return 'revoked'; if (card.expireAt > 0 && now >= card.expireAt) return 'expired'; return 'valid'; }
const view = (c, now) => ({ ...c, state: statusOf(c, now) });
function cardsOf(d, addrs) { const set = new Set(addrs.filter(Boolean).map(addrKey)); return Object.values(d.cards).filter(c => set.has(addrKey(c.owner))); }
// 访问判定。返回 { ok, code, card? }；code ∈ OK | NO_GATE | EXPIRED | REVOKED | NOT_OWNER（NOT_LOGIN 由调用方在无会话时直接返回）
function unlockIds(d, feature) { return Object.values(d.rules).filter(r => (r.unlocks || []).includes(feature)).map(r => r.id); } // 解锁某功能（如 treehole）的门卡编号
function check(d, addrs, gateId, now, cardId) { const hit = c => Array.isArray(gateId) ? gateId.includes(c.gateId) : c.gateId === gateId;
  if (cardId) { const c = d.cards[cardId]; if (c && hit(c) && !new Set(addrs.map(addrKey)).has(addrKey(c.owner))) return { ok: false, code: 'NOT_OWNER' }; }
  const mine = cardsOf(d, addrs).filter(hit); if (!mine.length) return { ok: false, code: 'NO_GATE' };
  const v = mine.find(c => statusOf(c, now) === 'valid'); if (v) return { ok: true, code: 'OK', card: v };
  const last = mine.sort((a, b) => b.issuedAt - a.issuedAt)[0], s = statusOf(last, now);
  return { ok: false, code: s === 'revoked' ? 'REVOKED' : 'EXPIRED', card: last }; }
// ---- 发卡 / 领取 / 撤销 ----
const newId = () => 'g_' + crypto.randomBytes(8).toString('hex');
function issue(d, o, now) { const id = o.id || newId(); if (d.cards[id]) return d.cards[id];
  return d.cards[id] = { id, gateId: o.gateId, name: clean(o.name, 20), owner: o.owner, issuer: o.issuer, expireAt: Math.max(0, o.expireAt | 0), status: 'active', ruleId: o.ruleId || null, benefit: clean(o.benefit, 140), benefitHash: sha16(clean(o.benefit, 140)), issuedAt: now, claimedAt: o.claimedAt || 0, source: o.source || 'user', sig: o.sig || null, notice: {} }; }
// 扫描：满足条件且未领取 → 生成 claimable（链下）；返回新增列表（调用方负责站内信）
function scan(d, owner, st, now) { const k = addrKey(owner), created = []; const mine = d.claimable[k] ||= {}, done = d.claims[k] ||= {};
  for (const [rid, c] of Object.entries(mine)) if (c.expiresAt <= now || !d.rules[rid]?.enabled) delete mine[rid]; // 资格过期 / 规则停用
  for (const r of Object.values(d.rules)) { if (!r.enabled || done[r.id] || mine[r.id]) continue; if (!evalRule(r, st).ok) continue;
    mine[r.id] = { ruleId: r.id, at: now, expiresAt: now + (r.claimDays || CLAIM_DAYS) * DAY }; created.push(r); }
  if (!Object.keys(mine).length) delete d.claimable[k]; return created; }
function claim(d, owner, ruleId, st, now) { const k = addrKey(owner), r = d.rules[ruleId], c = d.claimable[k]?.[ruleId], done = d.claims[k] ||= {};
  if (!r || !r.enabled) return { error: 'rule disabled', code: 'RULE_OFF' };
  if (done[ruleId]) return { error: 'already claimed', code: 'CLAIMED' };
  if (!c) return { error: 'not claimable', code: 'NOT_CLAIMABLE' }; if (c.expiresAt <= now) { delete d.claimable[k][ruleId]; return { error: 'claim window expired', code: 'CLAIM_EXPIRED' }; }
  if (done._last && now - done._last < COOL) return { error: 'cooldown', code: 'COOLDOWN', retryAt: done._last + COOL };
  const ev = evalRule(r, st); if (!ev.ok) { delete d.claimable[k][ruleId]; return { error: 'conditions no longer met', code: 'NOT_MET', progress: ev.progress }; } // 领取前复核
  const card = issue(d, { gateId: r.id, name: r.name, owner, issuer: 'system', expireAt: expireFor(r, now), ruleId: r.id, benefit: r.benefit, claimedAt: now, source: 'rule' }, now);
  delete d.claimable[k][ruleId]; if (!Object.keys(d.claimable[k]).length) delete d.claimable[k]; done[ruleId] = now; done._last = now; return { card }; }
function revoke(d, id, by, reason, now) { const c = d.cards[id]; if (!c) return { error: 'not found', code: 'nf' }; if (c.status === 'revoked') return { error: 'already revoked', code: 'param' };
  if (by !== 'admin' && addrKey(by) !== addrKey(c.issuer)) return { error: 'forbidden', code: 'forbidden' };
  c.status = 'revoked'; c.revokedAt = now; c.reason = clean(reason, 80); return { card: c }; }
// 到期提醒：到期前 3 天 / 当天（24h 内）/ 已到期；每个节点每卡只发一次。返回 [{card, kind}]
function sweep(d, now) { const out = [];
  for (const c of Object.values(d.cards)) { if (c.status === 'revoked' || !(c.expireAt > 0)) continue; const n = c.notice ||= {}, left = c.expireAt - now;
    if (left <= 0) { if (!n.exp) { n.exp = now; out.push({ card: c, kind: 'gate_expired' }); } }
    else if (left <= PRE[1]) { if (!n.d0) { n.d0 = now; n.d3 = n.d3 || now; out.push({ card: c, kind: 'gate_expiring0' }); } }
    else if (left <= PRE[0]) { if (!n.d3) { n.d3 = now; out.push({ card: c, kind: 'gate_expiring' }); } } }
  return out; }
module.exports = { load, save, seed, SEEDS, ID_RE, DAY, COOL, CLAIM_DAYS, addrKey, clean, sha16, normRule, evalRule, expireFor, unlockIds, monthStart, monthEnd, statusOf, view, cardsOf, check, issue, scan, claim, revoke, sweep };
