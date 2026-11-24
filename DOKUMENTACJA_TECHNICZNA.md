# Dokumentacja techniczna — OZ-PAD (Konfigurator Arkusza Oceny)

**Wersja:** 1.4.2  
**Data:** wrzesień 2026 (dokumentacja uzupełniona w listopadzie 2026: panel nawigacji, kopie robocze, wyszukiwarka, testy)

---

## 1. Architektura systemu

OZ-PAD to aplikacja webowa typu **Single Page Application (SPA)**, w całości oparta na technologiach front-end. Nie posiada back-endu ani bazy danych po stronie serwera. Całość logiki działa w przeglądarce użytkownika.

### Moduły

| Plik | Rola |
|---|---|
| `index.html` + `js/wizard.js` | Moduł oceny — główna ścieżka pracy użytkownika (arkusz, podsumowanie, przeglądarka wymagań, eksporty XLSX i JSON) |
| `js/nav-panel.js` + `css/nav-panel.css` | Panel nawigacji (menu boczne, listwa ikon), widoki z adresami `#start`, `#nowy-arkusz`, `#arkusz`, `#wymagania`, skrót Alt+M |
| `js/session.js` | Kopie robocze ocen (autozapis w IndexedDB), ochrona przed utratą pracy, blokada tej samej oceny w dwóch kartach |
| `js/search.js` + `js/minisearch.js` | Wyszukiwarka przeglądarki wymagań (MiniSearch + własny stemmer polski) |
| `editor.html` + `js/editor.js` | Moduł edycji danych (administracyjny) |
| `js/exporter.js` | Współdzielona logika eksportu (ODT) |
| `js/utils.js` | Funkcje pomocnicze współdzielone między modułami (m.in. `ModalManager`, renderowanie Markdown, statystyki oceny) |
| `js/version.js` | Jedyne źródło prawdy o wersji aplikacji (`APP_VERSION`); używany przez stronę i Service Worker |
| `css/wizard.css`, `css/pico.min.css` | Style aplikacji i biblioteka stylów |
| `service-worker.js` | Obsługa PWA i trybu offline |
| `clauses_json/` | Baza danych aplikacji (pliki JSON) |
| `tests/` | Testy developerskie (Node + Playwright), patrz sekcja 8 |

### Przepływ danych

```
clauses_json/*.json
       │
       ▼
   wizard.js          ← stan audytu w DOM i w pamięci przeglądarki
       │
       ├──► session.js   → kopie robocze w IndexedDB (autozapis)
       │
       ├──► nav-panel.js → panel, postęp, filtr, widoki (korzysta z elementów wizard.js)
       │
       ├──► search.js    → indeks wyszukiwania wymagań (budowany z clauses.json i mapping.json)
       │
       ├──► wizard.js    → eksport XLSX (przez ExcelJS)
       │                 → eksport JSON (EARL, stan audytu)
       │
       ├──► exporter.js  → eksport ODT (przez JSZip)
       │
       └──► index.html   → prezentacja wyników użytkownikowi
```

Eksport XLSX i JSON jest zaimplementowany w `wizard.js`, a `exporter.js` obsługuje wyłącznie ODT. `nav-panel.js` i `session.js` nie mają własnej logiki oceny: wywołują funkcje globalne `wizard.js` (np. `downloadWizardAssessment`, `downloadWizardSpreadsheet`, `generateDescriptiveSummary`, `downloadSummaryODT`).

Moduł edytora (`editor.js`) pracuje niezależnie od modułu oceny. Wczytuje pliki JSON bezpośrednio z dysku lub z serwera, umożliwia ich edycję i pobieranie zmodyfikowanych wersji.

### Reguły oceny w `wizard.js`

