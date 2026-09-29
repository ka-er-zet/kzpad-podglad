// Funkcje pomocnicze dla Narzędzia Oceny PAD

const STORAGE_KEY = 'eaa_audit_state';

/**
 * Ładuje stan aplikacji z localStorage.
 * @returns {Object} Zapisany stan lub domyślny stan początkowy.
 */
function loadState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch (e) {
            console.error("Błąd parsowania zapisanego stanu:", e);
        }
    }
    return {
        product: '',
        executiveSummary: '', // Tekst podsumowania wykonawczego
        clauses: [], // Lista wybranych identyfikatorów klauzul
        tests: [],   // Spłaszczona lista wszystkich testów
        results: {}, // Klucz: testId, Wartość: { status: null, note: '' }
        currentIdx: 0
    };
}

/**
 * Zapisuje stan aplikacji do localStorage.
 * @param {Object} state Obiekt stanu do zapisania.
 */
function saveState(state) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        console.error("Błąd zapisu stanu:", e);
        if (typeof setStatusMessage === 'function') {
            setStatusMessage((window.M && window.M.utils && window.M.utils.saveError) || "Błąd zapisu stanu aplikacji. Sprawdź ustawienia przeglądarki.", 8000);
        }
    }
}

/**
 * Czyści stan aplikacji z localStorage.
 */
function clearState() {
    localStorage.removeItem(STORAGE_KEY);
}

/**
 * Zamienia znaki specjalne XML na encje — potrzebne przy eksporcie ODT.
 * @param {string} str Tekst do zamiany.
 * @returns {string} Tekst z zamienionymi znakami.
 */
function xmlEscape(str) {
    if (!str) return '';
    // Zamień spacje niełamliwe (encje HTML) na encję numeryczną XML lub znak Unicode
    // Używamy &#160; zamiast &nbsp;, bo &nbsp; nie jest standardową encją XML.
    str = str.replace(/&nbsp;/g, '&#160;');
    return str.replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
    });
}

// Wersja aplikacji (window.APP_VERSION) pochodzi z js/version.js — jedyne źródło prawdy.

/**
 * Wyświetla monit o odświeżenie strony po wykryciu nowej wersji aplikacji.
 */
function showUpdatePrompt() {
    const statusMessage = document.getElementById('status-message');
    if (statusMessage) {
        const message = window.M ? window.M.utils.updateAvailable : 'A new version of the application is available. Refresh the page to apply it.';
        statusMessage.textContent = message;
        // Automatyczne odświeżenie po 3 sekundach
        setTimeout(() => {
            window.location.reload();
        }, 3000);
    }
}

/**
 * Inicjalizuje motyw na podstawie localStorage lub preferencji systemu.
 */
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme ? savedTheme : (systemDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeIcon(theme);
    // Upewnij się, że przyciski przełącznika motywu odzwierciedlają aktualny stan (dla AT i etykiet widocznych)
    if (typeof updateThemeToggleButtons === 'function') updateThemeToggleButtons(theme);
}

/**
 * Przełącza motyw między jasnym a ciemnym.
 */
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
    // Zaktualizuj przyciski i ogłoś nowy stan technologiom wspomagającym
    if (typeof updateThemeToggleButtons === 'function') updateThemeToggleButtons(newTheme);
    const hasM = (typeof M !== 'undefined' && M && M.navigation);
    const modeText = (newTheme === 'dark') ? (hasM && M.navigation.themeDark ? M.navigation.themeDark : 'Dark') : (hasM && M.navigation.themeLight ? M.navigation.themeLight : 'Light');
    const msgTemplate = (hasM && M.navigation.themeSet) ? M.navigation.themeSet : 'Theme set: {mode}.';
    const message = msgTemplate.replace('{mode}', modeText);
    if (typeof setStatusMessage === 'function') setStatusMessage(message, 4000);
}

function updateThemeIcon(theme) {
    const icon = document.getElementById('theme-icon');
    if (icon) {
        if (theme === 'dark') {
            icon.setAttribute('data-lucide', 'sun');
        } else {
            icon.setAttribute('data-lucide', 'moon');
        }
        lucide.createIcons();
    }
}

/**
 * Pozycjonuje etykietę ikony tak, by pozostała w obszarze widoku.
 * Stara się wyśrodkować ją nad przyciskiem; jeśli brakuje miejsca,
 * przesuwa etykietę odpowiednio w lewo lub w prawo.
 */
function placeIconLabel(buttonEl, labelEl) {
    if (!buttonEl || !labelEl) return;
    try {
        // Zresetuj klasy i style pozycjonowania
        labelEl.classList.remove('icon-label--left', 'icon-label--right');
        labelEl.style.left = '';
        labelEl.style.right = '';

        // Wymuś przeliczenie układu, by pomiary były wiarygodne (etykieta może być początkowo ukryta)
        void labelEl.offsetWidth;

        const brect = buttonEl.getBoundingClientRect();
        const labelRect = labelEl.getBoundingClientRect();
        const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
        const spaceRight = vw - brect.left;
        const centerLeft = brect.left + (brect.width / 2) - (labelRect.width / 2);

        // Preferowane: wyśrodkowanie nad przyciskiem przy użyciu bezwzględnych współrzędnych (działa z position:fixed)
        if (centerLeft >= 8 && (centerLeft + labelRect.width) <= (vw - 8)) {
            labelEl.style.left = `${centerLeft}px`;
            labelEl.classList.remove('icon-label--left', 'icon-label--right');
        } else if (brect.left < vw / 2) {
            // Wyrównanie do prawej krawędzi przycisku (lewa strona)
            const leftPx = Math.min(brect.left + 8, vw - labelRect.width - 8);
            labelEl.style.left = `${leftPx}px`;
            labelEl.classList.add('icon-label--left');
        } else {
            // Wyrównanie do lewej krawędzi przycisku (prawa strona)
            const leftPx = Math.max(brect.right - labelRect.width - 8, 8);
            labelEl.style.left = `${leftPx}px`;
            labelEl.classList.add('icon-label--right');
        }

        // Pozycja pionowa: pod przyciskiem, chyba że wykracza poza viewport — wtedy powyżej
        const viewportH = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
        let topPx = brect.bottom + 8;
        if ((topPx + labelRect.height + 8) > viewportH) {
            // przesuń powyżej
            topPx = Math.max(brect.top - labelRect.height - 8, 8);
        }
        labelEl.style.top = `${topPx}px`;
        labelEl.style.transform = 'translateY(0)';
    } catch (e) {
        // Ignoruj błędy pomiarów
    }
}

