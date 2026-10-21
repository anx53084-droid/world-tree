// t251：390x844 移动端 3D 树 FPS 测量（FPS_URL 指定站点；SHOT 输出截图）
const { chromium } = require('playwright');
(async () => { const U = process.env.FPS_URL || 'http://localhost:8787', b = await chromium.launch({ args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }), p = await c.newPage();
  await p.goto(U + '/?lang=zh-CN'); await p.evaluate(() => { localStorage.wt_terms = '1'; localStorage.gq_guide_dismissed = '1'; }); await p.reload();
  await p.waitForFunction(() => window.WT3D?.stats().N >= 1, null, { timeout: 60000 }); await p.waitForTimeout(8000);
  const out = []; for (let i = 0; i < 3; i++) { await p.evaluate(() => WT3D.resetStats()); await p.waitForTimeout(5000); out.push(await p.evaluate(() => WT3D.stats())); }
  const s = await p.evaluate(() => { const cv = document.querySelector('#scene canvas'); return { css: [cv.clientWidth, cv.clientHeight], px: [cv.width, cv.height] }; });
  console.log(JSON.stringify({ url: U, canvas: s, runs: out.map(o => ({ fps: o.fps, p95: o.frameP95Ms, bloom: o.bloom, q: o.q, pr: o.pr, N: o.N })) }));
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT }); await b.close(); })();
