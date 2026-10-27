// Uwaga PFRON 7: wyszukiwarka przeglądarki wymagań (MiniSearch + własny stemmer).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startServer, baseUrl } from './helpers.mjs';

const require = createRequire(import.meta.url);
const S = require('../js/search.js');

// ---------------------------------------------------------------------------------------
// Moduł wyszukiwania (bez przeglądarki)
// ---------------------------------------------------------------------------------------

test('stemmer: odmiany jednego słowa dają ten sam rdzeń, bez polskich znaków', () => {
    const groups = [
        ['przycisk', 'przycisku', 'przyciski', 'przycisków', 'przyciskami', 'przyciskach'],
        ['klawiatura', 'klawiatury', 'klawiaturze', 'klawiaturą', 'klawiaturę'],
        ['dostępność', 'dostępności', 'dostępnością', 'dostępnościach'],
        ['sprawdzić', 'sprawdza', 'sprawdzenie', 'sprawdzeniu'],
        ['kontrast', 'kontrastu', 'kontrastów', 'kontrastem'],
        ['ekran', 'ekranu', 'ekranie', 'ekranów'],
    ];
    for (const g of groups) {
        const stems = new Set(g.map(S.stem));
        assert.equal(stems.size, 1, `${g.join(', ')} → ${[...stems].join(' / ')}`);
        assert.ok(/^[a-z]+$/.test([...stems][0]), 'rdzeń bez polskich znaków');
    }
    // nie skracamy do śmieci ani nie ruszamy liczb i kodów
    assert.equal(S.stem('PDF'), 'pdf');
    assert.equal(S.stem('9.1.4.3'), '9.1.4.3');
    assert.equal(S.stem('Łódź'), 'lodz');
    assert.notEqual(S.stem('ekran'), S.stem('ekspert'));
});

test('tokenizer: kody z kropkami jako całość i bez początkowej litery; zapytanie bez wariantów', () => {
    assert.deepEqual(S.tokenize('Zgodność z C.9.1.4.3 i WCAG 2.1'), ['Zgodność', 'z', 'C.9.1.4.3', '9.1.4.3', 'i', 'WCAG', '2.1']);
    assert.deepEqual(S.tokenize('Art. 9 ust. 2, pkt 1.'), ['Art', '9', 'ust', '2', 'pkt', '1']);
    assert.deepEqual(S.tokenize('zero-jedynkowy'), ['zero-jedynkowy', 'zero', 'jedynkowy']);
    assert.deepEqual(S.tokenizeQuery('C.9.1.4.3 U.7.1.1.a art. 9'), ['9.1.4.3', '7.1.1.a', 'art', '9']);
    assert.deepEqual(S.tokenizeQuery('A07-01-01-a'), ['A07-01-01-a'], 'identyfikator A07-… nie jest kodem z literą i kropką');
});

test('treść klauzuli: markdown, encje, znaczniki i testy {title, description} trafiają do tekstu', () => {
    const t = S.clauseBody({
        procedure: ['Sprawdź&nbsp;**kontrast** <img> tekstu'],
        checklist: [{ type: 'test', title: 'Weryfikacja alt', description: ' **Instrukcja:** zbadaj grafikę ' }, 'Zwykły punkt'],
        form: { inputs: [{ label: 'Kryterium A', value: 'aa' }] },
        evaluation: 'Inspekcja'
    });
    for (const w of ['Sprawdź kontrast', 'img', 'Weryfikacja alt', 'Instrukcja: zbadaj grafikę', 'Zwykły punkt', 'Kryterium A', 'Inspekcja']) {
        assert.ok(t.includes(w), `brak „${w}” w: ${t}`);
    }
    assert.ok(!/&nbsp;|\*\*|object Object/.test(t));
});

const DOCS = [
    { id: 'a', ids: 'Art. 9 ust. 2 U.9.02.00', title: 'Kontrast i rozróżnialność przycisków terminala', category: 'Interfejs', codes: 'C.8.8; C.9.1.4.3', body: 'Weryfikacja wzrokowa' },
    { id: 'b', ids: 'Art. 17 pkt 4 U.17.00.04', title: 'Obsługa klawiaturą', category: 'Interfejs', codes: 'C.9.2.1.1', body: 'Sprawdź kontrast fokusu przycisku. Zgodność z 9.1.4.3.' },
    { id: 'c', ids: 'Art. 24 ust. 1 U.24.1.0', title: 'Deklaracja zgodności', category: 'Obowiązki', codes: '', body: 'Dostępność deklaracji w formie elektronicznej' },
];
const idx = S.createIndex(DOCS);
const ids = (q) => idx.search(q).ids;

