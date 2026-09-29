# Protokół przekazania Utworu — OZ-PAD (Konfigurator Arkusza Oceny)

**Wersja:** 1.4.2

---

## 1. Przekazany kod źródłowy i artefakty

Niniejszym Wykonawca przekazuje Zamawiającemu kompletny i aktualny kod źródłowy Utworu **OZ-PAD**, stanowiącego program komputerowy (aplikację webową typu Single Page Application), obejmujący:

1) **kod wynikowy (obiektowy)** — pliki gotowe do wdrożenia:
   - `index.html` — moduł oceny zgodności,
   - `editor.html` — moduł edycji danych,
   - `service-worker.js` — obsługa trybu offline (PWA),
   - `manifest.json` — konfiguracja Progressive Web App,
   - katalog `js/` — skrypty aplikacji (`wizard.js`, `editor.js`, `exporter.js`, `utils.js`) oraz dołączone biblioteki zewnętrzne,
   - katalog `css/` — arkusze stylów,
   - katalog `img/` — zasoby graficzne,
   - katalog `clauses_json/` — baza danych aplikacji w formacie JSON (`clauses.json`, `mapping.json`, `glossary.json`, `summaries.json`);

2) **wersja wdrożeniowa** — aplikacja nie wymaga procesu kompilacji; kod źródłowy jest jednocześnie kodem wdrożeniowym, gotowym do hostowania na serwerze HTTP/HTTPS lub CDN poprzez skopiowanie zawartości repozytorium;

3) **dokumentacja techniczna** umożliwiająca samodzielne utrzymanie, rozwój i modyfikację Utworu — plik `DOKUMENTACJA_TECHNICZNA.md` — obejmująca opis architektury, instrukcje uruchomienia i wdrożenia, schematy plików JSON bazy danych, opis działania Service Workera i strategii cachowania, opis modułu eksportu oraz opis skryptu pomocniczego `generate_clauses_export.py`. Opis funkcjonalny aplikacji zawarty jest w pliku `README.md`.

---

## 2. Oświadczenie dotyczące komponentów open source (OSS)

W Utworze **OZ-PAD** zostały wykorzystane komponenty oprogramowania open source wymienione w załączonym pliku `KOMPONENTY_OSS.md`. Zastosowane licencje:

1) nie ograniczają praw Zamawiającego nabytych na podstawie Umowy,

2) nie nakładają na Zamawiającego obowiązku ujawnienia kodu źródłowego Utworu ani jego części,

3) umożliwiają korzystanie, modyfikowanie, rozwijanie oraz rozpowszechnianie Utworu zgodnie z Umową.
