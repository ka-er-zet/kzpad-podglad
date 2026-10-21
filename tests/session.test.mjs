// Testy sesji pracy: kopie robocze ocen (IndexedDB, jedna kopia na ocenę), lista „Niezapisane oceny”,
// blokada tej samej oceny w dwóch kartach i ochrona przed utratą pracy, gdy autozapis nie działa.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT, startServer, baseUrl, stripTimes, saveJson, generateSheet, fillAssessments, readDrafts, LEGACY_AUTOSAVE_KEY } from './helpers.mjs';

let server, browser, url;
before(async () => { server = await startServer(); browser = await chromium.launch(); url = baseUrl(server); });
after(async () => { await browser.close(); server.close(); });

const newContext = () => browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });
const snapshot = (page) => page.evaluate(() => buildAssessmentEARL());
const dialogOpen = (page) => page.locator('#app-confirm-dialog[open]');
const dialogTitle = (page) => page.locator('#app-confirm-dialog[open] #dialog-title');
const toastText = (page) => page.locator('#toast-container .toast-content').allTextContents();
const currentId = (page) => page.evaluate(() => Session.currentId());
const draftItems = (page) => page.locator('#drafts-list li.draft');
const markInfoSeen = (page) => page.evaluate(() => localStorage.setItem('oz-pad:drafts-info-seen', '1'));

async function waitForDrafts(page, n) {
    for (let i = 0; i < 60; i++) {
        const d = await readDrafts(page);
        if (d.length === n) return d;
        await page.waitForTimeout(100);
    }
    const d = await readDrafts(page);
    assert.equal(d.length, n, `oczekiwano ${n} kopii roboczych, jest ${d.length}`);
    return d;
}

