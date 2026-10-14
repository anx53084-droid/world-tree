#!/usr/bin/env node
/**
 * Fail if any i18n key used in the frontend is missing from any locale JSON.
 * Scans public/ .js and .html files (excluding vendor/ and the i18n loader).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public');
const I18N_DIR = path.join(ROOT, 'i18n');
const SKIP = new Set(['vendor', 'node_modules']);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|html)$/.test(name) && !(dir === I18N_DIR && name.endsWith('.js'))) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const blob = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');

const keys = new Set();
const reCall = /\b(?:E|t|I18N\.t)\(\s*['"]([a-zA-Z][a-zA-Z0-9_.]*)['"]/g;
const reAttr = /data-i18n(?:-title)?=["']([a-zA-Z][a-zA-Z0-9_.]*)["']/g;
let m;
while ((m = reCall.exec(blob))) keys.add(m[1]);
while ((m = reAttr.exec(blob))) keys.add(m[1]);

// Dynamic key families used in app.js
for (let i = 1; i <= 5; i++) keys.add(`rules.${i}`);
for (let i = 1; i <= 8; i++) if (i !== 2) keys.add(`terms.${i}`); // terms.2 unused (mod.notice in slot)
for (const s of ['green', 'bloom', 'fall']) keys.add(`season.${s}`);
// Drop false positives ending with bare prefix or underscore stubs
for (const k of [...keys]) if (k.endsWith('.') || k.endsWith('_')) keys.delete(k);

const locales = fs.readdirSync(I18N_DIR).filter(f => f.endsWith('.json')).sort();
if (!locales.length) { console.error('No locale JSON found'); process.exit(1); }

let failed = 0;
const report = [];
for (const file of locales) {
  const loc = file.replace(/\.json$/, '');
  const data = JSON.parse(fs.readFileSync(path.join(I18N_DIR, file), 'utf8'));
  const missing = [...keys].filter(k => !(k in data)).sort();
  if (missing.length) {
    failed = 1;
    report.push(`${loc}: missing ${missing.length}\n  - ${missing.join('\n  - ')}`);
  }
}

console.log(`Checked ${keys.size} keys × ${locales.length} locales`);
if (failed) {
  console.error('i18n check FAILED:\n' + report.join('\n'));
  process.exit(1);
}
console.log('i18n check OK');
