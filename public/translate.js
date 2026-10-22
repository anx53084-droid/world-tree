/* t260：卡片用户内容自动翻译（仅显示，不改原文）。优先 Chrome 端侧 Translator API，其次服务端 /api/translate（免费提供方 + 缓存）。
   私密/加密卡、锁定卡、朋友代付隐藏文字不经过这里（调用方只对公开可见文字包 .ut）。 */
(() => {
  const LS = 'wt_autotr', MAXC = 400;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = k => (window.t ? window.t(k) : k), tl = () => window.I18N?.lang || 'en';
  const on = () => { try { return localStorage[LS] !== '0'; } catch { return true; } };
  const mem = new Map(); try { const o = JSON.parse(localStorage.wt_trc || '[]'); o.forEach(([k, v]) => mem.set(k, v)); } catch {}
  let saveT; const keep = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.wt_trc = JSON.stringify([...mem].slice(-MAXC)); } catch {} }, 800); };
  const orig = new Set(); // 用户选择「查看原文」的文本
  // 脚本启发式语言检测；拉丁文字返回 '' 交给 LanguageDetector / 服务端自动识别
  function detect(s) { if (/[\u3040-\u30ff]/.test(s)) return 'ja'; if (/[\uac00-\ud7af]/.test(s)) return 'ko'; if (/[\u4e00-\u9fff]/.test(s)) return /[們這說會為麼個來時見對書愛願樂與親學後過還]/.test(s) && !/[们这说会为么个来时见对书爱愿乐与亲学后过还]/.test(s) ? 'zh-TW' : 'zh-CN';
    if (/[\u0e00-\u0e7f]/.test(s)) return 'th'; if (/[\u0600-\u06ff]/.test(s)) return 'ar'; if (/[\u0900-\u097f]/.test(s)) return 'hi'; if (/[\u0400-\u04ff]/.test(s)) return 'ru'; if (!/\p{L}/u.test(s)) return 'none'; return ''; }
  const fam = l => (l || '').split('-')[0];
  const sameLang = (src, t) => src === 'none' || (src && (src === t || (fam(src) === fam(t) && fam(t) !== 'zh') || (fam(src) === 'zh' && fam(t) === 'zh'))); // 简繁互不翻译（同属中文读者可读）
  const CHL = l => l === 'zh-CN' ? 'zh' : l === 'zh-TW' ? 'zh-Hant' : l;
  let LD = null; const ldetect = s => TO(ldetect0(s), 1500).then(x => x || ''); async function ldetect0(s) { try { if (!self.LanguageDetector) return ''; if (!LD) { if ((await LanguageDetector.availability()) !== 'available') return ''; LD = await LanguageDetector.create(); }
    const r = (await LD.detect(s))[0]; return r && r.confidence > .6 ? r.detectedLanguage : ''; } catch { return ''; } }
  const TO = (pr, ms) => Promise.race([pr, new Promise(r => setTimeout(() => r(null), ms))]); // 端侧 API 偶尔挂起：超时即回退服务端
  const TR = new Map(); const chrome = (s, src, t) => TO(chrome0(s, src, t), 2500); async function chrome0(s, src, t) { try { if (!self.Translator || !src) return null; const k = src + '>' + t;
    if (!TR.has(k)) TR.set(k, (async () => (await Translator.availability({ sourceLanguage: CHL(src), targetLanguage: CHL(t) })) === 'available' ? Translator.create({ sourceLanguage: CHL(src), targetLanguage: CHL(t) }) : null)().catch(() => null));
    const tr = await TO(TR.get(k), 2000); if (!tr) { TR.set(k, Promise.resolve(null)); return null; } const out = await tr.translate(s); return out && out.trim() !== s.trim() ? out : null; } catch { return null; } }
  const W = { provider: '', stats: { chrome: 0, server: 0, cache: 0, fail: 0 } };
  let Q = [], flushT = null;
  function queue(el) { Q.push(el); clearTimeout(flushT); flushT = setTimeout(flush, 120); }
  async function flush() { const els = Q.splice(0), t = tl(), todo = new Map();
    for (const el of els) { if (!el.isConnected || el.dataset.uts) continue; const s = el.dataset.ut; const k = t + '|' + s; if (mem.has(k)) { W.stats.cache++; paint(el, mem.get(k)); continue; } (todo.get(s) || todo.set(s, []).get(s)).push(el); }
    const server = []; for (const [s, L] of todo) { let src = detect(s); if (!src) src = await ldetect(s); if (sameLang(src, t)) { mem.set(t + '|' + s, { same: 1 }); L.forEach(el => paint(el, { same: 1 })); continue; }
      const c = await chrome(s, src, t); if (c) { W.stats.chrome++; W.provider = 'chrome'; const v = { t: c }; mem.set(t + '|' + s, v); keep(); L.forEach(el => paint(el, v)); continue; }
      server.push([s, src, L]); }
    for (let i = 0; i < server.length; i += 20) { const part = server.slice(i, i + 20), bySrc = new Map(); part.forEach(x => (bySrc.get(x[1]) || bySrc.set(x[1], []).get(x[1])).push(x));
      for (const [src, P] of bySrc) { let j = null; try { const r = await fetch(window.apiUrl ? apiUrl('/api/translate') : '/api/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: t, source: src || undefined, texts: P.map(x => x[0]) }) }); j = r.ok ? await r.json() : null; } catch {}
        if (t !== tl()) return; P.forEach(([s, , L], n) => { const v = j?.items?.[n]; if (!v) { W.stats.fail++; L.forEach(el => el.dataset.uts = 'fail'); return; } W.stats.server++; W.provider ||= 'server'; mem.set(t + '|' + s, v.same ? { same: 1 } : { t: v.t }); keep(); L.forEach(el => paint(el, v.same ? { same: 1 } : { t: v.t })); }); } } }
  const BOX = '.card,.gq-inside,.sp-body,.fold-inbody,.cf-over,.gq-in,.qv-page,.hs-item,[data-utc]';
  function paint(el, v) { if (!el.isConnected) return; if (v.same || !v.t) { el.dataset.uts = 'same'; return; }
    el.dataset.uts = 'done'; el.dataset.utt = v.t; const show = !orig.has(el.dataset.ut); el.textContent = show ? v.t : el.dataset.ut; el.classList.toggle('ut-on', show);
    const box = el.closest(BOX) || el.parentElement; if (!box || box.querySelector(':scope .ut-ctl') || el.closest('.hs-item')) return;
    const c = document.createElement('span'); c.className = 'ut-ctl'; c.innerHTML = `<span class=ut-lbl>🌐 ${esc(T('tr.label'))}</span><button type=button class=ut-tg>${esc(T(show ? 'tr.showOrig' : 'tr.showTr'))}</button>`;
    (el.closest('p,blockquote,bdi,div') || el).insertAdjacentElement('afterend', c); }
  function toggle(btn) { const box = btn.closest(BOX) || btn.parentElement.parentElement, list = [...box.querySelectorAll('.ut[data-uts=done]')], toOrig = list.some(x => x.classList.contains('ut-on'));
    list.forEach(x => { if (toOrig) orig.add(x.dataset.ut); else orig.delete(x.dataset.ut); x.textContent = toOrig ? x.dataset.ut : x.dataset.utt; x.classList.toggle('ut-on', !toOrig); });
    btn.textContent = T(toOrig ? 'tr.showTr' : 'tr.showOrig'); box.querySelector('.ut-lbl')?.classList.toggle('off', toOrig); }
  document.addEventListener('click', e => { const b = e.target.closest?.('.ut-tg'); if (!b) return; e.preventDefault(); e.stopPropagation(); toggle(b); }, true);
  ['pointerdown', 'pointerup', 'touchstart'].forEach(ev => document.addEventListener(ev, e => { if (e.target.closest?.('.ut-tg')) e.stopPropagation(); }, true));
  const IO = 'IntersectionObserver' in self ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { IO.unobserve(e.target); queue(e.target); } }), { rootMargin: '200px' }) : null;
  function scan(root) { if (!on()) return; (root.querySelectorAll ? root : document).querySelectorAll('.ut:not([data-uts]):not([data-utq])').forEach(el => { el.dataset.utq = 1; IO ? IO.observe(el) : queue(el); }); }
  function reset() { document.querySelectorAll('.ut').forEach(el => { el.textContent = el.dataset.ut; delete el.dataset.uts; delete el.dataset.utq; el.classList.remove('ut-on'); IO?.unobserve(el); }); document.querySelectorAll('.ut-ctl').forEach(x => x.remove()); }
  let mT; new MutationObserver(() => { clearTimeout(mT); mT = setTimeout(() => scan(document), 60); }).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener('langchange', () => { reset(); scan(document); });
  W.on = on; W.set = v => { try { localStorage[LS] = v ? '1' : '0'; } catch {} reset(); if (v) scan(document); dispatchEvent(new Event('autotrchange')); };
  W.span = s => s ? `<span class=ut data-ut="${esc(s)}">${esc(s)}</span>` : '';
  W.sync = s => { if (!on() || orig.has(s)) return s; const v = mem.get(tl() + '|' + s); return v && v.t ? v.t : s; };
  W.scan = scan; W.detect = detect;
  window.WTTr = W;
})();
