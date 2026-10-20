// 多域名 / 一键换域（后手方案）：启动时读取 /api/domains（缓存 + 失败回退到内置默认清单）；
// 当前域名被标记 blocked，或不是主域而主域健康时，显示提示条并（blocked 时）倒计时自动跳转 / 一键跳转到主域。
// 安全：跳转目标只来自清单（HOST 格式 + 清单内 + 非 blocked），永不使用 URL 参数里的目标，防开放重定向。
// 迁移：localStorage 不能跨域，只通过 ?_mig= 携带白名单内的非敏感设置（语言、条款已读等）；会话 / 钱包 / 历史绝不携带。登录需在新域重新签名。
(function (root) {
  const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
  const ALLOW = ['wt_lang', 'wt_terms', 'wt_chain', 'wt_stress', 'wt_total', 'wt_wtab', 'gq_guide_dismissed']; // 非敏感设置白名单
  const VAL = /^[A-Za-z0-9_.:-]{0,40}$/, TTL_DEFAULT = [{ host: 'guangqi.world', status: 'active', primary: true }];
  const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = s => decodeURIComponent(escape(atob(String(s).replace(/-/g, '+').replace(/_/g, '/'))));
  function clean(list) { if (!Array.isArray(list)) return null; const out = list.filter(x => x && HOST.test(String(x.host || '')) && ['active', 'standby', 'blocked'].includes(x.status)).map(x => ({ host: x.host, status: x.status, primary: !!x.primary })); return out.length ? out : null; }
  function fallback(cfg) { const hs = cfg && Array.isArray(cfg.domains) ? cfg.domains.filter(h => HOST.test(h)) : []; return hs.length ? hs.map((host, i) => ({ host, status: 'active', primary: i === 0 })) : TTL_DEFAULT; }
  // 目标必须在清单内、非 blocked、格式合法
  function safeTarget(host, list) { host = String(host || '').toLowerCase(); if (!HOST.test(host)) return null; const x = (list || []).find(d => d.host === host); return x && x.status !== 'blocked' ? host : null; }
  // 当前域名 → 动作：none | suggest（非主域，一键跳转）| redirect（blocked，自动跳转）
  function decide(cur, list) { cur = String(cur || '').toLowerCase(); const me = (list || []).find(d => d.host === cur); if (!me) return { action: 'none' }; // 未收录（本地 / 预览域）不处理
    const prim = list.find(d => d.primary && d.status === 'active' && d.host !== cur), any = list.find(d => d.status === 'active' && d.host !== cur);
    if (me.status === 'blocked') { const t = prim || any; return t ? { action: 'redirect', target: t.host } : { action: 'none' }; }
    if (!me.primary && prim) return { action: 'suggest', target: prim.host }; return { action: 'none' }; }
  function collect(storage) { const o = {}; for (const k of ALLOW) { let v = null; try { v = storage.getItem(k); } catch {} if (v != null && VAL.test(v)) o[k] = v; } return o; }
  // 构造跳转地址：https://目标/?lang=…&_mig=…&_from=…#/原路由
  function buildUrl(target, { lang, hash, settings, from }) { const q = new URLSearchParams(); if (lang) q.set('lang', lang); const s = settings && Object.keys(settings).length ? b64(JSON.stringify(settings)) : ''; if (s) q.set('_mig', s); if (from && HOST.test(from)) q.set('_from', from);
    return 'https://' + target + '/' + (q.toString() ? '?' + q : '') + (hash && hash !== '#' ? hash : ''); }
  function importMig(search, storage) { const q = new URLSearchParams(search), m = q.get('_mig'), from = q.get('_from'); if (!m && !from) return null; let n = 0;
    if (m) try { const o = JSON.parse(unb64(m)); if (o && typeof o === 'object') for (const k of ALLOW) if (typeof o[k] === 'string' && VAL.test(o[k])) { try { storage.setItem(k, o[k]); n++; } catch {} } } catch {}
    return { from: HOST.test(from || '') ? from : '', n }; }
  const api = { HOST, ALLOW, clean, fallback, safeTarget, decide, collect, buildUrl, importMig };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window === 'undefined' || root !== window) return; window.WT_DOMAINS = api;
  // ---- 浏览器端 ----
  let arrived = null; try { arrived = importMig(location.search, localStorage); if (arrived) { const u = new URL(location.href); u.searchParams.delete('_mig'); u.searchParams.delete('_from'); history.replaceState(null, '', u.pathname + u.search + u.hash); sessionStorage.wt_dom_arrived = arrived.from || '1'; } } catch {}
  async function getList() { const C = window.WT_CONFIG || {};
    try { const r = await fetch('/api/domains', { cache: 'no-store', signal: AbortSignal.timeout(4000) }); if (r.ok) { const l = clean((await r.json()).domains); if (l) { try { localStorage.wt_domains = JSON.stringify({ l, at: Date.now() }); } catch {} return l; } } } catch {}
    try { const c = clean(JSON.parse(localStorage.wt_domains || '{}').l); if (c) return c; } catch {} return fallback(C); }
  async function reachable(host) { try { await fetch('https://' + host + '/config.js', { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(4000) }); return true; } catch { return false; } }
  function bar(html, cls) { let b = document.getElementById('dombar'); if (!b) { b = document.createElement('div'); b.id = 'dombar'; b.setAttribute('role', 'region'); document.body.prepend(b); } b.className = cls || ''; b.setAttribute('aria-label', t('dom.aria')); b.innerHTML = html; b.hidden = false; return b; }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function go(target, list) { const h = safeTarget(target, list); if (!h) return; location.href = buildUrl(h, { lang: window.I18N?.lang, hash: location.hash, settings: collect(localStorage), from: location.host }); }
  async function start() { await (window.I18N?.ready || Promise.resolve()); const arr = sessionStorage.wt_dom_arrived;
    const list = await getList(), d = decide(location.host, list);
    if (d.action === 'none') { if (arr && !sessionStorage.wt_dom_seen) { sessionStorage.wt_dom_seen = '1'; const b = bar(`<span>✅ ${esc(t('dom.arrived', { host: location.host }))}</span><button type=button id=dombtn>${esc(t('dom.dismiss'))}</button>`, 'info'); b.querySelector('#dombtn').onclick = () => b.hidden = true; } return; }
    if (d.action === 'suggest' && sessionStorage.wt_dom_stay === d.target) return;
    const tgt = d.target, note = esc(t('dom.note')); let timer = null;
    if (d.action === 'suggest') { const b = bar(`<span>🌐 ${esc(t('dom.suggest', { host: tgt }))} <small>${note}</small></span><button type=button class=primary id=domgo>${esc(t('dom.go'))}</button><button type=button id=domstay>${esc(t('dom.stay'))}</button>`, 'suggest');
      b.querySelector('#domgo').onclick = () => go(tgt, list); b.querySelector('#domstay').onclick = () => { sessionStorage.wt_dom_stay = tgt; b.hidden = true; }; return; }
    // blocked：先探测目标可达，再倒计时自动跳转；刚从别处迁移过来（防乒乓）或不可达时只提示、不自动跳
    const up = await reachable(tgt), auto = up && !arr; let sec = 8;
    const paint = () => { const b = bar(`<span><span id=domtxt>⚠️ ${esc(auto ? t('dom.blocked', { host: tgt, sec }) : up ? t('dom.suggest', { host: tgt }) : t('dom.unreach', { host: tgt }))}</span> <small>${note}</small></span><button type=button class=primary id=domgo>${esc(t('dom.go'))}</button>${auto && timer ? `<button type=button id=domstay>${esc(t('dom.cancel'))}</button>` : ''}`, 'blocked');
      b.querySelector('#domgo').onclick = () => go(tgt, list); const c = b.querySelector('#domstay'); if (c) c.onclick = () => { clearInterval(timer); timer = null; paint(); }; };
    if (auto) { timer = setInterval(() => { sec--; if (sec <= 0) { clearInterval(timer); go(tgt, list); } else { const x = document.getElementById('domtxt'); if (x) x.textContent = '⚠️ ' + t('dom.blocked', { host: tgt, sec }); } }, 1000); } paint(); }
  const run = () => start().catch(() => {}); if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})(typeof window !== 'undefined' ? window : this);
