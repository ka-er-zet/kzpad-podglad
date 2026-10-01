// Testy sesji pracy: śledzenie niezapisanych zmian, autozapis i ochrona przed utratą pracy.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT, startServer, baseUrl, stripTimes, saveJson, generateSheet, fillAssessments, readSlot } from './helpers.mjs';

let server, browser, url;
before(async () => { server = await startServer(); browser = await chromium.launch(); url = baseUrl(server); });
after(async () => { await browser.close(); server.close(); });

const newContext = () => browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });
const snapshot = (page) => page.evaluate(() => buildAssessmentEARL());
const waitForSlot = (page) => page.waitForFunction((k) => localStorage.getItem(k) !== null, 'oz-pad:autosave:v1', { timeout: 6000 });
const dialogOpen = (page) => page.locator('#app-confirm-dialog[open]');
const dialogTitle = (page) => page.locator('#app-confirm-dialog[open] #dialog-title');

async function dirtySheet(page) {
    await page.goto(url);
    await generateSheet(page);
    await fillAssessments(page);
    await waitForSlot(page);
}

test('autozapis tworzy kopię i po ponownym wejściu aplikacja PYTA o przywrócenie', async () => {
    const ctx = await newContext();
    const p1 = await ctx.newPage();
    await dirtySheet(p1);
    const before = await snapshot(p1);
    await p1.close();

    const p2 = await ctx.newPage();
    const errors = []; p2.on('pageerror', (e) => errors.push(String(e)));
    await p2.goto(url);
    await dialogOpen(p2).waitFor({ timeout: 5000 });
    assert.match(await dialogTitle(p2).textContent(), /Przywrócić/);
    assert.equal(await p2.locator('.requirement-row').count() > 0 && await p2.locator('#resultsArea').isVisible(), false, 'przed odpowiedzią arkusz nie jest przywrócony');
    await p2.click('#dialog-confirm');
    await p2.waitForSelector('#resultsArea:not(.hidden) .requirement-row', { state: 'attached' });
    const after = await snapshot(p2);
    assert.deepEqual(stripTimes(after), stripTimes(before), 'przywrócony arkusz jest identyczny');
    assert.equal(await p2.evaluate(() => Session.hasUnsavedChanges()), true, 'przywrócona praca jest nadal niezapisana w pliku');
    assert.ok(await readSlot(p2), 'kopia zostaje po przywróceniu');
    assert.deepEqual(errors, []);
    await ctx.close();
});

test('odrzucenie usuwa kopię i nie przywraca arkusza', async () => {
    const ctx = await newContext();
    const p1 = await ctx.newPage();
    await dirtySheet(p1);
    await p1.close();

    const p2 = await ctx.newPage();
    await p2.goto(url);
    await dialogOpen(p2).waitFor({ timeout: 5000 });
    await p2.click('#dialog-cancel');
    await p2.waitForTimeout(300);
    assert.equal(await readSlot(p2), null);
    assert.equal(await p2.locator('#resultsArea').isVisible(), false);
    await ctx.close();
});

test('Esc na pytaniu o przywrócenie NIE usuwa kopii; pytanie wraca przy następnym wejściu', async () => {
    const ctx = await newContext();
    const p1 = await ctx.newPage();
    await dirtySheet(p1);
    await p1.close();

    const p2 = await ctx.newPage();
    await p2.goto(url);
    await dialogOpen(p2).waitFor({ timeout: 5000 });
    await p2.keyboard.press('Escape');
    await p2.waitForTimeout(300);
    assert.equal(await dialogOpen(p2).count(), 0);
    assert.ok(await readSlot(p2), 'kopia nie została usunięta bez jawnej odpowiedzi');
    assert.equal(await p2.locator('#resultsArea').isVisible(), false, 'bez odpowiedzi nic nie jest przywracane');
    await p2.close();

    const p3 = await ctx.newPage();
    await p3.goto(url);
    await dialogOpen(p3).waitFor({ timeout: 5000 });
    await ctx.close();
});

