/**
 * Sesja pracy w module oceny: śledzenie niezapisanych zmian, autozapis kopii roboczej
 * i ochrona przed przypadkową utratą pracy.
 *
 * Zasada nadrzędna: kopia robocza w przeglądarce (localStorage, jeden slot) istnieje
 * wtedy i tylko wtedy, gdy są zmiany niezapisane w pliku JSON. Dlatego:
 *  - zapis pliku JSON, wczytanie pliku i rozpoczęcie nowej oceny usuwają kopię roboczą,
 *  - przy starcie strony, jeśli kopia istnieje, aplikacja PYTA, czy ją przywrócić,
 *  - zamknięcie karty, odświeżenie czy wejście w inny link nie kasują pracy, więc ich
 *    nie blokujemy; pytamy tylko przed akcjami, które zastępują bieżący arkusz.
 *  - gdy zapis do localStorage się nie uda (tryb prywatny, limit), włącza się ostrzeżenie
 *    przeglądarki przy zamykaniu karty (beforeunload) jako ostatnia siatka bezpieczeństwa.
 *
 * Zależności (globalne, z wizard.js / utils.js): buildAssessmentEARL, restoreAssessment,
 * scrollToLoadedAssessment, showToast, window.utils.confirm.
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'oz-pad:autosave:v1';
    const DEBOUNCE_MS = 1500;

    let dirty = false;          // zmiany od ostatniego zapisu pliku / wczytania / startu nowej oceny
    let suspended = 0;          // >0: zmiany programowe (np. przywracanie) nie liczą się jako edycja
    let timer = null;
    let storageFailed = false;
    let announcedOnce = false;
    let bypassSubmitGuard = false;

    // ---- localStorage (każda operacja może rzucić wyjątek: tryb prywatny, limit, blokada) ----
    function storageGet() {
        try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    }
    function storageSet(value) {
        try { localStorage.setItem(STORAGE_KEY, value); return true; } catch (e) { return false; }
    }
    function storageRemove() {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignoruj */ }
    }

    // ---- Pomocnicze ----
    function resultsArea() { return document.getElementById('resultsArea'); }

    /** Arkusz jest "aktywny", gdy został wygenerowany i jest widoczny. */
    function hasSheet() {
        const area = resultsArea();
        return !!area && !area.classList.contains('hidden') && !!area.querySelector('.requirement-row');
    }

    function hasUnsavedChanges() {
        return dirty && hasSheet();
    }

    function productLabel() {
        const el = document.getElementById('wizard-product-name');
        return (el && el.value.trim()) || '';
    }

    function formatTime(date) {
        return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    }

    function announce(message) {
        if (typeof W !== 'undefined' && W && typeof W.setStatusMessage === 'function') {
            W.setStatusMessage(message, 6000);
        } else if (window.utils && typeof window.utils.setStatusMessage === 'function') {
            window.utils.setStatusMessage(message, 6000);
        }
    }

    function askConfirm(message, title, confirmText, cancelText, focusOn) {
        const confirmFn = window.utils && window.utils.confirm;
        if (typeof confirmFn !== 'function') return Promise.resolve(window.confirm(message));
        return confirmFn(message, title, confirmText, cancelText, focusOn);
    }

    // ---- Informacja o kopii roboczej w interfejsie ----
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

    // ---- Autozapis ----
    function scheduleAutosave() {
        clearTimeout(timer);
        timer = setTimeout(flush, DEBOUNCE_MS);
    }

    /** Zapisuje kopię roboczą natychmiast (jeśli są niezapisane zmiany). */
    function flush() {
        clearTimeout(timer);
        timer = null;
        if (!hasUnsavedChanges() || typeof buildAssessmentEARL !== 'function') return;

        const earl = buildAssessmentEARL();
        if (!earl) return;

        const savedAt = new Date();
        const payload = JSON.stringify({
            v: 1,
            savedAt: savedAt.toISOString(),
            appVersion: self.APP_VERSION || '',
            label: productLabel(),
            earl: earl
        });

        if (storageSet(payload)) {
            const recovered = storageFailed;
            storageFailed = false;
            showStatus(`Kopia robocza zapisana w tej przeglądarce o ${formatTime(savedAt)}. Aby zachować pracę na stałe, zapisz plik JSON (Ctrl+S).`);
            if (!announcedOnce || recovered) {
                announcedOnce = true;
                announce('Praca jest automatycznie zapisywana w tej przeglądarce. Aby zachować ją na stałe, zapisz plik JSON.');
            }
        } else if (!storageFailed) {
            storageFailed = true;
            showStatus('Nie można zapisać kopii roboczej w tej przeglądarce. Zapisuj plik JSON ręcznie (Ctrl+S).');
            if (typeof showToast === 'function') {
                showToast('Autozapis jest niedostępny w tej przeglądarce. Zapisuj pracę ręcznie do pliku JSON (Ctrl+S).', 'warning');
            }
        }
    }

    function markDirty() {
        if (suspended > 0) return;
        dirty = true;
        if (hasSheet()) scheduleAutosave();
    }

    /** Stan zgodny z plikiem / świeży arkusz: brak niezapisanych zmian, brak kopii roboczej. */
    function reset() {
        dirty = false;
        clearTimeout(timer);
        timer = null;
        storageRemove();
        hideStatus();
    }

    /** Wywoływane po zapisie pliku JSON. */
    function markSaved() {
        reset();
    }

    /** Wykonuje funkcję tak, by zmiany programowe (np. przywracanie stanu) nie ustawiały flagi zmian. */
    function runSilently(fn) {
        suspended++;
        try { return fn(); } finally { suspended--; }
    }

    // ---- Ochrona przed utratą pracy ----
    /**
     * Pyta o zgodę na akcję zastępującą bieżący arkusz, ale tylko gdy są niezapisane zmiany.
     * @param {string} consequence Co się stanie, np. "Wczytanie pliku zastąpi bieżący arkusz."
     * @returns {Promise<boolean>} true, gdy można kontynuować.
     */
    async function confirmDiscard(consequence) {
        if (!hasUnsavedChanges()) return true;
        return askConfirm(
            `Masz niezapisane zmiany w arkuszu oceny. ${consequence} Jeśli chcesz je zachować, wróć do arkusza i zapisz plik JSON (Ctrl+S).`,
            'Niezapisane zmiany',
            'Odrzuć zmiany i kontynuuj',
            'Wróć do arkusza',
            'cancel'
        );
    }

    /**
     * Zastępuje bieżący arkusz stanem z obiektu EARL (np. z wczytanego pliku).
     * @returns {Promise<boolean>} false, gdy użytkownik zrezygnował.
     */
    async function replaceWith(data, consequence) {
        if (!(await confirmDiscard(consequence))) return false;
        runSilently(() => restoreAssessment(data));
        reset();
        return true;
    }

    // ---- Przywracanie kopii roboczej po starcie ----
    async function offerRestore() {
        const raw = storageGet();
        if (!raw) return;

        let slot;
        try {
            slot = JSON.parse(raw);
            if (!slot || slot.v !== 1 || !slot.earl || !Array.isArray(slot.earl['@graph'])) throw new Error('format');
        } catch (e) {
            storageRemove();
            return;
        }

        const savedAt = new Date(slot.savedAt);
        const when = isNaN(savedAt) ? '' : ` z ${savedAt.toLocaleString('pl-PL', { dateStyle: 'long', timeStyle: 'short' })}`;
        const label = slot.label ? `„${slot.label}”` : 'bez nazwy';

        const restore = await askConfirm(
            `Znaleziono niezapisaną kopię roboczą oceny ${label}${when}. Czy chcesz ją przywrócić? Odrzucenie usunie kopię z tej przeglądarki.`,
            'Przywrócić niezapisaną pracę?',
            'Przywróć',
            'Odrzuć',
            'confirm'
        );

        if (!restore) {
            storageRemove();
            return;
        }

        try {
            runSilently(() => restoreAssessment(slot.earl));
            dirty = true; // przywrócona praca nie jest zapisana w pliku
            if (typeof scrollToLoadedAssessment === 'function') scrollToLoadedAssessment();
            showStatus(`Przywrócono kopię roboczą${when}. Aby zachować pracę na stałe, zapisz plik JSON (Ctrl+S).`);
            announce('Przywrócono niezapisaną pracę z kopii roboczej.');
        } catch (err) {
            // Kopii NIE usuwamy, żeby nie stracić danych; użytkownik zostanie zapytany ponownie.
            console.error('Nie udało się przywrócić kopii roboczej:', err);
            if (typeof showToast === 'function') showToast('Nie udało się przywrócić kopii roboczej.', 'error');
        }
    }

    // ---- Podpięcie zdarzeń ----
    function bindEvents() {
        // Każda edycja pól kreatora lub arkusza oznacza zmiany do zapisania.
        const onEdit = (e) => {
            if (suspended > 0) return;
            const t = e.target;
            if (t && t.closest && t.closest('#auditForm, #resultsArea')) markDirty();
        };
        document.addEventListener('input', onEdit, true);
        document.addEventListener('change', onEdit, true);

        // Ponowne wygenerowanie arkusza zastępuje bieżący, więc pytamy, jeśli są niezapisane zmiany.
        document.addEventListener('submit', async (e) => {
            const form = e.target;
            if (!form || form.id !== 'auditForm' || bypassSubmitGuard) return;

            if (hasUnsavedChanges()) {
                e.preventDefault();
                e.stopImmediatePropagation();
                const ok = await confirmDiscard('Ponowne wygenerowanie arkusza zastąpi bieżący arkusz i usunie wprowadzone oceny.');
                if (!ok) return;
                bypassSubmitGuard = true;
                try { form.requestSubmit(); } finally { bypassSubmitGuard = false; }
            }
            // Nowo wygenerowany arkusz jest czysty (po zakończeniu obsługi zdarzenia).
            setTimeout(() => { if (hasSheet()) reset(); }, 0);
        }, true);

        // Zapis przy ukryciu/zamknięciu karty, zanim zadziała debounce.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flush();
        });
        window.addEventListener('pagehide', flush);

        // Ostatnia siatka bezpieczeństwa: tylko gdy autozapis nie działa.
        window.addEventListener('beforeunload', (e) => {
            if (!hasUnsavedChanges()) return;
            flush();
            if (!storageFailed) return;
            e.preventDefault();
            e.returnValue = '';
        });

        const clearBtn = document.getElementById('btn-clear-autosave');
        if (clearBtn) {
            clearBtn.addEventListener('click', async () => {
                const ok = await askConfirm(
                    'Usunąć kopię roboczą z tej przeglądarki? Bieżący arkusz pozostanie na ekranie, ale po zamknięciu strony niezapisane zmiany przepadną. Kopia utworzy się ponownie przy kolejnej zmianie.',
                    'Usunąć kopię roboczą?',
                    'Usuń kopię',
                    'Anuluj',
                    'cancel'
                );
                if (!ok) return;
                storageRemove();
                showStatus('Kopia robocza została usunięta z tej przeglądarki.');
                announce('Kopia robocza została usunięta z tej przeglądarki.');
            });
        }
    }

    /** Wywoływane po zakończeniu inicjalizacji wizarda (dane wczytane, arkusz możliwy do przywrócenia). */
    async function init() {
        bindEvents();
        await offerRestore();
    }

    window.Session = {
        init,
        markDirty,
        markSaved,
        reset,
        flush,
        runSilently,
        confirmDiscard,
        replaceWith,
        hasUnsavedChanges
    };
})();
