# Instrukcja instalacji rozszerzenia EnduX

## Wymagania

- Przeglądarka Chrome, Edge, Brave lub inna oparta na Chromium
- Plik ZIP z rozszerzeniem (`EnduX-extension.zip`)

## Instalacja krok po kroku

### Krok 1: Rozpakuj plik ZIP

1. Znajdź plik `EnduX-extension.zip` na swoim komputerze
2. Kliknij prawym przyciskiem myszy na plik ZIP
3. Wybierz opcję "Rozpakuj" lub "Extract" (w zależności od systemu operacyjnego)
4. Upewnij się, że folder został rozpakowany (powinien zawierać pliki: `manifest.json`, `background.js`, `content.js`, `popup.html`, `popup.js`, `popup.css` oraz folder `images`)

### Krok 2: Otwórz stronę zarządzania rozszerzeniami

W zależności od przeglądarki, otwórz odpowiedni adres:

- **Google Chrome**: Wpisz w pasku adresu: `chrome://extensions/`
- **Microsoft Edge**: Wpisz w pasku adresu: `edge://extensions/`
- **Brave**: Wpisz w pasku adresu: `brave://extensions/`

Lub przejdź do menu przeglądarki:
- **Chrome**: Menu (⋮) → **Narzędzia** → **Rozszerzenia**
- **Edge**: Menu (⋯) → **Rozszerzenia**

### Krok 3: Włącz tryb deweloperski

1. W prawym górnym rogu strony z rozszerzeniami znajdź przełącznik **"Tryb deweloperski"** (Developer mode)
2. Przełącz go na **WŁĄCZONE** (powinien być niebieski/podświetlony)

### Krok 4: Załaduj rozszerzenie

1. Po włączeniu trybu deweloperskiego pojawią się nowe przyciski u góry strony
2. Kliknij przycisk **"Załaduj rozpakowane"** (Load unpacked)
3. W oknie wyboru folderu przejdź do miejsca, gdzie rozpakowałeś plik ZIP
4. Wybierz folder zawierający pliki rozszerzenia (folder z plikiem `manifest.json`)
5. Kliknij **"Wybierz folder"** (Select Folder) lub **"Otwórz"** (Open)

### Krok 5: Sprawdź instalację

1. Rozszerzenie powinno pojawić się na liście zainstalowanych rozszerzeń
2. Upewnij się, że przełącznik obok nazwy rozszerzenia jest **włączony** (niebieski)
3. Ikona rozszerzenia powinna pojawić się na pasku narzędzi przeglądarki (obok paska adresu)

## Rozwiązywanie problemów

### Rozszerzenie nie pojawia się na liście

- Sprawdź, czy wszystkie pliki zostały poprawnie rozpakowane
- Upewnij się, że wybrałeś folder zawierający plik `manifest.json`
- Sprawdź konsolę błędów: kliknij "Szczegóły" pod rozszerzeniem i sprawdź sekcję "Błędy"

### Błędy w konsoli

- Jeśli widzisz błędy, sprawdź czy wszystkie pliki są obecne:
  - `manifest.json`
  - `background.js`
  - `content.js`
  - `popup.html`
  - `popup.js`
  - `popup.css`
  - folder `images/` z plikami ikon

### Rozszerzenie nie działa

- Odśwież stronę, na której chcesz użyć rozszerzenia (F5 lub Ctrl+R)
- Sprawdź, czy rozszerzenie jest włączone (przełącznik obok nazwy)
- Sprawdź uprawnienia rozszerzenia w sekcji "Szczegóły"

## Aktualizacja rozszerzenia

Aby zaktualizować rozszerzenie do nowszej wersji:

1. Rozpakuj nowy plik ZIP (nadpisz poprzednie pliki lub usuń stary folder)
2. Przejdź do `chrome://extensions/`
3. Znajdź rozszerzenie EnduX na liście
4. Kliknij przycisk **"Odśwież"** (🔄) pod rozszerzeniem

## Odinstalowanie

Aby odinstalować rozszerzenie:

1. Przejdź do `chrome://extensions/`
2. Znajdź rozszerzenie EnduX
3. Kliknij przycisk **"Usuń"** (Remove)
4. Potwierdź usunięcie

## Wsparcie

W przypadku problemów z instalacją lub działaniem rozszerzenia, skontaktuj się z twórcą rozszerzenia.

---

**Wersja rozszerzenia:** 1.0

