// t263 线上截图：规则页、举报流程（访客需登录 / 登录后举报表单）、作者一键申诉按钮（注入状态展示）。
const { chromium } = require('playwright'); const B = process.argv[2] || 'https://guangqi.world', SH = process.env.SHOTS || 'shots';
(async () => { const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const p = await ctx.newPage(); await p.addInitScript(() => { try { localStorage.gq_guide_dismissed = '1'; localStorage.wt_autotr = '0'; } catch {} });
  await p.goto(B + '/?lang=zh-CN#/rules'); await p.waitForSelector('.gold-title'); await p.waitForTimeout(1500);
  const txt = await p.textContent('main, body'); if (/人工审核队列|人工复核|24–72/.test(txt)) throw new Error('rules still mention human review');
  await p.screenshot({ path: SH + '/t263-live-rules.png' }); await p.evaluate(() => document.querySelectorAll('.card.motif')[3]?.scrollIntoView()); await p.waitForTimeout(400); await p.screenshot({ path: SH + '/t263-live-rules-2.png' });
  await p.goto(B + '/?lang=zh-CN#/list'); await p.waitForFunction(() => window.__S?.wishes?.length); await p.waitForTimeout(1500);
  const sig = await p.evaluate(() => __S.wishes.find(w => !w.priv).sig); await p.goto(B + '/?lang=zh-CN#/w/' + encodeURIComponent(sig)); await p.waitForSelector('[data-report]'); await p.waitForTimeout(800);
  await p.click('[data-report]'); await p.waitForTimeout(700); await p.screenshot({ path: SH + '/t263-live-report-guest.png' }); await p.evaluate(() => closeModal());
  await p.evaluate(() => { __S.token = 'demo'; }); await p.click('[data-report]'); await p.waitForSelector('#rpr'); await p.waitForTimeout(500); await p.screenshot({ path: SH + '/t263-live-report-form.png' }); await p.evaluate(() => { closeModal(); __S.token = ''; });
  await p.evaluate(s => { const w = __S.wishes.find(x => x.sig === s); w.modHidden = true; (__S.offc.modh ||= {})[s] = { ap: false, cat: '暴力' }; route(); }, sig); await p.waitForSelector('[data-appeal]'); await p.evaluate(() => document.querySelector('.mod-hid').scrollIntoView({ block: 'center' })); await p.waitForTimeout(500);
  await p.screenshot({ path: SH + '/t263-live-appeal.png' });
  await p.goto(B + '/?lang=en#/rules'); await p.waitForSelector('.gold-title'); await p.waitForTimeout(1200); await p.screenshot({ path: SH + '/t263-live-rules-en.png' });
  await br.close(); console.log('t263 live shots OK'); })().catch(e => { console.error('✗', e.message); process.exit(1); });
