// Art. 22 (usługi wsparcia) w podsumowaniu: obowiązek podmiotu gospodarczego (art. 43 ustawy), nie wymaganie dostępności.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer, baseUrl, generateSheet } from './helpers.mjs';

let server, browser, url;
before(async () => { server = await startServer(); browser = await chromium.launch(); url = baseUrl(server); });
after(async () => { await browser.close(); server.close(); });

test('podsumowanie: Art. 22 w sekcji obowiązków, Art. 7–21 w sekcji wymagań dostępności', async () => {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const p = await ctx.newPage();
    await p.goto(url);
    await generateSheet(p);
    // Ocena wymagań z Art. 22 i z Art. 7 (jak użytkownik — kliknięcie „Spełnione”)
    const rated = await p.evaluate(() => {
        const out = {};
        for (const row of document.querySelectorAll('.requirement-row')) {
            const id = row.querySelector('.requirement-id')?.textContent || '';
            const m = id.match(/Art\.?\s*(\d+)/);
            const n = m ? Number(m[1]) : 0;
            if ((n === 22 || n === 7) && !out[n]) {
                [...row.querySelectorAll('input[type="radio"][name^="status-"]')].find((x) => x.value === 'compliant').click();
                out[n] = true;
            }
        }
        return out;
    });
    assert.ok(rated[22], 'wybrany profil ma wymaganie z Art. 22');
    assert.ok(rated[7], 'wybrany profil ma wymaganie z Art. 7');
    await p.evaluate(() => generateDescriptiveSummary(false, true));
    await p.waitForSelector('.summary-sections');
    const placed = await p.evaluate(() => {
        const out = { headers: [], art22: null, art7: null };
        let current = '';
        for (const el of document.querySelectorAll('.summary-sections .summary-category-header, .summary-sections .summary-anchor')) {
            if (el.matches('.summary-category-header')) { current = el.textContent.trim(); out.headers.push(current); continue; }
            const m = el.textContent.match(/Art\.?\s*(\d+)/);
            const n = m ? Number(m[1]) : 0;
            if (n === 22 && !out.art22) out.art22 = current;
            if (n === 7 && !out.art7) out.art7 = current;
        }
        return out;
    });
    assert.deepEqual(placed.headers, ['Wymagania dostępności (Art. 7–21)', 'Obowiązki informacyjne (Art. 22, 23, 24, 26, 32, 33)']);
    assert.equal(placed.art22, 'Obowiązki informacyjne (Art. 22, 23, 24, 26, 32, 33)');
    assert.equal(placed.art7, 'Wymagania dostępności (Art. 7–21)');
    await ctx.close();
});
