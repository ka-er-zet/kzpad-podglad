/**
 * Sesja pracy w module oceny: kopie robocze ocen (autozapis) i ochrona przed utratą pracy.
 *
 * Model:
 *  - Każda ocena ma identyfikator (eaa:assessmentId w pliku JSON), nadawany przy wygenerowaniu
 *    arkusza albo odczytywany z wczytanego pliku.
 *  - Każda ocena ma własną kopię roboczą w IndexedDB. Kopia istnieje wtedy i tylko wtedy, gdy ocena
 *    ma zmiany niezapisane w pliku JSON. Zapis pliku JSON usuwa kopię tej oceny; użytkownik może też
 *    usunąć kopię ręcznie z listy „Niezapisane oceny” na stronie startowej.
 *  - Rozpoczęcie nowej oceny, wczytanie pliku, otwarcie innej kopii czy ponowne wygenerowanie arkusza
 *    nie usuwają bieżącej pracy: przed zmianą jej kopia jest zapisywana. Za pierwszym razem
 *    użytkownik dostaje okno z wyjaśnieniem, potem już tylko komunikat (toast).
 *  - Ta sama ocena nie może być otwarta w dwóch kartach (blokada przez Web Locks API).
 *  - Gdy zapis kopii jest niemożliwy (np. tryb prywatny, brak IndexedDB), wraca dawna ochrona:
 *    pytania przed zastąpieniem arkusza i ostrzeżenie przeglądarki przy zamykaniu karty.
 *  - Przy ukryciu/zamknięciu karty kopia jest dodatkowo zapisywana synchronicznie do localStorage
 *    („pending”), bo zapis do IndexedDB w tym momencie nie zawsze zdąży się zakończyć.
 *
 * Zależności (globalne, z wizard.js / utils.js): buildAssessmentEARL, restoreAssessment,
 * scrollToLoadedAssessment, showToast, productDictionary, window.utils.confirm.
 */
