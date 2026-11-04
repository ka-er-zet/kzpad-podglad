// Uwagi PFRON 3 i 9: badge oceny wymagania oraz rozbieżność oceny wymagania z oceną proponowaną
// na podstawie testów (komunikat, wymagane uzasadnienie, podsumowanie, eksporty, zapis/odczyt).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { startServer, baseUrl, generateSheet, saveJson, ROOT } from './helpers.mjs';

let server, browser, url;
before(async () => { server = await startServer(); browser = await chromium.launch(); url = baseUrl(server); });
after(async () => { await browser.close(); server.close(); });

async function newPage() {
    const ctx = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    p.errors = [];
    p.on('pageerror', (e) => p.errors.push(String(e)));
    return p;
}

/** Indeks pierwszego wymagania z testami. */
const firstRowWithTests = (p) => p.evaluate(() =>
    [...document.querySelectorAll('.requirement-row')].findIndex((r) => r.querySelector('.checklist-test-item[data-test-id]')));

/** Ustawia ocenę pierwszego testu i ocenę wymagania (jak użytkownik — kliknięcie). */
async function setRow(p, idx, { test: testVal, status }) {
    await p.evaluate(({ idx, testVal, status }) => {
        const row = document.querySelectorAll('.requirement-row')[idx];
        if (testVal) row.querySelector(`.checklist-test-item input[type="radio"][value="${testVal}"]`).click();
        if (status) [...row.querySelectorAll('input[type="radio"][name^="status-"]')].find((x) => x.value === status).click();
    }, { idx, testVal, status });
}

const rowState = (p, idx) => p.evaluate((idx) => {
    const row = document.querySelectorAll('.requirement-row')[idx];
    const box = row.querySelector('.assessment-discrepancy');
    const ta = row.querySelector('.assessment-section textarea[name^="comment-"]');
    const label = row.querySelector(`label[for="${ta.id}"]`);
    const badge = row.querySelector('.requirement-status-badge');
    return {
        proposal: row.querySelector('.test-summary-assessment').textContent.replace(/\s+/g, ' ').trim(),
        boxVisible: !box.hidden && box.getBoundingClientRect().height > 0,
        boxText: box.querySelector('.assessment-discrepancy-text').textContent,
        missingVisible: box.querySelector('.assessment-discrepancy-text').textContent.endsWith('Brak uzasadnienia — uzupełnij komentarz.'),
        missingCount: (box.textContent.match(/uzasadni/gi) || []).length,
        badge: badge.textContent, badgeStatus: badge.dataset.status, badgeHidden: badge.getAttribute('aria-hidden'),
        label: label.textContent.trim(),
        required: ta.getAttribute('aria-required'), invalid: ta.getAttribute('aria-invalid'),
        describedby: ta.getAttribute('aria-describedby'), boxId: box.id,
        legend: row.querySelector('.assessment-section legend').textContent,
    };
}, idx);