test('szukanie: słowa w dowolnej kolejności, wielkość liter, polskie znaki, odmiana, prefiks', () => {
    assert.deepEqual(ids('kontrast przycisków'), ['a', 'b']);
    assert.deepEqual(ids('PRZYCISKI KONTRAST'), ['a', 'b']);
    assert.deepEqual(ids('dostepnosc'), ['c']);
    assert.deepEqual(ids('dostępności'), ['c']);
    assert.deepEqual(ids('klawiatur'), ['b']);
    assert.deepEqual(ids('deklar zgodn'), ['c']);
    assert.deepEqual(ids('zgodności deklaracja'), ['c']);
});

test('szukanie: wszystkie słowa muszą wystąpić; słowa pomijane i puste zapytanie', () => {
    assert.deepEqual(ids('kontrast klawiatura'), ['b']);
    assert.deepEqual(ids('kontrast nieistniejące'), []);
    assert.deepEqual(ids('czy kontrast dla przycisków'), ['a', 'b'], 'słowa pomijane („czy”, „dla”) nie zawężają wyników');
    assert.deepEqual(ids(''), []);
    assert.deepEqual(ids('   '), []);
});

test('szukanie: literówki (dłuższe słowa), bez literówek dla krótkich i liczb', () => {
    assert.deepEqual(ids('kontrasst'), ['a', 'b']);
    assert.deepEqual(ids('klawiatora'), ['b']);
    assert.deepEqual(ids('pdx'), []);
    assert.deepEqual(ids('9.1.4.4'), []);
});

test('szukanie: kody i numery — z literą i bez, prefiks numeru', () => {
    assert.deepEqual(ids('9.1.4.3').sort(), ['a', 'b']);
    assert.deepEqual(ids('C.9.1.4.3').sort(), ['a', 'b']);
    assert.deepEqual(ids('C.8.8'), ['a']);
    assert.deepEqual(ids('9.1').sort(), ['a', 'b']);
    assert.deepEqual(ids('art 17 pkt 4'), ['b']);
    assert.deepEqual(ids('U.24.1.0'), ['c']);
});

test('ranking: trafienie w tytule przed trafieniem w treści; informacja, gdzie trafiono', () => {
    const r = idx.search('kontrast');
    assert.deepEqual(r.ids, ['a', 'b'], 'tytuł (a) przed treścią (b)');
    assert.equal(r.matches.get('a').headMatch, true);
    assert.equal(r.matches.get('b').headMatch, false, 'b: tylko w treści');
    assert.ok(r.matches.get('a').terms.has('kontrast'));
});

test('podświetlanie: trafione słowa w <mark>, reszta z ucieczką HTML (bez wstrzykiwania)', () => {
    const r = idx.search('przycisków kontrast');
    const html = S.highlight('Kontrast i rozróżnialność przycisków <img src=x onerror=1> & "x"', r.matches.get('a').terms);
    assert.equal(html, '<mark>Kontrast</mark> i rozróżnialność <mark>przycisków</mark> &lt;img src=x onerror=1&gt; &amp; &quot;x&quot;');
    assert.equal(S.highlight('<b>x</b>', new Set()), '&lt;b&gt;x&lt;/b&gt;');
    assert.equal(S.highlight('Art. 9 ust. 2', idx.search('art 9').matches.get('a').terms), '<mark>Art</mark>. <mark>9</mark> ust. 2');
});

test('odmiana słowa „wynik”', () => {
    const f = (n) => `${n} ${S.pluralResults(n)}`;
    assert.deepEqual([1, 2, 4, 5, 12, 14, 22, 25, 50, 112].map(f),
        ['1 wynik', '2 wyniki', '4 wyniki', '5 wyników', '12 wyników', '14 wyników', '22 wyniki', '25 wyników', '50 wyników', '112 wyników']);
});

// ---------------------------------------------------------------------------------------
// Przeglądarka wymagań w aplikacji
// ---------------------------------------------------------------------------------------

let server, browser, url;
before(async () => { server = await startServer(); browser = await chromium.launch(); url = baseUrl(server); });
after(async () => { await browser.close(); server.close(); });

async function openBrowser() {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const p = await ctx.newPage();
    p.errors = [];
    p.on('pageerror', (e) => p.errors.push(String(e)));
    await p.goto(url);
    await p.click('#hero-browse-requirements');
    await p.waitForSelector('#browser-search', { state: 'visible' });
    return p;
}

const status = (p) => p.textContent('#browser-search-status');
const search = async (p, q) => { await p.fill('#browser-search', q); await p.waitForTimeout(150); };
const cards = (p) => p.evaluate(() => [...document.querySelectorAll('#browser-requirements-list .browser-card')].map((c) => ({
    id: c.querySelector('.browser-card-id').textContent.trim(),
    title: c.querySelector('h3').textContent.trim(),
    marks: [...c.querySelectorAll('.browser-card-id mark, h3 mark')].map((m) => m.textContent),
    note: c.querySelector('.browser-card-match-note')?.textContent || null,
    noteMarks: [...c.querySelectorAll('.browser-card-match-note mark')].map((m) => m.textContent),
})));

