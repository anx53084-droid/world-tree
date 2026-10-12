// 世界树许愿树 前端（SPA，hash 路由）。链上为唯一事实来源；本文件只读链 + 发起签名。
const W3 = window.solanaWeb3;
const TREE = 'pqaQKFsNjfJKewkwEyJaNYzoKxu3sh1hmNvAGKfz5Yb', MEMO = 'MemoSq4gqABAXKb96qnH8TuDybDJ9cKfTLqKE7Rbr8z', TAG = 'WTREE1|';
const RPC_READ = '/api/rpc'; // 读层：同源中继 → devnet RPC。换索引器（Helius/自建 Geyser）时只需改 loadWishes()
const RPC_WRITE = 'https://api.devnet.solana.com';
const EXPLORER = s => `https://explorer.solana.com/tx/${s}?cluster=devnet`;
const CATS = { 经典: 45, 风景: 200, 人物: 330, 动物: 155, 卡通: 28 }; // 分类 → 色相
const REJECT = '您的内容未通过审核（可能涉及违规或不符合正向要求），请修改后重新提交。';
const NOTICE = '内容规范：所有定制卡片（包括图片与文字）不得违反任何法律法规，且须为正向、积极内容。提交后将进行审核，未通过将无法完成购买与上链。';
const AGREE = '我已阅读并同意《内容规范》，承诺所提交内容合法合规、正向积极。';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
const fmtT = t => t ? new Date(t * 1000).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }) : '待确认';
const sol = l => (l / 1e9).toFixed(4) + ' SOL';
const hex2b = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
const sha256hex = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, '0')).join('');

const QS = new URLSearchParams(location.search);
const S = { stress: QS.has('stress') ? QS.get('stress') !== '0' : localStorage.wt_stress === '1', total: Math.min(2.75e11, Math.floor(+QS.get('stress') || +localStorage.wt_total || 1e11)), mode: 'guest', pubkey: null, email: null, token: localStorage.wt_token || null, txs: [], wishes: [], hidden: 0, offline: false, pending: [],
  history: JSON.parse(localStorage.wt_hist || '[]'), cfg: { minLamports: 6666667, solUsd: 150, priceSource: 'fallback', developer: '', treasury: '', moderator: window.WT_CONFIG?.moderatorPubkeyHex }, words: null, season: null };
const saveHist = () => localStorage.wt_hist = JSON.stringify(S.history.slice(0, 100));

// ---------- 星空背景：CSS Paint Worklet，回退 canvas（同算法：上限 180、密度≤2.5、按尺寸播种、count≤0 直接返回） ----------
(function sky() {
  if (window.CSS && CSS.paintWorklet) { CSS.paintWorklet.addModule('starfield-worklet.js'); document.documentElement.classList.add('paint'); return; }
  const c = $('#sky-fallback'), x = c.getContext('2d');
  const draw = () => { c.width = innerWidth; c.height = innerHeight; x.clearRect(0, 0, c.width, c.height); const n = Math.min(180, Math.floor(c.width * c.height / 12000 * Math.min(2.5, 1.6))); if (n <= 0) return;
    let s = (c.width * 73856093 ^ c.height * 19349663) >>> 0 || 1; const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < n; i++) { const X = r() * c.width, Y = r() * c.height, R = r() * 1.4 + .3; x.fillStyle = `rgba(255,255,230,${0.3 + r() * 0.7})`; x.beginPath(); x.arc(X, Y, R, 0, 7); x.fill(); } };
  draw(); addEventListener('resize', draw);
})();

