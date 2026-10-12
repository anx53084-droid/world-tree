// 国际化：public/i18n/<lang>.json；用户愿望内容不翻译。首次访问按 navigator.language 自动检测，?lang= 优先，选择保存在 localStorage.wt_lang
(function () {
  const LANGS = { 'zh-CN': '简体中文', 'zh-TW': '繁體中文', en: 'English', ja: '日本語', ko: '한국어', es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português', ru: 'Русский', ar: 'العربية', hi: 'हिन्दी', id: 'Bahasa Indonesia', vi: 'Tiếng Việt', th: 'ไทย', tr: 'Türkçe' };
  const RTL = ['ar'], DEF = 'zh-CN';
  function match(l) { if (!l) return null; l = String(l).replace('_', '-'); if (LANGS[l]) return l; const low = l.toLowerCase();
    if (low.startsWith('zh')) return /tw|hk|mo|hant/.test(low) ? 'zh-TW' : 'zh-CN';
    const b = low.split('-')[0]; return LANGS[b] ? b : null; }
  function detect() { const q = new URLSearchParams(location.search).get('lang'); const fq = match(q); if (fq) { try { localStorage.wt_lang = fq; } catch {} return fq; }
    let s; try { s = match(localStorage.wt_lang); } catch {} if (s) return s;
    for (const l of (navigator.languages || [navigator.language])) { const m = match(l); if (m) return m; } return DEF; }
  const I = window.I18N = { LANGS, lang: detect(), dict: {}, base: {}, missing: new Set() };
  I.isZh = () => I.lang.startsWith('zh');
  I.locale = () => I.lang;
  I.t = function (k, v) { let s = I.dict[k]; if (s == null) { I.missing.add(k); s = I.base[k]; if (s == null) s = k; }
    return v ? s.replace(/\{(\w+)\}/g, (m, n) => v[n] != null ? v[n] : m) : s; };
  window.t = I.t;
  const load = l => fetch('i18n/' + l + '.json').then(r => { if (!r.ok) throw new Error(l); return r.json(); });
  I.apply = function () { const h = document.documentElement; h.lang = I.lang; h.dir = RTL.includes(I.lang) ? 'rtl' : 'ltr'; document.title = I.t('meta.title');
    document.querySelectorAll('[data-i18n]').forEach(e => e.textContent = I.t(e.dataset.i18n));
    document.querySelectorAll('[data-i18n-title]').forEach(e => { e.title = I.t(e.dataset.i18nTitle); e.setAttribute('aria-label', e.title); });
    renderSwitcher(); };
  function renderSwitcher() { const box = document.getElementById('lang'); if (!box) return;
    box.innerHTML = `<button type=button id=langbtn aria-haspopup=listbox aria-expanded=false title="${I.t('lang.label')}" aria-label="${I.t('lang.label')}"><svg width=16 height=16 viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=2 aria-hidden=true><circle cx=12 cy=12 r=10 /><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg><span class=lang-cur>${LANGS[I.lang]}</span></button>
      <ul id=langmenu role=listbox hidden>${Object.entries(LANGS).map(([k, n]) => `<li role=option data-lang="${k}" lang="${k}" dir="${RTL.includes(k) ? 'rtl' : 'ltr'}" aria-selected="${k === I.lang}" tabindex=0>${n}</li>`).join('')}</ul>`;
    const btn = box.querySelector('#langbtn'), menu = box.querySelector('#langmenu');
    btn.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', !menu.hidden); };
    menu.onclick = e => { const li = e.target.closest('[data-lang]'); if (li) I.set(li.dataset.lang); };
    menu.onkeydown = e => { if (e.key === 'Enter') { const li = e.target.closest('[data-lang]'); if (li) I.set(li.dataset.lang); } if (e.key === 'Escape') menu.hidden = true; };
  }
  document.addEventListener('click', e => { const m = document.getElementById('langmenu'); if (m && !m.hidden && !e.target.closest('#lang')) m.hidden = true; });
  I.set = async function (l) { l = match(l) || DEF; try { localStorage.wt_lang = l; } catch {} if (l === I.lang) { renderSwitcher(); return; }
    try { I.dict = await load(l); I.lang = l; } catch { return; }
    const u = new URL(location.href); if (u.searchParams.has('lang')) { u.searchParams.set('lang', l); history.replaceState(null, '', u); }
    I.missing.clear(); I.apply(); dispatchEvent(new Event('langchange')); };
  I.ready = Promise.all([load(DEF), I.lang === DEF ? null : load(I.lang).catch(() => { I.lang = DEF; return null; })])
    .then(([b, d]) => { I.base = b; I.dict = d || b; I.apply(); }).catch(e => console.warn('i18n load failed', e));
})();
