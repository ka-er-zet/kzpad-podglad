// Test roundtrip: wypełnij arkusz -> zapisz JSON -> wczytaj w czystej sesji -> zapisz ponownie.
// Oba pliki JSON muszą być identyczne (poza polami czasu). To siatka bezpieczeństwa dla
// wszystkich zmian w serializacji/odczycie stanu oceny (zapis, wczytanie, autozapis).
//
// Uruchomienie: node --test tests/*.test.mjs   (wymaga pakietu "playwright" i Chromium)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT, startServer, baseUrl, stripTimes, saveJson, generateSheet, fillAssessments } from './helpers.mjs';

test('zapis -> wczytanie -> zapis daje identyczny plik JSON', async (t) => {
    const server = await startServer();
    const browser = await chromium.launch();
    t.after(async () => { await browser.close(); server.close(); });
    const newPage = async () => (await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' })).newPage();

    const errors = [];
    const page = await newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(baseUrl(server));
    await generateSheet(page);
    const filled = await fillAssessments(page);
    assert.ok(filled.rowsSet >= 3, `ustawiono tylko ${filled.rowsSet} ocen wymagań`);
    assert.ok(filled.testsSet >= 3, `ustawiono tylko ${filled.testsSet} ocen testów`);

    const first = await saveJson(page);
    const appVersion = fs.readFileSync(path.join(ROOT, 'js', 'version.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
    const toolVersion = first['@graph'].find((x) => x['@type']?.includes?.('earl:Software'))['dct:hasVersion'];
    assert.equal(toolVersion, appVersion, 'wersja narzędzia w pliku powinna pochodzić z js/version.js');

    const page2 = await newPage();
    page2.on('pageerror', (e) => errors.push(String(e)));
    await page2.goto(baseUrl(server));
    await page2.waitForSelector('#wizard-file-input', { state: 'attached' });
    const tmp = path.join(ROOT, 'tests', '.tmp-first.json');
    fs.writeFileSync(tmp, JSON.stringify(first));
    t.after(() => fs.rmSync(tmp, { force: true }));
    await page2.setInputFiles('#wizard-file-input', tmp);
    await page2.waitForSelector('.requirement-row', { state: 'attached' });
    await page2.waitForTimeout(500);
    const second = await saveJson(page2);

    assert.deepEqual(errors, [], 'nie powinno być błędów JS: ' + errors.join(' | '));
    const outcomes = (g) => g['@graph'].filter((x) => x['@type'] === 'earl:Assertion')
        .filter((x) => x['earl:result']['earl:outcome']['@id'] !== 'earl:untested').length;
    assert.ok(outcomes(first) >= filled.rowsSet + filled.testsSet, 'pierwszy plik powinien zawierać wszystkie ustawione oceny');
    assert.equal(outcomes(second), outcomes(first), 'liczba ocenionych pozycji po wczytaniu');
    assert.deepEqual(stripTimes(second), stripTimes(first), 'plik po roundtripie powinien być identyczny');
});
