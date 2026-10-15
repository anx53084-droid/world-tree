// 合作卡 / 统计验证：配置校验、聚合计数（无个人数据）、限流、管理接口鉴权、feed 广告位规则。不联网上链。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-ads-')), port = 19000 + Math.floor(Math.random() * 900);
  for (const f of fs.readdirSync(__dirname)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(__dirname, f), path.join(tmp, f));
  fs.symlinkSync(path.join(__dirname, 'node_modules'), path.join(tmp, 'node_modules')); fs.symlinkSync(path.join(__dirname, 'public'), path.join(tmp, 'public')); fs.mkdirSync(path.join(tmp, 'data'));
  const srv = cp.spawn(process.execPath, ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, ADMIN_KEY: 'k-test', D1_API_TOKEN: '' }, stdio: 'ignore' });
  const B = 'http://127.0.0.1:' + port, call = async (u, body, adm) => { const r = await fetch(B + u, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(adm ? { 'x-admin-key': 'k-test' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  try { for (let i = 0; i < 60; i++) { try { await fetch(B + '/api/nonce'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    ok((await call('/api/ads')).j.ads.length === 0, '未配置合作内容：/api/ads 为空（feed 不变）');
    ok((await call('/api/admin/ads', { id: 'x1', title: 'T', text: 'T' })).s === 403, '管理接口无 ADMIN_KEY → 403');
    ok((await call('/api/admin/ads', { id: 'Bad Id', title: 'T', text: 'T' }, true)).s === 400, '非法 id 被拒绝');
    ok((await call('/api/admin/ads', { id: 'ext1', title: 'T', text: 'T', mode: 'external', url: 'http://a.example/x' }, true)).s === 400, '外链必须 https');
    ok((await call('/api/admin/ads', { id: 'ext1', title: 'T', text: 'T', mode: 'external', url: 'https://bit.ly/abc' }, true)).s === 400, '短链/黑名单域名被拒绝');
    let r = await call('/api/admin/ads', { id: 'brand-a', brand: '示例品牌', title: '合作示例 A', text: '示例合作内容', rank: 1, mode: 'inline' }, true); ok(r.s === 200, '创建站内展开合作卡');
    r = await call('/api/admin/ads', { id: 'brand-b', title: '合作示例 B', text: '外链示例', rank: 2, mode: 'external', url: 'https://example.com/landing?x=1' }, true); ok(r.s === 200 && r.j.ad.url.startsWith('https://example.com'), '创建外链合作卡');
    const L = (await call('/api/ads')).j.ads; ok(L.length === 2 && L[0].id === 'brand-a' && L[1].url && !L[0].url, '公开列表按名次排序，站内模式不暴露 url');
    r = await call('/api/track', { ev: 'card_click', id: 'AD:brand-a', pos: 3, rank: 1 }); console.log(r); ok(r.s === 200, '埋点 card_click 接受');
    await call('/api/track', { ev: 'ad_click', id: 'AD:brand-a', pos: 3, rank: 1 }); await call('/api/track', { ev: 'card_view', id: 'SomeSig12345678' });
    ok((await call('/api/track', { ev: 'hack', id: 'AD:brand-a' })).s === 400 && (await call('/api/track', { ev: 'ad_click', id: 'AD:nope' })).s === 400, '非法事件 / 未知广告被拒绝');
    const S = (await call('/api/admin/ads', null, true)).j.stats; ok(S.ad_click['brand-a|r1|p3'] === 1 && S.card_click['*'] === 1 && S.card_view['*'] === 1, '聚合计数：广告按 id|名次|位置，自然卡仅总数');
    ok(!JSON.stringify(S).match(/\d+\.\d+\.\d+\.\d+|127\.0|user-agent/i), '统计中不含 IP / UA 等个人数据');
    let rl = 0; for (let i = 0; i < 120; i++) if ((await call('/api/track', { ev: 'card_click', id: 'AD:brand-a', pos: 1, rank: 1 })).s === 429) rl++; ok(rl > 0, '埋点限流：超出每分钟上限返回 429（' + rl + '）');
    // 前端 feed 规则（原样取自 app.js 的 slotsFor / rebuildFeed）
    const src = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8'), a = src.indexOf('const FEED_PAGE'), b = src.indexOf('const feedKey');
    const a2 = src.indexOf('function slotsFor'), b2 = src.indexOf('function initFeed');
    const mk = new Function('S', 'FEED_PAGE', 'AD_SLOTS', src.slice(a2, b2) + '; return rebuildFeed;');
    const S1 = { ads: Array.from({ length: 30 }, (_, i) => ({ id: 'a' + i })), fp: { pages: 2, ws: Array.from({ length: 230 }, (_, i) => ({ sig: 's' + i })) }, feed: [] }; mk(S1, 100, 20)();
    ok(S1.feed.filter(x => x.t === 'ad').length === 40 && S1.feed.filter(x => x.t === 'w').length === 200, '每页 100 张自然卡配 20 个广告位（2 页 → 200 + 40）');
    const S2 = { ads: [], fp: { pages: 1, ws: Array.from({ length: 50 }, (_, i) => ({ sig: 's' + i })) }, feed: [] }; mk(S2, 100, 20)(); ok(S2.feed.length === 50 && S2.feed.every(x => x.t === 'w'), '无合作内容时 feed 不变');
  } catch (e) { console.error('FAIL', e.message); process.exitCode = 1; } finally { srv.kill(); }
  console.log(process.exitCode ? '\n❌ failed' : `\n✅ ${n} checks passed`);
})();
