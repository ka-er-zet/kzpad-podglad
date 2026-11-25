// Testy panelu nawigacji (js/nav-panel.js): zawartość, widoki i historia przeglądarki, skrót Alt+M,
// panel wysuwany na węższym ekranie, bieżące miejsce w spisie, podsumowanie, układ bez poziomego przewijania.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { startServer, baseUrl, generateSheet, fillAssessments, goTo } from './helpers.mjs';

let server, browser, url;
before(async () => { server = await startServer(); browser = await chromium.launch(); url = baseUrl(server); });
after(async () => { await browser.close(); server.close(); });

const WIDE = { width: 1440, height: 900 };     // panel obok treści (≥ 1360 px)
const NARROW = { width: 700, height: 760 };    // telefon / wąskie okno: nagłówek z „Menu”, panel jako okno
const MID = { width: 1100, height: 760 };      // średni ekran: listwa ikon, panel tylko nad treścią
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
    for (const name of ['Nowy arkusz oceny', 'Wczytaj zapisany stan (JSON)', 'Przeglądarka wymagań']) {
        assert.equal(await nav.getByRole('button', { name }).count(), 1, name);
    }
    assert.equal(await nav.getByRole('button', { name: 'Widok startowy' }).count(), 0, 'widoku startowego nie ma wśród przycisków: prowadzi do niego logo');
    assert.equal(await p.locator('#np-panel [data-group="sheet"]').count(), 0, 'bez arkusza nie ma grupy „Arkusz oceny”');
    assert.equal(await p.locator('#np-panel .np-brand-link').getAttribute('aria-current'), 'page', 'na starcie logo oznacza bieżący widok');
    const top = await p.evaluate(() => ({
        header: Math.round(document.querySelector('.app-header').getBoundingClientRect().bottom),
        panel: Math.round(document.getElementById('np-panel').getBoundingClientRect().top)
    }));
    assert.equal(top.panel, 0, 'na szerokim ekranie panel zaczyna się u góry okna (przejmuje nagłówek)');
    assert.equal(top.header, 0, 'nagłówek nad treścią nie zajmuje miejsca');

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
    assert.match(await p.title(), /^Arkusz oceny: Terminal testowy/, 'tytuł karty zawiera nazwę ocenianego produktu');

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

