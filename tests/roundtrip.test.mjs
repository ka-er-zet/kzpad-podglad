// Test roundtrip: wypełnij arkusz -> zapisz JSON -> wczytaj w czystej sesji -> zapisz ponownie.
// Oba pliki JSON muszą być identyczne (poza polami czasu). To siatka bezpieczeństwa dla
// wszystkich zmian w serializacji/odczycie stanu oceny (zapis, wczytanie, autosave).
//
// Uruchomienie: node --test tests/   (wymaga pakietu "playwright" i zainstalowanej Chromium)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function startServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const rel = decodeURIComponent(req.url.split('?')[0]);
            const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
            if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                res.writeHead(404); res.end('not found'); return;
            }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
            fs.createReadStream(file).pipe(res);
        }).listen(0, '127.0.0.1', () => resolve(server));
    });
}

// Usuwa pola zależne od czasu, żeby porównać resztę.
function stripTimes(node) {
    if (Array.isArray(node)) return node.map(stripTimes);
    if (node && typeof node === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(node)) {
            if (k === 'dct:date') continue;
            out[k] = stripTimes(v);
        }
        return out;
    }
    return node;
}

async function saveJson(page) {
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.click('#btn-save-wizard'),
    ]);
    const file = await download.path();
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('zapis -> wczytanie -> zapis daje identyczny plik JSON', async (t) => {
    const server = await startServer();
    const base = `http://127.0.0.1:${server.address().port}/index.html`;
    const browser = await chromium.launch();
    t.after(async () => { await browser.close(); server.close(); });

    const ctx = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    // 1. Nowa ocena
    await page.goto(base);
    await page.waitForSelector('#hero-new-audit');
    await page.click('#hero-new-audit');
    await page.waitForSelector('input[name="product_choice"]', { state: 'attached' });
    const radios = page.locator('input[name="product_choice"]');
    const count = await radios.count();
    assert.ok(count > 1, 'powinno być więcej niż jeden profil produktu');
    await radios.nth(1).check({ force: true });
    await page.fill('#wizard-product-name', 'Terminal testowy ąęść');
    await page.fill('#wizard-product-desc', 'Opis / wersja 1.0 / https://example.org');
    await page.fill('#wizard-auditor-name', 'Anna Tester');
    await page.click('#generateBtn');
    await page.waitForSelector('.requirement-row', { state: 'attached' });

    // 2. Wypełnienie: statusy i komentarze wymagań oraz testów jednostkowych
    const filled = await page.evaluate(() => {
        const statusVals = ['compliant', 'non-compliant', 'not-applicable'];
        const testVals = ['pass', 'fail', 'na'];
        let rowsSet = 0, testsSet = 0;
        const rows = [...document.querySelectorAll('.requirement-row')].slice(0, 9);
        rows.forEach((row, i) => {
            const radios = row.querySelectorAll('input[type="radio"][name^="status-"]');
            const val = statusVals[i % 3];
            const r = [...radios].find((x) => x.value === val);
            if (r) { r.click(); rowsSet++; }
            const ta = row.querySelector('textarea[name^="comment-"]');
            if (ta) { ta.value = `Komentarz wymagania ${i} „cytat” & <b>`; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        const cards = [...document.querySelectorAll('.checklist-test-item[data-test-id]')].slice(0, 9);
        cards.forEach((card, i) => {
            const radios = card.querySelectorAll('input[type="radio"][name^="test-status-"]');
            const val = testVals[i % 3];
            const r = [...radios].find((x) => x.value === val);
            if (r) { r.click(); testsSet++; }
            const ta = card.querySelector('textarea[name^="test-comment-"]');
            if (ta) { ta.value = `Komentarz testu ${i}\nlinia 2`; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        return { rowsSet, testsSet };
    });
    assert.ok(filled.rowsSet >= 3, `ustawiono tylko ${filled.rowsSet} ocen wymagań`);
    assert.ok(filled.testsSet >= 3, `ustawiono tylko ${filled.testsSet} ocen testów`);

    // 3. Pierwszy zapis
    const first = await saveJson(page);

    // 4. Czysta sesja: wczytaj plik, zapisz ponownie
    const page2 = await (await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' })).newPage();
    page2.on('pageerror', (e) => errors.push(String(e)));
    await page2.goto(base);
    await page2.waitForSelector('#wizard-file-input', { state: 'attached' });
    const tmp = path.join(ROOT, 'tests', '.tmp-first.json');
    fs.writeFileSync(tmp, JSON.stringify(first));
    t.after(() => fs.rmSync(tmp, { force: true }));
    await page2.setInputFiles('#wizard-file-input', tmp);
    await page2.waitForSelector('.requirement-row', { state: 'attached' });
    await page2.waitForTimeout(500);
    const second = await saveJson(page2);

    // 5. Asercje
    assert.deepEqual(errors, [], 'nie powinno być błędów JS: ' + errors.join(' | '));
    const outcomes = (g) => g['@graph'].filter((x) => x['@type'] === 'earl:Assertion')
        .filter((x) => x['earl:result']['earl:outcome']['@id'] !== 'earl:untested').length;
    assert.ok(outcomes(first) >= filled.rowsSet + filled.testsSet, 'pierwszy plik powinien zawierać wszystkie ustawione oceny');
    assert.equal(outcomes(second), outcomes(first), 'liczba ocenionych pozycji po wczytaniu');
    assert.deepEqual(stripTimes(second), stripTimes(first), 'plik po roundtripie powinien być identyczny');
});
