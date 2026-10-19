// 保活 + 唤醒提示验证：/api/health 轻量（不读写数据、带 x-keepalive 打日志）；前端 net.js 只在请求超过 3 秒且健康探测也无响应时才显示「正在唤醒服务器」；保活 Worker / Actions 配置。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert'), vm = require('vm');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 在 Node 里加载 net.js：替换 window.fetch 为可控的假 fetch
function loadNet(fake) { const els = {}; const document = { getElementById: id => els[id] || null, createElement: () => ({ hidden: false, textContent: '' }), body: { append: el => { els.waking = el; el.id = 'waking'; } } };
  const window = { WT_CONFIG: { apiBase: 'https://api.test' }, fetch: fake, I18N: { t: () => '正在唤醒服务器' }, document, AbortSignal, setTimeout, clearTimeout, Date, Promise, TypeError, URL, Math, String }; window.window = window; // 浏览器里 window 即全局对象
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'public/net.js'), 'utf8'), window);
  return { f: window.fetch, chipShown: () => !!(els.waking && !els.waking.hidden), everShown: () => !!els.waking }; }
const res = (status = 200, ct = 'application/json') => ({ ok: status < 400, status, headers: { get: k => k === 'content-type' ? ct : null }, json: async () => ({}) });
(async () => {
  console.log('net.js');
  { const N = loadNet(async () => res()); await N.f('/api/config'); ok(!N.everShown(), '快速响应：不提示'); }
  { const N = loadNet(async u => { if (u.endsWith('/api/health')) return res(); await sleep(4500); return res(); }); const p = N.f('/api/img', { method: 'POST' }); await sleep(4000); ok(!N.chipShown(), '请求慢（>3 秒）但服务器在线（health 秒回）：不提示'); await p; }
  { let up = false; const N = loadNet(async u => { if (u.endsWith('/api/health')) { await sleep(3000); return res(); } await sleep(5000); return res(); }); const p = N.f('/api/config'); await sleep(2500); ok(!N.chipShown(), '冷启动：3 秒内不提示'); await sleep(1100); ok(N.chipShown(), '冷启动：超过 3 秒且健康探测无响应 → 显示唤醒提示'); await p; ok(!N.chipShown(), '响应后提示消失'); }
  { let i = 0; const N = loadNet(async u => { if (u.endsWith('/api/health')) return res(); if (i++ === 0) throw new TypeError('Failed to fetch'); return res(); }); await N.f('/api/config'); ok(!N.everShown(), '一次网络抖动（立刻重试成功）：不再立即弹提示'); }
  { let t0 = Date.now(); const N = loadNet(async u => { if (u.endsWith('/api/health')) throw new TypeError('x'); if (Date.now() - t0 < 4500) return res(200, 'text/html'); return res(); }); const p = N.f('/api/config'); await sleep(4200); ok(N.chipShown(), 'Render 等待页（HTML）持续 >3 秒：显示提示并自动重试'); await p; }
  console.log('server');
  const D = __dirname, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-ka-')), port = 18971, B = 'http://127.0.0.1:' + port;
  for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f)); fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data');
  let log = ''; const srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, D1_API_TOKEN: '', PRICE_MOCK: '1' } }); srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
  try { for (let i = 0; i < 80; i++) { try { await fetch(B + '/api/nonce'); break; } catch { await sleep(250); } }
    const before = fs.readdirSync(tmp + '/data').map(f => f + ':' + fs.statSync(tmp + '/data/' + f).mtimeMs).join();
    let t = Date.now(), r = await fetch(B + '/api/health', { headers: { 'x-keepalive': 'cf-cron' } }), j = await r.json(), ms = Date.now() - t;
    ok(r.status === 200 && j.ok === true && typeof j.up === 'number' && r.headers.get('cache-control') === 'no-store' && r.headers.get('access-control-allow-origin') === '*', `/api/health 200 {ok,up}（${ms}ms，no-store，允许跨域探测）`);
    await sleep(300); ok(/keepalive ping \(cf-cron\) up=\d+s/.test(log), 'x-keepalive 请求在服务器日志里留一行（Render 日志可核对）');
    await fetch(B + '/api/health'); await sleep(200); ok((log.match(/keepalive ping/g) || []).length === 1, '普通健康探测不打日志（前端探测不刷屏）');
    ok(fs.readdirSync(tmp + '/data').map(f => f + ':' + fs.statSync(tmp + '/data/' + f).mtimeMs).join() === before, '健康检查不读写数据文件');
    ok((await fetch(B + '/healthz')).status === 200, '/healthz 别名');
  } finally { srv.kill(); }
  console.log('config');
  const w = fs.readFileSync(path.join(D, 'workers/keepalive/wrangler.toml'), 'utf8'), wi = fs.readFileSync(path.join(D, 'workers/keepalive/index.js'), 'utf8'), gh = fs.readFileSync(path.join(D, '.github/workflows/keepalive.yml'), 'utf8');
  ok(/crons = \["\*\/5 \* \* \* \*"\]/.test(w) && /world-tree-ijv1\.onrender\.com\/api\/health/.test(w), 'Cloudflare Worker Cron 每 5 分钟请求 /api/health');
  ok(/'\*\/10 \* \* \* \*'/.test(gh) && /x-keepalive: gh-actions/.test(gh) && /\* 290/.test(gh) && /group: keepalive/.test(gh), 'GitHub Actions 每 10 分钟触发、每次覆盖 25 分钟（每 5 分钟一次），防 schedule 延迟/漏跑');
  ok(/set \+e/.test(gh) && /for try in 1 2 3/.test(gh) && /-m 90/.test(gh) && /::warning::/.test(gh) && /\n\s*exit 0\n/.test(gh) && !/^ +\[ \$i -lt 6 \] && sleep/m.test(gh), 'Actions 备份：每次 ping 重试 3 次、90s 超时，失败只记 warning、job 不标红');
  const mod = await import('data:text/javascript,' + encodeURIComponent(wi)); let calls = []; globalThis.fetch = async (u, o) => { calls.push([u, o.headers['x-keepalive']]); return res(); };
  const r1 = await mod.default.fetch(new Request('https://w/run'), { QUIET: '' }); const j1 = await r1.json(); ok(j1.status === 200 && calls[0][1] === 'cf-manual', 'Worker /run 手动触发一次保活');
  const h = (new Date().getUTCHours() + 8) % 24, r2 = await (await mod.default.fetch(new Request('https://w/run'), { QUIET: `${h}-${(h + 1) % 24}` })).json(); ok(r2.skipped && calls.length === 1, 'QUIET 时段（北京时间）跳过，给免费额度留余量');
  console.log(`\n✅ ${n} checks passed`); process.exit(0);
})().catch(e => { console.error('\n❌', e.message); process.exit(1); });
