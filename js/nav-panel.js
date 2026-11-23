/* Panel nawigacji OZ-PAD (panel boczny / panel główny).
   - Panel jest zawsze dostępny i zwijany przyciskiem „Menu” w nagłówku (skrót Alt+M).
   - Szeroki ekran (≥ 1360 px i > 500 px wysokości): panel obok treści; zwinięcie zapamiętywane w przeglądarce.
   - Węższy lub niski ekran: panel wysuwany nad treścią (okno modalne: fokus w panelu, Esc zamyka, reszta strony nieaktywna).
   - Zawartość: Opcje główne, Kopie robocze (gdy są), Arkusz oceny (postęp, akcje, podsumowanie, nawigacja po arkuszu).
   - Widoki panelu głównego (start / nowy arkusz / arkusz / przeglądarka) mają adresy (#start, #nowy-arkusz, #arkusz, #wymagania),
     więc działają Wstecz / Dalej w przeglądarce.
   Panel nie zmienia logiki oceny: korzysta z funkcji i elementów wizard.js oraz session.js. */
(function () {
    'use strict';

    const STATUS_LABEL = { 'compliant': 'Spełnione', 'non-compliant': 'Niespełnione', 'not-applicable': 'Nie dotyczy', 'none': 'Brak oceny' };
    const SVG = (d) => `<svg viewBox="0 0 16 16" width="16" height="16" focusable="false">${d}</svg>`;
    const STATUS_ICON = {
        'compliant': SVG('<path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
        'non-compliant': SVG('<path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
        'not-applicable': SVG('<path d="M4 8h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
        'none': SVG('<circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2"/>')
    };
    const FILTERS = [
        { value: 'all', label: 'Wszystkie' },
        { value: 'none', label: 'Bez oceny' },
        { value: 'non-compliant', label: 'Niespełnione' },
        { value: 'justify', label: 'Wymagają uzasadnienia' }
    ];
    const WIDE = window.matchMedia('(min-width: 1360px) and (min-height: 501px)');
    const LS_PANEL = 'oz-pad:panel-collapsed';
    const LS_GROUPS = 'oz-pad:panel-groups';

    let panel, toggleBtn, backdrop, model = [], currentId = null, filter = 'all';
    let groupState = {}, openSections = new Set();
    const pending = new Set();

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* bez pamięci */ } };
    const icons = () => { if (typeof lucide !== 'undefined') lucide.createIcons(); };

    function schedule(fn) {
        if (pending.has(fn)) return;
        pending.add(fn);
        requestAnimationFrame(() => { pending.delete(fn); fn(); });
    }

    // ---------------------------------------------------------------------------------
    // Szkielet panelu
    // ---------------------------------------------------------------------------------
    function group(id, title, inner, extra = '') {
        // Domyślnie zwinięte: kopie robocze (lista bywa długa); reszta rozwinięta. Wybór użytkownika jest zapamiętany.
        const DEFAULT_CLOSED = ['drafts'];
        const open = id in groupState ? groupState[id] !== false : !DEFAULT_CLOSED.includes(id);
        return `
            <div class="np-group${extra.includes('data-nested') ? ' np-subgroup' : ''}" data-group="${id}"${extra}>
                <div id="np-${id}-h" class="np-group-h">
                    <button type="button" class="np-group-toggle" aria-expanded="${open}" aria-controls="np-${id}-body">
                        <i data-lucide="chevron-right" class="np-chevron" aria-hidden="true"></i>
                        <span class="np-group-title">${title}</span>
                    </button>
                </div>
                <div id="np-${id}-body" class="np-group-body"${open ? '' : ' hidden'}>${inner}</div>
            </div>`;
    }

    function item(act, icon, label, extra = '') {
        return `<li><button type="button" class="np-item" data-act="${act}"${extra}><i data-lucide="${icon}" aria-hidden="true"></i><span>${label}</span></button></li>`;
    }

    function buildShell() {
        try { groupState = JSON.parse(lsGet(LS_GROUPS) || '{}'); } catch (e) { groupState = {}; }

        const header = $('.app-header');
        // Przycisk „Menu” w nagłówku (przed logo)
        toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'outline secondary np-menu-btn';
        toggleBtn.setAttribute('aria-controls', 'np-panel');
        toggleBtn.innerHTML = '<i data-lucide="panel-left" aria-hidden="true"></i><span>Menu</span><kbd class="np-kbd" aria-hidden="true">Alt+M</kbd>';
        toggleBtn.setAttribute('aria-keyshortcuts', 'Alt+M');
        toggleBtn.title = 'Menu (Alt+M — przejście do menu z dowolnego miejsca)';
        $('.header-content', header).prepend(toggleBtn);
        header.classList.add('np-header');

        panel = document.createElement('div');
        panel.setAttribute('role', 'navigation');
        panel.id = 'np-panel';
        panel.className = 'np-panel';
        panel.setAttribute('aria-label', 'Nawigacja aplikacji');
        panel.innerHTML = `
            <div class="np-panel-bar">
                <span class="np-panel-bar-title" aria-hidden="true">Menu</span>
                <button type="button" class="np-close" aria-label="Zamknij menu" title="Zamknij menu"><i data-lucide="x" aria-hidden="true"></i></button>
            </div>
            <div class="np-scroll">
                ${group('main', 'Opcje główne', `<ul class="np-list">
                    ${item('home', 'house', 'Widok startowy')}
                    ${item('new', 'file-plus-2', 'Nowy arkusz oceny')}
                    ${item('load', 'upload', 'Wczytaj zapisany stan (JSON)')}
                    ${item('browse', 'library-big', 'Przeglądarka wymagań')}
                </ul>`)}
                <div id="np-drafts-slot"></div>
                <div id="np-sheet-slot"></div>
            </div>`;
        header.after(panel); // w kolejności fokusu zaraz po nagłówku, przed treścią

        backdrop = document.createElement('div');
        backdrop.className = 'np-backdrop';
        backdrop.hidden = true;
        document.body.appendChild(backdrop);

        toggleBtn.addEventListener('click', () => setOpen(!isOpen(), true));
        panel.querySelector('.np-close').addEventListener('click', () => setOpen(false, true));
        const setTop = () => { const h = header.getBoundingClientRect(); document.documentElement.style.setProperty('--pp-top', Math.max(0, h.bottom) + 'px'); };
        setTop();
        window.addEventListener('resize', setTop);
        window.addEventListener('scroll', () => schedule(setTop), { passive: true });
        backdrop.addEventListener('click', () => setOpen(false, true));
        panel.addEventListener('click', onPanelClick);
        panel.addEventListener('change', (e) => { if (e.target.id === 'np-filter') { filter = e.target.value; applyFilter(true); } });
        document.addEventListener('keydown', (e) => {
            // Skrót Alt+M: przejście do menu z dowolnego miejsca (e.code — niezależnie od układu klawiatury)
            if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyM') {
                e.preventDefault();
                if (panel.contains(document.activeElement)) returnToContent(true);
                else focusMenu();
                return;
            }
            if (e.key !== 'Escape' || !panel.contains(document.activeElement)) return;
            if (document.activeElement.id === 'np-filter') return;   // Esc w liście rozwijanej zamyka listę
            e.preventDefault();
            returnToContent();
        });
        WIDE.addEventListener('change', () => applyMode());
        applyMode();
        // Animacje dopiero po pierwszym wyświetleniu (bez „wjeżdżania” panelu przy ładowaniu strony)
        requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('np-anim')));
        renderDrafts();
        icons();
    }

    // ---------------------------------------------------------------------------------
    // Otwieranie / zwijanie panelu
    // ---------------------------------------------------------------------------------
    function isOpen() { return document.body.classList.contains('np-open'); }

    function setOpen(open, user) {
        document.body.classList.toggle('np-open', open);
        toggleBtn.setAttribute('aria-expanded', String(open));
        toggleBtn.querySelector('span').textContent = open ? 'Zwiń menu' : 'Menu';
        const modal = !WIDE.matches;
        // Szeroki ekran: panel po prostu znika. Mniejszy: wysuwa się z boku (widoczność sterowana w CSS, z animacją)
        panel.hidden = false;   // widoczność i animacja w CSS (body.np-open)
        backdrop.hidden = !(open && modal);
        // Okno modalne na wąskim ekranie: reszta strony nieaktywna
        ['main-content'].forEach(id => { const el = document.getElementById(id); if (el) el.inert = open && modal; });
        $$('.app-footer, #toast-container').forEach(el => { el.inert = open && modal; });
        if (WIDE.matches && user) lsSet(LS_PANEL, open ? '0' : '1');
        if (user && open && modal) { const f = panel.querySelector('.np-close'); if (f) f.focus(); }
        if (user && !open && modal) toggleBtn.focus();
        if (open) updateCurrent(true);
    }

    function applyMode() {
        document.body.classList.toggle('np-wide', WIDE.matches);
        if (WIDE.matches) setOpen(lsGet(LS_PANEL) !== '1', false);
        else setOpen(false, false);
    }

    // Skrót klawiaturowy: do menu i z powrotem do miejsca w treści
    let returnFocus = null;
    function focusMenu() {
        const ae = document.activeElement;
        returnFocus = (ae && ae !== document.body && !panel.contains(ae)) ? ae : null;
        if (!isOpen()) { setOpen(true, false); if (WIDE.matches) lsSet(LS_PANEL, '0'); }
        updateCurrent(true);
        requestAnimationFrame(() => {
            const vis = (el) => el && el.offsetParent !== null;
            const cur = [...panel.querySelectorAll('[aria-current]')].find(vis);
            const first = [...panel.querySelectorAll('.np-item, .np-group-toggle')].find(vis);
            (cur || first || panel.querySelector('.np-close')).focus();
        });
    }
    /** collapse: Alt+M zwija też panel na dużym ekranie (Esc tylko wraca do treści). */
    function returnToContent(collapse) {
        const modal = !WIDE.matches;
        if (modal) setOpen(false, false);
        else if (collapse) { setOpen(false, false); lsSet(LS_PANEL, '1'); }
        const t = returnFocus && document.contains(returnFocus) && returnFocus.offsetParent !== null ? returnFocus : null;
        returnFocus = null;
        if (t) t.focus();
        else if (modal) toggleBtn.focus();
        else { const m = document.getElementById('main-content'); if (m) { m.tabIndex = -1; m.focus(); } }
    }

    function closeIfModal() { if (!WIDE.matches && isOpen()) setOpen(false, false); }

    // ---------------------------------------------------------------------------------
    // Akcje
    // ---------------------------------------------------------------------------------
    function onPanelClick(e) {
        const gt = e.target.closest('.np-group-toggle');
        if (gt) { toggleDisclosure(gt, 'group'); return; }
        const st = e.target.closest('.np-sec-toggle');
        if (st) { toggleDisclosure(st, 'sec'); return; }

        const link = e.target.closest('a[data-target]');
        if (link) {
            e.preventDefault();
            const id = link.getAttribute('data-target');
            closeIfModal();
            const fromBrowser = !hiddenEl('browser-section');
            goSheet(false);
            // Po powrocie z przeglądarki aplikacja sama przenosi do ostatnio edytowanego pola — skok z panelu musi być po nim
            const jump = () => { if (typeof scrollToRequirement === 'function') scrollToRequirement(id); };
            if (fromBrowser) setTimeout(jump, 450); else requestAnimationFrame(jump);
            return;
        }
        const draftBtn = e.target.closest('[data-draft-index]');
        if (draftBtn) {
            const li = $$('#drafts-list > li')[+draftBtn.getAttribute('data-draft-index')];
            closeIfModal();
            showView('start', false);
            const body = document.getElementById('drafts-body'), tg = document.getElementById('drafts-toggle');
            if (body && body.hidden && tg) tg.click();   // rozwiń sekcję kopii, jeśli zwinięta
            if (li) {
                draftFocus = { index: +draftBtn.getAttribute('data-draft-index'), until: Date.now() + 3000 };
                requestAnimationFrame(() => focusDraft(true));
            }
            return;
        }
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const act = btn.getAttribute('data-act');
        const click = (id) => { const el = document.getElementById(id); if (el) el.click(); };
        closeIfModal();
        if (act !== 'home') forcedView = null;
        switch (act) {
            case 'home': showView('start', true); break;
            case 'new': click('hero-new-audit'); break;
            case 'load': click('wizard-file-input'); break;
            case 'browse': click('hero-browse-requirements'); break;
            case 'json': if (typeof downloadWizardAssessment === 'function') downloadWizardAssessment(); break;
            case 'xlsx': if (typeof downloadWizardSpreadsheet === 'function') downloadWizardSpreadsheet(true); break;
            case 'summary': goSheet(false); if (typeof generateDescriptiveSummary === 'function') generateDescriptiveSummary(false, true); break;
            case 'sum-odt': if (typeof downloadSummaryODT === 'function') downloadSummaryODT(); break;
        }
    }

    function toggleDisclosure(btn, kind) {
        const open = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', String(open));
        const body = document.getElementById(btn.getAttribute('aria-controls'));
        if (body) body.hidden = !open;
        if (kind === 'group') {
            groupState[btn.closest('[data-group]').dataset.group] = open;
            lsSet(LS_GROUPS, JSON.stringify(groupState));
        } else {
            const sid = btn.getAttribute('data-sec');
            if (open) openSections.add(sid); else openSections.delete(sid);
            currentId = null; updateCurrent(false);
        }
    }

    // ---------------------------------------------------------------------------------
    // Widoki panelu głównego: jeden widok naraz (start / nowy arkusz / arkusz / przeglądarka)
    // ---------------------------------------------------------------------------------
    let forcedView = null, lastView = null;
    const hiddenEl = (id) => { const el = document.getElementById(id); return !el || el.classList.contains('hidden'); };
    function computeView() {
        if (forcedView) return forcedView;
        if (!hiddenEl('browser-section')) return 'browser';
        if (!hiddenEl('resultsArea')) return 'sheet';
        if (!hiddenEl('setup-section')) return 'new';
        return 'start';
    }
    // Adresy widoków (historia przeglądarki: Wstecz / Dalej, odświeżenie, link do widoku)
    const VIEW_HASH = { start: 'start', new: 'nowy-arkusz', sheet: 'arkusz', browser: 'wymagania' };
    const HASH_VIEW = Object.fromEntries(Object.entries(VIEW_HASH).map(([k, v]) => [v, k]));
    const VIEW_TITLE = { start: 'Widok startowy', new: 'Nowy arkusz oceny', sheet: 'Arkusz oceny', browser: 'Przeglądarka wymagań' };
    const VIEW_HEADING = { start: 'hero-title', new: 'setup-title', sheet: 'selectedProductName', browser: 'browser-title' };
    let fromHistory = false;

    function updateView() {
        const v = computeView();
        document.body.dataset.npView = v;
        const changed = v !== lastView;
        if (changed && lastView !== null && (v === 'new' || v === 'browser')) window.scrollTo(0, 0);
        if (changed) {
            // Wpis w historii tylko dla zmian, które nie są skutkiem Wstecz/Dalej
            const h = '#' + VIEW_HASH[v];
            if (location.hash !== h) {
                try {
                    if (lastView === null || fromHistory) history.replaceState({ npView: v }, '', h);
                    else history.pushState({ npView: v }, '', h);
                } catch (e) { /* bez historii (np. w ramce) — widok działa dalej */ }
            }
            if (v !== 'browser') document.title = `${VIEW_TITLE[v]} — OZ-PAD`;
        }
        lastView = v;
        $$('[data-act]', panel).forEach(b => b.removeAttribute('aria-current'));
        const cur = panel.querySelector(`[data-act="${({ start: 'home', new: 'new', browser: 'browse' })[v] || '-'}"]`);
        if (cur) cur.setAttribute('aria-current', 'page');
    }

    function focusHeading(v) {
        const h = document.getElementById(VIEW_HEADING[v]);
        if (!h) return;
        if (!h.hasAttribute('tabindex')) h.tabIndex = -1;
        h.focus({ preventScroll: true });
    }

    /** Widok wywołany z panelu (widok startowy, przejście do kopii roboczej). */
    function showView(v, focus) {
        forcedView = v;
        updateView();
        window.scrollTo(0, 0);
        if (focus) focusHeading(v);
    }

    /** Powrót do arkusza z dowolnego widoku (z przeglądarki — jej własnym przyciskiem, żeby zadziałała logika aplikacji). */
    function goSheet(focus) {
        if (!sheetVisible()) return false;
        if (!hiddenEl('browser-section')) { const back = document.getElementById('browser-back-to-sheet'); if (back) back.click(); }
        forcedView = null;
        updateView();
        if (computeView() !== 'sheet') { forcedView = 'sheet'; updateView(); }
        if (focus) { window.scrollTo(0, 0); focusHeading('sheet'); }
        return true;
    }

    /** Wstecz / Dalej w przeglądarce. */
    function onHistory() {
        const v = HASH_VIEW[(location.hash || '').slice(1)];
        if (!v || v === computeView()) return;
        fromHistory = true;
        try {
            if (v === 'start') showView('start', true);
            else if (v === 'sheet') { if (!goSheet(true)) showView('start', true); }
            else if (v === 'new') { forcedView = null; const ss = document.getElementById('setup-section'); if (ss && !ss.classList.contains('hidden')) { forcedView = 'new'; updateView(); window.scrollTo(0, 0); focusHeading('new'); } else document.getElementById('hero-new-audit').click(); }
            else if (v === 'browser') document.getElementById('hero-browse-requirements').click();
        } finally {
            setTimeout(() => { fromHistory = false; }, 300);
        }
    }

    // ---------------------------------------------------------------------------------
    // Kopie robocze (z listy na stronie startowej)
    // ---------------------------------------------------------------------------------
    // session.js przebudowuje listę kopii po każdym autozapisie i powrocie do okna — fokus trzeba wtedy przywrócić
    let draftFocus = null;
    function focusDraft(first) {
        if (!draftFocus || Date.now() > draftFocus.until) { draftFocus = null; return; }
        const li = $$('#drafts-list > li')[draftFocus.index];
        if (!li) return;
        li.tabIndex = -1;
        if (first) li.scrollIntoView({ block: 'center' });
        if (document.activeElement !== li) li.focus({ preventScroll: true });
        if (first) { li.classList.add('np-flash'); setTimeout(() => li.classList.remove('np-flash'), 1500); }
    }

    function renderDrafts() {
        if (draftFocus) requestAnimationFrame(() => focusDraft(false));
        const slot = $('#np-drafts-slot');
        if (!slot) return;
        const lis = $$('#drafts-list > li');
        if (!lis.length) { slot.innerHTML = ''; return; }
        const items = lis.map((li, i) => {
            const title = (li.querySelector('.draft-title') || {}).textContent || '(bez nazwy)';
            const meta = (li.querySelector('.draft-meta') || {}).textContent || '';
            const status = (li.querySelector('.draft-status') || {}).textContent || '';
            const canOpen = !!li.querySelector('.draft-actions button');
            // W panelu krótko: kiedy i ile ocenione (pełny opis jest na liście w widoku startowym)
            const when = (meta.match(/ostatnia zmiana:\s*([^·]+)/) || [])[1];
            const prog = meta.match(/ocenione\s+(\d+)\s+z\s+(\d+)/);
            const short = (/^Otwarta w innej karcie/.test(status) ? 'Otwarta w innej karcie' : status) || [when && when.trim(), prog && `ocenione ${prog[1]}/${prog[2]}`].filter(Boolean).join(' · ') || meta;
            const inner = `<span class="np-draft-title">${esc(title)}</span><span class="np-draft-meta">${esc(short)}</span>`;
            // Ikona: ołówek — ocena otwarta w tej karcie; kłódka — otwarta (zablokowana) w innej karcie; zegar — zapisana kopia
            const current = /^Bieżąca/.test(status), otherTab = /^Otwarta w innej karcie/.test(status);
            const icon = current ? 'file-pen-line' : otherTab ? 'lock' : 'file-clock';
            return `<li><button type="button" class="np-item np-draft" data-draft-index="${i}"><i data-lucide="${icon}" aria-hidden="true"></i><span>${inner}</span></button></li>`;
        }).join('');
        slot.innerHTML = group('drafts', `Kopie robocze <span class="np-count">(${lis.length})</span>`, `<ul class="np-list">${items}</ul>`);
        icons();
    }

    // ---------------------------------------------------------------------------------
    // Arkusz oceny: postęp, filtr, zwijane drzewo wymagań
    // ---------------------------------------------------------------------------------
    function art19Enabled() { const sw = document.querySelector('input[role="switch"]'); return sw ? sw.checked : false; }

    function rowState(row) {
        const checked = row.querySelector('input[type="radio"][name^="status-"]:checked');
        const ta = row.querySelector('textarea[name^="comment-"]');
        return {
            status: checked ? checked.value : 'none',
            justify: !!(ta && ta.getAttribute('aria-required') === 'true' && !ta.value.trim())
        };
    }

    function collect() {
        const items = $$('#requirementsList .category-header, #requirementsList .requirement-row');
        const sections = [];
        let sec = null, ci = 0, ri = 0;
        items.forEach(el => {
            if (el.classList.contains('category-header')) {
                if (!el.id) el.id = `np-cat-${ci++}`;
                el.tabIndex = -1;
                const name = (el.querySelector('span[aria-hidden="true"]') || el).textContent.trim();
                sec = { id: el.id, el, name, rows: [] };
                sections.push(sec);
                return;
            }
            if (!el.id) el.id = `np-req-${ri}`;
            ri++;
            const article = ((el.querySelector('.requirement-id span[aria-hidden="true"]') || {}).textContent || '').trim();
            if (!sec) { sec = { id: 'np-cat-x', el: null, name: 'Wymagania', rows: [] }; sections.push(sec); }
            sec.rows.push({ id: el.id, el, article, inArt19: !!el.closest('[data-art19-container="true"]') });
        });
        return sections;
    }

    function sheetVisible() {
        return !!$('#requirementsList .requirement-row');
    }

    function buildSheet() {
        const slot = $('#np-sheet-slot');
        if (!slot) return;
        if (!sheetVisible()) { slot.innerHTML = ''; model = []; toggleNeedsSheet(false); return; }
        model = collect();
        const tree = model.map((sec, i) => {
            const open = openSections.has(sec.id);
            return `
                <li class="np-sec" data-sec="${esc(sec.id)}">
                    <div class="np-sec-row">
                        <button type="button" class="np-sec-toggle" data-sec="${esc(sec.id)}" aria-expanded="${open}" aria-controls="np-sec-${i}" aria-label="Lista wymagań: ${esc(sec.name)}">
                            <i data-lucide="chevron-right" class="np-chevron" aria-hidden="true"></i>
                        </button>
                        <a href="#${esc(sec.id)}" class="np-sec-link" data-target="${esc(sec.id)}">
                            <span class="np-sec-name">${esc(sec.name)}</span>
                            <span class="np-sec-count" data-count-for="${esc(sec.id)}"></span>
                        </a>
                    </div>
                    <ol id="np-sec-${i}" class="np-req-list"${open ? '' : ' hidden'}>
                        ${sec.rows.map(r => `
                            <li data-row="${esc(r.id)}">
                                <a class="np-req-link" href="#${esc(r.id)}" data-target="${esc(r.id)}">
                                    <span class="np-req-icon" data-status="none" aria-hidden="true">${STATUS_ICON.none}</span>
                                    <span class="np-req-art">${esc(r.article)}<span class="sr-only np-req-sr">, brak oceny</span></span>
                                    <span class="np-flag" hidden title="Wymaga uzasadnienia"><span aria-hidden="true">!</span><span class="sr-only">, wymaga uzasadnienia</span></span>
                                </a>
                            </li>`).join('')}
                    </ol>
                </li>`;
        }).join('');
        slot.innerHTML = group('sheet', 'Arkusz oceny <span class="np-group-meta" id="np-progress-text"></span>', `
            <progress id="np-progress" class="np-progress" max="1" value="0" aria-label="Postęp oceny"></progress>
            <ul class="np-list np-sheet-actions">
                ${item('json', 'save', 'Zapisz plik JSON (Ctrl+S)')}
                ${item('xlsx', 'file-spreadsheet', 'Pobierz arkusz Excel (z podsumowaniem)')}
            </ul>
            ${group('sheetsum', 'Podsumowanie oceny', `<ul class="np-list np-summary-actions">
                ${item('summary', 'file-text', 'Generuj podsumowanie')}
                ${item('sum-odt', 'file-text', 'Pobierz podsumowanie (ODT)', ' data-needs-summary')}
            </ul>`, ' data-nested')}
            ${group('sheetnav', 'Nawigacja po arkuszu', `
            <div class="np-filter">
                <label for="np-filter" class="np-filter-label">Pokaż</label>
                <select id="np-filter">${FILTERS.map(f => `<option value="${f.value}"${f.value === filter ? ' selected' : ''}>${f.label}</option>`).join('')}</select>
            </div>
            <p class="np-filter-status" id="np-filter-status" role="status"></p>
            <ol class="np-tree" aria-label="Spis arkusza">${tree}
                <li class="np-sec np-sec-summary">
                    <div class="np-sec-row">
                        <span class="np-sec-toggle-spacer" aria-hidden="true"></span>
                        <a href="#wizard-summary-section" class="np-sec-link" data-target="wizard-summary-section">
                            <span class="np-sec-name">Podsumowanie oceny</span>
                            <span class="np-sec-count" id="np-summary-state"></span>
                        </a>
                    </div>
                </li>
            </ol>`, ' data-nested')}`);
        const sumEl = document.getElementById('wizard-summary-section');
        if (sumEl) sumEl.tabIndex = -1;

        toggleNeedsSheet(true);
        watchSummary();
        icons();
        currentId = null;
        applyFilter(false);
        updateCurrent(true);
    }

    // „Generuj podsumowanie” / „Aktualizuj podsumowanie” — jak przycisk w samej aplikacji
    let summaryObserver = null;
    function syncSummaryItem() {
        const btn = panel && panel.querySelector('[data-act="summary"]');
        const area = document.getElementById('summary-display-area');
        if (!btn) return;
        const generated = !!(area && area.querySelector('.summary-result-card') && !area.querySelector('.summary-header.initial'));
        const label = generated ? 'Aktualizuj podsumowanie' : 'Generuj podsumowanie';
        panel.querySelectorAll('[data-needs-summary]').forEach(b => { b.closest('li').hidden = !generated; });
        const stEl = document.getElementById('np-summary-state');
        if (stEl) stEl.innerHTML = generated ? '' : '<span aria-hidden="true">brak</span><span class="sr-only">, nie wygenerowano</span>';
        const span = btn.querySelector('span');
        if (span.textContent === label) return;
        span.textContent = label;
        const icon = btn.querySelector('svg, i');
        const i = document.createElement('i');
        i.setAttribute('data-lucide', generated ? 'refresh-cw' : 'file-text');
        i.setAttribute('aria-hidden', 'true');
        if (icon) icon.replaceWith(i); else btn.prepend(i);
        icons();
    }
    function watchSummary() {
        const area = document.getElementById('summary-display-area');
        if (summaryObserver) summaryObserver.disconnect();
        if (area) { summaryObserver = new MutationObserver(() => schedule(syncSummaryItem)); summaryObserver.observe(area, { childList: true }); }
        syncSummaryItem();
    }

    function toggleNeedsSheet(on) {
        $$('[data-needs-sheet]', panel).forEach(b => { b.disabled = !on; });
    }

    function refresh() {
        if (!model.length) return;
        let total = 0, done = 0, toJustify = 0;
        const counts = { 'compliant': 0, 'non-compliant': 0, 'not-applicable': 0 };
        const on = art19Enabled();
        model.forEach(sec => {
            let sTotal = 0, sDone = 0;
            sec.rows.forEach(r => {
                const st = rowState(r.el);
                r.status = st.status; r.justify = st.justify;
                const li = panel.querySelector(`li[data-row="${CSS.escape(r.id)}"]`);
                const active = !r.inArt19 || on;
                if (li) {
                    li.hidden = !active || li.dataset.filtered === 'out';
                    const ic = li.querySelector('.np-req-icon');
                    if (ic.dataset.status !== st.status) { ic.dataset.status = st.status; ic.innerHTML = STATUS_ICON[st.status]; }
                    li.querySelector('.np-req-sr').textContent = `, ${STATUS_LABEL[st.status].toLowerCase()}`;
                    li.querySelector('.np-flag').hidden = !st.justify;
                }
                if (!active) return;
                sTotal++; total++;
                if (st.status !== 'none') { sDone++; done++; counts[st.status]++; }
                if (st.justify) toJustify++;
            });
            const c = panel.querySelector(`[data-count-for="${CSS.escape(sec.id)}"]`);
            if (c) { const off = sec.rows.every(r => r.inArt19) && !on; if (off) c.innerHTML = '<span aria-hidden="true">wył.</span><span class="sr-only">sekcja wyłączona</span>'; else c.innerHTML = `${sDone}/${sTotal}<span class="sr-only"> ocenionych</span>`; c.classList.toggle('is-off', off); c.classList.toggle('is-done', !off && sTotal > 0 && sDone === sTotal); }
        });
        const pt = $('#np-progress-text');
        if (!pt) return;
        pt.innerHTML = `${done}/${total}<span class="sr-only"> wymagań ocenionych</span>`;
        const pr = $('#np-progress'); pr.max = Math.max(total, 1); pr.value = done;
        pr.setAttribute('aria-label', `Postęp oceny: ${done} z ${total} wymagań`);
        const parts = [`Spełnione: ${counts['compliant']}`, `Niespełnione: ${counts['non-compliant']}`, `Nie dotyczy: ${counts['not-applicable']}`];
        if (toJustify) parts.push(`Bez uzasadnienia: ${toJustify}`);

    }

    function matches(r) {
        if (filter === 'none') return r.status === 'none';
        if (filter === 'non-compliant') return r.status === 'non-compliant';
        if (filter === 'justify') return r.justify;
        return true;
    }

    /** Filtr działa na arkusz i drzewo. Stosowany przy zmianie filtra, nie przy każdej ocenie. */
    function applyFilter(announce) {
        refresh();
        const on = art19Enabled();
        let shown = 0, total = 0;
        model.forEach(sec => {
            let secShown = 0;
            sec.rows.forEach(r => {
                const active = !r.inArt19 || on;
                const show = matches(r);
                r.el.classList.toggle('np-filtered-out', !show);
                const li = panel.querySelector(`li[data-row="${CSS.escape(r.id)}"]`);
                if (li) { li.dataset.filtered = show ? 'in' : 'out'; li.hidden = !show || !active; }
                if (active) { total++; if (show) { shown++; secShown++; } }
            });
            const hide = secShown === 0 && filter !== 'all';
            if (sec.el) sec.el.classList.toggle('np-filtered-out', hide);
            const secLi = panel.querySelector(`li.np-sec[data-sec="${CSS.escape(sec.id)}"]`);
            if (secLi) secLi.hidden = hide;
        });
        // Przy aktywnym filtrze rozwiń sekcje, żeby było widać wyniki
        if (filter !== 'all') $$('.np-sec-toggle', panel).forEach(b => { if (b.getAttribute('aria-expanded') !== 'true') toggleDisclosure(b, 'sec'); });
        const st = $('#np-filter-status');
        if (!st) return;
        const text = filter === 'all' ? '' : `Wyświetlono ${shown} z ${total} wymagań.`;
        if (announce) { st.textContent = ''; requestAnimationFrame(() => { st.textContent = text; }); } else st.textContent = text;
    }

    /** Bieżące wymaganie: aria-current na wymaganiu (gdy sekcja rozwinięta) albo na sekcji (gdy zwinięta). Bez ogłaszania. */
    function updateCurrent(force) {
        if (!panel || !model.length) return;
        const header = $('.app-header');
        // Linia odniesienia: nieco poniżej nagłówka strony (ćwierć wysokości okna, nie więcej niż 200 px)
        const offset = Math.max(header ? header.getBoundingClientRect().bottom : 0, 0) + Math.min(200, window.innerHeight * 0.25);
        let cur = null, curSec = null;
        // Znaczniki w kolejności: nagłówek sekcji, potem jej wymagania. Bieżący = ostatni znacznik powyżej linii.
        outer: for (const sec of model) {
            if (sec.el && sec.el.offsetParent && !sec.el.classList.contains('np-filtered-out')) {
                if (sec.el.getBoundingClientRect().top <= offset) { cur = null; curSec = sec.id; } else break;
            }
            for (const r of sec.rows) {
                if (r.el.classList.contains('np-filtered-out') || !r.el.offsetParent) continue;
                if (r.el.getBoundingClientRect().top <= offset) { cur = r.id; curSec = sec.id; } else break outer;
            }
        }
        const se = document.getElementById('wizard-summary-section');
        const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
        if (se && se.offsetParent && (se.getBoundingClientRect().top <= offset || (atBottom && se.getBoundingClientRect().top < window.innerHeight))) { cur = null; curSec = '__summary'; }
        // Fokus ma pierwszeństwo: na wierszu wymagania albo na nagłówku sekcji
        const ae = document.activeElement;
        const hb = Math.max(header ? header.getBoundingClientRect().bottom : 0, 0);
        const visible = (el) => { const r = el.getBoundingClientRect(); return r.bottom > hb && r.top < window.innerHeight; };
        const frc = ae && ae.closest && ae.closest('.requirement-row');
        const fr = frc && visible(frc) ? frc : null;
        if (fr && fr.id) { cur = fr.id; const s = model.find(s => s.rows.some(r => r.id === fr.id)); curSec = s && s.id; }
        else if (ae && ae.classList && ae.classList.contains('category-header') && visible(ae)) { const s = model.find(s => s.el === ae); if (s) { cur = null; curSec = s.id; } }
        if (se && ae && se.contains(ae)) { cur = null; curSec = '__summary'; }
        const key = cur || curSec;
        if (key === currentId && !force) return;
        currentId = key;
        $$('[aria-current]', panel).forEach(a => a.removeAttribute('aria-current'));
        if (!key) return;
        const link = panel.querySelector(`.np-req-link[data-target="${CSS.escape(cur)}"]`);
        const target = curSec === '__summary' && !cur ? panel.querySelector('.np-sec-summary a')
            : (link && link.offsetParent) ? link : panel.querySelector(`.np-sec-link[data-target="${CSS.escape(curSec || '')}"]`);
        if (!target) return;
        target.setAttribute('aria-current', 'location');
        const box = panel.querySelector('.np-scroll');
        if (box && isOpen()) {
            const lr = target.getBoundingClientRect(), br = box.getBoundingClientRect();
            if (force || lr.top < br.top + 40 || lr.bottom > br.bottom - 40) box.scrollTop += (lr.top - br.top) - br.height / 2;
        }
    }

    function init() {
        buildShell();
        const ra = $('#resultsArea'), content = $('#resultsContent'), drafts = $('#drafts-list');
        if (content) new MutationObserver(() => schedule(buildSheet)).observe(content, { childList: true });
        if (ra) new MutationObserver(() => schedule(buildSheet)).observe(ra, { attributes: true, attributeFilter: ['class'] });
        ['resultsArea', 'setup-section', 'browser-section'].forEach(id => {
            const el = document.getElementById(id);
            if (el) new MutationObserver(() => { forcedView = null; schedule(updateView); }).observe(el, { attributes: true, attributeFilter: ['class'] });
        });
        updateView();
        window.addEventListener('popstate', onHistory);
        if (drafts) new MutationObserver(() => schedule(renderDrafts)).observe(drafts, { childList: true, subtree: true, characterData: true });
        buildSheet();

        document.addEventListener('change', (e) => {
            if (e.target.id === 'np-filter') return;
            if (e.target.closest && e.target.closest('#resultsArea')) schedule(refresh);
        });
        document.addEventListener('input', (e) => { if (e.target.matches && e.target.matches('textarea[name^="comment-"]')) schedule(refresh); });
        document.addEventListener('focusout', () => schedule(refresh));
        window.addEventListener('scroll', () => schedule(updateCurrent), { passive: true });
        document.addEventListener('focusin', (e) => { if (!panel.contains(e.target)) schedule(updateCurrent); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