// Globalna funkcja ukrywająca wszystkie etykiety ikon
function hideAllIconLabels() {
    document.querySelectorAll('.icon-label').forEach(label => {
        label.classList.remove('icon-label--visible');
    });
}

function showIconLabel(label) {
    // Jeśli użytkownik zamknął etykietę Escape'em, nie pokazuj jej ponownie, dopóki kursor nie oddali się i nie wróci
    if (label.dataset.isDismissed === 'true') return;

    // Ukryj wszystkie pozostałe etykiety
    hideAllIconLabels();
    // Pokaż tę
    label.classList.add('icon-label--visible');
}

/**
 * Ulepsza przyciski zawierające tylko ikony o widoczne etykiety pojawiające się przy hover/focus.
 * Dodaje spany .icon-label, usuwa nadmiarowe aria-label/title.
 */
function enhanceIconButtons() {
    const selectors = ['#menu-toggle', '#btn-save-audit', '#btn-edit-config', '#btn-save-wizard', '#btn-load-wizard', '#btn-download-spreadsheet', 'button[onclick*="toggleTheme"]', '.theme-toggle'];
    const seen = new Set();
    selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
            if (seen.has(el)) return;
            seen.add(el);
            // Szczególny przypadek: przyciski przełącznika motywu zawsze dostają icon-label
            const isThemeToggle = el.matches('button[onclick*="toggleTheme"]') || el.classList.contains('theme-toggle');
            // Pomiń przyciski, które już mają pomocnicze spany (z wyjątkiem przełączników motywu)
            if (!isThemeToggle && el.querySelector('.nav-helper, .sr-only, .visually-hidden')) return;
            // Preferuj data-icon-label (rozdzielenie wizualne/fonetyczne), następnie aria-label lub title
            const label = el.getAttribute('data-icon-label') || el.getAttribute('aria-label') || el.title || el.getAttribute('data-i18n-title');
            if (!label) return;
            // Unikaj duplikowania istniejących etykiet
            if (el.querySelector('.icon-label')) return;
            // Upewnij się, że przycisk ma position:relative dla absolutnego pozycjonowania etykiety
            if (!getComputedStyle(el).position || getComputedStyle(el).position === 'static') {
                el.style.position = 'relative';
            }
            const span = document.createElement('span');
            span.className = 'icon-label';
            span.textContent = label;
            span.setAttribute('aria-hidden', 'true');
            el.appendChild(span);

            // Dla przycisków z widoczną etykietą usuń title, by uniknąć tooltipa przeglądarki (zachowaj aria-label dla czytników ekranu)
            if (el.hasAttribute('title')) {
                el.removeAttribute('title');
            }

            // Pozycjonuj etykietę po ustabilizowaniu układu (next tick)
            const showAndPosition = () => {
                placeIconLabel(el, span);
                showIconLabel(span);
            };

            el.addEventListener('mouseenter', showAndPosition);
            el.addEventListener('focus', showAndPosition);

            el.addEventListener('mouseleave', (e) => {
                // Ukryj tylko jeśli kursor nie przeszedł na samą etykietę (WCAG 1.4.13 Hoverable)
                if (e.relatedTarget !== span && !span.contains(e.relatedTarget)) {
                    delete span.dataset.isDismissed;
                    hideAllIconLabels();
                }
            });

            el.addEventListener('blur', (e) => {
                // Ukryj tylko jeśli fokus nie przeszedł na etykietę (etykiety zazwyczaj nie są focusowalne)
                if (e.relatedTarget !== span) {
                    delete span.dataset.isDismissed;
                    hideAllIconLabels();
                }
            });

            el.addEventListener('mousemove', () => {
                if (span.classList.contains('icon-label--visible')) {
                    placeIconLabel(el, span);
                }
            });

            // Zezwól na najechanie na samą etykietę (WCAG 1.4.13)
            span.addEventListener('mouseenter', () => showIconLabel(span));
            span.addEventListener('mouseleave', (e) => {
                // Ukryj jeśli kursor nie wrócił do przycisku ani jego potomków
                if (e.relatedTarget !== el && !el.contains(e.relatedTarget)) {
                    delete span.dataset.isDismissed;
                    hideAllIconLabels();
                }
            });

            try { setTimeout(() => { placeIconLabel(el, span); }, 0); } catch (e) { /* ignore */ }
        });
    });
}

/**
 * Obsługa klawisza Escape — ukrywa wszystkie tooltips/etykiety (WCAG 1.4.13 Dismissible)
 */
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.icon-label--visible').forEach(label => {
            label.dataset.isDismissed = 'true';
            label.classList.remove('icon-label--visible');
        });
    }
});

// Repozycjonuj etykiety przy zmianie rozmiaru okna, by pozostały w obszarze widoku
window.addEventListener('resize', () => {
    document.querySelectorAll('.icon-label').forEach(label => {
        const btn = label.parentElement;
        placeIconLabel(btn, label);
    });
});

// Ukryj etykiety ikon przy przewijaniu lub kliknięciu poza przyciskiem
window.addEventListener('scroll', () => hideAllIconLabels());
document.addEventListener('click', (e) => {
    if (!e.target.closest('button') && !e.target.closest('.clause-tag')) {
        hideAllIconLabels();
    }
});

