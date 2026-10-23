// t276：免费心愿独立存储 + 持久化每日限额 + 容量守护（本地 D1 REST 模拟：python sqlite）
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const D = __dirname, wait = ms => new Promise(r => setTimeout(r, ms)); let ok = 0, bad = 0; const chk = (c, m) => { c ? ok++ : bad++; console.log((c ? '✅ ' : '❌ ') + m); };
const MOCK = `import sqlite3,json,sys,os
from http.server import BaseHTTPRequestHandler,HTTPServer
db=sqlite3.connect(sys.argv[2],isolation_level=None,check_same_thread=False)
class H(BaseHTTPRequestHandler):
  def log_message(s,*a): pass
  def do_POST(s):
    b=json.loads(s.rfile.read(int(s.headers['content-length'])))
    try:
      c=db.execute(b['sql'],b.get('params',[])); cols=[d[0] for d in c.description or []]; rows=[dict(zip(cols,r)) for r in c.fetchall()]
      sz=int(open(sys.argv[3]).read() or 0) if os.path.exists(sys.argv[3]) else 0
      out={'success':True,'result':[{'results':rows,'meta':{'size_after':sz or os.path.getsize(sys.argv[2])}}]}
    except Exception as e: out={'success':False,'errors':[str(e)]}
    d=json.dumps(out).encode(); s.send_response(200); s.send_header('content-type','application/json'); s.end_headers(); s.wfile.write(d)
HTTPServer(('127.0.0.1',int(sys.argv[1])),H).serve_forever()`;
(async () => { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-276-')), port = 18976, mp = 18977, B = 'http://127.0.0.1:' + port;
  fs.writeFileSync(tmp + '/mock.py', MOCK); const mock = cp.spawn('python3', [tmp + '/mock.py', mp, tmp + '/d1.sqlite', tmp + '/size'], { stdio: 'inherit' });
  for (const f of fs.readdirSync(D)) if (/\.(js|json)$/.test(f) && !/^verify/.test(f) && f !== 'package-lock.json') fs.copyFileSync(path.join(D, f), path.join(tmp, f));
  fs.symlinkSync(D + '/node_modules', tmp + '/node_modules'); fs.symlinkSync(D + '/public', tmp + '/public');
  let srv; const start = async (env = {}) => { srv = cp.spawn('node', ['server.js'], { cwd: tmp, env: { ...process.env, PORT: port, D1_API_TOKEN: 'test', D1_ACCOUNT_ID: 'x', D1_DATABASE_ID: 'x', D1_API_URL: 'http://127.0.0.1:' + mp, OPENAI_API_KEY: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.log = ''; srv.stdout.on('data', d => srv.log += d); srv.stderr.on('data', d => srv.log += d);
    for (let i = 0; i < 120; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await wait(250); } await wait(800); };
  const stop = async () => { srv.kill('SIGTERM'); await new Promise(r => srv.on('exit', r)); };
  const J = async (u, o = {}) => { const r = await fetch(B + u, o); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  const free = async (ip, text, dev) => { const h = { 'x-forwarded-for': ip, 'cf-connecting-ip': ip, 'content-type': 'application/json' }; const c = (await J('/api/free/challenge', { headers: h })).j; const [a, b] = c.q.match(/\d+/g).map(Number);
    return J('/api/free', { method: 'POST', headers: h, body: JSON.stringify({ text, cat: '经典', cid: c.cid, ans: a + b, dev }) }); };
  await start(); chk(/free wishes: D1 table/.test(srv.log), 'free store uses D1 table');
  const r = []; for (let i = 0; i < 2; i++) r.push((await free('10.1.1.1', 'Hope my garden blooms ' + i)).s);
  chk(r.join() === '200,429', `per-IP 1/day: ${r}`);
  const id = (await free('10.1.1.2', 'May the stars be kind')).j.id; chk(/^OF_/.test(id || ''), 'another IP can write');
  const off = (await J('/api/offchain')).j; chk(off.free.length === 2 && off.free[0].id === id, `home list from memory: ${off.free.length} newest-first`);
  chk((await J('/api/og-meta/' + id)).j.text === 'May the stars be kind', 'og-meta reads free wish');
  const d1 = (await J('/api/health')).j.free; chk(d1.total === 2, `health shows total ${d1.total}`);
  await stop(); await start();
  chk((await free('10.1.1.1', 'after restart')).s === 429, 'per-IP counter survives restart (persisted in D1)');
  chk((await free('10.1.1.3', 'x', 'devA')).s === 200 && (await free('10.1.1.4', 'y', 'devA')).s === 429, 'per-device 1/day across IPs');
  chk((await J('/api/offchain')).j.free.length === 3 && (await J('/api/og-meta/' + id)).s === 200, 'wishes persist across restart, old id still readable');
  await stop(); await start({ FREE_DAY_CAP: '5', FREE_MEM_N: '3' });
  chk((await free('10.2.0.1', 'eight')).s === 200 && (await free('10.2.0.2', 'nine')).s === 200 && (await free('10.2.0.3', 'ten')).s === 429, 'global day cap env-configurable (5)');
  chk((await J('/api/offchain')).j.free.length === 3 && (await J('/api/og-meta/' + id)).s === 200, 'FREE_MEM_N=3: only 3 in memory, older still fetched from D1');
  chk((await J('/api/health')).j.free.total === 5, 'no auto-delete (5 kept)');
  fs.writeFileSync(tmp + '/size', String(4.95e9)); await J('/api/og-meta/' + id); await wait(300);
  chk((await free('10.3.0.1', 'full')).s === 429 && (await J('/api/health')).j.free.paused, 'D1 ≥4.9GB → new free wishes paused, no crash');
  chk(/ADMIN: D1 size 4\.\d\dGB/.test(srv.log), 'admin warning logged (≥4.5GB)');
  await stop(); mock.kill(); console.log(`\n${ok} pass, ${bad} fail`); process.exit(bad ? 1 : 0); })().catch(e => { console.error(e); process.exit(1); });