(function () {
    'use strict';

    const DB_NAME = 'oz-pad';
    const DB_STORE = 'drafts';
    const LEGACY_KEY = 'oz-pad:autosave:v1';      // dawny autozapis (jeden slot)
    const PENDING_PREFIX = 'oz-pad:pending:';      // awaryjny zapis przy zamykaniu karty
    const INFO_SEEN_KEY = 'oz-pad:drafts-info-seen';
    const LOCK_PREFIX = 'oz-pad:assessment:';
    const DEBOUNCE_MS = 1500;
    const KEPT_TOAST_MS = 10000;

    let currentId = null;       // identyfikator oceny otwartej w tej karcie
    let dirty = false;          // zmiany niezapisane w pliku JSON
    let suspended = 0;          // >0: zmiany programowe (np. przywracanie) nie liczą się jako edycja
    let timer = null;
    let storageFailed = false;
    let storageWarned = false;
    let announcedOnce = false;
    let bypassSubmitGuard = false;
    let pendingKeptToast = false;
    let releaseLock = null;
    let channel = null;

    // ---------------------------------------------------------------------------------------
    // Magazyn kopii roboczych (IndexedDB)
    // ---------------------------------------------------------------------------------------
    let dbPromise = null;
    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve) => {
            try {
                if (!('indexedDB' in window) || !window.indexedDB) { resolve(null); return; }
                const req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = () => {
                    if (!req.result.objectStoreNames.contains(DB_STORE)) {
                        req.result.createObjectStore(DB_STORE, { keyPath: 'id' });
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
                req.onblocked = () => resolve(null);
            } catch (e) {
                resolve(null);
            }
        });
        return dbPromise;
    }

    function tx(mode, fn) {
        return openDb().then((db) => {
            if (!db) throw new Error('Magazyn kopii roboczych jest niedostępny');
            return new Promise((resolve, reject) => {
                const t = db.transaction(DB_STORE, mode);
                const req = fn(t.objectStore(DB_STORE));
                let result;
                if (req) req.onsuccess = () => { result = req.result; };
                t.oncomplete = () => resolve(result);
                t.onerror = () => reject(t.error);
                t.onabort = () => reject(t.error);
            });
        });
    }

    const store = {
        list: () => tx('readonly', (s) => s.getAll()),
        get: (id) => tx('readonly', (s) => s.get(id)),
        put: (rec) => tx('readwrite', (s) => s.put(rec)),
        remove: (id) => tx('readwrite', (s) => s.delete(id))
    };

    // localStorage: każda operacja może rzucić wyjątek (tryb prywatny, limit, blokada)
    function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
    function lsSet(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } }
    function lsRemove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignoruj */ } }
    function lsKeys() {
        try { return Object.keys(localStorage); } catch (e) { return []; }
    }

    // ---------------------------------------------------------------------------------------
    // Pomocnicze
    // ---------------------------------------------------------------------------------------
    function resultsArea() { return document.getElementById('resultsArea'); }

    /** Arkusz jest "aktywny", gdy został wygenerowany i jest widoczny. */
    function hasSheet() {
        const area = resultsArea();
        return !!area && !area.classList.contains('hidden') && !!area.querySelector('.requirement-row');
    }

    function hasUnsavedChanges() {
        return dirty && !!currentId && hasSheet();
    }

    function newId() {
        if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
        return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }

    function subjectOf(earl) {
        const graph = (earl && earl['@graph']) || [];
        return graph.find((it) => it['@type'] && it['@type'].includes && it['@type'].includes('earl:TestSubject')) || null;
    }

    /** Identyfikator oceny zapisany w pliku (pliki z wcześniejszych wersji go nie mają). */
    function idFrom(earl) {
        const s = subjectOf(earl);
        return (s && s['eaa:assessmentId']) || null;
    }

    function dateFrom(earl) {
        const s = subjectOf(earl);
        const d = s && s['dct:date'] ? new Date(s['dct:date']) : null;
        return d && !isNaN(d) ? d : null;
    }

    function profileFromCategory(category) {
        try {
            if (category && typeof productDictionary !== 'undefined' && productDictionary[category]) return productDictionary[category];
        } catch (e) { /* ignoruj */ }
        return category || '';
    }

    function productLabel() {
        const el = document.getElementById('wizard-product-name');
        return (el && el.value.trim()) || '';
    }

    function progress() {
        const rows = Array.from(document.querySelectorAll('#resultsArea .requirement-row'));
        const done = rows.filter((r) => r.querySelector('input[type="radio"][name^="status-"]:checked')).length;
        return { done, total: rows.length };
    }

    function formatTime(date) {
        return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    }

    /** "dziś, 14:32" / "wczoraj, 09:15" / "3 października 2026, 11:02" */
    function formatWhen(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        const today = new Date();
        const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
        const days = Math.round((startOf(today) - startOf(d)) / 86400000);
        if (days === 0) return `dziś, ${formatTime(d)}`;
        if (days === 1) return `wczoraj, ${formatTime(d)}`;
        return `${d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })}, ${formatTime(d)}`;
    }

    function announce(message) {
        const fn = (window.utils && window.utils.setStatusMessage) || null;
        if (typeof fn === 'function') fn(message, 6000);
    }

    function toast(message, type, duration) {
        if (typeof showToast === 'function') showToast(message, type || 'success', duration || 5000);
    }

    function askConfirm(message, title, confirmText, cancelText, focusOn, options) {
        const confirmFn = window.utils && window.utils.confirm;
        if (typeof confirmFn !== 'function') return Promise.resolve(window.confirm(message));
        return confirmFn(message, title, confirmText, cancelText, focusOn, options);
    }

    // ---------------------------------------------------------------------------------------
    // Informacja o kopii roboczej przy arkuszu
    // ---------------------------------------------------------------------------------------
    function showStatus(text) {
        const box = document.getElementById('autosave-info');
        const status = document.getElementById('autosave-status');
        if (!box || !status) return;
        status.textContent = text;
        box.classList.remove('hidden');
    }

    function hideStatus() {
        const box = document.getElementById('autosave-info');
        if (box) box.classList.add('hidden');
    }

    function reportStorageFailure() {
        storageFailed = true;
        if (storageWarned) return;
        storageWarned = true;
        showStatus('Nie można zapisać kopii roboczej w tej przeglądarce. Zapisuj plik JSON ręcznie (Ctrl+S).');
        toast('Autozapis jest niedostępny w tej przeglądarce. Zapisuj pracę ręcznie do pliku JSON (Ctrl+S).', 'warning');
    }

    // ---------------------------------------------------------------------------------------
    // Blokada oceny między kartami (Web Locks API) i powiadamianie innych kart
    // ---------------------------------------------------------------------------------------
    function acquireLock(id) {
        if (!navigator.locks || typeof navigator.locks.request !== 'function') return Promise.resolve(true);
        return new Promise((resolve) => {
            navigator.locks.request(LOCK_PREFIX + id, { ifAvailable: true }, (lock) => {
                if (!lock) { resolve(false); return undefined; }
                resolve(true);
                return new Promise((release) => { releaseLock = release; });
            }).catch(() => resolve(true));
        });
    }

    function releaseCurrentLock() {
        if (releaseLock) { releaseLock(); releaseLock = null; }
    }

    /** Identyfikatory ocen otwartych w innych kartach. */
    async function lockedElsewhere() {
        const ids = new Set();
        if (!navigator.locks || typeof navigator.locks.query !== 'function') return ids;
        try {
            const state = await navigator.locks.query();
            (state.held || []).forEach((l) => {
                if (l.name && l.name.indexOf(LOCK_PREFIX) === 0) {
                    const id = l.name.slice(LOCK_PREFIX.length);
                    if (id !== currentId) ids.add(id);
                }
            });
        } catch (e) { /* ignoruj */ }
        return ids;
    }

    function notifyOthers() {
        try { if (channel) channel.postMessage({ type: 'drafts-changed' }); } catch (e) { /* ignoruj */ }
    }

    /** Ustawia ocenę otwartą w tej karcie (i blokadę). false = ocena jest zablokowana w innej karcie. */
    async function setCurrent(id) {
        releaseCurrentLock();
        currentId = id;
        if (!id) { notifyOthers(); return true; }
        const ok = await acquireLock(id);
        notifyOthers();
        return ok;
    }

    // ---------------------------------------------------------------------------------------
    // Autozapis
    // ---------------------------------------------------------------------------------------
    function buildRecord() {
        if (!currentId || typeof buildAssessmentEARL !== 'function') return null;
        const earl = buildAssessmentEARL();
        if (!earl) return null;
        const area = resultsArea();
        return {
            id: currentId,
            v: 2,
            savedAt: new Date().toISOString(),
            appVersion: self.APP_VERSION || '',
            label: productLabel(),
            profile: (area && area.getAttribute('data-product-name')) || '',
            progress: progress(),
            earl
        };
    }

    function scheduleAutosave() {
        clearTimeout(timer);
        timer = setTimeout(flush, DEBOUNCE_MS);
    }

    /** Zapisuje kopię roboczą bieżącej oceny (jeśli ma niezapisane zmiany). */
    async function flush() {
        clearTimeout(timer);
        timer = null;
        if (!hasUnsavedChanges()) return;
        const rec = buildRecord();
        if (!rec) return;
        try {
            await store.put(rec);
            lsRemove(PENDING_PREFIX + rec.id);
            const recovered = storageFailed;
            storageFailed = false;
            storageWarned = false;
            showStatus(`Kopia robocza zapisana w tej przeglądarce o ${formatTime(new Date(rec.savedAt))}. Aby zachować ocenę na stałe, zapisz plik JSON (Ctrl+S).`);
            if (!announcedOnce || recovered) {
                announcedOnce = true;
                announce('Ocena jest automatycznie zapisywana w tej przeglądarce. Aby zachować ją na stałe, zapisz plik JSON.');
            }
            notifyOthers();
            renderList();
        } catch (e) {
            console.error('Nie udało się zapisać kopii roboczej:', e);
            reportStorageFailure();
        }
    }

    /** Zapis synchroniczny przy ukryciu/zamknięciu karty (IndexedDB może nie zdążyć). */
    function flushOnHide() {
        if (!hasUnsavedChanges()) return;
        const rec = buildRecord();
        if (!rec) return;
        lsSet(PENDING_PREFIX + rec.id, JSON.stringify(rec));
        flush();
    }

    function markDirty() {
        if (suspended > 0 || !currentId) return;
        dirty = true;
        if (hasSheet()) scheduleAutosave();
    }

    /** Wywoływane po zapisie pliku JSON: ocena zgodna z plikiem, jej kopia robocza znika. */
    async function markSaved() {
        dirty = false;
        clearTimeout(timer);
        timer = null;
        hideStatus();
        if (!currentId) return;
        lsRemove(PENDING_PREFIX + currentId);
        try { await store.remove(currentId); } catch (e) { /* ignoruj */ }
        notifyOthers();
        renderList();
    }

    /** Wykonuje funkcję tak, by zmiany programowe (np. przywracanie stanu) nie ustawiały flagi zmian. */
    function runSilently(fn) {
        suspended++;
        try { return fn(); } finally { suspended--; }
    }

    // ---------------------------------------------------------------------------------------
    // Przełączanie ocen (nowa ocena, wczytanie pliku, otwarcie kopii, ponowne generowanie)
    // ---------------------------------------------------------------------------------------
    function infoSeen() { return lsGet(INFO_SEEN_KEY) === '1'; }

    /**
     * Przygotowanie do zastąpienia bieżącej oceny w tej karcie.
     * @returns {Promise<{ok: boolean, kept: boolean}>} ok=false: użytkownik zrezygnował;
     *          kept=true: bieżąca ocena została zachowana jako kopia robocza.
     */
    async function beforeSwitch() {
        if (!hasUnsavedChanges()) return { ok: true, kept: false };
        await flush();

        if (storageFailed) {
            const ok = await askConfirm(
                'Masz niezapisane zmiany w arkuszu oceny, a autozapis w tej przeglądarce nie działa. Kontynuowanie zastąpi bieżący arkusz i zmiany przepadną. Jeśli chcesz je zachować, wróć do arkusza i zapisz plik JSON (Ctrl+S).',
                'Niezapisane zmiany',
                'Odrzuć zmiany i kontynuuj',
                'Wróć do arkusza',
                'cancel'
            );
            if (!ok) returnToSheet();
            return { ok, kept: false };
        }

        if (!infoSeen()) {
            const ok = await askConfirm(
                'Każda ocena jest automatycznie zapisywana w tej przeglądarce jako kopia robocza. Rozpoczęcie nowej oceny, wczytanie pliku albo otwarcie innej kopii nie usuwa bieżącej pracy — znajdziesz ją na stronie startowej w sekcji „Niezapisane oceny”. Kopia jest usuwana po zapisaniu oceny do pliku JSON albo gdy usuniesz ją sam. Kopie są dostępne tylko w tej przeglądarce na tym urządzeniu.',
                'Kopie robocze ocen',
                'Kontynuuj',
                'Anuluj',
                'confirm'
            );
            if (!ok) { returnToSheet(); return { ok: false, kept: false }; }
            lsSet(INFO_SEEN_KEY, '1');
        }
        return { ok: true, kept: true };
    }

    function keptToast() {
        toast('Poprzednia ocena została zachowana jako kopia robocza — znajdziesz ją na stronie startowej w sekcji „Niezapisane oceny”.', 'success', KEPT_TOAST_MS);
    }

    /** Zamyka bieżącą ocenę w tej karcie (jej kopia robocza zostaje). */
    async function endCurrent() {
        clearTimeout(timer);
        timer = null;
        dirty = false;
        hideStatus();
        await setCurrent(null);
    }

    /** "Nowy arkusz oceny": bieżąca ocena zostaje jako kopia robocza. */
    async function startNew() {
        const r = await beforeSwitch();
        if (!r.ok) return false;
        await endCurrent();
        if (r.kept) keptToast();
        renderList();
        return true;
    }

    /**
     * Zastępuje bieżący arkusz oceną z pliku JSON.
     * @returns {Promise<boolean>} false, gdy przerwano (rezygnacja albo ocena otwarta w innej karcie).
     */
    async function replaceWith(data) {
        const fileId = idFrom(data);
        if (fileId && fileId !== currentId && (await lockedElsewhere()).has(fileId)) {
            toast('Ta ocena jest otwarta w innej karcie tej przeglądarki. Przejdź do tamtej karty, aby kontynuować pracę.', 'warning', KEPT_TOAST_MS);
            return false;
        }
        const previousId = currentId;
        const r = await beforeSwitch();
        if (!r.ok) return false;

        // Czy istnieje kopia robocza tej oceny nowsza niż plik?
        let useDraft = false;
        let draft = null;
        if (fileId) {
            try { draft = await store.get(fileId); } catch (e) { draft = null; }
            if (draft) {
                const fileDate = dateFrom(data);
                const draftDate = new Date(draft.savedAt);
                if (!fileDate || draftDate > fileDate) {
                    const choice = await askConfirm(
                        `Dla tej oceny istnieje kopia robocza z ${formatWhen(draft.savedAt)}, nowsza niż wczytywany plik${fileDate ? ` (zapisany ${formatWhen(fileDate.toISOString())})` : ''}. Której wersji użyć? Wybranie pliku usunie kopię roboczą.`,
                        'Kopia robocza jest nowsza niż plik',
                        'Kopia robocza',
                        'Plik',
                        'confirm',
                        { escapeResult: null }
                    );
                    if (choice === null) return false;
                    useDraft = choice === true;
                }
            }
        }

        await endCurrent();
        runSilently(() => restoreAssessment(useDraft ? draft.earl : data));
        const id = fileId || newId();
        await setCurrent(id);
        if (useDraft) {
            dirty = true;
            showStatus(`Otwarto kopię roboczą z ${formatWhen(draft.savedAt)}. Aby zachować ocenę na stałe, zapisz plik JSON (Ctrl+S).`);
        } else if (draft) {
            lsRemove(PENDING_PREFIX + id);
            try { await store.remove(id); } catch (e) { /* ignoruj */ }
        }
        if (r.kept && previousId !== id) keptToast();
        renderList();
        return true;
    }

    /** Otwiera kopię roboczą z listy. */
    async function openDraft(id) {
        if ((await lockedElsewhere()).has(id)) {
            toast('Ta ocena jest otwarta w innej karcie tej przeglądarki. Przejdź do tamtej karty, aby kontynuować pracę.', 'warning', KEPT_TOAST_MS);
            renderList();
            return false;
        }
        let rec = null;
        try { rec = await store.get(id); } catch (e) { rec = null; }
        if (!rec) { toast('Nie znaleziono tej kopii roboczej.', 'error'); renderList(); return false; }

        const r = await beforeSwitch();
        if (!r.ok) return false;
        await endCurrent();
        try {
            runSilently(() => restoreAssessment(rec.earl));
            if (!hasSheet()) throw new Error('Po otwarciu kopii arkusz nie jest widoczny.');
        } catch (err) {
            // Kopii NIE usuwamy, żeby nie stracić danych.
            console.error('Nie udało się otworzyć kopii roboczej:', err);
            toast('Nie udało się otworzyć kopii roboczej.', 'error');
            renderList();
            return false;
        }
        await setCurrent(id);
        dirty = true;
        if (typeof scrollToLoadedAssessment === 'function') scrollToLoadedAssessment();
        showStatus(`Otwarto kopię roboczą z ${formatWhen(rec.savedAt)}. Aby zachować ocenę na stałe, zapisz plik JSON (Ctrl+S).`);
        announce('Otwarto kopię roboczą oceny.');
        if (r.kept) keptToast();
        renderList();
        return true;
    }

    async function deleteDraft(id, label) {
        const ok = await askConfirm(
            `Usunąć kopię roboczą oceny ${label}? Niezapisane w pliku zmiany tej oceny zostaną utracone. Tej operacji nie można cofnąć.`,
            'Usunąć kopię roboczą?',
            'Usuń kopię',
            'Anuluj',
            'cancel'
        );
        if (!ok) return;
        lsRemove(PENDING_PREFIX + id);
        try { await store.remove(id); } catch (e) { /* ignoruj */ }
        notifyOthers();
        await renderList();
        announce('Kopia robocza została usunięta.');
        const heading = document.getElementById('drafts-title');
        const section = document.getElementById('drafts-section');
        if (heading && section && !section.classList.contains('hidden')) heading.focus({ preventScroll: true });
    }

    /**
     * "Wróć do arkusza" ma realnie przenieść do arkusza: gdy użytkownik jest w przeglądarce wymagań,
     * zamykamy ją i pokazujemy arkusz. W pozostałych widokach nie przewijamy strony.
     */
    function returnToSheet() {
        const browserSection = document.getElementById('browser-section');
        if (!browserSection || browserSection.classList.contains('hidden')) return;
        browserSection.classList.add('hidden');
        const setup = document.getElementById('setup-section');
        if (setup) setup.classList.remove('hidden');
        const area = resultsArea();
        if (typeof Browser !== 'undefined' && Browser.updateTitle && area) {
            Browser.updateTitle(`Arkusz oceny: ${area.getAttribute('data-product-name') || ''}`.trim());
        }
        if (typeof scrollToLoadedAssessment === 'function') scrollToLoadedAssessment();
    }

    /**
     * Wyjście z widoku arkusza (przeglądarka wymagań, strona główna). Arkusz nie przepada (kopia
     * robocza), więc pytamy tylko wtedy, gdy autozapis nie działa.
     */
    async function confirmLeave(consequence, confirmText, cancelText) {
        if (!hasUnsavedChanges()) return true;
        await flush();
        if (!storageFailed) return true;
        return askConfirm(
            `Masz niezapisane zmiany w arkuszu oceny, a autozapis w tej przeglądarce nie działa. ${consequence} Aby zachować zmiany, zapisz plik JSON (Ctrl+S).`,
            'Niezapisane zmiany',
            confirmText,
            cancelText,
            'cancel'
        );
    }

    // ---------------------------------------------------------------------------------------
    // Lista „Niezapisane oceny” na stronie startowej
    // ---------------------------------------------------------------------------------------
    let renderSeq = 0;
    async function renderList() {
        const section = document.getElementById('drafts-section');
        const list = document.getElementById('drafts-list');
        const count = document.getElementById('drafts-count');
        if (!section || !list) return;
        const seq = ++renderSeq;

        let drafts = [];
        try { drafts = (await store.list()) || []; } catch (e) { drafts = []; }
        const locked = await lockedElsewhere();
        if (seq !== renderSeq) return; // nowsze odświeżenie w toku

        drafts.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
        list.textContent = '';
        section.classList.toggle('hidden', drafts.length === 0);
        if (count) count.textContent = drafts.length ? `(${drafts.length})` : '';

        drafts.forEach((d) => {
            const name = d.label || '(bez nazwy)';
            const li = document.createElement('li');
            li.className = 'draft';

            const info = document.createElement('div');
            info.className = 'draft-info';
            const title = document.createElement('p');
            title.className = 'draft-title';
            title.textContent = name;
            const meta = document.createElement('p');
            meta.className = 'draft-meta';
            const parts = [];
            if (d.profile) parts.push(d.profile);
            parts.push(`ostatnia zmiana: ${formatWhen(d.savedAt)}`);
            if (d.progress && d.progress.total) parts.push(`ocenione ${d.progress.done} z ${d.progress.total} wymagań`);
            meta.textContent = parts.join(' · ');
            info.append(title, meta);

            let statusText = '';
            if (d.id === currentId) statusText = 'Bieżąca ocena w tej karcie';
            else if (locked.has(d.id)) statusText = 'Otwarta w innej karcie tej przeglądarki — przejdź do tamtej karty, aby kontynuować';
            if (statusText) {
                const st = document.createElement('p');
                st.className = 'draft-status';
                st.textContent = statusText;
                info.append(st);
            }
            li.append(info);

            if (!statusText) {
                const actions = document.createElement('div');
                actions.className = 'draft-actions';
                const open = document.createElement('button');
                open.type = 'button';
                open.textContent = 'Otwórz';
                open.setAttribute('aria-label', `Otwórz kopię roboczą: ${name}`);
                open.addEventListener('click', () => openDraft(d.id));
                const del = document.createElement('button');
                del.type = 'button';
                del.className = 'outline secondary';
                del.textContent = 'Usuń';
                del.setAttribute('aria-label', `Usuń kopię roboczą: ${name}`);
                del.addEventListener('click', () => deleteDraft(d.id, `„${name}”`));
                actions.append(open, del);
                li.append(actions);
            }
            list.append(li);
        });
    }

    // ---------------------------------------------------------------------------------------
    // Przeniesienie danych z wcześniejszych wersji i zapisów awaryjnych
    // ---------------------------------------------------------------------------------------
    async function absorbLegacy() {
        const raw = lsGet(LEGACY_KEY);
        if (!raw) return;
        let slot;
        try {
            slot = JSON.parse(raw);
            if (!slot || !slot.earl || !Array.isArray(slot.earl['@graph'])) throw new Error('format');
        } catch (e) {
            lsRemove(LEGACY_KEY);
            return;
        }
        const subject = subjectOf(slot.earl);
        const rec = {
            id: idFrom(slot.earl) || newId(),
            v: 2,
            savedAt: slot.savedAt || new Date().toISOString(),
            appVersion: slot.appVersion || '',
            label: slot.label || '',
            profile: profileFromCategory(subject && subject['eaa:productCategory']),
            progress: null,
            earl: slot.earl
        };
        try {
            await store.put(rec);
            lsRemove(LEGACY_KEY); // usuwamy dopiero po udanym przeniesieniu
        } catch (e) { /* zostaje na później */ }
    }

    async function absorbPending() {
        const keys = lsKeys().filter((k) => k.indexOf(PENDING_PREFIX) === 0);
        const locked = await lockedElsewhere();
        for (const key of keys) {
            let rec = null;
            try { rec = JSON.parse(lsGet(key)); } catch (e) { rec = null; }
            if (!rec || !rec.id || !rec.earl) { lsRemove(key); continue; }
            if (locked.has(rec.id)) continue; // ocena wciąż otwarta w innej karcie
            try {
                const existing = await store.get(rec.id);
                if (!existing || String(rec.savedAt) > String(existing.savedAt)) await store.put(rec);
                lsRemove(key);
            } catch (e) { /* zostaje na później */ }
        }
    }

    // ---------------------------------------------------------------------------------------
    // Podpięcie zdarzeń
    // ---------------------------------------------------------------------------------------
    function bindEvents() {
        // Każda edycja pól kreatora lub arkusza oznacza zmiany do zapisania.
        const onEdit = (e) => {
            if (suspended > 0) return;
            const t = e.target;
            if (t && t.closest && t.closest('#auditForm, #resultsArea')) markDirty();
        };
        document.addEventListener('input', onEdit, true);
        document.addEventListener('change', onEdit, true);

        // Wygenerowanie arkusza tworzy nową ocenę (nowy identyfikator i kopię roboczą).
        // Ponowne wygenerowanie przy niezapisanych zmianach zachowuje poprzednią ocenę jako kopię.
        document.addEventListener('submit', async (e) => {
            const form = e.target;
            if (!form || form.id !== 'auditForm') return;

            if (!bypassSubmitGuard && hasUnsavedChanges()) {
                e.preventDefault();
                e.stopImmediatePropagation();
                const r = await beforeSwitch();
                if (!r.ok) return;
                pendingKeptToast = r.kept;
                bypassSubmitGuard = true;
                try { form.requestSubmit(); } finally { bypassSubmitGuard = false; }
                return;
            }

            const before = document.getElementById('requirementsList');
            setTimeout(async () => {
                const after = document.getElementById('requirementsList');
                if (!after || after === before || !hasSheet()) return; // walidacja nie przeszła
                await endCurrent();
                await setCurrent(newId());
                dirty = true;
                await flush();
                if (pendingKeptToast) { keptToast(); pendingKeptToast = false; }
                renderList();
            }, 0);
        }, true);

        // Zapis przy ukryciu/zamknięciu karty, zanim zadziała debounce.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flushOnHide();
            else renderList();
        });
        window.addEventListener('pagehide', flushOnHide);
        window.addEventListener('focus', () => renderList());

        // Ikona aplikacji przeładowuje stronę: pytamy tylko, gdy autozapis nie działa.
        const logo = document.getElementById('app-logo');
        if (logo) {
            logo.addEventListener('click', async (e) => {
                if (!hasUnsavedChanges() || !storageFailed) return;
                e.preventDefault();
                const ok = await confirmLeave('Przejście na stronę główną zamknie arkusz i zmiany przepadną.', 'Przejdź na stronę główną', 'Zostań w arkuszu');
                if (ok) window.location.href = logo.getAttribute('href') || 'index.html';
            });
        }

        // Droga powrotna z przeglądarki wymagań do istniejącego arkusza.
        const backBtn = document.getElementById('browser-back-to-sheet');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                returnToSheet();
                backBtn.classList.add('hidden');
            });
        }

        // Ostrzeżenie przeglądarki przy przeładowaniu/zamknięciu karty — tylko gdy autozapis nie działa
        // (w przeciwnym razie praca jest w kopii roboczej).
        window.addEventListener('beforeunload', (e) => {
            if (!hasUnsavedChanges()) return;
            flushOnHide();
            if (!storageFailed) return;
            e.preventDefault();
            e.returnValue = '';
        });

        try {
            if ('BroadcastChannel' in window) {
                channel = new BroadcastChannel('oz-pad-drafts');
                channel.onmessage = () => renderList();
            }
        } catch (e) { channel = null; }
    }

    /** Wywoływane po zakończeniu inicjalizacji wizarda (dane wczytane). */
    async function init() {
        bindEvents();
        const db = await openDb();
        if (!db) storageFailed = true;
        await absorbLegacy();
        await absorbPending();
        await renderList();
    }

    window.Session = {
        init,
        markDirty,
        markSaved,
        flush,
        runSilently,
        startNew,
        replaceWith,
        openDraft,
        confirmLeave,
        hasUnsavedChanges,
        hasSheet,
        currentId: () => currentId
    };
})();