test('przeglądarka: słowa w dowolnej kolejności, odmiana, polskie znaki, literówka; podświetlenie i komunikat', async () => {
    const p = await openBrowser();

    await search(p, 'kontrast przycisków');
    let r = await cards(p);
    assert.ok(r.length >= 5);
    assert.match(r[0].id, /Art\. 9 ust\. 2/, 'najlepiej dopasowane: Art. 9 ust. 2 (kontrast przycisków terminala)');
    assert.ok(r[0].marks.length >= 1, 'trafienia podświetlone w nagłówku karty');
    assert.match(await status(p), /^Znaleziono \d+ wyników?\./);
    const first = r;

    await search(p, 'przyciski kontrast');
    r = await cards(p);
    assert.deepEqual(r.map((c) => c.id), first.map((c) => c.id), 'kolejność słów nie ma znaczenia');

    await search(p, 'dostepnosc');
    assert.ok((await cards(p)).length >= 20, 'bez polskich znaków i w innej formie');
    await search(p, 'kontrst');
    assert.ok((await cards(p)).length >= 5, 'literówka');

    await search(p, 'bankomat');
    r = await cards(p);
    assert.ok(r.length >= 1);

    await search(p, 'zzzzqqqq');
    assert.equal((await cards(p)).length, 0);
    assert.equal(await status(p), 'Brak wyników dla podanej frazy.');
    assert.match(await p.textContent('#browser-requirements-list'), /Brak wyników/);

    assert.deepEqual(p.errors, []);
});

test('przeglądarka: fragment treści przy trafieniu tylko w treści, limit 50 wyników i jego komunikat', async () => {
    const p = await openBrowser();
    await search(p, 'sprawdzić');
    const r = await cards(p);
    assert.equal(r.length, 50);
    assert.match(await status(p), /^Znaleziono \d+ wyników, wyświetlono 50 najlepiej dopasowanych\.$/);

    const notes = await (async () => { await search(p, 'kontrast'); return cards(p); })();
    const withNote = notes.filter((c) => c.note);
    const without = notes.filter((c) => !c.note);
    assert.ok(withNote.length > 0 && without.length > 0, 'część wyników trafiona tylko w opisie');
    withNote.forEach((c) => {
        assert.match(c.note, /^W treści: /, 'etykieta fragmentu');
        assert.ok(c.noteMarks.length >= 1, 'fragment treści ma podświetlone trafienie');
        assert.ok(c.note.length < 260, 'fragment jest krótki');
        assert.ok(c.noteMarks.some((m) => /^kontrast/i.test(m)), 'podświetlone słowo to szukane: ' + c.noteMarks);
    });
    assert.ok(notes.indexOf(without[0]) < notes.indexOf(withNote[0]), 'trafienia w tytule przed trafieniami w opisie');
    withNote.forEach((c) => assert.equal(c.marks.length, 0, 'bez podświetlenia, gdy trafienie tylko w opisie: ' + JSON.stringify(c)));
    assert.deepEqual(p.errors, []);
});

test('przeglądarka: widok wg normy — numer klauzuli z literą i bez; powrót po wyczyszczeniu', async () => {
    const p = await openBrowser();
    await p.click('#btn-view-technical');
    await search(p, 'C.9.1.4.3');
    let r = await cards(p);
    assert.ok(r.length >= 1);
    assert.ok(r.some((c) => /9\.1\.4\.3/.test(c.id + c.title)), 'klauzula 9.1.4.3 wśród wyników');
    const a = r.map((c) => c.id);

    await search(p, '9.1.4.3');
    r = await cards(p);
    assert.deepEqual(r.map((c) => c.id), a, 'z literą i bez dają to samo');

    await search(p, '');
    assert.equal(await p.locator('#browser-category-grid').isVisible(), true, 'po wyczyszczeniu wracają kategorie');
    assert.equal(await status(p), '');
    assert.deepEqual(p.errors, []);
});

test('przeglądarka: znaczniki HTML w zapytaniu są tekstem, nie są wstrzykiwane', async () => {
    const p = await openBrowser();
    await search(p, '<img src=x onerror="window.__pwned=1"> kontrast');
    assert.equal(await p.evaluate(() => window.__pwned), undefined);
    assert.equal(await p.locator('#browser-requirements-list img[src="x"]').count(), 0);
    assert.deepEqual(p.errors, []);
});
