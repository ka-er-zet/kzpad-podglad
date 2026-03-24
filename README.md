# OZ-PAD — Konfigurator Arkusza Oceny

<div align="center">
  <img src="img/EU1.svg" alt="EU1" height="50">
  <img src="img/EU2.svg" alt="EU2" height="50">
  <img src="img/EU3.svg" alt="EU3" height="50">
  <br>
  <img src="img/pfron.svg" alt="PFRON" height="50">
  <img src="img/uke.svg" alt="UKE" height="50">
</div>

**Wersja:** 1.2.0 (Luty 2026)  
**Status:** Stabilna / Rozszerzona o Moduł Edycji Danych

Aplikacja **OZ-PAD (Ocena zgodności z Polskim Aktem o Dostępności)** służy do przygotowywania arkuszy oceny dostępności produktów i usług zgodnie z Ustawą z dnia 26 kwietnia 2024 r. (PAD), normą EN 301 549 i powiązanymi przepisami prawnymi.

System składa się z dwóch powiązanych modułów:
1.  **Przeprowadzania oceny (index.html)**: Interfejs operacyjny do przeprowadzania oceny i generowania raportów.
2.  **Edycji danych (editor.html)**: Interfejs administracyjny do zarządzania bazą klauzul, mapowaniami produktów oraz słownikiem.

---

## 🚀 Uruchamianie (Lokalne i Online)

Aplikacja ma charakter statyczny (Single Page Application) i nie wymaga serwera bazodanowego. Jednak do poprawnego działania wymaga uruchomienie prostego serwera HTTP/HTTPS.

### Wymagania lokalne
Uruchomienie pliku `index.html` bezpośrednio przez protokół `file://` nie pozwoli na pobranie konfiguracji. Zalecane metody:
1. **Python**: `python -m http.server 8000`
2. **VS Code**: Rozszerzenie "Live Server".
3. **Node.js**: `npx http-server`.

---

## 📱 Moduł oceny (index.html)

Interfejs przeznaczony dla osób przeprowadzających weryfikację dostępności.

### Proces operacyjny:

#### 1. Inicjalizacja (Kreator)
Wybór kategorii produktu powoduje wygenerowanie spersonalizowanego arkusza wymagań, ograniczając treść oceny do punktów mających zastosowanie prawne dla danego urządzenia lub usługi.

#### 2. Rejestracja wyników (Formularz)
System prezentuje wymagania prawne oraz powiązane z nimi szczegółowe instrukcje techniczne i testy jednostkowe służące ocenie zgodności produktu/usługi z PAD. Każdy test jednostkowy można ocenić w skali spełnione/nie spełnione/nie dotyczy oraz uzupełnić o komentarz osoby dokonującej oceny. Oceny z testó jednostkowych są też wykorzystywane do przeddstawienia rekomendacji co do oceny całościowej zgodności lub niezgodności produktu/usługi z danym przepisem.  Użytkownik może wybrać jedną z trzech ocen owej zgodności: `Spełnione`, `Niespełnione` lub `Nie dotyczy`.

#### 3. Zapisywanie pracy
W każdej chwili osoba oceniająca może zapisać swoją pracę poprzez użycie ikony w górnym menu (po prawej stronie) albo użycie skrótu klawiszowego ctrl+s (na urządzeniach Apple cmd+s). Zostanie zapisany plik JSON, który można następnie wczytać używając odpowiedniej opcji z menu głównego aplikacji. 

#### 4. Eksport danych
Narzędzie pozwala na eksport dokumentacji:

##### Po utworzeniu arkusza oceny
Czysty arkusz można wyeksportować w formacie XLSX za pomocą ikony w menu górnym

##### Po wygenerowaniu wyniku audytu

*   **Plik Excel (.xlsx)** (również poprzez ikonę w menu górnym)
*   **Plik tekstowy (.odt)**: Podsumowanie opisowe generowane na podstawie oceny zgodności
*   **Plik techniczny (.json)**: pozwalający na późniejsze wczytanie audytu w narzędziu i edytowanie odpowiedzi i komentarzy.

---

### Słownik

Wykorzystując ikonę pomocy z menu górnego, użytkownik może w każdej chwili zapoznać się ze słownikiem pojęć zastosowanych w narzędziu i opisach wymagań. 

---

## 🛠 Moduł Edytora (editor.html)