async function setComment(page, text) {
    await page.evaluate((t) => {
        const ta = document.querySelector('#resultsArea textarea[name^="comment-"]');
        ta.value = t;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
}
const firstComment = (page) => page.evaluate(() => document.querySelector('#resultsArea textarea[name^="comment-"]').value);

/** Nowa ocena z ocenami; czeka, aż kopia robocza jest w IndexedDB. */
async function dirtySheet(page, opts) {
    await page.goto(url);
    await generateSheet(page, opts);
    await fillAssessments(page);
    await page.evaluate(() => Session.flush());
}

test('wygenerowanie arkusza tworzy kopię roboczą z identyfikatorem, który trafia też do pliku JSON', async () => {
    const ctx = await newContext(); const p = await ctx.newPage();
    await dirtySheet(p);
    const id = await currentId(p);
    assert.ok(id, 'ocena ma identyfikator');
    const drafts = await waitForDrafts(p, 1);
    assert.equal(drafts[0].id, id);
    assert.ok(drafts[0].progress.total > 0 && drafts[0].progress.done > 0, 'kopia zna postęp oceny');

    const json = await saveJson(p);
    const subject = json['@graph'].find((x) => x['@type']?.includes?.('earl:TestSubject'));
    assert.equal(subject['eaa:assessmentId'], id, 'identyfikator w pliku JSON');
    await waitForDrafts(p, 0);

    await setComment(p, 'zmiana po zapisie');
    await p.evaluate(() => Session.flush());
    const again = await waitForDrafts(p, 1);
    assert.equal(again[0].id, id, 'kolejna zmiana tworzy kopię tej samej oceny');
    await ctx.close();
});

test('po ponownym wejściu nie ma okna — kopia jest na liście „Niezapisane oceny” i daje się otworzyć', async () => {
    const ctx = await newContext(); const p1 = await ctx.newPage();
    await dirtySheet(p1, { name: 'Bankomat XYZ' });
    const before = await snapshot(p1);
    await p1.close();

    const p2 = await ctx.newPage();
    const errors = []; p2.on('pageerror', (e) => errors.push(String(e)));
    await p2.goto(url);
    await p2.waitForSelector('#drafts-section:not(.hidden)');
    assert.equal(await dialogOpen(p2).count(), 0, 'bez okna przy starcie');
    assert.equal(await draftItems(p2).count(), 1);
    const item = draftItems(p2).first();
    assert.match(await item.textContent(), /Bankomat XYZ/);
    assert.match(await item.textContent(), /ocenione \d+ z \d+ wymagań/);
    await item.getByRole('button', { name: 'Otwórz kopię roboczą: Bankomat XYZ' }).click();
    await p2.waitForSelector('#resultsArea:not(.hidden) .requirement-row', { state: 'attached' });
    assert.deepEqual(stripTimes(await snapshot(p2)), stripTimes(before), 'otwarta kopia jest identyczna');
    assert.equal(await p2.evaluate(() => Session.hasUnsavedChanges()), true, 'praca nadal niezapisana w pliku');
    await waitForDrafts(p2, 1);
    await p2.waitForFunction(() => /Bieżąca ocena w tej karcie/.test(document.getElementById('drafts-list').textContent));
    assert.deepEqual(errors, []);
    await ctx.close();
});

test('„Nowy arkusz” przy niezapisanej ocenie: za pierwszym razem okno informacyjne, potem tylko komunikat', async () => {
    const ctx = await newContext(); const p = await ctx.newPage();
    await dirtySheet(p, { name: 'Ocena A' });

    await p.click('#hero-new-audit');
    await dialogOpen(p).waitFor();
    assert.equal(await dialogTitle(p).textContent(), 'Kopie robocze ocen');
    await p.click('#dialog-cancel'); // Anuluj
    assert.equal(await p.locator('#resultsArea').isVisible(), true, 'anulowanie zostawia arkusz');
    assert.equal(await p.evaluate(() => Session.hasUnsavedChanges()), true);

    await p.click('#hero-new-audit');
    await dialogOpen(p).waitFor();
    await p.click('#dialog-confirm'); // Kontynuuj
    await p.waitForFunction(() => document.getElementById('resultsArea').classList.contains('hidden'));
    assert.ok((await toastText(p)).some((t) => /zachowana jako kopia robocza/.test(t)), 'komunikat o zachowaniu oceny');
    await waitForDrafts(p, 1);

    // druga ocena — okno już się nie pojawia
    await generateSheet(p, { name: 'Ocena B' });
    await fillAssessments(p);
    await p.evaluate(() => Session.flush());
    await p.evaluate(() => document.querySelectorAll('#toast-container .toast').forEach((t) => t.remove()));
    await p.click('#hero-new-audit');
    await p.waitForFunction(() => document.getElementById('resultsArea').classList.contains('hidden'));
    assert.equal(await dialogOpen(p).count(), 0, 'bez okna za drugim razem');
    assert.ok((await toastText(p)).some((t) => /zachowana jako kopia robocza/.test(t)));
    const drafts = await waitForDrafts(p, 2);
    assert.deepEqual(drafts.map((d) => d.label).sort(), ['Ocena A', 'Ocena B']);
    await ctx.close();
});

test('ponowne wygenerowanie arkusza zachowuje poprzednią ocenę i zaczyna nową', async () => {
    const ctx = await newContext(); const p = await ctx.newPage();
    await dirtySheet(p, { name: 'Pierwsza' });
    await markInfoSeen(p);
    const firstId = await currentId(p);
    await p.fill('#wizard-product-name', 'Druga');
    await p.click('#generateBtn');
    await p.waitForFunction((id) => Session.currentId() && Session.currentId() !== id, firstId);
    const drafts = await waitForDrafts(p, 2);
    assert.ok(drafts.some((d) => d.id === firstId), 'poprzednia ocena zachowana');
    await ctx.close();
});

test('usunięcie kopii z listy wymaga potwierdzenia', async () => {
    const ctx = await newContext(); const p1 = await ctx.newPage();
    await dirtySheet(p1, { name: 'Do usunięcia' });
    await p1.close();
    const p = await ctx.newPage();
    await p.goto(url);
    await p.waitForSelector('#drafts-section:not(.hidden)');
    const del = p.getByRole('button', { name: 'Usuń kopię roboczą: Do usunięcia' });
    await del.click();
    await dialogOpen(p).waitFor();
    await p.click('#dialog-cancel');
    await waitForDrafts(p, 1);
    await del.click();
    await dialogOpen(p).waitFor();
    await p.click('#dialog-confirm');
    await waitForDrafts(p, 0);
    await p.waitForSelector('#drafts-section.hidden', { state: 'attached' });
    await ctx.close();
});

test('ta sama ocena w dwóch kartach: druga karta jej nie otworzy (lista i wczytanie pliku)', async () => {
    const ctx = await newContext(); const a = await ctx.newPage();
    await dirtySheet(a, { name: 'Wspólna' });
    const json = await saveJson(a);           // plik tej oceny
    await setComment(a, 'zmiana w karcie A'); // znów niezapisana → jest na liście
    await a.evaluate(() => Session.flush());

    const b = await ctx.newPage();
    await b.goto(url);
    await b.waitForSelector('#drafts-section:not(.hidden)');
    const item = draftItems(b).first();
    assert.match(await item.textContent(), /Otwarta w innej karcie/);
    assert.equal(await item.locator('button').count(), 0, 'bez przycisków przy ocenie otwartej gdzie indziej');

    const tmp = path.join(ROOT, 'tests', '.tmp-shared.json');
    fs.writeFileSync(tmp, JSON.stringify(json));
    try {
        await b.waitForSelector('#wizard-file-input', { state: 'attached' });
        await b.setInputFiles('#wizard-file-input', tmp);
        await b.waitForFunction(() => [...document.querySelectorAll('#toast-container .toast-content')].some((t) => /otwarta w innej karcie/.test(t.textContent)));
        assert.equal(await b.locator('#resultsArea').isVisible(), false, 'arkusz nie został wczytany');
    } finally { fs.rmSync(tmp, { force: true }); }

    await a.goto('about:blank'); // zamknięcie oceny w karcie A zwalnia blokadę
    await b.evaluate(() => window.dispatchEvent(new Event('focus')));
    await b.waitForFunction(() => document.querySelectorAll('#drafts-list button').length === 2);
    await ctx.close();
});

test('wczytanie pliku, gdy kopia robocza tej oceny jest nowsza: pytanie, której wersji użyć', async () => {
    const ctx = await newContext(); const a = await ctx.newPage();
    await dirtySheet(a, { name: 'Wersje' });
    await setComment(a, 'wersja z pliku');
    const json = await saveJson(a);
    await setComment(a, 'wersja z kopii roboczej');
    await a.evaluate(() => Session.flush());
    await a.goto('about:blank');

    const tmp = path.join(ROOT, 'tests', '.tmp-versions.json');
    fs.writeFileSync(tmp, JSON.stringify(json));
    try {
        for (const [choice, expected] of [['#dialog-confirm', 'wersja z kopii roboczej'], ['#dialog-cancel', 'wersja z pliku']]) {
            const p = await ctx.newPage();
            await p.goto(url);
            await p.waitForSelector('#wizard-file-input', { state: 'attached' });
            await p.setInputFiles('#wizard-file-input', tmp);
            await dialogOpen(p).waitFor();
            assert.equal(await dialogTitle(p).textContent(), 'Kopia robocza jest nowsza niż plik');
            await p.click(choice);
            await p.waitForSelector('#resultsArea:not(.hidden) .requirement-row', { state: 'attached' });
            assert.equal(await firstComment(p), expected);
            await p.goto('about:blank');
        }
        const p = await ctx.newPage(); await p.goto(url);
        await waitForDrafts(p, 0); // wybranie pliku usunęło kopię
    } finally { fs.rmSync(tmp, { force: true }); }
    await ctx.close();
});

test('kopia z dawnego autozapisu (localStorage) trafia na listę', async () => {
    const ctx = await newContext(); const p = await ctx.newPage();
    await dirtySheet(p, { name: 'Stara kopia' });
    const earl = await snapshot(p);
    await p.goto('about:blank');
    const q = await ctx.newPage();
    await q.goto(url);
    await q.evaluate(async ([k, e]) => {
        await new Promise((r) => { const req = indexedDB.deleteDatabase('oz-pad'); req.onsuccess = req.onerror = req.onblocked = () => r(); });
        delete e['@graph'].find((x) => x['@type']?.includes?.('earl:TestSubject'))['eaa:assessmentId'];
        localStorage.setItem(k, JSON.stringify({ v: 1, savedAt: new Date().toISOString(), label: 'Stara kopia', earl: e }));
    }, [LEGACY_AUTOSAVE_KEY, earl]);
    await q.reload();
    await q.waitForSelector('#drafts-section:not(.hidden)');
    assert.match(await draftItems(q).first().textContent(), /Stara kopia/);
    assert.equal(await q.evaluate((k) => localStorage.getItem(k), LEGACY_AUTOSAVE_KEY), null, 'stary klucz usunięty');
    await ctx.close();
});

test('zmiana tuż przed zamknięciem karty (przed autozapisem) nie przepada', async () => {
    const ctx = await newContext(); const p = await ctx.newPage();
    await dirtySheet(p, { name: 'Szybkie zamknięcie' });
    await setComment(p, 'ostatnia zmiana');
    await p.goto('about:blank'); // od razu, bez czekania na zapis z opóźnieniem
    const q = await ctx.newPage();
    await q.goto(url);
    await q.getByRole('button', { name: 'Otwórz kopię roboczą: Szybkie zamknięcie' }).click();
    await q.waitForSelector('#resultsArea:not(.hidden) .requirement-row', { state: 'attached' });
    assert.equal(await firstComment(q), 'ostatnia zmiana');
    await ctx.close();
});

test('gdy autozapis działa: przeglądarka wymagań, ikona aplikacji i zamknięcie karty nie pytają', async () => {
    const ctx = await newContext(); const p = await ctx.newPage();
    const dialogs = []; p.on('dialog', (d) => { dialogs.push(d.type()); d.dismiss(); });
    await dirtySheet(p);
    await p.click('#hero-browse-requirements');
    await p.waitForSelector('#browser-section:not(.hidden)');
    assert.equal(await dialogOpen(p).count(), 0);
    await p.click('#browser-back-to-sheet');
    await Promise.all([p.waitForNavigation(), p.click('#app-logo')]);
    assert.equal(await dialogOpen(p).count(), 0);
    await p.goto('about:blank');
    assert.deepEqual(dialogs, [], 'bez natywnego ostrzeżenia przeglądarki');
    await ctx.close();
});

test('gdy autozapis nie działa: ostrzeżenie, pytanie przed nową oceną i ostrzeżenie przy zamknięciu karty', async () => {
    const ctx = await newContext();
    await ctx.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); });
    const p = await ctx.newPage();
    const dialogs = []; p.on('dialog', (d) => { dialogs.push(d.type()); d.dismiss(); });
    await p.goto(url);
    await generateSheet(p);
    await fillAssessments(p);
    await p.evaluate(() => Session.flush());
    assert.match(await p.locator('#autosave-status').textContent(), /Nie można zapisać kopii roboczej/);

    await p.click('#hero-new-audit');
    await dialogOpen(p).waitFor();
    assert.equal(await dialogTitle(p).textContent(), 'Niezapisane zmiany');
    await p.click('#dialog-cancel');
    assert.equal(await p.locator('#resultsArea').isVisible(), true);

    await p.goto('about:blank').catch(() => {}); // dialog anulowany przez test, więc nawigacja jest przerwana
    assert.deepEqual(dialogs, ['beforeunload']);
    await ctx.close();
});