test('po zapisie pliku JSON każda kolejna zmiana znów tworzy kopię roboczą', async () => {
    const ctx = await newContext();
    const p = await ctx.newPage();
    await dirtySheet(p);
    await saveJson(p);
    assert.equal(await readSlot(p), null);

    await p.locator('textarea[name^="comment-"]').first().fill('zmiana po zapisie');
    await waitForSlot(p);
    assert.equal(await p.evaluate(() => Session.hasUnsavedChanges()), true);
    await p.close();

    const p2 = await ctx.newPage();
    await p2.goto(url);
    await dialogOpen(p2).waitFor({ timeout: 5000 });
    await p2.click('#dialog-confirm');
    await p2.waitForSelector('#resultsArea:not(.hidden) .requirement-row', { state: 'attached' });
    assert.equal(await p2.locator('textarea[name^="comment-"]').first().inputValue(), 'zmiana po zapisie');
    await ctx.close();
});

test('nie ma przycisku ani pytania o ręczne usuwanie kopii roboczej', async () => {
    const ctx = await newContext();
    const p = await ctx.newPage();
    await dirtySheet(p);
    assert.equal(await p.locator('#btn-clear-autosave').count(), 0);
    await ctx.close();
});

test('"Wróć do arkusza" z przeglądarki wymagań faktycznie przenosi do arkusza', async () => {
    const ctx = await newContext();
    const p = await ctx.newPage();
    await dirtySheet(p);
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.click('#hero-browse-requirements');
    await p.waitForSelector('#browser-section:not(.hidden)');
    await p.click('#hero-new-audit');
    await dialogOpen(p).waitFor();
    await p.click('#dialog-cancel'); // "Wróć do arkusza"
    await p.waitForTimeout(400);
    assert.equal(await p.locator('#browser-section').isVisible(), false, 'przeglądarka wymagań zamknięta');
    assert.equal(await p.locator('#resultsArea').isVisible(), true, 'arkusz widoczny');
    assert.ok(await readSlot(p), 'kopia zostaje');
    await ctx.close();
});

test('zapis pliku JSON usuwa kopię roboczą i przy następnym wejściu nie ma pytania', async () => {
    const ctx = await newContext();
    const p1 = await ctx.newPage();
    await dirtySheet(p1);
    await saveJson(p1);
    assert.equal(await readSlot(p1), null);
    assert.equal(await p1.evaluate(() => Session.hasUnsavedChanges()), false);
    await p1.close();

    const p2 = await ctx.newPage();
    await p2.goto(url);
    await p2.waitForSelector('#hero-new-audit');
    await p2.waitForTimeout(800);
    assert.equal(await dialogOpen(p2).count(), 0);
    await ctx.close();
});

test('"Nowa ocena" z niezapisanymi zmianami pyta o zgodę; anulowanie niczego nie traci', async () => {
    const ctx = await newContext();
    const p = await ctx.newPage();
    await dirtySheet(p);
    const before = await snapshot(p);

    await p.click('#hero-new-audit');
    await dialogOpen(p).waitFor();
    assert.match(await dialogTitle(p).textContent(), /Niezapisane zmiany/);
    await p.click('#dialog-cancel'); // "Wróć do arkusza"
    await p.waitForTimeout(200);
    assert.deepEqual(stripTimes(await snapshot(p)), stripTimes(before), 'po anulowaniu arkusz bez zmian');
    assert.ok(await readSlot(p), 'kopia zostaje po anulowaniu');

    await p.click('#hero-new-audit');
    await dialogOpen(p).waitFor();
    await p.click('#dialog-confirm'); // "Odrzuć zmiany i kontynuuj"
    await p.waitForTimeout(300);
    assert.equal(await p.locator('#resultsArea').isVisible(), false);
    assert.equal(await readSlot(p), null);
    await ctx.close();
});

test('bez zmian "Nowa ocena" nie pyta o nic', async () => {
    const ctx = await newContext();
    const p = await ctx.newPage();
    await p.goto(url);
    await generateSheet(p);
    await p.click('#hero-new-audit');
    await p.waitForTimeout(400);
    assert.equal(await dialogOpen(p).count(), 0);
    await ctx.close();
});

test('wczytanie pliku z niezapisanymi zmianami pyta o zgodę', async () => {
    const ctx = await newContext();
    const p = await ctx.newPage();
    await dirtySheet(p);
    const current = await snapshot(p);
    const tmp = path.join(ROOT, 'tests', '.tmp-session.json');
    fs.writeFileSync(tmp, JSON.stringify(current));
    try {
        await p.setInputFiles('#wizard-file-input', tmp);
        await dialogOpen(p).waitFor();
        await p.click('#dialog-cancel');
        await p.waitForTimeout(200);
        assert.ok(await readSlot(p), 'po anulowaniu kopia zostaje');
        assert.equal(await p.evaluate(() => Session.hasUnsavedChanges()), true);

        await p.setInputFiles('#wizard-file-input', tmp);
        await dialogOpen(p).waitFor();
        await p.click('#dialog-confirm');
        await p.waitForTimeout(600);
        assert.equal(await p.evaluate(() => Session.hasUnsavedChanges()), false, 'po wczytaniu pliku stan jest zgodny z plikiem');
        assert.equal(await readSlot(p), null);
    } finally { fs.rmSync(tmp, { force: true }); }
    await ctx.close();
});