*   **Ocena proponowana** wynika z testów jednostkowych. Wybór innej oceny to **rozbieżność**: wymaga uzasadnienia w komentarzu (błąd po opuszczeniu pola; „Generuj podsumowanie” przenosi do pierwszego błędu). Rozbieżności trafiają do podsumowania, XLSX i ODT.
*   **Kategorie w podsumowaniu** wynikają z numeru artykułu: Art. 7–21 to `accessibility_requirements`, Art. 22, 23, 24, 26, 32, 33 to `service_provider_obligations` (art. 22 jest obowiązkiem podmiotu gospodarczego, art. 43 ustawy).
*   **Art. 19** (kryteria funkcjonalne) włącza przełącznik w arkuszu; gdy jest wyłączony, wymagania z kontenerów `data-art19-container` nie wchodzą do postępu, podsumowania ani raportów. Excel ma osobną sekcję Art. 19.
*   **Pusty arkusz Excel**: `downloadWizardSpreadsheet(false, { blank: true })`; nazwa pliku z końcówką `_do-wypelnienia`.
*   **Indeks wyszukiwania** budowany jest przy pierwszym użyciu przeglądarki wymagań, osobno dla widoku prawnego i technicznego, z dokumentów: kod, tytuł, kategoria, kody normy z mapowania i pełna treść klauzuli.

---

## 2. Uruchomienie i wdrożenie

### Uruchomienie lokalne

Aplikacja **nie może** być otwierana przez protokół `file://` — przeglądarka blokuje wtedy pobieranie plików JSON. Wymagany jest lokalny serwer HTTP:

```bash
# Python (zalecane)
python -m http.server 8000

# Node.js
npx http-server

# VS Code
# Rozszerzenie "Live Server" → kliknij "Go Live"
```

Następnie otwórz `http://localhost:8000` w przeglądarce.

### Wdrożenie produkcyjne

Aplikacja jest wdrożeniem statycznym — wystarczy skopiować zawartość katalogu projektu na serwer HTTP/HTTPS lub CDN (np. GitHub Pages, Netlify, serwer Apache/nginx).

**Wymagania:**
- Serwer musi serwować pliki JSON z nagłówkiem `Content-Type: application/json`.
- Dla pełnego działania PWA wymagany jest protokół **HTTPS** (Service Worker działa tylko przez HTTPS lub localhost).
- Brak wymagań serwerowych poza statycznym hostingiem.

**Aktualizacja bazy danych:** wystarczy podmienić pliki w katalogu `clauses_json/` i odświeżyć cache przeglądarki (lub zaktualizować wersję Service Workera — patrz sekcja 4).

---

## 3. Schematy plików JSON

### 3.1 `clauses_json/clauses.json`

Słownik klauzul technicznych (C.*) i prawnych (U.*). Klucz to ID klauzuli.

```json
{
  "U.7.1.1.a": {
    "id": "string",                  // np. "U.7.1.1.a"
    "title": "string",               // pełny tytuł klauzuli
    "evaluation": "string",          // metoda oceny, np. "Inspekcja"
    "preconditions": ["string"],     // lista wymagań wstępnych (może być pusta)
    "procedure": ["string"],         // lista kroków procedury
    "checklist": [                   // lista testów jednostkowych
      {
        "type": "test",
        "title": "string",
        "description": "string"
      }
      // lub string (nagłówek sekcji checklisty)
    ],
    "notes": ["string"],             // uwagi dodatkowe (może być pusta)
    "form": {},                      // stan formularza (wypełniany w trakcie audytu)
    "category": "string"            // "accessibility_requirements" | "service_provider_obligations"
  }
}
```

**Konwencja ID:**
- `U.` — klauzula prawna (przepis ustawy PAD), np. `U.7.1.1.a` = Art. 7 ust. 1 pkt 1 lit. a
- `C.` — klauzula techniczna (norma EN 301 549), np. `C.9.1.1.1`

### 3.2 `clauses_json/mapping.json`

Macierz powiązań przepisów ustawy z produktami/usługami i klauzulami technicznymi.

