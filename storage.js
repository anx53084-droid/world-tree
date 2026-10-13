// 图片存储适配器：配置 R2_* 环境变量时写入 Cloudflare R2（S3 兼容，手写 SigV4，无额外依赖），否则回退本地磁盘 data/img（Render 免费实例上为临时存储）
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const E = process.env, R2 = E.R2_ACCOUNT_ID && E.R2_ACCESS_KEY_ID && E.R2_SECRET_ACCESS_KEY && E.R2_BUCKET;
const DIR = path.join(__dirname, 'data', 'img'); fs.mkdirSync(DIR, { recursive: true });
const H = (d, enc = 'hex') => crypto.createHash('sha256').update(d).digest(enc), HM = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
async function s3(method, key, body, ctype) {
  const host = `${E.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, p = `/${E.R2_BUCKET}/${encodeURIComponent(key)}`, now = new Date().toISOString().replace(/[-:]|\.\d{3}/g, ''), day = now.slice(0, 8);
  const ph = H(body || ''), hd = { host, 'x-amz-content-sha256': ph, 'x-amz-date': now, ...(ctype ? { 'content-type': ctype } : {}) }, names = Object.keys(hd).sort();
  const creq = [method, p, '', names.map(n => `${n}:${hd[n]}\n`).join(''), names.join(';'), ph].join('\n'), scope = `${day}/auto/s3/aws4_request`;
  const sts = ['AWS4-HMAC-SHA256', now, scope, H(creq)].join('\n'), k = HM(HM(HM(HM('AWS4' + E.R2_SECRET_ACCESS_KEY, day), 'auto'), 's3'), 'aws4_request');
  hd.authorization = `AWS4-HMAC-SHA256 Credential=${E.R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${names.join(';')}, Signature=${crypto.createHmac('sha256', k).update(sts).digest('hex')}`; delete hd.host;
  const r = await fetch(`https://${host}${p}`, { method, headers: hd, body, signal: AbortSignal.timeout(15000) }); if (r.status === 404) return null; if (!r.ok) throw new Error(`R2 ${method} ${r.status}`); return r; }
module.exports = {
  kind: R2 ? 'r2' : 'disk', publicUrl: R2 && E.R2_PUBLIC_URL ? E.R2_PUBLIC_URL.replace(/\/$/, '') : null,
  async put(h, buf, meta) { if (R2) { await s3('PUT', h, buf, meta.mime); await s3('PUT', h + '.json', Buffer.from(JSON.stringify(meta)), 'application/json'); return; }
    fs.writeFileSync(path.join(DIR, h), buf); fs.writeFileSync(path.join(DIR, h + '.json'), JSON.stringify(meta)); },
  async get(h) { if (R2) { const r = await s3('GET', h); if (!r) return null; return { data: Buffer.from(await r.arrayBuffer()), mime: r.headers.get('content-type') || 'application/octet-stream' }; }
    try { return { data: fs.readFileSync(path.join(DIR, h)), mime: JSON.parse(fs.readFileSync(path.join(DIR, h + '.json'))).mime }; } catch { return null; } },
  async del(h) { if (R2) { await s3('DELETE', h); await s3('DELETE', h + '.json'); return; } for (const f of [h, h + '.json']) fs.rmSync(path.join(DIR, f), { force: true }); },
  async has(h) { if (R2) return !!(await s3('HEAD', h)); return fs.existsSync(path.join(DIR, h)); } };
