// 网络层：API 基址可配置（Cloudflare Pages 前端 + Render API 跨域部署）。所有 fetch('/api/...') 自动加前缀；
// 冷启动容错：Render 免费实例休眠后约 1 分钟唤醒，期间幂等请求自动重试。「正在唤醒服务器」提示只在请求超过 3 秒仍无响应、
// 且 /api/health 探测（第 1 秒发出、2 秒超时）也没回应（确实在冷启动）时才显示；请求只是慢（如图片审核）而服务器在线时不提示。
(function () {
  const C = window.WT_CONFIG || {}, BASE = (C.apiBase || '').replace(/\/$/, '');
  window.WT_API = BASE; window.apiUrl = p => (BASE && typeof p === 'string' && p.startsWith('/api/') ? BASE + p : p);
  const NO_RETRY = /^\/api\/(memo|airdrop|wish-paid|logout|login|2fa|email|sessions|inbox\/read|notify|security|domains)\b/; // 有副作用的写请求不重试
  const of = window.fetch.bind(window); let slow = 0, chipT = null;
  const chip = on => { slow += on ? 1 : -1; let c = document.getElementById('waking');
    if (slow > 0 && !c) { c = document.createElement('div'); c.id = 'waking'; document.body && document.body.append(c); }
    if (c) { c.textContent = '☕ ' + (window.I18N?.t?.('route.waking') || 'Waking up the server…'); c.hidden = slow <= 0; } };
  let probeP = null, probeAt = 0; // 探测服务器是否在线（5 秒内复用结果）
  const probe = () => { if (!probeP || Date.now() - probeAt > 5000) { probeAt = Date.now(); probeP = Promise.race([of(apiUrl('/api/health'), { cache: 'no-store', signal: AbortSignal.timeout ? AbortSignal.timeout(2000) : undefined }).then(r => r.ok && /json/.test(r.headers.get('content-type') || '')).catch(() => false), new Promise(r => setTimeout(() => r(false), 2000))]); } return probeP; };
  const WAIT = 3000;
  window.fetch = async function (input, init) {
    const path = typeof input === 'string' ? input : null; if (!path || !path.startsWith('/api/') || path === '/api/health') return of(input, init);
    const url = apiUrl(path), retry = !NO_RETRY.test(path), t0 = Date.now(); let shown = false, done = false;
    const show = async () => { if (shown || done) return; if (await probe()) return; if (!shown && !done) { shown = true; chip(true); } }; // 服务器在线 → 只是请求慢，不提示
    const pt = setTimeout(probe, WAIT - 2000), timer = setTimeout(show, WAIT); // 1 秒时先探测服务器，满 3 秒仍未响应且探测失败才提示
    try { for (let i = 0; ; i++) { try { const r = await of(url, init);
          // 冷启动时 Render 可能返回其等待页（HTML / 无 CORS → TypeError）或 502/503
          if (retry && (r.status === 502 || r.status === 503 || r.status === 504 || (/text\/html/.test(r.headers.get('content-type') || '') && path !== '/api/img')) && Date.now() - t0 < 90000) throw new TypeError('waking');
          return r; }
        catch (e) { if (!retry || !(e instanceof TypeError) || Date.now() - t0 > 90000 || init?.signal?.aborted) throw e;
          if (Date.now() - t0 >= WAIT) show(); await new Promise(r => setTimeout(r, Math.min(8000, 1500 * (i + 1)))); } } } // 失败重试：满 3 秒才可能提示
    finally { done = true; clearTimeout(timer); clearTimeout(pt); if (shown) chip(false); } };
})();
