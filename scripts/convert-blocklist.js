#!/usr/bin/env node
// 钓鱼 / 短链黑名单合并：多来源 → public/blocklist.json（排序输出，便于小 diff）
// 用法：node scripts/convert-blocklist.js [--sources scripts/blocklist/sources.json] [--whitelist scripts/blocklist/whitelist.json] [--out public/blocklist.json] [--force]
const fs = require('fs'), path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = path.join(__dirname, '..'), R = p => path.resolve(ROOT, p);
const SRC = R(arg('--sources', 'scripts/blocklist/sources.json')), WL = R(arg('--whitelist', 'scripts/blocklist/whitelist.json')), OUT = R(arg('--out', 'public/blocklist.json')), FORCE = process.argv.includes('--force');
const SHORTENERS = ['bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'cutt.ly', 'rebrand.ly', 'short.io', 'tiny.cc', 'lnkd.in', 'is.gd', 'v.gd', 'goo.gl', 'ow.ly', 'buff.ly', 't.ly', 'rb.gy', 'shorturl.at', 'tiny.one', 'bl.ink', 'soo.gd', 's.id', 'shorte.st', 'adf.ly', 'bc.vc', 'clck.ru', 'qr.ae', 'trib.al', 'dlvr.it', 'url.cn', 't.cn', 'dwz.cn', 'suo.im', 'kutt.it', 'y2u.be', 'shrtco.de', 'surl.li', 'lnk.to', 'linktr.ee', 'han.gl', 'me2.do', 'urlz.fr', 'git.io'];
const BAD_TLD = /(^|\.)(localhost|local|test|example|invalid|internal|lan|home|arpa)$/;
// 域名规范化：去协议/路径/端口/www，转小写；不合法返回 null
function normDomain(s) { if (typeof s !== 'string') return null; let d = s.trim().toLowerCase(); if (!d || d.startsWith('#')) return null;
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^\*\./, '').split(/[\/?#\s]/)[0].replace(/:\d+$/, '').replace(/^www\d*\./, '').replace(/\.$/, '');
  if (d.length < 4 || d.length > 253 || !d.includes('.') || !/^[a-z0-9.-]+$/.test(d) || /\.\.|^[.-]|[.-]$/.test(d) || /^\d+(\.\d+){3}$/.test(d) || BAD_TLD.test(d)) return null;
  if (d.split('.').some(l => !l || l.length > 63 || /^-|-$/.test(l))) return null; return d; }
const normAddr = s => typeof s === 'string' && (/^0x[0-9a-fA-F]{40}$/.test(s.trim()) ? s.trim().toLowerCase() : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim()) ? s.trim() : null) || null;
const normSig = s => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(s.trim()) ? s.trim() : null;
async function read(src) { if (src.file) { const p = R(src.file); if (!fs.existsSync(p)) { if (src.optional) return null; throw new Error('missing ' + src.file); } return fs.readFileSync(p, 'utf8'); }
  for (let i = 0; i < 3; i++) { try { const r = await fetch(src.url, { headers: { 'user-agent': 'world-tree-blocklist/1' }, signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); } catch (e) { if (i === 2) throw e; await new Promise(z => setTimeout(z, 2000 * (i + 1))); } } }
function parse(fmt, txt) { switch (fmt) {
  case 'metamask': { const j = JSON.parse(txt); return j.blacklist || j.blocklist || []; } // eth-phishing-detect config.json
  case 'json-array': { const j = JSON.parse(txt); return Array.isArray(j) ? j : Array.isArray(j.domains) ? j.domains : Object.keys(j); }
  case 'text': case 'hosts': return txt.split(/\r?\n/).map(l => l.replace(/#.*/, '').trim()).filter(Boolean).map(l => l.split(/\s+/).pop()); // 兼容 hosts 格式 "0.0.0.0 domain"
  default: throw new Error('unknown format ' + fmt); } }
(async () => {
  const sources = JSON.parse(fs.readFileSync(SRC, 'utf8')), wl = new Set((fs.existsSync(WL) ? JSON.parse(fs.readFileSync(WL, 'utf8')) : []).map(normDomain).filter(Boolean));
  const isWl = d => { for (let x = d; x; x = x.includes('.') ? x.slice(x.indexOf('.') + 1) : '') { if (wl.has(x)) return true; if (!x.includes('.')) break; } return false; };
  const sets = { domains: new Set(), shorteners: new Set(), sigs: new Set(), addresses: new Set() }, used = [], N = { domains: normDomain, shorteners: normDomain, sigs: normSig, addresses: normAddr };
  for (const s of sources) { let txt; try { txt = await read(s); } catch (e) { console.error(`✗ ${s.name}: ${e.message}`); if (!s.optional) process.exitCode = 2; continue; } if (txt == null) continue;
    const raw = parse(s.format, txt), t = s.target || 'domains'; let n = 0; for (const x of raw) { const v = N[t](x); if (v && !(t === 'domains' && isWl(v))) { sets[t].add(v); n++; } }
    used.push({ name: s.name, url: s.url || s.file, format: s.format, target: t, count: n }); console.log(`✓ ${s.name}: ${raw.length} raw → ${n} kept`); }
  if (process.exitCode === 2) { console.error('a required source failed; not writing'); process.exit(2); }
  for (const d of SHORTENERS) { const v = normDomain(d); if (v) { sets.shorteners.add(v); sets.domains.delete(v); } }
  const out = { version: 1, updatedAt: new Date().toISOString(), sources: used, domains: [...sets.domains].sort(), shorteners: [...sets.shorteners].sort(), sigs: [...sets.sigs].sort(), addresses: [...sets.addresses].sort() };
  let prev = null; try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
  const size = o => (o.domains?.length || 0) + (o.addresses?.length || 0);
  if (prev && !FORCE && size(out) < size(prev) * 0.5) { console.error(`✗ result shrank >50% (${size(prev)} → ${size(out)}); refusing to write (use --force)`); process.exit(3); }
  const same = prev && ['domains', 'shorteners', 'sigs', 'addresses'].every(k => JSON.stringify(prev[k] || []) === JSON.stringify(out[k])) && JSON.stringify((prev.sources || []).map(s => s.name)) === JSON.stringify(used.map(s => s.name));
  if (same) { console.log('no change'); return; } // 内容不变则不改 updatedAt，避免无意义提交
  // 每个元素一行：git diff 只显示增删的域名
  const body = '{\n' + ['version', 'updatedAt', 'sources'].map(k => `"${k}": ${JSON.stringify(out[k])}`).join(',\n') + ',\n' + ['domains', 'shorteners', 'sigs', 'addresses'].map(k => `"${k}": [${out[k].length ? '\n' + out[k].map(x => JSON.stringify(x)).join(',\n') + '\n' : ''}]`).join(',\n') + '\n}\n';
  fs.writeFileSync(OUT, body);
  // 前端常驻的小文件：短链 + 地址 + 签名（完整域名表按需懒加载）
  const core = { version: 1, updatedAt: out.updatedAt, domainsCount: out.domains.length, shorteners: out.shorteners, sigs: out.sigs, addresses: out.addresses };
  fs.writeFileSync(OUT.replace(/\.json$/, '-core.json'), JSON.stringify(core) + '\n'); console.log(`wrote ${path.relative(ROOT, OUT)}: domains=${out.domains.length} shorteners=${out.shorteners.length} addresses=${out.addresses.length} sigs=${out.sigs.length} (${(body.length / 1048576).toFixed(2)} MB)`);
})().catch(e => { console.error(e); process.exit(1); });
module.exports = { normDomain };