/**
 * Aktualizuje dostępne etykiety przycisków przełącznika motywu.
 * Przełącznik motywu traktowany jest jak przycisk (akcja), a nie przełącznik (stan),
 * co lepiej odzwierciedla jego funkcję i zapewnia czytelną etykietę akcji.
 * - aktualizuje aria-label tak, by opisywał akcję (przełącz na drugi tryb)
 * - aktualizuje widoczny .icon-label (jeśli istnieje) z tekstem akcji
 */
function updateThemeToggleButtons(theme) {
    try {
        const hasM = (typeof M !== 'undefined' && M && M.navigation);
        const lang = document.documentElement.lang || '';

        const localizedName = (t) => {
            if (hasM) return (t === 'dark') ? (M.navigation.themeDark || 'Dark') : (M.navigation.themeLight || 'Light');
            if (lang && lang.startsWith('pl')) return (t === 'dark') ? 'Motyw ciemny' : 'Motyw jasny';
            return (t === 'dark') ? 'Dark mode' : 'Light mode';
        };

        const localizedMode = (t) => {
            if (lang && lang.startsWith('pl')) return (t === 'dark') ? 'ciemny' : 'jasny';
            return (t === 'dark') ? 'dark' : 'light';
        };

        const stateText = localizedName(theme);
        const opposite = (theme === 'dark') ? 'light' : 'dark';
        const oppositeText = localizedMode(opposite);

        // Szablon dla akcji (co się stanie po aktywacji)
        const actionTemplate = (hasM && M.navigation.toggleTo) ? M.navigation.toggleTo : (lang && lang.startsWith('pl') ? 'Przełącz motyw na {mode}' : 'Toggle theme to {mode}');
        const actionText = actionTemplate.replace('{mode}', oppositeText);

        document.querySelectorAll('button[onclick*="toggleTheme"]').forEach(el => {
            // Zaktualizuj aria-label do opisu akcji (przełącz na przeciwny tryb)
            el.setAttribute('aria-label', actionText);

            // Zaktualizuj widoczną etykietę do opisu akcji (przełącz na przeciwny tryb)
            const labelEl = el.querySelector('.icon-label');
            if (labelEl) {
                labelEl.textContent = actionText;
                // Usuń title, by uniknąć duplikatu tooltipa gdy widoczna etykieta istnieje
                if (el.hasAttribute('title')) {
                    el.removeAttribute('title');
                }
                // Pozycjonuj etykietę w obszarze widoku
                placeIconLabel(el, labelEl);
            }
        });
    } catch (e) {
        console.warn('updateThemeToggleButtons failed', e);
    }
}

/**
 * Wyświetla niestandardowe okno potwierdzenia.
 * @param {string} message Wiadomość do wyświetlenia.
 * @param {string} title Tytuł okna.
 * @param {string} confirmText Tekst przycisku potwierdzenia.
 * @param {string} cancelText Tekst przycisku anulowania.
 * @returns {Promise<boolean>} Promise rozwiązujący się na true jeśli potwierdzone, false w przeciwnym razie.
 */
/**
 * Wyświetla niestandardowe okno potwierdzenia.
 * @param {string} message Treść wiadomości
 * @param {string} title Tytuł dialogu
 * @param {string} confirmText Tekst przycisku potwierdzenia (wykona akcję)
 * @param {string} cancelText Tekst przycisku anulowania (anuluje akcję)
 * @param {string} focusOn Which button should be focused and placed on the right by default: 'confirm' or 'cancel'
 */
function confirmModal(message, title = "Potwierdzenie", confirmText = "Potwierdź", cancelText = "Anuluj", focusOn = 'confirm') {
    return new Promise((resolve) => {
        let dialog = document.getElementById('app-confirm-dialog');
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.id = 'app-confirm-dialog';
            dialog.setAttribute('aria-labelledby', 'dialog-title');
            dialog.setAttribute('aria-modal', 'true');
            // aria-describedby usunięte, by uniknąć powtórnego odczytywania przez VoiceOver przy focusie na elemencie potomnym
            dialog.innerHTML = `
                <h3 id="dialog-title" style="margin-top: 0;"></h3>
                <p id="dialog-message"></p>
                <div class="dialog-actions">
                    <button id="dialog-cancel" class="outline secondary"></button>
                    <button id="dialog-confirm"></button>
                </div>
            `;
            document.body.appendChild(dialog);
        }

        const titleEl = dialog.querySelector('#dialog-title');
        const msgEl = dialog.querySelector('#dialog-message');
        const cancelBtn = dialog.querySelector('#dialog-cancel');
        const confirmBtn = dialog.querySelector('#dialog-confirm');

        titleEl.textContent = title;
        msgEl.textContent = message;
        confirmBtn.textContent = confirmText;
        cancelBtn.textContent = cancelText;

        const close = (result) => {
            dialog.close();
            resolve(result);
        };

        cancelBtn.onclick = () => close(false);
        confirmBtn.onclick = () => close(true);

        // Obsługa ESC
        dialog.oncancel = (e) => {
            e.preventDefault();
            close(false);
        };

        const actions = dialog.querySelector('.dialog-actions');
        if (focusOn === 'cancel') {
            // Umieść przycisk anulowania po prawej i ustaw go jako główny (fokus)
            actions.classList.add('reverse-buttons');
            // Zamień style wizualne: anuluj jako główny, potwierdź jako drugorzędny
            cancelBtn.classList.remove('outline', 'secondary');
            confirmBtn.classList.add('outline', 'secondary');
            cancelBtn.focus();
        } else {
            actions.classList.remove('reverse-buttons');
            // Upewnij się, że domyślny styl: potwierdź jest główny
            confirmBtn.classList.remove('outline', 'secondary');
            cancelBtn.classList.add('outline', 'secondary');
            confirmBtn.focus();
        }

        dialog.showModal();
    });
}

/**
 * Wyświetla prosty dialog informacyjny z przyciskiem OK.
 * @param {string} message Treść wiadomości
 * @param {string} [title] Tytuł dialogu
 * @returns {Promise<void>} Promise rozwiązujący się po zamknięciu dialogu
 */