test('rozbieżność: komunikat, badge, wymagane uzasadnienie, błąd dopiero po opuszczeniu pola', async () => {
    const p = await newPage();
    await p.goto(url);
    await generateSheet(p);
    const idx = await firstRowWithTests(p);
    assert.ok(idx >= 0, 'arkusz powinien mieć wymaganie z testami');

    let s = await rowState(p, idx);
    assert.equal(s.badge, 'Brak oceny');
    assert.equal(s.badgeHidden, 'true', 'badge ukryty przed czytnikami');
    assert.equal(s.proposal, '', 'bez ocenionych testów brak propozycji');
    assert.equal(s.boxVisible, false);

    // Ocena wymagania bez ocenionych testów — brak rozbieżności
    await setRow(p, idx, { status: 'compliant' });
    s = await rowState(p, idx);
    assert.equal(s.badge, 'Spełnione'); assert.equal(s.badgeStatus, 'compliant');
    assert.equal(s.boxVisible, false); assert.equal(s.required, null); assert.equal(s.label, 'Komentarz');

    // Test niespełniony → propozycja „Niespełnione”, rozbieżność z wybranym „Spełnione”
    await setRow(p, idx, { test: 'fail' });
    s = await rowState(p, idx);
    assert.match(s.proposal, /^Proponowana ocena wymagania: Niespełnione/);
    assert.equal(s.boxVisible, false, 'ramka widoczna dopiero jako błąd (brak uzasadnienia), nie od razu');
    assert.equal(s.boxText, 'Wybrana ocena (Spełnione) jest inna niż proponowana na podstawie testów (Niespełnione). Uzasadnij ją w komentarzu.');
    assert.equal(s.label, 'Komentarz — uzasadnienie oceny (wymagane)');
    assert.equal(s.required, 'true');
    assert.equal(s.describedby, s.boxId);
    assert.equal(s.invalid, null, 'bez błędu od razu po pojawieniu się rozbieżności');
    assert.equal(s.missingVisible, false);
    await p.waitForTimeout(100);
    const announced = await p.textContent('#generation-announcement');
    assert.match(announced, /jest inna niż proponowana/, 'zmiana ogłoszona czytnikom');

    // Wejście w puste pole i wyjście → błąd
    const ta = p.locator('.requirement-row').nth(idx).locator('.assessment-section textarea[name^="comment-"]');
    await ta.focus();
    await p.locator('#wizard-product-name').focus();
    s = await rowState(p, idx);
    assert.equal(s.invalid, 'true');
    assert.equal(s.missingVisible, true);
    assert.equal(s.boxText, 'Błąd: wybrana ocena (Spełnione) jest inna niż proponowana na podstawie testów (Niespełnione). Brak uzasadnienia — uzupełnij komentarz.');
    assert.equal(s.boxVisible, true, 'brak uzasadnienia: komunikat błędu widoczny');
    assert.equal(s.missingCount, 1, 'jedno zdanie o uzasadnieniu, bez dublowania');

    // Same spacje to wciąż brak uzasadnienia
    await ta.fill('   ');
    await p.locator('#wizard-product-name').focus();
    s = await rowState(p, idx);
    assert.equal(s.invalid, 'true');

    // Uzupełnienie → błąd znika od razu
    await ta.fill('Test nie dotyczy tej wersji');
    s = await rowState(p, idx);
    assert.equal(s.invalid, null);
    assert.equal(s.boxVisible, false, 'komunikat błędu znika po uzupełnieniu');
    assert.equal(s.missingVisible, false);
    assert.equal(s.required, 'true');

    // Ocena zgodna z propozycją → wszystko wraca do normy
    await setRow(p, idx, { status: 'non-compliant' });
    s = await rowState(p, idx);
    assert.equal(s.boxVisible, false);
    assert.equal(s.label, 'Komentarz');
    assert.equal(s.required, null); assert.equal(s.describedby, null);
    assert.equal(s.badge, 'Niespełnione');

    // Wszystkie testy „Nie dotyczy” → propozycja „Nie dotyczy”
    await setRow(p, idx, { test: 'na' });
    s = await rowState(p, idx);
    assert.match(s.proposal, /Proponowana ocena wymagania: Nie dotyczy/);
    assert.equal(s.boxVisible, false, 'uzasadnienie jest, więc bez komunikatu błędu');
    assert.equal(s.required, 'true', 'rozbieżność trwa (uzasadnienie wymagane)');

    assert.deepEqual(p.errors, []);
});

