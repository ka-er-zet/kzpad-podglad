# Dokumentacja techniczna — OZ-PAD (Konfigurator Arkusza Oceny)

**Wersja:** 1.4.2  
**Data:** wrzesień 2026

---

## 1. Architektura systemu

OZ-PAD to aplikacja webowa typu **Single Page Application (SPA)**, w całości oparta na technologiach front-end. Nie posiada back-endu ani bazy danych po stronie serwera. Całość logiki działa w przeglądarce użytkownika.

### Moduły

| Plik | Rola |
|---|---|
| `index.html` + `js/wizard.js` | Moduł oceny — główna ścieżka pracy użytkownika |
| `editor.html` + `js/editor.js` | Moduł edycji danych (administracyjny) |
| `js/exporter.js` | Współdzielona logika eksportu (ODT) |
| `js/utils.js` | Funkcje pomocnicze współdzielone między modułami |
| `js/version.js` | Jedyne źródło prawdy o wersji aplikacji (`APP_VERSION`); używany przez stronę i Service Worker |
| `service-worker.js` | Obsługa PWA i trybu offline |
| `clauses_json/` | Baza danych aplikacji (pliki JSON) |

### Przepływ danych

```
clauses_json/*.json
       │
       ▼
   wizard.js          ← stan audytu przechowywany w pamięci przeglądarki
       │
       ├──► exporter.js  → eksport XLSX (przez ExcelJS)
       │                 → eksport ODT (przez JSZip)
       │                 → eksport JSON (stan audytu)
       │
       └──► index.html  → prezentacja wyników użytkownikowi
```

Moduł edytora (`editor.js`) pracuje niezależnie od modułu oceny. Wczytuje pliki JSON bezpośrednio z dysku lub z serwera, umożliwia ich edycję i pobieranie zmodyfikowanych wersji.

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

- Nazwa cache: `OZ-PAD-v<wersja>` (np. `OZ-PAD-v1.4.2`) — wersja pochodzi z `js/version.js`
- Przy instalacji SW pre-cachowane są wszystkie zasoby statyczne: HTML, CSS, JS, obrazy oraz pliki JSON bazy danych.
- Przy aktualizacji SW stary cache jest automatycznie usuwany i zastępowany nowym.

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

Obsługuje generowanie dokumentu ODT (OpenDocument Text). Wywoływany przez `wizard.js`.

### Formaty eksportu

| Format | Biblioteka | Plik wyjściowy | Zawartość |
|---|---|---|---|
| `.xlsx` | ExcelJS | `arkusz-oceny-[produkt].xlsx` | Arkusz kalkulacyjny z wszystkimi wymaganiami, ocenami i komentarzami |
| `.odt` | JSZip | `raport-[produkt].odt` | Dokument tekstowy z podsumowaniem i listami wyników |
| `.json` | natywny JS | `audyt-[produkt].json` | Pełny stan audytu do późniejszego wczytania |

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