```json
{
  "products": {
    "p01": "string",   // nazwa produktu/usługi, np. "Bankomaty i wpłatomaty"
    ...
  },
  "matrix": [
    {
      "id": "string",            // np. "A07-01-01-a" (format: Art-Ust-Pkt-Lit-Tiret)
      "article": "string",       // np. "Art. 7 ust. 1 pkt 1 lit. a"
      "category": "string",      // nazwa kategorii grupującej, np. "Informacje o produkcie (Art. 7)"
      "requirement": "string",   // dosłowna treść przepisu
      "legal_id": "string",      // powiązana klauzula U.*, np. "U.7.1.1.a"
      "product_mappings": {
        "p01": "string|null",    // kody C.* oddzielone "; " lub null (nie dotyczy) lub "" (dotyczy bez kodów C)
        "p02": "string|null",
        ...
      }
    }
  ]
}
```

Wartość `null` w `product_mappings` oznacza, że dany przepis nie dotyczy tego produktu. Pusty string `""` oznacza, że przepis dotyczy, ale bez powiązanych kodów technicznych C.*.

### 3.3 `clauses_json/glossary.json`

Płaski słownik pojęć. Klucz to termin, wartość to jego definicja w formacie Markdown.

```json
{
  "Nazwa pojęcia": "Definicja w formacie tekstowym (może zawierać Markdown)",
  ...
}
```

### 3.4 `clauses_json/summaries.json`

Szablony tekstowe podsumowań raportu z audytu.

```json
{
  "legal_basis": "string",           // stopka z podstawą prawną
  "compliance_summaries": {
    "full_compliance": {             // scenariusz: wszystko spełnione
      "id": "string",
      "status": "string",            // etykieta statusu, np. "ZGODNY"
      "title": "string",             // tytuł dokumentu podsumowania
      "description": "string",       // treść główna; placeholder {productName} zostaje zastąpiony nazwą produktu
      "sections": {
        "failures_label": "string",
        "passed_label": "string",
        "inapplicable_label": "string",
        "untested_label": "string",
        "conclusions_label": "string",
        "conclusions_value": "string",
        "note_label": "string",
        "note_value": "string"
      },
      "meta": {
        "date_label": "string",
        "scope_label": "string",
        "scope_value": "string"
      }
    },
    // pozostałe scenariusze: non_compliance_full, partial_compliance,
    // partial_non_compliance, no_assessments, all_inapplicable, partial_all_inapplicable
  }
}
```

---

## 4. Service Worker i tryb offline (PWA)

Plik `service-worker.js` implementuje strategię **Network First z fallbackiem na cache**.

### Cache

- Nazwa cache: `OZ-PAD-v<wersja>` (np. `OZ-PAD-v1.4.2`) — wersja pochodzi z `js/version.js` (`importScripts`)
- Przy instalacji SW pre-cachowane są wszystkie zasoby statyczne z listy `ASSETS_TO_CACHE`: HTML, manifest, ikony, CSS (`pico.min.css`, `wizard.css`, `nav-panel.css`), JS (`version`, `utils`, `session`, `minisearch`, `search`, `exporter`, `wizard`, `nav-panel` i biblioteki), obrazy oraz pliki JSON bazy danych. **Nowy plik JS/CSS używany przez `index.html` trzeba dopisać do tej listy**, inaczej nie będzie dostępny offline (a `cache.addAll` przerwie instalację, jeśli któregoś wpisu brakuje).
- Klucze pamięci podręcznej są bez parametrów zapytania (`?…`), żeby jeden plik miał jedną kopię i działał offline niezależnie od dopisków w adresie. Przy aktywacji SW usuwa kopie z parametrami (pozostałość po starszych wersjach).
- Przy aktualizacji SW stary cache jest automatycznie usuwany i zastępowany nowym.
- SW przyjmuje komunikat `SKIP_WAITING` (natychmiastowa aktywacja nowej wersji).

### Strategie pobierania zasobów

