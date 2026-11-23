// Testy panelu nawigacji (js/nav-panel.js): zawartość, widoki i historia przeglądarki, skrót Alt+M,
// panel wysuwany na węższym ekranie, bieżące miejsce w spisie, podsumowanie, układ bez poziomego przewijania.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer, baseUrl, generateSheet, fillAssessments, goTo } from './helpers.mjs';

let server, browser, url;
before(async () => { server = await startServer(); browser = await chromium.launch(); url = baseUrl(server); });
after(async () => { await browser.close(); server.close(); });

const WIDE = { width: 1440, height: 900 };     // panel obok treści (≥ 1360 px)
const NARROW = { width: 1100, height: 760 };   // panel wysuwany nad treścią
const newPage = async (viewport = WIDE) => {
    const ctx = await browser.newContext({ viewport, acceptDownloads: true, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message));
    return p;
};
const view = (p) => p.evaluate(() => document.body.dataset.npView);
const active = (p) => p.evaluate(() => {
    const a = document.activeElement;
    return { id: a.id, inPanel: !!a.closest('#np-panel'), text: (a.textContent || '').replace(/\s+/g, ' ').trim() };
});

test('panel: obszar nawigacji z opcjami głównymi; arkusz z postępem jak w podsumowaniu', async () => {
    const p = await newPage();
    await p.goto(url);
    const nav = p.getByRole('navigation', { name: 'Nawigacja aplikacji' });
    await nav.waitFor();
    for (const name of ['Widok startowy', 'Nowy arkusz oceny', 'Wczytaj zapisany stan (JSON)', 'Przeglądarka wymagań']) {
        assert.equal(await nav.getByRole('button', { name }).count(), 1, name);
    }
    assert.equal(await p.locator('#np-panel [data-group="sheet"]').count(), 0, 'bez arkusza nie ma grupy „Arkusz oceny”');
    assert.equal(await p.locator('#np-panel [data-act="home"]').getAttribute('aria-current'), 'page');

    await generateSheet(p);
    await fillAssessments(p);
    await p.locator('#np-panel [data-group="sheet"]').waitFor();
    const r = await p.evaluate(() => {
        const s = getAssessmentSummaryData();
        return { text: document.getElementById('np-progress-text').textContent, done: s.totalCount - s.untestedCount, total: s.totalCount };
    });
    assert.match(r.text, new RegExp(`^${r.done}/${r.total}`), 'postęp w panelu = liczby z podsumowania');
    assert.deepEqual(p.errors, []);
    await p.context().close();
});

test('widoki mają adresy; Wstecz i Dalej przełączają widok, tytuł i fokus', async () => {
    const p = await newPage();
    await p.goto(url);
    await p.waitForSelector('#np-panel', { state: 'attached' });
    assert.equal(await view(p), 'start');
    assert.match(p.url(), /#start$/);
    await generateSheet(p);
    await p.waitForFunction(() => document.body.dataset.npView === 'sheet');
    assert.match(p.url(), /#arkusz$/);
    assert.match(await p.title(), /^Arkusz oceny/);

    await p.goBack();
    await p.waitForFunction(() => document.body.dataset.npView === 'new');
    assert.match(p.url(), /#nowy-arkusz$/);
    assert.equal((await active(p)).id, 'setup-title', 'fokus na nagłówku widoku');
    await p.goBack();
    await p.waitForFunction(() => document.body.dataset.npView === 'start');
    assert.equal((await active(p)).id, 'hero-title');
    await p.goForward();
    await p.goForward();
    await p.waitForFunction(() => document.body.dataset.npView === 'sheet');
    assert.equal((await active(p)).id, 'selectedProductName');
    assert.equal(await p.locator('#wizard-product-name').isVisible(), false, 'w widoku arkusza nie ma formularza kreatora');
    assert.deepEqual(p.errors, []);
    await p.context().close();
});

test('Alt+M: z treści do bieżącego miejsca w panelu, ponownie — zwija panel i wraca do pola', async () => {
    const p = await newPage();
    await p.goto(url);
    await generateSheet(p);
    await fillAssessments(p);
    const ta = p.locator('.requirement-row').nth(12).locator('textarea[name^="comment-"]');
    await ta.scrollIntoViewIfNeeded();
    await ta.focus();
    const fieldId = await ta.getAttribute('id');

    await p.keyboard.press('Alt+KeyM');
    await p.waitForTimeout(100);
    let a = await active(p);
    assert.equal(a.inPanel, true, 'fokus w panelu');
    assert.equal(await p.evaluate(() => document.activeElement.getAttribute('aria-current')), 'location', 'na bieżącym miejscu');

    await p.keyboard.press('Alt+KeyM');
    await p.waitForTimeout(350);   // animacja zwijania 0,25 s
    assert.equal((await active(p)).id, fieldId, 'powrót do pola');
    assert.equal(await p.evaluate(() => document.body.classList.contains('np-open')), false, 'panel zwinięty');
    assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('np-panel')).visibility), 'hidden', 'zwinięty panel niedostępny dla fokusu');

    await p.keyboard.press('Alt+KeyM');
    await p.waitForTimeout(100);
    assert.equal(await p.evaluate(() => document.body.classList.contains('np-open')), true, 'panel rozwinięty');
    await p.keyboard.press('Escape');
    assert.equal((await active(p)).id, fieldId, 'Esc wraca do pola');
    assert.equal(await p.evaluate(() => document.body.classList.contains('np-open')), true, 'Esc nie zwija panelu');
    assert.deepEqual(p.errors, []);
    await p.context().close();
});

