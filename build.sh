#!/bin/bash

# Skrypt do generowania pliku ZIP z rozszerzeniem EnduX

# Odczytaj wersję z manifest.json
VERSION=$(grep -o '"version": "[^"]*"' manifest.json | cut -d'"' -f4)

if [ -z "$VERSION" ]; then
    echo -e "${RED}✗ Nie można odczytać wersji z manifest.json!${NC}"
    exit 1
fi

# Nazwa pliku wyjściowego z wersją
OUTPUT_FILE="EnduX-extension-${VERSION}.zip"
TEMP_DIR="EnduX-extension-temp"

# Kolorowe komunikaty
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Tworzenie pakietu rozszerzenia EnduX v${VERSION}...${NC}"

# Usuń poprzedni plik ZIP jeśli istnieje
if [ -f "$OUTPUT_FILE" ]; then
    echo -e "${YELLOW}Usuwanie poprzedniego pliku ZIP...${NC}"
    rm "$OUTPUT_FILE"
fi

# Usuń poprzedni folder tymczasowy jeśli istnieje
if [ -d "$TEMP_DIR" ]; then
    echo -e "${YELLOW}Usuwanie poprzedniego folderu tymczasowego...${NC}"
    rm -rf "$TEMP_DIR"
fi

# Utwórz folder tymczasowy
mkdir "$TEMP_DIR"

# Skopiuj potrzebne pliki
echo -e "${GREEN}Kopiowanie plików...${NC}"
cp manifest.json "$TEMP_DIR/"
cp background.js "$TEMP_DIR/"
cp content.js "$TEMP_DIR/"
cp popup.html "$TEMP_DIR/"
cp popup.js "$TEMP_DIR/"
cp popup.css "$TEMP_DIR/"
cp clipboard-viewer.html "$TEMP_DIR/"
cp clipboard-viewer.js "$TEMP_DIR/"

# Skopiuj folder images
cp -r images "$TEMP_DIR/"

# Utwórz plik ZIP
echo -e "${GREEN}Tworzenie pliku ZIP...${NC}"
cd "$TEMP_DIR"
zip -r "../$OUTPUT_FILE" . -x "*.DS_Store" > /dev/null
cd ..

# Usuń folder tymczasowy
rm -rf "$TEMP_DIR"

# Sprawdź czy plik został utworzony
if [ -f "$OUTPUT_FILE" ]; then
    FILE_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
    echo -e "${GREEN}✓ Plik $OUTPUT_FILE został utworzony pomyślnie!${NC}"
    echo -e "${GREEN}  Rozmiar: $FILE_SIZE${NC}"
    echo -e "${GREEN}  Lokalizacja: $(pwd)/$OUTPUT_FILE${NC}"
else
    echo -e "${RED}✗ Błąd podczas tworzenia pliku ZIP!${NC}"
    exit 1
fi