| Typ zasobu | Strategia | Opis |
|---|---|---|
| Nawigacja (`index.html`) | Network First | Próba pobrania z sieci; fallback na cache przy braku połączenia |
| Pliki JSON (`clauses_json/`) | Network First | Zawsze próba pobrania świeżej wersji; aktualizuje cache po sukcesie |
| Pliki CSS i JS | Network First | j.w. |
| Pozostałe zasoby (obrazy itp.) | Cache First | Serwowane z cache; próba sieci tylko przy braku w cache |

### Ważna uwaga

Moduł edytora (`editor.html` i `js/editor.js`) jest **celowo wyłączony z Service Workera** — nie jest cachowany ani serwowany offline. Edytor ma działać zawsze na aktualnej wersji danych.

### Aktualizacja wdrożenia

Po podmianie plików na serwerze należy podnieść `APP_VERSION` w `js/version.js` (np. `1.4.2` → `1.4.3`) — to jedyne miejsce z numerem wersji; z niego powstaje nazwa cache'u Service Workera. Wymusi to pobranie nowej wersji przez wszystkich użytkowników przy następnym odwiedzeniu strony.

---

## 5. Moduł eksportu (`js/exporter.js`)

`exporter.js` generuje dokument ODT (OpenDocument Text) i jest wywoływany przez `wizard.js`. Pozostałe formaty powstają w `wizard.js`.

### Formaty eksportu

Nazwy plików tworzy `generateWizardFileName(ext)`: `[typ]_[profil]_[produkt]_[RRRR-MM-DD].[ext]`. Typ to `arkusz` dla JSON i `podsumowanie` dla Excela i ODT. Człony są „slugowane”, nazwa produktu obcinana do ok. 50 znaków.

| Format | Biblioteka | Przykładowy plik | Zawartość |
|---|---|---|---|
| `.xlsx` (po ocenie) | ExcelJS | `podsumowanie_[profil]_[produkt]_[data].xlsx` | Wymagania, oceny, oceny proponowane, rozbieżności, komentarze; podział na wymagania dostępności i obowiązki informacyjne; sekcja Art. 19 |
| `.xlsx` (pusty) | ExcelJS | `podsumowanie_[profil]_[produkt]_[data]_do-wypelnienia.xlsx` | Arkusz do wypełnienia poza aplikacją |
| `.odt` | JSZip | `podsumowanie_[profil]_[produkt]_[data].odt` | Dokument tekstowy z podsumowaniem i listami wyników; rozbieżności oznaczone przy wymaganiach |
| `.json` | natywny JS | `arkusz_[profil]_[produkt]_[data].json` | Pełny stan oceny (EARL JSON-LD) do późniejszego wczytania |

### Format pliku JSON (EARL)

Stan oceny zapisuje `buildAssessmentEARL()` (w `wizard.js`) jako JSON-LD z słownikami `earl`, `dct`, `foaf`, `sch`, `xsd` i `eaa`. Zawiera:

*   assertora-narzędzie z wersją `dct:hasVersion` (z `APP_VERSION`) oraz, jeśli podano, osobę oceniającą,
*   przedmiot oceny (`earl:TestSubject`) z polami `eaa:assessmentId` (identyfikator oceny, ten sam co klucz kopii roboczej), `eaa:art19Enabled` i `eaa:productCategory`,
*   asercje `earl:Assertion` dla wymagań i dla testów jednostkowych (wynik: `earl:passed`, `earl:failed`, `earl:inapplicable`, `earl:untested`).

Odczyt (`restoreAssessment`) odtwarza stan formularza. Test `roundtrip` sprawdza, że zapis → wczytanie → zapis daje identyczny plik (po pominięciu pól czasowych). Zmieniając format, zachowaj zgodność wsteczną z plikami wcześniej zapisanymi przez użytkowników.

### Zależności `exporter.js`

- `JSZip` — buduje archiwum ZIP będące strukturą pliku ODT (format ODF to archiwum ZIP z plikami XML)
- `window.utils` — funkcje pomocnicze (`getAuditStats`, `xmlEscape`)

