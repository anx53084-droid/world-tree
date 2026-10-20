// 心愿实现 / 物质类 / 内部记账 无头验证（不触达真实链 tip）
const http = require('http');
const { chromium, devices } = require('playwright');
const BASE = (process.env.BASE || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const ADMIN = process.env.ADMIN_KEY || 'test-admin-key-verify';

function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, BASE);
    const data = body != null ? JSON.stringify(body) : null;
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { 'content-type': 'application/json', ...(data ? { 'content-length': Buffer.byteLength(data) } : {}), ...headers } },
      res => { let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(b || '{}'), raw: b }); } catch { resolve({ status: res.statusCode, raw: b }); } }); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

(async () => {
  const fails = [];
  const check = (name, ok, detail) => { console.log((ok ? 'OK  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : '')); if (!ok) fails.push(name); };

  // 1) ADMIN_KEY unset behavior is tested only if env was unset at server start; here we assume server started WITH ADMIN_KEY=test-admin-key-verify
  const noKey = await req('GET', '/api/admin/fulfillments');
  check('admin without key → 403', noKey.status === 403, 'status=' + noKey.status);

  const badKey = await req('GET', '/api/admin/fulfillments', null, { 'x-admin-key': 'wrong' });
  check('admin wrong key → 403', badKey.status === 403);

  // 2) register material wish + shipping (off-chain)
  const sig = 'VERIFY_MAT_' + Date.now();
  const reg = await req('POST', '/api/wish-paid', {
    sig, cat: '物质类', text: '想要一本好书', author: 'DemoAuthor111111111111111111111111111111',
    lamports: 10_000_000, shippingNote: '收件人：测试 电话：13800000000 请勿上链', source: 'verify'
  });
  check('wish-paid material', reg.status === 200 && reg.json.ok && reg.json.material === true, JSON.stringify(reg.json));

  // 3) public view must NOT include shippingNote
  const pub = await req('GET', '/api/fulfillments/' + encodeURIComponent(sig));
  check('public no shipping', pub.status === 200 && pub.json.status === 'pending' && !('shippingNote' in pub.json) && !JSON.stringify(pub.json).includes('13800000000'), JSON.stringify(pub.json));

  // 4) admin list pending includes shipping
  const list = await req('GET', '/api/admin/fulfillments?status=pending', null, { 'x-admin-key': ADMIN });
  check('admin list pending', list.status === 200 && Array.isArray(list.json.items) && list.json.items.some(i => i.wishSig === sig && i.shippingNote.includes('13800000000')), 'count=' + (list.json.items || []).length);

  // 5) fund ledger bookkeeping (2000 bps of full 10e6 = 2e6)
  const fs = require('fs'), path = require('path');
  const ledger = JSON.parse(fs.readFileSync(path.join(process.env.WT_DATA || path.join(__dirname, 'data'), 'fund-ledger.json'), 'utf8')) // WT_DATA：服务器数据目录（verify-all 用临时目录）;
  const entry = ledger.entries.find(e => e.wishSig === sig);
  check('fund ledger entry', !!entry && entry.fundLamports === 2_000_000 && entry.fundBps === 2000, JSON.stringify(entry));

  // 6) non-material still ledgers, no fulfillment pending
  const sig2 = 'VERIFY_SCENERY_' + Date.now();
  const reg2 = await req('POST', '/api/wish-paid', { sig: sig2, cat: '风景', text: '去看极光', author: 'A', lamports: 5_000_000, source: 'verify' });
  check('wish-paid scenery', reg2.status === 200 && reg2.json.material === false);
  const pub2 = await req('GET', '/api/fulfillments/' + encodeURIComponent(sig2));
  check('scenery no fulfillment record', pub2.status === 404);

  // 7) mark fulfilled (no hot wallet → server-signed only)
  const ful = await req('POST', '/api/admin/fulfillments/fulfill', { wishSig: sig, note: '书已寄出，阅读愉快' }, { 'x-admin-key': ADMIN });
  check('admin fulfill', ful.status === 200 && ful.json.ok && ful.json.public?.fulfilled === true && ful.json.public?.badge === true, JSON.stringify(ful.json.public));
  check('fulfill memo shape', typeof ful.json.memo === 'string' && ful.json.memo.startsWith('WTREE1|F|' + sig + '|'), ful.json.memo?.slice(0, 80));

  const pub3 = await req('GET', '/api/fulfillments/' + encodeURIComponent(sig));
  check('public fulfilled badge', pub3.json.fulfilled && pub3.json.badge && !('shippingNote' in pub3.json));

  // 8) payment is single-recipient (100%)
  const cfg = await req('GET', '/api/config');
  check('single receive', !!cfg.json.receive && (cfg.json.split?.[0] === 100 || !cfg.json.split || cfg.json.split[0] === 100), JSON.stringify({ receive: cfg.json.receive, split: cfg.json.split }));

  // 9) i18n keys present
  for (const lang of ['zh-CN', 'en', 'ar', 'ja']) {
    const d = await req('GET', '/i18n/' + lang + '.json');
    const ok = d.json['cat.material'] && d.json['fulfill.badge'] && d.json['fulfill.toast'] && d.json['wish.shipping'];
    check('i18n ' + lang, !!ok);
  }

  // 10) UI: material category + shipping field + no fund % in help
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'zh-CN' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/'); await page.waitForTimeout(2000);
  // login demo（邮箱演示登录：直接用 API 拿会话，避免依赖抽屉里的按钮）
  const tok = (await req('POST', '/api/login', { email: 'fulfill-verify@example.com' })).json.token;
  await page.evaluate(t => { localStorage.wt_token = t; localStorage.wt_terms = '1'; localStorage.gq_guide_dismissed = '1'; }, tok);
  await page.goto(BASE + '/#/wish'); await page.reload(); await page.waitForSelector('#mkbtn', { timeout: 60000 }); await page.click('#mkbtn'); await page.waitForSelector('#wc2', { timeout: 60000 });
  const cats = await page.$$eval('#wc2 option', opts => opts.map(o => o.value));
  check('UI 封面主题只有 经典 / 光栖 / 自定义（风景等隐藏，物质类仅旧卡兼容）', cats.join() === '经典,光栖,自定义', cats.join(','));
  await page.selectOption('#ckind', 'goods'); await page.waitForTimeout(200);
  check('shipping field shown for goods', await page.isVisible('#shipWrap'));
  await page.selectOption('#ckind', 'wish'); await page.waitForTimeout(200);
  check('shipping hidden for wish', await page.isHidden('#shipWrap'));

  await page.goto(BASE + '/#/help'); await page.waitForTimeout(400);
  const helpText = await page.textContent('#view');
  check('help silent on fund/LP/BPS', !/\u8fd8\u613f\u57fa\u91d1|FULFILL_FUND|LP 收益|2500/.test(helpText));

  // Seed fulfilled into UI via local sample path: inject S.fulfill and toast
  await page.goto(BASE + '/#/w/' + encodeURIComponent(sig)); await page.waitForTimeout(800);
  // May be notFound if not on-chain — that's ok; trigger toast via evaluate with fake wish
  const toastOk = await page.evaluate(async (wishSig) => {
    S.fulfill[wishSig] = { wishSig, status: 'fulfilled', fulfilled: true, badge: true, fulfillNote: '书已寄出', fulfillTs: Math.floor(Date.now()/1000) };
    const fake = { sig: wishSig, cat: '物质类', text: '想要一本好书', author: 'Demo', time: Date.now()/1000, paid: 1e7, likers: new Set(), blessings: [], likes: 0, heat: 0, fulfilled: { badge: true, note: '书已寄出' }, hue: 270 };
    S.fulfillToast = {}; // force show
    maybeFulfillToast(fake);
    await new Promise(r => setTimeout(r, 300));
    return (document.querySelector('#toasts')?.innerText || '').includes(t('fulfill.toast').replace(/\s*✨$/, ''));
  }, sig);
  check('surprise toast fires', toastOk);
  await page.screenshot({ path: 'shots/fulfill-toast.png' });

  await browser.close();

  console.log(fails.length ? 'FAIL ' + fails.length + ': ' + fails.join(', ') : 'ALL OK');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
