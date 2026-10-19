// Service Worker v2：
// - 页面（导航）网络优先：总是先拿最新 HTML（3.5 秒没响应或离线才用缓存的首页壳），避免新旧版本混用
// - 带 ?v=<内容哈希> 的 css/js/i18n：内容不可变 → 缓存优先（换版本即换地址）
// - 其他本站静态资源：网络优先（cache: 'no-cache' 绕过浏览器 HTTP 缓存做校验），失败才用缓存
// API、黑名单不经此缓存
const C = 'wt-static-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())));
const prune = async (c, r) => { try { const html = await r.text(), bv = (html.match(/name="wt-build" content="([0-9a-f]+)"/) || [])[1]; for (const k of await c.keys()) { const m = /[?&]v=([0-9a-f]+)/.exec(k.url); if (m && m[1] !== bv && !html.includes('?v=' + m[1])) await c.delete(k); } } catch {} }; // 新版本上线：删掉旧版本的带哈希资源
const ok = r => r && r.ok && r.headers.get('x-wt') === '1'; // 只缓存本站真实响应（排除冷启动等待页）
self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url); if (req.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/blocklist')) return;
  if (req.mode === 'navigate') { e.respondWith((async () => { const c = await caches.open(C), net = fetch(req, { cache: 'no-cache' }).then(async r => { if (ok(r)) { await c.put('/', r.clone()); prune(c, r.clone()); } return r; });
    const to = new Promise(r => setTimeout(r, 3500)); try { const r = await Promise.race([net, to]); if (r) return r; } catch {} const hit = await c.match('/'); return hit || net; })()); return; }
  if (/[?&]v=[0-9a-f]{6,}/.test(u.search)) { e.respondWith(caches.open(C).then(async c => { const hit = await c.match(req); if (hit) return hit; const r = await fetch(req); if (ok(r)) c.put(req, r.clone()); return r; })); return; }
  e.respondWith(caches.open(C).then(async c => { try { const r = await fetch(req, { cache: 'no-cache' }); if (ok(r)) c.put(req, r.clone()); return r; } catch (er) { const hit = await c.match(req); if (hit) return hit; throw er; } }));
});
