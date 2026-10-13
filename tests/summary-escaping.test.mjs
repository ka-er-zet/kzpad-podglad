// Tekst wpisany przez użytkownika (komentarze, nazwa produktu) musi trafić do raportu jako tekst,
// a nie zostać zinterpretowany jako HTML.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer, baseUrl, generateSheet, fillAssessments } from './helpers.mjs';

let server, browser, url;
before(async () => { server = await startServer(); browser = await chromium.launch(); url = baseUrl(server); });
after(async () => { await browser.close(); server.close(); });

test('znaczniki HTML w komentarzach i nazwie produktu są widoczne w podsumowaniu jako tekst', async () => {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(url);
    const name = 'Prod <u>X</u> *a* _b_ $& <img src=x onerror="window.__pwned=1">';
    await generateSheet(p, { name });
    await fillAssessments(p);
    const evil = '<img src=x onerror="window.__pwned=2"><b>pogrubienie</b> & <script>window.__pwned=3</script>';
    await p.evaluate((evil) => {
        document.querySelectorAll('textarea[name^="comment-"], textarea[name^="test-comment-"]').forEach((ta) => {
            if (!ta.value) return;
            ta.value = evil;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }, evil);
    await p.evaluate(() => generateDescriptiveSummary());
    await p.waitForSelector('#summary-display-area .summary-result-card');
    await p.waitForTimeout(300);

    const result = await p.evaluate(() => {
        const area = document.querySelector('#summary-display-area');
        return {
            injected: area.querySelectorAll('img, b, u, script, em').length,
            pwned: window.__pwned,
            text: area.textContent,
            comments: [...area.querySelectorAll('.summary-item-comment')].map((e) => e.textContent),
        };
    });
    assert.equal(result.pwned, undefined, 'kod z komentarza nie może się wykonać');
    assert.equal(result.injected, 0, 'w podsumowaniu nie mogą pojawić się elementy z wpisanego tekstu');
    assert.ok(result.comments.length > 0, 'są komentarze do sprawdzenia');
    for (const c of result.comments) assert.ok(c.includes('<b>pogrubienie</b>'), 'komentarz widoczny dosłownie: ' + c);
    assert.ok(result.text.includes('<u>X</u> *a* _b_ $&'), 'nazwa produktu widoczna dosłownie');
    assert.ok(!/&amp;|&lt;|&gt;|&nbsp;/.test(result.text), 'bez widocznych encji HTML');
    assert.deepEqual(errors, []);
    await ctx.close();
});
