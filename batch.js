// 团购礼品卡（批量心意卡）：一次支付 → 持久化任务队列 → 分片生成领取码（幂等 / 指数退避重试 / 断点续传）→ 领取并绑定门卡。
// 规则见 docs/gift-batch.md：心意金额是祝福心意，不是商品 / 投资，无收益、不可转让、不可退款；全额直达项目收款地址，本站不托管。
// 领取码设计（权衡）：领取码必须能随时导出给批次所有者（刷新 / 换设备 / 重试后 CSV 内容必须一致）。
//   所以不存明文，也不存“只存哈希”（哈希无法导出）；而是用服务端密钥确定性派生：code = Crockford-base32(HMAC-SHA256(secret, batchId:index))[0..20)（100 bit，不可枚举）。
//   库里只存 sha256(code) 作索引（领取时查找）和状态；分片重试 / 续传得到完全相同的码（天然幂等）。secret 取自 BATCH_SECRET，缺省则生成后存在 batches.json（随 persist.js 同步 D1，与托管账户密钥同级保护）。
//   代价：secret 泄露 = 所有未领取的码可被推算——所以 secret 绝不进 git / 日志 / 接口。
const fs = require('fs'), path = require('path'), crypto = require('crypto'), Gate = require('./gate');
const F = path.join(__dirname, 'data', 'batches.json'), LAM = 1e9, MIN_SOL = 0.0067, MAX_COUNT = 10000, ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const E = process.env, CFG = () => ({ minSol: MIN_SOL, maxCount: MAX_COUNT, shard: Math.max(1, +E.BATCH_SHARD || 500), maxTries: +E.BATCH_MAX_TRIES || 6, backoffBase: +E.BATCH_BACKOFF || 5, backoffCap: 900, lease: 120 });
let D = null; const hooks = { shard: null, now: null }; // hooks.shard：测试注入失败
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
function load() { if (D) return D; let j = {}; try { j = JSON.parse(fs.readFileSync(F, 'utf8')); } catch {}
  D = { meta: j.meta || {}, batches: j.batches || {}, codes: j.codes || {}, paid: j.paid || {}, alerts: j.alerts || [] };
  if (!D.meta.secret) { D.meta.secret = E.BATCH_SECRET || crypto.randomBytes(32).toString('hex'); flush(); } return D; }