test('ponowne wygenerowanie arkusza z niezapisanymi zmianami pyta o zgodę', async () => {
    const ctx = await newContext();
    const p = await ctx.newPage();
    await dirtySheet(p);
    const before = await snapshot(p);
    await p.click('#generateBtn');
    await dialogOpen(p).waitFor();
    await p.click('#dialog-cancel');
    await p.waitForTimeout(200);
    assert.deepEqual(stripTimes(await snapshot(p)), stripTimes(before));

    await p.click('#generateBtn');
    await dialogOpen(p).waitFor();
    await p.click('#dialog-confirm');
    await p.waitForTimeout(500);
    const after = await snapshot(p);
    const evaluated = after['@graph'].filter((x) => x['@type'] === 'earl:Assertion' && x['earl:result']['earl:outcome']['@id'] !== 'earl:untested').length;
    assert.equal(evaluated, 0, 'nowy arkusz jest pusty');
    assert.equal(await p.evaluate(() => Session.hasUnsavedChanges()), false);
    await ctx.close();
});

test('ostrzeżenie przy zamykaniu karty (beforeunload) tylko gdy autozapis nie działa', async () => {
    // a) autozapis działa: zamknięcie karty nie wywołuje natywnego dialogu
    {
        const ctx = await newContext();
        const p = await ctx.newPage();
        const dialogs = []; p.on('dialog', (d) => { dialogs.push(d.type()); d.dismiss(); });
        await dirtySheet(p);
        await p.goto('about:blank'); // opuszczenie strony: bez natywnego ostrzeżenia, bo praca jest w kopii roboczej
        assert.deepEqual(dialogs, []);
        await ctx.close();
    }
    // b) localStorage rzuca wyjątek: pojawia się ostrzeżenie i toast
    {
        const ctx = await newContext();
        await ctx.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
        const p = await ctx.newPage();
        const dialogs = []; p.on('dialog', (d) => { dialogs.push(d.type()); d.dismiss(); });
        p.on('pageerror', () => {}); // utils.js zapisuje wersję do localStorage bez try/catch (znany, osobny problem)
        await p.goto(url);
        await generateSheet(p);
        await fillAssessments(p);
        await p.waitForTimeout(2500);
        assert.match(await p.locator('#autosave-status').textContent(), /Nie można zapisać kopii roboczej/);
        await p.goto('about:blank').catch(() => {}); // dialog anulowany przez test, więc nawigacja jest przerwana
        assert.deepEqual(dialogs, ['beforeunload']);
        await ctx.close();
    }
});

test('w przeglądarce wymagań jest przycisk powrotu do arkusza, który zachowuje oceny', async () => {
    const ctx = await newContext(); const p = await ctx.newPage();
    await dirtySheet(p);
    const before = stripTimes(await snapshot(p));
    await p.click('#hero-browse-requirements');
    await p.waitForSelector('#browser-section:not(.hidden)');
    assert.equal(await p.locator('#browser-back-to-sheet').isVisible(), true, 'przycisk powrotu widoczny, gdy jest arkusz');
    await p.click('#browser-back-to-sheet');
    assert.equal(await p.locator('#browser-section').isVisible(), false);
    assert.equal(await p.locator('#resultsArea .requirement-row').first().isVisible(), true, 'arkusz widoczny');
    assert.deepEqual(stripTimes(await snapshot(p)), before, 'oceny bez zmian');
    assert.equal(await dialogOpen(p).count(), 0, 'bez żadnych pytań');
    await ctx.close();
});

test('bez arkusza przycisk powrotu w przeglądarce wymagań jest ukryty', async () => {
    const ctx = await newContext(); const p = await ctx.newPage();
    await p.goto(url);
    await p.click('#hero-browse-requirements');
    await p.waitForSelector('#browser-section:not(.hidden)');
    assert.equal(await p.locator('#browser-back-to-sheet').isVisible(), false);
    await ctx.close();
});
