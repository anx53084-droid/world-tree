// 域名清单 / 一键换域验证：清单规则、动态 CORS（增删域名无需重启）、管理端点鉴权、故障转移、前端跳转决策与开放重定向防护、迁移参数白名单、中间件不写死域名。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert');
process.env.DOMAINS_ENSURE = ''; // 其余用例假定干净的默认种子；DOMAINS_ENSURE 在末尾单独测
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); }; const throws = (f, code, m) => { let c = null; try { f(); } catch (e) { c = e.code; } ok(c === code, m); };
console.log('domains list'); const tmpd = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-dom-')); fs.mkdirSync(path.join(tmpd, 'data')); for (const f of ['domains.js', 'network.js']) fs.copyFileSync(path.join(__dirname, f), path.join(tmpd, f));
const Dm = require(path.join(tmpd, 'domains.js'));
let L = Dm.list(); ok(L.domains.length === 1 && L.domains[0].host === 'world-tree.pages.dev' && L.domains[0].primary && L.domains[0].status === 'active', '默认种子：world-tree.pages.dev 为主域 active');
Dm.add('B.Example.com', 'standby'); Dm.add('https://c.example.com/', 'active'); L = Dm.list(); ok(L.domains.map(d => d.host).join() === 'world-tree.pages.dev,b.example.com,c.example.com' && L.updatedAt > 0, '增加域名：小写、去协议与斜杠，主域排最前');
throws(() => Dm.add('b.example.com'), 'exists', '重复添加被拒绝'); for (const bad of ['', 'localhost', '1.2.3.4', 'a.com:8080', 'a.com/x', 'user@a.com', 'a b.com', '-a.com']) throws(() => Dm.add(bad), 'host', '非法域名被拒绝：' + JSON.stringify(bad));
throws(() => Dm.add('d.example.com', 'bogus'), 'status', '非法状态被拒绝');
Dm.setStatus('c.example.com', 'blocked'); throws(() => Dm.setPrimary('c.example.com'), 'blocked', 'blocked 域不能设为主域');
Dm.setPrimary('b.example.com'); L = Dm.list(); ok(L.domains[0].host === 'b.example.com' && L.domains[0].primary && L.domains[0].status === 'active' && L.domains.filter(d => d.primary).length === 1, '设为主域：唯一主域，standby → active');
throws(() => Dm.setStatus('b.example.com', 'blocked'), 'primary', '主域不能直接标 blocked（先换主域）'); throws(() => Dm.remove('b.example.com'), 'primary', '主域不能删除');
Dm.remove('c.example.com'); ok(!Dm.list().domains.some(d => d.host === 'c.example.com'), '删除非主域');
throws(() => Dm.setStatus('nope.example.com', 'blocked'), 'nf', '不存在的域名 → nf');
console.log('failover'); ok(Dm.failover(() => true).changed === false, '主域健康：不切换');
let r = Dm.failover(h => h !== 'b.example.com'); ok(r.changed && r.from === 'b.example.com' && r.to === 'world-tree.pages.dev' && r.domains.find(d => d.host === 'b.example.com').status === 'blocked', '主域不通：旧主域标 blocked，切到健康的备用域');
throws(() => Dm.failover(() => false), 'none', '没有健康的备用域 → none');
console.log('cors'); ok(Dm.originOk('https://world-tree.pages.dev') && Dm.originOk('https://abc.world-tree.pages.dev') && Dm.originOk('https://b.example.com'), '清单内域名（含 blocked）及 pages.dev 预览域允许');
ok(!Dm.originOk('https://evil.example.com') && !Dm.originOk('http://b.example.com') && !Dm.originOk('https://b.example.com:8443') && !Dm.originOk('https://b.example.com.evil.com') && !Dm.originOk('null') && !Dm.originOk(''), '清单外 / http / 带端口 / 后缀欺骗 / null 一律拒绝');
Dm.reset(); ok(Dm.list().domains.length === 2, '持久化：重新加载后清单保留'); const pr = Dm.probe('x.example.com', async () => { throw new Error('boom'); });
(async () => {
  ok((await pr).ok === false, '健康检查：连接失败 → ok:false'); ok((await Dm.probe('a.example.com', async () => ({ status: 200 }))).ok === true && (await Dm.probe('a.example.com', async () => ({ status: 503 }))).ok === false, '健康检查：2xx 可用，5xx 不可用');
  // ---- 前端决策 ----
  console.log('frontend'); const F = require('./public/domains.js'); const dl = [{ host: 'main.example.com', status: 'active', primary: true }, { host: 'alt.example.com', status: 'standby', primary: false }, { host: 'old.example.com', status: 'blocked', primary: false }, { host: 'bak.example.com', status: 'active', primary: false }];
  ok(F.decide('main.example.com', dl).action === 'none', '当前就是主域：无提示'); ok(F.decide('alt.example.com', dl).action === 'suggest' && F.decide('alt.example.com', dl).target === 'main.example.com', '非主域（standby）：提示并可一键前往主域');
  ok(F.decide('old.example.com', dl).action === 'redirect' && F.decide('old.example.com', dl).target === 'main.example.com', 'blocked：自动跳转到主域'); ok(F.decide('localhost', dl).action === 'none' && F.decide('pr-1.pages.dev', dl).action === 'none', '未收录的域（本地 / 预览）：不处理');
  ok(F.decide('old.example.com', [{ host: 'old.example.com', status: 'blocked', primary: true }]).action === 'none', 'blocked 且没有可用目标：不跳转');
  ok(F.decide('old.example.com', [{ host: 'main.example.com', status: 'blocked', primary: true }, { host: 'old.example.com', status: 'blocked', primary: false }, { host: 'bak.example.com', status: 'active', primary: false }]).target === 'bak.example.com', '主域也异常：退而选其它 active 域');
  console.log('open-redirect'); ok(F.safeTarget('main.example.com', dl) === 'main.example.com' && F.safeTarget('old.example.com', dl) === null && F.safeTarget('evil.com', dl) === null, '目标必须在清单内且非 blocked');
  for (const bad of ['main.example.com@evil.com', 'evil.com/main.example.com', '//evil.com', 'javascript:alert(1)', 'main.example.com:99', 'main.example.com.evil.com', '']) ok(F.safeTarget(bad, dl) === null, '拒绝：' + JSON.stringify(bad));
  const u = new URL(F.buildUrl('main.example.com', { lang: 'ja', hash: '#/w/ABC?i=3', settings: { wt_lang: 'ja', wt_terms: '1' }, from: 'old.example.com' })); ok(u.host === 'main.example.com' && u.protocol === 'https:' && u.searchParams.get('lang') === 'ja' && u.hash === '#/w/ABC?i=3' && u.searchParams.get('_from') === 'old.example.com', '跳转地址：https + 目标域 + ?lang + 保留路由 hash');
  const store = { s: {}, getItem(k) { return k in this.s ? this.s[k] : null; }, setItem(k, v) { this.s[k] = v; } };
  console.log('settings carry'); const src = Object.create(store); src.s = { wt_lang: 'ja', wt_terms: '1', wt_token: 'SECRET-TOKEN', wt_wallet: 'phantom', wt_hist: '[1]', wt_chain: '8453', wt_total: 'javascript:1<>' };
  const col = F.collect(src); ok(col.wt_lang === 'ja' && col.wt_terms === '1' && col.wt_chain === '8453' && !('wt_token' in col) && !('wt_wallet' in col) && !('wt_hist' in col) && !('wt_total' in col), '只带白名单内的非敏感设置；会话 / 钱包 / 历史 / 非法值不带');
  const dst = Object.create(store); dst.s = {}; const mig = new URL(F.buildUrl('main.example.com', { settings: Object.assign({ wt_token: 'X', wt_evil: '1', wt_lang: 'ja' }, {}), from: 'old.example.com' })); const imp = F.importMig(mig.search, dst);
  ok(imp.from === 'old.example.com' && dst.s.wt_lang === 'ja' && !('wt_token' in dst.s) && !('wt_evil' in dst.s), '导入：只写白名单键；伪造的 wt_token 等被忽略');
  ok(F.importMig('?_mig=%%%bad', dst) !== undefined && F.importMig('', dst) === null, '损坏的 _mig 不抛错');
  ok(JSON.stringify(F.fallback({ domains: ['a.example.com', 'b.example.com'] })) === JSON.stringify([{ host: 'a.example.com', status: 'active', primary: true }, { host: 'b.example.com', status: 'active', primary: false }]) && F.fallback({})[0].host === 'world-tree.pages.dev', '内置默认清单：构建变量 WT_DOMAINS，缺省为 world-tree.pages.dev');
  ok(F.clean([{ host: 'ok.example.com', status: 'active' }, { host: 'bad host', status: 'active' }, { host: 'x.example.com', status: 'weird' }]).length === 1 && F.clean('x') === null, '清单清洗：丢弃非法项');
  // ---- 中间件 / 构建 ----
  console.log('static'); const mw = fs.readFileSync(path.join(__dirname, 'functions/_middleware.js'), 'utf8'); ok(/ORIGIN = url\.origin/.test(mw) && !/const [A-Z_]*ORIGIN = 'https:\/\/world-tree/.test(mw.replace('DEFAULT_ORIGIN', 'X')) && /link\[rel="canonical"\]/.test(mw), '中间件：og / canonical 用当前请求域名，不写死');
  const app = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8'); ok(!/'https:\/\/world-tree\.pages\.dev\/'/.test(app) && !/`https:\/\/world-tree\.pages\.dev\//.test(app), '前端 SEO：canonical / og 用 location.origin');
  const wf = fs.readFileSync(path.join(__dirname, '.github/workflows/pages.yml'), 'utf8'); ok(/WT_EXTRA_PAGES_PROJECTS/.test(wf) && /skipping/.test(wf) && /exit 0/.test(wf), '工作流：未配置额外 Pages 项目时跳过，不报错');
  // ---- 后端接口（临时数据目录 + 真实服务进程）----
  console.log('backend'); const D = __dirname, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-domsrv-')), port = 18866, B = 'http://127.0.0.1:' + port;
  for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f)); fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data');
  const srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, ADMIN_KEY: 'k-test', D1_API_TOKEN: '' }, stdio: 'ignore' });
  try { for (let i = 0; i < 80; i++) { try { await fetch(B + '/api/nonce'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    const call = async (p, body, h = {}, method) => { const x = await fetch(B + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined }); return { s: x.status, j: await x.json().catch(() => ({})), h: x.headers }; }, adm = { 'x-admin-key': 'k-test' };
    let g = await call('/api/domains'); ok(g.s === 200 && g.j.domains[0].host === 'world-tree.pages.dev' && g.j.domains[0].primary && typeof g.j.updatedAt === 'number' && g.h.get('access-control-allow-origin') === '*', 'GET /api/domains 公开可读：{domains:[{host,status,primary}], updatedAt}');
    ok(Object.keys(g.j.domains[0]).sort().join() === 'host,primary,status', '公开清单只含 host / status / primary（不含备注等内部字段）');
    ok((await call('/api/admin/domains', { action: 'add', host: 'new.example.com' })).s === 403 && (await call('/api/admin/domains', { action: 'add', host: 'new.example.com' }, { 'x-admin-key': 'wrong' })).s === 403 && (await call('/api/admin/domains')).s === 403, '管理端点无 / 错误 ADMIN_KEY → 403');
    const pre = async o => (await fetch(B + '/api/domains', { method: 'OPTIONS', headers: { origin: o, 'access-control-request-method': 'GET' } })).headers.get('access-control-allow-origin'), acao = async o => (await fetch(B + '/api/ads?page=1', { headers: { origin: o } })).headers.get('access-control-allow-origin');
    ok(await acao('https://new.example.com') === null, '新域名加入前：API 不放行其 Origin');
    r = await call('/api/admin/domains', { action: 'add', host: 'new.example.com', status: 'standby' }, adm); ok(r.s === 200 && r.j.domains.some(d => d.host === 'new.example.com' && d.status === 'standby'), '管理端：增加域名');
    ok(await acao('https://new.example.com') === 'https://new.example.com', '无需重启 / 重新部署：新域名立即进入 CORS 白名单'); ok(await acao('https://evil.example.org') === null, '清单外 Origin 仍被拒绝');
    r = await call('/api/admin/domains', { action: 'primary', host: 'new.example.com' }, adm); ok(r.s === 200 && r.j.domains[0].host === 'new.example.com' && r.j.domains[0].primary, '管理端：设为主域');
    r = await call('/api/admin/domains', { action: 'status', host: 'world-tree.pages.dev', status: 'blocked' }, adm); ok(r.s === 200 && r.j.domains.find(d => d.host === 'world-tree.pages.dev').status === 'blocked', '管理端：旧域标 blocked');
    ok(await acao('https://world-tree.pages.dev') === 'https://world-tree.pages.dev', 'blocked 域仍可调用 API（旧域用户要能拉到换域提示）');
    g = await call('/api/domains'); ok(g.j.domains.find(d => d.primary).host === 'new.example.com' && g.j.domains.find(d => d.host === 'world-tree.pages.dev').status === 'blocked', '公开清单立即反映切换结果');
    ok((await call('/api/admin/domains', { action: 'primary', host: 'world-tree.pages.dev' }, adm)).s === 400, 'blocked 域不能设为主域（400）'); ok((await call('/api/admin/domains', { action: 'remove', host: 'new.example.com' }, adm)).s === 400, '主域不能删除（400）');
    ok((await call('/api/admin/domains', { action: 'add', host: 'bad host' }, adm)).s === 400 && (await call('/api/admin/domains', { action: 'zzz', host: 'x.example.com' }, adm)).s === 400, '非法域名 / 未知操作 → 400');
    r = await call('/api/admin/domains', { action: 'remove', host: 'world-tree.pages.dev' }, adm); ok(r.s === 200 && !r.j.domains.some(d => d.host === 'world-tree.pages.dev'), '管理端：删除域名');
    const raw = JSON.parse(fs.readFileSync(tmp + '/data/domains.json', 'utf8')); ok(raw.domains['new.example.com'].primary === true && !raw.domains['world-tree.pages.dev'], '清单已落盘 data/domains.json（persist.js 同步 D1）');
    ok(/domains\.json/.test(fs.readFileSync(path.join(__dirname, 'persist.js'), 'utf8')), 'persist.js 已纳入 domains.json');
  } finally { srv.kill(); }
  { console.log('ensure'); const td = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-ens-')); fs.mkdirSync(td + '/data'); for (const f of ['domains.js', 'network.js']) fs.copyFileSync(path.join(__dirname, f), td + '/' + f);
    fs.writeFileSync(td + '/data/domains.json', JSON.stringify({ domains: { 'old.example.com': { status: 'active', primary: true, note: '', at: 1 }, 'guangqi.world': { status: 'blocked', primary: false, note: '', at: 1 } }, updatedAt: 1 }));
    const r = cp.spawnSync('node', ['-e', "const D=require('./domains.js');console.log(JSON.stringify(D.list().domains));console.log(D.originOk('https://guangqi.world'),D.originOk('https://www.guangqi.world'),D.originOk('https://evil-guangqi.world'))"], { cwd: td, env: { ...process.env, DOMAINS_ENSURE: 'guangqi.world,www.guangqi.world' }, encoding: 'utf8' });
    const [l1, l2] = r.stdout.trim().split('\n'), L2 = JSON.parse(l1);
    ok(L2.find(d => d.host === 'old.example.com').primary && L2.find(d => d.host === 'www.guangqi.world').status === 'standby' && !L2.find(d => d.host === 'www.guangqi.world').primary, 'DOMAINS_ENSURE：补齐缺失域名为 standby，不动主域');
    ok(L2.find(d => d.host === 'guangqi.world').status === 'blocked', 'DOMAINS_ENSURE：已存在的域名状态不被覆盖'); ok(l2 === 'true true false', '补齐后 CORS 立即允许 guangqi.world / www，且不放过相似域名'); }
  console.log(`\n✅ ${n} checks passed`); process.exit(0);
})().catch(e => { console.error('\n❌', e.message); process.exit(1); });
