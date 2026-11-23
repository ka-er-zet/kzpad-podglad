// Nagłówek aplikacji (uwagi 5 i 10, potem panel nawigacji). Od wprowadzenia panelu nagłówek się nie chowa:
// na telefonie w pionie jest niski i stale przyklejony (z przyciskiem „Menu”), przy małej wysokości ekranu
// nieprzyklejony, a od 768 px szerokości jego rolę przejmuje panel nawigacji / listwa ikon.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer, baseUrl, generateSheet } from './helpers.mjs';

let server, browser, url;
before(async () => { server = await startServer(); browser = await chromium.launch(); url = baseUrl(server); });
after(async () => { await browser.close(); server.close(); });

async function open(viewport) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport });
    const p = await ctx.newPage();
    await p.goto(url);
    await generateSheet(p);
    return { ctx, p };
}
const scrollTo = async (p, y) => { await p.evaluate((y) => window.scrollTo(0, y), y); await p.waitForTimeout(120); };
const position = (p) => p.evaluate(() => getComputedStyle(document.querySelector('.app-header')).position);
const reserved = (p) => p.evaluate(() => parseInt(document.documentElement.style.getPropertyValue('--app-header-height'), 10));
const onScreen = (p) => p.evaluate(() => { const r = document.querySelector('.app-header').getBoundingClientRect(); return r.top >= 0 && r.height > 0; });

test('telefon w pionie: nagłówek przyklejony i stale widoczny, z rezerwą miejsca dla fokusu', async () => {
    const { ctx, p } = await open({ width: 390, height: 844 });
    assert.equal(await position(p), 'sticky');
    assert.ok(await reserved(p) > 0, 'rezerwa miejsca na nagłówek przy przewijaniu do fokusu (WCAG 2.4.11)');
    await scrollTo(p, 1500);
    await scrollTo(p, 1600);
    assert.equal(await onScreen(p), true, 'po przewinięciu w dół nagłówek zostaje u góry ekranu');
    assert.equal(await p.locator('.np-menu-btn').isVisible(), true, 'przycisk „Menu” dostępny w każdym miejscu arkusza');
    assert.equal(await p.locator('.app-header').evaluate((h) => h.classList.contains('header-hidden')), false);
    await ctx.close();
});

test('mała wysokość ekranu (telefon poziomo / duże powiększenie): nagłówek nieprzyklejony, bez rezerwy', async () => {
    const { ctx, p } = await open({ width: 844, height: 390 });
    assert.equal(await position(p), 'relative');
    assert.equal(await reserved(p), 0);
    await ctx.close();
});

test('od 768 px: nagłówek nad treścią nie zajmuje miejsca (logo, słownik i motyw są w panelu lub na listwie)', async () => {
    for (const viewport of [{ width: 1000, height: 800 }, { width: 1440, height: 900 }]) {
        const { ctx, p } = await open(viewport);
        await p.waitForTimeout(200);
        assert.equal(await p.locator('.app-header .header-content').isVisible(), false, `${viewport.width}: bez widocznego nagłówka`);
        assert.equal(await reserved(p), 0, `${viewport.width}: bez rezerwy na nagłówek`);
        assert.equal(await p.locator('.np-menu-btn').isVisible(), false);
        // „Pomiń nawigację” zostaje i pojawia się przy fokusie
        await p.goto(url);
        await p.waitForSelector('#np-panel', { state: 'attached' });
        await p.keyboard.press('Tab');
        assert.equal(await p.evaluate(() => document.activeElement.id), 'skip-link');
        assert.equal(await p.locator('#skip-link').isVisible(), true, `${viewport.width}: „Pomiń nawigację” widoczny przy fokusie`);
        await ctx.close();
    }
});