async function alertModal(message, title = 'Informacja') {
    return new Promise((resolve) => {
        let dialog = document.getElementById('app-alert-dialog');
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.id = 'app-alert-dialog';
            dialog.setAttribute('aria-labelledby', 'alert-dialog-title');
            dialog.setAttribute('aria-modal', 'true');
            dialog.innerHTML = `
                <h3 id="alert-dialog-title" style="margin-top:0;"></h3>
                <p id="alert-dialog-message"></p>
                <div class="dialog-actions">
                    <button id="alert-ok"></button>
                </div>
            `;
            document.body.appendChild(dialog);
        }

        const titleEl = dialog.querySelector('#alert-dialog-title');
        const msgEl = dialog.querySelector('#alert-dialog-message');
        const okBtn = dialog.querySelector('#alert-ok');

        titleEl.textContent = title;
        msgEl.textContent = message;
        okBtn.textContent = (window.M && window.M.utils && window.M.utils.ok) || 'OK';

        const close = () => {
            dialog.close();
            resolve();
        };

        okBtn.onclick = close;

        dialog.oncancel = (e) => {
            e.preventDefault();
            close();
        };

        // Domyślnie fokus na przycisku OK
        okBtn.focus();

        dialog.showModal();
    });
}

/**
 * Wyświetla dialog z polem wprowadzania tekstu.
 * @param {string} message Treść zachęty
 * @param {string} [title] Tytuł dialogu
 * @param {string} [defaultValue] Domyślna wartość pola
 * @returns {Promise<string|null>} Wprowadzona wartość lub null jeśli anulowano
 */
async function promptModal(message, title = 'Wprowadź dane', defaultValue = '') {
    return new Promise((resolve) => {
        let dialog = document.getElementById('app-prompt-dialog');
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.id = 'app-prompt-dialog';
            dialog.setAttribute('aria-modal', 'true');
            dialog.innerHTML = `
                <article>
                    <header>
                        <button aria-label="Zamknij" class="close" id="prompt-close"></button>
                        <h3 id="prompt-dialog-title" style="margin: 0;"></h3>
                    </header>
                    <p id="prompt-dialog-message" style="margin-bottom: 1rem;"></p>
                    <input type="text" id="prompt-input" style="margin-bottom: 1.5rem;">
                    <footer>
                        <button id="prompt-cancel" class="outline secondary">Anuluj</button>
                        <button id="prompt-ok" class="primary">OK</button>
                    </footer>
                </article>
            `;
            document.body.appendChild(dialog);
        }

        const titleEl = dialog.querySelector('#prompt-dialog-title');
        const msgEl = dialog.querySelector('#prompt-dialog-message');
        const inputEl = dialog.querySelector('#prompt-input');
        const cancelBtn = dialog.querySelector('#prompt-cancel');
        const okBtn = dialog.querySelector('#prompt-ok');
        const closeBtn = dialog.querySelector('#prompt-close');

        titleEl.textContent = title;
        msgEl.textContent = message;
        inputEl.value = defaultValue;

        const close = (result) => {
            dialog.close();
            resolve(result);
        };

        okBtn.onclick = () => close(inputEl.value);
        cancelBtn.onclick = () => close(null);
        closeBtn.onclick = () => close(null);

        inputEl.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                close(inputEl.value);
            }
        };

        dialog.oncancel = () => resolve(null);

        dialog.showModal();
        setTimeout(() => inputEl.focus(), 50);
    });
}

/**
 * Aktualizuje komunikat o stanie w regionie aria-live.
 * @param {string} message Treść komunikatu
 * @param {number} [duration] Czas wyświetlania w ms (0 = na stałe)
 */
function setStatusMessage(message, duration = 5000) {
    const statusEl = document.getElementById('status-message');
    if (statusEl) {
        statusEl.textContent = message;
        if (duration > 0) {
            setTimeout(() => {
                if (statusEl.textContent === message) {
                    statusEl.textContent = '';
                }
            }, duration);
        }
    }
}

/**
 * Generuje raport EARL ze stanu aplikacji.
 * @param {Object} state Stan aplikacji.
 * @returns {Object} Obiekt raportu EARL.
 */
function generateEARL(state) {
    const context = {
        "earl": "http://www.w3.org/ns/earl#",
        "dct": "http://purl.org/dc/terms/",
        "foaf": "http://xmlns.com/foaf/0.1/",
        "sch": "http://schema.org/",
        "xsd": "http://www.w3.org/2001/XMLSchema#",
        "eaa": "https://github.com/ka-er-zet/eaa-pfron#"
    };

    // Assertor (Narzędzie)
    const assertor = {
        "@id": "_:assertor",
        "@type": ["earl:Software", "earl:Assertor"],
        "dct:title": "Narzędzie Oceny Zgodności z PAD",
        "dct:description": "Narzędzie do oceny zgodności z Polskim Aktem o Dostępności (PAD) opracowane przez Fundację Widzialni",
        "dct:hasVersion": "1.0.0"
    };

    // Human Assertor (jeśli podany)
    let mainAssertor = assertor;
    if (state.auditor) {
        const humanAssertor = {
            "@id": "_:humanAssertor",
            "@type": ["foaf:Person", "earl:Assertor"],
            "foaf:name": state.auditor
        };

        // Utwórz złożony assertor
        mainAssertor = {
            "@id": "_:compoundAssertor",
            "@type": "earl:Assertor",
            "earl:mainAssertor": { "@id": "_:humanAssertor" },
            "dct:description": "Ocena przeprowadzona przez człowieka przy użyciu narzędzia"
        };
    }

    // Test Subject (Produkt)
    const testSubject = {
        "@id": "_:subject",
        "@type": ["earl:TestSubject", "sch:Product"],
        "dct:title": state.product || "Nieznany produkt",
        "dct:description": state.productDesc || '',
        "dct:date": new Date().toISOString()
    };

    // Konfiguracja aplikacji (rozszerzenie niestandardowe do zachowania stanu)
    const appConfig = {
        "@type": "eaa:Configuration",
        "eaa:clauses": state.clauses || [],
        "eaa:currentIdx": state.currentIdx || 0,
        "eaa:executiveSummary": state.executiveSummary || '',
        "eaa:selectedProfile": state.selectedProfile || 'none'
    };

    // Assertions
    const assertions = state.tests.filter(t => t.type === 'test').map(t => {
        const res = state.results[t.id] || { status: 'not-tested', note: '' };

        let outcome = 'earl:untested';
        if (res.status === 'pass' || res.status === 'Zaliczone') outcome = 'earl:passed';
        else if (res.status === 'fail' || res.status === 'Niezaliczone') outcome = 'earl:failed';
        else if (res.status === 'na' || res.status === 'Nie dotyczy') outcome = 'earl:inapplicable';
        else if (res.status === 'nt' || res.status === 'Nietestowalne') outcome = 'earl:cantTell';

        return {
            "@type": "earl:Assertion",
            "earl:assertedBy": { "@id": state.auditor ? "_:compoundAssertor" : "_:assertor" },
            "earl:subject": { "@id": "_:subject" },
            "earl:test": {
                "@type": "earl:TestCriterion",
                "dct:title": t.title,
                "dct:identifier": t.id
            },
            "earl:result": {
                "@type": "earl:TestResult",
                "earl:outcome": { "@id": outcome },
                "dct:description": res.note || '',
                "dct:date": new Date().toISOString()
            },
            "earl:mode": { "@id": "earl:manual" }
        };
    });

    const graph = [assertor, testSubject, appConfig, ...assertions];
    if (state.auditor) {
        graph.unshift({
            "@id": "_:humanAssertor",
            "@type": ["foaf:Person", "earl:Assertor"],
            "foaf:name": state.auditor
        });
        graph.unshift(mainAssertor);
    }

    return {
        "@context": context,
        "@graph": graph
    };
}

