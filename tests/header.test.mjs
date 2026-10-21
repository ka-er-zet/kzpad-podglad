// Nagłówek aplikacji na telefonie (uwagi 5 i 10): na wąskim, wysokim ekranie przyklejony, chowa się przy
// przewijaniu w dół i wraca po wyraźnym przewinięciu w górę; przy małej wysokości ekranu nieprzyklejony.
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
const hidden = (p) => p.evaluate(() => document.querySelector('.app-header').classList.contains('header-hidden'));
const position = (p) => p.evaluate(() => getComputedStyle(document.querySelector('.app-header')).position);
const reserved = (p) => p.evaluate(() => parseInt(document.documentElement.style.getPropertyValue('--app-header-height'), 10));

test('telefon w pionie: nagłówek przyklejony, chowa się w dół, wraca po wyraźnym przewinięciu w górę', async () => {
    const { ctx, p } = await open({ width: 390, height: 844 });
    assert.equal(await position(p), 'sticky');
    assert.ok(await reserved(p) > 0, 'rezerwa miejsca na nagłówek przy przewijaniu do fokusu');
    await scrollTo(p, 1500);
    await scrollTo(p, 1600);
    assert.equal(await hidden(p), true, 'schowany po przewinięciu w dół');
    await scrollTo(p, 1580); // drobny ruch w górę (np. przy czytaniu palcem)
    assert.equal(await hidden(p), true, 'mały ruch w górę nie pokazuje nagłówka');
    await scrollTo(p, 1530);
    assert.equal(await hidden(p), false, 'wraca po wyraźnym przewinięciu w górę');
    await p.waitForTimeout(400); // animacja wysuwania
    assert.equal(await p.evaluate(() => { const r = document.querySelector('.app-header').getBoundingClientRect(); return r.top >= 0 && r.height > 0; }), true, 'widoczny u góry ekranu');
    await ctx.close();
});

test('fokus w schowanym nagłówku pokazuje nagłówek', async () => {
    const { ctx, p } = await open({ width: 390, height: 844 });
    await scrollTo(p, 1500); await scrollTo(p, 1600);
    assert.equal(await hidden(p), true);
    await p.focus('#btn-save-wizard');
    assert.equal(await hidden(p), false);
    await ctx.close();
});

test('mała wysokość ekranu (telefon poziomo / duże powiększenie): nagłówek nieprzyklejony, bez rezerwy', async () => {
    const { ctx, p } = await open({ width: 844, height: 390 });
    assert.equal(await position(p), 'relative');
    assert.equal(await reserved(p), 0);
    await scrollTo(p, 1500); await scrollTo(p, 1600);
    assert.equal(await hidden(p), false);
    await ctx.close();
});

test('komputer: zachowanie bez zmian (przyklejony, chowa się i wraca)', async () => {
    const { ctx, p } = await open({ width: 1280, height: 900 });
    assert.equal(await position(p), 'sticky');
    await scrollTo(p, 1500); await scrollTo(p, 1600);
    assert.equal(await hidden(p), true);
    await scrollTo(p, 1500);
    assert.equal(await hidden(p), false);
    await ctx.close();
});