test('węższy ekran: panel wysuwany jako okno — fokus w panelu, treść nieaktywna, Esc zamyka i wraca', async () => {
    const p = await newPage(NARROW);
    await p.goto(url);
    await p.waitForSelector('#np-panel', { state: 'attached' });
    assert.equal(await p.evaluate(() => document.body.classList.contains('np-open')), false, 'domyślnie zamknięty');
    await p.click('.np-menu-btn');
    await p.waitForTimeout(100);
    assert.equal(await p.evaluate(() => document.activeElement.classList.contains('np-close')), true, 'fokus na „Zamknij menu”');
    assert.equal(await p.evaluate(() => document.getElementById('main-content').inert), true, 'treść nieaktywna');
    assert.equal(await p.locator('.np-menu-btn').getAttribute('aria-expanded'), 'true');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(100);
    assert.equal(await p.evaluate(() => document.activeElement.classList.contains('np-menu-btn')), true, 'fokus wraca na „Menu”');
    assert.equal(await p.evaluate(() => document.getElementById('main-content').inert), false);
    assert.deepEqual(p.errors, []);
    await p.context().close();
});

test('spis arkusza: skok do sekcji oznacza ją jako bieżące miejsce', async () => {
    const p = await newPage();
    await p.goto(url);
    await generateSheet(p);
    const links = p.locator('#np-panel .np-sec-link');
    const n = await links.count();
    assert.ok(n >= 3, 'są sekcje w spisie');
    // sekcje ze środka arkusza (przy ostatniej sekcji strona dochodzi do końca i bieżące jest podsumowanie)
    for (const i of [2, 1]) {
        const name = (await links.nth(i).locator('.np-sec-name').textContent()).trim();
        await links.nth(i).click();
        await p.waitForTimeout(300);
        const cur = await p.evaluate(() => {
            const c = document.querySelector('#np-panel [aria-current="location"] .np-sec-name');
            return c && c.textContent.trim();
        });
        assert.equal(cur, name, `bieżąca sekcja po skoku: ${name}`);
    }
    assert.deepEqual(p.errors, []);
    await p.context().close();
});

test('podsumowanie: „Generuj” zmienia się w „Aktualizuj”, pobranie ODT dopiero po wygenerowaniu', async () => {
    const p = await newPage();
    await p.goto(url);
    await generateSheet(p);
    const item = p.locator('#np-panel [data-act="summary"]');
    await item.waitFor();
    assert.equal((await item.textContent()).trim(), 'Generuj podsumowanie');
    assert.equal(await p.locator('#np-panel [data-act="sum-odt"]').isVisible(), false);
    await item.click();
    await p.waitForTimeout(300);
    assert.equal((await item.textContent()).trim(), 'Aktualizuj podsumowanie');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#np-panel [data-act="sum-odt"]')]);
    assert.match(dl.suggestedFilename(), /\.odt$/);
    assert.deepEqual(p.errors, []);
    await p.context().close();
});

test('kopia robocza w panelu prowadzi do jej pozycji na liście w widoku startowym', async () => {
    const p = await newPage();
    await p.goto(url);
    await generateSheet(p, { name: 'Kopia z panelu' });
    await fillAssessments(p);
    await p.evaluate(() => Session.flush());
    const toggle = p.locator('#np-panel [data-group="drafts"] .np-group-toggle');
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'kopie robocze domyślnie zwinięte');
    await toggle.click();
    await p.click('#np-panel [data-draft-index="0"]');
    await p.waitForTimeout(400);
    assert.equal(await view(p), 'start');
    const r = await p.evaluate(() => ({ cls: document.activeElement.className, title: document.activeElement.querySelector('.draft-title')?.textContent }));
    assert.match(r.cls, /draft/);
    assert.equal(r.title, 'Kopia z panelu');
    assert.deepEqual(p.errors, []);
    await p.context().close();
});

test('układ: bez poziomego przewijania przy panelu obok treści, stopka na całą szerokość', async () => {
    for (const width of [1440, 1920]) {
        const p = await newPage({ width, height: 900 });
        await p.goto(url);
        await generateSheet(p);
        await p.waitForTimeout(400);
        const r = await p.evaluate(() => ({
            sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
            footerRight: Math.round(document.querySelector('.app-footer').getBoundingClientRect().right)
        }));
        assert.ok(r.sw <= r.cw, `szerokość ${width}: brak poziomego przewijania (${r.sw} > ${r.cw})`);
        assert.equal(r.footerRight, r.cw, `szerokość ${width}: stopka sięga do prawej krawędzi`);
        await p.context().close();
    }
});
