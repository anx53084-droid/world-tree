// 网络层：API 基址可配置（Cloudflare Pages 前端 + Render API 跨域部署）。所有 fetch('/api/...') 自动加前缀；
// 冷启动容错：Render 免费实例休眠后约 1 分钟唤醒，期间幂等请求自动重试，并显示「正在唤醒服务器」提示。
(function () {
  const C = window.WT_CONFIG || {}, BASE = (C.apiBase || '').replace(/\/$/, '');
  window.WT_API = BASE; window.apiUrl = p => (BASE && typeof p === 'string' && p.startsWith('/api/') ? BASE + p : p);
  const NO_RETRY = /^\/api\/(memo|airdrop|wish-paid|logout|login|2fa|email|sessions|inbox\/read|notify|security)\b/; // 有副作用的写请求不重试
  const of = window.fetch.bind(window); let slow = 0, chipT = null;
  const chip = on => { slow += on ? 1 : -1; let c = document.getElementById('waking');
    if (slow > 0 && !c) { c = document.createElement('div'); c.id = 'waking'; document.body && document.body.append(c); }
    if (c) { c.textContent = '☕ ' + (window.I18N?.t?.('route.waking') || 'Waking up the server…'); c.hidden = slow <= 0; } };
  window.fetch = async function (input, init) {
    const path = typeof input === 'string' ? input : null; if (!path || !path.startsWith('/api/')) return of(input, init);
    const url = apiUrl(path), retry = !NO_RETRY.test(path), t0 = Date.now(); let shown = false;
    const timer = setTimeout(() => { shown = true; chip(true); }, 3500);
    try { for (let i = 0; ; i++) { try { const r = await of(url, init);
          // 冷启动时 Render 可能返回其等待页（HTML / 无 CORS → TypeError）或 502/503
          if (retry && (r.status === 502 || r.status === 503 || r.status === 504 || (/text\/html/.test(r.headers.get('content-type') || '') && path !== '/api/img')) && Date.now() - t0 < 90000) throw new TypeError('waking');
          return r; }
        catch (e) { if (!retry || !(e instanceof TypeError) || Date.now() - t0 > 90000 || init?.signal?.aborted) throw e;
          if (!shown) { shown = true; clearTimeout(timer); chip(true); } await new Promise(r => setTimeout(r, Math.min(8000, 1500 * (i + 1)))); } } }
    finally { clearTimeout(timer); if (shown) chip(false); } };
})();