---

## 6. Skrypt pomocniczy `generate_clauses_export.py`

Generuje czytelny eksport bazy klauzul do pliku `clauses_export.md`.

### Użycie

```bash
# Wymaga Python 3, brak zewnętrznych zależności
python generate_clauses_export.py
```

Skrypt czyta `clauses_json/clauses.json` i zapisuje `clauses_export.md` w głównym katalogu projektu. Przydatny po większych zmianach w bazie klauzul — pozwala szybko przejrzeć całą zawartość bazy w czytelnym formacie Markdown bez uruchamiania aplikacji.

---

## 7. Kopie robocze i pamięć lokalna (`js/session.js`)

Moduł `session.js` chroni pracę użytkownika przed utratą. Udostępnia obiekt `window.Session` (m.in. `Session.currentId()`).

### Model

*   Każda ocena ma **identyfikator** (`eaa:assessmentId` w pliku JSON), nadawany przy wygenerowaniu arkusza albo odczytywany z wczytanego pliku.
*   Każda ocena ma jedną **kopię roboczą** w IndexedDB. Kopia istnieje wtedy i tylko wtedy, gdy ocena ma zmiany niezapisane w pliku JSON. Zapis pliku JSON usuwa kopię; można ją też usunąć ręcznie z listy.
*   Autozapis następuje z opóźnieniem (debounce 1,5 s) po zmianie. Przy ukryciu lub zamknięciu karty kopia jest dodatkowo zapisywana synchronicznie do `localStorage` (klucz „pending”), bo zapis do IndexedDB w tym momencie nie zawsze zdąży się zakończyć.
*   Nowa ocena, wczytanie pliku, otwarcie innej kopii i ponowne wygenerowanie arkusza **zapisują kopię bieżącej pracy przed zmianą**. Za pierwszym razem użytkownik widzi okno z wyjaśnieniem, potem tylko komunikat (toast).
*   Ta sama ocena nie otworzy się w dwóch kartach (Web Locks API, klucz `oz-pad:assessment:<id>`; komunikacja między kartami przez `BroadcastChannel`).
*   Gdy zapis kopii jest niemożliwy (tryb prywatny, brak IndexedDB), działa dawna ochrona: pytania przed zastąpieniem arkusza i ostrzeżenie przeglądarki przy zamykaniu karty (`beforeunload`).

### Klucze

| Magazyn | Klucz | Zawartość |
|---|---|---|
| IndexedDB | baza `oz-pad`, magazyn `drafts` (`keyPath: id`) | kopie robocze ocen |
| localStorage | `oz-pad:pending:<id>` | awaryjny zapis przy zamykaniu karty |
| localStorage | `oz-pad:autosave:v1` | dawny pojedynczy autozapis (z wcześniejszych wersji; `session.js` nadal zna ten klucz) |
| localStorage | `oz-pad:drafts-info-seen` | użytkownik widział okno wyjaśniające kopie robocze |
| localStorage | `oz-pad:drafts-collapsed` | kafelek „Kopie robocze” zwinięty na stronie startowej (`li#drafts-section` w `.hero-grid`: nagłówek `h2` z przyciskiem `#drafts-toggle` (`aria-expanded`) i treść `#drafts-body` z listą `#drafts-list` w jednej karcie; karta ma klasę `hidden`, gdy nie ma kopii) |
| localStorage | `oz-pad:panel-collapsed`, `oz-pad:panel-groups` | stan panelu nawigacji (zwinięcie, grupy) |

Wszystkie operacje na `localStorage` są owinięte w `try/catch` (tryb prywatny, limit, blokada).

> **Migracja schematu:** `indexedDB.open('oz-pad', 1)`. Zmiana struktury magazynu wymaga podniesienia wersji bazy i obsługi `onupgradeneeded`.

---