Moduł przeznaczony do utrzymania spójności merytorycznej bazy danych bez konieczności bezpośredniej edycji plików źródłowych JSON.

### Funkcjonalności administracyjne:

**Dobra praktyka** - najpierw twórz/edytuj plik klauzul, a później edytuj/dodawaj mapowanie na przepisy prawne.

#### 1. Zakładka Klauzule (Baza Wiedzy)
Pozwala tworzyć i edytować wpisy dotyczące wymagań technicznych (**Klauzule C.**) i ustawowych (**Klauzule U.**).

Moduł umożliwia wczytanie pliku z domeny, w której został uruchomiony (czyli pliku, na którym aktualnie pracuje moduł oceny) lub innego pliku z lokalnego dysku. 

Użytkownik ma możliwość filtrowania listy klauzul poprzez ich typ (techniczne/ustawowe) oraz poprzez wyszukiwarkę tekstową. 

Klauzule mogą być przesuwane na liście przy pomocy strzałek lub poprzez ich "złapanie" karty i przeciągnięcie (drag and drop). Kolejność klauzul nie wpływa na ich kolejność w module oceny. Po prostu pomaga w ich przeglądaniu. 

Do dodawania nowych klauzul służą przyciski:
- Dodaj klauzulę C (dodawania klauzuli technicznej)
- Dodaj klauzulę U (dodawanie klauzuli prawnej)

