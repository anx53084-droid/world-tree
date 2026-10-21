// t247：悬浮「制作卡片」按钮不遮挡任何页面底部内容（360 / 412 宽，登录态）。BASE 指向本地或线上；线上只读，不发交易。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert'), nacl = require('tweetnacl'), bs58 = require('bs58');
const b58 = bs58.default || bs58; let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); };
const D = __dirname, SHOTS = process.env.SHOTS, LIVE = process.env.FAB_LIVE;
const PAGES = ['/', '/free', '/wallet-guide', '/rules', '/inbox', '/wish', '/list', '/me', '/security', '/notify', '/help', '/terms', '/ads', '/w/FIRST'];
(async () => { let srv, Bs, browser;
  if (LIVE) Bs = 'https://guangqi.world'; else { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-fab-')), port = 18993; Bs = 'http://127.0.0.1:' + port;
    for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f)); fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data');
    fs.writeFileSync(tmp + '/data/prices-mock.json', JSON.stringify({ SOL: 150, ETH: 3000, BNB: 600 }));
    srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, D1_API_TOKEN: '', PRICE_MOCK: '1' }, stdio: 'ignore' });
    for (let i = 0; i < 80; i++) { try { await fetch(Bs + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 250)); } } }
  try { const { chromium, devices } = require('playwright'); browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    for (const W of [360, 412]) { const c = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: W, height: 780 }, locale: 'zh-CN' }); const p = await c.newPage();
      await p.goto(Bs + '/?lang=zh-CN'); await p.evaluate(() => { localStorage.wt_terms = '1'; localStorage.gq_guide_dismissed = '1'; });
      // 仅前端显示登录态（FAB 只在登录后出现）：不调用任何写接口
      await p.evaluate(() => { S.mode = 'self'; S.pubkey = '11111111111111111111111111111111'; });
      for (let pg of PAGES) { if (pg === '/w/FIRST') { const s = await p.evaluate(() => S.wishes[0]?.sig); if (!s) continue; pg = '/w/' + s; }
        await p.evaluate(h => { location.hash = '#' + h; }, pg); await p.waitForTimeout(1500); await p.evaluate(() => { S.mode = 'self'; paintFab(location.hash.slice(1).split('?')[0]); });
        await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(500);
        const r = await p.evaluate(() => { const f = document.querySelector('#fab'); if (!f || f.hidden || getComputedStyle(f).display === 'none') return { fab: false };
          const fr = f.getBoundingClientRect(), hits = [];
          for (const e of document.querySelectorAll('main a, main button, main p, main li, main input, main select, main textarea, main h3, main label, main .tag, footer:not(.debug-only)')) { if (e.closest('#fab') || !e.offsetParent) continue;
            const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue; if (e.closest('.scene')) continue;
            if (r.left < fr.right && r.right > fr.left && r.top < fr.bottom && r.bottom > fr.top) hits.push((e.tagName + ' ' + (e.textContent || '').trim()).slice(0, 40)); }
          return { fab: true, hits }; });
        ok(!r.fab || !r.hits.length, `${W}px ${pg.slice(0, 20)}：${r.fab ? '按钮不遮挡底部内容' + (r.hits.length ? ' ✗ ' + r.hits.join(' | ') : '') : '按钮隐藏'}`);
        if (SHOTS && W === 412 && ['/free', '/wallet-guide'].includes(pg)) await p.screenshot({ path: `${SHOTS}/t247-${LIVE ? 'live-' : ''}${pg.slice(1)}-bottom.png` }); }
      await p.evaluate(() => { location.hash = '#/wish/make'; }); await p.waitForTimeout(1200); ok(await p.evaluate(() => document.querySelector('#fab').hidden), `${W}px 制作页：不显示制作按钮`); await c.close(); }
    console.log(`\n✅ ${n} checks passed`);
  } finally { if (browser) await browser.close(); srv?.kill(); } })().catch(e => { console.error('FAIL', e.message); process.exit(1); });