test('bez kopii roboczych sekcja „Niezapisane oceny” jest ukryta', async () => {
    const ctx = await newContext(); const p = await ctx.newPage();
    await p.goto(url);
    await p.waitForSelector('#hero-new-audit');
    await p.waitForTimeout(300);
    assert.equal(await p.locator('#drafts-section').isVisible(), false);
    await ctx.close();
});

test('w przeglądarce wymagań jest przycisk powrotu do arkusza, który zachowuje oceny', async () => {
    const ctx = await newContext(); const p = await ctx.newPage();
    await dirtySheet(p);
    const before = stripTimes(await snapshot(p));
    await p.click('#hero-browse-requirements');
    await p.waitForSelector('#browser-section:not(.hidden)');
    assert.equal(await p.locator('#browser-back-to-sheet').isVisible(), true);
    await p.click('#browser-back-to-sheet');
    assert.equal(await p.locator('#browser-section').isVisible(), false);
    assert.equal(await p.locator('#resultsArea .requirement-row').first().isVisible(), true);
    assert.deepEqual(stripTimes(await snapshot(p)), before, 'oceny bez zmian');
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

test('sekcję „Niezapisane oceny” można zwinąć; stan jest zapamiętany', async () => {
    const ctx = await newContext(); const p1 = await ctx.newPage();
    await dirtySheet(p1, { name: 'Zwijanie' });
    await p1.close();
    const p = await ctx.newPage();
    await p.goto(url);
    await p.waitForSelector('#drafts-section:not(.hidden)');
    const toggle = p.getByRole('button', { name: /Niezapisane oceny/ });
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'domyślnie rozwinięta');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await p.locator('#drafts-list').isVisible(), false);
    await p.reload();
    await p.waitForSelector('#drafts-section:not(.hidden)');
    assert.equal(await p.locator('#drafts-toggle').getAttribute('aria-expanded'), 'false', 'stan zapamiętany');
    await p.click('#drafts-toggle');
    assert.equal(await p.locator('#drafts-list').isVisible(), true);
    await ctx.close();
});