/**
 * Parsuje raport EARL z powrotem do obiektu stanu aplikacji.
 * @param {Object} earlData Obiekt raportu EARL.
 * @returns {Object} Odtworzony stan aplikacji.
 */
function parseEARL(earlData) {
    const graph = earlData['@graph'] || [];

    // Znajdź konfigurację
    const config = graph.find(item => item['@type'] === 'eaa:Configuration') || {};

    // Znajdź podmiot testu
    const subject = graph.find(item => {
        const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
        return types.includes('earl:TestSubject') || types.includes('sch:Product');
    }) || {};

    // Znajdź assertora (człowieka)
    const human = graph.find(item => {
        const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
        return types.includes('foaf:Person');
    });

    const state = {
        product: subject['dct:title'] || '',
        productDesc: subject['dct:description'] || '',
        auditor: human ? human['foaf:name'] : '',
        executiveSummary: config['eaa:executiveSummary'] || '',
        clauses: config['eaa:clauses'] || [],
        currentIdx: config['eaa:currentIdx'] || 0,
        selectedProfile: config['eaa:selectedProfile'] || 'none',
        tests: [], // Zostanie uzupełnione przez aplikację na podstawie klauzul
        results: {}
    };

    // Parsuj asercje
    graph.forEach(item => {
        if (item['@type'] === 'earl:Assertion') {
            const testId = item['earl:test']?.['dct:identifier'];
            const result = item['earl:result'];

            if (testId && result) {
                let status = null;
                const outcome = result['earl:outcome']?.['@id'] || result['earl:outcome'];

                if (outcome === 'earl:passed') status = 'pass';
                else if (outcome === 'earl:failed') status = 'fail';
                else if (outcome === 'earl:inapplicable') status = 'na';
                else if (outcome === 'earl:cantTell') status = 'nt';

                state.results[testId] = {
                    status: status,
                    note: result['dct:description'] || ''
                };
            }
        }
    });

    return state;
}

/**
 * Oblicza statystyki oceny i werdykt na podstawie stanu.
 * @param {Object} state Stan aplikacji.
 * @returns {Object} Obiekt statystyk { total, passed, failed, na, nt, toVerify, verdict, verdictLabel }
 */
function getAuditStats(state) {
    const results = state.results || {};
    const tests = (state.tests || []).filter(t => t.type === 'test');

    const failedTests = tests.filter(t => results[t.id]?.status === 'fail' || results[t.id]?.status === 'Niezaliczone');
    const passedTests = tests.filter(t => results[t.id]?.status === 'pass' || results[t.id]?.status === 'Zaliczone');
    const naTests = tests.filter(t => results[t.id]?.status === 'na' || results[t.id]?.status === 'Nie dotyczy');
    const ntTests = tests.filter(t => results[t.id]?.status === 'nt' || results[t.id]?.status === 'Nietestowalne' || results[t.id]?.status === 'Nie do sprawdzenia');

    // "Do weryfikacji" = wszystkie testy − (Niezaliczone + Zaliczone + ND + NT)
    const processedIds = new Set([...failedTests, ...passedTests, ...naTests, ...ntTests].map(t => t.id));
    const verifyTests = tests.filter(t => !processedIds.has(t.id));

    let verdict = 'in-progress';
    let verdictLabel = 'NIEZAKOŃCZONY';

    if (failedTests.length > 0) {
        verdict = 'failed';
        verdictLabel = 'NIEZALICZONY';
    } else if (verifyTests.length > 0) {
        verdict = 'in-progress';
        verdictLabel = 'NIEZAKOŃCZONY';
    } else {
        verdict = 'passed';
        if (passedTests.length === 0 && naTests.length > 0 && ntTests.length === 0) {
            verdictLabel = 'BRAK NIEZGODNOŚCI';
        } else {
            verdictLabel = 'ZALICZONY';
        }
    }

    return {
        total: tests.length,
        passed: passedTests.length,
        failed: failedTests.length,
        na: naTests.length,
        nt: ntTests.length,
        toVerify: verifyTests.length,
        verdict,
        verdictLabel,
        lists: {
            passed: passedTests,
            failed: failedTests,
            na: naTests,
            nt: ntTests,
            verify: verifyTests
        }
    };
}

