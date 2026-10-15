#!/usr/bin/env node
// 域名管理 CLI（一键换域）。环境变量：API_BASE（默认线上 API）、ADMIN_KEY（管理员密钥，仅从环境读取，不落盘）。
//   node scripts/domains.js list
//   node scripts/domains.js check                 # 对每个域名做健康检查（HEAD https://host/）
//   node scripts/domains.js add new.example.com [active|standby]
//   node scripts/domains.js primary new.example.com   # 一键设为主域（该域不能是 blocked）
//   node scripts/domains.js block old.example.com | standby host | remove host
//   node scripts/domains.js failover              # 主域不通 / 被标 blocked 时，自动切到健康的备用域
const API = (process.env.API_BASE || 'https://world-tree-ijv1.onrender.com').replace(/\/$/, ''), KEY = process.env.ADMIN_KEY || '';
const [cmd, host, extra] = process.argv.slice(2);
async function call(p, body) { const r = await fetch(API + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-admin-key': KEY }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error((j.code || j.error || r.status) + ''); return j; }
const show = j => { for (const d of j.domains) console.log((d.primary ? '★ ' : '  ') + d.host.padEnd(36) + d.status); console.log('updatedAt', new Date(j.updatedAt * 1000).toISOString()); };
(async () => { const need = () => { if (!host) throw new Error('missing host'); };
  if (cmd === 'list') return show(await call('/api/domains'));
  if (!KEY) throw new Error('ADMIN_KEY not set');
  if (cmd === 'check') { const j = await call('/api/admin/domains/check'); for (const c of j.checks) console.log((c.ok ? 'OK   ' : 'FAIL ') + c.host.padEnd(36) + c.status + ' ' + c.ms + 'ms' + (c.error ? ' ' + c.error : '')); return; }
  if (cmd === 'add') { need(); return show(await call('/api/admin/domains', { action: 'add', host, status: extra || 'standby' })); }
  if (cmd === 'primary') { need(); return show(await call('/api/admin/domains', { action: 'primary', host })); }
  if (cmd === 'block' || cmd === 'standby') { need(); return show(await call('/api/admin/domains', { action: 'status', host, status: cmd === 'block' ? 'blocked' : 'standby' })); }
  if (cmd === 'remove') { need(); return show(await call('/api/admin/domains', { action: 'remove', host })); }
  if (cmd === 'failover') { const j = await call('/api/admin/domains/failover', {}); console.log(j.changed ? `switched primary: ${j.from} -> ${j.to}` : 'primary is healthy, no change'); return show(j); }
  console.log('usage: node scripts/domains.js list|check|add|primary|block|standby|remove|failover [host]'); })().catch(e => { console.error('error:', e.message); process.exit(1); });
