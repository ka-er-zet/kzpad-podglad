/* Panel nawigacji OZ-PAD (panel boczny / panel główny).
   - Panel jest zawsze dostępny i zwijany przyciskiem „Menu” w nagłówku (skrót Alt+M).
   - Szeroki ekran (≥ 1360 px i > 500 px wysokości): panel zawsze obok treści, także po kliknięciu ikony listwy
     (jedno zachowanie); zwinięcie zapamiętywane w przeglądarce.
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
    // Od 768 px (i > 500 px wysokości) zamiast nagłówka z przyciskiem „Menu” jest listwa ikon; panel przypięty tylko na szerokim
    const RAIL = window.matchMedia('(min-width: 768px) and (min-height: 501px)');
    const LOGO_SEL = '#app-logo, .np-brand-link, .np-rail-logo';
    const LS_PANEL = 'oz-pad:panel-collapsed';
    const LS_GROUPS = 'oz-pad:panel-groups';

    let panel, toggleBtn, backdrop, rail, model = [], currentId = null, filter = 'all';
    // Podgląd: panel wysunięty nad treścią jak okno; tylko na węższym ekranie (od 768 px), gdzie obok treści nie ma miejsca
    let peek = false, peekTrigger = null;
    const isModal = () => !WIDE.matches || peek;
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
            <div class="np-brand">
                <a href="index.html" class="np-brand-link" aria-label="Strona główna aplikacji OZ-PAD"><img src="img/eaa.svg" alt="" aria-hidden="true"><span aria-hidden="true">OZ-PAD</span></a>
                <button type="button" class="np-brand-btn np-collapse" aria-label="Zwiń menu" aria-keyshortcuts="Alt+M" data-icon-label="Zwiń menu (Alt+M)" data-icon-label-placement="right"><i data-lucide="panel-left-close" aria-hidden="true"></i></button>
                <button type="button" class="np-brand-btn np-peek-close" aria-label="Zamknij menu" data-icon-label="Zamknij menu (Esc)" data-icon-label-placement="right"><i data-lucide="x" aria-hidden="true"></i></button>
            </div>
            <div class="np-scroll">
                ${group('main', 'Opcje główne', `<ul class="np-list">
                    ${item('new', 'file-plus-2', 'Nowy arkusz oceny')}
                    ${item('load', 'upload', 'Wczytaj zapisany stan (JSON)')}
                    ${item('browse', 'library-big', 'Przeglądarka wymagań')}
                </ul>`)}
                <div id="np-drafts-slot"></div>
                <div id="np-sheet-slot"></div>
            </div>
            <ul class="np-list np-foot">
                ${item('glossary', 'circle-help', 'Słownik pojęć i pomoc')}
                ${item('theme', 'moon', 'Przełącz motyw')}
            </ul>`;
        header.after(panel); // w kolejności fokusu zaraz po nagłówku, przed treścią
        buildRail();

        backdrop = document.createElement('div');
        backdrop.className = 'np-backdrop';
        backdrop.hidden = true;
        document.body.appendChild(backdrop);

        toggleBtn.addEventListener('click', () => setOpen(!isOpen(), true));
        panel.querySelector('.np-close').addEventListener('click', () => setOpen(false, true));
        panel.querySelector('.np-collapse').addEventListener('click', () => { setOpen(false, true); const b = rail.querySelector('[data-rail="expand"]'); if (b) b.focus(); });
        panel.querySelector('.np-peek-close').addEventListener('click', () => closePeek(true));
        const setTop = () => { const h = header.getBoundingClientRect(); document.documentElement.style.setProperty('--pp-top', Math.max(0, h.bottom) + 'px'); };
        setTop();
        window.addEventListener('resize', setTop);
        window.addEventListener('scroll', () => schedule(setTop), { passive: true });
        backdrop.addEventListener('click', () => { if (peek) closePeek(true); else setOpen(false, true); });
        panel.addEventListener('click', onPanelClick);
        // Logo (nagłówek na telefonie, panel, listwa ikon) otwiera widok startowy bez przeładowania strony:
        // otwarty arkusz zostaje w pamięci, a wraca się do niego z panelu. Kliknięcie z Ctrl/Cmd/Shift lub środkowym
        // przyciskiem działa jak zwykły link (nowa karta z aplikacją).
        document.addEventListener('click', onLogoClick);
        panel.addEventListener('change', (e) => { if (e.target.id === 'np-filter') { filter = e.target.value; applyFilter(true); } });
        document.addEventListener('keydown', (e) => {
            // Skrót Alt+M: przejście do menu z dowolnego miejsca (e.code — niezależnie od układu klawiatury)
            if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyM') {
                e.preventDefault();
                if (peek) closePeek(true);
                else if (panel.contains(document.activeElement)) returnToContent(true);
                else focusMenu();
                return;
            }
            if (e.key !== 'Escape' || !panel.contains(document.activeElement)) return;
            if (document.activeElement.id === 'np-filter') return;   // Esc w liście rozwijanej zamyka listę
            e.preventDefault();
            returnToContent();
        });
        WIDE.addEventListener('change', () => applyMode());
        RAIL.addEventListener('change', () => applyMode());
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

    const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');
    const FLIP_MS = 300, FLIP_EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';   // jak --np-dur i --np-ease w CSS

    /** Zmiana klas panelu z płynnym przesunięciem treści (FLIP): układ od razu przechodzi w stan końcowy,
        a treść „dojeżdża” z dawnego miejsca. Marginesy (auto → liczba) nie dają się animować same. */
    function withContentSlide(change) {
        const body = document.body;
        const els = !REDUCED.matches && body.classList.contains('np-anim') && WIDE.matches && !peek
            ? ['main-content'].map(id => document.getElementById(id)).concat($('.app-footer')).filter(Boolean) : [];
        const before = els.map(el => el.getBoundingClientRect().left);
        change();
        els.forEach((el, i) => {
            const dx = before[i] - el.getBoundingClientRect().left;
            if (Math.abs(dx) < 1 || !el.animate) return;
            el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }], { duration: FLIP_MS, easing: FLIP_EASE });
        });
    }

    function setOpen(open, user) {
        withContentSlide(() => document.body.classList.toggle('np-open', open));
        toggleBtn.setAttribute('aria-expanded', String(open));
        toggleBtn.querySelector('span').textContent = open ? 'Zwiń menu' : 'Menu';
        const modal = isModal();
        // Szeroki ekran: panel po prostu znika. Mniejszy: wysuwa się z boku (widoczność sterowana w CSS, z animacją)
        panel.hidden = false;   // widoczność i animacja w CSS (body.np-open)
        backdrop.hidden = !(open && modal);
        // Okno modalne na wąskim ekranie: reszta strony nieaktywna
        ['main-content'].forEach(id => { const el = document.getElementById(id); if (el) el.inert = open && modal; });
        $$('.app-footer, #toast-container').forEach(el => { el.inert = open && modal; });
        if (WIDE.matches && user && !peek) lsSet(LS_PANEL, open ? '0' : '1');
        updateRail();
        if (user && open && modal) { const f = panel.querySelector('.np-close'); if (f) f.focus(); }
        if (user && !open && modal) toggleBtn.focus();
        if (open) updateCurrent(true);
    }

    function applyMode() {
        if (peek) { peek = false; document.body.classList.remove('np-peek'); }
        document.body.classList.toggle('np-wide', WIDE.matches);
        document.body.classList.toggle('np-railmode', RAIL.matches);
        // Wysokość nagłówka (rezerwa przy przewijaniu do fokusu) zmienia się, bo na szerokim ekranie nagłówek chowa się w panelu
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
        if (WIDE.matches) setOpen(lsGet(LS_PANEL) !== '1', false);
        else setOpen(false, false);
    }

    // Skrót klawiaturowy: do menu i z powrotem do miejsca w treści
    let returnFocus = null;
    function focusMenu() {
        const ae = document.activeElement;
        returnFocus = (ae && ae !== document.body && !panel.contains(ae)) ? ae : null;
        if (RAIL.matches && !WIDE.matches) { openPeek(sheetVisible() ? 'toc' : 'top', returnFocus); return; }
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
        if (peek) { closePeek(true); return; }
        const modal = !WIDE.matches;
        if (modal) setOpen(false, false);
        else if (collapse) { setOpen(false, false); lsSet(LS_PANEL, '1'); }
        const t = returnFocus && document.contains(returnFocus) && returnFocus.offsetParent !== null ? returnFocus : null;
        returnFocus = null;
        if (t) t.focus();
        else if (modal) toggleBtn.focus();
        else { const m = document.getElementById('main-content'); if (m) { m.tabIndex = -1; m.focus(); } }
    }

    function closeIfModal() {
        if (peek) closePeek(false);
        else if (!WIDE.matches && isOpen()) setOpen(false, false);
    }

    // ---------------------------------------------------------------------------------
    // Listwa ikon (panel zwinięty). Ikony grup otwierają panel w danym miejscu (szeroki ekran: obok treści,
    // węższy: nad treścią), ikony pojedynczych akcji działają od razu. Etykiety ikon — wspólny mechanizm aplikacji (enhanceIconButtons).
    // ---------------------------------------------------------------------------------
    function railBtn(key, icon, label, extra = '') {
        return `<li><button type="button" class="np-rail-btn" data-rail="${key}" aria-label="${esc(label)}" data-icon-label="${esc(label)}" data-icon-label-placement="right"${extra}><i data-lucide="${icon}" aria-hidden="true"></i></button></li>`;
    }
    function buildRail() {
        rail = document.createElement('div');
        rail.setAttribute('role', 'navigation');
        rail.id = 'np-rail';
        rail.className = 'np-rail';
        rail.setAttribute('aria-label', 'Nawigacja aplikacji (zwinięta)');
        rail.innerHTML = `
            <a href="index.html" class="np-rail-logo" aria-label="Strona główna aplikacji OZ-PAD"><img src="img/eaa.svg" alt="" aria-hidden="true"></a>
            <ul class="np-rail-list">
                ${railBtn('expand', 'panel-left-open', 'Rozwiń menu (Alt+M)', ' aria-keyshortcuts="Alt+M" aria-controls="np-panel"')}
            </ul>
            <ul class="np-rail-list">
                ${railBtn('new', 'file-plus-2', 'Nowy arkusz oceny')}
                ${railBtn('load', 'upload', 'Wczytaj zapisany stan (JSON)')}
                ${railBtn('browse', 'library-big', 'Przeglądarka wymagań')}
            </ul>
            <ul class="np-rail-list" data-rail-group="drafts">
                ${railBtn('drafts', 'files', 'Kopie robocze', ' aria-controls="np-panel"')}
            </ul>
            <ul class="np-rail-list" data-rail-group="sheet">
                <li><button type="button" class="np-rail-btn np-rail-ring" data-rail="sheet" aria-controls="np-panel" aria-label="Arkusz oceny" data-icon-label="Arkusz oceny" data-icon-label-placement="right">
                    <svg viewBox="0 0 36 36" aria-hidden="true" focusable="false"><circle class="np-ring-bg" cx="18" cy="18" r="15"/><circle class="np-ring-fg" cx="18" cy="18" r="15" pathLength="100" stroke-dasharray="0 100"/></svg>
                </button></li>
                ${railBtn('toc', 'list-tree', 'Spis arkusza', ' aria-controls="np-panel"')}
                ${railBtn('json', 'save', 'Zapisz plik JSON (Ctrl+S)')}
            </ul>
            <ul class="np-rail-list np-rail-foot">
                ${railBtn('glossary', 'circle-help', 'Słownik pojęć i pomoc')}
                ${railBtn('theme', 'moon', 'Przełącz motyw')}
            </ul>`;
        panel.before(rail);
        rail.addEventListener('click', onRailClick);
        // Przełącznik motywu jak w nagłówku: ikona i nazwa mówią, na jaki motyw przełączy (aktualizacja przy każdej zmianie)
        new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        syncTheme();
        if (typeof enhanceIconButtons === 'function') enhanceIconButtons(rail);
        enhanceIconButtonsIn(panel.querySelector('.np-brand'));
    }
    function enhanceIconButtonsIn(root) { if (root && typeof enhanceIconButtons === 'function') enhanceIconButtons(root); }

    function syncTheme() {
        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
        const label = dark ? 'Przełącz motyw na jasny' : 'Przełącz motyw na ciemny';
        const icon = dark ? 'sun' : 'moon';
        $$('[data-rail="theme"], [data-act="theme"]').forEach(b => {
            const ic = b.querySelector('[data-lucide]');
            if (ic && ic.getAttribute('data-lucide') !== icon) { const i = document.createElement('i'); i.setAttribute('data-lucide', icon); i.setAttribute('aria-hidden', 'true'); ic.replaceWith(i); }
            if (b.hasAttribute('data-rail')) setRailLabel(b, label);
            else { const t = b.querySelector('span'); if (t) t.textContent = label; }
        });
        icons();
    }

    function setRailLabel(btn, label) {
        if (!btn) return;
        btn.setAttribute('aria-label', label);
        btn.setAttribute('data-icon-label', label);
        const span = btn.querySelector('.icon-label');
        if (span) span.textContent = label;
    }

    /** Stan listwy: które grupy są dostępne, postęp, bieżący widok. */
    function updateRail() {
        if (!rail) return;
        const nDrafts = $$('#drafts-list > li').length;
        rail.querySelector('[data-rail-group="drafts"]').hidden = nDrafts === 0;
        setRailLabel(rail.querySelector('[data-rail="drafts"]'), `Kopie robocze (${nDrafts})`);
        const hasSheet = !!panel.querySelector('[data-group="sheet"]');
        rail.querySelector('[data-rail-group="sheet"]').hidden = !hasSheet;
        const pr = $('#np-progress');
        if (hasSheet && pr) {
            const done = +pr.value || 0, total = +pr.max || 1;
            rail.querySelector('.np-ring-fg').setAttribute('stroke-dasharray', `${Math.round(done / total * 100)} 100`);
            setRailLabel(rail.querySelector('[data-rail="sheet"]'), `Arkusz oceny: ocenione ${done} z ${total} wymagań`);
        }
        const v = document.body.dataset.npView;
        $$('[data-rail]', rail).forEach(b => b.removeAttribute('aria-current'));
        const cur = rail.querySelector(`[data-rail="${({ new: 'new', browser: 'browse' })[v] || '-'}"]`);
        if (cur) cur.setAttribute('aria-current', 'page');
    }

    function onRailClick(e) {
        const btn = e.target.closest('[data-rail]');
        if (!btn) return;
        if (typeof hideAllIconLabels === 'function') hideAllIconLabels();
        const k = btn.getAttribute('data-rail');
        if (k === 'expand') {
            if (!WIDE.matches) { openPeek('top', btn); return; }   // średni ekran: panel tylko nad treścią
            setOpen(true, true); const c = panel.querySelector('.np-collapse'); if (c) c.focus(); return;
        }
        if (k === 'drafts' || k === 'sheet' || k === 'toc') { openAt(k, btn); return; }
        runAct(k);
    }

    function expandGroup(id) {
        const t = panel.querySelector(`[data-group="${id}"] > .np-group-h .np-group-toggle`);
        if (t && t.getAttribute('aria-expanded') !== 'true') toggleDisclosure(t, 'group');
        return t;
    }

    /** Otwiera panel w miejscu wskazanym ikoną listwy. Szeroki ekran: ten sam panel obok treści, co „Rozwiń menu”
        (zapamiętany jak każde rozwinięcie). Węższy: panel nad treścią (podgląd), bo obok treści nie ma miejsca. */
    function openAt(where, trigger) {
        if (!WIDE.matches) { openPeek(where, trigger); return; }
        setOpen(true, true);
        const go = () => { const target = panelTarget(where); (target || panel.querySelector('.np-collapse')).focus(); };
        // Spis wskazuje bieżące miejsce wg położenia treści, a ta przesuwa się płynnie (0,25 s), gdy panel staje obok niej
        if (where === 'toc') setTimeout(go, 280); else requestAnimationFrame(go);
    }

    function openPeek(where, trigger) {
        peek = true; peekTrigger = trigger;
        document.body.classList.add('np-peek');
        setOpen(true, false);
        const target = panelTarget(where);
        requestAnimationFrame(() => (target || panel.querySelector('.np-peek-close')).focus());
    }

    /** Rozwija odpowiednią grupę panelu, ustawia przewijanie i zwraca element, który dostanie fokus. */
    function panelTarget(where) {
        let target = null;
        if (where === 'drafts') { expandGroup('drafts'); target = panel.querySelector('[data-draft-index]'); }
        else if (where === 'sheet') { target = expandGroup('sheet'); }
        else if (where === 'top') { const box = panel.querySelector('.np-scroll'); if (box) box.scrollTop = 0; target = panel.querySelector('[aria-current="page"]') || panel.querySelector('.np-scroll .np-item'); }
        else if (where === 'toc') {
            expandGroup('sheet'); expandGroup('sheetnav');
            updateCurrent(true);
            const vis = (el) => el && el.offsetParent !== null;
            target = [...panel.querySelectorAll('[data-group="sheetnav"] [aria-current]')].find(vis) || panel.querySelector('.np-sec-link');
            const box = panel.querySelector('.np-scroll');
            if (target && box) requestAnimationFrame(() => { const lr = target.getBoundingClientRect(), br = box.getBoundingClientRect(); box.scrollTop += (lr.top - br.top) - br.height / 3; });
        }
        return target;
    }

    function closePeek(restoreFocus) {
        if (!peek) return;
        const t = peekTrigger;
        setOpen(false, false);
        peek = false; peekTrigger = null;
        document.body.classList.remove('np-peek');
        if (restoreFocus && t && t.offsetParent !== null) t.focus();
    }

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
        runAct(btn.getAttribute('data-act'));
    }

    function onLogoClick(e) {
        const a = e.target.closest(LOGO_SEL);
        if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        closeIfModal();
        showView('start', true);
    }

    function runAct(act) {
        const click = (id) => { const el = document.getElementById(id); if (el) el.click(); };
        closeIfModal();
        forcedView = null;
        switch (act) {
            case 'glossary': click('btn-show-glossary'); break;
            case 'theme': if (window.utils && window.utils.toggleTheme) window.utils.toggleTheme(); break;
            case 'new': click('hero-new-audit'); break;
            case 'load': click('wizard-file-input'); break;
            case 'browse': click('hero-browse-requirements'); break;
            case 'json': if (typeof downloadWizardAssessment === 'function') downloadWizardAssessment(); break;
            case 'xlsx-blank': if (typeof downloadWizardSpreadsheet === 'function') downloadWizardSpreadsheet(false, { blank: true }); break;
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
    // Widok startowy nie ma tytułu szczegółowego: karta nazywa się po prostu nazwą narzędzia
    function setTitle(v) {
        let detail = '';
        if (v === 'new') detail = 'Nowy arkusz oceny';
        else if (v === 'sheet') {
            // Nazwa nadana ocenie przez użytkownika, a gdy jej brak — rodzaj produktu
            const area = document.getElementById('resultsArea'), nameInput = document.getElementById('wizard-product-name');
            const name = (nameInput && nameInput.value.trim()) || (area && area.getAttribute('data-product-name')) || '';
            detail = name ? `Arkusz oceny: ${name}` : 'Arkusz oceny';
        }
        if (typeof Browser !== 'undefined' && Browser.updateTitle) Browser.updateTitle(detail);
    }
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
        }
        // Tytuł karty zależy od widoku i od otwartej oceny, więc odświeżamy go przy każdym wywołaniu
        // (np. po wczytaniu kopii roboczej nazwa produktu pojawia się już po zmianie widoku).
        // Przeglądarka wymagań ustawia własny tytuł (kategoria, widok ustawy/normy) w Browser.
        if (v !== 'browser') setTitle(v);
        lastView = v;
        $$('[data-act]', panel).forEach(b => b.removeAttribute('aria-current'));
        const cur = panel.querySelector(`[data-act="${({ new: 'new', browser: 'browse' })[v] || '-'}"]`);
        if (cur) cur.setAttribute('aria-current', 'page');
        // Logo prowadzi do widoku startowego, więc to ono oznacza bieżący widok, gdy jest nim start
        $$(LOGO_SEL).forEach(a => (v === 'start' ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
        updateRail();
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
        if (!lis.length) { slot.innerHTML = ''; updateRail(); return; }
        const items = lis.map((li, i) => {
            const title = (li.querySelector('.draft-title') || {}).textContent || '(bez nazwy)';
            const meta = (li.querySelector('.draft-meta') || {}).textContent || '';
            const status = (li.querySelector('.draft-status') || {}).textContent || '';
            const canOpen = !!li.querySelector('.draft-actions button');
            // W panelu krótko: kiedy i ile ocenione (pełny opis jest na liście w widoku startowym)
            const when = (meta.match(/ostatnia zmiana:\s*([^·]+)/) || [])[1];
            const prog = meta.match(/ocenione\s+(\d+)\s+z\s+(\d+)/);
            // Ikona: ołówek — ocena otwarta w tej karcie; kłódka — otwarta (zablokowana) w innej karcie; zegar — zapisana kopia
            const current = /^Bieżąca/.test(status), otherTab = /^Otwarta w innej karcie/.test(status);
            // Także przy bieżącej ocenie pokazujemy czas zapisu (uwaga PFRON: aktualna godzina kopii w nawigacji);
            // stan „bieżąca”/„w innej karcie” niesie ikona, a czytnikom ekranu — tekst ukryty wizualnie
            const short = [when && when.trim(), prog && `ocenione ${prog[1]}/${prog[2]}`].filter(Boolean).join(' · ') || status || meta;
            const sr = current ? 'bieżąca ocena w tej karcie, ' : otherTab ? 'otwarta w innej karcie, ' : '';
            const inner = `<span class="np-draft-title">${esc(title)}</span><span class="np-draft-meta"><span class="sr-only">${sr}</span>${esc(short)}</span>`;
            const icon = current ? 'file-pen-line' : otherTab ? 'lock' : 'file-clock';
            return `<li><button type="button" class="np-item np-draft" data-draft-index="${i}"><i data-lucide="${icon}" aria-hidden="true"></i><span>${inner}</span></button></li>`;
        }).join('');
        slot.innerHTML = group('drafts', `Kopie robocze <span class="np-group-meta">${lis.length}</span>`, `<ul class="np-list">${items}</ul>`);
        icons();
        updateRail();
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
            <ul class="np-list np-sheet-actions">
                ${item('json', 'save', 'Zapisz plik JSON (Ctrl+S)')}
                ${item('xlsx-blank', 'file-spreadsheet', 'Pobierz pusty arkusz Excel (do wypełnienia)')}
            </ul>
            ${group('sheetsum', 'Podsumowanie oceny', `<ul class="np-list np-summary-actions">
                ${item('summary', 'file-text', 'Generuj podsumowanie')}
                ${item('xlsx', 'file-spreadsheet', 'Pobierz ocenę z podsumowaniem (Excel)', ' data-needs-summary')}
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

        // Pasek postępu pod nagłówkiem grupy, poza zwijaną treścią — widoczny także po zwinięciu
        const sheetHead = slot.querySelector('[data-group="sheet"] > .np-group-h');
        if (sheetHead) sheetHead.insertAdjacentHTML('beforeend', '<progress id="np-progress" class="np-progress" max="1" value="0" aria-label="Postęp oceny"></progress>');
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
        updateRail();
    }

    function refresh() {
        if (!model.length) return;
        let total = 0, done = 0, toJustify = 0;
        const counts = { 'compliant': 0, 'non-compliant': 0, 'not-applicable': 0 };
        const avail = { 'none': 0, 'non-compliant': 0, 'justify': 0 };   // ile wymagań pasuje do każdej opcji filtra
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
                if (st.status === 'none') avail['none']++;
                if (st.status === 'non-compliant') avail['non-compliant']++;
                if (st.justify) avail['justify']++;
            });
            const c = panel.querySelector(`[data-count-for="${CSS.escape(sec.id)}"]`);
            if (c) { const off = sec.rows.every(r => r.inArt19) && !on; if (off) c.innerHTML = '<span aria-hidden="true">wył.</span><span class="sr-only">sekcja wyłączona</span>'; else c.innerHTML = `${sDone}/${sTotal}<span class="sr-only"> ocenionych</span>`; c.classList.toggle('is-off', off); c.classList.toggle('is-done', !off && sTotal > 0 && sDone === sTotal); }
        });
        syncFilterOptions(avail);
        const pt = $('#np-progress-text');
        if (!pt) return;
        pt.innerHTML = `${done}/${total}<span class="sr-only"> wymagań ocenionych</span>`;
        const pr = $('#np-progress'); pr.max = Math.max(total, 1); pr.value = done;
        pr.setAttribute('aria-label', `Postęp oceny: ${done} z ${total} wymagań`);
        updateRail();
        const parts = [`Spełnione: ${counts['compliant']}`, `Niespełnione: ${counts['non-compliant']}`, `Nie dotyczy: ${counts['not-applicable']}`];
        if (toJustify) parts.push(`Bez uzasadnienia: ${toJustify}`);

    }

    /**
     * Lista filtra zawiera tylko opcje, do których coś pasuje („Wszystkie” zawsze; wybrana zostaje do czasu zmiany).
     * Dzięki temu nie ma pustych wyników. Gdy do wyboru jest tylko „Wszystkie”, cały filtr jest ukryty.
     * Listy nie przebudowujemy, gdy ma fokus (otwarta lista zniknęłaby użytkownikowi); nadrobi to refresh po jego opuszczeniu.
     */
    function syncFilterOptions(avail) {
        const sel = $('#np-filter');
        if (!sel) return;
        const wanted = FILTERS.filter(f => f.value === 'all' || avail[f.value] > 0 || f.value === filter);
        const wrap = sel.closest('.np-filter');
        if (wrap) wrap.hidden = wanted.length < 2;
        const key = wanted.map(f => f.value).join();
        if (sel.dataset.opts === key || document.activeElement === sel) return;
        sel.innerHTML = wanted.map(f => `<option value="${f.value}">${f.label}</option>`).join('');
        sel.value = filter;
        sel.dataset.opts = key;
    }

    function matches(r) {
        if (filter === 'none') return r.status === 'none';
        if (filter === 'non-compliant') return r.status === 'non-compliant';
        if (filter === 'justify') return r.justify;
        return true;
    }

    /** Dolna krawędź nagłówka strony: od niej zaczyna się widoczna część arkusza. */
    function headerBottom() {
        const header = $('.app-header');
        return Math.max(header ? header.getBoundingClientRect().bottom : 0, 0);
    }

    /**
     * Kotwica miejsca w arkuszu przed zmianą filtra: pierwsze widoczne wymaganie, które sięga poniżej nagłówka,
     * i jego położenie. Filtr zmienia wysokość dokumentu (np. 78 000 → 19 000 px), więc bez kotwicy
     * przeglądarka zostawia stary scrollY i użytkownik ląduje w zupełnie innym miejscu.
     */
    function captureAnchor() {
        const sheet = $('#resultsArea');
        if (!sheet || !sheet.offsetParent) return null;
        const hb = headerBottom();
        for (const sec of model) {
            for (const r of sec.rows) {
                if (!r.el || !r.el.offsetParent || r.el.classList.contains('np-filtered-out')) continue;
                const rect = r.el.getBoundingClientRect();
                if (rect.bottom > hb + 10) return { row: r, top: rect.top };
            }
        }
        return null;
    }

    /** Po zmianie filtra: to samo wymaganie na tym samym miejscu ekranu; gdy zniknęło, najbliższe pasujące (następne, potem poprzednie). */
    function restoreAnchor(anchor) {
        const visible = (r) => r.el && !r.el.classList.contains('np-filtered-out') && r.el.offsetParent;
        const hb = headerBottom();
        if (visible(anchor.row)) { window.scrollBy(0, anchor.row.el.getBoundingClientRect().top - anchor.top); return; }
        const all = model.flatMap(s => s.rows);
        const i = all.indexOf(anchor.row);
        const next = all.slice(i + 1).find(visible) || all.slice(0, i).reverse().find(visible);
        if (next) window.scrollBy(0, next.el.getBoundingClientRect().top - hb - 8);
    }

    /** Filtr działa na arkusz i drzewo. Stosowany przy zmianie filtra, nie przy każdej ocenie. */
    function applyFilter(announce) {
        refresh();
        const anchor = announce ? captureAnchor() : null;
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
        if (anchor) restoreAnchor(anchor);
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
