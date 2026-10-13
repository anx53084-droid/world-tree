// Service Worker：静态资源 stale-while-revalidate。Render 免费实例冷启动（约 1 分钟）时，回访用户可立即从缓存渲染世界树；API 请求不经缓存
const C = 'wt-static-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url); if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  const key = e.request.mode === 'navigate' ? new Request('/') : e.request; // 页面统一用首页壳（单页应用，hash 路由）
  e.respondWith(caches.open(C).then(async c => {
    const hit = await c.match(key, { ignoreSearch: e.request.mode === 'navigate' });
    const net = fetch(e.request).then(async r => { if (r.ok && r.headers.get('x-wt') === '1') { // 只缓存本站真实响应（排除冷启动等待页）
        if (e.request.mode === 'navigate' && hit && hit.headers.get('etag') !== r.headers.get('etag')) for (const k of await c.keys()) await c.delete(k); // 新版本部署：清空旧资源，下次整体更新，避免新旧混用
        await c.put(key, r.clone()); } return r; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; } return net; }));
});