/**
 * Naprawia osierocone spójniki w tekście, dodając spacje niełamliwe.
 * @param {string} text Tekst do naprawy.
 * @returns {string} Naprawiony tekst.
 */
function fixOrphans(text) {
    if (!text) return text;
    // Zamień spację + pojedyncza litera (a, i, o, u, w, z) + spację na spację + litera + spacja niełamliwa
    // Bez rozróżniania wielkości liter. Używamy \u00a0, bezpieczniejszego zarówno dla XML, jak i HTML.
    return text.replace(/(\s|^)([aiouwzAIOWZ])\s+/g, '$1$2\u00a0');
}

/**
 * Prosty parser Markdown dla podzbioru standardowych znaczników.
 * Obsługuje: **pogrubienie**, *kursywa*, [link](url), `kod`, \n -> br
 * @param {string} text Tekst Markdown
 * @returns {string} Oczyszczony ciąg HTML
 */
function parseMarkdown(text) {
    if (!text) return '';

    // 1. Obsłuż dosłowny ciąg \n (backslash + n)
    let t = text.replace(/\\n/g, '\n');

    // Przechowaj tabele HTML i inne gotowe bloki HTML przed escapowaniem
    const htmlStash = [];
    const stash = (tag) => {
        const key = `\x00${htmlStash.length}\x00`;
        htmlStash.push(tag);
        return key;
    };

    // Przechowaj tabele HTML: <table>...</table>
    t = t.replace(/<table[\s\S]*?<\/table>/gi, (match) => stash(match));

    // 2. Wstępny escaping — zapobiega wstrzyknięciu surowego HTML
    let html = t
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // 3. Formatowanie inline
    // Obrazy: ![alt](src)
    html = html.replace(/!\[(.*?)\]\((.*?)\)/g, (_, alt, src) =>
        stash(`<img src="${src}" alt="${alt}" style="max-width:100%;display:block;margin:0.5em 0">`)
    );
    // Linki: [tekst](url)
    html = html.replace(/\[(.*?)\]\((https?:\/\/.*?)\)/g, (_, text, url) =>
        stash(`<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`)
    );

    html = html
        // Pogrubienie: **tekst** lub __tekst__
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.*?)__/g, '<strong>$1</strong>')
        // Kursywa: *tekst* lub _tekst_
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/_(.*?)_/g, '<em>$1</em>')
        // Kod inline: `tekst`
        .replace(/`(.*?)`/g, '<code>$1</code>');

    // Przywróć przechowane tagi HTML
    html = html.replace(/\x00(\d+)\x00/g, (_, i) => htmlStash[+i]);

    // 4. Formatowanie blokowe: nagłówki, listy, nowe linie
    const lines = html.split('\n');
    let result = '';
    let listStack = []; // Stos do śledzenia zagnieżdżonych typów list i wcięć

    const closeAllLists = () => {
        while (listStack.length > 0) {
            result += `</${listStack.pop().type}>`;
        }
    };

    lines.forEach((line, idx) => {
        // Dopasuj wiodące spacje/wcięcia
        const indentMatch = line.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1].length : 0;
        const trimmed = line.trim();

        // Nagłówki: # Nagłówek
        const headerMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
        if (headerMatch) {
            closeAllLists();
            const level = headerMatch[1].length;
            result += `<h${level + 3}>${headerMatch[2]}</h${level + 3}>`;
            return;
        }

        // Lista nieuporządkowana: "- " lub "* "
        const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
        // Lista uporządkowana: "1. " lub "2. " itp.
        const olMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);

        if (ulMatch || olMatch) {
            const currentType = ulMatch ? 'ul' : 'ol';
            const content = ulMatch ? ulMatch[1] : olMatch[2];

            const getStartAttr = () => (olMatch && olMatch[1] !== '1') ? ` start="${olMatch[1]}"` : '';

            // Logika zagnieżdżania
            if (listStack.length === 0) {
                // Rozpocznij nową listę
                result += `<${currentType}${getStartAttr()} class="markdown-list">`;
                listStack.push({ type: currentType, indent: indent });
            } else {
                let top = listStack[listStack.length - 1];

                if (indent > top.indent) {
                    // Rozpocznij zagnieżdżoną listę
                    result += `<${currentType}${getStartAttr()} class="markdown-list">`;
                    listStack.push({ type: currentType, indent: indent });
                } else if (indent < top.indent) {
                    // Zamknij zagnieżdżone listy do pasującego lub niższego wcięcia
                    while (listStack.length > 0 && indent < listStack[listStack.length - 1].indent) {
                        result += `</${listStack.pop().type}>`;
                    }
                    // Jeśli typ na tym poziomie jest inny, zmień go
                    top = listStack[listStack.length - 1];
                    if (top && top.type !== currentType) {
                        result += `</${listStack.pop().type}><${currentType}${getStartAttr()} class="markdown-list">`;
                        listStack.push({ type: currentType, indent: indent });
                    }
                } else if (currentType !== top.type) {
                    // Takie samo wcięcie, ale inny typ (np. przejście z - na 1.)
                    result += `</${listStack.pop().type}><${currentType}${getStartAttr()} class="markdown-list">`;
                    listStack.push({ type: currentType, indent: indent });
                }
            }
            result += `<li>${content}</li>`;
        } else {
            // Nie jest elementem listy
            if (trimmed === '') {
                // Puste linie: zamknij listy
                closeAllLists();
                if (idx < lines.length - 1) result += '<br>';
            } else {
                // Zwykły akapit — jeśli byliśmy w liście, zamknij ją
                // W tym prostym modelu każda linia bez znacznika listy zamyka listę.
                closeAllLists();
                result += line;
                if (idx < lines.length - 1) {
                    result += '<br>';
                }
            }
        }
    });

    closeAllLists();

    return result;
}

/**
 * Usuwa numerację ID z początku tekstu (np. "C.5.1 Tytuł" -> "Tytuł")
 */
