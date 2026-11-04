// Testy wspólnego menedżera modali: słownik, klauzula i okno potwierdzenia mają to samo zachowanie
// (blokada przewijania, fokus na starcie, pułapka fokusu, powrót fokusu).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer, baseUrl, generateSheet } from './helpers.mjs';

let server, browser, url;
before(async () => { server = await startServer(); browser = await chromium.launch(); url = baseUrl(server); });
after(async () => { await browser.close(); server.close(); });

const newPage = async () => {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept().catch(() => {}));
    return { ctx, page };
};
const locked = (p) => p.evaluate(() => document.documentElement.classList.contains('modal-is-open'));
const activeInside = (p, sel) => p.evaluate((s) => !!document.activeElement && !!document.activeElement.closest(s), sel);

async function tabCycle(p, sel, presses = 12) {
    for (let i = 0; i < presses; i++) {
        await p.keyboard.press('Tab');
        assert.equal(await activeInside(p, sel), true, `fokus uciekł z okna po ${i + 1}. naciśnięciu Tab`);
    }
    for (let i = 0; i < 3; i++) {
        await p.keyboard.press('Shift+Tab');
        assert.equal(await activeInside(p, sel), true, 'fokus uciekł z okna przy Shift+Tab');
    }
}

test('słownik: blokada przewijania, pułapka fokusu i powrót fokusu na przycisk', async () => {
    const { ctx, page: p } = await newPage();
    await p.goto(url);
    await p.focus('#btn-show-glossary');
    await p.click('#btn-show-glossary');
    await p.waitForSelector('#glossaryModal[open]');
    assert.equal(await locked(p), true);
    await tabCycle(p, '#glossaryModal');
    await p.keyboard.press('Escape');
    await p.waitForSelector('#glossaryModal:not([open])', { state: 'attached' });
    assert.equal(await locked(p), false, 'przewijanie odblokowane');
    assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.id), 'btn-show-glossary');
    await ctx.close();
});

test('klauzula: to samo zachowanie co słownik', async () => {
    const { ctx, page: p } = await newPage();
    await p.goto(url);
    await generateSheet(p);
    await p.evaluate(() => { let d = document.querySelector('.clause-tag').closest('details'); while (d) { d.open = true; d = d.parentElement && d.parentElement.closest('details'); } });
    const tag = p.locator('.clause-tag').first();
    const id = await tag.getAttribute('data-clause-id');
    await tag.click();
    await p.waitForSelector('#clauseModal[open]');
    assert.equal(await locked(p), true);
    await tabCycle(p, '#clauseModal');
    await p.click('#clauseCloseButton');
    await p.waitForSelector('#clauseModal:not([open])', { state: 'attached' });
    assert.equal(await locked(p), false);
    assert.equal(await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-clause-id')), id, 'fokus wraca na znacznik klauzuli');
    await ctx.close();
});

test('okno potwierdzenia: blokada przewijania, fokus startowy, pułapka, Esc i powrót fokusu', async () => {
    const { ctx, page: p } = await newPage();
    await p.goto(url);
    await p.focus('#btn-show-glossary');
    const ask = (focusOn) => p.evaluate((f) => { window.__r = undefined; window.utils.confirm('Na pewno?', 'Tytuł', 'Tak', 'Nie', f).then((r) => { window.__r = r; }); }, focusOn);

    await ask('confirm');
    await p.waitForSelector('#app-confirm-dialog[open]');
    assert.equal(await locked(p), true);
    assert.equal(await p.evaluate(() => document.activeElement.id), 'dialog-confirm', 'fokus na przycisku potwierdzenia');
    // czytnik ma usłyszeć pytanie, a nie tylko nazwę przycisku z fokusem: alertdialog z nazwą i opisem
    const sem = await p.evaluate(() => {
        const d = document.getElementById('app-confirm-dialog');
        const text = (attr) => (d.getAttribute(attr) || '').split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
        return { role: d.getAttribute('role'), name: text('aria-labelledby'), desc: text('aria-describedby') };
    });
    assert.deepEqual(sem, { role: 'alertdialog', name: 'Tytuł', desc: 'Na pewno?' });
    await tabCycle(p, '#app-confirm-dialog', 6);
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => window.__r !== undefined);
    assert.equal(await p.evaluate(() => window.__r), false);
    assert.equal(await locked(p), false);
    assert.equal(await p.evaluate(() => document.activeElement.id), 'btn-show-glossary', 'fokus wraca na element wywołujący');

    await ask('cancel');
    await p.waitForSelector('#app-confirm-dialog[open]');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'dialog-cancel', 'fokus na przycisku anulowania');
    await p.click('#dialog-confirm');
    await p.waitForFunction(() => window.__r !== undefined);
    assert.equal(await p.evaluate(() => window.__r), true);
    assert.equal(await locked(p), false);
    await ctx.close();
});

test('nie zostały martwe okna alert/prompt', async () => {
    const { ctx, page: p } = await newPage();
    await p.goto(url);
    assert.equal(await p.evaluate(() => typeof window.utils.alert), 'undefined');
    assert.equal(await p.evaluate(() => typeof window.utils.modal.open), 'function');
    await ctx.close();
});
