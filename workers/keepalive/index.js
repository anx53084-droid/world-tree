// 保活 Worker：Cron Trigger 每 5 分钟请求一次 Render API 的 /api/health（不碰数据库），避免免费实例闲置 15 分钟后休眠、用户打开页面时看到「正在唤醒服务器」。
// QUIET（北京时间小时区间，如 "2-7" 表示 02:00–06:59 不保活）用于给 Render 每月 750 小时免费额度留余量；设为空字符串 = 24/7。
export default {
  async scheduled(ev, env, ctx) { ctx.waitUntil(ping(env, 'cf-cron')); },
  async fetch(req, env) { const u = new URL(req.url); if (u.pathname !== '/run') return new Response('keepalive worker: GET /run to ping once\n'); return Response.json(await ping(env, 'cf-manual')); },
};
const bjHour = (d = new Date()) => (d.getUTCHours() + 8) % 24;
function quiet(spec, h) { const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(spec ?? '').trim()); if (!m) return false; const a = +m[1], b = +m[2]; return a <= b ? h >= a && h < b : h >= a || h < b; }
async function ping(env, src) {
  const url = env.TARGET || 'https://world-tree-ijv1.onrender.com/api/health', h = bjHour(), t0 = Date.now();
  if (quiet(env.QUIET ?? '2-7', h)) { const r = { skipped: 'quiet hours (Beijing ' + (env.QUIET ?? '2-7') + ')', bjHour: h }; console.log(JSON.stringify(r)); return r; }
  try { const r = await fetch(url, { headers: { 'x-keepalive': src, 'user-agent': 'guangqi-keepalive/1' }, signal: AbortSignal.timeout(90000) }), j = await r.json().catch(() => ({}));
    const o = { status: r.status, ms: Date.now() - t0, up: j.up, at: new Date().toISOString() }; console.log(JSON.stringify(o)); return o; }
  catch (e) { const o = { error: String(e.message || e), ms: Date.now() - t0 }; console.log(JSON.stringify(o)); return o; }
}