function stripNumbering(text) {
    if (!text) return '';
    // Zob. stripNumbering w wizard.js — pochłaniamy też myślniki (klauzule typu "C.5.3-1").
    return text.replace(/^((?:C|U)\.[A-Za-z0-9\.-]+|[\d\.]+|[A-Z]\d+[\.\)]?)\s*/, '');
}

/**
 * Rozwija skróty prawne dla czytników ekranu
 */
function expandLegal(text) {
    if (!text) return '';
    return text
        .replace(/art\./gi, 'artykuł ')
        .replace(/ust\./gi, ', ustęp ')
        .replace(/pkt\.?/gi, ', punkt ')
        .replace(/lit\./gi, ', litera ')
        .replace(/,\s*,/g, ',')    // sprzątanie podwójnych przecinków
        .replace(/^\s*,\s*/, '')   // usuń przecinek na samym początku
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Zwraca polską etykietę dla podanego kodu statusu.
 * @param {string} status Kod statusu (pass, fail, na, nt, itp.)
 * @returns {string} Polska etykieta.
 */
function getStatusLabel(status) {
    if (!status || status === 'not-tested' || status === 'brak') return 'Nietestowany';
    if (status === 'pass' || status === 'Zaliczone') return 'Zaliczone';
    if (status === 'fail' || status === 'Niezaliczone') return 'Niezaliczone';
    if (status === 'na' || status === 'Nie dotyczy') return 'Nie dotyczy';
    if (status === 'nt' || status === 'Nietestowalne' || status === 'Nie do sprawdzenia') return 'Nietestowany';
    return status;
}

/**
 * Generuje nazwę pliku dla raportu.
 * @param {string} product Nazwa produktu
 * @param {string} ext Rozszerzenie pliku (bez kropki)
 * @param {string} prefix Prefiks nazwy pliku (domyślnie 'raport_eaa_')
 * @returns {string} Nazwa pliku
 */
function getFilename(product, ext, prefix = 'raport_eaa_') {
    const date = new Date().toISOString().split('T')[0];
    const safeProduct = (product || 'produkt').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    return `${prefix}${safeProduct}_${date}.${ext}`;
}

/**
 * Zapisuje stan i pobiera plik JSON z oceną (format EARL).
 * @param {Object} state Stan aplikacji
 * @param {boolean} isDraft Czy jest to wersja robocza (dodaje prefiks 'draft_')
 */
function downloadAudit(state, isDraft = true) {
    // 1. Zapisz do localStorage
    saveState(state);

    // 2. Generuj raport EARL
    const report = generateEARL(state);

    // 3. Pobierz stan jako JSON (format EARL)
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(report, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);

    const prefix = isDraft ? 'draft_raport_eaa_' : 'raport_eaa_';
    downloadAnchorNode.setAttribute("download", getFilename(state.product, 'json', prefix));

    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();

    // 4. Feedback dla czytników ekranu
    let liveRegion = document.getElementById('a11y-live-region');
    if (!liveRegion) {
        liveRegion = document.createElement('div');
        liveRegion.id = 'a11y-live-region';
        liveRegion.className = 'sr-only';
        liveRegion.setAttribute('aria-live', 'polite');
        document.body.appendChild(liveRegion);
    }
    liveRegion.innerText = (window.M && window.M.utils && window.M.utils.saveSuccess) || 'Zapisano raport i pobrano plik.';
}

// Pomocnik data-i18n (obiekt komunikatów + opcjonalny element root)
function getMessageByKey(messages, key) {
    if (!messages || !key) return undefined;

    const tryKey = (k) => {
        const parts = k.split('.');
        let cur = messages;
        for (const p of parts) {
            if (!cur || !(p in cur)) return undefined;
            cur = cur[p];
        }
        return cur;
    };

    // Najpierw spróbuj dokładnego klucza
    let val = tryKey(key);
    if (typeof val !== 'undefined') return val;

    // Mapowanie aliasów dla zachowania wstecznej zgodności
    const aliasPairs = [
        ['fileLoad.', 'error.load.'],
        ['error.load.', 'fileLoad.']
    ];

    for (const [from, to] of aliasPairs) {
        if (key.startsWith(from)) {
            const alt = to + key.slice(from.length);
            val = tryKey(alt);
            if (typeof val !== 'undefined') return val;
        }
    }

    return undefined;
}

function applyDataI18n(messages, root = document) {
    if (!messages) return;
    // Elementy z data-i18n
    root.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const val = getMessageByKey(messages, key);
        if (typeof val === 'undefined') return;
        if (typeof val === 'string' && /<[^>]+>/.test(val)) {
            el.innerHTML = val;
        } else {
            el.textContent = val;
        }
    });
    // Adresy href
    root.querySelectorAll('a[data-i18n-href]').forEach(a => {
        const hrefKey = a.getAttribute('data-i18n-href');
        const hrefVal = getMessageByKey(messages, hrefKey);
        if (hrefVal) a.setAttribute('href', hrefVal);
    });

    // Tytuły (title)
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        const val = getMessageByKey(messages, key);
        if (val) el.setAttribute('title', val);
    });

    // Etykiety ARIA
    root.querySelectorAll('[data-i18n-aria]').forEach(el => {
        const key = el.getAttribute('data-i18n-aria');
        const val = getMessageByKey(messages, key);
        if (val) el.setAttribute('aria-label', val);
    });

    // Placeholdery
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const val = getMessageByKey(messages, key);
        if (val) el.setAttribute('placeholder', val);
    });
}

/**
 * Sprawdza niezdefiniowane klucze data-i18n (narzędzie deweloperskie).
 * Użycie: dołącz ?i18n-check do URL strony przy ładowaniu.
 * Zwraca tablicę brakujących wpisów (pustą jeśli wszystko OK).
 */
