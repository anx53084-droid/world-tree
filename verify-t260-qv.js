const { chromium } = require('playwright');
(async () => { const br = await chromium.launch(); for (const L of ['ja','en']) { const p = await br.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await p.addInitScript(() => { try { localStorage.gq_guide_dismissed = '1'; } catch {} });
 await p.goto(`https://guangqi.world/?lang=${L}#/`); await p.waitForFunction(() => window.__S?.wishes?.length, null, { timeout: 60000 });
 await p.waitForTimeout(1500); await p.evaluate(() => document.querySelectorAll('[aria-label*=lose], .sheet-x, .ob-x, button.x').forEach(b => b.offsetParent && b.click())); await p.waitForTimeout(500); await p.evaluate(() => { const w = __S.wishes.find(w => !w.priv && /[\u4e00-\u9fff]/.test(w.text)); openCardPopup(w, 1); });
 await p.waitForTimeout(1200); await p.getByText(L === 'ja' ? '内ページ' : 'Inside', { exact: true }).first().click(); await p.waitForTimeout(2500);
 for (let i = 0; i < 0; i++) { const h = await p.$('.ut[data-uts=done]:visible'); if (h) break; await p.evaluate(() => document.querySelector('.qv-next,[class*=qv] [aria-label*=ext],[class*=qv-nav] button:last-child')?.click()); await p.waitForTimeout(2500); }
 const r = await p.evaluate(() => { const e = [...document.querySelectorAll('.ut[data-uts=done]')].find(x => x.offsetParent); return e ? [e.textContent.slice(0,30), e.closest('[class*=qv],[id*=modal]')?.className] : null; });
 console.log(L, JSON.stringify(r)); await p.screenshot({ path: `shots/t260-live-${L}-quickview.png` });
 if (r) { await p.evaluate(() => [...document.querySelectorAll('.ut-tg')].find(x => x.offsetParent).click()); await p.waitForTimeout(400); await p.screenshot({ path: `shots/t260-live-${L}-qv-original.png` }); console.log(await p.evaluate(() => [...document.querySelectorAll('.ut[data-uts=done]')].find(x => x.offsetParent).textContent.slice(0,30))); }
 await p.close(); } await br.close(); })();