test('tytuł karty: widok startowy to nazwa narzędzia, arkusz dostaje nazwę produktu', async () => {
    const p = await newPage();
    await p.goto(url);
    await p.waitForSelector('#np-panel', { state: 'attached' });
    assert.equal(await p.title(), 'Ocena zgodności z Polskim Aktem Dostępności');
    await generateSheet(p);
    await p.waitForFunction(() => document.body.dataset.npView === 'sheet');
    assert.match(await p.title(), /^Arkusz oceny: Terminal testowy/);
    await p.click('.np-brand-link');
    await p.waitForFunction(() => document.body.dataset.npView === 'start');
    assert.equal(await p.title(), 'Ocena zgodności z Polskim Aktem Dostępności');
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

test('filtr: zmiana filtra zachowuje miejsce w arkuszu (to samo wymaganie albo najbliższe pasujące), bez skoków', async () => {
    const p = await newPage();
    await p.goto(url);
    await generateSheet(p);
    await fillAssessments(p, 30);   // pierwsze 30 wymagań ocenionych, dalsze bez oceny
    // numer wymagania, które jest u góry widocznej części arkusza, i jego położenie
    const topRow = () => p.evaluate(() => {
        const hb = document.querySelector('.app-header').getBoundingClientRect().bottom;
        const all = [...document.querySelectorAll('.requirement-row')];
        const row = all.filter((r) => r.offsetParent).find((r) => r.getBoundingClientRect().bottom > hb + 10);
        return { index: all.indexOf(row), top: Math.round(row.getBoundingClientRect().top) };
    });
    const scrollToRow = (i) => p.evaluate((i) => {
        const r = document.querySelectorAll('.requirement-row')[i];
        window.scrollBy(0, r.getBoundingClientRect().top - 150);
    }, i);

    // wymaganie ocenione znika w filtrze „Bez oceny”: ląduje się na najbliższym następnym pasującym, nie w losowym miejscu
    await scrollToRow(15);
    await p.waitForTimeout(200);
    const first = await p.evaluate(() => [...document.querySelectorAll('.requirement-row')].findIndex((r) => !r.querySelector('input[name^="status-"]:checked')));
    await p.selectOption('#np-filter', 'none');
    await p.waitForTimeout(300);
    const afterFilter = await topRow();
    assert.equal(afterFilter.index, first, 'po filtrze: pierwsze wymaganie bez oceny po poprzednim miejscu');
    assert.ok(afterFilter.top >= 0 && afterFilter.top < 80, `wymaganie tuż pod nagłówkiem (jest ${afterFilter.top} px)`);
    // powrót do „Wszystkie” nie przenosi gdzie indziej
    await p.selectOption('#np-filter', 'all');
    await p.waitForTimeout(300);
    const back = await topRow();
    assert.equal(back.index, afterFilter.index, 'po powrocie: to samo wymaganie');
    assert.ok(Math.abs(back.top - afterFilter.top) <= 2, 'to samo miejsce na ekranie');

    // wymaganie, które pasuje do filtra, zostaje na tym samym miejscu ekranu
    await scrollToRow(first + 3);
    await p.waitForTimeout(200);
    const before = await topRow();
    await p.selectOption('#np-filter', 'none');
    await p.waitForTimeout(300);
    const kept = await topRow();
    assert.equal(kept.index, before.index, 'pasujące wymaganie nie zmienia się');
    assert.ok(Math.abs(kept.top - before.top) <= 2, `ta sama pozycja na ekranie (było ${before.top}, jest ${kept.top})`);
    assert.deepEqual(p.errors, []);
    await p.context().close();
});

test('filtr: lista zawiera tylko opcje, do których coś pasuje', async () => {
    const p = await newPage();
    await p.goto(url);
    await generateSheet(p);
    const options = () => p.locator('#np-filter option').evaluateAll((os) => os.map((o) => o.value));
    const filterShown = () => p.locator('#np-panel .np-filter').isVisible();
    const settle = async () => { await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.waitForTimeout(300); };

    // nowy arkusz: nic ocenione — jest tylko „Bez oceny”
    await settle();
    assert.deepEqual(await options(), ['all', 'none']);
    assert.ok(await filterShown());

    // po ocenach pojawia się „Niespełnione”
    await fillAssessments(p, 9);
    await settle();
    const opts = await options();
    assert.ok(opts.includes('non-compliant'), `jest „Niespełnione”: ${opts}`);
    assert.ok(opts.includes('none'), 'nadal są wymagania bez oceny');
    assert.ok(opts.includes('compliant') && opts.includes('not-applicable'), `są też „Spełnione” i „Nie dotyczy”: ${opts}`);
    // „Spełnione” pokazuje dokładnie wymagania ocenione jako spełnione
    const compliantCount = await p.locator('#resultsArea .requirement-row input[name^="status-"][value="compliant"]:checked').count();
    await p.selectOption('#np-filter', 'compliant');
    await p.waitForTimeout(300);
    const shownRows = await p.evaluate(() => [...document.querySelectorAll('.requirement-row')].filter((r) => r.offsetParent).length);
    assert.equal(shownRows, compliantCount, 'filtr „Spełnione” pokazuje tylko spełnione');
    await p.selectOption('#np-filter', 'all');
    await settle();

    // wszystkie ocenione jako spełnione: znikają „Bez oceny”, „Niespełnione” i „Nie dotyczy”
    await p.evaluate(() => {
        document.querySelectorAll('.requirement-row').forEach((row) => {
            const r = row.querySelector('input[type="radio"][name^="status-"][value="compliant"]');
            if (r) r.click();
        });
    });
    await settle();
    assert.deepEqual(await options(), ['all', 'compliant']);
    assert.ok(await filterShown());

    // wybrana opcja, która przestaje pasować, zostaje na liście do czasu zmiany (widok się nie zmienia nagle)
    await p.evaluate(() => {
        const r = document.querySelector('.requirement-row input[type="radio"][name^="status-"][value="non-compliant"]');
        r.click();
    });
    await settle();
    await p.selectOption('#np-filter', 'non-compliant');
    await p.evaluate(() => {
        const r = document.querySelector('.requirement-row input[type="radio"][name^="status-"][value="compliant"]');
        r.click();
    });
    await settle();
    assert.ok((await options()).includes('non-compliant'), 'wybrana opcja zostaje, choć nic już nie pasuje');
    await p.selectOption('#np-filter', 'all');
    await settle();
    assert.deepEqual(await options(), ['all', 'compliant']);
    assert.deepEqual(p.errors, []);
    await p.context().close();
});

test('podsumowanie: „Generuj” zmienia się w „Aktualizuj”, pobranie Excela z oceną i ODT dopiero po wygenerowaniu', async () => {
    const p = await newPage();
    await p.goto(url);
    await generateSheet(p);
    const item = p.locator('#np-panel [data-act="summary"]');
    await item.waitFor();
    assert.equal((await item.textContent()).trim(), 'Generuj podsumowanie');
    assert.equal(await p.locator('#np-panel [data-act="sum-odt"]').isVisible(), false);
    assert.equal(await p.locator('#np-panel [data-act="xlsx"]').isVisible(), false);
    assert.equal(await p.locator('#np-panel [data-act="xlsx-blank"]').isVisible(), true, 'pusty arkusz od razu po wygenerowaniu');
    await item.click();
    await p.waitForTimeout(300);
    assert.equal((await item.textContent()).trim(), 'Aktualizuj podsumowanie');
    assert.equal(await p.locator('#np-panel [data-act="xlsx"]').isVisible(), true);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#np-panel [data-act="sum-odt"]')]);
    assert.match(dl.suggestedFilename(), /\.odt$/);
    assert.deepEqual(p.errors, []);
    await p.context().close();
});

// Zawartość pobranego Excela odczytana tą samą biblioteką ExcelJS, której używa aplikacja
async function readXlsx(p, dl) {
    const b64 = (await readFile(await dl.path())).toString('base64');
    return p.evaluate(async (b64) => {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer);
        const ws = wb.getWorksheet('Ocena szczegółowa');
        const rows = [];
        ws.eachRow((row, i) => { if (i > 9) rows.push({ status: String(row.getCell(3).value ?? ''), comment: String(row.getCell(5).value ?? '') }); });
        return { sheets: wb.worksheets.map((w) => w.name), rows };
    }, b64);
}

test('Excel: pusty arkusz do wypełnienia bez ocen i podsumowania, ocena w Excelu z ocenami', async () => {
    const p = await newPage();
    await p.goto(url);
    await generateSheet(p);
    await fillAssessments(p);
    const [blankDl] = await Promise.all([p.waitForEvent('download'), p.click('#np-panel [data-act="xlsx-blank"]')]);
    assert.match(blankDl.suggestedFilename(), /_do-wypelnienia\.xlsx$/);
    const blank = await readXlsx(p, blankDl);
    assert.deepEqual(blank.sheets, ['Ocena szczegółowa']);
    assert.ok(blank.rows.length > 10, 'są wiersze wymagań');
    assert.deepEqual(blank.rows.filter((r) => r.status !== 'Wybierz...' || r.comment), [], 'brak ocen i komentarzy');

    await p.click('#np-panel [data-act="summary"]');
    await p.waitForTimeout(300);
    const [fullDl] = await Promise.all([p.waitForEvent('download'), p.click('#np-panel [data-act="xlsx"]')]);
    const full = await readXlsx(p, fullDl);
    assert.deepEqual(full.sheets, ['Podsumowanie opisowe', 'Ocena szczegółowa']);
    assert.equal(full.rows.length, blank.rows.length, 'ten sam zakres wymagań');
    assert.ok(full.rows.some((r) => r.status === 'Spełnione') && full.rows.some((r) => r.comment.startsWith('Komentarz')), 'są oceny i komentarze');
    assert.deepEqual(p.errors, []);
    await p.context().close();
});

test('listwa ikon: po zwinięciu na szerokim ekranie; etykiety ikon; spis otwiera panel obok treści w bieżącym miejscu', async () => {
    const p = await newPage();
    await p.goto(url);
    await generateSheet(p);
    await fillAssessments(p);
    await p.click('#np-panel .np-collapse');
    await p.waitForTimeout(350);
    const rail = p.getByRole('navigation', { name: 'Nawigacja aplikacji (zwinięta)' });
    await rail.waitFor();
    assert.equal(await p.locator('[data-rail="expand"]').evaluate((b) => b === document.activeElement), true, 'fokus na „Rozwiń menu”');
    // etykieta ikony: wspólny mechanizm aplikacji, po prawej od ikony, Esc ją zamyka
    const toc = p.locator('[data-rail="toc"]');
    // etykiety chowają się przy przewijaniu strony — czekamy, aż przewijanie po wygenerowaniu arkusza się skończy
    await p.evaluate(() => new Promise((r) => { let last = -1, same = 0; const t = () => { if (scrollY === last) { if (++same > 15) return r(); } else { same = 0; last = scrollY; } requestAnimationFrame(t); }; t(); }));
    await toc.focus();
    const lab = toc.locator('.icon-label');
    assert.equal(await lab.evaluate((l) => l.classList.contains('icon-label--visible')), true);
    assert.equal((await lab.textContent()).trim(), 'Spis arkusza');
    const r = await p.evaluate(() => { const b = document.querySelector('[data-rail="toc"]').getBoundingClientRect(); const l = document.querySelector('[data-rail="toc"] .icon-label').getBoundingClientRect(); return { b: b.right, l: l.left }; });
    assert.ok(r.l > r.b, 'etykieta po prawej od ikony');
    await p.keyboard.press('Escape');
    assert.equal(await lab.evaluate((l) => l.classList.contains('icon-label--visible')), false, 'Esc zamyka etykietę');
    assert.match(await p.locator('[data-rail="sheet"]').getAttribute('aria-label'), /^Arkusz oceny: ocenione \d+ z \d+ wymagań$/);
    // spis: na szerokim ekranie to ten sam panel obok treści co „Rozwiń menu” (nie okno nad treścią),
    // fokus na bieżącej sekcji (na samej górze arkusza żadna sekcja jeszcze nie jest „bieżąca”, więc przewijamy w głąb)
    await p.locator('.requirement-row').nth(3).scrollIntoViewIfNeeded();
    await p.waitForTimeout(200);
    await toc.click();
    await p.waitForFunction(() => document.activeElement && document.activeElement.closest('#np-panel'), null, { timeout: 3000 });
    const st = await p.evaluate(() => ({
        peek: document.body.classList.contains('np-peek'),
        open: document.body.classList.contains('np-open'),
        inert: document.getElementById('main-content').inert,
        backdrop: !document.querySelector('.np-backdrop').hidden,
        focus: document.activeElement.getAttribute('aria-current')
    }));
    assert.deepEqual(st, { peek: false, open: true, inert: false, backdrop: false, focus: 'location' }, 'panel obok treści, treść aktywna, bez przyciemnienia');
    // wybór sekcji nie zamyka panelu obok treści
    await p.locator('#np-panel .np-sec-link').nth(1).click();
    await p.waitForTimeout(300);
    assert.equal(await p.evaluate(() => document.body.classList.contains('np-open')), true, 'panel zostaje otwarty');
    // przycisk zwijania wraca do listwy
    await p.click('#np-panel .np-collapse');
    await p.waitForTimeout(350);
    assert.equal(await p.evaluate(() => document.body.classList.contains('np-open')), false, 'panel zwinięty do listwy');
    assert.deepEqual(p.errors, []);
    await p.context().close();
});

test('listwa: przełącznik motywu jak w nagłówku; ikony czytelne po najechaniu (kontrast ≥ 3:1)', async () => {
    const p = await newPage();
    await p.goto(url);
    await p.click('#np-panel .np-collapse');
    await p.waitForTimeout(400);
    const theme = p.locator('[data-rail="theme"]');
    const before = await p.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const expectLabel = (t) => t === 'dark' ? 'Przełącz motyw na jasny' : 'Przełącz motyw na ciemny';
    assert.equal(await theme.getAttribute('aria-label'), expectLabel(before));
    // kontrast ikony po najechaniu i z fokusem, w obu motywach
    const ratio = () => p.evaluate(() => {
        const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
        const rgb = (c, base) => { cx.fillStyle = base || '#fff'; cx.fillRect(0, 0, 1, 1); cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); return Array.from(cx.getImageData(0, 0, 1, 1).data).slice(0, 3); };
        const hex = (a) => '#' + a.map((x) => x.toString(16).padStart(2, '0')).join('');
        const lum = (a) => { const [r, g, b] = a.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        const b = document.querySelector('[data-rail="theme"]');
        const railBg = hex(rgb(getComputedStyle(document.getElementById('np-rail')).backgroundColor));
        const bg = rgb(getComputedStyle(b).backgroundColor, railBg);
        const fg = rgb(getComputedStyle(b.querySelector('svg')).color, hex(bg));
        const l1 = lum(fg), l2 = lum(bg);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    });
    for (let i = 0; i < 2; i++) {
        await theme.hover();
        assert.ok(await ratio() >= 3, `ikona po najechaniu (${await p.evaluate(() => document.documentElement.getAttribute('data-theme'))}): ${(await ratio()).toFixed(2)}`);
        await theme.click();
        await p.waitForTimeout(150);
        assert.ok(await ratio() >= 3, `ikona z fokusem po kliknięciu: ${(await ratio()).toFixed(2)}`);
        const now = await p.evaluate(() => document.documentElement.getAttribute('data-theme'));
        assert.notEqual(now, i === 0 ? before : undefined);
        assert.equal(await theme.getAttribute('aria-label'), expectLabel(now), 'nazwa mówi, na jaki motyw przełączy');
        assert.equal(await theme.locator('svg').getAttribute('data-lucide'), now === 'dark' ? 'sun' : 'moon');
    }
    assert.deepEqual(p.errors, []);
    await p.context().close();
});

test('średni ekran: listwa zamiast nagłówka, Alt+M wysuwa panel nad treścią i wraca do pola', async () => {
    const p = await newPage(MID);
    await p.goto(url);
    await p.waitForSelector('#np-rail', { state: 'visible' });
    assert.equal(await p.locator('.np-menu-btn').isVisible(), false, 'bez przycisku „Menu” w nagłówku');
    await generateSheet(p);
    const ta = p.locator('.requirement-row').nth(5).locator('textarea[name^="comment-"]');
    await ta.scrollIntoViewIfNeeded();
    await ta.focus();
    const fieldId = await ta.getAttribute('id');
    await p.keyboard.press('Alt+KeyM');
    await p.waitForTimeout(300);
    assert.equal(await p.evaluate(() => document.body.classList.contains('np-peek')), true);
    assert.equal(await p.locator('#np-panel .np-collapse').isVisible(), false, 'na średnim ekranie panelu nie da się zwinąć obok treści: jest tylko nad nią');
    assert.equal(await p.evaluate(() => document.activeElement.getAttribute('aria-current')), 'location');
    await p.keyboard.press('Alt+KeyM');
    await p.waitForTimeout(300);
    assert.equal((await active(p)).id, fieldId, 'powrót do pola');
    const sw = await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    assert.ok(sw, 'bez poziomego przewijania');
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