## 8. Panel nawigacji (`js/nav-panel.js`)

*   Panel jest wstawiany w DOM zaraz po nagłówku (kolejność fokusu: nagłówek, panel, treść) i nie zmienia logiki oceny. Korzysta z funkcji i elementów `wizard.js` oraz `session.js`.
*   Tryby wynikają z zapytań `matchMedia`: **szeroki** (≥ 1360 px szerokości i > 500 px wysokości) — panel zawsze obok treści, także po kliknięciu ikony listwy (`openAt` → `setOpen`, bez podglądu; wybór jest zapamiętany w `oz-pad:panel-collapsed`); **listwa ikon** (≥ 768 px i > 500 px wysokości); węższy lub niski ekran — panel wysuwany jako okno modalne (fokus w panelu, Esc zamyka, reszta strony nieaktywna).
*   **Animacja rozwijania/zwijania (szeroki ekran):** panel „wyrasta” z listwy: odsłania się od szerokości listwy do pełnej przez `clip-path`, a listwa i panel przenikają się (`opacity`). Treść (`#main-content`, stopka) przesuwa się równolegle techniką FLIP w `withContentSlide` (Web Animations API), bo marginesy `auto` → liczba nie interpolują się w CSS. Czas i krzywa są w jednym miejscu: `--np-dur` i `--np-ease` w CSS oraz `FLIP_MS` i `FLIP_EASE` w JS (trzeba je zmieniać razem). Przy `prefers-reduced-motion: reduce` animacji nie ma. Na węższych ekranach panel wjeżdża z boku (`transform`).
*   Widoki mają adresy `#start`, `#nowy-arkusz`, `#arkusz`, `#wymagania` (Wstecz/Dalej, zmiana tytułu i fokusu).
*   **Tytuł karty przeglądarki** zmienia się z widokiem. Wszystkie tytuły przechodzą przez `Browser.updateTitle(szczegół)` (`js/wizard.js`), który dokleja po myślniku nazwę narzędzia. Panel (`setTitle` w `nav-panel.js`) odświeża tytuł przy **każdym** wywołaniu `updateView`, nie tylko przy zmianie widoku, bo po otwarciu kopii roboczej nazwa oceny pojawia się już po przełączeniu widoku. Przeglądarka wymagań ustawia własny tytuł (`Browser`), a panel go wtedy nie nadpisuje.

    | Widok (adres) | Tytuł karty |
    | --- | --- |
    | Start (`#start`) | Ocena zgodności z Polskim Aktem Dostępności |
    | Nowy arkusz (`#nowy-arkusz`) | Nowy arkusz oceny — Ocena zgodności z Polskim Aktem Dostępności |
    | Arkusz (`#arkusz`) | Arkusz oceny: *nazwa nadana ocenie* — Ocena zgodności z… (gdy ocena nie ma nazwy: rodzaj produktu, np. „Bankomaty i wpłatomaty”) |
    | Przeglądarka wymagań (`#wymagania`) | *Wymagania według Ustawy* / *Wymagania według Normy EN 301 549* / *nazwa kategorii* — Przeglądarka wymagań — Ocena zgodności z… |
*   **Logo** (`#app-logo`, `.np-brand-link`, `.np-rail-logo`, selektor `LOGO_SEL`) ma `href="index.html"` jako zapasowy, ale zwykłe kliknięcie jest przechwytywane (`onLogoClick`) i otwiera widok startowy przez `showView('start')`, bez przeładowania strony; otwarty arkusz zostaje w DOM. Kliknięcie z Ctrl/Cmd/Shift/Alt lub środkowym przyciskiem działa jak zwykły link. W widoku startowym logo ma `aria-current="page"`. Osobnej pozycji „Widok startowy” w menu nie ma.
*   Skrót **Alt+M** używa `e.code === 'KeyM'`, więc działa niezależnie od układu klawiatury.
*   Akcje panelu mapują się na istniejące funkcje (`data-act`: `new`, `load`, `browse`, `json`, `xlsx-blank`, `xlsx`, `summary`, `sum-odt`, `glossary`, `theme`). Akcje wymagające podsumowania (`data-needs-summary`) są ukryte, dopóki podsumowanie nie zostanie wygenerowane.
*   Postęp jest liczony tak samo jak w podsumowaniu (Art. 19 tylko, gdy włączony) i pokazywany także na liście kopii roboczych.