test('powrót z przeglądarki wymagań i otwarcie kopii przenoszą do ostatnio edytowanego miejsca', async () => {
    const ctx = await newContext(); const p = await ctx.newPage();
    await dirtySheet(p, { name: 'Miejsce' });
    // komentarz do testu w zwiniętej sekcji, daleko w arkuszu
    const target = p.locator('#resultsArea .checklist-test-item textarea').nth(20);
    const name = await target.getAttribute('name');
    await target.evaluate((ta) => { let d = ta.closest('details'); while (d) { d.open = true; d = d.parentElement.closest('details'); } });
    await target.fill('tu skończyłem');
    await target.evaluate((ta) => { let d = ta.closest('details'); while (d) { d.open = false; d = d.parentElement.closest('details'); } });
    await p.evaluate(() => window.scrollTo(0, 0));

    await p.click('#hero-browse-requirements');
    await p.waitForSelector('#browser-section:not(.hidden)');
    await p.click('#browser-back-to-sheet');
    await p.waitForFunction((n) => document.activeElement && document.activeElement.name === n, name);
    assert.equal(await target.isVisible(), true, 'zwinięte sekcje rozwinięte, pole widoczne');
    assert.equal(await p.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), true, 'pole w widocznym obszarze');

    await p.evaluate(() => Session.flush());
    await p.goto('about:blank');
    const q = await ctx.newPage();
    await q.goto(url);
    await q.getByRole('button', { name: 'Otwórz kopię roboczą: Miejsce' }).click();
    await q.waitForFunction((n) => document.activeElement && document.activeElement.name === n, name);
    assert.equal(await q.evaluate(() => document.activeElement.value), 'tu skończyłem');
    await ctx.close();
});