// ---------- 读层：RPC + 本地缓存（交易不可变 → 按签名永久缓存） ----------
let rid = 0;
async function rpcAt(url, method, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
  if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { net: true });
  const j = await r.json().catch(() => { throw Object.assign(new Error('bad json'), { net: true }); });
  if (j.error) throw Object.assign(new Error(j.error.message), { net: j.error.code === -1 }); return j.result;
}
let relayDown = false; // 中继不可达时回退：浏览器直连 devnet
async function rpc(method, params) {
  if (!relayDown) { try { return await rpcAt(RPC_READ, method, params); } catch (e) { if (!e.net && !(e instanceof TypeError)) throw e; relayDown = true; } }
  return rpcAt(RPC_WRITE, method, params);
}
let txCache = {}; try { txCache = JSON.parse(localStorage.wt_txcache || '{}'); } catch {}
async function verifyAtt(memo) { // 校验审核证明：sha256(内容) == hash 且 审核服务 ed25519 签名有效；缺失/无效一律拒绝
  const m = memo.match(/^WTREE1\|[WB]\|([0-9a-f]{64})\|(\d{10})\|([0-9a-f]{128})\|([^|]{1,90}\|[^|]{1,140})$/u);
  if (!m || !S.cfg.moderator || !window.nacl) return false;
  if (await sha256hex(m[4]) !== m[1]) return false;
  return nacl.sign.detached.verify(new TextEncoder().encode(`WTREE-ATT1|${m[1]}|pass|${m[2]}`), hex2b(m[3]), hex2b(S.cfg.moderator));
}
async function parseTx(sig, tx) {
  if (!tx || tx.meta?.err) return null;
  const ins = tx.transaction.message.instructions, ix = ins.find(i => i.programId === MEMO || i.program === 'spl-memo');
  const memo = typeof ix?.parsed === 'string' ? ix.parsed : null; if (!memo || !memo.startsWith(TAG)) return null;
  const k0 = tx.transaction.message.accountKeys[0], author = k0.pubkey || k0;
  let paid = 0, devPaid = 0; for (const i of ins) if (i.program === 'system' && i.parsed?.type === 'transfer') { const d = i.parsed.info.destination;
    if (d === S.cfg.treasury) paid += i.parsed.info.lamports; if (d === S.cfg.developer) { paid += i.parsed.info.lamports; devPaid += i.parsed.info.lamports; } }
  return { sig, author, memo, time: tx.blockTime, paid, devPaid, verified: memo.startsWith(TAG + 'L|') || await verifyAtt(memo) };
}
async function loadWishes(force) {
  if (!force && S.loadedAt && Date.now() - S.loadedAt < 30000) return;
  try {
    const sigs = await rpc('getSignaturesForAddress', [TREE, { limit: 500 }]);
    const need = sigs.filter(s => !(s.signature in txCache) && !s.err).map(s => s.signature);
    for (let i = 0; i < need.length; i += 10) {
      const res = await Promise.all(need.slice(i, i + 10).map(s => rpc('getTransaction', [s, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]).catch(() => undefined)));
      for (let k = 0; k < res.length; k++) if (res[k] !== undefined) txCache[need[i + k]] = await parseTx(need[i + k], res[k]);
    }
    try { localStorage.wt_txcache = JSON.stringify(txCache); } catch {}
    S.txs = sigs.map(s => txCache[s.signature]).filter(Boolean); S.offline = false;
  } catch (e) { S.offline = true; S.offlineMsg = e.message; S.txs = SAMPLE; }
  S.loadedAt = Date.now(); aggregate();
}
const clientBlocked = t => S.words && Object.values(S.words).flat().some(w => t.toLowerCase().includes(w.toLowerCase())); // 前端二次过滤：链上无法删除，但前端不展示
function aggregate() {
  const all = [...S.txs, ...S.pending.filter(p => !S.txs.some(t => t.sig === p.sig))].sort((a, b) => (a.time || 9e9) - (b.time || 9e9));
  const W = {}, likes = [], bless = []; let hidden = 0;
  for (const t of all) { const f = t.memo.split('|');
    if (f[1] === 'W') { if (!t.verified || clientBlocked(f[6])) { hidden++; continue; }
      const cat = CATS[f[5]] !== undefined ? f[5] : '经典'; W[t.sig] = { ...t, cat, hue: CATS[cat], text: f[6], likers: new Set(), blessings: [] }; }
    else if (f[1] === 'L') likes.push([f[2], t]); else if (f[1] === 'B' && t.verified && !clientBlocked(f[6])) bless.push([f[5], t, f[6]]); }
  for (const [ws, t] of likes) W[ws]?.likers.add(t.author); // 每地址对每愿望只计 1 赞
  for (const [ws, t, text] of bless) W[ws]?.blessings.push({ author: t.author, text, time: t.time, sig: t.sig, pending: t.pending });
  S.hidden = hidden;
  S.wishes = Object.values(W).map(w => Object.assign(w, { likes: w.likers.size, heat: w.likers.size * 2 + w.blessings.length * 3 })).sort((a, b) => (b.time || 9e9) - (a.time || 9e9));
}
const SAMPLE = (() => { // 仅当 RPC 不可达时展示的离线示例（非链上数据）
  const ws = [['经典', '愿家人平安喜乐'], ['风景', '希望明年能去冰岛看极光'], ['人物', '考研上岸，不负自己！'], ['动物', '愿流浪猫猫都有温暖的家'], ['卡通', '代码一次就跑通'], ['经典', '早日找到喜欢的工作'],
    ['风景', '和你一起看遍山川湖海'], ['人物', '妈妈生日快乐，永远年轻'], ['卡通', '愿星愿成真'], ['动物', '小狗健康长寿'], ['经典', '愿世界和平'], ['风景', '去看一次富士山的日出']];
  const out = ws.map(([c, t], i) => ({ sig: 'SAMPLE' + i, author: 'Demo' + String(i).repeat(40).slice(0, 40), time: 1791000000 + i * 3600, paid: 6666667, memo: `WTREE1|W|x|x|x|${c}|${t}`, verified: true, sample: true }));
  [0, 0, 0, 8, 8, 2, 3, 3, 3, 3].forEach((w, i) => out.push({ sig: 'SL' + i, author: 'DemoLiker' + i, time: 1791100000, memo: 'WTREE1|L|SAMPLE' + w, verified: true }));
  out.push({ sig: 'SB0', author: 'DemoBless1', time: 1791200000, memo: 'WTREE1|B|x|x|x|SAMPLE0|一定会的，祝福你们！', verified: true });
  return out; })();