---

## 9. Wyszukiwarka (`js/search.js`)

Eksportuje `window.OZSearch` (a w Node `module.exports`, co pozwala testować ją bez przeglądarki). Silnik: MiniSearch (MIT). Polską odmianę zapewnia **własny** stemmer (obcinanie końcówek po zdjęciu polskich znaków), bez kodu z bibliotek na licencjach z obowiązkiem ujawniania źródeł (patrz `KOMPONENTY_OSS.md`).

*   Zapytanie: każde słowo osobno, w dowolnej kolejności (AND); prefiksy; literówki do 1 edycji; kody z kropkami jako całość.
*   Ranking: kod i tytuł ważniejsze niż treść klauzuli.
*   Pomocnicze: `highlight` (podświetlenie z ucieczką HTML), `snippet` (fragment treści), `clauseBody` (tekst klauzuli bez Markdown), `pluralResults`.

---

## 10. Testy

Testy są wyłącznie narzędziem developerskim; aplikacja nie ma kroku budowania. Wymagają Node.js i Playwright (`devDependencies`):

```bash
npm install
npx playwright install chromium   # jednorazowo
npm test                          # node --test tests/*.test.mjs
```

`tests/helpers.mjs` uruchamia lokalny serwer statyczny i dostarcza pomocniki (wypełnianie arkusza, zapis JSON). Zakres plików testowych:

| Plik | Co sprawdza |
|---|---|
| `roundtrip.test.mjs` | zapis → wczytanie → zapis daje identyczny JSON |
| `session.test.mjs` | kopie robocze, okno informacyjne, ponowne generowanie arkusza, ochrona przed utratą pracy |
| `nav-panel.test.mjs` | panel, adresy widoków, Alt+M, panel wysuwany na wąskim ekranie |
| `header.test.mjs` | zachowanie nagłówka na telefonie i od 768 px |
| `search.test.mjs` | stemmer, tokenizacja, wyszukiwanie |
| `discrepancy.test.mjs` | rozbieżności z oceną proponowaną, uzasadnienie, podsumowanie i eksporty |
| `summary-category.test.mjs` | Art. 22 w obowiązkach, Art. 7–21 w wymaganiach dostępności |
| `summary-escaping.test.mjs` | ucieczka HTML w komentarzach i nazwie produktu |
| `markdown.test.mjs` | struktura list (WCAG 1.3.1), w tym dane aplikacji |
| `modal.test.mjs` | okna: pułapka fokusu, blokada przewijania, powrót fokusu |
| `offline.test.mjs` | start bez sieci, brak duplikowania kopii w pamięci podręcznej |

---

## 11. Wdrożenie automatyczne

Workflow `.github/workflows/pages.yml` publikuje całą zawartość repozytorium na **GitHub Pages** po każdym wypchnięciu na gałąź `main` (oraz ręcznie przez `workflow_dispatch`). Nie ma kroku budowania ani uruchamiania testów — testy trzeba uruchomić lokalnie przed wypchnięciem.

**Lista kontrolna wydania:**

1. Uruchom `npm test`.
2. Podnieś `APP_VERSION` w `js/version.js` oraz datę wersji w `README.md`.
3. Jeśli dodano plik JS/CSS używany przez `index.html`, dopisz go do `ASSETS_TO_CACHE` w `service-worker.js`.
4. Zaktualizuj wersję w `PRZEKAZANIE.md` i `KOMPONENTY_OSS.md` (przy przekazaniu Zamawiającemu).