test('podsumowanie i eksporty pokazują rozbieżności; zapis i odczyt JSON odtwarza stan', async () => {
    const p = await newPage();
    await p.goto(url);
    await generateSheet(p);
    const idxs = await p.evaluate(() => [...document.querySelectorAll('.requirement-row')]
        .map((r, i) => (r.querySelector('.checklist-test-item[data-test-id]') ? i : -1)).filter((i) => i >= 0).slice(0, 3));
    assert.equal(idxs.length, 3);
    // A: rozbieżność bez uzasadnienia; B: rozbieżność z uzasadnieniem; C: zgodna
    await setRow(p, idxs[0], { test: 'fail', status: 'compliant' });
    await setRow(p, idxs[1], { test: 'pass', status: 'non-compliant' });
    await p.locator('.requirement-row').nth(idxs[1]).locator('.assessment-section textarea[name^="comment-"]').fill('Uzasadnienie B');
    await setRow(p, idxs[2], { test: 'pass', status: 'compliant' });

    await p.evaluate(() => generateDescriptiveSummary());
    await p.waitForSelector('.summary-discrepancy-warning');
    const sum = await p.evaluate(() => {
        const sec = document.querySelector('.summary-discrepancy-warning');
        return { items: [...sec.querySelectorAll('li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
                 heading: sec.querySelector('h3').textContent };
    });
    assert.equal(sum.items.length, 2);
    assert.match(sum.items[0], /wybrana: Spełnione, proponowana: Niespełnione; brak uzasadnienia$/);
    assert.match(sum.items[1], /wybrana: Niespełnione, proponowana: Spełnione$/);
    let a = await rowState(p, idxs[0]);
    assert.equal(a.invalid, 'true', 'generowanie podsumowania pokazuje błąd w polu bez uzasadnienia');
    assert.equal((await rowState(p, idxs[1])).invalid, null);

    // XLSX
    const [dl] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => downloadWizardSpreadsheet(true))]);
    const xlsxPath = path.join(ROOT, 'tests', '.tmp-discrepancy.xlsx');
    await dl.saveAs(xlsxPath);
    const py = `
import openpyxl, sys, json
wb = openpyxl.load_workbook(sys.argv[1])
ws = wb['Ocena szczegółowa']
hdr = None; rows = []
for r in ws.iter_rows(values_only=True):
    if r and r[0] == 'Artykuł' and hdr is None: hdr = list(r); continue
    if hdr and r[0]: rows.append([c if c is not None else '' for c in r])
summ = [r[0] for r in wb['Podsumowanie opisowe'].iter_rows(values_only=True) if r and r[0]]
print(json.dumps({'hdr': hdr, 'rows': rows, 'summ': summ}, ensure_ascii=False))
`;
    let x;
    try { x = JSON.parse(execFileSync('python3', ['-c', py, xlsxPath], { encoding: 'utf8' })); }
    finally { fs.rmSync(xlsxPath, { force: true }); }
    assert.deepEqual(x.hdr, ['Artykuł', 'Wymaganie', 'Ocena spełnienia', 'Ocena proponowana (na podstawie testów)', 'Komentarz']);
    const art = await p.evaluate((idxs) => idxs.map((i) => document.querySelectorAll('.requirement-row')[i]
        .querySelector('.requirement-id span[aria-hidden="true"]').textContent.trim()), idxs);
    const byArt = (a) => x.rows.find((r) => r[0] === a);
    assert.equal(byArt(art[0])[2], 'Spełnione');
    assert.equal(byArt(art[0])[3], 'Niespełnione\nInna niż wybrana ocena — brak uzasadnienia');
    assert.equal(byArt(art[1])[3], 'Spełnione\nInna niż wybrana ocena');
    assert.equal(byArt(art[1])[4], 'Uzasadnienie B');
    assert.equal(byArt(art[2])[3], 'Spełnione');
    assert.ok(x.summ.some((t) => t.includes('Oceny inne niż proponowane na podstawie testów')));
    assert.ok(x.summ.some((t) => t.startsWith('Ocena inna niż proponowana na podstawie testów (proponowana: Niespełnione) — brak uzasadnienia')));

    // ODT
    const [dl2] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => downloadSummaryODT())]);
    const odtPath = await dl2.path();
    const content = execFileSync('python3', ['-c', 'import zipfile,sys;print(zipfile.ZipFile(sys.argv[1]).read("content.xml").decode())', odtPath], { encoding: 'utf8' });
    assert.ok(content.includes('Oceny inne niż proponowane na podstawie testów'));
    assert.ok(content.includes('Ocena inna niż proponowana na podstawie testów (proponowana: Niespełnione) — brak uzasadnienia.'));
    assert.ok(content.includes('Ocena inna niż proponowana na podstawie testów (proponowana: Spełnione).'));

    // Zapis JSON i odczyt w nowej karcie
    const saved = await saveJson(p);
    const p2 = await newPage();
    await p2.goto(url);
    await p2.waitForSelector('#wizard-file-input', { state: 'attached' });
    const tmp = path.join(ROOT, 'tests', '.tmp-discrepancy.json');
    fs.writeFileSync(tmp, JSON.stringify(saved));
    try {
        await p2.setInputFiles('#wizard-file-input', tmp);
        await p2.waitForSelector('.requirement-row', { state: 'attached' });
        await p2.waitForTimeout(500);
    } finally { fs.rmSync(tmp, { force: true }); }
    a = await rowState(p2, idxs[0]);
    assert.match(a.boxText, /jest inna niż proponowana/, 'rozbieżność odtworzona po wczytaniu (opis dla czytnika)');
    assert.equal(a.boxVisible, true, 'po wczytaniu odtwarza się podsumowanie, które pokazuje błąd braku uzasadnienia');
    assert.equal(a.badge, 'Spełnione');
    assert.match(a.proposal, /Proponowana ocena wymagania: Niespełnione/);
    assert.equal(a.required, 'true');
    const c = await rowState(p2, idxs[2]);
    assert.equal(c.boxVisible, false);
    assert.equal(c.badge, 'Spełnione');

    assert.deepEqual(p.errors, []);
    assert.deepEqual(p2.errors, []);
});