// ---------- 写层：两种模式（同一份链上数据格式） ----------
function memoTx(payer, memo, lamports) {
  const p = new W3.PublicKey(payer), tx = new W3.Transaction();
  if (lamports > 0) { const dev = Math.floor(lamports * 0.2); // 资金直接从用户钱包转出：20% 开发者 / 80% 项目金库，平台不经手
    tx.add(W3.SystemProgram.transfer({ fromPubkey: p, toPubkey: new W3.PublicKey(S.cfg.developer), lamports: dev }), W3.SystemProgram.transfer({ fromPubkey: p, toPubkey: new W3.PublicKey(S.cfg.treasury), lamports: lamports - dev })); }
  tx.add(W3.SystemProgram.transfer({ fromPubkey: p, toPubkey: new W3.PublicKey(TREE), lamports: 0 })); // 0 lamport：让交易可按 TREE 地址索引
  tx.add(new W3.TransactionInstruction({ programId: new W3.PublicKey(MEMO), keys: [{ pubkey: p, isSigner: true, isWritable: false }], data: new TextEncoder().encode(memo) }));
  return tx;
}
async function moderateThenMemo(kind, prefix, text) { // 先审核（上链/付款之前），得到审核证明
  const r = await fetch('/api/moderate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, prefix }) }).then(r => r.json());
  if (!r.pass) { const msg = r.category ? `${REJECT}<br><span class=reject>命中类别：${esc(r.category)}</span>` : esc(r.message || REJECT); throw Object.assign(new Error(msg), { html: true }); }
  const a = r.attestation; return `WTREE1|${kind}|${a.hash}|${a.ts}|${a.sig}|${prefix}|${text}`;
}
async function submit(memo, label, lamports = 0) {
  if (S.mode === 'guest') { toast('请先登录（Phantom 或演示邮箱）', 'err'); return; }
  const t = toast(`${label}：等待签名…`);
  try {
    let sig;
    if (S.mode === 'self') { // 自托管：Phantom 签名并发送，私钥永不离开钱包
      const conn = new W3.Connection(RPC_WRITE, 'confirmed'), tx = memoTx(S.pubkey, memo, lamports);
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash(); tx.recentBlockhash = blockhash; tx.feePayer = new W3.PublicKey(S.pubkey);
      ({ signature: sig } = await window.phantom.solana.signAndSendTransaction(tx));
      addPending(sig, memo, lamports); t.update(`${label}：已提交，确认中… <a target=_blank href="${EXPLORER(sig)}">${short(sig)}</a>`);
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    } else { t.update(`${label}：演示服务器代签并上链中…`); sig = (await api('/api/memo', { memo, lamports })).signature; addPending(sig, memo, lamports); }
    t.update(`✅ ${label}已确认 <a target=_blank href="${EXPLORER(sig)}">查看交易</a>`, 'ok');
    S.history.unshift({ sig, memo, label, lamports, mode: S.mode, who: S.pubkey, at: Date.now(), status: '已确认' }); saveHist();
    S.pending = S.pending.map(p => p.sig === sig ? { ...p, pending: false } : p); await loadWishes(true); route(); return sig;
  } catch (e) { t.update(`❌ ${label}失败：${e.html ? e.message : esc(e.message || e)}`, 'err'); S.history.unshift({ memo, label, mode: S.mode, who: S.pubkey, at: Date.now(), status: '失败' }); saveHist(); }
}
function addPending(sig, memo, paid) { S.pending.push({ sig, memo, author: S.pubkey, time: null, paid, pending: true, verified: true }); aggregate(); route(); }
async function api(url, data) {
  const r = await fetch(url, { method: data ? 'POST' : 'GET', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (S.token || '') }, body: data ? JSON.stringify(data) : undefined });
  const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.status); return j;
}

// ---------- 登录 ----------
async function connectPhantom() {
  const p = window.phantom?.solana; if (!p?.isPhantom) { window.open('https://phantom.app/', '_blank'); return toast('未检测到 Phantom 钱包', 'err'); }
  const r = await p.connect(); S.mode = 'self'; S.pubkey = r.publicKey.toString(); S.email = null; renderMode(); route();
}
function emailLogin() {
  modal(`<h3>邮箱登录（演示托管模式）</h3><p class="notice">⚠️ 仅限 devnet 演示：服务器为你生成并保存 devnet 密钥并代签交易。请勿用于真实资产。</p>
    <input id=em type=email placeholder="you@example.com" style="width:100%"><div class=row style="margin-top:12px"><button class=primary id=emok>登录</button><button data-close>取消</button></div>`);
  $('#emok').onclick = async () => { try { const r = await api('/api/login', { email: $('#em').value.trim() }); S.token = localStorage.wt_token = r.token; S.mode = 'host'; S.email = r.email; S.pubkey = r.pubkey; closeModal(); renderMode(); route(); toast('已登录演示账户 ' + short(r.pubkey), 'ok'); }
    catch (e) { toast('登录失败：' + esc(e.message), 'err'); } };
}
async function logout() { if (S.mode === 'host') await api('/api/logout', {}).catch(() => {}); if (S.mode === 'self') window.phantom?.solana?.disconnect?.(); S.mode = 'guest'; S.pubkey = S.email = S.token = null; localStorage.removeItem('wt_token'); renderMode(); route(); }
async function airdrop() { const t = toast('请求 devnet 空投…'); try { const r = await api('/api/airdrop', {}); t.update('空投已提交 ' + short(r.signature), 'ok'); } catch (e) { t.update(esc(e.message), 'err'); } }
function renderMode() {
  const m = { guest: '<span class="badge">👀 访客·只读</span>', self: `<span class="badge b-self">🔐 自托管 Phantom · ${short(S.pubkey)}</span>`, host: `<span class="badge b-host">⚠️ 托管演示 · ${esc(S.email)} · ${short(S.pubkey)}</span>` }[S.mode];
  $('#mode').innerHTML = m + (S.mode === 'guest' ? '<button id=bp class="primary breathe">连接 Phantom</button><button id=be>邮箱登录(演示)</button>' : (S.mode === 'host' ? '<button id=ba>领 devnet SOL</button>' : '') + '<button id=bo>退出</button>');
  $('#bp')?.addEventListener('click', connectPhantom); $('#be')?.addEventListener('click', emailLogin); $('#bo')?.addEventListener('click', logout); $('#ba')?.addEventListener('click', airdrop);
}

