// 账户头卡：头像 / 昵称接口验证（POST /api/me/profile、GET /api/me）。会话鉴权、只能改自己的、钱包签名登录账户与邮箱账户都按 uid 保存、昵称清洗 / 长度 / 链接 / 黑名单 / 审核、头像只接受已审核入库的图片、限速；前端头卡与图标静态检查。
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert'), nacl = require('tweetnacl'), bs58 = require('bs58');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✓', m); };
(async () => {
  const D = __dirname, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-prof-')), port = 18961, B = 'http://127.0.0.1:' + port;
  for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f)); fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public'); fs.mkdirSync(tmp + '/data');
  const stub = require('http').createServer((q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ pass: true, nsfw: false, scores: {} })); }).listen(18962);
  const srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, D1_API_TOKEN: '', PRICE_MOCK: '1', NSFW_URL: 'http://127.0.0.1:18962/', R2_ACCOUNT_ID: '' }, stdio: 'ignore' });
  const call = async (p, body, h = {}) => { const x = await fetch(B + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await x.json(); } catch {} return { s: x.status, j }; };
  try { for (let i = 0; i < 80; i++) { try { await fetch(B + '/api/nonce'); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    const A = (await call('/api/login', { email: 'a@test.dev' })).j, O = (await call('/api/login', { email: 'o@test.dev' })).j, tk = u => ({ authorization: 'Bearer ' + u.token });
    console.log('auth');
    ok((await call('/api/me/profile', { name: 'x' })).s === 401, '未登录不能改资料（401）'); ok((await call('/api/me/profile', { name: 'x' }, { authorization: 'Bearer bogus' })).s === 401, '伪造 token 被拒（401）');
    console.log('name');
    let r = await call('/api/me/profile', { name: '  星愿\u200b  小树\n ' }, tk(A)); ok(r.s === 200 && r.j.profile.name === '星愿 小树', '昵称清洗：去零宽 / 合并空白 / 去首尾空白');
    ok((await call('/api/me', null, tk(A))).j.profile.name === '星愿 小树', 'GET /api/me 返回已保存的昵称（换设备也能读到）'); ok((await call('/api/me', null, tk(O))).j.profile.name === '', '只改了自己的：其他账户不受影响');
    ok((await call('/api/me/profile', { name: '一'.repeat(21) }, tk(A))).j.code === 'nameLen', '超过 20 字被拒（nameLen）'); ok((await call('/api/me/profile', { name: '一'.repeat(20) }, tk(A))).s === 200, '20 字可保存');
    ok((await call('/api/me/profile', { name: 'visit https://x.io' }, tk(A))).j.code === 'nameLink', '昵称不能带链接（nameLink）');
    ok((await call('/api/me/profile', { name: '加微信 稳赚' }, tk(A))).j.code === 'reject', '敏感词走现有内容审核（reject）');
    console.log('avatar');
    ok((await call('/api/me/profile', { avatar: 'https://evil.example/a.png' }, tk(A))).j.code === 'avatar', '头像只能是平台图片哈希（外链被拒）'); ok((await call('/api/me/profile', { avatar: '0'.repeat(32) }, tk(A))).j.code === 'avatar', '未入库的哈希被拒');
    const sharp = require('sharp'), img = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#c9a24a' } }).webp({ quality: 80 }).toBuffer();
    const up = await call('/api/img', { mime: 'image/webp', data: img.toString('base64') }); ok(up.s === 200 && /^[0-9a-f]{32}$/.test(up.j.hash), '头像先走现有 /api/img（类型 / 魔数 / 尺寸 / NSFW 审核）');
    r = await call('/api/me/profile', { avatar: up.j.hash }, tk(A)); ok(r.s === 200 && r.j.profile.avatar === up.j.hash && r.j.profile.name === '一'.repeat(20), '保存头像；只传 avatar 时昵称保持不变');
    ok((await call('/api/me/profile', { avatar: '' }, tk(A))).j.profile.avatar === '', '可清除头像（恢复默认）');
    const raw = JSON.parse(fs.readFileSync(tmp + '/data/users.json', 'utf8')); ok(raw.users['a@test.dev'].profile.name === '一'.repeat(20) && !raw.users['o@test.dev'].profile, '按账户 uid 落盘 users.json（persist.js 同步 D1）');
    console.log('wallet');
    const kp = nacl.sign.keyPair(), addr = bs58.encode(kp.publicKey), nonce = (await call('/api/nonce')).j.nonce, host = '127.0.0.1:' + port;
    const msg = `${host} wants you to sign in with your Solana account:\n${addr}\n\nSign in to World Tree. This request will not trigger a transaction or cost any fees.\n\nURI: http://${host}\nVersion: 1\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
    const W = (await call('/api/login/wallet', { message: msg, signature: bs58.encode(nacl.sign.detached(Buffer.from(msg), kp.secretKey)) })).j; ok(!!W.token, '钱包签名登录拿到会话');
    r = await call('/api/me/profile', { name: 'Holder' }, tk(W)); ok(r.s === 200 && (await call('/api/me', null, tk(W))).j.profile.name === 'Holder' && (await call('/api/me', null, tk(W))).j.uid === 'sol:' + addr, '钱包账户按 sol:<地址> 保存资料');
    console.log('rate'); let last = 0; for (let i = 0; i < 25; i++) last = (await call('/api/me/profile', { name: 'n' + i }, tk(O))).s; ok(last === 429, '每账户每小时最多 20 次（429）');
    console.log('static');
    const app = fs.readFileSync(path.join(D, 'public/app.js'), 'utf8'), html = fs.readFileSync(path.join(D, 'public/index.html'), 'utf8');
    ok(/id="acard"/.test(html) && !/data-i18n="nav.account"/.test(html) && /id="mode"/.test(html), '抽屉顶部有账户头卡；底部旧「账户」区已删除，账户信息并入头卡下方');
    const mh = html.slice(html.indexOf('id="menu"')); ok(['list', 'treehole', 'gift', 'me', 'inbox', 'notify', 'security', 'help', 'terms'].every(k => new RegExp('<a href="#/' + k + '"[^>]*><svg').test(mh)) && /href="#\/gift"[^>]*>.*?data-i18n="gift.page"/.test(mh) && /<nav id="topnav"[^\n]*data-i18n="nav.list"/.test(html), '抽屉菜单项有内联 SVG 图标；文字仍是「礼品卡」；顶栏导航不变');
    ok(/function wishLevel/.test(app) && /S\.wishes/.test(app.slice(app.indexOf('function wishLevel'), app.indexOf('function wishLevel') + 400)), '等级由真实卡片数据计算（不写死）');
    const zh = JSON.parse(fs.readFileSync(path.join(D, 'public/i18n/zh-CN.json'), 'utf8')); ok(!Object.entries(zh).some(([k, v]) => /^acct\./.test(k) && /还愿|收益|代付/.test(v)), '新文案不含「还愿 / 收益 / 代付」');
  } finally { srv.kill(); stub.close(); }
  console.log(`\n✅ ${n} checks passed`); process.exit(0);
})().catch(e => { console.error('\n❌', e.message); process.exit(1); });
