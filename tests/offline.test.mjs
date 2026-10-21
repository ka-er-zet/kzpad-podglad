// Praca offline (uwaga 6 PFRON): po pierwszym wejściu online aplikacja ma się uruchomić bez sieci
// i pozwolić wygenerować nowy arkusz. Test używa prawdziwego Service Workera.
// Uwaga: context.setOffline() w Playwright NIE odcina sieci Service Workerowi (żądania SW nadal
// trafiają do serwera), więc „brak sieci” symulujemy wyłączeniem serwera.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer, baseUrl, generateSheet } from './helpers.mjs';

let browser;
after(async () => { if (browser) await browser.close(); });

function stop(server) {
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
}

async function installOnline() {
    browser = browser || await chromium.launch();
    const server = await startServer();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const logs = [];
    page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
    page.on('pageerror', (e) => logs.push(String(e)));
    await page.goto(baseUrl(server));
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
    await page.waitForSelector('input[name="product_choice"]', { state: 'attached' });
    return { server, ctx, page, logs };
}

test('bez sieci (po pierwszym wejściu online) aplikacja startuje i pozwala wygenerować arkusz', async () => {
    const { server, ctx, page, logs } = await installOnline();
    await stop(server);
    logs.length = 0;
    try {
    await page.reload();
    try {
        await page.waitForFunction(() => document.querySelectorAll('input[name="product_choice"]').length > 0, null, { timeout: 8000 });
    } catch (e) { /* asercja niżej */ }
    const n = await page.locator('input[name="product_choice"]').count();
    assert.ok(n > 0, `offline: lista profili pusta. Błędy: ${logs.join(' | ')}`);
    await generateSheet(page);
    assert.ok(await page.locator('.requirement-row').count() > 0, 'offline: arkusz wygenerowany');
    } finally { await ctx.close(); }
});

test('kolejne wejścia online nie dokładają do pamięci podręcznej kopii plików danych', async () => {
    const { server, ctx, page } = await installOnline();
    try {
    for (let i = 0; i < 3; i++) { await page.reload(); await page.waitForSelector('input[name="product_choice"]', { state: 'attached' }); }
    await page.waitForTimeout(500);
    const jsonEntries = await page.evaluate(async () => {
        let n = 0;
        for (const name of await caches.keys()) {
            const c = await caches.open(name);
            n += (await c.keys()).filter((r) => r.url.includes('/clauses_json/')).length;
        }
        return n;
    });
    assert.ok(jsonEntries <= 4, `w pamięci podręcznej ${jsonEntries} wpisów plików z clauses_json (oczekiwane ≤ 4)`);
    } finally { await ctx.close(); await stop(server); }
});