// ---------- UI 工具 ----------
function toast(html, cls = '') { const d = document.createElement('div'); d.className = 'toast ' + cls; d.innerHTML = html; $('#toasts').append(d);
  const kill = () => setTimeout(() => d.remove(), 9000); if (cls) kill(); d.update = (h, c = '') => { d.innerHTML = h; d.className = 'toast ' + c; if (c) kill(); }; return d; }
function modal(html, cat) { $('#modal-box').innerHTML = html; $('#modal-box').dataset.cat = cat || ''; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });
// 世界树光谱：由交易签名哈希确定性生成的唯一 SVG（灵魂绑定记录：绑定作者地址的链上交易，非代币、不可转让）
function spectrum(sig, size = 96) {
  let h = 2166136261; for (const c of sig) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const r = () => (h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296, hues = Array.from({ length: 6 }, () => Math.floor(r() * 360)), id = 'g' + sig.slice(0, 8).replace(/\W/g, '');
  const rings = hues.map((hu, i) => `<circle cx="50" cy="50" r="${46 - i * 7}" fill="none" stroke="hsl(${hu},90%,${60 + i * 4}%)" stroke-width="${2 + r() * 4}" stroke-dasharray="${1 + r() * 20} ${r() * 8}" opacity=".9"/>`).join('');
  return `<svg class=spectrum width=${size} height=${size} viewBox="0 0 100 100"><defs><radialGradient id="${id}"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="hsl(${hues[0]},100%,70%)"/><stop offset="1" stop-color="hsl(${hues[5]},80%,10%)"/></radialGradient></defs><circle cx=50 cy=50 r=50 fill="url(#${id})"/>${rings}</svg>`;
}
const likeBtn = w => `<button data-like="${esc(w.sig)}" ${w.pending || w.sample ? 'disabled' : ''}>${S.pubkey && w.likers.has(S.pubkey) ? '💖 已赞' : '🤍 点赞'} ${w.likes}</button>`;
const wishCard = w => `<div class="card hover" data-cat="${w.cat}"><div>${w.pending ? '⏳ ' : ''}${esc(w.text)}</div><div class="row muted" style="margin-top:6px">
  <span class=tag>${w.cat}</span><span>作者 ${short(w.author)}</span><span>${fmtT(w.time)}</span><span>🔥 ${w.heat}</span>${likeBtn(w)}<a class=btn href="#/w/${encodeURIComponent(w.sig)}">详情 / 祝福</a></div></div>`;
document.addEventListener('click', e => { const s = e.target.closest('[data-like]')?.dataset.like; if (!s) return;
  const w = S.wishes.find(x => x.sig === s); if (S.pubkey && w?.likers.has(S.pubkey)) return toast('你已经点过赞了'); submit(TAG + 'L|' + s, '点赞'); });
window.WT_hover = (w, e) => { const tip = $('#tip'); if (!w) { tip.hidden = true; return; } tip.hidden = false; tip.dataset.cat = w.cat;
  tip.innerHTML = `<span class=tag>${w.cat}</span> ${esc(w.text)}<div class=muted>${short(w.author)} · 💖 ${w.likes} · 🙏 ${w.blessings.length}${w.pending ? ' · ⏳待确认' : ''}</div>`;
  tip.style.left = Math.min(e.clientX + 14, innerWidth - 290) + 'px'; tip.style.top = e.clientY + 14 + 'px'; };
function openCardPopup(w) { modal(`<div class=row>${spectrum(w.sig, 72)}<div><span class=tag>${w.cat}</span><p style="font-size:18px;margin:.4em 0">${esc(w.text)}</p>
  <div class=muted>作者 ${short(w.author)} · 💖 ${w.likes} · 🙏 ${w.blessings.length}</div></div></div>
  <div class=row style="margin-top:14px">${likeBtn(w)}<a class="btn primary" href="#/w/${encodeURIComponent(w.sig)}" data-close>查看详情</a><button data-close>关闭</button></div>`, w.cat); }

// ---------- 月度树态（Asia/Shanghai 日期自动选择） ----------
function autoSeason() { const d = +new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', day: 'numeric' }).format(new Date()); return d <= 10 ? 'green' : d <= 20 ? 'bloom' : 'fall'; }
const SEASON_NAMES = { green: '上旬·生机蓬勃', bloom: '中旬·樱花盛开', fall: '下旬·樱花飘落' };
const STAGES = ['幼苗', '小树', '繁茂', '参天', '世界之树'];
const stageOf = n => n < 10 ? 0 : n < 50 ? 1 : n < 200 ? 2 : n < 1000 ? 3 : 4;

// ---------- 页面 ----------
function home() {
  const hot = [...S.wishes].sort((a, b) => b.heat - a.heat).slice(0, 5), cur = S.season || autoSeason();
  return `<div class=scene id=scene><div class=scene-ui>${Object.entries(SEASON_NAMES).map(([k, v]) => `<button data-season=${k} class="${k === cur ? 'on' : ''}">${v}${k === autoSeason() ? '（本期）' : ''}</button>`).join('')}</div></div>
  <div class=home-spacer></div>
  <div class="home-dock"><form class="row scene-tools" id=sf><label class=agree><input type=checkbox id=stress ${S.stress ? 'checked' : ''}> ⚡压力模式</label><input id=stotal type=number min=1 max=275000000000 step=1 value="${S.total}" title="压力模式卡片总数" style="width:150px">
  <input id=sid placeholder="按卡片编号跳转，如 99999999999" style="flex:1;min-width:160px"><button>🔍 定位</button></form>
  <p class=muted style="text-align:center;margin:4px 0"><span class=stage>🌱 成长阶段：${STAGES[stageOf(S.stress ? S.total : S.wishes.length)]}</span> · 共 ${S.stress ? Number(S.total).toLocaleString('zh-CN') + ' 张（压力模式：' + S.wishes.length + ' 张真实愿望 + 模拟索引器合成）' : S.wishes.length + ' 张愿望卡'}${S.hidden ? ` · ${S.hidden} 条因缺少有效审核证明或违规未展示` : ''}</p>
  <div class=scene-hint>单指/左键旋转 · 双指捏合/滚轮朝指针缩放（靠近光团自动进入下一级区域，拉远返回）· 双指/右键平移 · 轻点光团进入 · 轻点灯笼查看 · <a href="#lists" onclick="document.getElementById('lists').scrollIntoView({behavior:'smooth'});return false">⌄ 愿望榜</a></div></div>
  <div class="cols home-lists" id=lists><div class=glass><h2>🔥 最热</h2>${hot.map(wishCard).join('') || '<p class=muted>暂无</p>'}</div><div class=glass><h2>🆕 最新</h2>${S.wishes.slice(0, 5).map(wishCard).join('') || '<p class=muted>暂无</p>'}</div></div>`;
}
function list(q) {
  const kw = q.get('q') || '', sort = q.get('sort') || 'new', cat = q.get('cat') || '', days = +q.get('days') || 0, minHeat = +q.get('heat') || 0, now = Date.now() / 1000;
  let ws = S.wishes.filter(w => (!kw || w.text.includes(kw) || w.author.startsWith(kw)) && (!cat || w.cat === cat) && (!days || (w.time || now) > now - days * 86400) && w.heat >= minHeat);
  if (sort === 'hot') ws = [...ws].sort((a, b) => b.heat - a.heat); if (sort === 'old') ws = [...ws].reverse();
  const opt = (arr, v) => arr.map(([k, l]) => `<option value="${k}" ${String(k) === String(v) ? 'selected' : ''}>${l}</option>`).join('');
  return `<h2>愿望列表</h2><form class=row id=lf><input name=q placeholder="关键词 / 作者地址" value="${esc(kw)}">
  <select name=cat>${opt([['', '全部分类'], ...Object.keys(CATS).map(c => [c, c])], cat)}</select>
  <select name=days>${opt([[0, '全部时间'], [1, '24 小时'], [7, '7 天'], [30, '30 天']], days)}</select>
  <select name=heat>${opt([[0, '热度不限'], [2, '热度≥2'], [10, '热度≥10']], minHeat)}</select>
  <select name=sort>${opt([['new', '最新'], ['hot', '最热'], ['old', '最早']], sort)}</select><button>筛选</button><button type=button id=rf>刷新链上数据</button></form>
  <p class=muted>${ws.length} 条</p>${ws.map(wishCard).join('')}`;
}
function detail(sig) {
  const w = S.wishes.find(x => x.sig === sig) || (/^SYN\d+$/.test(sig) && window.WT3D?.cardById(sig.slice(3))); if (!w) return '<p>未找到该愿望（可能尚未被读取、未通过校验或不存在）</p>';
  return `<h2>愿望详情</h2><div class=card data-cat="${w.cat}"><div class=row>${spectrum(w.sig, 120)}<div style="flex:1"><span class=tag>${w.cat}</span><p style="font-size:22px">${esc(w.text)}</p></div></div>
  <p>作者：<code>${esc(w.author)}</code></p><p>时间：${fmtT(w.time)} ${w.pending ? '（⏳ 待确认）' : ''} · 支付：${sol(w.paid || 0)} · 🔥 热度 ${w.heat}</p>
  <p class=muted>🌈 世界树光谱：由交易哈希生成的唯一光谱，作为灵魂绑定记录与作者地址永久关联（非代币，不可转让）。</p>
  <div class=row>${likeBtn(w)}<button id=share>分享卡片</button></div>
  <p>点赞地址：${[...w.likers].map(short).join('、') || '暂无'}</p>
  <p>${w.sample ? '离线示例数据，无链上交易' : `链上交易：<a target=_blank href="${EXPLORER(w.sig)}">${esc(short(w.sig))} ↗</a>`}</p></div>
  <h3>🙏 祝福（${w.blessings.length}）</h3>${w.blessings.map(b => `<div class=card>${b.pending ? '⏳ ' : ''}${esc(b.text)}<div class=muted>${short(b.author)} · ${fmtT(b.time)}</div></div>`).join('') || '<p class=muted>还没有祝福</p>'}
  ${S.mode === 'guest' ? '<p class=muted>登录后可送上祝福（自动审核，仅需网络费）</p>' : `<div class=card><textarea id=bt maxlength=140 placeholder="送上你的祝福（自动审核后上链）"></textarea><button id=bs data-sig="${esc(w.sig)}" ${w.sample ? 'disabled' : ''}>送祝福</button></div>`}`;
}
function sharePng(w) { // 生成分享图（本地 canvas → PNG）+ 链接
  const c = document.createElement('canvas'); c.width = 720; c.height = 960; const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 960);
  g.addColorStop(0, '#0a0f2a'); g.addColorStop(1, `hsl(${w.hue},60%,25%)`); x.fillStyle = g; x.fillRect(0, 0, 720, 960);
  for (let i = 0; i < 120; i++) { x.fillStyle = `rgba(255,255,230,${Math.random()})`; x.fillRect(Math.random() * 720, Math.random() * 960, 2, 2); }
  x.fillStyle = `hsl(${w.hue},90%,75%)`; x.font = 'bold 40px "Noto Sans CJK SC",sans-serif'; x.fillText('🌳 世界树许愿树 · ' + w.cat, 50, 100);
  x.fillStyle = '#fff'; x.font = '44px "Noto Sans CJK SC",sans-serif'; let line = '', y = 260;
  for (const ch of w.text) { if (x.measureText(line + ch).width > 620) { x.fillText(line, 50, y); y += 64; line = ''; } line += ch; } x.fillText(line, 50, y);
  x.font = '26px sans-serif'; x.fillStyle = '#bbc'; x.fillText(`作者 ${short(w.author)} · 💖 ${w.likes} · 🙏 ${w.blessings.length}`, 50, 860); x.fillText(location.origin + '/#/w/' + short(w.sig), 50, 905);
  const url = location.origin + '/#/w/' + encodeURIComponent(w.sig);
  modal(`<h3>分享卡片</h3><img src="${c.toDataURL('image/png')}" style="width:100%;border-radius:12px"><div class=row style="margin-top:10px">
    <a class="btn primary" download="world-tree-${w.sig.slice(0, 8)}.png" href="${c.toDataURL('image/png')}">下载图片</a><button id=cp>复制链接</button><button data-close>关闭</button></div>`, w.cat);
  $('#cp').onclick = () => navigator.clipboard?.writeText(url).then(() => toast('链接已复制', 'ok'), () => toast(url));
}
function wishPanel() {
  if (S.mode === 'guest') return `<h2>许愿 · 定制愿望卡</h2><div class="card notice">访客为只读模式。请在右上角 <b>连接 Phantom</b>（推荐，自托管）或 <b>邮箱登录（演示托管）</b> 后许愿。</div>`;
  const min = S.cfg.minLamports, agreedTerms = localStorage.wt_terms === '1';
  return `<h2>许愿 · 定制愿望卡</h2><div class=card>
  <p class=muted>当前模式：${S.mode === 'self' ? '🔐 自托管 —— 由你的 Phantom 钱包签名，资金从你的钱包直接转给收款地址' : '⚠️ 托管演示 —— 演示服务器用你的 devnet 密钥代签（需先领 devnet SOL）'}</p>
  <div class=row><label>分类 <select id=wc2>${Object.keys(CATS).map(c => `<option>${c}</option>`).join('')}</select></label></div>
  <textarea id=wt maxlength=140 placeholder="写下你的愿望（最多 140 字，公开永久上链，请勿填写隐私信息）"></textarea><div class=muted id=wc>0/140</div>
  <div class=row style="margin:8px 0"><label>金额（SOL，自由填写，最低 1 美元等值）<input id=amt type=number step=0.0001 min="${min / 1e9}" value="${(min / 1e9).toFixed(4)}"></label>
  <span class=muted>最低 ${sol(min)}（按 1 SOL ≈ $${S.cfg.solUsd}，${S.cfg.priceSource === 'fallback' ? '内置常量' : '实时价格'}）</span></div>
  <p class=muted id=split></p>
  <div class=notice>${NOTICE}</div>
  ${agreedTerms ? '' : `<label class=agree><input type=checkbox id=ag2> <span>我已阅读并同意《<a href="#/terms" target=_blank>用户协议 / 购买须知</a>》（首次购买需同意）</span></label>`}
  <label class=agree><input type=checkbox id=ag> <span>${AGREE}</span></label>
  <button id=ws class=primary disabled>✨ 确认支付并上链</button></div>`;
}
function me() {
  if (S.mode === 'guest') return `<h2>我的世界树</h2><div class=card>请先登录。</div>`;
  const mine = S.wishes.filter(w => w.author === S.pubkey), total = mine.reduce((s, w) => s + (w.paid || 0), 0);
  return `<h2>我的世界树</h2><div class=card>地址：<code>${esc(S.pubkey)}</code><br>模式：${S.mode === 'self' ? '自托管 Phantom' : '托管演示（邮箱 ' + esc(S.email) + '）'}
  <p>我的卡片：<b>${mine.length}</b> 张 · 累计支付：<b>${sol(total)}</b></p>
  ${S.mode === 'host' ? '<p class=muted>💡 想真正掌控自己的账户？建议安装 Phantom 并改用自托管模式。演示账户密钥存放在本地演示服务器，仅供 devnet，不提供主网使用。</p>' : ''}</div>
  <h3>🌈 我的世界树光谱</h3><div class=row>${mine.map(w => `<a href="#/w/${encodeURIComponent(w.sig)}" title="${esc(w.text)}">${spectrum(w.sig, 72)}</a>`).join('') || '<span class=muted>暂无</span>'}</div>
  <h3>我的愿望卡</h3>${mine.map(wishCard).join('') || '<p class=muted>暂无</p>'}
  <h3>本机操作记录</h3>${S.history.filter(h => h.who === S.pubkey).map(h => `<div class="card muted">${new Date(h.at).toLocaleString('zh-CN', { hour12: false })} · ${esc(h.label)} · ${esc(h.status)} ${h.lamports ? '· ' + sol(h.lamports) : ''} ${h.sig ? `<a target=_blank href="${EXPLORER(h.sig)}">交易</a>` : ''}</div>`).join('') || '<p class=muted>暂无</p>'}`;
}
const RULES_LIST = `<ul><li>不得违反任何国家和地区的法律法规；</li><li>禁止色情、暴力、歧视、侵权、违法宣传等内容；</li><li>须符合正向、积极的价值观（祝福、誓言、美好期许等）；</li><li>图片与文字均需通过审核后方可上链展示；</li><li>上链后内容不可修改，请在提交前仔细确认。</li></ul>`;
const help = () => `<h2>规则与说明</h2>
<div class="card" data-cat="经典"><h3>定制卡片内容规范</h3>${RULES_LIST}</div>
<div class=card><h3>🔐 自托管模式（推荐）</h3>连接 Phantom 钱包，每笔许愿/点赞/祝福都由你自己签名，资金从你的钱包直接转给收款地址。本站不接触私钥、不托管资金。</div>
<div class="card notice"><h3>⚠️ 托管演示模式</h3>输入邮箱即在本地演示服务器上生成 <b>devnet 专用</b>密钥并由服务器代签。密钥明文保存在服务器文件中，<b>绝不可用于主网或真实资产</b>；生产化需 KMS/HSM、实名/身份验证、合规评估。</div>
<div class=card><h3>👀 访客模式</h3>无需登录即可浏览全部愿望（只读）。</div>
<div class=card><h3>💰 费用与分配</h3>许愿（定制卡片）金额自由填写，最低为 1 美元等值 SOL；交易内直接拆分：20% 转入开发者地址，80% 转入项目金库地址。点赞、祝福仅需网络费。本项目<b>不提供</b>任何收益、分红、流动性或返利。<br><span class=muted>开发者：${esc(S.cfg.developer)}<br>金库：${esc(S.cfg.treasury)}</span></div>
<div class=card><h3>🛡️ 审核与审核证明</h3>内容在付款/上链<b>之前</b>由审核服务检查（关键词过滤 + AI 语义审核接口 + 人工复核队列）。通过后审核服务对「内容哈希 + 结果 + 时间戳」做 ed25519 签名，签名随内容一起写入链上；前端读取时重新校验，缺失或无效证明的内容不展示。审核公钥：<code style="word-break:break-all">${esc(S.cfg.moderator || '')}</code></div>
<div class=card><h3>🌳 成长阶段与月度树态</h3>成长阶段按愿望卡总数：${STAGES.map((s, i) => `${s}（≥${[0, 10, 50, 200, 1000][i]}）`).join(' → ')}。每月按北京时间自动切换：1–10 日 上旬·生机蓬勃；11–20 日 中旬·樱花盛开；21 日–月末 下旬·樱花飘落。</div>
<div class=card><h3>📜 风险提示</h3>本项目为 MVP 演示，运行于 Solana devnet，测试币无价值。链上内容公开且无法删除；本站可在前端隐藏违规内容，但无法从链上抹除。</div>`;
const terms = () => `<h2>用户协议 / 购买须知</h2><div class=card>
<ol><li>本站为非托管前端：所有写入由你自己的钱包签名（或在演示模式下由 devnet 演示密钥代签），区块链是唯一事实来源。</li>
<li>${NOTICE}</li><li>你提交的定制卡片内容须遵守《定制卡片内容规范》：${RULES_LIST}</li>
<li>购买金额自由填写，最低 1 美元等值 SOL；款项在同一笔交易中按 20%（开发者）/ 80%（项目金库）直接转出，本站不经手、不托管资金，不提供任何收益、分红或返利。</li>
<li>上链后内容与支付均不可撤销、不可修改、不可退款，请在提交前仔细确认。</li>
<li>每次购买生成一条与你地址绑定的「世界树光谱」灵魂绑定记录，不可转让，无金融属性。</li>
<li>托管演示模式仅用于 devnet 测试，不得用于真实资产。</li><li>当前运行于 devnet 测试网，仅供演示。</li></ol>
${localStorage.wt_terms === '1' ? '<p class=muted>✅ 你已同意本协议</p>' : '<button id=agreeTerms class="primary breathe">我已阅读并同意</button>'}</div>`;

// ---------- 路由 ----------
let ready3d = false;
async function route() {
  const [p, qs] = (location.hash.slice(1) || '/').split('?'), q = new URLSearchParams(qs || ''), v = $('#view');
  $('#banner').innerHTML = S.offline ? `⚠️ 无法连接 devnet RPC（${esc(S.offlineMsg || '')}），当前显示<b>离线示例数据</b>` : '';
  const pages = { '/': home, '': home, '/list': () => list(q), '/wish': wishPanel, '/me': me, '/help': help, '/terms': terms };
  v.innerHTML = p.startsWith('/w/') ? detail(decodeURIComponent(p.slice(3))) : (pages[p] || (() => '<p>404</p>'))();
  document.body.classList.toggle('home', !!$('#scene')); document.body.style.setProperty('--hdr', (document.querySelector('header').offsetHeight + $('#banner').offsetHeight) + 'px'); if ($('#scene')) mount3d();
  $('#lf')?.addEventListener('submit', e => { e.preventDefault(); location.hash = '#/list?' + new URLSearchParams(new FormData(e.target)); });
  $('#rf')?.addEventListener('click', async () => { await loadWishes(true); route(); });
  document.querySelectorAll('[data-season]').forEach(b => b.onclick = () => { S.season = b.dataset.season; window.WT3D?.setSeason(S.season); document.querySelectorAll('[data-season]').forEach(x => x.classList.toggle('on', x === b)); });
  $('#stress')?.addEventListener('change', e => { S.stress = e.target.checked; localStorage.wt_stress = S.stress ? '1' : ''; route(); });
  $('#stotal')?.addEventListener('change', e => { S.total = Math.max(1, Math.min(2.75e11, Math.floor(+e.target.value) || 1e11)); localStorage.wt_total = S.total; if (S.stress) route(); });
  $('#sf')?.addEventListener('submit', async e => { e.preventDefault(); const v = $('#sid').value.trim().replace(/^#|^SYN/, ''), n = S.stress ? S.total : S.wishes.length;
    if (!/^\d+$/.test(v) || +v >= n) return toast(`请输入 0 – ${(n - 1).toLocaleString('zh-CN')} 之间的卡片编号`, 'err');
    const r = await WT3D.jumpTo(+v); if (!r) return toast('定位失败', 'err'); toast(`已定位 #${v} → 区域 ${r.region}，槽位 ${r.slot}`, 'ok'); setTimeout(() => openCardPopup(r.wish), 1000); });
  $('#agreeTerms')?.addEventListener('click', () => { localStorage.wt_terms = '1'; toast('已同意用户协议', 'ok'); route(); });
  const w = p.startsWith('/w/') && S.wishes.find(x => x.sig === decodeURIComponent(p.slice(3))); $('#share')?.addEventListener('click', () => sharePng(w));
  $('#bs')?.addEventListener('click', async e => { const t = $('#bt').value.trim(); if (!t) return; e.target.disabled = true;
    try { await submit(await moderateThenMemo('B', e.target.dataset.sig, t), '祝福'); } catch (er) { toast(er.html ? er.message : esc(er.message), 'err'); } e.target.disabled = false; });
  const ta = $('#wt'); if (ta) {
    const upd = () => { const ok = $('#ag').checked && (!$('#ag2') || $('#ag2').checked); $('#ws').disabled = !ok; $('#ws').classList.toggle('breathe', ok);
      const l = Math.round(+$('#amt').value * 1e9) || 0; $('#split').textContent = `拆分：开发者 20% = ${sol(Math.floor(l * .2))}，项目金库 80% = ${sol(l - Math.floor(l * .2))}（+ 网络费）`; };
    fetch('/api/config').then(r => r.json()).then(c => { Object.assign(S.cfg, c); const a = $('#amt'); if (a) { a.min = c.minLamports / 1e9; if (+a.value * 1e9 < c.minLamports) a.value = (Math.ceil(c.minLamports / 1e5) / 1e4).toFixed(4); upd(); } }).catch(() => {});
    ta.addEventListener('input', () => $('#wc').textContent = [...ta.value].length + '/140'); ['#ag', '#ag2', '#amt'].forEach(s => $(s)?.addEventListener('input', upd)); upd();
    $('#ws').addEventListener('click', async () => { const t = ta.value.trim(), lam = Math.round(+$('#amt').value * 1e9);
      if (!t || [...t].length > 140 || t.includes('|')) return toast('愿望需为 1–140 字，且不含 |', 'err');
      if (!(lam >= S.cfg.minLamports)) return toast('金额低于最低 1 美元等值 ' + sol(S.cfg.minLamports), 'err');
      $('#ws').disabled = true; const tt = toast('内容审核中…');
      let memo; try { memo = await moderateThenMemo('W', $('#wc2').value, t); tt.update('✅ 审核通过，生成审核证明', 'ok'); } catch (e) { tt.update(e.html ? e.message : esc(e.message), 'err'); $('#ws').disabled = false; return; }
      if ($('#ag2')) localStorage.wt_terms = '1';
      if (await submit(memo, '许愿', lam)) location.hash = '#/'; else $('#ws').disabled = false; });
  }
}
function mount3d() { if (!window.WT3D) { if (!ready3d) { ready3d = true; addEventListener('wt3d-ready', () => $('#scene') && mount3d()); } return; }
  WT3D.attach($('#scene')); WT3D.setSeason(S.season || autoSeason()); WT3D.update(S.wishes, openCardPopup, { stress: S.stress, total: S.total }); }
addEventListener('hashchange', () => { closeModal(); $('#tip').hidden = true; route(); });
(async () => {
  renderMode();
  fetch('/api/config').then(r => r.json()).then(c => Object.assign(S.cfg, c)).catch(() => {}).then(() => fetch('/api/rules')).then(r => r.json()).then(r => S.words = r.words).catch(() => {});
  if (S.token) api('/api/me').then(r => { S.mode = 'host'; S.email = r.email; S.pubkey = r.pubkey; renderMode(); route(); }).catch(() => localStorage.removeItem('wt_token'));
  window.phantom?.solana?.connect?.({ onlyIfTrusted: true }).then(r => { if (S.mode === 'guest') { S.mode = 'self'; S.pubkey = r.publicKey.toString(); renderMode(); route(); } }).catch(() => {});
  $('#view').innerHTML = '<p class="muted breathe">正在读取链上愿望…</p>';
  try { Object.assign(S.cfg, await (await fetch('/api/config')).json()); } catch {}
  await loadWishes(); route();
  setInterval(async () => { await loadWishes(true); if (!document.querySelector('textarea:focus,input:focus') && $('#modal').hidden) route(); }, 30000);
})();