**Formatowanie**: Aplikacja obsługuje podstawowe znaczniki składni Markdown w polach procedur i checklist. [Więcej o Markdown](https://mmcschool.pl/frontend/markdown-kompletny-poradnik-dla-poczatkujacych/9348/)

**Zapisywanie wyników pracy**

Edycja/utworzenie każdej klauzuli, wpisu mapowania, wpisu podsumowania i wpisu słownika musi być zatwierdzona przyciskiem zapisywania zmian. 

Aby używać nowych zapisów w module oceny, należy pobrać nowe pliki JSON (ikona w prawej części górnego menu). Pobrane pliki będą miały nazwy: clauses-modified, mapping-modified, glossary-modified i summaries-modified. Przed ich użyciem w aplikacji należy usunąć suffix "-modified" a następnie podmienić nimi pliki w folderze clauses_json. 

**Dobra praktyka**: przed podmianą plików dobrze jest zarchiwizować ich poprzednią wersję. 

Po ponownym załadowaniu modułu oceny, będzie on korzystał z nowych plików. 

##### Wpis klauzuli technicznej

Wpis zawiera następujące informacje:

**Identyfikator wpisu** - powinien zostać stworzony w oparciu o miejsce klauzuli w zapisach normy, np. C.9.1.1.1 - Norma EN (Rozdział 9.1.1.1)

**Tytuł klauzuli** - krótki tytuł pozwalający zrozumieć czego dotyczy klauzula. 

###### Informacje będące dosłownym cytowaniem zapisów normy

**Metoda oceny (Evaluation)**
Krótka informacja o tym, jak ocenia się spełnianie warunków klauzuli. Np. *Inspekcja i testy technologii asystujących*

**Wymagania wstępne (Preconditions)**
Miejsce do opisania wymagań, które muszą być spełnione, by ocena zgodności z zapisami klauzuli miała sens.

**Procedura badania (Procedure)**
Kroki procedury badania

**Kryteria sukcesu (Logic)**
Składające się z dwóch powiązanych pól:
- Wynik (Wartość) (np. Zaliczone)
- Warunek / Kryterium wyboru (na jakiej zasadzie powinien zostać wybrany ten wynik. Np. Kryterium 5: prawda)

###### Informacje dodatkowe
**Jak sprawdzić?**
Opis pomagający dokonać oceny zgodności z klauzulą

**Dodatkowe uwagi / Wyjątki (Notes)**
Miejsce na dopisanie dodatkowych uwag, wyjątków itp. 

##### Wpis klauzuli prawnej

**Identyfikator wpisu** - powinien zostać stworzony w oparciu o miejsce klauzuli w przepisach prawnych, np. U.7.1.1.a (czyli Art. 7 ust. 1 pkt 1 lit. a)

**Tytuł klauzuli** - krótki tytuł pozwalający zrozumieć czego dotyczy klauzula. (np. U.7.1.1.a Więcej niż jeden zmysł (kanał sensoryczny))

**Metoda oceny (Evaluation)**
Krótka informacja o tym, jak ocenia się spełnianie warunków klauzuli. Np. *Inspekcja i testy technologii asystujących*

**Wymagania wstępne (Preconditions)**
Miejsce do opisania wymagań, które muszą być spełnione, by ocena zgodności z zapisami klauzuli miała sens.

**Jak to rozumieć**
Interpretacja przepisów prawa wyjaśniająca jakie mają one przeniesienie na rzeczywistość produktów i usług.

**Jak sprawdzić?**
Opis pomagający dokonać oceny zgodności z klauzulą

**Dodatkowe uwagi / Wyjątki (Notes)**
Miejsce na dopisanie dodatkowych uwag, wyjątków itp. 

#### 2. Zakładka Mapowanie (Konfiguracja relacji pomiędzy przepisami prawa, produktami/usługami i klauzulami technicznymi)

W tej zakładce można zdefiniować relacje pomiędzy elemantami systemu oraz zarządzać profilami produktów/usług.

Po wczytaniu domyślnego pliku z mapowaniem, lub pliku z dysku można dodać nowy wpis lub edytować istniejące. 

Podobnie, jak w sekcji Klauzul, można zmieniać kolejność wpisów. Tutaj jednak będzie ona miała wpływ na kolejność ich pojawiania się na arkuszu oceny. 

Przycisk zarządzania produktami pozwala na edycję listy zdefiniowanych profilów produktów/usług. A przycisk **Dodaj nowe mapowanie** pozwala na utworzenie nowego wpisu z mapowaniem przepisu prawnego

##### Wpis produktu/usługi

Każdy wpis składa się z kolejnego id (nadawanego automatycznie) - np. p13, oraz wpisywanej ręcznie nazwy, np. Terminale płatnicze w fizycznych punktach sprzedaży.

##### Wpis mapowania przepisu ustawy

Każdy wpis mapowania zawiera następujące informacje:
**Identyfikator** - powinien on odzwierciedlać położenie przepisu w ustawie, np. A07-04-01-a-01 - Format: Art-Ust-Pkt-Lit-Tiret

**Dobra praktyka** - jest to ten sam format, co w wypadku klauzul prawnych (U.). Jedyna różnica to litera A zamiast U na początku identyfikatora. Dlatego warto zadbać o odpowiednie nadawanie id, by łatwiej wiązać ze sobą klauzule i zapisy prawne.

**Identyfikator Klauzuli Ustawowej (U.*)** - pole pozwalające na wpisanie powiazanej z przepisem ustawy klauzuli prawnej. MOżna też wybrać ją z listy. Z danym przepisem ustawy może być powiązana jedna klauzula prawna.

**Artykuł** - Opis położenia przepisu w akcie prawnym, np. Art. 7 ust. 1 pkt 1 lit. a.

**Kategoria** - krótki opis kategorii (zazwyczaj artykułu) w której znajduje się ten przepis. Kategoria jest też elementem grupującym wpisy w przeglądarce wymagań. Np. Informacje o produkcie (Art. 7)

**Wymaganie (treść)** - dosłowna treść przepisu z aktu prawnego. Np. Instrukcje, etykiety i ostrzeżenia dotyczące użytkowania produktu, które zostały zamieszczone w lub na produkcie są udostępniane za pomocą więcej niż jednego kanału sensorycznego

**Powiązane produkty i klauzule techniczne** - lista zdefiniowanych produktów/usług. Aby powiązać je z danym przepisem wystarczy zaznaczyć pole wyboru **Dotyczy**. Dzięki temu dany przepis i jego klauzula prawna będą pojawiała się jako wymaganie na arkuszy oceny tego przepisu. 

Pole **Kody techniczne C** pozwala na powiązanie z konkretnym pruktem/usługą klauzul technicznych z aneksu C normy EN 301 549. Można je dodawać ręcznie, albo poprzez listę wywoływaną przyciskiem **Wybierz kody**.

#### 3. Zakładka Podsumowania

Służy do definiowania opisów wykorzystywanych w generowaniu raportu z oceny. 

##### Szablony

Szablony podsumowań to predefiniowane struktury tekstowe, które automatycznie dopasowują się do wyników audytu. Są wybierane na podstawie analizy ocenionych kryteriów (spełnione/nie spełnione/nie dotyczy). Każdy szablon odpowiada innemu scenariuszowi wyników oceny.

- **ZGODNY (Pełny zakres - wszystkie klauzule OK)**: Produkt/usługa spełnia wszystkie wymagania ustawowe w pełnym zakresie i wszystkie wymagania zostały sprawdzone.
**NIEZGODNY (Pełny zakres - błędy w klauzulach)**: Produkt/usługa nie spełnia wymagań ustawowych, zidentyfikowano błędy wymagające naprawy. Wszystkie wymagania zostały sprawdzone.
**ZGODNY W ZAKRESIE (Częściowy zakres - sprawdzone OK)**: W sprawdzonym zakresie nie ma uchybień, ale ocena nie była pełna.
**NIEZGODNY (Częściowy zakres - błędy w sprawdzonych)**: Podczas częściowej oceny wykryto niezgodności.
**BŁĄD: BRAK OCEN (Nie wypełniono arkusza)**: Brak jakichkolwiek ocen kryteriów - błąd generowania podsumowania.
**BRAK WYMAGAŃ (Wszystkie klauzule: Nie dotyczy)**: Wszystkie wymagania zostały ocenione jako "Nie dotyczy"
**BRAK WYMAGAŃ (Częściowy zakres: Wszystkie "Nie dotyczy")**: W sprawdzonym zakresie brak zastosowania wymagań. Nie wszystkie wymagania zostały sprawdzone.

##### Możliwe do edycji pola w szablonach
Część pól jest właściwa dla danego typu szablonu.

- **Tytuł dokumentu**: Tytuł podsumowania (np. "Podsumowanie oceny dostępności"). Pojawia się na początku i w nazwie generowanego dokumentu.
- **Opis / Treść główna**: Główny opis podsumowania. Zawiera tekst wyjaśniający wyniki audytu, z placeholderem {productName} (zastępowanym nazwą audytowanego produktu/usługi). To kluczowa część dokumentu, opisująca wnioski z oceny.
- **Etykiety sekcji (Teksty nagłówków list w raporcie)**: Etykiety sekcji w raporcie. Sekcje te opisują kategorie wyników w raporcie (np. lista niezgodności, spełnionych kryteriów itp.).
- **Metadane (Etykiety danych dodatkowych)** (opcjonalne): Słownik z etykietami i wartościami domyślnymi (np. "Data zakończenia oceny", "Zakres oceny"). Używane do dodania informacji kontekstowych, takich jak data czy zakres oceny.

#### 4. Zakładka Słownik

Pozwala na edycję/dodawanie definicji terminów technicznych i prawnych dostępnych w module oceny pod ikoną pomocy.

---

## 🔐 Ochrona danych i stabilność pracy

*   **Powiadomienia o zmianach**: System blokuje nawigację w przypadku wykrycia niezapisanych modyfikacji w formularzu.
*   **Przetwarzanie lokalne**: Dane nie są przesyłane do systemów zewnętrznych; cała logika i zapisywanie stanu odbywa się w pamięci lokalnej przeglądarki użytkownika.
*   **Tryb offline**: Dzięki Service Workers aplikacja pozostaje w pełni funkcjonalna bez połączenia sieciowego.

---

## 📂 Struktura Danych (JSON)

Pliki w katalogu `clauses_json/` definiują logikę systemu:
*   `clauses.json`: Definicje klauzul i procedur testowych.
*   `mapping.json`: Macierz powiązań Artykuł <-> Produkt <-> Wytyczne techniczne.
*   `glossary.json`: Definicje słownikowe.
*   `summaries.json`: Szablony podsumowań dla raportów.

---

## 📚 Biblioteki Zewnętrzne i Licencje

| Biblioteka | Plik | Licencja | Zastosowanie |
|------------|------|----------|--------------|
| **Pico.css** | `css/pico.min.css` | MIT | Struktura wizualna i system styli (RWD). |
| **ExcelJS** | `js/exceljs.min.js` | MIT | Generowanie arkuszy kalkulacyjnych .xlsx. |
| **JSZip** | `js/jszip.min.js` | MIT/GPLv3 | Obsługa kompresji dla formatu .odt. |
| **Lucide** | `js/lucide.min.js` | ISC | System ikon wektorowych. |

---

© 2026 OZ-PAD Project. Rozwiązanie oparte na otwartoźródłowych technologiach webowych.
