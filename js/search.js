/*
 * Wyszukiwarka przeglądarki wymagań (uwaga PFRON 7).
 *
 * Silnik: MiniSearch (MIT, js/minisearch.js). Polska odmiana: własny, prosty stemmer (obcinanie końcówek)
 * — bez kodu z bibliotek na licencjach z obowiązkiem ujawnienia źródeł (patrz KOMPONENTY_OSS.md).
 *
 * Co robi:
 *  - każde słowo zapytania szukane osobno, w dowolnej kolejności (AND),
 *  - bez rozróżniania wielkości liter i polskich znaków („dostepnosc” = „dostępność”),
 *  - odmiana (przyciski/przycisków/przyciskami), początek słowa (prefiks), literówki (fuzzy),
 *  - kody i numery z kropkami jako całość („9.1.4.3”, „C.9.1.4.3”, „U.7.1.1.a”),
 *  - ranking wg pól: kod i tytuł ważniejsze niż treść klauzuli,
 *  - podświetlanie trafionych słów w tekście (bezpiecznie, z ucieczką HTML).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./minisearch.js'));
    else root.OZSearch = factory(root.MiniSearch);
}(typeof self !== 'undefined' ? self : this, function (MiniSearch) {
    'use strict';

    // ---------------------------------------------------------------------------------------
    // Normalizacja i stemmer
    // ---------------------------------------------------------------------------------------

    const FOLD = { 'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z' };

    /** Małe litery bez polskich znaków diakrytycznych. */
    function fold(text) {
        return String(text).toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => FOLD[c]);
    }

    // Końcówki (po fold), od najdłuższych. Obcinana jest jedna, najdłuższa pasująca, o ile zostaje ≥ 3 liter.
    // Prefiks zapytania i tak łapie dłuższe formy w indeksie, więc stemmer może być zachowawczy.
    const SUFFIXES = [
        'owaniem', 'owaniu', 'owania', 'owanie', 'owanym', 'owana', 'owane', 'owany', 'owanych',
        'eniem', 'aniem', 'enia', 'ania', 'enie', 'anie', 'eniu', 'aniu',
        'ujacych', 'ujacego', 'ujacej', 'ujace', 'ujacy', 'ujaca',
        'ami', 'ach', 'owi', 'ego', 'emu', 'ymi', 'imi', 'ych', 'ich', 'iem',
        'ow', 'ie', 'ej', 'om', 'em', 'ym', 'im', 'ia', 'ii', 'ze', 'ce',
        'ic', 'yc', 'ac', 'ec',
        'a', 'e', 'i', 'o', 'u', 'y', 'm'
    ].sort((a, b) => b.length - a.length);

    const MIN_STEM = 3;
    const MIN_WORD_FOR_STEM = 4;

    /** Prosty stemmer polski. Zwraca formę bez polskich znaków. Liczb i kodów (z cyfrą) nie rusza. */
    function stem(word) {
        const w = fold(word);
        if (/\d/.test(w) || w.length < MIN_WORD_FOR_STEM) return w;
        for (const s of SUFFIXES) {
            // długie końcówki (-anie, -owany…) tylko, gdy zostaje ≥ 4 liter („ekranie” → „ekran”, nie „ekr”)
            const min = s.length >= 4 ? MIN_STEM + 1 : MIN_STEM;
            if (w.length - s.length >= min && w.endsWith(s)) return normalizeStem(w.slice(0, -s.length));
        }
        return normalizeStem(w);
    }

    // „dostępność” i „dostępności” mają dać ten sam rdzeń (-ość / -ości).
    function normalizeStem(st) {
        return st.endsWith('osci') ? st.slice(0, -1) : st;
    }

    // Słowa pomijane (bardzo częste, bez znaczenia dla szukania). „nie” zostaje (np. „nie dotyczy”).
    const STOP_WORDS = new Set([
        'i', 'w', 'z', 'ze', 'na', 'do', 'o', 'u', 'od', 'po', 'za', 'dla', 'oraz', 'lub', 'albo', 'czy',
        'jest', 'sa', 'to', 'sie', 'ze', 'jak', 'przez', 'ktory', 'ktora', 'ktore', 'ktorych', 'tez'
    ].map(fold));

    // ---------------------------------------------------------------------------------------
    // Tokenizacja
    // ---------------------------------------------------------------------------------------

    // Słowo, ewentualnie z łącznikami/kropkami w środku (kody: 9.1.4.3, C.9.1.4.3, U.7.1.1.a, A07-01-01-a).
    const TOKEN_RE = /[\p{L}\p{N}]+(?:[._-][\p{L}\p{N}]+)*/gu;

    /**
     * Warianty jednego „surowego” tokenu (jako termy indeksu, przed stemmingiem):
     *  - zwykłe słowo → samo słowo,
     *  - złożone bez cyfr (np. „zero-jedynkowy”) → całość i części,
     *  - z cyfrą (kod) → całość oraz wersja bez początkowej litery („c.9.1.4.3” → „9.1.4.3”).
     */
    function tokenVariants(raw) {
        if (!/[._-]/.test(raw)) return [raw];
        const out = [raw];
        if (/\d/.test(raw)) {
            const m = raw.match(/^[\p{L}]{1,2}[._-](.+)$/u);
            if (m && /\d/.test(m[1])) out.push(m[1]);
        } else {
            raw.split(/[._-]/).forEach((p) => { if (p) out.push(p); });
        }
        return out;
    }

    /**
     * Tokeny zapytania: bez wariantów (słowa zapytania łączone są przez AND, więc warianty by je zawęziły).
     * Kod z początkową literą („C.9.1.4.3”, „U.7.1.1.a”) szukany bez niej — pasuje do obu zapisów w tekście.
     */
    function tokenizeQuery(text) {
        const out = [];
        for (const raw of (String(text).match(TOKEN_RE) || [])) {
            const m = /\d/.test(raw) && raw.match(/^[\p{L}]{1,2}[._-](.+)$/u);
            out.push(m && /\d/.test(m[1]) ? m[1] : raw);
        }
        return out;
    }

    /** Termy indeksu dla tekstu: warianty tokenów, po stemmingu, bez słów pomijanych. */
    function tokenize(text) {
        const out = [];
        const matches = String(text).match(TOKEN_RE) || [];
        for (const raw of matches) {
            for (const v of tokenVariants(raw)) out.push(v);
        }
        return out;
    }

    function processTerm(term) {
        const t = stem(term);
        if (!t || STOP_WORDS.has(t)) return null; // null = pomiń
        return t;
    }

    // ---------------------------------------------------------------------------------------
    // Przygotowanie tekstu dokumentów
    // ---------------------------------------------------------------------------------------

    /** Zwykły tekst z treści klauzuli: bez markdownu, encji i znaczników. */
    function plainText(value) {
        if (value == null) return '';
        let t = String(value);
        t = t.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"');
        t = t.replace(/[<>]/g, ' ');            // „<img>” → „img”
        t = t.replace(/[*_`#]+/g, ' ');         // znaczniki markdownu
        return t.replace(/\s+/g, ' ').trim();
    }

    /** Spłaszcza pole klauzuli (tekst, lista tekstów, lista testów {title, description}, formularz). */
    function flatten(value) {
        if (value == null) return '';
        if (Array.isArray(value)) return value.map(flatten).filter(Boolean).join(' ');
        if (typeof value === 'object') {
            const parts = [];
            if (value.title) parts.push(value.title);
            if (value.description) parts.push(value.description);
            if (value.label) parts.push(value.label);
            if (value.value) parts.push(value.value);
            if (value.inputs) parts.push(flatten(value.inputs));
            return parts.map(plainText).filter(Boolean).join(' ');
        }
        return plainText(value);
    }

    /** Treść klauzuli z clauses.json jako jeden tekst do przeszukania. */
    function clauseBody(entry) {
        if (!entry) return '';
        return [
            flatten(entry.preconditions), flatten(entry.procedure), flatten(entry.checklist),
            flatten(entry.notes), flatten(entry.evaluation), flatten(entry.form)
        ].filter(Boolean).join(' ');
    }

    // ---------------------------------------------------------------------------------------
    // Indeks
    // ---------------------------------------------------------------------------------------

    const FIELDS = ['ids', 'title', 'category', 'codes', 'body'];
    const BOOST = { ids: 5, title: 4, category: 2, codes: 2, body: 1 };
    const HEAD_FIELDS = new Set(['ids', 'title', 'category', 'codes']);

    /**
     * @param {Array<{id:string, ids?:string, title?:string, category?:string, codes?:string, body?:string}>} docs
     */
    function createIndex(docs) {
        const ms = new MiniSearch({
            idField: 'id',
            fields: FIELDS,
            storeFields: [],
            tokenize,
            processTerm,
            searchOptions: { boost: BOOST, tokenize: tokenizeQuery }
        });
        ms.addAll(docs);
        return {
            size: docs.length,
            /**
             * @returns {{ids: string[], matches: Map<string, {terms:Set<string>, headMatch:boolean}>}}
             *          ids — id dokumentów od najlepiej dopasowanych; matches — trafione termy i czy trafienie
             *          jest w kodzie/tytule/kategorii (a nie tylko w treści klauzuli).
             */
            search(query) {
                const q = String(query || '').trim();
                if (!q) return { ids: [], matches: new Map(), terms: [] };
                const hits = ms.search(q, {
                    prefix: true,
                    // literówki tylko dla dłuższych słów bez cyfr
                    fuzzy: (term) => (/\d/.test(term) || term.length < 5) ? false : 0.2,
                    combineWith: 'AND',
                    boost: BOOST,
                    tokenize: tokenizeQuery,
                    weights: { fuzzy: 0.35, prefix: 0.7 }
                });
                const matches = new Map();
                hits.forEach((h) => {
                    const terms = new Set(h.terms);
                    let head = false;
                    for (const t of Object.keys(h.match)) {
                        if (h.match[t].some((f) => HEAD_FIELDS.has(f))) head = true;
                    }
                    matches.set(h.id, { terms, headMatch: head });
                });
                return { ids: hits.map((h) => h.id), matches };
            }
        };
    }

    // ---------------------------------------------------------------------------------------
    // Podświetlanie
    // ---------------------------------------------------------------------------------------

    const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => HTML_ESC[c]);

    /**
     * Zwraca bezpieczny HTML: tekst z ucieczką znaków HTML, a słowa pasujące do trafionych termów
     * zawinięte w <mark>. `terms` — zbiór termów indeksu zwróconych przez search().
     */
    function highlight(text, terms) {
        const src = String(text == null ? '' : text);
        if (!terms || terms.size === 0) return escapeHtml(src);
        let out = '';
        let last = 0;
        TOKEN_RE.lastIndex = 0;
        let m;
        while ((m = TOKEN_RE.exec(src)) !== null) {
            const raw = m[0];
            const hit = tokenVariants(raw).some((v) => {
                const p = processTerm(v);
                return p && terms.has(p);
            });
            out += escapeHtml(src.slice(last, m.index));
            out += hit ? `<mark>${escapeHtml(raw)}</mark>` : escapeHtml(raw);
            last = m.index + raw.length;
        }
        return out + escapeHtml(src.slice(last));
    }

    /** Odmiana: 1 wynik, 2–4 wyniki, 5+ wyników. */
    function pluralResults(n) {
        if (n === 1) return 'wynik';
        const last = n % 10, lastTwo = n % 100;
        if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return 'wyniki';
        return 'wyników';
    }

    return { fold, stem, tokenize, tokenizeQuery, processTerm, plainText, flatten, clauseBody, createIndex, highlight, escapeHtml, pluralResults };
}));
