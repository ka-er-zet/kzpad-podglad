// Testy sesji pracy: kopie robocze ocen (IndexedDB, jedna kopia na ocenę), lista „Kopie robocze”,
// blokada tej samej oceny w dwóch kartach i ochrona przed utratą pracy, gdy autozapis nie działa.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT, startServer, baseUrl, stripTimes, saveJson, generateSheet, fillAssessments, readDrafts, LEGACY_AUTOSAVE_KEY, goTo, visibleOf, APP_LOGO } from './helpers.mjs';

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

test('po ponownym wejściu nie ma okna — kopia jest na liście „Kopie robocze” i daje się otworzyć', async () => {
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

test('kopia bez nazwy, opisu i osoby (np. z wcześniejszej wersji) daje się otworzyć mimo wymaganych pól formularza', async () => {
    const ctx = await newContext(); const p1 = await ctx.newPage();
    await dirtySheet(p1, { name: 'Do wyczyszczenia' });
    const rated = (await readDrafts(p1))[0].progress.done;
    await p1.close();

    const p2 = await ctx.newPage();
    const errors = []; p2.on('pageerror', (e) => errors.push(String(e)));
    await p2.goto(url);
    await p2.waitForSelector('#drafts-section:not(.hidden)');
    // zepsuj kopię tak, jak wyglądały kopie z dawnych wersji: puste dane o produkcie (ocena zostaje)
    await p2.evaluate(() => new Promise((resolve, reject) => {
        const req = indexedDB.open('oz-pad', 1);
        req.onsuccess = () => {
            const tx = req.result.transaction('drafts', 'readwrite');
            const st = tx.objectStore('drafts');
            st.getAll().onsuccess = (e) => {
                const rec = e.target.result[0];
                rec.label = '';
                const subject = rec.earl['@graph'].find((it) => it['@type'] && it['@type'].includes('earl:TestSubject'));
                subject['dct:title'] = ''; subject['dct:description'] = '';
                rec.earl['@graph'] = rec.earl['@graph'].filter((it) => !(it['@type'] && it['@type'].includes('foaf:Person')));
                st.put(rec);
            };
            tx.oncomplete = () => { req.result.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
        };
    }));
    await draftItems(p2).first().getByRole('button', { name: /Otwórz kopię roboczą/ }).click();
    await p2.waitForSelector('#resultsArea:not(.hidden) .requirement-row', { state: 'attached' });
    assert.deepEqual(await toastText(p2).then((t) => t.filter((x) => /Nie udało się/.test(x))), [], 'bez komunikatu o błędzie');
    const done = await p2.evaluate(() => [...document.querySelectorAll('#resultsArea input[name^="status-"]:checked')].length);
    assert.equal(done, rated, 'oceny z kopii zostały przywrócone');
    assert.equal(await p2.locator('#product-name-error:not(.hidden)').count(), 0, 'bez komunikatów o błędzie w formularzu');
    assert.deepEqual(errors, []);
    await ctx.close();
});

test('„Nowy arkusz” przy niezapisanej ocenie: za pierwszym razem okno informacyjne, potem tylko komunikat', async () => {
    const ctx = await newContext(); const p = await ctx.newPage();
    await dirtySheet(p, { name: 'Ocena A' });

    await goTo(p, 'new');
    await dialogOpen(p).waitFor();
    assert.equal(await dialogTitle(p).textContent(), 'Kopie robocze ocen');
    await p.click('#dialog-cancel'); // Anuluj
    assert.equal(await p.locator('#resultsArea').isVisible(), true, 'anulowanie zostawia arkusz');
    assert.equal(await p.evaluate(() => Session.hasUnsavedChanges()), true);

    await goTo(p, 'new');
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
    await goTo(p, 'new');
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
    // formularz kreatora jest w osobnym widoku: Wstecz w przeglądarce wraca do niego z poprzednimi danymi
    await p.goBack();
    await p.waitForSelector('#wizard-product-name', { state: 'visible' });
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

test('kopię roboczą można pobrać jako plik JSON z listy; jak każdy zapis do pliku usuwa kopię', async () => {
    const ctx = await newContext(); const p1 = await ctx.newPage();
    await dirtySheet(p1, { name: 'Do pobrania' });
    const id = await currentId(p1);
    await p1.close();
    const p = await ctx.newPage();
    await p.goto(url);
    await p.waitForSelector('#drafts-section:not(.hidden)');
    const [dl] = await Promise.all([
        p.waitForEvent('download'),
        p.getByRole('button', { name: 'Pobierz kopię roboczą jako plik JSON: Do pobrania' }).click(),
    ]);
    assert.match(dl.suggestedFilename(), /^arkusz_.*do_pobrania.*\.json$/);
    const json = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    const subject = json['@graph'].find((x) => x['@type']?.includes?.('earl:TestSubject'));
    assert.equal(subject['eaa:assessmentId'], id, 'plik ma ten sam identyfikator co kopia');
    await waitForDrafts(p, 0);
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
    await b.waitForFunction(() => document.querySelectorAll('#drafts-list button').length === 3);
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

test('wczytanie pliku i wybór kopii roboczej: powrót do ostatnio edytowanego pola, nie na początek arkusza', async () => {
    const ctx = await newContext(); const a = await ctx.newPage();
    await dirtySheet(a, { name: 'Pozycja' });
    const json = await saveJson(a);
    // edycja pola daleko od początku arkusza
    const last = a.locator('#resultsArea textarea[name^="comment-"]:visible').last();
    const lastName = await last.getAttribute('name');
    await last.scrollIntoViewIfNeeded();
    await last.fill('ostatnia edycja');
    await a.evaluate(() => Session.flush());
    await a.goto('about:blank');

    const tmp = path.join(ROOT, 'tests', '.tmp-position.json');
    fs.writeFileSync(tmp, JSON.stringify(json));
    try {
        const p = await ctx.newPage();
        await p.goto(url);
        await p.waitForSelector('#wizard-file-input', { state: 'attached' });
        await p.setInputFiles('#wizard-file-input', tmp);
        await dialogOpen(p).waitFor();
        await p.click('#dialog-confirm'); // Kopia robocza
        await p.waitForSelector('#resultsArea:not(.hidden) .requirement-row', { state: 'attached' });
        await p.waitForTimeout(1200); // przewijanie smooth z opóźnieniem 150 ms nie może nas cofnąć
        const state = await p.evaluate(() => ({ name: document.activeElement && document.activeElement.name, y: window.pageYOffset }));
        assert.equal(state.name, lastName, 'fokus na ostatnio edytowanym polu');
        assert.ok(state.y > 1000, 'arkusz przewinięty do pola, a nie na początek (y=' + state.y + ')');
    } finally { fs.rmSync(tmp, { force: true }); }
    await ctx.close();
});

test('zamknięcie powiadomienia nie przewija strony', async () => {
    const ctx = await newContext(); const p = await ctx.newPage();
    await dirtySheet(p, { name: 'Toast' });
    // fokus na nagłówku arkusza (jak po wczytaniu pliku), potem użytkownik przewija w dół
    await p.evaluate(() => document.getElementById('selectedProductName').focus());
    // po wygenerowaniu arkusza aplikacja płynnie przewija do jego nagłówka — czekamy, aż przewijanie się skończy
    await p.waitForTimeout(600);
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(150);
    const y = await p.evaluate(() => window.pageYOffset);
    assert.ok(y > 1000, 'strona przewinięta w dół');
    await p.evaluate(() => showToast('Powiadomienie testowe', 'success', 60000));
    await p.waitForTimeout(150);
    await p.click('#toast-container .toast-close');
    await p.waitForTimeout(300);
    assert.equal(await p.locator('#toast-container .toast').count(), 0, 'powiadomienie zamknięte');
    const after = await p.evaluate(() => window.pageYOffset);
    assert.ok(Math.abs(after - y) < 5, `pozycja przewinięcia bez zmian (było ${y}, jest ${after})`);
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
    await goTo(p, 'browse');
    await p.waitForSelector('#browser-section:not(.hidden)');
    assert.equal(await dialogOpen(p).count(), 0);
    await p.click('#browser-back-to-sheet');
    // Logo otwiera widok startowy bez przeładowania: arkusz zostaje w pamięci, nic nie pyta
    const logo = await visibleOf(p, APP_LOGO);
    const marker = await p.evaluate(() => (window.__noReload = Math.random()));
    await p.click(logo);
    assert.equal(await p.evaluate(() => document.body.dataset.npView), 'start');
    assert.equal(await p.evaluate(() => window.__noReload), marker, 'strona nie została przeładowana');
    assert.equal(await p.locator('#np-panel [data-group="sheet"]').count(), 1, 'arkusz nadal otwarty');
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

    await goTo(p, 'new');
    await dialogOpen(p).waitFor();
    assert.equal(await dialogTitle(p).textContent(), 'Niezapisane zmiany');
    await p.click('#dialog-cancel');
    assert.equal(await p.locator('#resultsArea').isVisible(), true);

    await p.goto('about:blank').catch(() => {}); // dialog anulowany przez test, więc nawigacja jest przerwana
    assert.deepEqual(dialogs, ['beforeunload']);
    await ctx.close();
});

test('bez kopii roboczych sekcja „Kopie robocze” jest ukryta', async () => {
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
    await goTo(p, 'browse');
    await p.waitForSelector('#browser-section:not(.hidden)');
    assert.equal(await p.locator('#browser-back-to-sheet').isVisible(), true);
    // strzałka ozdobna jest ukryta przed czytnikami: nazwa przycisku to sam tekst
    await p.getByRole('button', { name: 'Wróć do arkusza oceny', exact: true }).waitFor();
    await p.click('#browser-back-to-sheet');
    // widok przełącza panel w następnej klatce (obserwator zmian), więc czekamy na stan zamiast sprawdzać od razu
    await p.locator('#resultsArea .requirement-row').first().waitFor({ state: 'visible', timeout: 2000 });
    assert.equal(await p.locator('#browser-section').isVisible(), false);
    assert.deepEqual(stripTimes(await snapshot(p)), before, 'oceny bez zmian');
    await ctx.close();
});

test('bez arkusza przycisk powrotu w przeglądarce wymagań jest ukryty', async () => {
    const ctx = await newContext(); const p = await ctx.newPage();
    await p.goto(url);
    await goTo(p, 'browse');
    await p.waitForSelector('#browser-section:not(.hidden)');
    assert.equal(await p.locator('#browser-back-to-sheet').isVisible(), false);
    await ctx.close();
});

test('kafelek „Kopie robocze” rozwija i zwija listę w swoim wnętrzu; stan jest zapamiętany', async () => {
    const ctx = await newContext(); const p1 = await ctx.newPage();
    await dirtySheet(p1, { name: 'Zwijanie' });
    await p1.close();
    const p = await ctx.newPage();
    await p.goto(url);
    await p.waitForSelector('#drafts-section:not(.hidden)');
    const toggle = p.locator('#drafts-toggle');
    assert.equal(await p.locator('.hero-grid > li#drafts-section #drafts-toggle').count(), 1, 'kafelek jest w siatce kafelków startowych');
    assert.equal(await p.locator('#drafts-section #drafts-list').count(), 1, 'lista jest wewnątrz kafelka');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'domyślnie rozwinięty');
    const pos = await p.evaluate(() => {
        const card = document.getElementById('drafts-section').getBoundingClientRect(), head = document.getElementById('drafts-toggle').getBoundingClientRect(), list = document.getElementById('drafts-list').getBoundingClientRect();
        return { inside: list.top >= head.bottom && list.bottom <= card.bottom + 1, head: Math.round(head.height), card: Math.round(card.height) };
    });
    assert.ok(pos.inside, 'lista pod nagłówkiem, w granicach karty');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await p.locator('#drafts-list').isVisible(), false);
    const collapsed = await p.evaluate(() => Math.round(document.getElementById('drafts-section').getBoundingClientRect().height));
    assert.ok(collapsed < pos.card, 'zwinięty kafelek jest niższy');
    await p.reload();
    await p.waitForSelector('#drafts-section:not(.hidden)');
    assert.equal(await p.locator('#drafts-toggle').getAttribute('aria-expanded'), 'false', 'stan zapamiętany');
    await p.click('#drafts-toggle');
    assert.equal(await p.locator('#drafts-list').isVisible(), true);
    await ctx.close();
});

test('bez kopii roboczych kafelek jest ukryty', async () => {
    const ctx = await newContext(); const p = await ctx.newPage();
    await p.goto(url);
    await p.waitForSelector('#hero-new-audit');
    await p.waitForTimeout(300);
    assert.equal(await p.locator('#drafts-section').isVisible(), false);
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

    await goTo(p, 'browse');
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

test('postęp w kopii roboczej liczy te same wymagania co podsumowanie (Art. 19 tylko, gdy włączony)', async () => {
    const ctx = await newContext(); const p = await ctx.newPage();
    await dirtySheet(p);
    const hasArt19 = await p.evaluate(() => !!document.querySelector('#resultsArea [data-art19-container="true"] .requirement-row'));
    assert.ok(hasArt19, 'profil testowy ma kryteria Art. 19 (inaczej test niczego nie sprawdza)');
    const check = async () => {
        await p.evaluate(() => Session.flush());
        const d = (await waitForDrafts(p, 1))[0];
        const s = await p.evaluate(() => getAssessmentSummaryData());
        assert.equal(d.progress.total, s.totalCount, 'liczba wymagań jak w podsumowaniu');
        assert.equal(d.progress.done, s.totalCount - s.untestedCount, 'liczba ocenionych jak w podsumowaniu');
    };
    await check();                                                  // Art. 19 wyłączony
    await p.evaluate(() => { const sw = document.querySelector('#resultsArea input[role="switch"]'); sw.click(); });
    await check();                                                  // Art. 19 włączony
    await ctx.close();
});

// Uwaga PFRON 7 (listopad 2026): po wczytaniu pliku JSON formularz przechodzi do pierwszego wymagania bez oceny
test('wczytanie pliku JSON przenosi do pierwszego nieocenionego wymagania; bez ocen albo przy kompletnej ocenie zostaje początek', async () => {
    const ctxA = await newContext(); const a = await ctxA.newPage();
    await dirtySheet(a, { name: 'Skok' });           // oceniane są początkowe wymagania, reszta zostaje bez oceny
    const partial = await saveJson(a);
    const rowIdx = await a.evaluate(() => {
        const rows = [...document.querySelectorAll('#resultsArea .requirement-row')].filter((r) => !r.closest('[data-art19-container="true"]'));
        return rows.findIndex((r) => !r.querySelector('input[type="radio"][name^="status-"]:checked'));
    });
    assert.ok(rowIdx > 0, 'w arkuszu są ocenione i nieocenione wymagania');
    await ctxA.close();

    const load = async (json, tmpName) => {
        const ctx = await newContext(); const p = await ctx.newPage();
        const tmp = path.join(ROOT, 'tests', tmpName);
        fs.writeFileSync(tmp, JSON.stringify(json));
        try {
            await p.goto(url);
            await p.waitForSelector('#wizard-file-input', { state: 'attached' });
            await p.setInputFiles('#wizard-file-input', tmp);
            await p.waitForSelector('#resultsArea:not(.hidden) .requirement-row', { state: 'attached' });
            await p.waitForTimeout(1200);
            const state = await p.evaluate(() => {
                const ae = document.activeElement, row = ae && ae.closest && ae.closest('.requirement-row');
                const rows = [...document.querySelectorAll('#resultsArea .requirement-row')].filter((r) => !r.closest('[data-art19-container="true"]'));
                return { name: ae && (ae.name || ae.id), idx: row ? rows.indexOf(row) : -1, y: window.pageYOffset,
                    msg: (document.getElementById('status-message') || {}).innerText || '' };
            });
            return { ...state, ctx, p };
        } finally { fs.rmSync(tmp, { force: true }); }
    };

    const s1 = await load(partial, '.tmp-skok.json');
    assert.equal(s1.idx, rowIdx, 'fokus w pierwszym nieocenionym wymaganiu');
    assert.match(s1.name, /^status-/, 'fokus na polu oceny wymagania');
    assert.ok(s1.y > 300, 'arkusz przewinięty (y=' + s1.y + ')');
    assert.match(s1.msg, /pierwszego nieocenionego wymagania/, 'komunikat dla czytników ekranu');
    await s1.ctx.close();

    // wszystko ocenione: zostaje początek arkusza
    const a2ctx = await newContext(); const a2 = await a2ctx.newPage();
    await a2.goto(url); await generateSheet(a2, { name: 'Komplet' });
    await a2.evaluate(() => document.querySelectorAll('#resultsArea .requirement-row').forEach((row) => {
        const r = row.querySelector('input[type="radio"][name^="status-"][value="compliant"]'); if (r) r.click();
    }));
    await a2.evaluate(() => { const sw = document.querySelector('#resultsArea input[role="switch"]'); if (sw && !sw.checked) { sw.click(); sw.click(); } });
    const full = await saveJson(a2);
    await a2ctx.close();
    const s2 = await load(full, '.tmp-komplet.json');
    assert.ok(!/pierwszego nieocenionego/.test(s2.msg), 'przy kompletnej ocenie nie ma skoku');
    await s2.ctx.close();
});