function checkDataI18n(messages, root = document) {
    const missing = [];
    const checkAttr = (attr) => {
        root.querySelectorAll('[' + attr + ']').forEach(el => {
            const key = el.getAttribute(attr);
            if (!key) return;
            const val = getMessageByKey(messages, key);
            if (typeof val === 'undefined') {
                missing.push({ attribute: attr, key, tag: el.tagName.toLowerCase(), snippet: el.outerHTML.slice(0, 200) });
            }
        });
    };

    ['data-i18n', 'data-i18n-href', 'data-i18n-title', 'data-i18n-aria', 'data-i18n-placeholder'].forEach(checkAttr);

    if (missing.length) {
        console.group('%cI18N: unresolved data-i18n keys', 'color: #d97706; font-weight: bold;');
        missing.forEach(m => console.warn(`Missing key "${m.key}" for ${m.attribute} on <${m.tag}>`, m.snippet));
        console.table(missing.map(m => ({ key: m.key, attribute: m.attribute, tag: m.tag })));
        console.groupEnd();
    } else {
        console.info('I18N: all data-i18n keys resolved on this page');
    }

    return missing;
}

// Udostępnij funkcje globalnie
window.utils = {
    loadState,
    saveState,
    clearState,
    xmlEscape,
    initTheme,
    toggleTheme,
    confirm: confirmModal,
    alert: alertModal,
    setStatusMessage,
    generateEARL,
    parseEARL,
    fixOrphans,
    stripNumbering,
    expandLegal,
    parseMarkdown,
    getAuditStats,
    getStatusLabel,
    getFilename,
    downloadAudit,
    applyDataI18n,
    getMessageByKey,
    checkDataI18n,
    protectAssistiveHelpers
};

/**
 * Chroni elementy sr-only / visually-hidden / nav-helper przed ujawnieniem przez style inline.
 * Dołącza MutationObservery, które usuwają atrybut 'style' dodany do tych elementów.
 */
function protectAssistiveHelpers(root = document) {
    const protectElement = (el) => {
        if (!(el instanceof Element)) return;
        if (!el.classList) return;
        if (!el.classList.contains('sr-only') && !el.classList.contains('visually-hidden') && !el.classList.contains('nav-helper')) return;
        // Wyczyść istniejące style inline
        el.style.cssText = '';
        // Dołącz observer tylko raz
        if (el.__srProtected) return;
        try {
            const mo = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    if (m.type === 'attributes' && m.attributeName === 'style') {
                        if (el.getAttribute('style')) {
                            el.style.cssText = '';
                        }
                    }
                }
            });
            mo.observe(el, { attributes: true, attributeFilter: ['style'] });
            el.__srProtected = true;
            el.__srProtectedMo = mo;
        } catch (e) {
            // Ignoruj środowiska bez MutationObserver
            console.warn('protectAssistiveHelpers: could not observe element', e);
        }
    };

    try {
        // Chroń istniejące elementy
        (root.querySelectorAll('.sr-only, .visually-hidden, .nav-helper') || []).forEach(protectElement);

        // Obserwuj dodawanie elementów do DOM i chroń nowe
        const rootObserver = new MutationObserver((mutations) => {
            mutations.forEach(m => {
                if (m.type === 'childList' && m.addedNodes && m.addedNodes.length) {
                    m.addedNodes.forEach(node => {
                        if (!(node instanceof Element)) return;
                        protectElement(node);
                        (node.querySelectorAll && node.querySelectorAll('.sr-only, .visually-hidden, .nav-helper') || []).forEach(protectElement);
                    });
                }
            });
        });
        rootObserver.observe(root, { childList: true, subtree: true });
    } catch (e) {
        console.warn('protectAssistiveHelpers failed to setup observers:', e);
    }
}

// Inicjalizacja motywu przy załadowaniu strony
document.addEventListener('DOMContentLoaded', () => {
    // Wymuś odświeżenie, jeśli wersja się zmieniła — zapobiega utknięciu PWA
    const currentVersion = window.APP_VERSION;
    const storedVersion = localStorage.getItem('eaa_app_version');
    if (storedVersion && storedVersion !== currentVersion) {
        localStorage.setItem('eaa_app_version', currentVersion);
        // Jeśli mamy cache, wyczyść go dla pewności
        if ('caches' in window) {
            caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))))
                .then(() => window.location.reload(true));
        } else {
            window.location.reload(true);
        }
        return; // Stop initialization as we are reloading
    }
    localStorage.setItem('eaa_app_version', currentVersion);

    initTheme();

    // Zarejestruj Service Workera
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js')
            .then(registration => {
                // Natychmiast sprawdź aktualizacje po załadowaniu
                try { registration.update(); } catch (e) { /* ignoruj */ }

                // Automatyczne sprawdzanie co 6 godzin
                setInterval(() => {
                    try { registration.update(); } catch (e) { /* ignoruj */ }
                }, 1000 * 60 * 60 * 6);

                // Jeśli znaleziono nowego workera, wyślij mu skip waiting, by aktywował się od razu
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    if (newWorker) {
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed') {
                                // Jeśli jest aktywny kontroler, to aktualizacja — poproś SW o skip waiting
                                if (navigator.serviceWorker.controller) {
                                    try {
                                        newWorker.postMessage({ type: 'SKIP_WAITING' });
                                    } catch (e) {
                                        // Fallback: wyślij do registration.waiting, jeśli istnieje
                                        if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                                    }
                                }
                            }
                        });
                    }
                });

                // Gdy zmieni się aktywny kontroler (nowy SW przejął kontrolę), przeładuj stronę
                let refreshing = false;
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    if (refreshing) return;
                    refreshing = true;
                    // Krótki timeout, by nowy SW zdążył przejąć obsługę żądań
                    setTimeout(() => window.location.reload(true), 300);
                });

            })
            .catch(error => {
                console.error('Service Worker registration failed:', error);
            });
    }

    // Zabezpiecz elementy pomocnicze AT przed nieumyślnym ujawnieniem przez style inline
    try {
        protectAssistiveHelpers(document);
    } catch (e) {
        console.warn('protectAssistiveHelpers invocation failed', e);
    }

    // Wzbogać przyciski ikon o widoczne etykiety
    try {
        enhanceIconButtons();
    } catch (e) {
        console.warn('enhanceIconButtons invocation failed', e);
    }
});