let t = null; const save = (soon) => { clearTimeout(t); t = setTimeout(flush, soon ? 50 : 1000); t.unref?.(); };
function flush() { clearTimeout(t); if (!D) return; fs.mkdirSync(path.dirname(F), { recursive: true }); fs.writeFileSync(F, JSON.stringify(D), { mode: 0o600 }); }
const secret = () => E.BATCH_SECRET || load().meta.secret;
// ---- 领取码 ----
function b32(buf, n) { let bits = 0, v = 0, out = ''; for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5 && out.length < n) { out += ALPHA[(v >>> (bits - 5)) & 31]; bits -= 5; } v &= (1 << bits) - 1; } return out; }
const codeFor = (id, i) => { const r = b32(crypto.createHmac('sha256', secret()).update(id + ':' + i).digest(), 20); return r.match(/.{5}/g).join('-'); };
const normCode = c => String(c || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
const validCode = c => /^[0-9A-HJKMNP-TV-Z]{20}$/.test(c), idx = c => sha(normCode(c)).slice(0, 24);
// ---- 参数 ----
const clean = (s, n) => [...String(s || '').replace(/[\u0000-\u001f\u007f~|<>]/g, '').trim()].slice(0, n).join('');
function validate(p) { const c = CFG(), blessing = [...String(p.blessing || '').trim()].length, count = p.count, sol = +p.unitSol;
  if (!blessing || blessing > 140 || /[|]/.test(p.blessing)) return { error: 'blessing' }; if (!Number.isInteger(count) || count < 1 || count > c.maxCount) return { error: 'count' };
  const unitLam = Math.round(sol * LAM); if (!Number.isFinite(sol) || unitLam < Math.round(c.minSol * LAM) || sol > 1000) return { error: 'amount' };
  const gateName = clean(p.gateName, 20); if (!gateName) return { error: 'gate' }; const total = unitLam * count; if (!Number.isSafeInteger(total) || total > 1e6 * LAM) return { error: 'amount' };
  return { ok: { blessing: clean(String(p.blessing).trim(), 140).replace(/[~<>]/g, ''), count, unitLam, totalLam: total, gateName, optPublic: !!p.optPublic, optAnchor: !!p.optAnchor } }; }
// ---- 创建（支付已由调用方核验）：幂等 per 支付签名 ----
function create(owner, v, pay, now = Math.floor(Date.now() / 1000)) { const d = load(), key = pay.key; if (!key) return { error: 'sig' };
  if (d.paid[key]) { const b = d.batches[d.paid[key]]; return b && b.owner === owner ? { ok: true, dup: true, batch: b } : { error: 'used' }; } // 重放：同一支付只能建一个批次
  if (!(pay.lamports >= v.totalLam)) return { error: 'amount' }; const c = CFG(), id = 'b_' + crypto.randomBytes(8).toString('hex');
  const shards = []; for (let from = 0, i = 0; from < v.count; from += c.shard, i++) shards.push({ i, from, to: Math.min(v.count, from + c.shard), state: 'queued', tries: 0, nextAt: 0, err: '' });
  const b = d.batches[id] = { id, owner, ...v, payKey: key, payChain: pay.chain || 'sol', paidLam: pay.lamports, status: 'queued', createdAt: now, doneAt: 0, shards, anchor: null, publicMemoSig: pay.publicSig || '' };
  d.paid[key] = id; save(true); return { ok: true, batch: b }; }
const pubView = b => ({ id: b.id, status: b.status, count: b.count, gateName: b.gateName, blessing: b.blessing, unitSol: b.unitLam / LAM, totalSol: b.totalLam / LAM, optPublic: b.optPublic, optAnchor: b.optAnchor, createdAt: b.createdAt, doneAt: b.doneAt, payChain: b.payChain });
function view(b, now = Math.floor(Date.now() / 1000)) { const s = { total: b.shards.length, done: 0, failed: 0, pending: 0, running: 0 }; let issued = 0, nextRetryAt = 0;
  for (const x of b.shards) { if (x.state === 'done') { s.done++; issued += x.to - x.from; } else if (x.state === 'failed') s.failed++; else { s.pending++; if (x.state === 'running') s.running++; if (x.tries && x.nextAt > now && (!nextRetryAt || x.nextAt < nextRetryAt)) nextRetryAt = x.nextAt; } }
  const claimed = b.claimedN || 0;
  return { ...pubView(b), issued, claimed, shards: s, percent: Math.floor(issued / b.count * 100), nextRetryAt, anchor: b.anchor ? { sig: b.anchor.sig, root: b.anchor.root } : null, anchorMemo: b.optAnchor && b.status === 'done' ? anchorMemo(b) : null, paidSol: b.paidLam / LAM }; }
const list = owner => Object.values(load().batches).filter(b => b.owner === owner).sort((a, b) => b.createdAt - a.createdAt).map(b => view(b));
// ---- 队列 / 分片 ----
function alert(msg, extra = {}) { const d = load(); d.alerts.push({ at: Date.now(), msg: String(msg).slice(0, 200), ...extra }); if (d.alerts.length > 100) d.alerts.splice(0, d.alerts.length - 100); console.error('[batch-alert]', msg, JSON.stringify(extra)); save(true); } // 告警日志不含私钥 / 领取码
const backoff = tries => { const c = CFG(); return Math.min(c.backoffCap, c.backoffBase * 2 ** Math.max(0, tries - 1)); };
function processShard(b, sh, now) { sh.state = 'running'; sh.startedAt = now; const d = load();
  try { hooks.shard?.(b, sh); for (let i = sh.from; i < sh.to; i++) { const code = codeFor(b.id, i), h = idx(code); if (!d.codes[h]) d.codes[h] = { b: b.id, i, st: 'new' }; } // 幂等：已存在则跳过
    sh.state = 'done'; sh.err = ''; sh.doneAt = now; return true; }
  catch (e) { sh.tries++; sh.err = String(e.message || e).slice(0, 120); if (sh.tries >= CFG().maxTries) { sh.state = 'failed'; alert('shard failed permanently', { batch: b.id, shard: sh.i, tries: sh.tries, err: sh.err }); } else { sh.state = 'queued'; sh.nextAt = now + backoff(sh.tries); }
    return false; } }
// 每次 tick 处理至多 maxShards 个到期分片（协作式，避免长时间占用事件循环）；返回处理数
function tick(now = Math.floor(Date.now() / 1000), maxShards = 4) { const d = load(); let n = 0;
  for (const b of Object.values(d.batches)) { if (b.status === 'done') continue;
    for (const sh of b.shards) if (sh.state === 'running' && now - (sh.startedAt || 0) > CFG().lease) sh.state = 'queued'; // 进程中断后的断点续传：超时的 running 分片重新排队
    for (const sh of b.shards) { if (n >= maxShards) break; if (sh.state !== 'queued' || sh.nextAt > now) continue; b.status = 'running'; processShard(b, sh, now); n++; }
    if (b.shards.every(x => x.state === 'done')) { b.status = 'done'; b.doneAt = now; } else if (b.shards.every(x => x.state === 'done' || x.state === 'failed')) b.status = 'failed'; }
  if (n) save(); return n; }
const retryFailed = (id, now = Math.floor(Date.now() / 1000)) => { const b = load().batches[id]; if (!b) return null; let n = 0; for (const sh of b.shards) if (sh.state === 'failed') { sh.state = 'queued'; sh.tries = 0; sh.nextAt = 0; sh.err = ''; n++; } if (n) b.status = 'queued'; save(true); return n; };
let timer = null; const start = (ms = 1000) => { if (timer) return; tick(); timer = setInterval(() => { try { tick(); } catch (e) { alert('tick error', { err: String(e.message).slice(0, 100) }); } }, ms); timer.unref?.(); };
// ---- 导出 CSV（UTF-8 BOM；序号,领取码,领取链接,状态）----
const csvq = s => '"' + String(s).replace(/"/g, '""') + '"';
function csv(b, origin) { const d = load(), rows = ['序号,领取码,领取链接,状态']; for (const sh of b.shards) { if (sh.state !== 'done') continue; for (let i = sh.from; i < sh.to; i++) { const code = codeFor(b.id, i), c = d.codes[idx(code)];
    rows.push([i + 1, code, origin.replace(/\/$/, '') + '/#/claim/' + code, c && c.st === 'claimed' ? '已领取' : '未领取'].map(csvq).join(',')); } } return '\ufeff' + rows.join('\r\n') + '\r\n'; }
// ---- 领取 ----
const rl = new Map(); // 限速：key → [timestamps]
function limited(key, max, win, now = Date.now()) { const a = (rl.get(key) || []).filter(x => now - x < win); a.push(now); rl.set(key, a); if (rl.size > 20000) for (const [k, v] of rl) if (!v.length || now - v[v.length - 1] > win) rl.delete(k); return a.length > max; }
function peek(code) { const c = normCode(code); if (!validCode(c)) return { error: 'nf' }; const d = load(), r = d.codes[idx(c)]; if (!r) return { error: 'nf' }; const b = d.batches[r.b]; return { ok: true, blessing: b.blessing, gateName: b.gateName, state: r.st, count: b.count }; }
function claim(code, claimer, now = Math.floor(Date.now() / 1000)) { const c = normCode(code); if (!validCode(c) || !claimer) return { error: 'nf' }; const d = load(), r = d.codes[idx(c)]; if (!r) return { error: 'nf' }; const b = d.batches[r.b];
  const gd = Gate.load(), id = 'g_' + sha('bc:' + idx(c)).slice(0, 16);
  if (r.st === 'claimed') return r.by === claimer ? { ok: true, dup: true, card: gd.cards[id] || null, gateName: b.gateName, blessing: b.blessing } : { error: 'used' }; // 一码一领；本人重复提交幂等
  const card = Gate.issue(gd, { id, gateId: 'b_' + b.id, name: b.gateName, owner: claimer, issuer: b.owner, expireAt: 0, benefit: b.blessing, source: 'batch', claimedAt: now }, now); Gate.save(gd);
  r.st = 'claimed'; r.by = claimer; r.at = now; b.claimedN = (b.claimedN || 0) + 1; save(true); return { ok: true, card, gateName: b.gateName, blessing: b.blessing }; }
// ---- 门内记录上链（可选，用户自付 gas）：对全部领取码哈希做 Merkle 根，用户用自己的钱包写一条 memo ----
function merkle(b) { const d = load(); let lv = []; for (let i = 0; i < b.count; i++) lv.push(idx(codeFor(b.id, i))); lv = lv.map(h => sha(h)); while (lv.length > 1) { const nx = []; for (let i = 0; i < lv.length; i += 2) nx.push(sha(lv[i] + (lv[i + 1] || lv[i]))); lv = nx; } return lv[0]; }
const anchorMemo = b => `WTREE1|BG|${b.id}|${b.count}|${merkle(b).slice(0, 32)}`;
function setAnchor(id, sig, now = Math.floor(Date.now() / 1000)) { const b = load().batches[id]; if (!b) return { error: 'nf' }; if (b.anchor) return b.anchor.sig === sig ? { ok: true, dup: true, anchor: b.anchor } : { error: 'exists' }; b.anchor = { sig, root: merkle(b).slice(0, 32), at: now }; save(true); return { ok: true, anchor: b.anchor }; }
function summary() { const d = load(), bs = Object.values(d.batches), st = {}; for (const b of bs) st[b.status] = (st[b.status] || 0) + 1; return { batches: bs.length, byStatus: st, codes: Object.keys(d.codes).length, alerts: d.alerts.slice(-20),
  list: bs.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50).map(b => { const v = view(b); return { id: b.id, owner: b.owner, status: b.status, count: b.count, issued: v.issued, claimed: v.claimed, shards: v.shards, createdAt: b.createdAt, failed: b.shards.filter(x => x.state === 'failed').map(x => ({ i: x.i, tries: x.tries, err: x.err })) }; }) }; }
const reset = () => { D = null; rl.clear(); };
module.exports = { CFG, MIN_SOL, MAX_COUNT, hooks, load, flush, validate, create, view, pubView, list, tick, start, retryFailed, csv, peek, claim, limited, anchorMemo, setAnchor, summary, codeFor, normCode, idx, merkle, backoff, reset, sha };
