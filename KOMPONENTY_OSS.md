# Zestawienie komponentów open source — OZ-PAD

Poniższe zestawienie obejmuje wszystkie komponenty oprogramowania open source (OSS) wykorzystane w aplikacji **OZ-PAD** (Konfigurator Arkusza Oceny, wersja 1.4.2, wrzesień 2026).

Wykonawca oświadcza, że żadna z poniższych licencji nie nakłada na Zamawiającego obowiązku ujawnienia kodu źródłowego Utworu, nie ogranicza praw Zamawiającego wynikających z Umowy ani nie stoi w sprzeczności z warunkami korzystania, modyfikowania i rozpowszechniania Utworu.

---

## Komponenty front-end (dołączone jako pliki lokalne)

| Nazwa | Wersja | Licencja | URL źródła | Lokalizacja w projekcie | Uwagi |
|---|---|---|---|---|---|
| **Pico CSS** | 1.5.13 | MIT | https://github.com/picocss/pico | `css/pico.min.css` | Struktura wizualna, system styli, RWD |
| **ExcelJS** | build 19-10-2023 | MIT | https://github.com/exceljs/exceljs | `js/exceljs.min.js` | Generowanie arkuszy .xlsx |
| **JSZip** | 3.10.1 | MIT lub GPLv3 | https://github.com/Stuk/jszip | `js/jszip.min.js` | Kompresja ZIP dla formatu .odt; stosowana licencja MIT |
| **Lucide** | 0.554.0 | ISC | https://github.com/lucide-icons/lucide | `js/lucide.min.js` | System ikon SVG |

---

## Teksty licencji

Teksty pełnych licencji dla powyższych komponentów dostępne są pod adresami:

- **MIT** (Pico CSS, ExcelJS, JSZip): https://opensource.org/licenses/MIT
- **ISC** (Lucide): https://opensource.org/licenses/ISC
- **GPLv3** (JSZip — wariant alternatywny, nieużywany): https://www.gnu.org/licenses/gpl-3.0.html

Wykonawca stosuje licencję **MIT** dla JSZip (nie GPLv3), co nie nakłada na Zamawiającego żadnych obowiązków dotyczących publikacji kodu źródłowego Utworu.

---

## Środowisko pomocnicze (skrypty Python)

Skrypty pomocnicze (`add_categories.py`, `fix_encoding.py`, `generate_clauses_export.py` itp.) wymagają interpretera **Python 3** (standardowa biblioteka, brak zewnętrznych zależności OSS ponad interpreter). Licencja Pythona: [PSF License](https://docs.python.org/3/license.html) — zgodna z warunkami Umowy.
