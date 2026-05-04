// content.js

// Return all tables in the current document only.
// With all_frames: true, the script runs in each frame separately, so each frame
// handles its own tables - avoids duplicate buttons when tables are in iframes.
function getAllTables() {
    return Array.from(document.querySelectorAll('table'));
}

// Function to create a simple hash from text (using djb2 algorithm)
function createHash(text) {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
	hash = ((hash << 5) + hash) + text.charCodeAt(i);
	hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
}

// Separator between segments in a table cell (block/<br> boundaries, or adjacent elements
// that both yield text, e.g. chip spans). Must stay on one line so clipboard-viewer row
// splitting on \n stays valid.
const CELL_INLINE_BLOCK_SEP = ' | ';

const BLOCK_HTML_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BODY', 'CANVAS', 'CENTER',
    'DD', 'DIR', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE',
    'FOOTER', 'FORM', 'FRAME', 'FRAMESET', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'HEADER', 'HGROUP', 'HR', 'HTML', 'ISINDEX', 'LI', 'MAIN', 'MENU',
    'NAV', 'NOFRAMES', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD',
    'TFOOT', 'TH', 'THEAD', 'TR', 'UL', 'VIDEO'
]);

const SKIP_CELL_TEXT_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);

function isBlockBoundaryNode(node) {
    if (!node) return false;
    if (node.nodeType === Node.ELEMENT_NODE) {
	if (node.tagName === 'BR') return true;
	return BLOCK_HTML_TAGS.has(node.tagName);
    }
    return false;
}

function isBlockBoundaryBetween(prevSibling, nextSibling) {
    return isBlockBoundaryNode(prevSibling) || isBlockBoundaryNode(nextSibling);
}

function shouldInsertCellSepBetweenSiblings(prevSibling, nextSibling) {
    if (isBlockBoundaryBetween(prevSibling, nextSibling)) return true;
    if (prevSibling.nodeType !== Node.ELEMENT_NODE || nextSibling.nodeType !== Node.ELEMENT_NODE) {
	return false;
    }
    const p = prevSibling.tagName;
    const n = nextSibling.tagName;
    if (SKIP_CELL_TEXT_TAGS.has(p) || SKIP_CELL_TEXT_TAGS.has(n)) return false;
    return true;
}

function normalizeCellTextChunk(s) {
    return s.replace(/\s+/g, ' ');
}

function collapseCellSeparators(s) {
    const esc = CELL_INLINE_BLOCK_SEP.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const multi = new RegExp('(?:' + esc + ')+', 'g');
    return s.replace(multi, CELL_INLINE_BLOCK_SEP).trim();
}

/**
 * Usuwa puste segmenty między separatorami komórki (` | `) oraz osierocone `|` na brzegach
 * (np. ikona bez tekstu zostawiała „ | ” albo samo „|” na początku/końcu).
 */
function stripEmptyCellPipeSegments(s) {
    if (s == null) return '';
    var t = String(s);
    if (!t) return '';
    var sep = CELL_INLINE_BLOCK_SEP;
    var parts = t.split(sep);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
	var p = parts[i] == null ? '' : String(parts[i]).trim();
	if (p.length) out.push(p);
    }
    t = out.join(sep);
    /* Pojedyncze | (bez spacji jak w CELL_INLINE_BLOCK_SEP) na brzegach po scaleniu */
    t = t.replace(/^(?:\s*\|\s*)+/, '').replace(/(?:\s*\|\s*)+$/, '');
    return t.trim();
}

function fragmentTextFromNode(node) {
    if (!node) return '';

    if (node.nodeType === Node.TEXT_NODE) {
	return normalizeCellTextChunk(node.textContent);
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName;
    if (SKIP_CELL_TEXT_TAGS.has(tag)) return '';
    if (tag === 'BR') return '';

    return joinCellChildFragments(node);
}

function joinCellChildFragments(parent) {
    const children = parent.childNodes;
    let out = '';
    for (let i = 0; i < children.length; i++) {
	const child = children[i];
	const frag = fragmentTextFromNode(child);
	if (i > 0 && shouldInsertCellSepBetweenSiblings(children[i - 1], child)) {
	    if (out.length > 0 && frag.length > 0) {
		out += CELL_INLINE_BLOCK_SEP;
	    }
	}
	out += frag;
    }
    return out;
}

// Plain text from a table cell (or any element): block / <br> / adjacent elements with text
// get " | " between segments.
function getPlainText(element) {
    if (!element) return '';

    const temp = document.createElement('div');
    temp.innerHTML = element.innerHTML;

    return stripEmptyCellPipeSegments(collapseCellSeparators(joinCellChildFragments(temp)));
}

// Global function to update all clipboard info elements on the page
function updateAllClipboardInfo() {
    try { if (!chrome.runtime?.id) return; } catch (e) { return; }
    chrome.storage.local.get(['accumulatedClipboard'], function(result) {
	if (chrome.runtime.lastError) return;
	const content = result.accumulatedClipboard || '';
	const rowCount = content ? content.split('\n').filter(line => line.trim().length > 0).length : 0;
	const infoText = `📊 W schowku: ${rowCount} wierszy`;
	const infoTextGrid = `W schowku: ${rowCount} wierszy`;
	
	// Find all clipboard info elements
	const allClipboardInfos = document.querySelectorAll('[id^="clipboard-info-"]');
	allClipboardInfos.forEach(function(element) {
	    element.textContent = element.hasAttribute('data-endux-grid-clipboard') ? infoTextGrid : infoText;
	    element.style.color = ENDUX_CLIPBOARD_ROW_COUNT_COLOR;
	});
    });
}

// Function to handle Crawler Step
async function handleCrawlerStep() {
    try {
	if (!chrome.runtime?.id) return;
    } catch (e) { return; }
    try {
	if (window !== window.top) return;
    } catch (e) {
	return;
    }
    if (_crawlerStepRunning) {
        console.log('EnduX Crawler: Poprzedni krok jeszcze trwa, pomijanie.');
        return;
    }
    _crawlerStepRunning = true;
    console.log('EnduX Crawler: Sprawdzanie stanu...');
    // Check if crawler is active and has configuration defined
    const result = await new Promise(resolve => {
        chrome.storage.local.get([
	    'crawlerActive',
	    'crawlerClass',
	    'crawlerPaginator',
	    'includeHeaderPreference',
	    'extensionEnabled',
	    'crawlerFirstPageHeader',
	    'crawlerIsFirstPage'
	].concat(ENDUX_SUBTABLE_STORAGE_KEYS), resolve);
    });

    const _cc = String(result.crawlerClass || '').trim();
    const _cp = String(result.crawlerPaginator || '').trim();
    if (!result.extensionEnabled || !result.crawlerActive || (!_cc && !_cp)) {
        console.log('EnduX Crawler: Crawler nie jest aktywny lub brak konfiguracji.');
        _crawlerStepRunning = false;
        return;
    }

    console.log('EnduX Crawler: Próba znalezienia danych...');
    if (_gridPanelRoot && _gridSelectedEl && !_gridSelectedEl.isConnected) {
	tryRebindGridSelectionFromCachedSelectors();
    }
    if (_gridPanelRoot && _gridSelectedEl && _gridSelectedEl.isConnected && !isInsideEnduxGridPanel(_gridSelectedEl)) {
	await enduxMaybeWalkSubtableRows(result);
    }
    enduxSyncSubtableExportCacheFromSlice(result);
    const gridPayload = enduxGetGridPanelAutoAppendPayload();
    const isFirstPage = result.crawlerIsFirstPage !== false; // defaults to true

    let crawlerHtmlTable = null;
    if (!gridPayload) {
	const tables = getAllTables();
	let maxRows = 0;
	tables.forEach(function(t) {
	    if (t.rows.length > maxRows && t.offsetParent !== null) {
		maxRows = t.rows.length;
		crawlerHtmlTable = t;
	    }
	});
	if (!crawlerHtmlTable) {
	    console.log('EnduX Crawler: Nie znaleziono tabeli ani aktywnej siatki w panelu.');
	    _crawlerStepRunning = false;
	    return;
	}
    }

    console.log('EnduX Crawler: Kopiowanie...');
    // Nagłówek tylko na pierwszej stronie (przy dołączaniu); inaczej każda strona powtarza <thead>.
    // - crawlerFirstPageHeader ON: pierwsza strona z nagłówkiem, kolejne bez
    // - OFF: pierwsza strona z nagłówkiem tylko gdy includeHeaderPreference; kolejne bez
    let includeHeader;
    if (result.crawlerFirstPageHeader) {
	includeHeader = isFirstPage;
    } else {
	includeHeader = !!(result.includeHeaderPreference && isFirstPage);
    }

    let copyResult;
    if (gridPayload) {
	var wantGridHeaderLine;
	if (result.crawlerFirstPageHeader) {
	    wantGridHeaderLine = isFirstPage;
	} else {
	    wantGridHeaderLine = !!(result.includeHeaderPreference && isFirstPage);
	}
	copyResult = await new Promise(function(resolve) {
	    chrome.storage.local.get(['accumulatedClipboard'], function(accRes) {
		if (chrome.runtime.lastError) {
		    resolve({ success: false, rowCount: null });
		    return;
		}
		var existing = (accRes.accumulatedClipboard || '').trim();
		var chunk;
		if (wantGridHeaderLine && gridPayload.headerLine) {
		    chunk = existing.length ? gridPayload.bodyText : (gridPayload.headerLine + '\n' + gridPayload.bodyText);
		} else {
		    chunk = gridPayload.bodyText;
		}
		copyTsvTextToClipboard(chunk, gridPayload.bodyText, true, true).then(resolve);
	    });
	});
    } else {
	copyResult = await copyTableToClipboard(crawlerHtmlTable, includeHeader, true, true);
    }

    if (!copyResult.success && !copyResult.isDuplicate) {
        _crawlerStepRunning = false;
        return;
    }

    if (copyResult.isDuplicate) {
	// Pełne przeładowanie często daje ten sam hash (ta sama tabela zanim doczyta page=N); nie gasimy sesji crawla.
	console.log('EnduX Crawler: Duplikat skrótu treści — pomijam dopisanie, przechodzę do następnej strony.');
    } else {
	console.log('EnduX Crawler: Dane zapisane pomyślnie.');
	showToast('🚀 Crawler: Dane zapisane', 'success', copyResult.rowCount);
	updateAllClipboardInfo();
	if (crawlerHtmlTable) {
	    syncGridPanelPreviewFromCrawlerTable(crawlerHtmlTable);
	}
	// Mark that we're no longer on the first page
	if (isFirstPage) chrome.storage.local.set({ crawlerIsFirstPage: false });
    }

    // 1. URL paginator (e.g. &page=1-100)
    if (_cp && _cp.includes('=') && _cp.includes('-')) {
        console.log('EnduX Crawler: Próba użycia Paginatora:', _cp);
        const cleanPaginator = _cp.startsWith('&') ? _cp.substring(1) : _cp;
        const [paramPart, rangePart] = cleanPaginator.split('=');
        const [startPage, endPage] = rangePart.split('-').map(Number);

        if (paramPart && !isNaN(startPage) && !isNaN(endPage)) {
            const currentUrl = new URL(window.location.href);
            const currentPageVal = currentUrl.searchParams.get(paramPart);
            let currentPage = currentPageVal ? parseInt(currentPageVal) : (startPage > 0 ? startPage : 1);

            if (currentPage < endPage) {
                const nextPage = currentPage + 1;
                console.log(`EnduX Crawler: Paginacja do strony ${nextPage}...`);
                currentUrl.searchParams.set(paramPart, nextPage);
                setTimeout(() => {
                    chrome.storage.local.get(['crawlerActive'], function(res) {
                        _crawlerStepRunning = false;
                        if (res.crawlerActive) window.location.href = currentUrl.toString();
                    });
                }, 1500);
                return;
            } else {
                console.log('EnduX Crawler: Osiągnięto koniec zakresu paginatora.');
                chrome.storage.local.set({ crawlerActive: false });
                showToast('🏁 Crawler: Zakres paginacji zakończony', 'success');
                _crawlerStepRunning = false;
                return;
            }
        }
    }

    // 2. "Next" button click
    if (!_cc) {
        const paginatorLooksConfigured = _cp && _cp.includes('=') && _cp.includes('-');
        if (paginatorLooksConfigured) {
            console.log('EnduX Crawler: Tylko paginator — brak obsługi w tym kroku (parametr/URL?). Nie wyłączam crawla; sprawdź zapis np. &page=1-100 i nazwę parametru w adresie.');
            _crawlerStepRunning = false;
            return;
        }
        console.log('EnduX Crawler: Brak klasy przycisku Dalej i paginator nie obsłużył przejścia.');
        chrome.storage.local.set({ crawlerActive: false });
        _crawlerStepRunning = false;
        return;
    }

    const rawSelector = _cc;
    let nextButton = null;

    // Try selector directly (picker-generated: a.next, ul > li > a, #next-btn, .btn.next, etc.)
    try { nextButton = document.querySelector(rawSelector); } catch (e) {}

    // Fallback: plain class name typed manually without dot (e.g. "next-page" → ".next-page")
    if (!nextButton && !rawSelector.startsWith('.') && !rawSelector.startsWith('#') &&
        !rawSelector.includes('>') && !rawSelector.includes('[') && !rawSelector.includes(':')) {
        try { nextButton = document.querySelector('.' + rawSelector.replace(/\s+/g, '.')); } catch (e) {}
    }

    // If selector points to an inner SVG/path/span, walk up to the actual clickable element
    if (nextButton) {
        const CLICKABLE_TAGS = ['A', 'BUTTON', 'INPUT', 'SELECT'];
        const isClickable = CLICKABLE_TAGS.includes(nextButton.tagName) ||
            nextButton.getAttribute('role') === 'button' ||
            nextButton.getAttribute('role') === 'link';
        if (!isClickable) {
            let node = nextButton.parentElement;
            while (node && node !== document.body) {
                if (CLICKABLE_TAGS.includes(node.tagName) ||
                    node.getAttribute('role') === 'button' ||
                    node.getAttribute('role') === 'link') {
                    nextButton = node;
                    break;
                }
                node = node.parentElement;
            }
        }
    }

    console.log('EnduX Crawler: Przycisk Dalej (', rawSelector, '):', nextButton);

    // SVG elements return null for offsetParent — check visibility differently
    function isVisible(el) {
        if (!el) return false;
        if (el.offsetParent !== null) return true;
        // SVG and some fixed/sticky elements have offsetParent === null but are still visible
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    const canGoNext = nextButton &&
        !nextButton.classList.contains('disabled') &&
        !nextButton.hasAttribute('disabled') &&
        isVisible(nextButton);

    if (canGoNext) {
        console.log('EnduX Crawler: Kliknięcie za 1.5s...');
        setTimeout(() => {
            chrome.storage.local.get(['crawlerActive'], function(res) {
                _crawlerStepRunning = false;
                if (!res.crawlerActive) return;
                console.log('EnduX Crawler: Kliknięcie!');
                nextButton.click();
                if (nextButton.tagName === 'A' && nextButton.href && !nextButton.href.startsWith('javascript')) {
                    nextButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                }
            });
        }, 1500);
    } else {
        console.log('EnduX Crawler: Brak aktywnego przycisku Dalej.');
        chrome.storage.local.set({ crawlerActive: false });
        showToast('🏁 Crawler: Koniec danych lub nie znaleziono przycisku', 'success');
        _crawlerStepRunning = false;
    }
}

// Function to open clipboard content in a new tab
function openClipboardInNewTab() {
    try {
	chrome.storage.local.get(['accumulatedClipboard'], function(result) {
	    // Check if extension context is still valid
	    if (chrome.runtime.lastError) {
		console.error('Extension context error:', chrome.runtime.lastError);
		showToast('⚠️ Rozszerzenie zostało przeładowane. Odśwież stronę.', 'warning');
		return;
	    }
	    
	    const content = result.accumulatedClipboard || '';
	    
	    if (!content || content.trim().length === 0) {
		showToast('⚠️ Schowek jest pusty', 'warning');
		return;
	    }
	    
	    // Send message to background script to open new tab
	    chrome.runtime.sendMessage({
		action: 'openClipboardInNewTab',
		content: content
	    }, function(response) {
		// Check if extension context is still valid
		if (chrome.runtime.lastError) {
		    console.error('Extension context error:', chrome.runtime.lastError);
		    showToast('⚠️ Rozszerzenie zostało przeładowane. Odśwież stronę.', 'warning');
		    return;
		}
		
		if (response && response.success) {
		    if (response.reloaded) {
			showToast('✅ Przełączono na zakładkę schowka i przeładowano', 'success');
		    } else {
			showToast('✅ Zawartość schowka otwarta w nowej zakładce', 'success');
		    }
		} else {
		    const errorMsg = response && response.message ? response.message : 'Nie udało się otworzyć zawartości schowka';
		    showToast('❌ ' + errorMsg, 'error');
		}
	    });
	});
    } catch (error) {
	console.error('Error opening clipboard:', error);
	showToast('⚠️ Błąd: Rozszerzenie zostało przeładowane. Odśwież stronę.', 'error');
    }
}

// Function to show toast message
function showToast(message, type = 'success', rowCount = null) {
    // Remove existing toast if any
    const existingToast = document.getElementById('endux-toast');
    if (existingToast) {
	existingToast.remove();
    }
    
    // Create toast element
    const toast = document.createElement('div');
    toast.id = 'endux-toast';
    
    // Add row count to message if provided
    let fullMessage = message;
    if (rowCount !== null) {
	fullMessage += ` (${rowCount} wierszy)`;
    }
    
    toast.textContent = fullMessage;
    toast.style.position = 'fixed';
    toast.style.top = '20px';
    toast.style.right = '20px';
    // Set background color based on type
    let bgColor = '#dc3545'; // default error
    if (type === 'success') {
	bgColor = '#28a745';
    } else if (type === 'warning' || type === 'error') {
	bgColor = type === 'warning' ? '#ffc107' : '#dc3545';
    }
    toast.style.backgroundColor = bgColor;
    toast.style.color = '#ffffff';
    toast.style.padding = '12px 24px';
    toast.style.borderRadius = '6px';
    toast.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
    toast.style.zIndex = '10000';
    toast.style.fontSize = '14px';
    toast.style.fontWeight = '500';
    toast.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    
    // Add to page
    document.body.appendChild(toast);
    
    // Fade in
    setTimeout(() => {
	toast.style.opacity = '1';
    }, 10);
    
    // Remove after 3 seconds
    setTimeout(() => {
	toast.style.opacity = '0';
	setTimeout(() => {
	    toast.remove();
	}, 300);
    }, 3000);
}

// Copy TSV block (tabs between cells, newlines between rows). hashSourceText is used for duplicate detection only.
function copyTsvTextToClipboard(fullText, hashSourceText, append, silentDuplicate) {
    const tableText = (fullText || '').replace(/\n$/, '');
    const hashText = (hashSourceText || '').replace(/\n$/, '');
    const tableHash = createHash(hashText);
    const currentRowCount = tableText.split('\n').filter(function(line) { return line.trim().length > 0; }).length;

    if (append) {
	return new Promise(function(resolve) {
	    chrome.storage.local.get(['accumulatedClipboard', 'preventDuplicates', 'clipboardHashes'], function(result) {
		const existingContent = result.accumulatedClipboard || '';
		const preventDuplicates = result.preventDuplicates === undefined ? true : result.preventDuplicates;
		const existingHashes = result.clipboardHashes || [];

		if (preventDuplicates && tableHash) {
		    if (existingHashes.includes(tableHash)) {
			if (!silentDuplicate) {
			    showToast('⚠️ Ta tabela już jest w schowku! Duplikat nie został dodany.', 'warning');
			}
			resolve({ success: false, rowCount: null, isDuplicate: true });
			return;
		    }
		}

		const tableTextWithNewline = tableText + '\n';
		const combinedText = existingContent + (existingContent ? '\n\n' : '') + tableTextWithNewline;
		const updatedHashes = existingHashes.concat([tableHash]);
		const totalRowCount = combinedText.split('\n').filter(function(line) { return line.trim().length > 0; }).length;

		chrome.storage.local.set({
		    accumulatedClipboard: combinedText,
		    clipboardHashes: updatedHashes
		}, function() {
		    navigator.clipboard.writeText(combinedText)
			.then(function() {
			    resolve({ success: true, rowCount: totalRowCount });
			})
			.catch(function() {
			    resolve({ success: true, rowCount: totalRowCount, clipboardError: true });
			});
		});
	    });
	});
    }

    const tableTextWithNewline = tableText + '\n';
    return new Promise(function(resolve) {
	chrome.storage.local.set({
	    accumulatedClipboard: tableTextWithNewline,
	    clipboardHashes: [tableHash]
	}, function() {
	    navigator.clipboard.writeText(tableTextWithNewline)
		.then(function() {
		    resolve({ success: true, rowCount: currentRowCount });
		})
		.catch(function() {
		    resolve({ success: true, rowCount: currentRowCount, clipboardError: true });
		});
	});
    });
}

function enduxGetTableBodyRows(table) {
    if (!table || table.tagName !== 'TABLE') return [];
    const thead = table.querySelector('thead');
    const theadRows = thead ? thead.rows : [];
    const allTbodies = table.querySelectorAll('tbody');
    let bodyRows = [];
    if (allTbodies.length > 0) {
	for (let i = 0; i < allTbodies.length; i++) {
	    bodyRows = bodyRows.concat(Array.from(allTbodies[i].rows));
	}
    } else {
	bodyRows = Array.from(table.rows).filter(function(row, index) {
	    return !thead || index >= theadRows.length;
	});
    }
    return bodyRows;
}

function enduxTableBodyHashText(table) {
    const bodyRows = enduxGetTableBodyRows(table);
    let hashText = '';
    for (let i = 0; i < bodyRows.length; i++) {
	const row = bodyRows[i];
	const cells = [];
	for (let j = 0; j < row.cells.length; j++) {
	    cells.push(getPlainText(row.cells[j]));
	}
	hashText += cells.join('\t') + '\n';
    }
    return hashText.replace(/\n$/, '');
}

/** Ten sam skrót co przy duplikatach w schowku — do pomijania auto-append przy szumie mutacji bez zmiany danych. */
function enduxTableBodyDataHash(table) {
    return createHash(enduxTableBodyHashText(table));
}

// Function to copy table to clipboard (with append support)
function copyTableToClipboard(table, includeHeader, append = false, silentDuplicate = false) {
    if (!table || table.tagName !== 'TABLE') {
	return Promise.resolve({ success: false, rowCount: null });
    }

    let tableText = '';

    const thead = table.querySelector('thead');
    const theadRows = thead ? thead.rows : [];
    const bodyRows = enduxGetTableBodyRows(table);

    if (includeHeader && theadRows.length > 0) {
	for (let i = 0; i < theadRows.length; i++) {
	    const row = theadRows[i];
	    const cells = [];
	    for (let j = 0; j < row.cells.length; j++) {
		cells.push(getPlainText(row.cells[j]));
	    }
	    tableText += cells.join('\t') + '\n';
	}
    }

    for (let i = 0; i < bodyRows.length; i++) {
	const row = bodyRows[i];
	const cells = [];
	for (let j = 0; j < row.cells.length; j++) {
	    cells.push(getPlainText(row.cells[j]));
	}
	tableText += cells.join('\t') + '\n';
    }

    tableText = tableText.replace(/\n$/, '');

    const hashText = enduxTableBodyHashText(table);

    return copyTsvTextToClipboard(tableText, hashText, append, silentDuplicate);
}

let _crawlerStepRunning = false; // Guard against concurrent crawler executions

// Używane przez picker selektora i panel siatki (musi być przed startSelectorPicker).
const GRID_PANEL_ID = 'endux-grid-extractor-root';
const ENDUX_CLIPBOARD_ROW_COUNT_COLOR = '#dc2626';
const ENDUX_CLIPBOARD_ROW_COUNT_HOVER = '#b91c1c';

// ── Selector Picker ──────────────────────────────────────────────────────────

let _pickerActive = false;
let _pickerHighlightEl = null;
let _pickerBanner = null;
let _pickerStorageKey = 'crawlerClass';
let _pickerBannerCustomText = '';

let _subtableExpandPickerActive = false;
let _subtableExpandPickerHoverEl = null;
let _subtableExpandPickerBanner = null;
const ENDUX_SUBTABLE_EXPAND_BANNER_ID = 'endux-subtable-expand-banner';

let _subtableFieldPickerActive = false;
let _subtableFieldPickerHoverEl = null;
let _subtableFieldPickerBanner = null;
const ENDUX_SUBTABLE_FIELD_BANNER_ID = 'endux-subtable-field-banner';

const ENDUX_SUBTABLE_STEP_MS = 450;
let _enduxSubtableDebugConfirm = false;
const ENDUX_SUBTABLE_STORAGE_KEYS = [
    'gridSubtableEnabled',
    'gridSubtableExpandRelative',
    'gridSubtableBackSelector',
    'gridSubtableUseHistoryBack',
    'gridSubtableDebugConfirm',
    'gridSubtableFields'
];

/**
 * Po pełnym resecie ustawień (popup „Wyczyść wszystko”): zamknij pickery/panel,
 * odśwież cache podtabeli i panele tabel z aktualnego storage.
 */
function enduxApplyFullSettingsReset() {
    try {
	if (typeof stopSelectorPicker === 'function') stopSelectorPicker();
    } catch (e1) {}
    try {
	if (typeof stopGridPicker === 'function') stopGridPicker();
    } catch (e2) {}
    try {
	if (typeof stopSubtableExpandPicker === 'function') stopSubtableExpandPicker();
    } catch (e3) {}
    try {
	if (typeof stopSubtableFieldPicker === 'function') stopSubtableFieldPicker();
    } catch (e4) {}
    try {
	if (typeof removeExistingPanels === 'function') removeExistingPanels();
    } catch (e5) {}
    try {
	if (!chrome.storage || !chrome.storage.local) return;
    } catch (e6) {
	return;
    }
    chrome.storage.local.get(
	['extensionEnabled', 'inlineTableControlPanels'].concat(ENDUX_SUBTABLE_STORAGE_KEYS),
	function(result) {
	    if (chrome.runtime.lastError) return;
	    enduxSyncSubtableExportCacheFromSlice(result || {});
	    updateAllClipboardInfo();
	    if (result.extensionEnabled !== false && result.inlineTableControlPanels !== false) {
		injectTablePanels(false);
	    }
	}
    );
}

let _enduxSubtableExportEnabled = false;
let _enduxSubtableExportFields = [];
let _enduxSubtableRowFieldCache = {};
/** Podczas przejścia podtabeli: { completed, total } — dopisywane do statusu panelu. */
let _enduxSubtableWalkProgress = null;

function enduxResetSubtableRowFieldCache() {
    _enduxSubtableRowFieldCache = {};
}

function enduxSubtableWalkProgressSuffix() {
    if (!_enduxSubtableWalkProgress) return '';
    var t = _enduxSubtableWalkProgress.total | 0;
    if (t <= 0) return '';
    var c = Math.max(0, Math.min(_enduxSubtableWalkProgress.completed | 0, t));
    var rem = Math.max(0, t - c);
    return ' · Podstrony: ' + c + '/' + t + ' (zostało ' + rem + ')';
}

function enduxSubtableRowCacheKey(rowEl) {
    if (!rowEl || rowEl.nodeType !== 1) return '';
    try {
	return rowDirectCellTexts(rowEl)
	    .map(function(t) {
		return String(t == null ? '' : t).trim();
	    })
	    .join('\u241f')
	    .slice(0, 1600);
    } catch (e) {
	return '';
    }
}

/** Odczyt wartości w momencie otwartej podstrony (bez heurystyki podglądu wierszowego). */
function enduxSubtableFieldTextCaptureDuringWalk(rowEl, field) {
    if (!field) return '';
    var el = null;
    try {
	el = enduxSubtableFieldElementForRow(rowEl, field);
    } catch (e) {
	return '';
    }
    if (!el) return '';
    try {
	return getPlainText(el);
    } catch (e2) {
	return '';
    }
}

function enduxRememberSubtableFieldValuesForRow(rowEl, fields) {
    if (!rowEl || !fields || !fields.length) return;
    var key = enduxSubtableRowCacheKey(rowEl);
    if (!key) return;
    var bucket = _enduxSubtableRowFieldCache[key] || {};
    for (var i = 0; i < fields.length; i++) {
	var f = fields[i];
	if (!f || !f.id) continue;
	var v = '';
	try {
	    v = enduxSubtableFieldTextCaptureDuringWalk(rowEl, f);
	} catch (e) {
	    v = '';
	}
	bucket[f.id] = String(v == null ? '' : v);
    }
    _enduxSubtableRowFieldCache[key] = bucket;
}

function enduxSubtableCachedFieldTextForRow(rowEl, field) {
    if (!rowEl || !field || !field.id) return '';
    var key = enduxSubtableRowCacheKey(rowEl);
    if (!key) return '';
    var bucket = _enduxSubtableRowFieldCache[key];
    if (!bucket) return '';
    var v = bucket[field.id];
    return v == null ? '' : String(v);
}

function enduxSyncSubtableExportCacheFromSlice(su) {
    if (!su || typeof su !== 'object') {
	_enduxSubtableExportEnabled = false;
	_enduxSubtableExportFields = [];
	enduxResetSubtableRowFieldCache();
	return;
    }
    _enduxSubtableExportEnabled = su.gridSubtableEnabled === true;
    _enduxSubtableDebugConfirm = su.gridSubtableDebugConfirm === true;
    _enduxSubtableExportFields = _enduxSubtableExportEnabled
	? enduxNormalizeSubtableFields(su.gridSubtableFields || [])
	: [];
    if (!_enduxSubtableExportEnabled) enduxResetSubtableRowFieldCache();
}

function enduxSubtableExportExtraColCount() {
    return _enduxSubtableExportEnabled ? _enduxSubtableExportFields.length : 0;
}

function enduxEscapeTsvCell(s) {
    if (s == null) return '';
    return String(s).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\t/g, ' ').replace(/\n/g, ' ');
}

/** Wiersz szablonu, w którym leży kliknięty element (dla ścieżki per-wiersz przy zapisie document). */
function enduxSubtableFindDataRowContainingLeaf(leaf, rows) {
    if (!leaf || !rows || !rows.length) return null;
    for (var i = 0; i < rows.length; i++) {
	if (enduxIsNodeUnderAncestor(rows[i], leaf)) return rows[i];
    }
    return null;
}

/**
 * Wiersz danych siatki dla „Wskaż pole”: portal / MUI często wyrywa DOM z wiersza — composedPath
 * i elementsFromPoint potrafią wciąż wskazać wiersz; na końcu szablon z Ekstrakcji (_gridSelectedEl).
 */
function enduxSubtableFindGridRowForSubtablePick(leaf, rows, e) {
    if (!rows || !rows.length) return null;
    var i, j, n, path, stack, si;
    if (e && typeof e.composedPath === 'function') {
	path = e.composedPath();
	for (i = 0; i < path.length; i++) {
	    n = path[i];
	    if (!n || n.nodeType !== 1) continue;
	    for (j = 0; j < rows.length; j++) {
		if (rows[j] === n) return rows[j];
	    }
	}
    }
    var rDom = enduxSubtableFindDataRowContainingLeaf(leaf, rows);
    if (rDom) return rDom;
    if (
	e &&
	typeof e.clientX === 'number' &&
	typeof e.clientY === 'number' &&
	typeof document.elementsFromPoint === 'function'
    ) {
	stack = document.elementsFromPoint(e.clientX, e.clientY);
	if (stack && stack.length) {
	    for (si = 0; si < Math.min(stack.length, 80); si++) {
		n = stack[si];
		if (!n || n.nodeType !== 1) continue;
		for (j = 0; j < rows.length; j++) {
		    if (rows[j] === n) return rows[j];
		}
	    }
	}
    }
    if (leaf && leaf.nodeType === 1 && _gridSelectedEl) {
	for (j = 0; j < rows.length; j++) {
	    if (rows[j] === _gridSelectedEl) {
		if (enduxBuildRelativeSelectorFromAncestor(_gridSelectedEl, leaf)) return _gridSelectedEl;
		break;
	    }
	}
    }
    return null;
}

/** Węzeł docelowy pola podtabeli w kontekście wiersza danych (do podświetlenia / tekstu). */
function enduxSubtableFieldElementForRow(rowEl, field) {
    if (!field) return null;
    var rr = field.rowRelativeSelector && String(field.rowRelativeSelector).trim();
    if (rr && rowEl && rowEl.nodeType === 1) {
	try {
	    var elR = rowEl.querySelector(rr);
	    if (elR) return elR;
	} catch (e) {
	    return null;
	}
    }
    if (typeof field.relativeSelector !== 'string' || !field.relativeSelector.trim()) return null;
    var rel = field.relativeSelector.trim();
    try {
	if (field.scope === 'document') {
	    return document.querySelector(enduxSubtableFieldDocumentCss(rel));
	}
	if (rowEl && rowEl.nodeType === 1) {
	    return rowEl.querySelector(rel);
	}
    } catch (e) {
	return null;
    }
    return null;
}

/** Wartość pola podtabeli dla wiersza eksportu (wiersz = element wiersza danych siatki). */
function enduxSubtableFieldTextForRow(rowEl, field) {
    if (!field) return '';
    /* Po przejściu: cache per wiersz. „Live” z pola document często to jeden węzeł — bez tego wszystkie wiersze dostałyby tę samą wartość przy otwartym panelu. */
    var cached = enduxSubtableCachedFieldTextForRow(rowEl, field);
    if (cached != null && String(cached).trim() !== '') return String(cached).trim();

    var el = null;
    try {
	el = enduxSubtableFieldElementForRow(rowEl, field);
    } catch (e) {
	return '';
    }
    if (!el) return '';

    if (rowEl && rowEl.nodeType === 1 && enduxIsNodeUnderAncestor(rowEl, el)) {
	return getPlainText(el);
    }
    var ctx = null;
    try {
	ctx = enduxResolveSubtablePreviewContextRow();
    } catch (e2) {
	ctx = null;
    }
    if (field.scope === 'document' && ctx && rowEl === ctx) {
	return getPlainText(el);
    }
    return '';
}

function enduxSleep(ms) {
    return new Promise(function(resolve) {
	setTimeout(resolve, ms);
    });
}

/** Czy el leży pod ancestor (światło + shadow root / slot — dla siatek MUI itd.). */
function enduxIsNodeUnderAncestor(ancestor, el) {
    if (!ancestor || !el || el.nodeType !== 1) return false;
    if (ancestor.contains(el)) return true;
    var n = el;
    for (var d = 0; n && d < 80; d++) {
	if (n === ancestor) return true;
	if (n.assignedSlot) {
	    n = n.assignedSlot;
	    continue;
	}
	if (n.parentElement) {
	    n = n.parentElement;
	    continue;
	}
	var root = n.getRootNode && n.getRootNode();
	if (root && root instanceof ShadowRoot && root.host) {
	    n = root.host;
	    continue;
	}
	break;
    }
    return false;
}

function enduxCssEscapeIdent(s) {
    if (s == null || s === '') return '';
    try {
	if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(String(s));
    } catch (e) {}
    return String(s).replace(/[^a-zA-Z0-9_-]/g, function(ch) {
	return '\\' + ch;
    });
}

/** Klasy użyteczne w selektorach (odrzuca JSS/emotion i prefiks endux). */
function enduxStableCssClassTokens(el) {
    if (!el || el.nodeType !== 1) return [];
    var raw = '';
    try {
	if (typeof el.className === 'string') {
	    raw = el.className;
	} else if (el.className && typeof el.className.baseVal === 'string') {
	    raw = el.className.baseVal;
	}
    } catch (e) {
	return [];
    }
    if (!raw || !String(raw).trim()) return [];
    var out = String(raw)
	.trim()
	.split(/\s+/)
	.filter(function(c) {
	    if (!c || c.indexOf('endux') === 0) return false;
	    if (/^jss\d+$/i.test(c)) return false;
	    if (/^css-[0-9a-z]{4,}$/i.test(c)) return false;
	    if (/^makeStyles-/i.test(c)) return false;
	    if (/^Private/i.test(c)) return false;
	    if (/^emotion-/i.test(c)) return false;
	    if (/^[a-z]{2,3}\d{6,}$/i.test(c)) return false;
	    return true;
	});
    out.sort(function(a, b) {
	var am = a.indexOf('Mui') === 0 ? 1 : 0;
	var bm = b.indexOf('Mui') === 0 ? 1 : 0;
	if (bm !== am) return bm - am;
	return b.length - a.length;
    });
    return out;
}

/**
 * Jeden segment „rodzic > dziecko”: preferuje tag.klasy gdy wśród elementowych dzieci rodzica
 * jest dokładnie jedno trafienie — krótsze i często wspólne między wierszami (MUI); inaczej :nth-child.
 */
function enduxChildSelectorSegment(par, child) {
    if (!par || !child || child.parentElement !== par) return '';
    var children = Array.from(par.children).filter(function(n) {
	return n.nodeType === 1;
    });
    var idx = children.indexOf(child);
    if (idx < 0) return '';
    var tag = child.tagName.toLowerCase();
    if (children.length === 1) return tag;
    var sameTag = children.filter(function(c) {
	return c.tagName === child.tagName;
    });
    if (sameTag.length === 1) return tag;
    function matchesAmong(sel) {
	try {
	    return children.filter(function(n) {
		try {
		    return n.matches(sel);
		} catch (e) {
		    return false;
		}
	    });
	} catch (e) {
	    return [];
	}
    }
    var tokens = enduxStableCssClassTokens(child);
    var ti,
	tj,
	sel,
	m;
    for (ti = 0; ti < tokens.length; ti++) {
	sel = tag + '.' + enduxCssEscapeIdent(tokens[ti]);
	m = matchesAmong(sel);
	if (m.length === 1 && m[0] === child) return sel;
    }
    for (ti = 0; ti < tokens.length; ti++) {
	for (tj = ti + 1; tj < tokens.length; tj++) {
	    sel = tag + '.' + enduxCssEscapeIdent(tokens[ti]) + '.' + enduxCssEscapeIdent(tokens[tj]);
	    m = matchesAmong(sel);
	    if (m.length === 1 && m[0] === child) return sel;
	}
    }
    if (tokens.length) {
	sel = tag + '.' + tokens.map(enduxCssEscapeIdent).join('.');
	m = matchesAmong(sel);
	if (m.length === 1 && m[0] === child) return sel;
    }
    return tag + ':nth-child(' + (idx + 1) + ')';
}

/** Łańcuch od ancestor do el (descendant combinator >); segmenty: klasy stabilne lub :nth-child. */
function enduxBuildRelativeSelectorFromAncestor(ancestor, el) {
    if (!ancestor || !el || el.nodeType !== 1) return '';
    if (!enduxIsNodeUnderAncestor(ancestor, el)) return '';
    var parts = [];
    var cur = el;
    while (cur && cur !== ancestor) {
	var par = cur.parentElement;
	if (!par) {
	    var root = cur.getRootNode && cur.getRootNode();
	    if (root && root instanceof ShadowRoot && root.host) {
		cur = root.host;
		if (cur === ancestor) break;
		continue;
	    }
	    return '';
	}
	var seg = enduxChildSelectorSegment(par, cur);
	if (!seg) return '';
	parts.unshift(seg);
	cur = par;
    }
    return parts.join(' > ');
}

/**
 * Skraca selektor względem wiersza danych, jeśli krótszy sufiks daje dokładnie jedno trafienie
 * w każdym wierszu i w wierszu szablonu wskazuje na ten sam leaf (analogiczny układ podstrony).
 */
function enduxTryShortenSubtableRowRelativeSelector(templateRow, leaf, fullRel) {
    if (!templateRow || !leaf || !fullRel || typeof fullRel !== 'string') return fullRel;
    if (!templateRow.contains || !templateRow.contains(leaf)) return fullRel;
    var rows = getGridDataRowsOnly();
    if (!rows.length || rows.length < 2) return fullRel;
    var parts = fullRel.split(/\s*>\s*/).filter(function(p) {
	return p && String(p).trim();
    });
    if (!parts.length) return fullRel;
    var start;
    for (start = 0; start < parts.length; start++) {
	var sub = parts.slice(start).join(' > ');
	if (!sub) continue;
	try {
	    var ok = true;
	    var i;
	    for (i = 0; i < rows.length; i++) {
		var list = rows[i].querySelectorAll(sub);
		if (list.length !== 1) {
		    ok = false;
		    break;
		}
		var hit = list[0];
		if (rows[i] === templateRow) {
		    if (hit !== leaf) {
			ok = false;
			break;
		    }
		} else if (hit.tagName !== leaf.tagName) {
		    ok = false;
		    break;
		}
	    }
	    if (ok) return sub;
	} catch (e) {}
    }
    return fullRel;
}

/**
 * Gdy zapis padł na pełnej ścieżce od body (portal), a leaf w drzewie leży pod którymś wierszem siatki:
 * wycina sufiks po prefiksie „body → wiersz” (najdłuższy pasujący prefiks) i sprawdza, że ten sufiks
 * daje dokładnie jedno trafienie w każdym wierszu — wtedy ten sam selektor działa dla każdego wiersza.
 */
function enduxSubtableTryDeriveRowScopeFromBodyPath(leaf, relFromBody, rows) {
    if (!leaf || !relFromBody || typeof relFromBody !== 'string' || !rows || !rows.length) return null;
    var candidates = [];
    var ri, pfx, sep, suf, i, lst, ok;
    for (ri = 0; ri < rows.length; ri++) {
	pfx = enduxBuildRelativeSelectorFromAncestor(document.body, rows[ri]);
	if (!pfx || relFromBody === pfx) continue;
	sep = pfx + ' > ';
	if (relFromBody.indexOf(sep) !== 0) continue;
	suf = relFromBody.substring(sep.length);
	if (!suf) continue;
	candidates.push({ row: rows[ri], pfxLen: pfx.length, suffix: suf });
    }
    if (!candidates.length) return null;
    candidates.sort(function(a, b) {
	return b.pfxLen - a.pfxLen;
    });
    for (ri = 0; ri < candidates.length; ri++) {
	var c = candidates[ri];
	suf = c.suffix;
	ok = true;
	for (i = 0; i < rows.length; i++) {
	    try {
		lst = rows[i].querySelectorAll(suf);
	    } catch (ex) {
		ok = false;
		break;
	    }
	    if (lst.length !== 1) {
		ok = false;
		break;
	    }
	    if (lst[0].tagName !== leaf.tagName) {
		ok = false;
		break;
	    }
	    if (rows[i] === c.row && lst[0] !== leaf) {
		ok = false;
		break;
	    }
	}
	if (ok) return { templateRow: c.row, suffix: suf };
    }
    return null;
}

/**
 * Ostatnia deska ratunku: sufiks łańcucha zapisany od body, który jako selektor względem każdego wiersza
 * daje dokładnie jedno trafienie; leaf musi być trafieniem w dokładnie jednym wierszu (jak przy tym samym układzie komórek).
 */
function enduxSubtableBruteRowRelativeFromBodyPath(leaf, rel, rows) {
    if (!leaf || !rel || typeof rel !== 'string' || !rows || !rows.length) return null;
    var parts = rel.split(/\s*>\s*/).filter(function(p) {
	return p && String(p).trim();
    });
    if (!parts.length) return null;
    var start, sub, i, lst, ok, hitOwner;
    /* Od najkrótszego sufiksu (najbliżej leaf), żeby zapisać wspólną krótką ścieżkę wiersza, nie pełny ogon od main. */
    for (start = parts.length - 1; start >= 0; start--) {
	sub = parts.slice(start).join(' > ');
	if (!sub) continue;
	try {
	    ok = true;
	    hitOwner = -1;
	    for (i = 0; i < rows.length; i++) {
		lst = rows[i].querySelectorAll(sub);
		if (lst.length !== 1) {
		    ok = false;
		    break;
		}
		if (lst[0].tagName !== leaf.tagName) {
		    ok = false;
		    break;
		}
		if (lst[0] === leaf) {
		    if (hitOwner >= 0) {
			ok = false;
			break;
		    }
		    hitOwner = i;
		}
	    }
	    if (ok && hitOwner >= 0) return { templateRow: rows[hitOwner], suffix: sub };
	} catch (ex) {}
    }
    return null;
}

function _removeSelectorPickerHeaderCancel() {
    var el = document.querySelector('[data-endux-picker-header-cancel="1"]');
    if (el) el.remove();
}

function _addSelectorPickerHeaderCancel() {
    var root = document.getElementById(GRID_PANEL_ID);
    var header = root && root.querySelector('[data-endux-grid-section="header"]');
    if (!header || header.querySelector('[data-endux-picker-header-cancel="1"]')) return;
    var headerActions = root.querySelector('[data-endux-grid-header-actions="1"]');
    if (!headerActions) return;
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.setAttribute('data-endux-picker-header-cancel', '1');
    cancel.textContent = 'Anuluj wybór';
    cancel.title = 'Zakończ wskazywanie (jak Esc)';
    cancel.setAttribute('aria-label', 'Anuluj wybór elementu');
    Object.assign(cancel.style, {
	border: '1px solid #b45309',
	background: '#fff7ed',
	color: '#9a3412',
	cursor: 'pointer',
	fontSize: '12px',
	fontWeight: '700',
	padding: '4px 10px',
	borderRadius: '6px',
	marginRight: '6px',
	fontFamily: 'inherit',
	flexShrink: '0'
    });
    cancel.addEventListener('click', function(ev) {
	ev.stopPropagation();
	stopSelectorPicker();
	showToast('Wybieranie anulowane', 'warning');
    });
    headerActions.insertBefore(cancel, headerActions.firstChild);
}

function _applySelectorPickerPanelPassThrough(active) {
    var root = document.getElementById(GRID_PANEL_ID);
    if (!root) return;
    var header = root.querySelector('[data-endux-grid-section="header"]');
    var chip = root.querySelector('[data-endux-grid-minimize-chip="1"]');
    if (active) {
	root.setAttribute('data-endux-selector-picker-pass', '1');
	root.style.setProperty('pointer-events', 'none', 'important');
	if (header) header.style.setProperty('pointer-events', 'auto', 'important');
	if (chip) chip.style.setProperty('pointer-events', 'auto', 'important');
	_addSelectorPickerHeaderCancel();
    } else {
	root.removeAttribute('data-endux-selector-picker-pass');
	root.style.removeProperty('pointer-events');
	if (header) header.style.removeProperty('pointer-events');
	if (chip) chip.style.removeProperty('pointer-events');
	_removeSelectorPickerHeaderCancel();
    }
}

/** Pierwszy element pasujący do selektora poza panelem EnduX (np. szablon wiersza z wieloma dopasowaniami). */
function enduxFirstMatchOutsidePanel(selector) {
    if (!selector || typeof selector !== 'string') return null;
    var list;
    try {
	list = document.querySelectorAll(selector);
    } catch (e) {
	return null;
    }
    for (var i = 0; i < list.length; i++) {
	var c = list[i];
	if (c.nodeType === 1 && !isInsideEnduxExtensionUi(c)) return c;
    }
    return null;
}

/** Klasa wiersza MUI DataGrid bez stanów typu --firstVisible (dla stabilnego szablonu). */
function enduxStableMuiDataGridRowClassToken(el) {
    if (!el || !el.className || typeof el.className !== 'string') return '';
    var tokens = el.className.trim().split(/\s+/).filter(function(c) {
	return c && c.indexOf('endux') !== 0 && !/--(first|last)Visible$/i.test(c);
    });
    if (tokens.indexOf('MuiDataGrid-row') >= 0) return 'MuiDataGrid-row';
    for (var i = 0; i < tokens.length; i++) {
	if (/^MuiDataGrid-row/.test(tokens[i])) return tokens[i];
    }
    return '';
}

/**
 * Klasa do szablonu wiersza: najpierw własna aplikacji (bez prefiksu Mui), potem MUI DataGrid.
 * Dzięki temu np. .mojaKlasa jest wybierana zamiast niestabilnego data-id.
 */
function enduxGridRowTemplateClassToken(el) {
    if (!el || !el.className || typeof el.className !== 'string') return '';
    var tokens = el.className.trim().split(/\s+/).filter(function(c) {
	return c && c.indexOf('endux') !== 0 && !/--(first|last)Visible$/i.test(c);
    });
    for (var i = 0; i < tokens.length; i++) {
	if (!/^Mui/.test(tokens[i])) return tokens[i];
    }
    return enduxStableMuiDataGridRowClassToken(el);
}

function enduxGridRowHostRoot(el) {
    if (!el || !el.closest) return null;
    return el.closest('[role="grid"], [role="treegrid"]') || el.closest('.MuiDataGrid-root');
}

function generateCssSelector(el) {
    if (!el || el === document.body) return 'body';

    // Prefer stable ID
    if (el.id && !el.id.includes('endux')) {
        try {
            const escaped = '#' + CSS.escape(el.id);
            if (document.querySelectorAll(escaped).length === 1) return escaped;
        } catch (e) {}
    }

    // Siatka (ARIA lub .MuiDataGrid-root): szablon wiersza po klasie + roli zamiast data-id (zmienia się między stronami).
    if (el.tagName === 'DIV' && el.getAttribute('role') === 'row') {
	var gridHost = enduxGridRowHostRoot(el);
	if (gridHost && gridHost !== el) {
	    var rowClassTok = enduxGridRowTemplateClassToken(el);
	    var rowPart = rowClassTok
		? 'div[role="row"].' + CSS.escape(rowClassTok)
		: 'div[role="row"]';
	    try {
		var gridSel = generateCssSelector(gridHost);
		var combined = gridSel + ' ' + rowPart;
		if (document.querySelectorAll(combined).length >= 1) return combined;
	    } catch (e) {}
	}
    }

    // data-id / data-rowindex — nie dla wiersza danych w siatce MUI/ARIA (wtedy wolimy szablon z klasy powyżej lub łańcuch poniżej).
    var volatileRowIdsSkipped = el.tagName === 'DIV' && el.getAttribute('role') === 'row' && !!enduxGridRowHostRoot(el);
    if ((el.tagName === 'DIV' || el.tagName === 'TR') && !volatileRowIdsSkipped) {
	const tag = el.tagName.toLowerCase();
	const did = el.getAttribute('data-id');
	if (did != null && did !== '') {
	    try {
		const sId = tag + '[data-id="' + String(did).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]';
		if (document.querySelectorAll(sId).length === 1) return sId;
	    } catch (e) {}
	}
	const dri = el.getAttribute('data-rowindex');
	if (dri != null && dri !== '') {
	    try {
		const sRow = tag + '[data-rowindex="' + String(dri).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]';
		if (document.querySelectorAll(sRow).length === 1) return sRow;
	    } catch (e) {}
	}
    }

    // Build tag + class selector
    let selector = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
        const classes = el.className.trim().split(/\s+/)
            .filter(c => c && !c.startsWith('endux'));
        if (classes.length > 0) {
            try {
                selector += '.' + classes.map(c => CSS.escape(c)).join('.');
            } catch (e) {
                selector += '.' + classes.join('.');
            }
        }
    }

    try {
        if (document.querySelectorAll(selector).length === 1) return selector;
    } catch (e) {}

    // aria-label fallback
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) {
        const s = `${el.tagName.toLowerCase()}[aria-label="${ariaLabel}"]`;
        try { if (document.querySelectorAll(s).length === 1) return s; } catch (e) {}
    }

    // Walk up the DOM
    if (el.parentElement && el.parentElement !== document.body) {
        const parentSel = generateCssSelector(el.parentElement);
        const siblings = Array.from(el.parentElement.children);
        const sameTag = siblings.filter(s => s.tagName === el.tagName);
        if (sameTag.length === 1) return parentSel + ' > ' + el.tagName.toLowerCase();
        const idx = siblings.indexOf(el) + 1;
        return parentSel + ' > ' + el.tagName.toLowerCase() + ':nth-child(' + idx + ')';
    }

    return selector;
}

// Walk up to the nearest interactive element so picker snaps to button/a instead of inner SVG/span
function _nearestClickable(el) {
    const CLICKABLE = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'];
    let node = el;
    while (node && node !== document.body) {
        if (CLICKABLE.includes(node.tagName)) return node;
        const role = node.getAttribute && node.getAttribute('role');
        if (role === 'button' || role === 'link' || role === 'menuitem') return node;
        node = node.parentElement;
    }
    return el; // fallback: original element
}

function _pickerMouseOver(e) {
    if (!_pickerActive) return;
    const t = e.target;
    if (!t || t.nodeType !== 1) return;
    const target = _nearestClickable(t);
    if (isInsideEnduxExtensionUi(t) || isInsideEnduxExtensionUi(target)) return;
    if (_pickerHighlightEl && _pickerHighlightEl !== target) {
        _pickerHighlightEl.style.outline = _pickerHighlightEl._enduxOrigOutline || '';
        _pickerHighlightEl.style.cursor = _pickerHighlightEl._enduxOrigCursor || '';
    }
    _pickerHighlightEl = target;
    _pickerHighlightEl._enduxOrigOutline = _pickerHighlightEl.style.outline;
    _pickerHighlightEl._enduxOrigCursor = _pickerHighlightEl.style.cursor;
    _pickerHighlightEl.style.outline = '2px solid #007bff';
    _pickerHighlightEl.style.cursor = 'crosshair';
}

function _pickerMouseOut(e) {
    if (!_pickerActive || !_pickerHighlightEl) return;
    const rel = e.relatedTarget;
    if (rel && rel.nodeType === 1 && isInsideEnduxExtensionUi(rel)) return;
    _pickerHighlightEl.style.outline = _pickerHighlightEl._enduxOrigOutline || '';
    _pickerHighlightEl.style.cursor = _pickerHighlightEl._enduxOrigCursor || '';
    _pickerHighlightEl = null;
}

function _pickerClick(e) {
    if (!_pickerActive) return;
    const t = e.target;
    if (!t || t.nodeType !== 1) return;
    const elPick = _nearestClickable(t);
    if (isInsideEnduxExtensionUi(t) || isInsideEnduxExtensionUi(elPick)) {
	if (isInsideEnduxExtensionUi(elPick) && !isInsideEnduxExtensionUi(t)) {
	    showToast('Wybierz element na stronie, nie w panelu EnduX', 'warning');
	}
	return;
    }
    e.preventDefault();
    e.stopPropagation();
    const selector = generateCssSelector(elPick);
    stopSelectorPicker();
    try {
        chrome.storage.local.set({ [_pickerStorageKey]: selector }, function() {
            showToast('🎯 Selektor zapisany: ' + selector, 'success');
	    if (_pickerStorageKey === 'gridSubtableBackSelector') enduxRefreshSubtableTabDisplays();
        });
    } catch (err) {}
}

function _pickerKeyDown(e) {
    if (e.key === 'Escape') {
        stopSelectorPicker();
        showToast('Wybieranie anulowane', 'warning');
    }
}

function startSelectorPicker(storageKey, customBannerText) {
    if (_pickerActive) stopSelectorPicker();
    stopSubtableExpandPicker();
    stopSubtableFieldPicker();
    _pickerStorageKey = storageKey || 'crawlerClass';
    _pickerBannerCustomText = typeof customBannerText === 'string' ? customBannerText : '';
    _pickerActive = true;
    document.body.style.cursor = 'crosshair';

    _pickerBanner = document.createElement('div');
    _pickerBanner.id = 'endux-picker-banner';
    Object.assign(_pickerBanner.style, {
	position: 'fixed',
	top: '0',
	left: '0',
	right: '0',
	zIndex: '2147483647',
	background: '#007bff',
	color: '#fff',
	padding: '8px 16px',
	fontSize: '14px',
	fontWeight: '600',
	fontFamily: 'sans-serif',
	boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
	pointerEvents: 'auto',
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	flexWrap: 'wrap',
	gap: '10px 14px',
	boxSizing: 'border-box'
    });
    var msg = document.createElement('span');
    msg.textContent = _pickerBannerCustomText ||
	'🎯 Kliknij element „Dalej” na stronie — dolny panel nie blokuje strony; nagłówek panelu: Anuluj lub Esc.';
    msg.style.lineHeight = '1.35';
    var escHint = document.createElement('span');
    escHint.textContent = 'Esc — anuluj';
    escHint.style.opacity = '0.92';
    escHint.style.fontSize = '13px';
    escHint.style.fontWeight = '500';
    var cancelTop = document.createElement('button');
    cancelTop.type = 'button';
    cancelTop.textContent = 'Anuluj wybór';
    Object.assign(cancelTop.style, {
	padding: '6px 14px',
	borderRadius: '6px',
	border: 'none',
	background: '#fff',
	color: '#007bff',
	fontWeight: '700',
	cursor: 'pointer',
	fontSize: '13px',
	fontFamily: 'inherit'
    });
    cancelTop.addEventListener('click', function(ev) {
	ev.stopPropagation();
	stopSelectorPicker();
	showToast('Wybieranie anulowane', 'warning');
    });
    _pickerBanner.appendChild(msg);
    _pickerBanner.appendChild(escHint);
    _pickerBanner.appendChild(cancelTop);
    document.body.appendChild(_pickerBanner);

    _applySelectorPickerPanelPassThrough(true);

    document.addEventListener('mouseover', _pickerMouseOver, true);
    document.addEventListener('mouseout',  _pickerMouseOut,  true);
    document.addEventListener('click',     _pickerClick,     true);
    document.addEventListener('keydown',   _pickerKeyDown,   true);
}

function stopSelectorPicker() {
    _pickerActive = false;
    _pickerBannerCustomText = '';
    document.body.style.cursor = '';
    _applySelectorPickerPanelPassThrough(false);
    if (_pickerHighlightEl) {
        _pickerHighlightEl.style.outline = _pickerHighlightEl._enduxOrigOutline || '';
        _pickerHighlightEl.style.cursor  = _pickerHighlightEl._enduxOrigCursor  || '';
        _pickerHighlightEl = null;
    }
    if (_pickerBanner) { _pickerBanner.remove(); _pickerBanner = null; }
    document.removeEventListener('mouseover', _pickerMouseOver, true);
    document.removeEventListener('mouseout',  _pickerMouseOut,  true);
    document.removeEventListener('click',     _pickerClick,     true);
    document.removeEventListener('keydown',   _pickerKeyDown,   true);
}

// ── Grid extractor panel (div „tables”, e.g. MUI DataGrid) ───────────────────

const GRID_PANEL_UI_STORAGE_KEY = 'enduxGridExtractorPanelUiByOrigin';
const GRID_PANEL_LEFT_WIDTH_STORAGE_KEY = 'enduxGridPanelLeftWidthPxByOrigin';
const GRID_PANEL_HEIGHT_STORAGE_KEY = 'enduxGridPanelHeightPxByOrigin';
const GRID_PANEL_SELECTION_STORAGE_KEY = 'enduxGridPanelSelectionByPage';
const GRID_SELECTION_OUTLINE = '3px solid #f97316';
const GRID_HEADER_OUTLINE = '3px solid #16a34a';

function gridPanelUiOriginKey() {
    try {
	return location.origin || '';
    } catch (e) {
	return '';
    }
}

function gridPanelSelectionPageKey() {
    try {
	return (location.origin || '') + (location.pathname || '') + (location.search || '') + (location.hash || '');
    } catch (e) {
	return '';
    }
}

var _gridSkipPersistSelection = false;

function saveGridPanelSelectionState() {
    if (_gridSkipPersistSelection) return;
    if (!chrome.storage || !chrome.storage.local) return;
    var pageKey = gridPanelSelectionPageKey();
    if (!pageKey) return;

    if (!_gridSelectedEl || !_gridSelectedEl.isConnected || isInsideEnduxGridPanel(_gridSelectedEl)) {
	_gridCachedDataSelector = null;
	_gridCachedHeaderSelector = null;
	chrome.storage.local.get([GRID_PANEL_SELECTION_STORAGE_KEY], function(result) {
	    if (chrome.runtime.lastError) return;
	    var map = Object.assign({}, result[GRID_PANEL_SELECTION_STORAGE_KEY] || {});
	    delete map[pageKey];
	    var payload = {};
	    payload[GRID_PANEL_SELECTION_STORAGE_KEY] = map;
	    chrome.storage.local.set(payload);
	});
	return;
    }

    if (_gridHeaderRowEl && _gridSelectedEl === _gridHeaderRowEl) {
	return;
    }

    var headerSel = null;
    var dataSel = null;
    try {
	dataSel = generateCssSelector(_gridSelectedEl);
    } catch (e) {
	return;
    }
    if (!dataSel) return;

    if (_gridHeaderRowEl && _gridHeaderRowEl.isConnected && !isInsideEnduxGridPanel(_gridHeaderRowEl)) {
	try {
	    headerSel = generateCssSelector(_gridHeaderRowEl);
	} catch (e) {}
    }

    _gridCachedDataSelector = dataSel;
    _gridCachedHeaderSelector = headerSel || null;

    chrome.storage.local.get([GRID_PANEL_SELECTION_STORAGE_KEY], function(result) {
	if (chrome.runtime.lastError) return;
	var map = Object.assign({}, result[GRID_PANEL_SELECTION_STORAGE_KEY] || {});
	map[pageKey] = {
	    headerSelector: headerSel || null,
	    dataSelector: dataSel,
	    savedAt: Date.now()
	};
	var payload = {};
	payload[GRID_PANEL_SELECTION_STORAGE_KEY] = map;
	chrome.storage.local.set(payload);
    });
}

function tryRestoreSavedGridSelectionOrAutoDetect() {
    if (!_gridPanelRoot) return;
    chrome.storage.local.get([GRID_PANEL_SELECTION_STORAGE_KEY], function(result) {
	if (chrome.runtime.lastError || !_gridPanelRoot) return;
	var map = result[GRID_PANEL_SELECTION_STORAGE_KEY] || {};
	var rec = map[gridPanelSelectionPageKey()];

	function attemptRestore() {
	    if (!_gridPanelRoot || !rec || !rec.dataSelector) return false;
	    var headerEl = null;
	    var dataEl = null;
	    if (rec.headerSelector) {
		try {
		    headerEl = enduxFirstMatchOutsidePanel(rec.headerSelector);
		} catch (e) {}
	    }
	    try {
		dataEl = enduxFirstMatchOutsidePanel(rec.dataSelector);
	    } catch (e) {}
	    if (!dataEl || !dataEl.isConnected || isInsideEnduxGridPanel(dataEl)) return false;
	    if (headerEl && (!headerEl.isConnected || isInsideEnduxGridPanel(headerEl))) headerEl = null;
	    if (headerEl && dataEl === headerEl) headerEl = null;
	    _gridSkipPersistSelection = true;
	    try {
	    if (headerEl) {
		    installGridTableSelection(headerEl, dataEl);
		} else {
		    installGridTableSelection(null, dataEl);
		}
		_gridCachedDataSelector = rec.dataSelector;
		_gridCachedHeaderSelector = rec.headerSelector || null;
		updateGridPreviewUI();
	    } finally {
		_gridSkipPersistSelection = false;
	    }
	    return true;
	}

	if (!rec || !rec.dataSelector) {
	    tryAutoDetectHtmlTableInGridPanel();
	    return;
	}
	if (attemptRestore()) return;
	setTimeout(function() {
	    if (!_gridPanelRoot || !rec.dataSelector) return;
	    if (attemptRestore()) return;
	    tryAutoDetectHtmlTableInGridPanel();
	}, 650);
    });
}

function tryRebindGridSelectionFromCachedSelectors() {
    if (!_gridPanelRoot) return false;
    var dataSel = _gridCachedDataSelector;
    if (!dataSel) return false;
    var dataEl = enduxFirstMatchOutsidePanel(dataSel);
    if (!dataEl || !dataEl.isConnected || isInsideEnduxGridPanel(dataEl)) return false;
    var headerEl = null;
    var headerSel = _gridCachedHeaderSelector;
    if (headerSel) {
	headerEl = enduxFirstMatchOutsidePanel(headerSel);
	if (!headerEl || !headerEl.isConnected || isInsideEnduxGridPanel(headerEl)) headerEl = null;
	if (headerEl === dataEl) headerEl = null;
    }
    _gridSkipPersistSelection = true;
    try {
	installGridTableSelection(headerEl, dataEl);
    } finally {
	_gridSkipPersistSelection = false;
    }
    return true;
}

function gridPanelSelectionNodesDisconnected() {
    if (!_gridSelectedEl) return false;
    if (!_gridSelectedEl.isConnected) return true;
    if (_gridHeaderRowEl && !_gridHeaderRowEl.isConnected) return true;
    return false;
}

/** Po paginacji AJAX węzły wierszy są zamieniane — ponownie znajdź elementy po zapisanych selektorach. */
function refreshGridPanelSelectionIfStale() {
    if (!_gridPanelRoot || !_gridSelectedEl) return;
    if (!gridPanelSelectionNodesDisconnected()) return;
    if (tryRebindGridSelectionFromCachedSelectors()) return;
    if (_gridCachedDataSelector) return;
    if (!chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get([GRID_PANEL_SELECTION_STORAGE_KEY], function(result) {
	if (chrome.runtime.lastError || !_gridPanelRoot) return;
	var map = result[GRID_PANEL_SELECTION_STORAGE_KEY] || {};
	var rec = map[gridPanelSelectionPageKey()];
	if (rec && rec.dataSelector) {
	    _gridCachedDataSelector = rec.dataSelector;
	    _gridCachedHeaderSelector = rec.headerSelector || null;
	}
	if (tryRebindGridSelectionFromCachedSelectors()) {
	    updateGridPreviewUI();
	}
    });
}

/** Nie niszcz podglądu (innerHTML) gdy użytkownik edytuje nazwę pola, kopiuje ścieżkę albo zaznacza tekst — MutationObserver często woła updateGridPreviewUI. */
function enduxGridPreviewEditShouldDeferDomRefresh() {
    var root = _gridPanelRoot;
    if (!root) return false;
    if ((root.getAttribute('data-endux-grid-active-tab') || 'extract') !== 'subtable') return false;
    var preview = root.querySelector('[data-grid-preview]');
    if (!preview) return false;
    if (_gridSubtablePreviewPointerDown) return true;
    var ae = document.activeElement;
    if (ae && ae.nodeType === 1 && preview.contains(ae)) {
	if (ae.tagName === 'INPUT' && ae.getAttribute('data-subtable-field-id')) return true;
	if (ae.tagName === 'TEXTAREA' && ae.getAttribute('data-subtable-path-readonly') === '1') return true;
    }
    var sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
	var r = sel.getRangeAt(0);
	var n = r.commonAncestorContainer;
	if (n.nodeType === 3) n = n.parentElement;
	if (n && preview.contains(n)) return true;
    }
    return false;
}

function enduxGridSubtablePreviewGlobalMouseUp() {
    _gridSubtablePreviewPointerDown = false;
}

function scheduleGridPanelPreviewAfterDomChange() {
    if (!document.getElementById(GRID_PANEL_ID)) return;
    if (_gridPreviewAfterDomTimer) clearTimeout(_gridPreviewAfterDomTimer);
    _gridPreviewAfterDomTimer = setTimeout(function() {
	_gridPreviewAfterDomTimer = null;
	if (!_gridPanelRoot) return;
	if (enduxGridPreviewEditShouldDeferDomRefresh()) return;
	refreshGridPanelSelectionIfStale();
	updateGridPreviewUI();
    }, 100);
}

function saveGridPanelUiState(state) {
    if (!chrome.storage || !chrome.storage.local) return;
    try {
	chrome.storage.local.get([GRID_PANEL_UI_STORAGE_KEY], function(result) {
	    if (chrome.runtime.lastError) return;
	    var map = Object.assign({}, result[GRID_PANEL_UI_STORAGE_KEY] || {});
	    map[gridPanelUiOriginKey()] = state;
	    var payload = {};
	    payload[GRID_PANEL_UI_STORAGE_KEY] = map;
	    chrome.storage.local.set(payload);
	});
    } catch (e) {}
}

function defaultGridPanelLeftWidthPx() {
    try {
	return Math.round(Math.min(420, Math.max(220, window.innerWidth * 0.36)));
    } catch (e) {
	return 300;
    }
}

function clampGridPanelLeftWidthPx(px, bodyEl) {
    var w = Math.round(px);
    var minL = 180;
    var minR = 140;
    try {
	var bw = bodyEl && bodyEl.getBoundingClientRect ? bodyEl.getBoundingClientRect().width : window.innerWidth;
	var maxL = Math.max(minL + 40, bw - minR - 24);
	return Math.max(minL, Math.min(w, maxL));
    } catch (e) {
	return Math.max(minL, Math.min(w, 560));
    }
}

function applyGridPanelLeftColumnWidthPx(px, bodyEl) {
    if (!_gridPanelRoot) return;
    var left = _gridPanelRoot.querySelector('[data-endux-grid-section="left"]');
    var body = bodyEl || _gridPanelRoot.querySelector('[data-endux-grid-section="body"]');
    if (!left || !body) return;
    var cw = clampGridPanelLeftWidthPx(px, body);
    left.style.setProperty('flex', 'none', 'important');
    left.style.setProperty('width', cw + 'px', 'important');
    left.style.setProperty('min-width', '180px', 'important');
    left.style.setProperty('max-width', 'none', 'important');
}

function saveGridPanelLeftColumnWidthPx(px) {
    if (!chrome.storage || !chrome.storage.local) return;
    try {
	chrome.storage.local.get([GRID_PANEL_LEFT_WIDTH_STORAGE_KEY], function(result) {
	    if (chrome.runtime.lastError) return;
	    var map = Object.assign({}, result[GRID_PANEL_LEFT_WIDTH_STORAGE_KEY] || {});
	    map[gridPanelUiOriginKey()] = px;
	    var payload = {};
	    payload[GRID_PANEL_LEFT_WIDTH_STORAGE_KEY] = map;
	    chrome.storage.local.set(payload);
	});
    } catch (e) {}
}

function loadAndApplyGridPanelSplitWidth() {
    if (!_gridPanelRoot) return;
    var splitRow = _gridPanelRoot.querySelector('[data-endux-grid-section="body"]');
    if (!splitRow) return;
    if (!chrome.storage || !chrome.storage.local) {
	applyGridPanelLeftColumnWidthPx(defaultGridPanelLeftWidthPx(), splitRow);
	return;
    }
    chrome.storage.local.get([GRID_PANEL_LEFT_WIDTH_STORAGE_KEY], function(result) {
	if (chrome.runtime.lastError || !_gridPanelRoot) return;
	var map = result[GRID_PANEL_LEFT_WIDTH_STORAGE_KEY] || {};
	var raw = map[gridPanelUiOriginKey()];
	var px = typeof raw === 'number' && raw > 0 ? raw : defaultGridPanelLeftWidthPx();
	applyGridPanelLeftColumnWidthPx(px, splitRow);
    });
}

function attachGridPanelSplitDrag(splitEl, leftEl, bodyEl) {
    if (!splitEl || !leftEl || !bodyEl) return;
    splitEl.addEventListener('mousedown', function(e) {
	if (e.button !== 0) return;
	e.preventDefault();
	var startX = e.clientX;
	var startW = leftEl.getBoundingClientRect().width;
	splitEl.style.opacity = '0.85';
	function onMove(ev) {
	    if (!_gridPanelRoot) return;
	    var dx = ev.clientX - startX;
	    applyGridPanelLeftColumnWidthPx(startW + dx, bodyEl);
	}
	function onUp() {
	    document.removeEventListener('mousemove', onMove, true);
	    document.removeEventListener('mouseup', onUp, true);
	    splitEl.style.opacity = '';
	    if (leftEl && leftEl.isConnected) {
		saveGridPanelLeftColumnWidthPx(Math.round(leftEl.getBoundingClientRect().width));
	    }
	}
	document.addEventListener('mousemove', onMove, true);
	document.addEventListener('mouseup', onUp, true);
    });
}

function defaultGridPanelHeightPx() {
    try {
	return Math.round(window.innerHeight * 0.42);
    } catch (e) {
	return 360;
    }
}

function clampGridPanelHeightPx(h) {
    var x = Math.round(h);
    var minH = 120;
    var maxH = 120;
    try {
	maxH = Math.max(200, window.innerHeight - 24);
    } catch (e) {
	maxH = 900;
    }
    return Math.max(minH, Math.min(x, maxH));
}

function applyGridPanelHeightPx(px) {
    if (!_gridPanelRoot) return;
    var root = _gridPanelRoot;
    var ch = clampGridPanelHeightPx(px);
    root.style.setProperty('height', ch + 'px', 'important');
    root.style.setProperty('max-height', 'none', 'important');
    root.style.setProperty('min-height', '120px', 'important');
    root.style.setProperty('overflow', 'hidden', 'important');
}

function saveGridPanelHeightPx(px) {
    if (!chrome.storage || !chrome.storage.local) return;
    try {
	chrome.storage.local.get([GRID_PANEL_HEIGHT_STORAGE_KEY], function(result) {
	    if (chrome.runtime.lastError) return;
	    var map = Object.assign({}, result[GRID_PANEL_HEIGHT_STORAGE_KEY] || {});
	    map[gridPanelUiOriginKey()] = px;
	    var payload = {};
	    payload[GRID_PANEL_HEIGHT_STORAGE_KEY] = map;
	    chrome.storage.local.set(payload);
	});
    } catch (e) {}
}

function loadAndApplyGridPanelHeightPx() {
    if (!_gridPanelRoot) return;
    applyGridPanelHeightPx(defaultGridPanelHeightPx());
    if (!chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get([GRID_PANEL_HEIGHT_STORAGE_KEY], function(result) {
	if (chrome.runtime.lastError || !_gridPanelRoot) return;
	var map = result[GRID_PANEL_HEIGHT_STORAGE_KEY] || {};
	var raw = map[gridPanelUiOriginKey()];
	if (typeof raw === 'number' && raw > 0) {
	    applyGridPanelHeightPx(raw);
	}
    });
}

function attachGridPanelHeightDrag(handleEl, rootEl) {
    if (!handleEl || !rootEl) return;
    handleEl.addEventListener('mousedown', function(e) {
	if (e.button !== 0) return;
	e.preventDefault();
	var startY = e.clientY;
	var startH = rootEl.getBoundingClientRect().height;
	handleEl.style.opacity = '0.85';
	function onMove(ev) {
	    if (!_gridPanelRoot) return;
	    var dy = startY - ev.clientY;
	    applyGridPanelHeightPx(startH + dy);
	}
	function onUp() {
	    document.removeEventListener('mousemove', onMove, true);
	    document.removeEventListener('mouseup', onUp, true);
	    handleEl.style.opacity = '';
	    if (rootEl && rootEl.isConnected) {
		saveGridPanelHeightPx(Math.round(rootEl.getBoundingClientRect().height));
	    }
	}
	document.addEventListener('mousemove', onMove, true);
	document.addEventListener('mouseup', onUp, true);
    });
}

function tryRestoreGridPanelUiOnLoad() {
    try {
	if (window !== window.top) return;
    } catch (e) {
	return;
    }
    if (!chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get(['extensionEnabled', GRID_PANEL_UI_STORAGE_KEY], function(result) {
	if (chrome.runtime.lastError) return;
	if (result.extensionEnabled === false) return;
	var map = result[GRID_PANEL_UI_STORAGE_KEY] || {};
	var ui = map[gridPanelUiOriginKey()];
	if (ui !== 'visible' && ui !== 'minimized') return;
	injectGridExtractorPanel();
	if (ui === 'minimized') {
	    setGridPanelMinimized(true);
	}
    });
}

let _gridPanelRoot = null;
let _gridSelectedEl = null;
let _gridHeaderRowEl = null;
let _gridUndoStack = [];
let _gridPickerActive = false;
let _gridPickerHoverEl = null;
let _gridPathEditActive = false;
/** Ostatni zapisany selektor (sync) — po AJAX wiersze są wymieniane; ponowne querySelector bez czekania na storage. */
let _gridCachedDataSelector = null;
let _gridCachedHeaderSelector = null;
let _gridPreviewAfterDomTimer = null;
let _enduxCrawlerStorageListenerBound = false;
/** Wiersz danych siatki używany do podglądu wartości pól podtabeli (klik na stronie w zakładce Podtabela). */
let _gridSubtablePreviewRowEl = null;
let _gridSubtablePreviewRowListenerBound = false;
let _gridSubtablePreviewPointerDown = false;
let _gridSubtablePreviewGlobalMouseUpBound = false;
let _enduxSubtableFieldHighlightEl = null;
let _enduxSubtableFieldHighlightStyle = null;

function ensureEnduxCrawlerInputsSyncFromStorage() {
    if (_enduxCrawlerStorageListenerBound || !chrome.storage || !chrome.storage.onChanged) return;
    _enduxCrawlerStorageListenerBound = true;
    chrome.storage.onChanged.addListener(function(changes, area) {
	if (area !== 'local') return;
	var root = document.getElementById(GRID_PANEL_ID);
	if (!root) return;
	if (changes.crawlerClass) {
	    var ic = root.querySelector('[data-grid-crawler-class]');
	    if (ic && changes.crawlerClass.newValue != null) ic.value = String(changes.crawlerClass.newValue);
	}
	if (changes.crawlerActive) {
	    var ac = root.querySelector('[data-grid-crawler-active]');
	    if (ac) {
		ac.checked = changes.crawlerActive.newValue === true;
		enduxSyncToggleForInput(ac);
	    }
	}
	var subKeys = {
	    gridSubtableEnabled: 1,
	    gridSubtableExpandRelative: 1,
	    gridSubtableBackSelector: 1,
	    gridSubtableUseHistoryBack: 1,
	    gridSubtableDebugConfirm: 1,
	    gridSubtableFields: 1
	};
	for (var k in changes) {
	    if (subKeys[k]) {
		enduxRefreshSubtableTabDisplays();
		var hcb = root.querySelector('[data-grid-subtable-use-history]');
		if (hcb && changes.gridSubtableUseHistoryBack) {
		    hcb.checked = changes.gridSubtableUseHistoryBack.newValue === true;
		    enduxSyncToggleForInput(hcb);
		}
		var en = root.querySelector('[data-grid-subtable-enabled]');
		if (en && changes.gridSubtableEnabled) {
		    en.checked = changes.gridSubtableEnabled.newValue === true;
		    enduxSyncToggleForInput(en);
		}
		var dbg = root.querySelector('[data-grid-subtable-debug]');
		if (dbg && changes.gridSubtableDebugConfirm) {
		    dbg.checked = changes.gridSubtableDebugConfirm.newValue === true;
		    enduxSyncToggleForInput(dbg);
		}
		break;
	    }
	}
    });
}

function switchGridPanelTab(tabId) {
    var root = _gridPanelRoot;
    if (!root) return;
    var extractPane = root.querySelector('[data-endux-grid-tab-pane="extract"]');
    var crawlPane = root.querySelector('[data-endux-grid-tab-pane="crawler"]');
    var subtablePane = root.querySelector('[data-endux-grid-tab-pane="subtable"]');
    var btnE = root.querySelector('[data-endux-grid-tab="extract"]');
    var btnC = root.querySelector('[data-endux-grid-tab="crawler"]');
    var btnS = root.querySelector('[data-endux-grid-tab="subtable"]');
    if (!extractPane || !crawlPane || !btnE || !btnC) return;
    root.setAttribute('data-endux-grid-active-tab', tabId);
    var activeBg = '#ffffff';
    var idleBg = '#d1d5db';
    var activeColor = '#111827';
    var idleColor = '#4b5563';
    function styleTabBtn(btn, active) {
	if (!btn) return;
	btn.style.setProperty('background', active ? activeBg : idleBg, 'important');
	btn.style.setProperty('color', active ? activeColor : idleColor, 'important');
	btn.style.setProperty('font-weight', active ? '700' : '500', 'important');
    }
    function hideAllPanes() {
	extractPane.style.setProperty('display', 'none', 'important');
	crawlPane.style.setProperty('display', 'none', 'important');
	if (subtablePane) subtablePane.style.setProperty('display', 'none', 'important');
	styleTabBtn(btnE, false);
	styleTabBtn(btnC, false);
	styleTabBtn(btnS, false);
    }
    hideAllPanes();
    if (tabId === 'crawler') {
	crawlPane.style.setProperty('display', 'flex', 'important');
	crawlPane.style.setProperty('flex-direction', 'column', 'important');
	styleTabBtn(btnC, true);
    } else if (tabId === 'subtable' && subtablePane) {
	subtablePane.style.setProperty('display', 'flex', 'important');
	subtablePane.style.setProperty('flex-direction', 'column', 'important');
	styleTabBtn(btnS, true);
	enduxRefreshSubtableTabDisplays();
	enduxBindSubtablePreviewRowListener();
    } else {
	extractPane.style.setProperty('display', 'flex', 'important');
	extractPane.style.setProperty('flex-direction', 'column', 'important');
	styleTabBtn(btnE, true);
	enduxUnbindSubtablePreviewRowListener();
	enduxClearSubtableFieldHoverHighlight();
    }
    if (tabId === 'crawler') {
	enduxUnbindSubtablePreviewRowListener();
	enduxClearSubtableFieldHoverHighlight();
    }
    updateGridPreviewUI();
}

const GRID_PANEL_EXPANDED_ROOT_STYLE = {
    position: 'fixed',
    left: '0',
    right: '0',
    bottom: '0',
    zIndex: '2147483646',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    boxShadow: '0 -8px 24px rgba(0,0,0,0.18)',
    borderTop: '1px solid #e8d5c4',
    background: '#fff5eb',
    display: 'flex',
    flexDirection: 'column',
    width: '',
    height: '',
    top: '',
    borderRadius: '',
    overflow: ''
};

function restoreGridPanelExpandedLayoutInDom() {
    if (!_gridPanelRoot) return;
    const root = _gridPanelRoot;
    root.style.removeProperty('width');
    root.style.removeProperty('height');
    root.style.removeProperty('top');
    root.style.setProperty('display', 'flex', 'important');
    root.style.setProperty('flex-direction', 'column', 'important');

    const header = root.querySelector('[data-endux-grid-section="header"]');
    const body = root.querySelector('[data-endux-grid-section="body"]');
    const chip = root.querySelector('[data-endux-grid-minimize-chip="1"]');
    const tabBar = root.querySelector('[data-endux-grid-tab-bar="1"]');
    const tabHost = root.querySelector('[data-endux-grid-tab-host="1"]');
    const extractPane = root.querySelector('[data-endux-grid-tab-pane="extract"]');
    const left = root.querySelector('[data-endux-grid-section="left"]');
    const right = root.querySelector('[data-endux-grid-section="right"]');

    if (header) {
	header.style.setProperty('display', 'flex', 'important');
	header.style.setProperty('align-items', 'center', 'important');
	header.style.setProperty('justify-content', 'space-between', 'important');
    }
    if (body) {
	body.style.setProperty('display', 'flex', 'important');
	body.style.setProperty('flex-direction', 'row', 'important');
	body.style.setProperty('flex', '1', 'important');
	body.style.setProperty('min-height', '0', 'important');
	body.style.setProperty('gap', '16px', 'important');
	body.style.setProperty('padding', '12px', 'important');
	body.style.setProperty('overflow', 'hidden', 'important');
    }
    if (tabBar) {
	tabBar.style.setProperty('display', 'flex', 'important');
	tabBar.style.setProperty('flex-direction', 'row', 'important');
	tabBar.style.setProperty('flex-shrink', '0', 'important');
    }
    if (tabHost) {
	tabHost.style.setProperty('display', 'flex', 'important');
	tabHost.style.setProperty('flex-direction', 'column', 'important');
	tabHost.style.setProperty('flex', '1', 'important');
	tabHost.style.setProperty('min-height', '0', 'important');
	tabHost.style.setProperty('min-width', '0', 'important');
	tabHost.style.setProperty('overflow', 'hidden', 'important');
	tabHost.style.setProperty('padding', '0', 'important');
    }
    if (extractPane) {
	extractPane.style.setProperty('flex', '1', 'important');
	extractPane.style.setProperty('min-height', '0', 'important');
	extractPane.style.setProperty('min-width', '0', 'important');
	extractPane.style.setProperty('gap', '10px', 'important');
	extractPane.style.setProperty('overflow', 'auto', 'important');
    }
    var subtablePaneRestore = root.querySelector('[data-endux-grid-tab-pane="subtable"]');
    if (subtablePaneRestore) {
	subtablePaneRestore.style.setProperty('flex', '1', 'important');
	subtablePaneRestore.style.setProperty('min-height', '0', 'important');
	subtablePaneRestore.style.setProperty('min-width', '0', 'important');
	subtablePaneRestore.style.setProperty('gap', '10px', 'important');
	subtablePaneRestore.style.setProperty('overflow', 'auto', 'important');
    }
    if (left) {
	left.style.setProperty('display', 'flex', 'important');
	left.style.setProperty('flex-direction', 'column', 'important');
	left.style.setProperty('flex', 'none', 'important');
	left.style.setProperty('min-height', '0', 'important');
	left.style.setProperty('overflow', 'hidden', 'important');
	left.style.setProperty('min-width', '180px', 'important');
	left.style.setProperty('max-width', 'none', 'important');
	left.style.setProperty('gap', '0', 'important');
    }
    var splitEl = root.querySelector('[data-endux-grid-splitter="1"]');
    if (splitEl) {
	splitEl.style.setProperty('flex-shrink', '0', 'important');
	splitEl.style.setProperty('cursor', 'col-resize', 'important');
	splitEl.style.setProperty('align-self', 'stretch', 'important');
    }
    if (right) {
	right.style.setProperty('display', 'flex', 'important');
	right.style.setProperty('flex-direction', 'column', 'important');
	right.style.setProperty('flex', '1', 'important');
	right.style.setProperty('min-width', '0', 'important');
	right.style.setProperty('gap', '8px', 'important');
	right.style.setProperty('overflow', 'auto', 'important');
    }
    const preview = root.querySelector('[data-grid-preview]');
    var selPathRestore = root.querySelector('[data-grid-selection-path]');
    if (selPathRestore) {
	selPathRestore.style.setProperty('flex-shrink', '0', 'important');
    }
    if (preview) {
	preview.style.setProperty('flex', '1', 'important');
	preview.style.setProperty('min-height', '0', 'important');
	preview.style.setProperty('overflow', 'auto', 'important');
    }
    if (chip) {
	chip.style.setProperty('display', 'none', 'important');
    }
    var hHandle = root.querySelector('[data-endux-grid-height-handle="1"]');
    if (hHandle && !root.hasAttribute('data-endux-grid-minimized')) {
	hHandle.style.setProperty('display', 'flex', 'important');
	hHandle.style.setProperty('flex-shrink', '0', 'important');
	hHandle.style.setProperty('cursor', 'ns-resize', 'important');
    }
    var crawlPaneRestore = root.querySelector('[data-endux-grid-tab-pane="crawler"]');
    if (crawlPaneRestore) {
	crawlPaneRestore.style.setProperty('flex', '1', 'important');
	crawlPaneRestore.style.setProperty('min-height', '0', 'important');
	crawlPaneRestore.style.setProperty('overflow', 'auto', 'important');
    }
    if (root.hasAttribute('data-endux-selector-picker-pass')) {
	root.style.setProperty('pointer-events', 'none', 'important');
	var pickerHead = root.querySelector('[data-endux-grid-section="header"]');
	if (pickerHead) pickerHead.style.setProperty('pointer-events', 'auto', 'important');
	var pickerChip = root.querySelector('[data-endux-grid-minimize-chip="1"]');
	if (pickerChip) pickerChip.style.setProperty('pointer-events', 'auto', 'important');
	if (!root.querySelector('[data-endux-picker-header-cancel="1"]')) {
	    _addSelectorPickerHeaderCancel();
	}
    }
    if (!root.hasAttribute('data-endux-grid-minimized')) {
	switchGridPanelTab(root.getAttribute('data-endux-grid-active-tab') || 'extract');
    }
}

function setGridPanelMinimized(minimized) {
    if (!_gridPanelRoot) return;
    const header = _gridPanelRoot.querySelector('[data-endux-grid-section="header"]');
    const body = _gridPanelRoot.querySelector('[data-endux-grid-section="body"]');
    const chip = _gridPanelRoot.querySelector('[data-endux-grid-minimize-chip="1"]');
    if (!header || !body || !chip) return;
	if (minimized) {
	stopGridPicker();
	stopSubtableExpandPicker();
	stopSubtableFieldPicker();
	Object.assign(_gridPanelRoot.style, {
	    position: 'fixed',
	    left: '12px',
	    bottom: '12px',
	    right: 'auto',
	    top: 'auto',
	    width: '52px',
	    height: '52px',
	    maxHeight: 'none',
	    borderRadius: '12px',
	    borderTop: '1px solid #e8d5c4',
	    boxShadow: '0 4px 18px rgba(0,0,0,0.22)',
	    display: 'flex',
	    flexDirection: 'column',
	    background: '#fff5eb',
	    overflow: 'hidden',
	    zIndex: '2147483646',
	    fontFamily: GRID_PANEL_EXPANDED_ROOT_STYLE.fontFamily
	});
	_gridPanelRoot.style.setProperty('display', 'flex', 'important');
	_gridPanelRoot.style.setProperty('flex-direction', 'column', 'important');
	header.style.setProperty('display', 'none', 'important');
	body.style.setProperty('display', 'none', 'important');
	var hH = _gridPanelRoot.querySelector('[data-endux-grid-height-handle="1"]');
	if (hH) hH.style.setProperty('display', 'none', 'important');
	chip.style.setProperty('display', 'flex', 'important');
	_gridPanelRoot.setAttribute('data-endux-grid-minimized', '1');
	saveGridPanelUiState('minimized');
    } else {
	Object.assign(_gridPanelRoot.style, GRID_PANEL_EXPANDED_ROOT_STYLE);
	_gridPanelRoot.removeAttribute('data-endux-grid-minimized');
	restoreGridPanelExpandedLayoutInDom();
	loadAndApplyGridPanelSplitWidth();
	loadAndApplyGridPanelHeightPx();
	updateGridPreviewUI();
	saveGridPanelUiState('visible');
    }
}

function isInsideEnduxGridPanel(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('#' + GRID_PANEL_ID);
}

/** UI wstrzyknięte przez rozszerzenie — nie wolno zapisywać takich elementów jako selektorów docelowych. */
function isInsideEnduxExtensionUi(el) {
    if (!el || !el.closest) return false;
    if (el.closest('#' + GRID_PANEL_ID)) return true;
    if (el.closest('[data-endux-panel="table"]')) return true;
    if (el.closest('#endux-picker-banner')) return true;
    if (el.closest('#' + ENDUX_SUBTABLE_EXPAND_BANNER_ID)) return true;
    if (el.closest('#' + ENDUX_SUBTABLE_FIELD_BANNER_ID)) return true;
    if (el.closest('#endux-toast')) return true;
    return false;
}

function countElementChildren(el) {
    let n = 0;
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
	n++;
    }
    return n;
}

function rowDirectCellTexts(rowEl) {
    const cells = [];
    for (let c = rowEl.firstElementChild; c; c = c.nextElementSibling) {
	cells.push(getPlainText(c));
    }
    return cells;
}

function rowMatchesTemplate(candidate, template) {
    if (!candidate || candidate.nodeType !== 1 || !template || template.nodeType !== 1) return false;
    if (candidate.tagName !== template.tagName) return false;
    const tr = template.getAttribute('role');
    const cr = candidate.getAttribute('role');
    // Wiersze siatki ARIA — tylko ta sama rola, bez liczenia dzieci (komórki różnią się zawartością).
    if (tr === 'row') {
	return cr === 'row';
    }
    if (tr === 'gridcell' || tr === 'cell' || tr === 'columnheader') {
	return cr === tr;
    }
    if (tr && cr && tr !== cr) return false;
    // MUI DataGrid: wiersz ma data-rowindex — bez role="row" liczenie dzieci bywa zawodne
    if (template.tagName === 'DIV' && candidate.tagName === 'DIV') {
	try {
	    if (template.hasAttribute('data-rowindex') && candidate.hasAttribute('data-rowindex')) {
		return true;
	    }
	} catch (e) {}
    }
    return countElementChildren(candidate) === countElementChildren(template);
}

function getSiblingRows(templateRow) {
    if (!templateRow || !templateRow.parentElement) return [];
    const parent = templateRow.parentElement;
    const out = [];
    const children = parent.children;
    for (let i = 0; i < children.length; i++) {
	const n = children[i];
	if (n.nodeType === 1 && rowMatchesTemplate(n, templateRow)) {
	    out.push(n);
	}
    }
    return out;
}

function padCellsToColumnCount(cells, colCount) {
    const out = cells.slice(0, colCount);
    while (out.length < colCount) {
	out.push('');
    }
    return out;
}

function computeGridExportBaseColumnCount() {
    let n = 0;
    if (_gridHeaderRowEl) {
	n = Math.max(n, rowDirectCellTexts(_gridHeaderRowEl).length);
    }
    getGridDataRowsOnly().forEach(function(row) {
	n = Math.max(n, rowDirectCellTexts(row).length);
    });
    if (n === 0 && _gridSelectedEl) {
	n = rowDirectCellTexts(_gridSelectedEl).length;
    }
    return n;
}

/** Liczba kolumn eksportu: siatka + dodatkowe kolumny pól podtabeli (gdy włączona podtabela). */
function computeGridExportColumnCount() {
    return computeGridExportBaseColumnCount() + enduxSubtableExportExtraColCount();
}

function buildTsvFromRows(rows, baseColCount) {
    var extra = enduxSubtableExportExtraColCount();
    return rows
	.map(function(row) {
	    var cells = padCellsToColumnCount(rowDirectCellTexts(row), baseColCount);
	    for (var i = 0; i < extra; i++) {
		cells.push(enduxEscapeTsvCell(enduxSubtableFieldTextForRow(row, _enduxSubtableExportFields[i])));
	    }
	    return cells.join('\t');
	})
	.join('\n');
}

/**
 * Jedna linia etykiet kolumn siatki: zapisany nagłówek + w pustych miejscach tekst z pierwszego wiersza danych
 * (np. pierwszy wiersz to „Athlete”, drugi wiersz DOM to # / Swim — oba w jednej linii eksportu).
 */
function enduxMergeExportedHeaderBaseCells(baseColCount) {
    var headerTexts =
	_gridHeaderRowEl && _gridHeaderRowEl.isConnected ? rowDirectCellTexts(_gridHeaderRowEl) : [];
    var dataRows = getGridDataRowsOnly();
    var firstTexts =
	dataRows.length && dataRows[0].isConnected ? rowDirectCellTexts(dataRows[0]) : [];
    var out = [];
    for (var i = 0; i < baseColCount; i++) {
	var h = i < headerTexts.length ? String(headerTexts[i] || '').trim() : '';
	var d = i < firstTexts.length ? String(firstTexts[i] || '').trim() : '';
	out.push(h || d);
    }
    return out;
}

/** Pierwszy wiersz danych jest duplikatem scalonego nagłówka (ten sam wiersz co nagłówki kolumn w DOM). */
function enduxShouldSkipFirstDataRowIfHeaderDuplicate(rows, baseColCount, mergedBaseCells) {
    if (!_gridHeaderRowEl || !rows.length) return false;
    var m = padCellsToColumnCount(mergedBaseCells, baseColCount);
    var r0 = padCellsToColumnCount(rowDirectCellTexts(rows[0]), baseColCount);
    for (var i = 0; i < baseColCount; i++) {
	if (String(r0[i] || '').trim() !== String(m[i] || '').trim()) return false;
    }
    return true;
}

/** Ile kolumn nagłówka było pustych i wzięło tekst z pierwszego wiersza danych (dwa wiersze nagłówka w DOM). */
function enduxMergeAbsorbedFirstDataRowCount(baseColCount) {
    if (!_gridHeaderRowEl || !getGridDataRowsOnly().length) return 0;
    var headerTexts = rowDirectCellTexts(_gridHeaderRowEl);
    var firstTexts = rowDirectCellTexts(getGridDataRowsOnly()[0]);
    var n = 0;
    for (var i = 0; i < baseColCount; i++) {
	var h = i < headerTexts.length ? String(headerTexts[i] || '').trim() : '';
	var d = i < firstTexts.length ? String(firstTexts[i] || '').trim() : '';
	if (!h && d) n++;
    }
    return n;
}

/** Czy zapisany wiersz nagłówka w DOM ma mało tekstu w stosunku do liczby kolumn (pierwszy wiersz to grupa, nie pełne etykiety). */
function enduxSavedHeaderRowIsSparse(baseColCount) {
    if (!_gridHeaderRowEl) return false;
    var h = rowDirectCellTexts(_gridHeaderRowEl);
    var n = 0;
    for (var i = 0; i < baseColCount && i < h.length; i++) {
	if (String(h[i] || '').trim()) n++;
    }
    return n < Math.max(2, Math.ceil(baseColCount / 3));
}

/**
 * Ukryj pierwszy wiersz danych w podglądzie / TSV: pełny duplikat scalonego nagłówka albo druga część nagłówka
 * (wiele pustych komórek w zapisanym wierszu wypełnionych z pierwszego wiersza danych).
 */
function enduxShouldHideFirstDataRowAfterMergedHeader(rows, baseColCount) {
    if (!rows.length || !_gridHeaderRowEl) return false;
    var merged = enduxMergeExportedHeaderBaseCells(baseColCount);
    if (enduxShouldSkipFirstDataRowIfHeaderDuplicate(rows, baseColCount, merged)) return true;
    var absorb = enduxMergeAbsorbedFirstDataRowCount(baseColCount);
    if (absorb >= 2) return true;
    if (absorb >= 1 && enduxSavedHeaderRowIsSparse(baseColCount)) return true;
    return false;
}

/** Wiersze do treści TSV / podglądu — bez pierwszego, jeśli to druga część nagłówka (MUI itd.). */
function enduxGridDataRowsForBodyExport(baseColCount) {
    var rows = getGridDataRowsOnly();
    if (!rows.length || !_gridHeaderRowEl) return rows;
    if (enduxShouldHideFirstDataRowAfterMergedHeader(rows, baseColCount)) {
	return rows.slice(1);
    }
    return rows;
}

/** Nagłówek TSV: scalone komórki siatki + nazwy pól podtabeli. */
function enduxBuildGridExportHeaderLineWithSubtable(baseColCount) {
    var cells = padCellsToColumnCount(enduxMergeExportedHeaderBaseCells(baseColCount), baseColCount);
    if (_enduxSubtableExportEnabled) {
	_enduxSubtableExportFields.forEach(function(f) {
	    cells.push(enduxEscapeTsvCell(f.name));
	});
    }
    return cells.join('\t');
}

/** Pierwszy wiersz tylko z nazwami pól podtabeli (puste komórki pod siatkę). */
function enduxBuildSyntheticSubtableHeaderLine(baseColCount) {
    var cells = padCellsToColumnCount([], baseColCount);
    if (_enduxSubtableExportEnabled) {
	_enduxSubtableExportFields.forEach(function(f) {
	    cells.push(enduxEscapeTsvCell(f.name));
	});
    }
    return cells.join('\t');
}

function clearGridHeaderVisual() {
    if (!_gridHeaderRowEl) return;
    const h = _gridHeaderRowEl;
    if (h._enduxGridHeaderOrigOutline !== undefined) {
	h.style.outline = h._enduxGridHeaderOrigOutline || '';
	h.style.outlineOffset = h._enduxGridHeaderOrigOutlineOffset || '';
	delete h._enduxGridHeaderOrigOutline;
	delete h._enduxGridHeaderOrigOutlineOffset;
    }
    _gridHeaderRowEl = null;
}

function clearGridSelectionOutline() {
    _gridSubtablePreviewRowEl = null;
    if (!_gridSelectedEl) return;
    const el = _gridSelectedEl;
    if (el !== _gridHeaderRowEl && el._enduxGridOrigOutline !== undefined) {
	el.style.outline = el._enduxGridOrigOutline || '';
	el.style.outlineOffset = el._enduxGridOrigOutlineOffset || '';
	delete el._enduxGridOrigOutline;
	delete el._enduxGridOrigOutlineOffset;
    }
    _gridSelectedEl = null;
}

function applyGridSelectionOutline(el) {
    const prev = _gridSelectedEl;
    if (prev && prev !== el) {
	if (prev !== _gridHeaderRowEl && prev._enduxGridOrigOutline !== undefined) {
	    prev.style.outline = prev._enduxGridOrigOutline || '';
	    prev.style.outlineOffset = prev._enduxGridOrigOutlineOffset || '';
	    delete prev._enduxGridOrigOutline;
	    delete prev._enduxGridOrigOutlineOffset;
	}
    }
    _gridSelectedEl = el;
    if (!el) return;
    if (el === _gridHeaderRowEl) {
	return;
    }
    el._enduxGridOrigOutline = el.style.outline;
    el._enduxGridOrigOutlineOffset = el.style.outlineOffset;
    el.style.outline = GRID_SELECTION_OUTLINE;
    el.style.outlineOffset = '2px';
    saveGridPanelSelectionState();
}

function setGridHeaderFromCurrentSelection() {
    if (!_gridSelectedEl) {
	showToast('Najpierw wskaż wiersz nagłówka (Wskaż element)', 'warning');
	return;
    }
    const el = _gridSelectedEl;
    if (_gridHeaderRowEl === el) {
	showToast('Ta linia jest już nagłówkiem', 'success');
	return;
    }
    if (_gridHeaderRowEl && _gridHeaderRowEl !== el) {
	clearGridHeaderVisual();
    }
    if (el._enduxGridOrigOutline !== undefined) {
	el.style.outline = el._enduxGridOrigOutline || '';
	el.style.outlineOffset = el._enduxGridOrigOutlineOffset || '';
	delete el._enduxGridOrigOutline;
	delete el._enduxGridOrigOutlineOffset;
    }
    el._enduxGridHeaderOrigOutline = el.style.outline;
    el._enduxGridHeaderOrigOutlineOffset = el.style.outlineOffset;
    el.style.outline = GRID_HEADER_OUTLINE;
    el.style.outlineOffset = '2px';
    _gridHeaderRowEl = el;
    var hdrCb = _gridPanelRoot && _gridPanelRoot.querySelector('[data-grid-include-header]');
    if (hdrCb && !hdrCb.checked) {
	hdrCb.checked = true;
	enduxSyncToggleForInput(hdrCb);
	chrome.storage.local.set({ includeHeaderPreference: true });
    }
    showToast('✓ Nagłówek zapisany — wskaż wiersz danych (Wskaż element)', 'success');
    updateGridPreviewUI();
}

function clearGridHeaderFromPanel() {
    if (!_gridHeaderRowEl) {
	showToast('Nie ustawiono nagłówka', 'warning');
	return;
    }
    const wasSel = _gridSelectedEl === _gridHeaderRowEl;
    const el = _gridHeaderRowEl;
    clearGridHeaderVisual();
    if (wasSel && el && document.contains(el)) {
	applyGridSelectionOutline(el);
    }
    showToast('Nagłówek usunięty', 'success');
    updateGridPreviewUI();
    saveGridPanelSelectionState();
}

function getGridDataRowsOnly() {
    if (!_gridSelectedEl) return [];
    const rows = getSiblingRows(_gridSelectedEl);
    if (!_gridHeaderRowEl) return rows;
    return rows.filter(function(r) { return r !== _gridHeaderRowEl; });
}

function isHtmlTableVisibleForGridAuto(table) {
    if (!table || table.nodeType !== 1) return false;
    try {
	if (isInsideEnduxGridPanel(table)) return false;
	const r = table.getBoundingClientRect();
	return r.width > 2 && r.height > 2;
    } catch (e) {
	return false;
    }
}

/** Jednokomórkowa tabela często owija całą treść strony — nie traktuj jej jako tabeli danych przy „Wskaż element”. */
function isLikelyPageLayoutWrapperTable(table) {
    if (!table || table.tagName !== 'TABLE') return false;
    try {
	if (table.rows.length !== 1) return false;
	var r = table.rows[0];
	if (r.cells.length !== 1) return false;
	var cell = r.cells[0];
	if (cell.querySelector('[role="grid"], [role="treegrid"]')) return true;
	if (cell.querySelector('main, #root, #__next, #app')) return true;
	return false;
    } catch (e) {
	return false;
    }
}

function scoreHtmlTableForAutoDetect(table) {
    try {
	var tr = table.querySelectorAll('tr').length;
	var cells = table.querySelectorAll('td, th').length;
	return tr * 100000 + cells;
    } catch (e) {
	return 0;
    }
}

function findBestHtmlTableForAutoDetect() {
    var tables = document.querySelectorAll('table');
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < tables.length; i++) {
	var t = tables[i];
	if (!isHtmlTableVisibleForGridAuto(t)) continue;
	var sc = scoreHtmlTableForAutoDetect(t);
	if (sc > bestScore) {
	    bestScore = sc;
	    best = t;
	}
    }
    return best;
}

function getTableHeaderAndDataTemplateTr(table) {
    if (!table || table.tagName !== 'TABLE') return null;
    var thead = table.querySelector('thead');
    var tbody = table.tBodies[0] || table.querySelector('tbody');
    var headerTr = null;
    var dataTr = null;
    if (thead) {
	var hr = thead.querySelector('tr');
	if (hr) headerTr = hr;
    }
    if (tbody && tbody.rows.length) {
	if (headerTr) {
	    dataTr = tbody.rows[0];
	} else if (tbody.rows.length >= 2) {
	    headerTr = tbody.rows[0];
	    dataTr = tbody.rows[1];
	} else {
	    dataTr = tbody.rows[0];
	}
    } else {
	var direct = [];
	for (var c = table.firstElementChild; c; c = c.nextElementSibling) {
	    if (c.tagName === 'TR') direct.push(c);
	}
	if (direct.length >= 2 && !headerTr) {
	    headerTr = direct[0];
	    dataTr = direct[1];
	} else if (direct.length === 1) {
	    dataTr = direct[0];
	} else {
	    return null;
	}
    }
    if (!dataTr) return null;
    return { headerTr: headerTr || null, dataTr: dataTr };
}

function installGridHeaderTrSilent(headerTr) {
    if (!headerTr) return;
    if (headerTr._enduxGridOrigOutline !== undefined) {
	headerTr.style.outline = headerTr._enduxGridOrigOutline || '';
	headerTr.style.outlineOffset = headerTr._enduxGridOrigOutlineOffset || '';
	delete headerTr._enduxGridOrigOutline;
	delete headerTr._enduxGridOrigOutlineOffset;
    }
    headerTr._enduxGridHeaderOrigOutline = headerTr.style.outline;
    headerTr._enduxGridHeaderOrigOutlineOffset = headerTr.style.outlineOffset;
    headerTr.style.outline = GRID_HEADER_OUTLINE;
    headerTr.style.outlineOffset = '2px';
    _gridHeaderRowEl = headerTr;
}

function installGridTableSelection(headerTr, dataTr) {
    if (!dataTr) return false;
    clearGridSelectionOutline();
    clearGridHeaderVisual();
    _gridUndoStack = [];
    if (headerTr && headerTr !== dataTr) {
	installGridHeaderTrSilent(headerTr);
    } else {
	_gridHeaderRowEl = null;
    }
    applyGridSelectionOutline(dataTr);
    updateGridCopyButtonLabel();
    return true;
}

function tryAutoDetectHtmlTableInGridPanel() {
    if (!_gridPanelRoot) return;
    var table = findBestHtmlTableForAutoDetect();
    if (!table) return;
    var pair = getTableHeaderAndDataTemplateTr(table);
    if (!pair || !pair.dataTr) return;
    installGridTableSelection(pair.headerTr || null, pair.dataTr);
    updateGridPreviewUI();
}

/** Ustawia podgląd w panelu na tę samą tabelę HTML, z której korzysta Auto-Crawler. */
function syncGridPanelPreviewFromCrawlerTable(table) {
    if (!_gridPanelRoot || !table || table.tagName !== 'TABLE') return;
    if (!table.isConnected) return;
    var pair = getTableHeaderAndDataTemplateTr(table);
    if (!pair || !pair.dataTr) return;
    installGridTableSelection(pair.headerTr || null, pair.dataTr);
    updateGridPreviewUI();
}

function applyHtmlTablePickFromTarget(target) {
    if (!target || !target.closest) return false;

    // Siatka na divach (np. MUI): closest('table') to często tabela układu nad gridem — nie przejmuj kliknięcia.
    var ariaGrid = target.closest('[role="grid"], [role="treegrid"]');
    if (ariaGrid && ariaGrid.tagName !== 'TABLE') {
	var tblScoped = target.closest('table');
	if (!tblScoped || !ariaGrid.contains(tblScoped)) {
	    return false;
	}
    }

    // Wiersz div[role="row"] poza thead/tbody/tfoot — wybór jak dla zwykłego diva (Rozwiń / Cofnij).
    var divRow = target.closest('div[role="row"]');
    if (divRow && divRow.tagName === 'DIV') {
	var inHtmlRowPart = divRow.closest('thead') || divRow.closest('tbody') || divRow.closest('tfoot');
	if (!inHtmlRowPart) {
	    return false;
	}
    }

    var table = target.closest('table');
    if (table && isLikelyPageLayoutWrapperTable(table)) {
	return false;
    }
    if (!table || !isHtmlTableVisibleForGridAuto(table)) return false;

    if (target.tagName === 'TABLE') {
	var pair0 = getTableHeaderAndDataTemplateTr(table);
	if (!pair0 || !pair0.dataTr) return false;
	installGridTableSelection(pair0.headerTr || null, pair0.dataTr);
	updateGridPreviewUI();
	showToast('Tabela HTML — ustawiono nagłówek i wiersze', 'success');
	return true;
    }

    var tr = target.closest('tr');
    if (!tr || !table.contains(tr)) return false;

    var thead = table.querySelector('thead');
    var tbody = table.tBodies[0] || table.querySelector('tbody');

    if (thead && thead.contains(tr)) {
	if (!tbody || !tbody.rows.length) return false;
	installGridTableSelection(tr, tbody.rows[0]);
	updateGridPreviewUI();
	showToast('Tabela HTML — nagłówek i pierwszy wiersz danych', 'success');
	return true;
    }

    if (tbody && tbody.contains(tr)) {
	var headerTr = null;
	if (thead && thead.querySelector('tr')) {
	    headerTr = thead.querySelector('tr');
	} else if (tbody.rows.length >= 2) {
	    headerTr = tbody.rows[0];
	}
	var dataTr = tr;
	if (headerTr && headerTr === tr && tbody.rows.length >= 2) {
	    dataTr = tbody.rows[1];
	}
	installGridTableSelection(headerTr, dataTr);
	updateGridPreviewUI();
	showToast('Tabela HTML — dopasowano nagłówek', 'success');
	return true;
    }

    var pair1 = getTableHeaderAndDataTemplateTr(table);
    if (!pair1 || !pair1.dataTr) return false;
    installGridTableSelection(pair1.headerTr || null, pair1.dataTr);
    updateGridPreviewUI();
    showToast('Tabela HTML — ustawiono podgląd', 'success');
    return true;
}

function stopGridPicker() {
    _gridPickerActive = false;
    document.body.style.cursor = '';
    if (_gridPickerHoverEl) {
	_gridPickerHoverEl.style.outline = _gridPickerHoverEl._enduxGridHoverOrigOutline || '';
	_gridPickerHoverEl.style.cursor = _gridPickerHoverEl._enduxGridHoverOrigCursor || '';
	_gridPickerHoverEl = null;
    }
    document.removeEventListener('mouseover', _gridPickerMouseOver, true);
    document.removeEventListener('mouseout', _gridPickerMouseOut, true);
    document.removeEventListener('click', _gridPickerClick, true);
    document.removeEventListener('keydown', _gridPickerKeyDown, true);
}

function _gridPickerMouseOver(e) {
    if (!_gridPickerActive) return;
    const t = e.target;
    if (!t || t.nodeType !== 1) return;
    if (isInsideEnduxExtensionUi(t)) return;
    const nearG = _nearestClickable(t);
    if (isInsideEnduxExtensionUi(nearG)) return;
    if (_gridPickerHoverEl && _gridPickerHoverEl !== t) {
	_gridPickerHoverEl.style.outline = _gridPickerHoverEl._enduxGridHoverOrigOutline || '';
	_gridPickerHoverEl.style.cursor = _gridPickerHoverEl._enduxGridHoverOrigCursor || '';
    }
    _gridPickerHoverEl = t;
    _gridPickerHoverEl._enduxGridHoverOrigOutline = _gridPickerHoverEl.style.outline;
    _gridPickerHoverEl._enduxGridHoverOrigCursor = _gridPickerHoverEl.style.cursor;
    _gridPickerHoverEl.style.outline = '2px dashed #2563eb';
    _gridPickerHoverEl.style.cursor = 'crosshair';
}

function _gridPickerMouseOut(e) {
    if (!_gridPickerActive || !_gridPickerHoverEl) return;
    const rel = e.relatedTarget;
    if (rel && rel.nodeType === 1 && isInsideEnduxExtensionUi(rel)) return;
    _gridPickerHoverEl.style.outline = _gridPickerHoverEl._enduxGridHoverOrigOutline || '';
    _gridPickerHoverEl.style.cursor = _gridPickerHoverEl._enduxGridHoverOrigCursor || '';
    _gridPickerHoverEl = null;
}

function _gridPickerClick(e) {
    if (!_gridPickerActive) return;
    const t = e.target;
    if (!t || t.nodeType !== 1) return;
    if (isInsideEnduxExtensionUi(t)) return;
    const nearG = _nearestClickable(t);
    if (isInsideEnduxExtensionUi(nearG)) {
	showToast('Wybierz element na stronie, nie w panelu EnduX', 'warning');
	return;
    }
    e.preventDefault();
    e.stopPropagation();
    stopGridPicker();
    _gridUndoStack = [];
    if (applyHtmlTablePickFromTarget(t)) {
	return;
    }
    applyGridSelectionOutline(t);
    updateGridPreviewUI();
}

function _gridPickerKeyDown(e) {
    if (e.key === 'Escape') {
	stopGridPicker();
	showToast('Wybieranie anulowane', 'warning');
    }
}

function startGridPicker() {
    if (_gridPickerActive) stopGridPicker();
    stopSubtableExpandPicker();
    stopSubtableFieldPicker();
    _gridPickerActive = true;
    document.body.style.cursor = 'crosshair';
    document.addEventListener('mouseover', _gridPickerMouseOver, true);
    document.addEventListener('mouseout', _gridPickerMouseOut, true);
    document.addEventListener('click', _gridPickerClick, true);
    document.addEventListener('keydown', _gridPickerKeyDown, true);
}

function stopSubtableExpandPicker() {
    if (!_subtableExpandPickerActive) return;
    _subtableExpandPickerActive = false;
    document.body.style.cursor = '';
    _applySelectorPickerPanelPassThrough(false);
    if (_subtableExpandPickerBanner) {
	_subtableExpandPickerBanner.remove();
	_subtableExpandPickerBanner = null;
    }
    if (_subtableExpandPickerHoverEl) {
	_subtableExpandPickerHoverEl.style.outline = _subtableExpandPickerHoverEl._enduxSubHoverOrigOutline || '';
	_subtableExpandPickerHoverEl.style.cursor = _subtableExpandPickerHoverEl._enduxSubHoverOrigCursor || '';
	_subtableExpandPickerHoverEl = null;
    }
    document.removeEventListener('mouseover', _subtableExpandPickerMouseOver, true);
    document.removeEventListener('mouseout', _subtableExpandPickerMouseOut, true);
    document.removeEventListener('click', _subtableExpandPickerClick, true);
    document.removeEventListener('keydown', _subtableExpandPickerKeyDown, true);
}

function _subtableExpandPickerMouseOver(e) {
    if (!_subtableExpandPickerActive) return;
    const t = e.target;
    if (!t || t.nodeType !== 1) return;
    if (isInsideEnduxExtensionUi(t)) return;
    const nearS = _nearestClickable(t);
    if (isInsideEnduxExtensionUi(nearS)) return;
    if (_subtableExpandPickerHoverEl && _subtableExpandPickerHoverEl !== nearS) {
	_subtableExpandPickerHoverEl.style.outline = _subtableExpandPickerHoverEl._enduxSubHoverOrigOutline || '';
	_subtableExpandPickerHoverEl.style.cursor = _subtableExpandPickerHoverEl._enduxSubHoverOrigCursor || '';
    }
    _subtableExpandPickerHoverEl = nearS;
    _subtableExpandPickerHoverEl._enduxSubHoverOrigOutline = _subtableExpandPickerHoverEl.style.outline;
    _subtableExpandPickerHoverEl._enduxSubHoverOrigCursor = _subtableExpandPickerHoverEl.style.cursor;
    _subtableExpandPickerHoverEl.style.outline = '2px dashed #0d9488';
    _subtableExpandPickerHoverEl.style.cursor = 'crosshair';
}

function _subtableExpandPickerMouseOut(e) {
    if (!_subtableExpandPickerActive || !_subtableExpandPickerHoverEl) return;
    const rel = e.relatedTarget;
    if (rel && rel.nodeType === 1 && isInsideEnduxExtensionUi(rel)) return;
    _subtableExpandPickerHoverEl.style.outline = _subtableExpandPickerHoverEl._enduxSubHoverOrigOutline || '';
    _subtableExpandPickerHoverEl.style.cursor = _subtableExpandPickerHoverEl._enduxSubHoverOrigCursor || '';
    _subtableExpandPickerHoverEl = null;
}

function _subtableExpandPickerClick(e) {
    if (!_subtableExpandPickerActive) return;
    var leaf = enduxSubtablePickLeafFromPointerEvent(e);
    if (!leaf || leaf.nodeType !== 1) return;
    if (isInsideEnduxExtensionUi(leaf)) return;
    e.preventDefault();
    e.stopPropagation();
    const rows = getGridDataRowsOnly();
    if (!rows.length) {
	showToast('Brak wierszy danych — w zakładce „Ekstrakcja wyników” wskaż najpierw wiersz szablonu', 'warning');
	return;
    }
    var hostRow = enduxSubtableFindHostRowForPick(e, rows);
    if (!hostRow) {
	showToast('Kliknij element wewnątrz wiersza danych siatki (krzyżyk nadal aktywny — spróbuj ponownie)', 'warning');
	return;
    }
    const rel = enduxBuildRelativeSelectorFromAncestor(hostRow, leaf);
    if (!rel) {
	showToast('Nie udało się zbudować ścieżki względnej od wiersza', 'error');
	return;
    }
    stopSubtableExpandPicker();
    chrome.storage.local.set({ gridSubtableExpandRelative: rel }, function() {
	if (chrome.runtime.lastError) return;
	showToast('Podtabela: rozwinięcie zapisane (względem wiersza)', 'success');
	enduxRefreshSubtableTabDisplays();
    });
}

function _subtableExpandPickerKeyDown(e) {
    if (e.key === 'Escape') {
	stopSubtableExpandPicker();
	showToast('Wybieranie anulowane', 'warning');
    }
}

function startSubtableExpandPicker() {
    if (_subtableExpandPickerActive) stopSubtableExpandPicker();
    stopSubtableFieldPicker();
    if (_gridPickerActive) stopGridPicker();
    if (_pickerActive) stopSelectorPicker();
    document.body.style.cursor = 'crosshair';

    _subtableExpandPickerBanner = document.createElement('div');
    _subtableExpandPickerBanner.id = ENDUX_SUBTABLE_EXPAND_BANNER_ID;
    Object.assign(_subtableExpandPickerBanner.style, {
	position: 'fixed',
	top: '0',
	left: '0',
	right: '0',
	zIndex: '2147483647',
	background: '#007bff',
	color: '#fff',
	padding: '8px 16px',
	fontSize: '14px',
	fontWeight: '600',
	fontFamily: 'sans-serif',
	boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
	pointerEvents: 'auto',
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	flexWrap: 'wrap',
	gap: '10px 14px',
	boxSizing: 'border-box'
    });
    var msg = document.createElement('span');
    msg.textContent =
	'🎯 Klik rozwijający: wskaż element w obrębie wiersza danych siatki (najpierw szablon wiersza w „Ekstrakcja wyników”). Kursor krzyżyk — dolny panel nie blokuje strony; nagłówek panelu: Anuluj lub Esc.';
    msg.style.lineHeight = '1.35';
    var escHint = document.createElement('span');
    escHint.textContent = 'Esc — anuluj';
    escHint.style.opacity = '0.92';
    escHint.style.fontSize = '13px';
    escHint.style.fontWeight = '500';
    var cancelTop = document.createElement('button');
    cancelTop.type = 'button';
    cancelTop.textContent = 'Anuluj wybór';
    Object.assign(cancelTop.style, {
	padding: '6px 14px',
	borderRadius: '6px',
	border: 'none',
	background: '#fff',
	color: '#007bff',
	fontWeight: '700',
	cursor: 'pointer',
	fontSize: '13px',
	fontFamily: 'inherit'
    });
    cancelTop.addEventListener('click', function(ev) {
	ev.stopPropagation();
	stopSubtableExpandPicker();
	showToast('Wybieranie anulowane', 'warning');
    });
    _subtableExpandPickerBanner.appendChild(msg);
    _subtableExpandPickerBanner.appendChild(escHint);
    _subtableExpandPickerBanner.appendChild(cancelTop);
    document.body.appendChild(_subtableExpandPickerBanner);

    _applySelectorPickerPanelPassThrough(true);

    _subtableExpandPickerActive = true;
    document.addEventListener('mouseover', _subtableExpandPickerMouseOver, true);
    document.addEventListener('mouseout', _subtableExpandPickerMouseOut, true);
    document.addEventListener('click', _subtableExpandPickerClick, true);
    document.addEventListener('keydown', _subtableExpandPickerKeyDown, true);
}

function enduxNormalizeSubtableFields(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.relativeSelector) {
	return enduxNormalizeSubtableFields([raw]);
    }
    if (!Array.isArray(raw)) return [];
    return raw
	.filter(function(f) {
	    return f && typeof f.relativeSelector === 'string' && f.relativeSelector.trim();
	})
	.map(function(f, idx) {
	    return {
		id: typeof f.id === 'string' && f.id ? f.id : 'sf_' + Math.random().toString(36).substr(2, 10),
		name:
		    typeof f.name === 'string' && f.name.trim()
			? f.name.trim()
			: 'Pole ' + (idx + 1),
		relativeSelector: String(f.relativeSelector).trim(),
		scope: f.scope === 'document' ? 'document' : 'row',
		rowRelativeSelector:
		    typeof f.rowRelativeSelector === 'string' && f.rowRelativeSelector.trim()
			? String(f.rowRelativeSelector).trim()
			: ''
	    };
	})
	.slice(0, 24);
}

/** Selektor dokumentu dla pola zapisanego względem body (ścieżka z buildera bez węzła body). */
function enduxSubtableFieldDocumentCss(rel) {
    if (!rel || typeof rel !== 'string') return '';
    return 'body > ' + rel;
}

function enduxInvalidateSubtablePreviewRowIfStale() {
    var rows = getGridDataRowsOnly();
    if (!_gridSubtablePreviewRowEl || !rows.length) {
	if (!rows.length) _gridSubtablePreviewRowEl = null;
	return;
    }
    var ok = false;
    for (var i = 0; i < rows.length; i++) {
	if (rows[i] === _gridSubtablePreviewRowEl && rows[i].isConnected) {
	    ok = true;
	    break;
	}
    }
    if (!ok) _gridSubtablePreviewRowEl = null;
}

/** Wiersz danych używany do podglądu wartości pól (klik w siatce na stronie lub domyślnie wiersz szablonu). */
function enduxResolveSubtablePreviewContextRow() {
    enduxInvalidateSubtablePreviewRowIfStale();
    var rows = getGridDataRowsOnly();
    if (!rows.length) return null;
    if (_gridSubtablePreviewRowEl) return _gridSubtablePreviewRowEl;
    if (_gridSelectedEl) {
	for (var j = 0; j < rows.length; j++) {
	    if (rows[j] === _gridSelectedEl) return rows[j];
	}
    }
    return rows[0];
}

/** Tekst ścieżki do elementu docelowego (pod podglądem pola). */
function enduxSubtableFieldPathDisplay(field) {
    if (!field || typeof field !== 'object') return '';
    var rr = field.rowRelativeSelector && String(field.rowRelativeSelector).trim();
    var rel = typeof field.relativeSelector === 'string' ? field.relativeSelector.trim() : '';
    if (field.scope === 'row' && rel) {
	return 'wiersz siatki → ' + rel;
    }
    if (rr) {
	return 'wiersz siatki → ' + rr;
    }
    if (!rel) return '—';
    return 'dokument: ' + enduxSubtableFieldDocumentCss(rel);
}

function enduxClearSubtableFieldHoverHighlight() {
    if (_enduxSubtableFieldHighlightEl && _enduxSubtableFieldHighlightEl.nodeType === 1) {
	if (_enduxSubtableFieldHighlightStyle) {
	    _enduxSubtableFieldHighlightEl.style.outline = _enduxSubtableFieldHighlightStyle.outline || '';
	    _enduxSubtableFieldHighlightEl.style.outlineOffset = _enduxSubtableFieldHighlightStyle.outlineOffset || '';
	}
    }
    _enduxSubtableFieldHighlightEl = null;
    _enduxSubtableFieldHighlightStyle = null;
}

function enduxApplySubtableFieldHoverHighlight(field, contextRowEl) {
    enduxClearSubtableFieldHoverHighlight();
    if (!field || !contextRowEl) return;
    var el = enduxSubtableFieldElementForRow(contextRowEl, field);
    if (!el || !el.isConnected) return;
    _enduxSubtableFieldHighlightEl = el;
    _enduxSubtableFieldHighlightStyle = {
	outline: el.style.outline,
	outlineOffset: el.style.outlineOffset
    };
    el.style.outline = '2px dashed #7c3aed';
    el.style.outlineOffset = '2px';
}

function _gridSubtablePreviewRowClick(e) {
    if (!_gridPanelRoot) return;
    if ((_gridPanelRoot.getAttribute('data-endux-grid-active-tab') || 'extract') !== 'subtable') return;
    if (!e.target || e.target.nodeType !== 1) return;
    if (isInsideEnduxExtensionUi(e.target)) return;
    var rows = getGridDataRowsOnly();
    if (!rows.length) return;
    var t = e.target;
    var depth = 0;
    while (t && t.nodeType === 1 && depth < 80) {
	for (var i = 0; i < rows.length; i++) {
	    if (rows[i] === t) {
		if (_gridSubtablePreviewRowEl !== rows[i]) {
		    _gridSubtablePreviewRowEl = rows[i];
		    updateGridPreviewUI();
		}
		return;
	    }
	}
	t = t.parentElement;
	depth++;
    }
}

function enduxBindSubtablePreviewRowListener() {
    if (_gridSubtablePreviewRowListenerBound) return;
    _gridSubtablePreviewRowListenerBound = true;
    document.addEventListener('click', _gridSubtablePreviewRowClick, false);
}

function enduxUnbindSubtablePreviewRowListener() {
    if (!_gridSubtablePreviewRowListenerBound) return;
    _gridSubtablePreviewRowListenerBound = false;
    document.removeEventListener('click', _gridSubtablePreviewRowClick, false);
}

/** Podgląd wartości dla bieżącego wiersza kontekstu (klik w siatce w Podtabeli). */
function enduxSubtableFieldSampleValue(field) {
    var ctx = enduxResolveSubtablePreviewContextRow();
    if (!ctx) return '—';
    var el = null;
    try {
	el = enduxSubtableFieldElementForRow(ctx, field);
    } catch (err) {
	return '(błąd selektora)';
    }
    if (!el) return '(brak w wierszu)';
    var txt = getPlainText(el);
    return txt.length ? txt : '(pusty)';
}

function enduxRenderSubtableFieldsTableInPreview(previewWrap, fields) {
    if (!previewWrap) return;
    enduxClearSubtableFieldHoverHighlight();
    previewWrap.innerHTML = '';
    var table = document.createElement('table');
    table.style.borderCollapse = 'collapse';
    table.style.width = '100%';
    table.style.fontSize = '12px';
    var thead = document.createElement('thead');
    var trh = document.createElement('tr');
    ['Nazwa pola', ''].forEach(function(h, idx) {
	var th = document.createElement('th');
	if (idx === 0) th.textContent = h;
	th.style.border = '1px solid #d4c4b8';
	th.style.padding = '4px 6px';
	th.style.fontWeight = '700';
	th.style.background = '#dcfce7';
	th.style.textAlign = idx === 1 ? 'center' : 'left';
	if (idx === 1) th.style.width = '44px';
	trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    if (!fields.length) {
	var tr0 = document.createElement('tr');
	var td0 = document.createElement('td');
	td0.colSpan = 2;
	td0.textContent =
	    'Brak pól — „Wskaż pole” i klik w dowolny element na stronie (tekst jak z komórki). Opcjonalnie najpierw wiersz w Ekstrakcji — wtedy ścieżka jest względem wiersza.';
	td0.style.border = '1px solid #d4c4b8';
	td0.style.padding = '8px';
	td0.style.color = '#64748b';
	td0.style.lineHeight = '1.4';
	tr0.appendChild(td0);
	tbody.appendChild(tr0);
    }
    fields.forEach(function(f) {
	var tr = document.createElement('tr');
	tr.setAttribute('data-endux-subtable-field-row', f.id);
	var tdName = document.createElement('td');
	var inp = document.createElement('input');
	inp.type = 'text';
	inp.value = f.name;
	inp.setAttribute('data-subtable-field-id', f.id);
	Object.assign(inp.style, {
	    boxSizing: 'border-box',
	    border: '1px solid #cbd5e1',
	    borderRadius: '4px',
	    padding: '4px 6px',
	    fontSize: '12px',
	    fontFamily: 'inherit'
	});
	inp.addEventListener('change', function() {
	    chrome.storage.local.get(['gridSubtableFields'], function(res) {
		if (chrome.runtime.lastError) return;
		var list = enduxNormalizeSubtableFields(res.gridSubtableFields || []);
		for (var i = 0; i < list.length; i++) {
		    if (list[i].id === f.id) {
			list[i].name = (inp.value || '').trim() || list[i].name;
			break;
		    }
		}
		chrome.storage.local.set({ gridSubtableFields: list });
	    });
	});
	var nameRow = document.createElement('div');
	nameRow.style.display = 'flex';
	nameRow.style.alignItems = 'center';
	nameRow.style.gap = '6px';
	nameRow.style.minWidth = '0';
	var infoMark = document.createElement('span');
	infoMark.textContent = 'i';
	infoMark.setAttribute('aria-hidden', 'true');
	infoMark.title = 'Wartość odczytana ze ścieżki do tego pola';
	Object.assign(infoMark.style, {
	    flex: '0 0 auto',
	    width: '18px',
	    height: '18px',
	    borderRadius: '50%',
	    border: '1px solid #94a3b8',
	    background: '#e2e8f0',
	    color: '#475569',
	    fontSize: '11px',
	    fontWeight: '700',
	    fontFamily: 'Georgia, "Times New Roman", serif',
	    display: 'inline-flex',
	    alignItems: 'center',
	    justifyContent: 'center',
	    lineHeight: '1',
	    userSelect: 'none',
	    flexShrink: '0'
	});
	var valInline = document.createElement('span');
	valInline.setAttribute('data-endux-subtable-inline-value', '1');
	var sampleVal = '';
	try {
	    sampleVal = enduxSubtableFieldSampleValue(f);
	} catch (err) {
	    sampleVal = '(błąd odczytu)';
	}
	valInline.textContent = sampleVal;
	valInline.title = sampleVal;
	Object.assign(valInline.style, {
	    flex: '1 1 40%',
	    minWidth: '0',
	    fontSize: '12px',
	    color: '#334155',
	    lineHeight: '1.35',
	    overflow: 'hidden',
	    textOverflow: 'ellipsis',
	    whiteSpace: 'nowrap'
	});
	inp.style.flex = '1';
	inp.style.minWidth = '0';
	nameRow.appendChild(inp);
	nameRow.appendChild(infoMark);
	nameRow.appendChild(valInline);
	tdName.appendChild(nameRow);
	if (_enduxSubtableDebugConfirm) {
	    var pathLine = document.createElement('textarea');
	    pathLine.readOnly = true;
	    pathLine.setAttribute('data-subtable-path-readonly', '1');
	    pathLine.setAttribute('data-endux-subtable-field-path', '1');
	    pathLine.setAttribute('aria-label', 'Ścieżka selektora — można zaznaczyć i skopiować');
	    pathLine.value = enduxSubtableFieldPathDisplay(f);
	    pathLine.rows = 3;
	    pathLine.wrap = 'soft';
	    Object.assign(pathLine.style, {
		marginTop: '6px',
		width: '100%',
		maxWidth: '100%',
		boxSizing: 'border-box',
		fontSize: '10px',
		lineHeight: '1.45',
		color: '#64748b',
		fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
		border: '1px solid #e2e8f0',
		borderRadius: '4px',
		padding: '4px 6px',
		resize: 'vertical',
		cursor: 'text',
		background: '#f8fafc',
		userSelect: 'text'
	    });
	    pathLine.addEventListener('click', function(ev) {
		ev.stopPropagation();
	    });
	    pathLine.addEventListener('mousedown', function(ev) {
		ev.stopPropagation();
	    });
	    tdName.appendChild(pathLine);
	}
	tdName.style.border = '1px solid #d4c4b8';
	tdName.style.padding = '4px 6px';
	tr.addEventListener('mouseenter', function() {
	    enduxApplySubtableFieldHoverHighlight(f, enduxResolveSubtablePreviewContextRow());
	});
	tr.addEventListener('mouseleave', function(ev) {
	    if (tr.contains(ev.relatedTarget)) return;
	    enduxClearSubtableFieldHoverHighlight();
	});
	var tdAct = document.createElement('td');
	tdAct.style.border = '1px solid #d4c4b8';
	tdAct.style.padding = '4px';
	tdAct.style.textAlign = 'center';
	var del = document.createElement('button');
	del.type = 'button';
	del.innerHTML = '🗑️';
	del.title = 'Usuń pole';
	del.setAttribute('aria-label', 'Usuń pole');
	Object.assign(del.style, {
	    border: 'none',
	    background: 'transparent',
	    cursor: 'pointer',
	    color: '#b91c1c',
	    fontSize: '16px',
	    padding: '2px 6px',
	    lineHeight: '1',
	    fontFamily: 'inherit'
	});
	del.addEventListener('click', function(ev) {
	    ev.preventDefault();
	    ev.stopPropagation();
	    chrome.storage.local.get(['gridSubtableFields'], function(res) {
		if (chrome.runtime.lastError) return;
		var list = enduxNormalizeSubtableFields(res.gridSubtableFields || []).filter(function(x) {
		    return x.id !== f.id;
		});
		chrome.storage.local.set({ gridSubtableFields: list }, function() {
		    if (chrome.runtime.lastError) return;
		    updateGridPreviewUI();
		});
	    });
	});
	tdAct.appendChild(del);
	tr.appendChild(tdName);
	tr.appendChild(tdAct);
	tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    previewWrap.appendChild(table);
}

function stopSubtableFieldPicker() {
    if (!_subtableFieldPickerActive) return;
    _subtableFieldPickerActive = false;
    document.body.style.cursor = '';
    _applySelectorPickerPanelPassThrough(false);
    if (_subtableFieldPickerBanner) {
	_subtableFieldPickerBanner.remove();
	_subtableFieldPickerBanner = null;
    }
    if (_subtableFieldPickerHoverEl) {
	_subtableFieldPickerHoverEl.style.outline = _subtableFieldPickerHoverEl._enduxFieldHoverOrigOutline || '';
	_subtableFieldPickerHoverEl.style.cursor = _subtableFieldPickerHoverEl._enduxFieldHoverOrigCursor || '';
	_subtableFieldPickerHoverEl = null;
    }
    document.removeEventListener('mouseover', _subtableFieldPickerMouseOver, true);
    document.removeEventListener('mouseout', _subtableFieldPickerMouseOut, true);
    document.removeEventListener('click', _subtableFieldPickerClick, true);
    document.removeEventListener('keydown', _subtableFieldPickerKeyDown, true);
}

function _subtableFieldPickerMouseOver(e) {
    if (!_subtableFieldPickerActive) return;
    const t = e.target;
    if (!t || t.nodeType !== 1) return;
    if (isInsideEnduxExtensionUi(t)) return;
    const nearF = _nearestClickable(t);
    if (isInsideEnduxExtensionUi(nearF)) return;
    if (_subtableFieldPickerHoverEl && _subtableFieldPickerHoverEl !== nearF) {
	_subtableFieldPickerHoverEl.style.outline = _subtableFieldPickerHoverEl._enduxFieldHoverOrigOutline || '';
	_subtableFieldPickerHoverEl.style.cursor = _subtableFieldPickerHoverEl._enduxFieldHoverOrigCursor || '';
    }
    _subtableFieldPickerHoverEl = nearF;
    _subtableFieldPickerHoverEl._enduxFieldHoverOrigOutline = _subtableFieldPickerHoverEl.style.outline;
    _subtableFieldPickerHoverEl._enduxFieldHoverOrigCursor = _subtableFieldPickerHoverEl.style.cursor;
    _subtableFieldPickerHoverEl.style.outline = '2px dashed #7c3aed';
    _subtableFieldPickerHoverEl.style.cursor = 'crosshair';
}

function _subtableFieldPickerMouseOut(e) {
    if (!_subtableFieldPickerActive || !_subtableFieldPickerHoverEl) return;
    const rel = e.relatedTarget;
    if (rel && rel.nodeType === 1 && isInsideEnduxExtensionUi(rel)) return;
    _subtableFieldPickerHoverEl.style.outline = _subtableFieldPickerHoverEl._enduxFieldHoverOrigOutline || '';
    _subtableFieldPickerHoverEl.style.cursor = _subtableFieldPickerHoverEl._enduxFieldHoverOrigCursor || '';
    _subtableFieldPickerHoverEl = null;
}

function enduxSubtablePickLeafFromPointerEvent(e) {
    var t = e && e.target;
    if (t && t.nodeType === 1) return t;
    if (t && t.nodeType === 3 && t.parentElement) return t.parentElement;
    var path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    for (var i = 0; i < path.length; i++) {
	if (path[i] && path[i].nodeType === 1) return path[i];
    }
    return null;
}

function enduxSubtableFindHostRowForPick(e, rows) {
    var leaf = enduxSubtablePickLeafFromPointerEvent(e);
    if (!leaf || leaf.nodeType !== 1) return null;
    return enduxSubtableFindGridRowForSubtablePick(leaf, rows, e);
}

function _subtableFieldPickerClick(e) {
    if (!_subtableFieldPickerActive) return;
    var leaf = enduxSubtablePickLeafFromPointerEvent(e);
    if (!leaf || leaf.nodeType !== 1) return;
    if (isInsideEnduxExtensionUi(leaf)) return;
    e.preventDefault();
    e.stopPropagation();
    const rows = getGridDataRowsOnly();
    var hostRow = enduxSubtableFindHostRowForPick(e, rows);
    var scope = hostRow ? 'row' : 'document';
    if (!hostRow) {
	/* Brak dopasowania do wiersza (portal, shadow, wirtualizacja) — ścieżka od body, jak bez wiersza siatki. */
	hostRow = document.body;
	if (leaf === hostRow || leaf === document.documentElement) {
	    showToast('Wskaż konkretny element na stronie (np. komórkę lub etykietę)', 'warning');
	    return;
	}
    }
    if (leaf === hostRow) {
	showToast(
	    scope === 'document'
		? 'Wskaż element wewnątrz strony, nie sam kontener'
		: 'Wskaż element wewnątrz wiersza, nie sam wiersz',
	    'warning'
	);
	return;
    }
    var relFromHost = enduxBuildRelativeSelectorFromAncestor(hostRow, leaf);
    if (!relFromHost) {
	showToast(
	    'Nie udało się zbudować ścieżki względnej — spróbuj elementu w widocznym drzewie komórki (bez zamkniętego Shadow DOM)',
	    'error'
	);
	return;
    }
    /* derive/brute muszą widzieć pełną ścieżkę od body — przy trafionym wierszu relFromHost jest krótki i prefiks body→wiersz się nie zgadza. */
    var relFromBody = enduxBuildRelativeSelectorFromAncestor(document.body, leaf);
    var anchorRow = rows.length ? enduxSubtableFindGridRowForSubtablePick(leaf, rows, e) : null;
    var baseRowRel = '';
    if (anchorRow && anchorRow !== document.body) {
	baseRowRel = enduxBuildRelativeSelectorFromAncestor(anchorRow, leaf);
    }
    var templateForShorten = anchorRow;
    if (baseRowRel && templateForShorten && rows.length >= 2) {
	baseRowRel = enduxTryShortenSubtableRowRelativeSelector(templateForShorten, leaf, baseRowRel);
    }
    if (!baseRowRel && relFromBody && rows.length) {
	var derived = enduxSubtableTryDeriveRowScopeFromBodyPath(leaf, relFromBody, rows);
	if (!derived) derived = enduxSubtableBruteRowRelativeFromBodyPath(leaf, relFromBody, rows);
	if (derived) {
	    baseRowRel = derived.suffix;
	    templateForShorten = derived.templateRow;
	    if (baseRowRel && templateForShorten && rows.length >= 2) {
		if (templateForShorten.contains && templateForShorten.contains(leaf)) {
		    baseRowRel = enduxTryShortenSubtableRowRelativeSelector(
			templateForShorten,
			leaf,
			baseRowRel
		    );
		}
	    }
	}
    }
    var finalRel = relFromHost;
    var finalScope = scope;
    var upgradedFromDocument = false;
    if (baseRowRel) {
	/* Wspólna ścieżka względem wiersza siatki — ta sama dla każdej „podstrony”, bez body > … różniącego się nth-child. */
	finalRel = baseRowRel;
	finalScope = 'row';
	upgradedFromDocument = scope === 'document';
    }
    stopSubtableFieldPicker();
    chrome.storage.local.get(['gridSubtableFields'], function(res) {
	if (chrome.runtime.lastError) {
	    showToast('Błąd odczytu schowka pól: ' + chrome.runtime.lastError.message, 'error');
	    return;
	}
	var list = enduxNormalizeSubtableFields(res.gridSubtableFields || []);
	var nextN = list.length + 1;
	var entry = {
	    id: 'sf_' + Math.random().toString(36).substr(2, 10),
	    name: 'Pole ' + nextN,
	    relativeSelector: finalRel,
	    scope: finalScope
	};
	list.push(entry);
	chrome.storage.local.set({ gridSubtableFields: list }, function() {
	    if (chrome.runtime.lastError) {
		showToast('Nie zapisano pola: ' + chrome.runtime.lastError.message, 'error');
		return;
	    }
	    showToast(
		upgradedFromDocument
		    ? 'Dodano pole — ścieżka względem wiersza siatki (wspólna dla każdego wiersza; nazwę możesz zmienić w podglądzie)'
		    : 'Dodano pole — nazwę możesz zmienić w podglądzie',
		'success'
	    );
	    updateGridPreviewUI();
	});
    });
}

function _subtableFieldPickerKeyDown(e) {
    if (e.key === 'Escape') {
	stopSubtableFieldPicker();
	showToast('Wybieranie anulowane', 'warning');
    }
}

function startSubtableFieldPicker() {
    if (_subtableFieldPickerActive) stopSubtableFieldPicker();
    if (_subtableExpandPickerActive) stopSubtableExpandPicker();
    if (_gridPickerActive) stopGridPicker();
    if (_pickerActive) stopSelectorPicker();
    document.body.style.cursor = 'crosshair';
    _subtableFieldPickerBanner = document.createElement('div');
    _subtableFieldPickerBanner.id = ENDUX_SUBTABLE_FIELD_BANNER_ID;
    Object.assign(_subtableFieldPickerBanner.style, {
	position: 'fixed',
	top: '0',
	left: '0',
	right: '0',
	zIndex: '2147483647',
	background: '#007bff',
	color: '#fff',
	padding: '8px 16px',
	fontSize: '14px',
	fontWeight: '600',
	fontFamily: 'sans-serif',
	boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
	pointerEvents: 'auto',
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	flexWrap: 'wrap',
	gap: '10px 14px',
	boxSizing: 'border-box'
    });
    var msg = document.createElement('span');
    msg.textContent =
	'🎯 Kliknij element na stronie. Ścieżka zapisuje się względem wiersza siatki (krótsza, wspólna dla wierszy) — także przy panelu w portalu; w Ekstrakcji ustaw wiersz szablonu. Esc / Anuluj — nagłówek panelu.';
    msg.style.lineHeight = '1.35';
    var escHint = document.createElement('span');
    escHint.textContent = 'Esc — anuluj';
    escHint.style.opacity = '0.92';
    escHint.style.fontSize = '13px';
    var cancelTop = document.createElement('button');
    cancelTop.type = 'button';
    cancelTop.textContent = 'Anuluj wybór';
    Object.assign(cancelTop.style, {
	padding: '6px 14px',
	borderRadius: '6px',
	border: 'none',
	background: '#fff',
	color: '#007bff',
	fontWeight: '700',
	cursor: 'pointer',
	fontSize: '13px',
	fontFamily: 'inherit'
    });
    cancelTop.addEventListener('click', function(ev) {
	ev.stopPropagation();
	stopSubtableFieldPicker();
	showToast('Wybieranie anulowane', 'warning');
    });
    _subtableFieldPickerBanner.appendChild(msg);
    _subtableFieldPickerBanner.appendChild(escHint);
    _subtableFieldPickerBanner.appendChild(cancelTop);
    document.body.appendChild(_subtableFieldPickerBanner);
    _applySelectorPickerPanelPassThrough(true);
    _subtableFieldPickerActive = true;
    document.addEventListener('mouseover', _subtableFieldPickerMouseOver, true);
    document.addEventListener('mouseout', _subtableFieldPickerMouseOut, true);
    document.addEventListener('click', _subtableFieldPickerClick, true);
    document.addEventListener('keydown', _subtableFieldPickerKeyDown, true);
}

function enduxRefreshSubtableTabDisplays() {
    if (!_gridPanelRoot) return;
    chrome.storage.local.get(ENDUX_SUBTABLE_STORAGE_KEYS, function(r) {
	if (chrome.runtime.lastError || !_gridPanelRoot) return;
	enduxSyncSubtableExportCacheFromSlice(r || {});
	enduxApplySubtableDisplaysToPanel(_gridPanelRoot, r || {});
	updateGridPreviewUI();
    });
}

function enduxApplySubtableDisplaysToPanel(root, r) {
    if (!root) return;
    var ex = root.querySelector('[data-grid-subtable-expand-display]');
    var bk = root.querySelector('[data-grid-subtable-back-display]');
    var expBtn = root.querySelector('[data-grid-subtable-expand-btn]');
    var backBtn = root.querySelector('[data-grid-subtable-back-btn]');
    var exp = (r.gridSubtableExpandRelative || '').trim();
    var bs = (r.gridSubtableBackSelector || '').trim();
    var hasExp = !!exp;
    var hasBs = !!bs;
    if (ex) {
	ex.textContent = hasExp ? '✓ Wybrane' : 'Nie wybrano';
	ex.title = hasExp ? exp : '';
	ex.style.color = hasExp ? '#15803d' : '#64748b';
	ex.style.fontWeight = hasExp ? '600' : '500';
    }
    if (bk) {
	bk.textContent = hasBs ? '✓ Wybrane' : 'Nie wybrano';
	bk.title = hasBs ? bs : '';
	bk.style.color = hasBs ? '#15803d' : '#64748b';
	bk.style.fontWeight = hasBs ? '600' : '500';
    }
    if (expBtn) {
	if (hasExp) {
	    expBtn.style.boxShadow = 'inset 0 0 0 2px #15803d';
	    expBtn.setAttribute('data-endux-subtable-has-choice', '1');
	} else {
	    expBtn.style.boxShadow = '';
	    expBtn.removeAttribute('data-endux-subtable-has-choice');
	}
    }
    if (backBtn) {
	if (hasBs) {
	    backBtn.style.boxShadow = 'inset 0 0 0 2px #15803d';
	    backBtn.setAttribute('data-endux-subtable-has-choice', '1');
	} else {
	    backBtn.style.boxShadow = '';
	    backBtn.removeAttribute('data-endux-subtable-has-choice');
	}
    }
}

/**
 * Widoczny element do kliknięcia (powrót / rozwinięcie) — unika pierwszego ukrytego dopasowania querySelector.
 * Od końca listy: nakładki i widok szczegółów często są dopięte na końcu body.
 */
function enduxRoughlyVisibleForSubtableClick(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
	if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
	    return false;
	}
    } catch (e0) {}
    try {
	if (el.closest('[hidden]')) return false;
    } catch (e1) {}
    try {
	var ar = el.getAttribute && el.getAttribute('aria-hidden');
	if (ar === 'true') return false;
    } catch (e2) {}
    try {
	var rects = el.getClientRects();
	if (!rects || rects.length === 0) return false;
    } catch (e3) {}
    if (el.offsetParent !== null) return true;
    try {
	var rect = el.getBoundingClientRect();
	return rect.width > 0 && rect.height > 0;
    } catch (e4) {
	return false;
    }
}

function enduxPickClickableForSubtableAction(el) {
    if (!el || el.nodeType !== 1) return null;
    var CLICKABLE_TAGS = ['A', 'BUTTON', 'INPUT', 'SELECT'];
    var nextButton = el;
    var isClickable =
	CLICKABLE_TAGS.indexOf(nextButton.tagName) >= 0 ||
	(nextButton.getAttribute && nextButton.getAttribute('role') === 'button') ||
	(nextButton.getAttribute && nextButton.getAttribute('role') === 'link');
    if (!isClickable) {
	var node = nextButton.parentElement;
	while (node && node !== document.body) {
	    if (
		CLICKABLE_TAGS.indexOf(node.tagName) >= 0 ||
		(node.getAttribute && node.getAttribute('role') === 'button') ||
		(node.getAttribute && node.getAttribute('role') === 'link')
	    ) {
		nextButton = node;
		break;
	    }
	    node = node.parentElement;
	}
    }
    return nextButton;
}

function enduxFindSubtableBackClickTarget(backSel) {
    if (!backSel || typeof backSel !== 'string') return null;
    var list = [];
    try {
	list = document.querySelectorAll(backSel.trim());
    } catch (e) {
	return null;
    }
    if (!list || !list.length) return null;
    for (var i = list.length - 1; i >= 0; i--) {
	var raw = list[i];
	if (!raw || raw.nodeType !== 1) continue;
	if (isInsideEnduxExtensionUi(raw)) continue;
	var cand = enduxPickClickableForSubtableAction(raw);
	if (!cand) continue;
	if (!enduxRoughlyVisibleForSubtableClick(cand)) continue;
	try {
	    if (cand.disabled || cand.getAttribute('disabled') != null || cand.getAttribute('aria-disabled') === 'true') {
		continue;
	    }
	} catch (e2) {}
	try {
	    if (cand.classList && cand.classList.contains('disabled')) continue;
	} catch (e3) {}
	try {
	    var pe = window.getComputedStyle(cand).pointerEvents;
	    if (pe === 'none') continue;
	} catch (e4) {}
	return cand;
    }
    return null;
}

function enduxClickSubtableNavControl(el) {
    if (!el) return;
    var target = enduxPickClickableForSubtableAction(el) || el;
    var center = null;
    try {
	var r = target.getBoundingClientRect();
	center = {
	    clientX: r.left + r.width / 2,
	    clientY: r.top + r.height / 2
	};
    } catch (eRect) {}
    function fire(type, ctorName) {
	try {
	    var opts = { bubbles: true, cancelable: true, view: window };
	    if (center) {
		opts.clientX = center.clientX;
		opts.clientY = center.clientY;
	    }
	    var Ctor = window[ctorName] || window.MouseEvent;
	    target.dispatchEvent(new Ctor(type, opts));
	} catch (eEvt) {}
    }
    fire('pointerdown', 'PointerEvent');
    fire('mousedown', 'MouseEvent');
    fire('pointerup', 'PointerEvent');
    fire('mouseup', 'MouseEvent');
    fire('click', 'MouseEvent');
    try {
	target.click();
    } catch (e0) {}
    try {
	if (target.tagName === 'A' && target.href && !String(target.href).toLowerCase().startsWith('javascript')) {
	    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
	}
    } catch (e1) {}
}

function enduxSubtableDispatchKeyboardActivate(el, key) {
    if (!el || el.nodeType !== 1) return;
    var k = key || 'Enter';
    var code = k === ' ' ? 'Space' : k;
    var keyCode = k === ' ' ? 32 : 13;
    function fire(type) {
	try {
	    el.dispatchEvent(
		new KeyboardEvent(type, {
		    key: k,
		    code: code,
		    keyCode: keyCode,
		    which: keyCode,
		    bubbles: true,
		    cancelable: true
		})
	    );
	} catch (e) {}
    }
    try {
	el.focus({ preventScroll: true });
    } catch (e0) {}
    fire('keydown');
    fire('keyup');
}

async function enduxTryOpenSubtableFromTrigger(triggerEl, debugLabel) {
    if (!triggerEl || triggerEl.nodeType !== 1) return false;
    var btn = enduxPickClickableForSubtableAction(triggerEl) || triggerEl;
    var before = '';
    try {
	before = btn.getAttribute && btn.getAttribute('aria-expanded');
    } catch (e0) {}
    var chain = [];
    var n = btn;
    var depth = 0;
    while (n && n.nodeType === 1 && depth < 8) {
	chain.push(n);
	if (n === document.body) break;
	n = n.parentElement;
	depth++;
    }
    for (var i = 0; i < chain.length; i++) {
	var cand = chain[i];
	if (!cand || !cand.isConnected) continue;
	var lbl = debugLabel || 'ROZWIŃ';
	if (!(await enduxDebugConfirmSubtableClick(cand, lbl + ' próba ' + (i + 1)))) return false;
	enduxClickSubtableNavControl(cand);
	await enduxSleep(140);
	try {
	    var after0 = btn.getAttribute && btn.getAttribute('aria-expanded');
	    if (before === 'false' && after0 === 'true') return true;
	    if (before === 'true' && after0 === 'true') return true;
	    if (before !== 'false' && after0 && after0 !== before) return true;
	} catch (e1) {}
	enduxSubtableDispatchKeyboardActivate(cand, 'Enter');
	await enduxSleep(90);
	enduxSubtableDispatchKeyboardActivate(cand, ' ');
	await enduxSleep(120);
	try {
	    var after1 = btn.getAttribute && btn.getAttribute('aria-expanded');
	    if (before === 'false' && after1 === 'true') return true;
	    if (before !== 'false' && after1 && after1 !== before) return true;
	} catch (e2) {}
    }
    return false;
}

async function enduxTryCloseSubtableFromTrigger(triggerEl, debugLabel) {
    if (!triggerEl || triggerEl.nodeType !== 1) return false;
    var btn = enduxPickClickableForSubtableAction(triggerEl) || triggerEl;
    var before = '';
    try {
	before = btn.getAttribute && btn.getAttribute('aria-expanded');
    } catch (e0) {}
    if (before === 'false') return true;
    var chain = [];
    var n = btn;
    var depth = 0;
    while (n && n.nodeType === 1 && depth < 8) {
	chain.push(n);
	if (n === document.body) break;
	n = n.parentElement;
	depth++;
    }
    for (var i = 0; i < chain.length; i++) {
	var cand = chain[i];
	if (!cand || !cand.isConnected) continue;
	var lbl = debugLabel || 'POWRÓT';
	if (!(await enduxDebugConfirmSubtableClick(cand, lbl + ' próba ' + (i + 1)))) return false;
	enduxClickSubtableNavControl(cand);
	await enduxSleep(140);
	try {
	    var after0 = btn.getAttribute && btn.getAttribute('aria-expanded');
	    if (after0 === 'false') return true;
	} catch (e1) {}
	enduxSubtableDispatchKeyboardActivate(cand, 'Enter');
	await enduxSleep(90);
	enduxSubtableDispatchKeyboardActivate(cand, ' ');
	await enduxSleep(120);
	try {
	    var after1 = btn.getAttribute && btn.getAttribute('aria-expanded');
	    if (after1 === 'false') return true;
	} catch (e2) {}
    }
    return false;
}

async function enduxDebugConfirmSubtableClick(el, label) {
    if (!_enduxSubtableDebugConfirm || !el || el.nodeType !== 1) return true;
    var oldOutline = '';
    var oldOffset = '';
    try {
	oldOutline = el.style.outline || '';
	oldOffset = el.style.outlineOffset || '';
	el.style.outline = '3px solid #ef4444';
	el.style.outlineOffset = '2px';
	el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    } catch (e0) {}
    showToast(
	'DEBUG podtabela: ' + (label || 'klik') + ' — Spacja = kontynuuj, Esc = przerwij',
	'info'
    );
    var ok = await new Promise(function(resolve) {
	var done = false;
	function cleanup(v) {
	    if (done) return;
	    done = true;
	    document.removeEventListener('keydown', onKey, true);
	    resolve(v);
	}
	function onKey(e) {
	    if (!e) return;
	    if (e.code === 'Space' || e.key === ' ') {
		e.preventDefault();
		e.stopPropagation();
		cleanup(true);
		return;
	    }
	    if (e.key === 'Escape') {
		e.preventDefault();
		e.stopPropagation();
		cleanup(false);
	    }
	}
	document.addEventListener('keydown', onKey, true);
    });
    try {
	el.style.outline = oldOutline;
	el.style.outlineOffset = oldOffset;
    } catch (e1) {}
    return ok;
}

function enduxHasAnyVisibleGridDataRow() {
    var rows = getGridDataRowsOnly();
    if (!rows || !rows.length) return false;
    for (var i = 0; i < rows.length; i++) {
	var r = rows[i];
	if (!r || !r.isConnected) continue;
	if (enduxRoughlyVisibleForSubtableClick(r)) return true;
    }
    return false;
}

/** Przejście: rozwij → czekaj → powrót — dla każdego wiersza danych (gdy włączone w schowku / crawlerze). */
async function enduxMaybeWalkSubtableRows(storageSlice) {
    if (!storageSlice || storageSlice.gridSubtableEnabled !== true) return;
    var rel = (storageSlice.gridSubtableExpandRelative || '').trim();
    if (!rel) return;
    var useHist = storageSlice.gridSubtableUseHistoryBack === true;
    var backSel = (storageSlice.gridSubtableBackSelector || '').trim();
    if (!useHist && !backSel) {
	showToast('Podtabela: brak przycisku „Powrót” i wyłączony history.back — pomijam przejście', 'warning');
	return;
    }
    var rows = getGridDataRowsOnly();
    if (!rows.length) return;
    var walkFields = enduxNormalizeSubtableFields((storageSlice && storageSlice.gridSubtableFields) || []);
    enduxResetSubtableRowFieldCache();
    var targetCount = rows.length;
    var clickedCount = 0;
    var url0 = '';
    try {
	url0 = String(location.href || '');
    } catch (e0) {}
    _enduxSubtableWalkProgress = { completed: 0, total: targetCount };
    try {
	updateGridPreviewUI();
    } catch (eProg0) {}
    showToast('Podtabela: przeglądam ' + targetCount + ' podstron (wierszy)…', 'info');
    for (var i = 0; i < targetCount; i++) {
	/* Po kliknięciu/powrocie tabela bywa renderowana od nowa — odśwież listę wierszy w każdej iteracji. */
	var currentRows = getGridDataRowsOnly();
	if (!currentRows.length) break;
	var row = currentRows[Math.min(i, currentRows.length - 1)];
	if (!row || !row.isConnected) continue;
	var btn = null;
	try {
	    btn = row.querySelector(rel);
	} catch (e1) {
	    btn = null;
	}
	if (!btn && rel) {
	    /* Gdy wskazany element był samym wierszem, rel bywa pusty/nieprzydatny; kliknij pierwszy sensowny element interaktywny. */
	    try {
		btn = row.querySelector('a[href],button,[role="button"],[data-action],td a,td button');
	    } catch (e1b) {
		btn = null;
	    }
	}
	if (!btn) continue;
	if (!(await enduxTryOpenSubtableFromTrigger(btn, 'ROZWIŃ wiersz ' + (i + 1) + '/' + targetCount))) {
	    showToast('Podtabela: nie udało się rozwinąć wiersza (toggle nie zmienia stanu)', 'warning');
	    break;
	}
	/* W chwili rozwinięcia odczytaj i zapamiętaj pola dla tego konkretnego wiersza. */
	if (walkFields.length) {
	    var openedRows = getGridDataRowsOnly();
	    var openedRow = openedRows[Math.min(i, openedRows.length - 1)];
	    if (openedRow && openedRow.isConnected) {
		enduxRememberSubtableFieldValuesForRow(openedRow, walkFields);
	    }
	    try {
		updateGridPreviewUI();
	    } catch (ePrev) {}
	}
	var openedToggle = enduxPickClickableForSubtableAction(btn) || btn;
	clickedCount++;
	await enduxSleep(ENDUX_SUBTABLE_STEP_MS);
	if (useHist) {
	    try {
		history.back();
	    } catch (e3) {}
	} else {
	    var closed = false;
	    if (openedToggle && openedToggle.isConnected) {
		closed = await enduxTryCloseSubtableFromTrigger(openedToggle, 'POWRÓT wiersz ' + (i + 1) + '/' + targetCount);
	    }
	    var b = enduxFindSubtableBackClickTarget(backSel);
	    if (!b) {
		await enduxSleep(350);
		b = enduxFindSubtableBackClickTarget(backSel);
	    }
	    if (!closed && b) {
		closed = await enduxTryCloseSubtableFromTrigger(b, 'POWRÓT wiersz ' + (i + 1) + '/' + targetCount);
	    }
	    if (!closed && !b) {
		showToast(
		    'Podtabela: brak widocznego elementu powrotu (wiersz ' + (i + 1) + '/' + targetCount + ') — przerwano, by nie otwierać kolejnych podstron.',
		    'warning'
		);
		break;
	    }
	    if (!closed) {
		showToast('Podtabela: nie udało się zwinąć podtabeli (toggle nie zmienia stanu)', 'warning');
		break;
	    }
	}
	await enduxSleep(ENDUX_SUBTABLE_STEP_MS);
	/* Część stron wymaga drugiego kliknięcia zamknięcia (np. ten sam toggle co rozwinięcie). */
	if (!useHist && !enduxHasAnyVisibleGridDataRow()) {
	    var b2 = enduxFindSubtableBackClickTarget(backSel);
	    if (b2) {
		if (!(await enduxTryCloseSubtableFromTrigger(b2, 'POWRÓT #2 wiersz ' + (i + 1) + '/' + targetCount))) {
		    showToast('Podtabela: nie udało się zwinąć podtabeli w próbie #2', 'warning');
		    break;
		}
		await enduxSleep(Math.max(260, Math.floor(ENDUX_SUBTABLE_STEP_MS * 0.7)));
	    } else {
		var rows2 = getGridDataRowsOnly();
		var row2 = rows2.length ? rows2[Math.min(i, rows2.length - 1)] : null;
		var btn2 = null;
		if (row2 && row2.isConnected) {
		    try {
			btn2 = row2.querySelector(rel);
		    } catch (e7) {
			btn2 = null;
		    }
		}
		if (btn2) {
		    if (!(await enduxTryCloseSubtableFromTrigger(btn2, 'POWRÓT #2 (fallback) wiersz ' + (i + 1) + '/' + targetCount))) {
			showToast('Podtabela: nie udało się zwinąć podtabeli fallbackiem #2', 'warning');
			break;
		    }
		    await enduxSleep(Math.max(260, Math.floor(ENDUX_SUBTABLE_STEP_MS * 0.7)));
		}
	    }
	}
	if (useHist && url0) {
	    try {
		if (String(location.href || '') !== url0) {
		    showToast('Podtabela: przerwano — zmienił się adres (history.back)', 'warning');
		    break;
		}
	    } catch (e6) {}
	}
	_enduxSubtableWalkProgress.completed = (_enduxSubtableWalkProgress.completed | 0) + 1;
	try {
	    updateGridPreviewUI();
	} catch (eProg1) {}
    }
    _enduxSubtableWalkProgress = null;
    try {
	updateGridPreviewUI();
    } catch (eProg2) {}
    if (clickedCount === 0) {
	showToast('Podtabela: nie znaleziono klikalnego elementu w wierszach dla zapisanego selektora', 'warning');
    }
}

function expandGridSelection() {
    if (!_gridSelectedEl) {
	showToast('Najpierw wskaż element', 'warning');
	return;
    }
    var p = _gridSelectedEl.parentElement;
    if (!p || p === document.documentElement || p === document.body) {
	showToast('Brak wyższego elementu', 'warning');
	return;
    }
    // Nie ustawiaj wyboru na zapisanym nagłówku — wtedy getGridDataRowsOnly() odfiltruje go i podgląd ma 0 wierszy.
    while (p && p !== document.body && _gridHeaderRowEl && p === _gridHeaderRowEl) {
	p = p.parentElement;
    }
    if (!p || p === document.documentElement || p === document.body) {
	showToast('Brak wyższego elementu (poza nagłówkiem)', 'warning');
	return;
    }
    _gridUndoStack.push(_gridSelectedEl);
    applyGridSelectionOutline(p);
    updateGridPreviewUI();
}

function undoGridSelection() {
    if (!_gridUndoStack.length) return;
    const prev = _gridUndoStack.pop();
    applyGridSelectionOutline(prev);
    updateGridPreviewUI();
}

function gridCopyExportRowCount() {
    if (!_gridSelectedEl) return 0;
    return getGridDataRowsOnly().length;
}

function gridCopyButtonLabelForCount(n) {
    var base = '📋 Kopiuj tabelę ';
    if (n === 0) return base + '(brak wierszy do skopiowania)';
    if (n === 1) return base + '(1 wiersz do skopiowania)';
    return base + '(' + n + ' wierszy do skopiowania)';
}

function updateGridCopyButtonLabel() {
    if (!_gridPanelRoot) return;
    var btn = _gridPanelRoot.querySelector('[data-grid-copy-btn]');
    if (!btn) return;
    btn.textContent = gridCopyButtonLabelForCount(gridCopyExportRowCount());
}

/** Ścieżka od root do elementu (tag, #id, .klasa, role, data-rowindex) — do podglądu w panelu. */
function enduxGridCompactElementPath(el) {
    if (!el || el.nodeType !== 1) return '';
    var parts = [];
    var n = el;
    var maxDepth = 12;
    while (n && n !== document.body && n !== document.documentElement && parts.length < maxDepth) {
	var bit = n.tagName.toLowerCase();
	if (n.id && typeof n.id === 'string' && n.id && n.id.indexOf('endux') < 0) {
	    bit += '#' + n.id;
	} else {
	    var clsRaw = n.className && typeof n.className === 'string' ? n.className.trim() : '';
	    var clsFirst = clsRaw ? clsRaw.split(/\s+/).filter(function(x) {
		return x && x.indexOf('endux') !== 0;
	    })[0] : '';
	    if (clsFirst) bit += '.' + clsFirst;
	    var role = n.getAttribute && n.getAttribute('role');
	    if (role) bit += '[role="' + role + '"]';
	    var dri = n.getAttribute && n.getAttribute('data-rowindex');
	    if (dri != null && dri !== '') bit += '[row:' + dri + ']';
	    var did = n.getAttribute && n.getAttribute('data-id');
	    if (did != null && did !== '') {
		var ds = String(did);
		bit += '[data-id:' + (ds.length > 28 ? ds.slice(0, 28) + '…' : ds) + ']';
	    }
	}
	parts.unshift(bit);
	n = n.parentElement;
    }
    return parts.join(' › ');
}

function enduxTruncateMiddle(str, maxLen) {
    if (!str || str.length <= maxLen) return str;
    var half = Math.floor((maxLen - 1) / 2);
    return str.slice(0, half) + '…' + str.slice(str.length - (maxLen - 1 - half));
}

function setGridSelectionPathEditMode(active) {
    _gridPathEditActive = !!active;
    if (!_gridPanelRoot) return;
    var view = _gridPanelRoot.querySelector('[data-grid-path-view]');
    var edit = _gridPanelRoot.querySelector('[data-grid-path-edit]');
    if (!view || !edit) return;
    if (_gridPathEditActive) {
	view.style.display = 'none';
	edit.style.display = 'flex';
    } else {
	edit.style.display = 'none';
	view.style.display = 'flex';
    }
}

function openGridSelectionPathEdit() {
    if (!_gridPanelRoot || !_gridSelectedEl || !_gridSelectedEl.isConnected || isInsideEnduxGridPanel(_gridSelectedEl)) return;
    var input = _gridPanelRoot.querySelector('[data-grid-selection-path-input]');
    if (!input) return;
    try {
	input.value = generateCssSelector(_gridSelectedEl);
    } catch (e) {
	input.value = '';
    }
    setGridSelectionPathEditMode(true);
    requestAnimationFrame(function() {
	if (input.isConnected) {
	    input.focus();
	    input.select();
	}
    });
}

function commitGridSelectionPathEdit() {
    if (!_gridPanelRoot) return;
    var input = _gridPanelRoot.querySelector('[data-grid-selection-path-input]');
    if (!input) return;
    var raw = (input.value || '').trim();
    if (!raw) {
	showToast('Wpisz selektor CSS', 'warning');
	return;
    }
    var el = enduxFirstMatchOutsidePanel(raw);
    if (!el) {
	try {
	    document.querySelectorAll(raw);
	} catch (e) {
	    showToast('Nieprawidłowy selektor CSS', 'warning');
	    return;
	}
	showToast('Nie znaleziono elementu na stronie (lub wszystkie dopasowania są w panelu)', 'warning');
	return;
    }
    try {
	var n = document.querySelectorAll(raw).length;
	if (n > 1) {
	    showToast('Wiele dopasowań — użyto pierwszego wiersza poza panelem (' + n + ')', 'info');
	}
    } catch (e) {}
    var keepHeader = _gridHeaderRowEl && _gridHeaderRowEl.isConnected && !isInsideEnduxGridPanel(_gridHeaderRowEl) && _gridHeaderRowEl !== el;
    installGridTableSelection(keepHeader ? _gridHeaderRowEl : null, el);
    setGridSelectionPathEditMode(false);
    updateGridPreviewUI();
    showToast('Zaktualizowano wskazany element', 'success');
}

function cancelGridSelectionPathEdit() {
    setGridSelectionPathEditMode(false);
    updateGridPreviewUI();
}

function updateGridPreviewUI() {
    if (!_gridPanelRoot) return;
    if (enduxGridPreviewEditShouldDeferDomRefresh()) return;
    refreshGridPanelSelectionIfStale();
    chrome.storage.local.get(ENDUX_SUBTABLE_STORAGE_KEYS, function(sub) {
	if (!_gridPanelRoot) return;
	if (enduxGridPreviewEditShouldDeferDomRefresh()) return;
	if (chrome.runtime.lastError) {
	    enduxSyncSubtableExportCacheFromSlice({});
	} else {
	    enduxSyncSubtableExportCacheFromSlice(sub || {});
	}

	const statusEl = _gridPanelRoot.querySelector('[data-grid-status]');
	const pathEl = _gridPanelRoot.querySelector('[data-grid-selection-path]');
	const pathTextEl = _gridPanelRoot.querySelector('[data-grid-selection-path-text]');
	const previewWrap = _gridPanelRoot.querySelector('[data-grid-preview]');
	if (!statusEl || !previewWrap) return;

	var subFields = enduxNormalizeSubtableFields((sub || {}).gridSubtableFields || []);

	var activeTab = _gridPanelRoot.getAttribute('data-endux-grid-active-tab') || 'extract';

	function hidePathBlock() {
	    if (pathEl) {
		pathEl.style.display = 'none';
		_gridPathEditActive = false;
		setGridSelectionPathEditMode(false);
		if (pathTextEl) {
		    pathTextEl.textContent = '';
		    pathTextEl.removeAttribute('title');
		}
	    }
	}

	function applyPathBlockForSelection() {
	    if (pathEl && pathTextEl && _gridSelectedEl && _gridSelectedEl.isConnected && !isInsideEnduxGridPanel(_gridSelectedEl)) {
		var fullPath = enduxGridCompactElementPath(_gridSelectedEl);
		if (fullPath) {
		    pathEl.style.display = 'flex';
		    if (!_gridPathEditActive) {
			pathTextEl.textContent = enduxTruncateMiddle(fullPath, 280);
			pathTextEl.title = fullPath;
		    }
		} else {
		    pathEl.style.display = 'none';
		    _gridPathEditActive = false;
		    setGridSelectionPathEditMode(false);
		    pathTextEl.textContent = '';
		    pathTextEl.removeAttribute('title');
		}
	    } else if (pathEl) {
		pathEl.style.display = 'none';
		_gridPathEditActive = false;
		setGridSelectionPathEditMode(false);
		if (pathTextEl) {
		    pathTextEl.textContent = '';
		    pathTextEl.removeAttribute('title');
		}
	    }
	}

	if (activeTab === 'subtable') {
	    if (!_gridSelectedEl) {
		statusEl.textContent =
		    'Podtabela · brak wiersza danych — w zakładce „Ekstrakcja wyników” wskaż wiersz (Wskaż element), potem wróć tutaj' +
		    enduxSubtableWalkProgressSuffix();
		hidePathBlock();
		if (!previewWrap.isConnected || !_gridPanelRoot) return;
		enduxRenderSubtableFieldsTableInPreview(previewWrap, subFields);
		updateGridCopyButtonLabel();
		return;
	    }
	    var dataRowsSt = getGridDataRowsOnly();
	    var colCountSt = computeGridExportColumnCount();
	    var ctxRowSt = enduxResolveSubtablePreviewContextRow();
	    var ctxIdxSt = ctxRowSt && dataRowsSt.length ? dataRowsSt.indexOf(ctxRowSt) : -1;
	    var statusTextSt =
		'Podtabela · podgląd wartości: wiersz ' +
		(ctxIdxSt >= 0 ? ctxIdxSt + 1 : '1') +
		'/' +
		dataRowsSt.length +
		' (klik w inny wiersz danych na stronie zmienia kontekst)';
	    if (colCountSt) statusTextSt += ' · kolumn siatki: ' + colCountSt;
	    statusTextSt += _gridHeaderRowEl ? ' · nagłówek: tak' : ' · nagłówek: nie';
	    statusEl.textContent = statusTextSt + enduxSubtableWalkProgressSuffix();
	    /* Karta „Wskazany element” dotyczy tylko Ekstrakcji — na Podtabeli jej nie pokazujemy. */
	    hidePathBlock();
	    if (!previewWrap.isConnected || !_gridPanelRoot) return;
	    if ((_gridPanelRoot.getAttribute('data-endux-grid-active-tab') || 'extract') !== 'subtable') return;
	    enduxRenderSubtableFieldsTableInPreview(previewWrap, subFields);
	    updateGridCopyButtonLabel();
	    return;
	}

	if (!_gridSelectedEl) {
	    statusEl.textContent =
		'Podgląd · brak wyboru' + (_gridHeaderRowEl ? ' (nagłówek: zapisany)' : '') + enduxSubtableWalkProgressSuffix();
	    previewWrap.innerHTML = '';
	    hidePathBlock();
	    updateGridCopyButtonLabel();
	    return;
	}
	const dataRows = getGridDataRowsOnly();
	const baseColCount = computeGridExportBaseColumnCount();
	const mergedBase =
	    _gridHeaderRowEl && _gridHeaderRowEl.isConnected
		? enduxMergeExportedHeaderBaseCells(baseColCount)
		: [];
	var skipDupHeader =
	    _gridHeaderRowEl &&
	    dataRows.length > 0 &&
	    enduxShouldHideFirstDataRowAfterMergedHeader(dataRows, baseColCount);
	var bodyRowsFull = enduxGridDataRowsForBodyExport(baseColCount);
	var PREVIEW_MAX_ROWS = 5;
	var previewRows;
	if (_enduxSubtableWalkProgress && (_enduxSubtableWalkProgress.total | 0) > 0) {
	    var prDone = Math.min(
		_enduxSubtableWalkProgress.completed | 0,
		bodyRowsFull.length
	    );
	    if (prDone <= 0) {
		previewRows = bodyRowsFull.slice(0, Math.min(PREVIEW_MAX_ROWS, bodyRowsFull.length));
	    } else {
		var winStart = Math.max(0, prDone - PREVIEW_MAX_ROWS);
		previewRows = bodyRowsFull.slice(winStart, prDone);
	    }
	} else {
	    previewRows = bodyRowsFull.slice(0, Math.min(PREVIEW_MAX_ROWS, bodyRowsFull.length));
	}
	const colCount = computeGridExportColumnCount();
	let statusText = 'Podgląd · kolumn: ' + colCount;
	statusText += _gridHeaderRowEl ? ', nagłówek: tak' : ', nagłówek: nie';
	statusText += ' · wierszy danych: ' + previewRows.length + ' (z ' + dataRows.length + ')';
	if (_enduxSubtableWalkProgress && (_enduxSubtableWalkProgress.total | 0) > 0) {
	    statusText += ' · podstrony: ostatnio przetworzone na dole';
	}
	statusEl.textContent = statusText + enduxSubtableWalkProgressSuffix();
	applyPathBlockForSelection();
	const table = document.createElement('table');
	table.style.borderCollapse = 'collapse';
	table.style.width = '100%';
	table.style.fontSize = '12px';
	function appendCells(tr, texts, isHeader) {
	    texts.forEach(function(txt) {
		const td = document.createElement('td');
		td.textContent = txt;
		td.style.border = '1px solid #d4c4b8';
		td.style.padding = '4px 6px';
		td.style.maxWidth = '160px';
		td.style.overflow = 'hidden';
		td.style.textOverflow = 'ellipsis';
		td.style.whiteSpace = 'nowrap';
		if (isHeader) {
		    td.style.fontWeight = '700';
		    td.style.background = '#dcfce7';
		}
		tr.appendChild(td);
	    });
	}
	if (_gridHeaderRowEl) {
	    const trH = document.createElement('tr');
	    var hCells = padCellsToColumnCount(mergedBase, baseColCount);
	    if (_enduxSubtableExportEnabled) {
		_enduxSubtableExportFields.forEach(function(f) {
		    hCells.push(f.name);
		});
	    }
	    appendCells(trH, hCells, true);
	    table.appendChild(trH);
	}
	previewRows.forEach(function(r) {
	    const tr = document.createElement('tr');
	    var rCells = padCellsToColumnCount(rowDirectCellTexts(r), baseColCount);
	    if (_enduxSubtableExportEnabled) {
		_enduxSubtableExportFields.forEach(function(f) {
		    rCells.push(enduxSubtableFieldTextForRow(r, f));
		});
	    }
	    appendCells(tr, rCells, false);
	    table.appendChild(tr);
	});
	previewWrap.innerHTML = '';
	previewWrap.appendChild(table);
	if (_enduxSubtableWalkProgress && (_enduxSubtableWalkProgress.total | 0) > 0) {
	    try {
		requestAnimationFrame(function() {
		    try {
			previewWrap.scrollTop = previewWrap.scrollHeight;
		    } catch (eSc) {}
		});
	    } catch (eRaf) {
		try {
		    previewWrap.scrollTop = previewWrap.scrollHeight;
		} catch (eSc2) {}
	    }
	}
	updateGridCopyButtonLabel();
    });
}

/**
 * Ten sam zakres wierszy co ręczne „Kopiuj” z panelu siatki (div/MUI), nie tabela HTML z kilkoma <tr>.
 * Używane przez auto-dołączanie, gdy użytkownik ma aktywny wybór w panelu.
 */
function enduxGetGridPanelAutoAppendPayload() {
    if (!_gridPanelRoot || !_gridSelectedEl) return null;
    if (!_gridSelectedEl.isConnected || isInsideEnduxGridPanel(_gridSelectedEl)) return null;
    var dataRows = getGridDataRowsOnly();
    if (dataRows.length === 0) return null;
    var baseColCount = computeGridExportBaseColumnCount();
    var colCount = computeGridExportColumnCount();
    if (colCount === 0) return null;
    var bodyRows = enduxGridDataRowsForBodyExport(baseColCount);
    if (bodyRows.length === 0) return null;
    var bodyText = buildTsvFromRows(bodyRows, baseColCount).replace(/\n$/, '');
    var extra = enduxSubtableExportExtraColCount();
    var includeGridHeader = !!(_gridHeaderRowEl && _gridHeaderRowEl.isConnected);
    var headerLine = null;
    if (includeGridHeader) {
	headerLine = enduxBuildGridExportHeaderLineWithSubtable(baseColCount);
    } else if (extra > 0) {
	headerLine = enduxBuildSyntheticSubtableHeaderLine(baseColCount);
	includeGridHeader = true;
    }
    return { bodyText: bodyText, headerLine: headerLine, includeGridHeader: includeGridHeader };
}

function copyGridFromPanel(append) {
    if (!_gridSelectedEl) {
	showToast('Najpierw wskaż wiersz danych (div)', 'warning');
	return;
    }
    if (!getGridDataRowsOnly().length) {
	showToast('Brak wierszy danych — wskaż wiersz szablonu lub usuń nagłówek z listy', 'warning');
	return;
    }

    var keysForGet = ENDUX_SUBTABLE_STORAGE_KEYS.slice();
    if (append) keysForGet.push('accumulatedClipboard');

    chrome.storage.local.get(keysForGet, function(st) {
	if (chrome.runtime.lastError) return;
	enduxSyncSubtableExportCacheFromSlice(st || {});
	(async function() {
	    try {
		if (_gridSelectedEl && _gridSelectedEl.isConnected && !isInsideEnduxGridPanel(_gridSelectedEl)) {
		    await enduxMaybeWalkSubtableRows(st);
		}
	    } catch (e) {}
	    var dataRows = getGridDataRowsOnly();
	    if (dataRows.length === 0) {
		showToast('Brak wierszy danych (po podtabeli)', 'warning');
		return;
	    }
	    var baseColCount = computeGridExportBaseColumnCount();
	    var colCount = computeGridExportColumnCount();
	    if (colCount === 0) {
		showToast('Brak kolumn do eksportu', 'warning');
		return;
	    }
	    var bodyRows = enduxGridDataRowsForBodyExport(baseColCount);
	    if (bodyRows.length === 0) {
		showToast('Po scaleniu nagłówka brak wierszy danych do eksportu', 'warning');
		return;
	    }
	    var bodyText = buildTsvFromRows(bodyRows, baseColCount).replace(/\n$/, '');
	    var extra = enduxSubtableExportExtraColCount();
	    var includeGridHeader = !!(_gridHeaderRowEl && _gridHeaderRowEl.isConnected);
	    var headerLine = null;
	    if (includeGridHeader) {
		headerLine = enduxBuildGridExportHeaderLineWithSubtable(baseColCount);
	    } else if (extra > 0) {
		headerLine = enduxBuildSyntheticSubtableHeaderLine(baseColCount);
		includeGridHeader = true;
	    }

	    function finishGridCopy(fullTextForClipboard) {
		copyTsvTextToClipboard(fullTextForClipboard, bodyText, append, false).then(function(res) {
		    if (res.isDuplicate) return;
		    if (res.success) {
			showToast(append ? '📋 Siatka dołączona do schowka' : '📋 Siatka skopiowana', 'success', res.rowCount);
			updateAllClipboardInfo();
		    }
		});
	    }

	    if (append) {
		var existing = ((st && st.accumulatedClipboard) || '').trim();
		var chunk;
		if (includeGridHeader && headerLine) {
		    chunk = existing.length ? bodyText : (headerLine + '\n' + bodyText);
		} else {
		    chunk = bodyText;
		}
		finishGridCopy(chunk);
	    } else {
		var fullText = bodyText;
		if (includeGridHeader && headerLine) fullText = headerLine + '\n' + bodyText;
		finishGridCopy(fullText);
	    }
	})().catch(function() {});
    });
}

function removeGridExtractorPanel(skipSaveUiState) {
    stopGridPicker();
    stopSubtableExpandPicker();
    stopSubtableFieldPicker();
    enduxUnbindSubtablePreviewRowListener();
    enduxClearSubtableFieldHoverHighlight();
    _gridSubtablePreviewRowEl = null;
    clearGridSelectionOutline();
    clearGridHeaderVisual();
    _gridUndoStack = [];
    _gridPathEditActive = false;
    _gridCachedDataSelector = null;
    _gridCachedHeaderSelector = null;
    const el = document.getElementById(GRID_PANEL_ID);
    if (el) el.remove();
    _gridPanelRoot = null;
    if (!skipSaveUiState) {
	saveGridPanelUiState('hidden');
    }
}

var _enduxToggleVisualByInput = new WeakMap();

/** Wizualny przełącznik (switch) dla input[type=checkbox]; zwraca { wrap, sync }. */
function enduxAttachToggleUi(input) {
    if (!input || input.tagName !== 'INPUT' || input.type !== 'checkbox') {
	throw new Error('enduxAttachToggleUi: wymagany checkbox');
    }
    var W = 42;
    var H = 24;
    var TH = 18;
    var PAD = 3;
    var thumbTravel = W - PAD * 2 - TH;

    var wrap = document.createElement('span');
    wrap.setAttribute('data-endux-toggle-wrap', '1');
    Object.assign(wrap.style, {
	position: 'relative',
	display: 'inline-block',
	width: W + 'px',
	height: H + 'px',
	flexShrink: '0',
	verticalAlign: 'middle'
    });

    var track = document.createElement('span');
    Object.assign(track.style, {
	position: 'absolute',
	left: '0',
	top: '0',
	width: W + 'px',
	height: H + 'px',
	borderRadius: H / 2 + 'px',
	background: '#cbd5e1',
	transition: 'background 0.2s ease',
	boxSizing: 'border-box',
	pointerEvents: 'none'
    });

    var thumb = document.createElement('span');
    Object.assign(thumb.style, {
	position: 'absolute',
	top: PAD + 'px',
	left: PAD + 'px',
	width: TH + 'px',
	height: TH + 'px',
	borderRadius: '50%',
	background: '#fff',
	boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
	transition: 'left 0.2s ease',
	pointerEvents: 'none'
    });

    Object.assign(input.style, {
	position: 'absolute',
	opacity: '0',
	width: W + 'px',
	height: H + 'px',
	margin: '0',
	cursor: 'pointer',
	zIndex: '1',
	top: '0',
	left: '0',
	appearance: 'none',
	webkitAppearance: 'none'
    });

    function syncToggleVisual() {
	if (input.checked) {
	    track.style.background = '#2563eb';
	    thumb.style.left = PAD + thumbTravel + 'px';
	} else {
	    track.style.background = '#cbd5e1';
	    thumb.style.left = PAD + 'px';
	}
    }
    _enduxToggleVisualByInput.set(input, syncToggleVisual);
    input.addEventListener('change', syncToggleVisual);
    wrap.appendChild(track);
    wrap.appendChild(thumb);
    wrap.appendChild(input);
    syncToggleVisual();

    return { wrap: wrap, sync: syncToggleVisual };
}

function enduxSyncToggleForInput(input) {
    var fn = input && _enduxToggleVisualByInput.get(input);
    if (fn) fn();
}

function injectGridExtractorPanel() {
    removeGridExtractorPanel(true);
    ensureEnduxCrawlerInputsSyncFromStorage();

    const root = document.createElement('div');
    root.id = GRID_PANEL_ID;
    root.setAttribute('data-endux-panel', 'grid');
    root.setAttribute('data-endux-grid-active-tab', 'extract');
    _gridPanelRoot = root;
    Object.assign(root.style, GRID_PANEL_EXPANDED_ROOT_STYLE);

    const header = document.createElement('div');
    header.setAttribute('data-endux-grid-section', 'header');
    Object.assign(header.style, {
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'space-between',
	padding: '8px 12px',
	borderBottom: '1px solid #e8d5c4',
	background: '#ffecd9',
	flexShrink: '0'
    });
    const title = document.createElement('span');
    title.textContent = 'EnduX - panel ekstrakcji wyników';
    title.style.fontWeight = '600';
    title.style.fontSize = '14px';
    const headerBtnStyle = {
	border: 'none',
	background: 'transparent',
	cursor: 'pointer',
	fontSize: '18px',
	lineHeight: '1',
	padding: '4px 8px'
    };

    const minBtn = document.createElement('button');
    minBtn.type = 'button';
    minBtn.textContent = '−';
    minBtn.setAttribute('aria-label', 'Minimalizuj');
    Object.assign(minBtn.style, headerBtnStyle);
    minBtn.addEventListener('click', function() {
	setGridPanelMinimized(true);
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Zamknij');
    Object.assign(closeBtn.style, headerBtnStyle);
    closeBtn.addEventListener('click', function() {
	removeGridExtractorPanel(false);
    });

    const headerActions = document.createElement('div');
    headerActions.setAttribute('data-endux-grid-header-actions', '1');
    Object.assign(headerActions.style, {
	display: 'flex',
	alignItems: 'center',
	gap: '2px',
	flexShrink: '0'
    });
    headerActions.appendChild(minBtn);
    headerActions.appendChild(closeBtn);

    header.appendChild(title);
    header.appendChild(headerActions);

    const body = document.createElement('div');
    body.setAttribute('data-endux-grid-section', 'body');
    Object.assign(body.style, {
	display: 'flex',
	flexDirection: 'row',
	flex: '1',
	minHeight: '0',
	gap: '16px',
	padding: '12px',
	overflow: 'hidden'
    });

    const left = document.createElement('div');
    left.setAttribute('data-endux-grid-section', 'left');
    Object.assign(left.style, {
	flex: 'none',
	width: defaultGridPanelLeftWidthPx() + 'px',
	minWidth: '180px',
	display: 'flex',
	flexDirection: 'column',
	gap: '0',
	minHeight: '0',
	overflow: 'hidden'
    });

    const tabBar = document.createElement('div');
    tabBar.setAttribute('data-endux-grid-tab-bar', '1');
    Object.assign(tabBar.style, {
	display: 'flex',
	flexDirection: 'row',
	flexShrink: '0',
	borderBottom: '1px solid #cbd5e1',
	background: '#e5e7eb'
    });
    const tabBtnExtract = document.createElement('button');
    tabBtnExtract.type = 'button';
    tabBtnExtract.textContent = 'Ekstrakcja wyników';
    tabBtnExtract.setAttribute('data-endux-grid-tab', 'extract');
    Object.assign(tabBtnExtract.style, {
	flex: '1',
	padding: '10px 12px',
	border: 'none',
	background: '#ffffff',
	fontWeight: '700',
	cursor: 'pointer',
	fontSize: '13px',
	color: '#111827',
	fontFamily: 'inherit'
    });
    const tabBtnCrawl = document.createElement('button');
    tabBtnCrawl.type = 'button';
    tabBtnCrawl.textContent = 'Auto-Crawler';
    tabBtnCrawl.setAttribute('data-endux-grid-tab', 'crawler');
    Object.assign(tabBtnCrawl.style, {
	flex: '1',
	padding: '10px 8px',
	border: 'none',
	background: '#d1d5db',
	fontWeight: '500',
	cursor: 'pointer',
	fontSize: '12px',
	color: '#4b5563',
	fontFamily: 'inherit'
    });
    const tabBtnSubtable = document.createElement('button');
    tabBtnSubtable.type = 'button';
    tabBtnSubtable.textContent = 'Podtabela';
    tabBtnSubtable.setAttribute('data-endux-grid-tab', 'subtable');
    Object.assign(tabBtnSubtable.style, {
	flex: '1',
	padding: '10px 8px',
	border: 'none',
	background: '#d1d5db',
	fontWeight: '500',
	cursor: 'pointer',
	fontSize: '12px',
	color: '#4b5563',
	fontFamily: 'inherit'
    });
    tabBtnExtract.style.padding = '10px 8px';
    tabBtnExtract.style.fontSize = '12px';
    tabBtnExtract.addEventListener('click', function() {
	switchGridPanelTab('extract');
	loadAndApplyGridPanelSplitWidth();
    });
    tabBtnCrawl.addEventListener('click', function() {
	switchGridPanelTab('crawler');
    });
    tabBtnSubtable.addEventListener('click', function() {
	switchGridPanelTab('subtable');
	loadAndApplyGridPanelSplitWidth();
    });
    tabBar.appendChild(tabBtnExtract);
    tabBar.appendChild(tabBtnCrawl);
    tabBar.appendChild(tabBtnSubtable);

    const tabHost = document.createElement('div');
    tabHost.setAttribute('data-endux-grid-tab-host', '1');
    Object.assign(tabHost.style, {
	display: 'flex',
	flexDirection: 'column',
	flex: '1',
	minHeight: '0',
	minWidth: '0',
	overflow: 'hidden',
	boxSizing: 'border-box'
    });

    const extractPane = document.createElement('div');
    extractPane.setAttribute('data-endux-grid-tab-pane', 'extract');
    Object.assign(extractPane.style, {
	display: 'flex',
	flexDirection: 'column',
	flex: '1',
	minHeight: '0',
	minWidth: '0',
	gap: '10px',
	overflow: 'auto',
	fontSize: '13px',
	color: '#444',
	boxSizing: 'border-box'
    });
    const help = document.createElement('p');
    help.style.margin = '0';
    help.innerHTML = 'Najpierw <strong>Wskaż element</strong> na wierszu nagłówka i <strong>Ustaw nagłówek</strong>. Potem ponownie <strong>Wskaż element</strong> na wierszu danych. <strong>Rozwiń</strong> / <strong>Cofnij</strong> pomagają trafić w cały wiersz (div).';
    extractPane.appendChild(help);

    const inlineTableRow = document.createElement('div');
    Object.assign(inlineTableRow.style, {
	display: 'flex',
	alignItems: 'flex-start',
	gap: '8px',
	flexWrap: 'wrap'
    });
    const inlineTableCb = document.createElement('input');
    inlineTableCb.type = 'checkbox';
    inlineTableCb.id = 'endux-grid-inline-tables-' + Math.random().toString(36).substr(2, 8);
    inlineTableCb.setAttribute('data-grid-inline-table-pref', '1');
    const inlineTableToggle = enduxAttachToggleUi(inlineTableCb);
    const inlineTableLbl = document.createElement('label');
    inlineTableLbl.htmlFor = inlineTableCb.id;
    inlineTableLbl.textContent = 'Panele przy tabelach na stronie (Kopiuj tabelę, checkboxy)';
    inlineTableLbl.style.cursor = 'pointer';
    inlineTableLbl.style.fontSize = '13px';
    inlineTableLbl.style.color = '#444';
    inlineTableLbl.style.lineHeight = '1.35';
    inlineTableCb.addEventListener('change', function() {
	var on = inlineTableCb.checked;
	chrome.storage.local.set({ inlineTableControlPanels: on }, function() {
	    if (on) {
		removeInlineTableControlPanelsFromPage();
		injectTablePanels(true);
	    } else {
		removeInlineTableControlPanelsFromPage();
	    }
	});
    });
    inlineTableRow.appendChild(inlineTableToggle.wrap);
    inlineTableRow.appendChild(inlineTableLbl);

    const preventDupWrap = document.createElement('div');
    Object.assign(preventDupWrap.style, {
	display: 'flex',
	flexDirection: 'column',
	gap: '4px'
    });
    const preventDupRow = document.createElement('div');
    Object.assign(preventDupRow.style, {
	display: 'flex',
	alignItems: 'flex-start',
	gap: '8px',
	flexWrap: 'wrap'
    });
    const preventDupCb = document.createElement('input');
    preventDupCb.type = 'checkbox';
    preventDupCb.id = 'endux-grid-prevent-dup-' + Math.random().toString(36).substr(2, 8);
    preventDupCb.setAttribute('data-grid-prevent-duplicates', '1');
    const preventDupToggle = enduxAttachToggleUi(preventDupCb);
    const preventDupLbl = document.createElement('label');
    preventDupLbl.htmlFor = preventDupCb.id;
    preventDupLbl.style.cursor = 'pointer';
    preventDupLbl.style.fontSize = '13px';
    preventDupLbl.style.color = '#444';
    preventDupLbl.style.lineHeight = '1.35';
    const preventDupStrong = document.createElement('strong');
    preventDupStrong.textContent = 'Zapobiegaj duplikatom';
    preventDupLbl.appendChild(preventDupStrong);
    preventDupCb.addEventListener('change', function() {
	chrome.storage.local.set({ preventDuplicates: preventDupCb.checked });
    });
    preventDupRow.appendChild(preventDupToggle.wrap);
    preventDupRow.appendChild(preventDupLbl);
    const preventDupHint = document.createElement('div');
    preventDupHint.textContent = 'Ostrzega i blokuje dołączanie tej samej tabeli dwukrotnie';
    Object.assign(preventDupHint.style, {
	fontSize: '12px',
	color: '#6c757d',
	lineHeight: '1.35',
	marginLeft: '50px'
    });
    preventDupWrap.appendChild(preventDupRow);
    preventDupWrap.appendChild(preventDupHint);

    const autoAppendWrap = document.createElement('div');
    Object.assign(autoAppendWrap.style, {
	display: 'flex',
	flexDirection: 'column',
	gap: '4px'
    });
    const autoAppendRow = document.createElement('div');
    Object.assign(autoAppendRow.style, {
	display: 'flex',
	alignItems: 'flex-start',
	gap: '8px',
	flexWrap: 'wrap'
    });
    const autoAppendCb = document.createElement('input');
    autoAppendCb.type = 'checkbox';
    autoAppendCb.id = 'endux-grid-auto-append-' + Math.random().toString(36).substr(2, 8);
    autoAppendCb.setAttribute('data-grid-auto-append', '1');
    const autoAppendToggle = enduxAttachToggleUi(autoAppendCb);
    const autoAppendLbl = document.createElement('label');
    autoAppendLbl.htmlFor = autoAppendCb.id;
    autoAppendLbl.style.cursor = 'pointer';
    autoAppendLbl.style.fontSize = '13px';
    autoAppendLbl.style.color = '#444';
    autoAppendLbl.style.lineHeight = '1.35';
    const autoAppendStrong = document.createElement('strong');
    autoAppendStrong.textContent = 'Auto-dołączanie';
    autoAppendLbl.appendChild(autoAppendStrong);
    autoAppendCb.addEventListener('change', function() {
	chrome.storage.local.set({ autoAppend: autoAppendCb.checked });
    });
    autoAppendRow.appendChild(autoAppendToggle.wrap);
    autoAppendRow.appendChild(autoAppendLbl);
    const autoAppendHint = document.createElement('div');
    autoAppendHint.textContent =
	'Automatycznie dołącza nową stronę do schowka po wykryciu paginacji';
    Object.assign(autoAppendHint.style, {
	fontSize: '12px',
	color: '#6c757d',
	lineHeight: '1.35',
	marginLeft: '50px'
    });
    autoAppendWrap.appendChild(autoAppendRow);
    autoAppendWrap.appendChild(autoAppendHint);

    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, { display: 'flex', flexWrap: 'wrap', gap: '8px' });

    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.textContent = 'Wskaż element';
    Object.assign(pickBtn.style, {
	padding: '8px 14px',
	borderRadius: '6px',
	border: 'none',
	background: '#2563eb',
	color: '#fff',
	fontWeight: '600',
	cursor: 'pointer',
	fontSize: '13px'
    });

    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.textContent = 'Rozwiń (parent)';
    Object.assign(expandBtn.style, {
	padding: '8px 14px',
	borderRadius: '6px',
	border: '1px solid #c4a894',
	background: '#fff',
	color: '#333',
	fontWeight: '600',
	cursor: 'pointer',
	fontSize: '13px'
    });

    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.textContent = 'Cofnij';
    Object.assign(undoBtn.style, {
	padding: '8px 14px',
	borderRadius: '6px',
	border: '1px solid #c4a894',
	background: '#fff',
	color: '#333',
	fontWeight: '600',
	cursor: 'pointer',
	fontSize: '13px'
    });

    pickBtn.addEventListener('click', function() {
	startGridPicker();
	showToast('Tryb wskazywania: kliknij element na stronie', 'success');
    });
    expandBtn.addEventListener('click', expandGridSelection);
    undoBtn.addEventListener('click', undoGridSelection);

    btnRow.appendChild(pickBtn);
    btnRow.appendChild(expandBtn);
    btnRow.appendChild(undoBtn);
    extractPane.appendChild(btnRow);

    const headerRow = document.createElement('div');
    Object.assign(headerRow.style, { display: 'flex', flexWrap: 'wrap', gap: '8px' });
    const setHeaderBtn = document.createElement('button');
    setHeaderBtn.type = 'button';
    setHeaderBtn.textContent = 'Ustaw nagłówek';
    Object.assign(setHeaderBtn.style, {
	padding: '8px 14px',
	borderRadius: '6px',
	border: '1px solid #15803d',
	background: '#f0fdf4',
	color: '#14532d',
	fontWeight: '600',
	cursor: 'pointer',
	fontSize: '13px'
    });
    setHeaderBtn.addEventListener('click', setGridHeaderFromCurrentSelection);
    const clearHeaderBtn = document.createElement('button');
    clearHeaderBtn.type = 'button';
    clearHeaderBtn.textContent = 'Usuń nagłówek';
    Object.assign(clearHeaderBtn.style, {
	padding: '8px 14px',
	borderRadius: '6px',
	border: '1px solid #c4a894',
	background: '#fff',
	color: '#666',
	fontWeight: '500',
	cursor: 'pointer',
	fontSize: '13px'
    });
    clearHeaderBtn.addEventListener('click', clearGridHeaderFromPanel);
    headerRow.appendChild(setHeaderBtn);
    headerRow.appendChild(clearHeaderBtn);
    extractPane.appendChild(headerRow);

    const appendCb = document.createElement('input');
    appendCb.type = 'checkbox';
    appendCb.id = 'endux-grid-append-' + Math.random().toString(36).substr(2, 8);
    const appendToggle = enduxAttachToggleUi(appendCb);
    const appendLbl = document.createElement('label');
    appendLbl.htmlFor = appendCb.id;
    appendLbl.textContent = 'Dołącz do schowka';
    appendLbl.style.cursor = 'pointer';
    appendLbl.style.fontSize = '13px';

    const includeHdrCb = document.createElement('input');
    includeHdrCb.type = 'checkbox';
    includeHdrCb.id = 'endux-grid-include-header-' + Math.random().toString(36).substr(2, 8);
    includeHdrCb.setAttribute('data-grid-include-header', '1');
    const includeHdrToggle = enduxAttachToggleUi(includeHdrCb);
    const includeHdrLbl = document.createElement('label');
    includeHdrLbl.htmlFor = includeHdrCb.id;
    includeHdrLbl.textContent = 'Z nagłówkiem';
    includeHdrLbl.style.cursor = 'pointer';
    includeHdrLbl.style.fontSize = '13px';
    includeHdrLbl.style.color = '#444';
    includeHdrCb.addEventListener('change', function() {
	chrome.storage.local.set({ includeHeaderPreference: includeHdrCb.checked });
	updateGridPreviewUI();
    });

    const copyBlock = document.createElement('div');
    Object.assign(copyBlock.style, {
	display: 'flex',
	flexDirection: 'column',
	gap: '10px',
	width: '100%'
    });

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.setAttribute('data-grid-copy-btn', '1');
    Object.assign(copyBtn.style, {
	padding: '10px 14px',
	borderRadius: '6px',
	border: 'none',
	background: '#ea580c',
	color: '#fff',
	fontWeight: '600',
	cursor: 'pointer',
	fontSize: '13px',
	lineHeight: '1.35',
	textAlign: 'center',
	alignSelf: 'flex-start',
	width: 'max-content',
	maxWidth: '100%',
	boxSizing: 'border-box'
    });
    copyBtn.addEventListener('click', function() {
	copyGridFromPanel(appendCb.checked);
    });

    const copyMetaRow = document.createElement('div');
    Object.assign(copyMetaRow.style, {
	display: 'flex',
	alignItems: 'center',
	gap: '10px',
	flexWrap: 'wrap',
	minWidth: '0'
    });

    copyMetaRow.appendChild(includeHdrToggle.wrap);
    copyMetaRow.appendChild(includeHdrLbl);
    copyMetaRow.appendChild(appendToggle.wrap);
    copyMetaRow.appendChild(appendLbl);

    copyBlock.appendChild(copyBtn);
    copyBlock.appendChild(copyMetaRow);
    extractPane.appendChild(copyBlock);

    extractPane.appendChild(inlineTableRow);
    extractPane.appendChild(preventDupWrap);
    extractPane.appendChild(autoAppendWrap);
    chrome.storage.local.get(
	['inlineTableControlPanels', 'preventDuplicates', 'autoAppend'],
	function(result) {
	    if (chrome.runtime.lastError) return;
	    if (inlineTableCb.isConnected) {
		inlineTableCb.checked = result.inlineTableControlPanels !== false;
		inlineTableToggle.sync();
	    }
	    if (preventDupCb.isConnected) {
		preventDupCb.checked = result.preventDuplicates !== false;
		preventDupToggle.sync();
	    }
	    if (autoAppendCb.isConnected) {
		autoAppendCb.checked = result.autoAppend === true;
		autoAppendToggle.sync();
	    }
	}
    );

    chrome.storage.local.get(['includeHeaderPreference'], function(result) {
	if (chrome.runtime.lastError) return;
	if (_gridPanelRoot && includeHdrCb.isConnected) {
	    includeHdrCb.checked = !!(result && result.includeHeaderPreference);
	    includeHdrToggle.sync();
	}
    });

    const right = document.createElement('div');
    right.setAttribute('data-endux-grid-section', 'right');
    Object.assign(right.style, {
	flex: '1',
	minWidth: '0',
	display: 'flex',
	flexDirection: 'column',
	gap: '8px',
	overflow: 'auto'
    });
    const status = document.createElement('div');
    status.setAttribute('data-grid-status', '1');
    Object.assign(status.style, {
	fontWeight: '600',
	fontSize: '13px',
	flex: '1',
	minWidth: '0'
    });
    status.textContent = 'Podgląd · brak wyboru';

    const clipboardInfoContainer = document.createElement('span');
    Object.assign(clipboardInfoContainer.style, {
	display: 'inline-flex',
	alignItems: 'center',
	gap: '6px',
	flexWrap: 'wrap',
	flexShrink: '0'
    });

    const clipboardInfo = document.createElement('span');
    clipboardInfo.id = 'clipboard-info-' + Math.random().toString(36).substr(2, 9);
    clipboardInfo.setAttribute('data-endux-grid-clipboard', '1');
    Object.assign(clipboardInfo.style, {
	fontSize: '13px',
	color: ENDUX_CLIPBOARD_ROW_COUNT_COLOR,
	fontWeight: '500',
	cursor: 'pointer',
	textDecoration: 'underline'
    });
    clipboardInfo.title = 'Kliknij, aby otworzyć zawartość schowka w nowej zakładce';
    clipboardInfo.addEventListener('mouseenter', function() {
	clipboardInfo.style.color = ENDUX_CLIPBOARD_ROW_COUNT_HOVER;
    });
    clipboardInfo.addEventListener('mouseleave', function() {
	clipboardInfo.style.color = ENDUX_CLIPBOARD_ROW_COUNT_COLOR;
    });
    clipboardInfo.addEventListener('click', function(e) {
	e.stopPropagation();
	openClipboardInNewTab();
    });

    const gridClearClipboardBtn = document.createElement('button');
    gridClearClipboardBtn.type = 'button';
    gridClearClipboardBtn.innerHTML = '🗑️';
    gridClearClipboardBtn.title = 'Wyczyść schowek';
    Object.assign(gridClearClipboardBtn.style, {
	background: 'none',
	border: 'none',
	cursor: 'pointer',
	padding: '2px 4px',
	fontSize: '14px',
	lineHeight: '1',
	opacity: '0.65'
    });
    gridClearClipboardBtn.addEventListener('mouseenter', function() {
	gridClearClipboardBtn.style.opacity = '1';
    });
    gridClearClipboardBtn.addEventListener('mouseleave', function() {
	gridClearClipboardBtn.style.opacity = '0.65';
    });
    gridClearClipboardBtn.addEventListener('click', function(e) {
	e.stopPropagation();
	chrome.storage.local.remove(['accumulatedClipboard', 'clipboardHashes'], function() {
	    updateAllClipboardInfo();
	    showToast('🗑️ Schowek wyczyszczony', 'success');
	});
    });

    clipboardInfoContainer.appendChild(clipboardInfo);
    clipboardInfoContainer.appendChild(gridClearClipboardBtn);

    const statusRow = document.createElement('div');
    Object.assign(statusRow.style, {
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'space-between',
	gap: '12px',
	width: '100%',
	minWidth: '0',
	flexShrink: '0'
    });
    statusRow.appendChild(status);
    statusRow.appendChild(clipboardInfoContainer);

    const selectionPath = document.createElement('div');
    selectionPath.setAttribute('data-grid-selection-path', '1');
    Object.assign(selectionPath.style, {
	display: 'none',
	flexShrink: '0',
	flexDirection: 'column',
	gap: '6px',
	fontSize: '11px',
	lineHeight: '1.45',
	color: '#334155',
	wordBreak: 'break-word',
	padding: '6px 8px',
	background: '#f1f5f9',
	border: '1px solid #cbd5e1',
	borderRadius: '6px',
	fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    });

    const pathViewRow = document.createElement('div');
    pathViewRow.setAttribute('data-grid-path-view', '1');
    Object.assign(pathViewRow.style, {
	display: 'flex',
	alignItems: 'flex-start',
	gap: '6px',
	flexWrap: 'wrap',
	maxHeight: '4.5em',
	overflow: 'auto'
    });
    const pathPrefix = document.createElement('span');
    pathPrefix.textContent = 'Wskazany element:';
    Object.assign(pathPrefix.style, {
	flexShrink: '0',
	fontWeight: '700',
	color: '#1e293b'
    });
    const pathText = document.createElement('span');
    pathText.setAttribute('data-grid-selection-path-text', '1');
    Object.assign(pathText.style, {
	flex: '1',
	minWidth: '0',
	wordBreak: 'break-word'
    });
    const pathEditBtn = document.createElement('button');
    pathEditBtn.type = 'button';
    pathEditBtn.setAttribute('data-grid-selection-path-edit-btn', '1');
    pathEditBtn.setAttribute('aria-label', 'Edytuj selektor wskazanego elementu');
    pathEditBtn.title = 'Edytuj selektor CSS (document.querySelector)';
    pathEditBtn.innerHTML =
	'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';
    Object.assign(pathEditBtn.style, {
	flexShrink: '0',
	alignSelf: 'flex-start',
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	padding: '4px',
	margin: '0',
	border: 'none',
	borderRadius: '4px',
	background: 'transparent',
	color: '#475569',
	cursor: 'pointer',
	lineHeight: '0'
    });
    pathEditBtn.addEventListener('mouseenter', function() {
	pathEditBtn.style.background = '#e2e8f0';
    });
    pathEditBtn.addEventListener('mouseleave', function() {
	pathEditBtn.style.background = 'transparent';
    });
    pathEditBtn.addEventListener('click', function(ev) {
	ev.preventDefault();
	ev.stopPropagation();
	openGridSelectionPathEdit();
    });

    pathViewRow.appendChild(pathPrefix);
    pathViewRow.appendChild(pathText);
    pathViewRow.appendChild(pathEditBtn);
    selectionPath.appendChild(pathViewRow);

    const pathEditRow = document.createElement('div');
    pathEditRow.setAttribute('data-grid-path-edit', '1');
    Object.assign(pathEditRow.style, {
	display: 'none',
	flexDirection: 'column',
	gap: '6px'
    });
    const pathInput = document.createElement('input');
    pathInput.type = 'text';
    pathInput.setAttribute('data-grid-selection-path-input', '1');
    pathInput.setAttribute('autocomplete', 'off');
    pathInput.setAttribute('spellcheck', 'false');
    pathInput.placeholder = 'Selektor CSS (document.querySelector)';
    Object.assign(pathInput.style, {
	width: '100%',
	boxSizing: 'border-box',
	padding: '6px 8px',
	fontSize: '11px',
	fontFamily: 'inherit',
	border: '1px solid #94a3b8',
	borderRadius: '4px',
	background: '#fff',
	color: '#0f172a'
    });
    const pathEditHint = document.createElement('div');
    pathEditHint.textContent = 'Enter — zastosuj · Esc — anuluj · przy wielu dopasowaniach używany jest pierwszy poza panelem';
    Object.assign(pathEditHint.style, {
	fontSize: '10px',
	color: '#64748b',
	lineHeight: '1.35'
    });
    const pathEditActions = document.createElement('div');
    Object.assign(pathEditActions.style, {
	display: 'flex',
	flexWrap: 'wrap',
	gap: '8px',
	alignItems: 'center'
    });
    const pathApplyBtn = document.createElement('button');
    pathApplyBtn.type = 'button';
    pathApplyBtn.textContent = 'Zastosuj';
    Object.assign(pathApplyBtn.style, {
	padding: '4px 12px',
	fontSize: '11px',
	borderRadius: '4px',
	border: 'none',
	background: '#f97316',
	color: '#fff',
	cursor: 'pointer',
	fontWeight: '700',
	fontFamily: 'inherit'
    });
    const pathCancelBtn = document.createElement('button');
    pathCancelBtn.type = 'button';
    pathCancelBtn.textContent = 'Anuluj';
    Object.assign(pathCancelBtn.style, {
	padding: '4px 12px',
	fontSize: '11px',
	borderRadius: '4px',
	border: '1px solid #cbd5e1',
	background: '#fff',
	color: '#334155',
	cursor: 'pointer',
	fontWeight: '600',
	fontFamily: 'inherit'
    });
    pathApplyBtn.addEventListener('click', function(ev) {
	ev.preventDefault();
	commitGridSelectionPathEdit();
    });
    pathCancelBtn.addEventListener('click', function(ev) {
	ev.preventDefault();
	cancelGridSelectionPathEdit();
    });
    pathInput.addEventListener('keydown', function(ev) {
	if (ev.key === 'Enter') {
	    ev.preventDefault();
	    commitGridSelectionPathEdit();
	} else if (ev.key === 'Escape') {
	    ev.preventDefault();
	    cancelGridSelectionPathEdit();
	}
    });

    pathEditActions.appendChild(pathApplyBtn);
    pathEditActions.appendChild(pathCancelBtn);
    pathEditRow.appendChild(pathInput);
    pathEditRow.appendChild(pathEditHint);
    pathEditRow.appendChild(pathEditActions);
    selectionPath.appendChild(pathEditRow);

    const preview = document.createElement('div');
    preview.setAttribute('data-grid-preview', '1');
    preview.style.overflow = 'auto';
    preview.style.flex = '1';
    preview.style.background = '#fff';
    preview.style.border = '1px solid #e8d5c4';
    preview.style.borderRadius = '6px';
    preview.style.padding = '6px';
    preview.addEventListener(
	'mousedown',
	function() {
	    if (!_gridPanelRoot) return;
	    if ((_gridPanelRoot.getAttribute('data-endux-grid-active-tab') || 'extract') !== 'subtable') return;
	    _gridSubtablePreviewPointerDown = true;
	},
	true
    );
    if (!_gridSubtablePreviewGlobalMouseUpBound) {
	_gridSubtablePreviewGlobalMouseUpBound = true;
	window.addEventListener('mouseup', enduxGridSubtablePreviewGlobalMouseUp, true);
    }

    right.appendChild(statusRow);
    right.appendChild(selectionPath);
    right.appendChild(preview);

    const splitCol = document.createElement('div');
    splitCol.setAttribute('data-endux-grid-splitter', '1');
    splitCol.title = 'Przeciągnij, aby zmienić szerokość kolumny z podglądem';
    Object.assign(splitCol.style, {
	flexShrink: '0',
	width: '10px',
	cursor: 'col-resize',
	alignSelf: 'stretch',
	display: 'flex',
	alignItems: 'stretch',
	justifyContent: 'center',
	boxSizing: 'border-box',
	padding: '0 1px',
	userSelect: 'none'
    });
    const splitBar = document.createElement('div');
    Object.assign(splitBar.style, {
	width: '4px',
	borderRadius: '3px',
	background: '#e8d5c4',
	alignSelf: 'stretch',
	minHeight: '48px',
	margin: '0 auto',
	transition: 'background 0.15s ease'
    });
    splitCol.appendChild(splitBar);
    splitCol.addEventListener('mouseenter', function() {
	splitBar.style.background = '#d4a574';
    });
    splitCol.addEventListener('mouseleave', function() {
	if (splitCol.style.opacity !== '0.85') {
	    splitBar.style.background = '#e8d5c4';
	}
    });

    const crawlPane = document.createElement('div');
    crawlPane.setAttribute('data-endux-grid-tab-pane', 'crawler');
    Object.assign(crawlPane.style, {
	display: 'none',
	flexDirection: 'column',
	flex: '1',
	minHeight: '0',
	overflow: 'auto',
	gap: '10px',
	fontSize: '13px',
	color: '#333',
	boxSizing: 'border-box'
    });

    const crawlTitle = document.createElement('div');
    crawlTitle.textContent = 'Auto-Crawler';
    Object.assign(crawlTitle.style, { fontWeight: '700', fontSize: '14px', marginBottom: '2px' });
    crawlPane.appendChild(crawlTitle);

    const inputBase = {
	flex: '1',
	minWidth: '0',
	padding: '6px 10px',
	borderRadius: '6px',
	border: '1px solid #e8d5c4',
	fontSize: '13px',
	boxSizing: 'border-box',
	fontFamily: 'inherit',
	background: '#fff'
    };

    const dalejRow = document.createElement('div');
    Object.assign(dalejRow.style, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' });
    const dalejLbl = document.createElement('span');
    dalejLbl.textContent = 'Klasa „Dalej”';
    dalejLbl.style.flexShrink = '0';
    dalejLbl.style.minWidth = '100px';
    const crawlerClassInput = document.createElement('input');
    crawlerClassInput.type = 'text';
    crawlerClassInput.setAttribute('data-grid-crawler-class', '1');
    crawlerClassInput.placeholder = 'np. next-page';
    Object.assign(crawlerClassInput.style, inputBase);
    const pickCrawlerClassBtn = document.createElement('button');
    pickCrawlerClassBtn.type = 'button';
    pickCrawlerClassBtn.textContent = '🎯';
    pickCrawlerClassBtn.title = 'Wskaż przycisk „Dalej” na stronie';
    Object.assign(pickCrawlerClassBtn.style, {
	padding: '6px 12px',
	borderRadius: '6px',
	border: '1px solid #2563eb',
	background: '#fff',
	color: '#2563eb',
	fontWeight: '600',
	cursor: 'pointer',
	fontSize: '14px',
	flexShrink: '0'
    });
    pickCrawlerClassBtn.addEventListener('click', function() {
	startSelectorPicker('crawlerClass');
	showToast('Tryb wskazywania: kliknij przycisk „Dalej” na stronie', 'success');
    });
    dalejRow.appendChild(dalejLbl);
    dalejRow.appendChild(crawlerClassInput);
    dalejRow.appendChild(pickCrawlerClassBtn);
    crawlPane.appendChild(dalejRow);

    const pagRow = document.createElement('div');
    Object.assign(pagRow.style, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' });
    const pagLbl = document.createElement('span');
    pagLbl.textContent = 'Paginator';
    pagLbl.style.flexShrink = '0';
    pagLbl.style.minWidth = '100px';
    const crawlerPaginatorInput = document.createElement('input');
    crawlerPaginatorInput.type = 'text';
    crawlerPaginatorInput.setAttribute('data-grid-crawler-paginator', '1');
    crawlerPaginatorInput.placeholder = 'np. &page=1-100';
    Object.assign(crawlerPaginatorInput.style, inputBase);
    pagRow.appendChild(pagLbl);
    pagRow.appendChild(crawlerPaginatorInput);
    crawlPane.appendChild(pagRow);

    const firstHdrLabel = document.createElement('label');
    Object.assign(firstHdrLabel.style, {
	display: 'flex',
	alignItems: 'center',
	gap: '10px',
	cursor: 'pointer',
	fontWeight: '500'
    });
    const crawlerFirstPageHeaderCheckbox = document.createElement('input');
    crawlerFirstPageHeaderCheckbox.type = 'checkbox';
    crawlerFirstPageHeaderCheckbox.setAttribute('data-grid-crawler-first-header', '1');
    const crawlerFphToggle = enduxAttachToggleUi(crawlerFirstPageHeaderCheckbox);
    firstHdrLabel.appendChild(crawlerFphToggle.wrap);
    firstHdrLabel.appendChild(document.createTextNode('Pierwsza strona z nagłówkiem, kolejne bez'));
    crawlPane.appendChild(firstHdrLabel);

    const activeLabel = document.createElement('label');
    Object.assign(activeLabel.style, {
	display: 'flex',
	alignItems: 'center',
	gap: '10px',
	cursor: 'pointer',
	fontWeight: '600',
	marginTop: '4px'
    });
    const crawlerActiveCheckbox = document.createElement('input');
    crawlerActiveCheckbox.type = 'checkbox';
    crawlerActiveCheckbox.setAttribute('data-grid-crawler-active', '1');
    const crawlerActiveToggle = enduxAttachToggleUi(crawlerActiveCheckbox);
    activeLabel.appendChild(crawlerActiveToggle.wrap);
    activeLabel.appendChild(document.createTextNode('Uruchom Crawler'));
    crawlPane.appendChild(activeLabel);

    const crawlHint = document.createElement('div');
    crawlHint.textContent =
	'Automatycznie klika „Dalej” po skopiowaniu tabeli (lub używa paginatora), aż do końca danych.';
    Object.assign(crawlHint.style, { fontSize: '12px', color: '#6c757d', lineHeight: '1.4' });
    crawlPane.appendChild(crawlHint);

    chrome.storage.local.get(
	['crawlerClass', 'crawlerPaginator', 'crawlerActive', 'crawlerFirstPageHeader'],
	function(result) {
	    if (chrome.runtime.lastError || !crawlerClassInput.isConnected) return;
	    if (result.crawlerClass) crawlerClassInput.value = result.crawlerClass;
	    if (result.crawlerPaginator) crawlerPaginatorInput.value = result.crawlerPaginator;
	    crawlerActiveCheckbox.checked = result.crawlerActive === true;
	    crawlerActiveToggle.sync();
	    crawlerFirstPageHeaderCheckbox.checked = result.crawlerFirstPageHeader === true;
	    crawlerFphToggle.sync();
	}
    );

    crawlerClassInput.addEventListener('input', function() {
	chrome.storage.local.set({ crawlerClass: crawlerClassInput.value.trim() });
    });
    crawlerPaginatorInput.addEventListener('input', function() {
	chrome.storage.local.set({ crawlerPaginator: crawlerPaginatorInput.value.trim() });
    });
    crawlerFirstPageHeaderCheckbox.addEventListener('change', function() {
	chrome.storage.local.set({ crawlerFirstPageHeader: crawlerFirstPageHeaderCheckbox.checked });
    });
    crawlerActiveCheckbox.addEventListener('change', function() {
	var active = crawlerActiveCheckbox.checked;
	var className = crawlerClassInput.value.trim();
	var paginator = crawlerPaginatorInput.value.trim();
	if (active && !className && !paginator) {
	    showToast('❌ Podaj klasę przycisku „Dalej” lub Paginator', 'error');
	    crawlerActiveCheckbox.checked = false;
	    crawlerActiveToggle.sync();
	    return;
	}
	chrome.storage.local.set({ crawlerActive: active, crawlerIsFirstPage: true }, function() {
	    if (active) {
		showToast('🚀 Crawler uruchomiony', 'success');
		handleCrawlerStep();
	    } else {
		showToast('⏹️ Crawler zatrzymany', 'warning');
	    }
	});
    });

    const subtablePane = document.createElement('div');
    subtablePane.setAttribute('data-endux-grid-tab-pane', 'subtable');
    Object.assign(subtablePane.style, {
	display: 'none',
	flexDirection: 'column',
	flex: '1',
	minHeight: '0',
	overflow: 'auto',
	gap: '10px',
	fontSize: '13px',
	color: '#333',
	boxSizing: 'border-box'
    });
    const subtableTitle = document.createElement('div');
    subtableTitle.textContent = 'Podtabela — pola i nawigacja';
    Object.assign(subtableTitle.style, { fontWeight: '700', fontSize: '14px', marginBottom: '2px' });
    subtablePane.appendChild(subtableTitle);

    const subtableIntro = document.createElement('p');
    subtableIntro.style.margin = '0';
    subtableIntro.style.lineHeight = '1.45';
    subtableIntro.style.color = '#444';
    subtableIntro.innerHTML =
	'<strong>Wiersz danych</strong> wybierasz w zakładce <strong>Ekstrakcja wyników</strong> (Wskaż element / Rozwiń / Cofnij). Tutaj dodajesz <strong>pola do pobrania</strong> z każdego wiersza — podgląd wartości i podświetlenie na stronie używają <strong>tego samego wiersza siatki</strong>: kliknij inny wiersz danych na stronie (w zakładce Podtabela), aby zmienić kontekst. Niżej: klik rozwinięcia i powrót przy kopiowaniu / crawlerze.';
    subtablePane.appendChild(subtableIntro);

    const subtableFieldHint = document.createElement('div');
    subtableFieldHint.textContent =
	'Pola (tekst z elementu): bez wyboru wiersza w Ekstrakcji — ścieżka od body; po wyborze wiersza — względem wiersza (jak rozwinięcie):';
    Object.assign(subtableFieldHint.style, { fontWeight: '600', marginTop: '4px', fontSize: '13px' });
    subtablePane.appendChild(subtableFieldHint);
    const subtableFieldRow = document.createElement('div');
    Object.assign(subtableFieldRow.style, { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' });
    const subtableFieldPickBtn = document.createElement('button');
    subtableFieldPickBtn.type = 'button';
    subtableFieldPickBtn.textContent = 'Wskaż pole';
    Object.assign(subtableFieldPickBtn.style, {
	padding: '8px 14px',
	borderRadius: '6px',
	border: 'none',
	background: '#7c3aed',
	color: '#fff',
	fontWeight: '600',
	cursor: 'pointer',
	fontSize: '13px',
	fontFamily: 'inherit'
    });
    subtableFieldPickBtn.addEventListener('click', function() {
	startSubtableFieldPicker();
    });
    subtableFieldRow.appendChild(subtableFieldPickBtn);
    subtablePane.appendChild(subtableFieldRow);

    const subtableEnableRow = document.createElement('label');
    Object.assign(subtableEnableRow.style, {
	display: 'flex',
	alignItems: 'center',
	gap: '10px',
	cursor: 'pointer',
	fontWeight: '600',
	flexWrap: 'wrap'
    });
    const subtableEnabledCb = document.createElement('input');
    subtableEnabledCb.type = 'checkbox';
    subtableEnabledCb.setAttribute('data-grid-subtable-enabled', '1');
    const subtableEnabledToggle = enduxAttachToggleUi(subtableEnabledCb);
    subtableEnableRow.appendChild(subtableEnabledToggle.wrap);
    subtableEnableRow.appendChild(document.createTextNode('Włącz przejście po wierszach (podtabela)'));
    subtablePane.appendChild(subtableEnableRow);

    const subtableHistRow = document.createElement('label');
    Object.assign(subtableHistRow.style, {
	display: 'flex',
	alignItems: 'center',
	gap: '10px',
	cursor: 'pointer',
	fontWeight: '500',
	flexWrap: 'wrap'
    });
    const subtableHistCb = document.createElement('input');
    subtableHistCb.type = 'checkbox';
    subtableHistCb.setAttribute('data-grid-subtable-use-history', '1');
    const subtableHistToggle = enduxAttachToggleUi(subtableHistCb);
    subtableHistRow.appendChild(subtableHistToggle.wrap);
    subtableHistRow.appendChild(
	document.createTextNode('Powrót przez Back przeglądarki')
    );
    subtablePane.appendChild(subtableHistRow);

    const subtableDebugRow = document.createElement('label');
    Object.assign(subtableDebugRow.style, {
	display: 'flex',
	alignItems: 'center',
	gap: '10px',
	cursor: 'pointer',
	fontWeight: '500',
	flexWrap: 'wrap'
    });
    const subtableDebugCb = document.createElement('input');
    subtableDebugCb.type = 'checkbox';
    subtableDebugCb.setAttribute('data-grid-subtable-debug', '1');
    const subtableDebugToggle = enduxAttachToggleUi(subtableDebugCb);
    subtableDebugRow.appendChild(subtableDebugToggle.wrap);
    subtableDebugRow.appendChild(
	document.createTextNode('Debug')
    );
    subtablePane.appendChild(subtableDebugRow);

    const expandLbl = document.createElement('div');
    expandLbl.textContent = 'Klik rozwijający (względem każdego wiersza danych):';
    expandLbl.style.fontWeight = '600';
    expandLbl.style.marginTop = '4px';
    subtablePane.appendChild(expandLbl);
    const expandRow = document.createElement('div');
    Object.assign(expandRow.style, { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' });
    const expandPickBtn = document.createElement('button');
    expandPickBtn.type = 'button';
    expandPickBtn.setAttribute('data-grid-subtable-expand-btn', '1');
    expandPickBtn.textContent = 'Wskaż klik rozwijający';
    Object.assign(expandPickBtn.style, {
	padding: '6px 12px',
	borderRadius: '6px',
	border: '1px solid #0f766e',
	background: '#ccfbf1',
	color: '#115e59',
	fontWeight: '600',
	cursor: 'pointer',
	fontSize: '12px',
	fontFamily: 'inherit'
    });
    expandPickBtn.addEventListener('click', function() {
	startSubtableExpandPicker();
    });
    const expandDisplay = document.createElement('span');
    expandDisplay.setAttribute('data-grid-subtable-expand-display', '1');
    Object.assign(expandDisplay.style, {
	fontSize: '12px',
	color: '#64748b',
	flex: '1',
	minWidth: '0',
	whiteSpace: 'nowrap'
    });
    expandDisplay.textContent = 'Nie wybrano';
    expandRow.appendChild(expandPickBtn);
    expandRow.appendChild(expandDisplay);
    subtablePane.appendChild(expandRow);

    const backLbl = document.createElement('div');
    backLbl.textContent = 'Klik powrotu (dokument — ten sam co rozwinięcie lub np. „Wstecz”):';
    backLbl.style.fontWeight = '600';
    backLbl.style.marginTop = '6px';
    subtablePane.appendChild(backLbl);
    const backRow = document.createElement('div');
    Object.assign(backRow.style, { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' });
    const backPickBtn = document.createElement('button');
    backPickBtn.type = 'button';
    backPickBtn.setAttribute('data-grid-subtable-back-btn', '1');
    backPickBtn.textContent = 'Wskaż powrót';
    Object.assign(backPickBtn.style, {
	padding: '6px 12px',
	borderRadius: '6px',
	border: '1px solid #1d4ed8',
	background: '#dbeafe',
	color: '#1e40af',
	fontWeight: '600',
	cursor: 'pointer',
	fontSize: '12px',
	fontFamily: 'inherit'
    });
    backPickBtn.addEventListener('click', function() {
	startSelectorPicker(
	    'gridSubtableBackSelector',
	    '🎯 Kliknij element powrotu (np. Wstecz / zamknij) — Esc lub Anuluj w nagłówku panelu.'
	);
    });
    const backDisplay = document.createElement('span');
    backDisplay.setAttribute('data-grid-subtable-back-display', '1');
    Object.assign(backDisplay.style, {
	fontSize: '12px',
	color: '#64748b',
	flex: '1',
	minWidth: '0',
	whiteSpace: 'nowrap'
    });
    backDisplay.textContent = 'Nie wybrano';
    backRow.appendChild(backPickBtn);
    backRow.appendChild(backDisplay);
    subtablePane.appendChild(backRow);

    const subtableFoot = document.createElement('div');
    subtableFoot.textContent =
	'Jeśli nie używasz history.back(), musisz wskazać przycisk powrotu — inaczej przejście zostanie pominięte. history.back() może zmienić stronę; wtedy pętla się przerwie.';
    Object.assign(subtableFoot.style, { fontSize: '12px', color: '#6c757d', lineHeight: '1.4' });
    subtablePane.appendChild(subtableFoot);

    subtableEnabledCb.addEventListener('change', function() {
	chrome.storage.local.set({ gridSubtableEnabled: subtableEnabledCb.checked });
    });
    subtableHistCb.addEventListener('change', function() {
	chrome.storage.local.set({ gridSubtableUseHistoryBack: subtableHistCb.checked });
    });
    subtableDebugCb.addEventListener('change', function() {
	chrome.storage.local.set({ gridSubtableDebugConfirm: subtableDebugCb.checked }, function() {
	    if (chrome.runtime.lastError) return;
	    enduxRefreshSubtableTabDisplays();
	});
    });

    chrome.storage.local.get(ENDUX_SUBTABLE_STORAGE_KEYS, function(su) {
	if (chrome.runtime.lastError || !subtableEnabledCb.isConnected) return;
	enduxSyncSubtableExportCacheFromSlice(su || {});
	subtableEnabledCb.checked = su.gridSubtableEnabled === true;
	subtableEnabledToggle.sync();
	subtableHistCb.checked = su.gridSubtableUseHistoryBack === true;
	subtableHistToggle.sync();
	subtableDebugCb.checked = su.gridSubtableDebugConfirm === true;
	subtableDebugToggle.sync();
	enduxApplySubtableDisplaysToPanel(root, su || {});
    });

    tabHost.appendChild(extractPane);
    tabHost.appendChild(crawlPane);
    tabHost.appendChild(subtablePane);
    left.appendChild(tabBar);
    left.appendChild(tabHost);
    body.appendChild(left);
    body.appendChild(splitCol);
    body.appendChild(right);
    attachGridPanelSplitDrag(splitCol, left, body);

    const minChip = document.createElement('button');
    minChip.type = 'button';
    minChip.setAttribute('data-endux-grid-minimize-chip', '1');
    minChip.setAttribute('aria-label', 'Przywróć panel ekstrakcji wyników');
    minChip.title = 'EnduX — panel ekstrakcji wyników — kliknij, aby rozwinąć';
    var chipImg = document.createElement('img');
    chipImg.alt = '';
    chipImg.setAttribute('aria-hidden', 'true');
    chipImg.draggable = false;
    try {
	chipImg.src = chrome.runtime.getURL('images/icon48.png');
    } catch (e) {
	chipImg.src = '';
    }
    Object.assign(chipImg.style, {
	width: '36px',
	height: '36px',
	objectFit: 'contain',
	display: 'block',
	pointerEvents: 'none'
    });
    minChip.appendChild(chipImg);
    Object.assign(minChip.style, {
	display: 'none',
	alignItems: 'center',
	justifyContent: 'center',
	width: '100%',
	height: '100%',
	border: 'none',
	background: '#fff',
	boxShadow: 'inset 0 0 0 1px #e8d5c4',
	lineHeight: '0',
	cursor: 'pointer',
	padding: '0'
    });
    minChip.addEventListener('click', function() {
	setGridPanelMinimized(false);
    });

    const heightHandle = document.createElement('div');
    heightHandle.setAttribute('data-endux-grid-height-handle', '1');
    heightHandle.title = 'Przeciągnij w pionie, aby zmienić wysokość panelu';
    Object.assign(heightHandle.style, {
	flexShrink: '0',
	height: '10px',
	cursor: 'ns-resize',
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	userSelect: 'none',
	boxSizing: 'border-box',
	padding: '2px 0'
    });
    const heightBar = document.createElement('div');
    Object.assign(heightBar.style, {
	height: '3px',
	width: '56px',
	borderRadius: '3px',
	background: '#e8d5c4',
	transition: 'background 0.15s ease'
    });
    heightHandle.appendChild(heightBar);
    heightHandle.addEventListener('mouseenter', function() {
	heightBar.style.background = '#d4a574';
    });
    heightHandle.addEventListener('mouseleave', function() {
	if (heightHandle.style.opacity !== '0.85') {
	    heightBar.style.background = '#e8d5c4';
	}
    });

    root.appendChild(heightHandle);
    root.appendChild(header);
    root.appendChild(body);
    root.appendChild(minChip);
    document.body.appendChild(root);
    attachGridPanelHeightDrag(heightHandle, root);
    restoreGridPanelExpandedLayoutInDom();
    saveGridPanelUiState('visible');
    loadAndApplyGridPanelSplitWidth();
    loadAndApplyGridPanelHeightPx();
    updateGridCopyButtonLabel();
    updateAllClipboardInfo();
    tryRestoreSavedGridSelectionOrAutoDetect();
}

// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'getPageSource') {
	// Get the outerHTML of the page
	const pageSource = document.documentElement.outerHTML;
	
	// Send the page source back to the background script or popup
	sendResponse({ pageSource: pageSource });
    } else if (request.action === 'updateClipboardInfo') {
	// Update clipboard info on this page
	updateAllClipboardInfo();
	sendResponse({ success: true });
    } else if (request.action === 'enduxApplyStorageReset') {
	enduxApplyFullSettingsReset();
	sendResponse({ success: true });
    } else if (request.action === 'startCrawler') {
        handleCrawlerStep();
        sendResponse({ success: true });
    } else if (request.action === 'startSelectorPicker') {
        startSelectorPicker(request.storageKey || 'crawlerClass');
        sendResponse({ success: true });
    } else if (request.action === 'showPanels') {
	chrome.storage.local.get(['extensionEnabled'], function(result) {
	    if (result.extensionEnabled === false) {
		sendResponse({ success: false, message: 'Rozszerzenie jest wyłączone' });
		return;
	    }
	    removeExistingPanels();
	    injectTablePanels(true);
	    showToast('✅ Panele EnduX pokazane', 'success');
	    sendResponse({ success: true });
	});
	return true;
    } else if (request.action === 'showGridExtractorPanel') {
	chrome.storage.local.get(['extensionEnabled'], function(result) {
	    if (result.extensionEnabled === false) {
		sendResponse({ success: false, message: 'Rozszerzenie jest wyłączone' });
		return;
	    }
	    injectGridExtractorPanel();
	    showToast('Panel ekstrakcji wyników', 'success');
	    sendResponse({ success: true });
	});
	return true;
    } else if (request.action === 'copyTable') {
	// Check if extension is enabled
	chrome.storage.local.get(['extensionEnabled', 'includeHeaderPreference'], function(result) {
	    const isEnabled = result.extensionEnabled !== false; // Default to true
	    
	    if (!isEnabled) {
		sendResponse({ success: false, message: 'Rozszerzenie jest wyłączone' });
		return;
	    }
	    
	    // Use preference if includeHeader is not explicitly set
	    const includeHeader = request.includeHeader !== undefined ? request.includeHeader : (result.includeHeaderPreference || false);
	    
	    // Find the best table to copy (including tables in iframes)
	    const tables = getAllTables();
	    let targetTable = null;
	    
	    if (tables.length > 0) {
		// If click coordinates are provided (from context menu), use them to find the closest table
		if (request.clickX !== undefined && request.clickY !== undefined) {
		    const clickX = request.clickX;
		    const clickY = request.clickY;
		    let closestTable = null;
		    let closestDistance = Infinity;
		    
		    for (let i = 0; i < tables.length; i++) {
			const rect = tables[i].getBoundingClientRect();
			// Check if click is within table bounds (accounting for scroll)
			const scrollX = window.scrollX || window.pageXOffset;
			const scrollY = window.scrollY || window.pageYOffset;
			const tableLeft = rect.left + scrollX;
			const tableTop = rect.top + scrollY;
			const tableRight = tableLeft + rect.width;
			const tableBottom = tableTop + rect.height;
			
			// If click is inside table, use it
			if (clickX >= tableLeft && clickX <= tableRight && clickY >= tableTop && clickY <= tableBottom) {
			    targetTable = tables[i];
			    break;
			}
			
			// Otherwise, calculate distance to table center
			const tableCenterX = tableLeft + (rect.width / 2);
			const tableCenterY = tableTop + (rect.height / 2);
			const distance = Math.sqrt(Math.pow(clickX - tableCenterX, 2) + Math.pow(clickY - tableCenterY, 2));
			
			if (distance < closestDistance) {
			    closestDistance = distance;
			    closestTable = tables[i];
			}
		    }
		    
		    // Use closest table if no table contains the click
		    if (!targetTable && closestTable) {
			targetTable = closestTable;
		    }
		}
		
		// If no table found yet, try to find table based on selection or active element
		if (!targetTable) {
		    const selection = window.getSelection();
		    const activeElement = document.activeElement;
		    
		    // If there's a text selection, try to find table containing it
		    if (selection && selection.rangeCount > 0) {
			const range = selection.getRangeAt(0);
			let node = range.commonAncestorContainer;
			
			// Walk up the DOM tree to find a table
			while (node && node.nodeType !== Node.ELEMENT_NODE) {
			    node = node.parentNode;
			}
			
			while (node && node.tagName !== 'TABLE') {
			    node = node.parentElement;
			}
			
			if (node && node.tagName === 'TABLE') {
			    targetTable = node;
			}
		    }
		    
		    // If no table from selection, try active element
		    if (!targetTable && activeElement) {
			let node = activeElement;
			while (node && node.tagName !== 'TABLE') {
			    node = node.parentElement;
			}
			if (node && node.tagName === 'TABLE') {
			    targetTable = node;
			}
		    }
		}
		
		// If still no table, find the table closest to center of viewport
		if (!targetTable) {
		    const viewportCenter = window.innerHeight / 2;
		    let closestTable = null;
		    let closestDistance = Infinity;
		    
		    for (let i = 0; i < tables.length; i++) {
			const rect = tables[i].getBoundingClientRect();
			// Check if table is visible in viewport
			if (rect.top < window.innerHeight && rect.bottom > 0) {
			    // Calculate distance from viewport center
			    const tableCenter = rect.top + (rect.height / 2);
			    const distance = Math.abs(tableCenter - viewportCenter);
			    
			    if (distance < closestDistance) {
				closestDistance = distance;
				closestTable = tables[i];
			    }
			}
		    }
		    
		    targetTable = closestTable;
		}
		
		// Fallback: use first visible table in viewport
		if (!targetTable) {
		for (let i = 0; i < tables.length; i++) {
		    const rect = tables[i].getBoundingClientRect();
		    if (rect.top >= 0 && rect.top < window.innerHeight) {
			targetTable = tables[i];
			break;
			}
		    }
		}
		
		// Last resort: use the first table on the page
		if (!targetTable && tables.length > 0) {
		    targetTable = tables[0];
		}
	    }
	    
	    if (targetTable) {
		// Use append mode if specified (default false for context menu)
		const append = request.append || false;
		copyTableToClipboard(targetTable, includeHeader, append).then(function(result) {
		    if (result.success) {
			const message = append ? '📋 Tabela dołączona do schowka' : '📋 Tabela skopiowana do schowka';
			showToast(message, 'success', result.rowCount);
			// Update all clipboard info elements on the page
			updateAllClipboardInfo();
			sendResponse({ success: true, message: message, rowCount: result.rowCount });
		    } else {
			// Don't show error toast if it's a duplicate (warning already shown)
			if (!result.isDuplicate) {
			    showToast('❌ Nie udało się skopiować tabeli', 'error');
			}
			sendResponse({ success: false, message: result.isDuplicate ? 'Duplikat wykryty' : 'Nie udało się skopiować tabeli' });
		    }
		});
	    } else {
		showToast('❌ Nie znaleziono tabeli na stronie', 'error');
		sendResponse({ success: false, message: 'Nie znaleziono tabeli na stronie' });
	    }
	});
	
	return true; // Keep message channel open for async response
    }
    
    return true;
});

// Keyboard shortcuts: Shift+C (copy table) and Shift+A (append table)
document.addEventListener('keydown', function(event) {
    // Check if extension is enabled
    chrome.storage.local.get(['extensionEnabled'], function(result) {
	const isEnabled = result.extensionEnabled !== false; // Default to true
	if (!isEnabled) {
	    return; // Don't handle shortcuts if extension is disabled
	}
	
	// Check if Shift is pressed and not in an input field
	const isInputField = event.target.tagName === 'INPUT' || 
			     event.target.tagName === 'TEXTAREA' || 
			     event.target.isContentEditable;
	
	// Shift+C: Copy table
	if (event.shiftKey && event.key === 'C' && !event.ctrlKey && !event.metaKey && !isInputField) {
	    event.preventDefault();
	    event.stopPropagation();
	    
	    // Find the best table to copy
	    const tables = getAllTables();
	    let targetTable = null;
	    
	    if (tables.length > 0) {
		// Try to find table based on selection or active element
		const selection = window.getSelection();
		const activeElement = document.activeElement;
		
		// If there's a text selection, try to find table containing it
		if (selection && selection.rangeCount > 0) {
		    const range = selection.getRangeAt(0);
		    let node = range.commonAncestorContainer;
		    
		    // Walk up the DOM tree to find a table
		    while (node && node.nodeType !== Node.ELEMENT_NODE) {
			node = node.parentNode;
		    }
		    
		    while (node && node.tagName !== 'TABLE') {
			node = node.parentElement;
		    }
		    
		    if (node && node.tagName === 'TABLE') {
			targetTable = node;
		    }
		}
		
		// If no table from selection, try active element
		if (!targetTable && activeElement) {
		    let node = activeElement;
		    while (node && node.tagName !== 'TABLE') {
			node = node.parentElement;
		    }
		    if (node && node.tagName === 'TABLE') {
			targetTable = node;
		    }
		}
		
		// If still no table, find the table closest to center of viewport
		if (!targetTable) {
		    const viewportCenter = window.innerHeight / 2;
		    let closestTable = null;
		    let closestDistance = Infinity;
		    
		    for (let i = 0; i < tables.length; i++) {
			const rect = tables[i].getBoundingClientRect();
			// Check if table is visible in viewport
			if (rect.top < window.innerHeight && rect.bottom > 0) {
			    // Calculate distance from viewport center
			    const tableCenter = rect.top + (rect.height / 2);
			    const distance = Math.abs(tableCenter - viewportCenter);
			    
			    if (distance < closestDistance) {
				closestDistance = distance;
				closestTable = tables[i];
			    }
			}
		    }
		    
		    targetTable = closestTable;
		}
		
		// Fallback: use first visible table in viewport
		if (!targetTable) {
		    for (let i = 0; i < tables.length; i++) {
			const rect = tables[i].getBoundingClientRect();
			if (rect.top >= 0 && rect.top < window.innerHeight) {
			    targetTable = tables[i];
			    break;
			}
		    }
		}
		
		// Last resort: use the first table on the page
		if (!targetTable && tables.length > 0) {
		    targetTable = tables[0];
		}
	    }
	    
	    if (targetTable) {
		chrome.storage.local.get(['includeHeaderPreference'], function(result) {
		    const includeHeader = result.includeHeaderPreference || false;
		    copyTableToClipboard(targetTable, includeHeader, false).then(function(copyResult) {
			if (copyResult.success) {
			    showToast('📋 Tabela skopiowana do schowka', 'success', copyResult.rowCount);
			    updateAllClipboardInfo();
			} else {
			    if (!copyResult.isDuplicate) {
				showToast('❌ Nie udało się skopiować tabeli', 'error');
			    }
			}
		    });
		});
	    } else {
		showToast('❌ Nie znaleziono tabeli na stronie', 'error');
	    }
	}
	
	// Shift+A: Append table
	if (event.shiftKey && event.key === 'A' && !event.ctrlKey && !event.metaKey && !isInputField) {
	    event.preventDefault();
	    event.stopPropagation();
	    
	    // Find the best table to append
	    const tables = getAllTables();
	    let targetTable = null;
	    
	    if (tables.length > 0) {
		// Try to find table based on selection or active element
		const selection = window.getSelection();
		const activeElement = document.activeElement;
		
		// If there's a text selection, try to find table containing it
		if (selection && selection.rangeCount > 0) {
		    const range = selection.getRangeAt(0);
		    let node = range.commonAncestorContainer;
		    
		    // Walk up the DOM tree to find a table
		    while (node && node.nodeType !== Node.ELEMENT_NODE) {
			node = node.parentNode;
		    }
		    
		    while (node && node.tagName !== 'TABLE') {
			node = node.parentElement;
		    }
		    
		    if (node && node.tagName === 'TABLE') {
			targetTable = node;
		    }
		}
		
		// If no table from selection, try active element
		if (!targetTable && activeElement) {
		    let node = activeElement;
		    while (node && node.tagName !== 'TABLE') {
			node = node.parentElement;
		    }
		    if (node && node.tagName === 'TABLE') {
			targetTable = node;
		    }
		}
		
		// If still no table, find the table closest to center of viewport
		if (!targetTable) {
		    const viewportCenter = window.innerHeight / 2;
		    let closestTable = null;
		    let closestDistance = Infinity;
		    
		    for (let i = 0; i < tables.length; i++) {
			const rect = tables[i].getBoundingClientRect();
			// Check if table is visible in viewport
			if (rect.top < window.innerHeight && rect.bottom > 0) {
			    // Calculate distance from viewport center
			    const tableCenter = rect.top + (rect.height / 2);
			    const distance = Math.abs(tableCenter - viewportCenter);
			    
			    if (distance < closestDistance) {
				closestDistance = distance;
				closestTable = tables[i];
			    }
			}
		    }
		    
		    targetTable = closestTable;
		}
		
		// Fallback: use first visible table in viewport
		if (!targetTable) {
		    for (let i = 0; i < tables.length; i++) {
			const rect = tables[i].getBoundingClientRect();
			if (rect.top >= 0 && rect.top < window.innerHeight) {
			    targetTable = tables[i];
			    break;
			}
		    }
		}
		
		// Last resort: use the first table on the page
		if (!targetTable && tables.length > 0) {
		    targetTable = tables[0];
		}
	    }
	    
	    if (targetTable) {
		chrome.storage.local.get(['includeHeaderPreference'], function(result) {
		    const includeHeader = result.includeHeaderPreference || false;
		    copyTableToClipboard(targetTable, includeHeader, true).then(function(appendResult) {
			if (appendResult.success) {
			    showToast('📋 Tabela dołączona do schowka', 'success', appendResult.rowCount);
			    updateAllClipboardInfo();
			} else {
			    if (!appendResult.isDuplicate) {
				showToast('❌ Nie udało się dołączyć tabeli', 'error');
			    }
			}
		    });
		});
	    } else {
		showToast('❌ Nie znaleziono tabeli na stronie', 'error');
	    }
	}
    });
}, true); // Use capture phase to catch events early

function removeInlineTableControlPanelsFromPage() {
    document.querySelectorAll('[data-endux-inline-table-panel="1"]').forEach(function(el) { el.remove(); });
    document.querySelectorAll('[data-endux-panel="1"]').forEach(function(el) { el.remove(); });
    document.querySelectorAll('table[data-endux-bordered="1"]').forEach(function(table) {
	table.style.border = '';
	table.style.padding = '';
	table.removeAttribute('data-endux-bordered');
    });
}

function removeExistingPanels() {
    var hadGridPanel = !!document.getElementById(GRID_PANEL_ID);
    if (hadGridPanel) {
	removeGridExtractorPanel(true);
    }
    removeInlineTableControlPanelsFromPage();
    if (hadGridPanel) {
	saveGridPanelUiState('hidden');
    }
}

function injectTablePanelsInternal() {
    const tables = getAllTables();
    tables.forEach(function(table) {
	    table.setAttribute('data-endux-bordered', '1');
	    table.style.border = '1px solid blue';  // Apply a red border around each table
	    table.style.padding = '5px';          // Optional: add some padding to the table
	    
	    // Count the number of rows in the table
	    const rowCount = table.rows.length;
	    
	    // Create a container for button and checkbox
	    const container = document.createElement('div');
	    container.setAttribute('data-endux-inline-table-panel', '1');
	    container.setAttribute('data-endux-panel', 'table');
	    container.style.marginBottom = '15px';
	    container.style.padding = '12px';
	    container.style.backgroundColor = '#f8f9fa';
	    container.style.border = '1px solid #dee2e6';
	    container.style.borderRadius = '8px';
	    container.style.display = 'flex';
	    container.style.alignItems = 'center';
	    container.style.gap = '12px';
	    container.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
	    
	    // Create a button element
	    const button = document.createElement('button');
	    button.textContent = '📋 Kopiuj tabelę (' + rowCount + ' wierszy)';
	    button.style.backgroundColor = '#007bff';
	    button.style.color = '#ffffff';
	    button.style.border = 'none';
	    button.style.borderRadius = '6px';
	    button.style.padding = '10px 20px';
	    button.style.fontSize = '14px';
	    button.style.fontWeight = '600';
	    button.style.cursor = 'pointer';
	    button.style.transition = 'all 0.2s ease';
	    button.style.boxShadow = '0 2px 4px rgba(0, 123, 255, 0.2)';
	    
	    // Hover effect
	    button.addEventListener('mouseenter', function() {
		button.style.backgroundColor = '#0056b3';
		button.style.boxShadow = '0 4px 8px rgba(0, 123, 255, 0.3)';
		button.style.transform = 'translateY(-1px)';
	    });
	    
	    button.addEventListener('mouseleave', function() {
		button.style.backgroundColor = '#007bff';
		button.style.boxShadow = '0 2px 4px rgba(0, 123, 255, 0.2)';
		button.style.transform = 'translateY(0)';
	    });
	    
	    // Active/press effect
	    button.addEventListener('mousedown', function() {
		button.style.transform = 'translateY(0)';
		button.style.boxShadow = '0 1px 2px rgba(0, 123, 255, 0.2)';
	    });
	    
	    button.addEventListener('mouseup', function() {
		button.style.transform = 'translateY(-1px)';
		button.style.boxShadow = '0 4px 8px rgba(0, 123, 255, 0.3)';
	    });
	    
	    // Create a checkbox for including header
	    const checkbox = document.createElement('input');
	    checkbox.type = 'checkbox';
	    checkbox.id = 'includeHeader-' + Math.random().toString(36).substr(2, 9);
	    
	    // Load saved preference (default: don't include header) - applied to both panels after clone
	    
	    checkbox.style.width = '18px';
	    checkbox.style.height = '18px';
	    checkbox.style.cursor = 'pointer';
	    checkbox.style.accentColor = '#007bff';
	    
	    // Save preference when checkbox changes
	    checkbox.addEventListener('change', function() {
		chrome.storage.local.set({ includeHeaderPreference: checkbox.checked });
	    });
	    
	    const label = document.createElement('label');
	    label.htmlFor = checkbox.id;
	    label.textContent = 'Z nagłówkiem';
	    label.style.marginLeft = '0';
	    label.style.cursor = 'pointer';
	    label.style.fontSize = '14px';
	    label.style.color = '#495057';
	    label.style.userSelect = 'none';
	    
	    // Create a checkbox for append mode
	    const appendCheckbox = document.createElement('input');
	    appendCheckbox.type = 'checkbox';
	    appendCheckbox.id = 'appendMode-' + Math.random().toString(36).substr(2, 9);
	    appendCheckbox.checked = false; // Default: don't append
	    appendCheckbox.style.width = '18px';
	    appendCheckbox.style.height = '18px';
	    appendCheckbox.style.cursor = 'pointer';
	    appendCheckbox.style.accentColor = '#007bff';
	    
	    const appendLabel = document.createElement('label');
	    appendLabel.htmlFor = appendCheckbox.id;
	    appendLabel.textContent = 'Dołącz do schowka';
	    appendLabel.style.marginLeft = '0';
	    appendLabel.style.cursor = 'pointer';
	    appendLabel.style.fontSize = '14px';
	    appendLabel.style.color = '#495057';
	    appendLabel.style.userSelect = 'none';
	    
	    // Create container for clipboard info and clear button
	    const clipboardInfoContainer = document.createElement('span');
	    clipboardInfoContainer.style.display = 'inline-flex';
	    clipboardInfoContainer.style.alignItems = 'center';
	    clipboardInfoContainer.style.gap = '6px';
	    clipboardInfoContainer.style.marginLeft = '8px';
	    
	    // Create info element for clipboard row count
	    const clipboardInfo = document.createElement('span');
	    clipboardInfo.id = 'clipboard-info-' + Math.random().toString(36).substr(2, 9);
	    clipboardInfo.style.fontSize = '13px';
	    clipboardInfo.style.color = ENDUX_CLIPBOARD_ROW_COUNT_COLOR;
	    clipboardInfo.style.fontWeight = '500';
	    clipboardInfo.style.cursor = 'pointer';
	    clipboardInfo.style.textDecoration = 'underline';
	    clipboardInfo.style.transition = 'color 0.2s ease';
	    clipboardInfo.title = 'Kliknij, aby otworzyć zawartość schowka w nowej zakładce';
	    
	    // Hover effect for clipboard info
	    clipboardInfo.addEventListener('mouseenter', function() {
		clipboardInfo.style.color = ENDUX_CLIPBOARD_ROW_COUNT_HOVER;
	    });
	    
	    clipboardInfo.addEventListener('mouseleave', function() {
		clipboardInfo.style.color = ENDUX_CLIPBOARD_ROW_COUNT_COLOR;
	    });
	    
	    // Open clipboard in new tab on click
	    clipboardInfo.addEventListener('click', function(e) {
		e.stopPropagation();
		openClipboardInNewTab();
	    });
	    
	    // Create clear button (trash icon)
	    const clearButton = document.createElement('button');
	    clearButton.innerHTML = '🗑️';
	    clearButton.title = 'Wyczyść schowek';
	    clearButton.style.background = 'none';
	    clearButton.style.border = 'none';
	    clearButton.style.cursor = 'pointer';
	    clearButton.style.padding = '2px 4px';
	    clearButton.style.fontSize = '14px';
	    clearButton.style.opacity = '0.6';
	    clearButton.style.transition = 'opacity 0.2s ease';
	    
	    // Hover effect
	    clearButton.addEventListener('mouseenter', function() {
		clearButton.style.opacity = '1';
	    });
	    
	    clearButton.addEventListener('mouseleave', function() {
		clearButton.style.opacity = '0.6';
	    });
	    
	    // Clear clipboard on click
	    clearButton.addEventListener('click', function(e) {
		e.stopPropagation(); // Prevent any event bubbling
		chrome.storage.local.remove(['accumulatedClipboard', 'clipboardHashes'], function() {
		    updateAllClipboardInfo();
		    showToast('🗑️ Schowek wyczyszczony', 'success');
		});
	    });
	    
	    // Add elements to container
	    clipboardInfoContainer.appendChild(clipboardInfo);
	    clipboardInfoContainer.appendChild(clearButton);
	    
	    // Initial update using global function
	    updateAllClipboardInfo();
	    
	    // Add button and checkboxes to container
	    container.appendChild(button);
	    container.appendChild(checkbox);
	    container.appendChild(label);
	    container.appendChild(appendCheckbox);
	    container.appendChild(appendLabel);
	    container.appendChild(clipboardInfoContainer);
	    
	    // Insert the container above the table
	    table.parentNode.insertBefore(container, table);
	    
	    // Clone container for below the table
	    const containerBelow = container.cloneNode(true);
	    
	    // Update margin for bottom container (no bottom margin needed)
	    containerBelow.style.marginBottom = '0';
	    containerBelow.style.marginTop = '15px';
	    
	    // Get cloned elements from bottom container
	    const buttonBelow = containerBelow.querySelector('button');
	    const checkboxBelow = containerBelow.querySelector('input[type="checkbox"]:first-of-type');
	    const appendCheckboxBelow = containerBelow.querySelectorAll('input[type="checkbox"]')[1];
	    const clipboardInfoBelow = containerBelow.querySelector('span[id^="clipboard-info-"]');
	    const clearButtonBelow = containerBelow.querySelector('button[title="Wyczyść schowek"]');
	    
	    // Update clipboard info ID for bottom container to be unique
	    if (clipboardInfoBelow) {
		clipboardInfoBelow.id = 'clipboard-info-' + Math.random().toString(36).substr(2, 9);
		// Re-add click event for bottom clipboard info
		clipboardInfoBelow.addEventListener('click', function(e) {
		    e.stopPropagation();
		    openClipboardInNewTab();
		});
		// Re-add hover effects
		clipboardInfoBelow.addEventListener('mouseenter', function() {
		    clipboardInfoBelow.style.color = ENDUX_CLIPBOARD_ROW_COUNT_HOVER;
		});
		clipboardInfoBelow.addEventListener('mouseleave', function() {
		    clipboardInfoBelow.style.color = ENDUX_CLIPBOARD_ROW_COUNT_COLOR;
		});
	    }
	    
	    // Re-add clear button event for bottom container
	    if (clearButtonBelow) {
		clearButtonBelow.addEventListener('click', function(e) {
		    e.stopPropagation();
		    chrome.storage.local.remove(['accumulatedClipboard', 'clipboardHashes'], function() {
			updateAllClipboardInfo();
			showToast('🗑️ Schowek wyczyszczony', 'success');
		    });
		});
		// Re-add hover effects
		clearButtonBelow.addEventListener('mouseenter', function() {
		    clearButtonBelow.style.opacity = '1';
		});
		clearButtonBelow.addEventListener('mouseleave', function() {
		    clearButtonBelow.style.opacity = '0.6';
		});
	    }
	    
	    // Sync checkbox states between top and bottom containers (global setting)
	    if (checkboxBelow) {
		checkboxBelow.addEventListener('change', function() {
		    checkbox.checked = checkboxBelow.checked;
		    chrome.storage.local.set({ includeHeaderPreference: checkboxBelow.checked });
		});
		checkbox.addEventListener('change', function() {
		    checkboxBelow.checked = checkbox.checked;
		    chrome.storage.local.set({ includeHeaderPreference: checkbox.checked });
		});
	    }
	    // Load saved preference and apply to both panels
	    chrome.storage.local.get(['includeHeaderPreference'], function(result) {
		const checked = result.includeHeaderPreference || false;
		checkbox.checked = checked;
		if (checkboxBelow) checkboxBelow.checked = checked;
	    });
	    
	    if (appendCheckboxBelow) {
		appendCheckboxBelow.addEventListener('change', function() {
		    appendCheckbox.checked = appendCheckboxBelow.checked;
		});
		appendCheckbox.addEventListener('change', function() {
		    appendCheckboxBelow.checked = appendCheckbox.checked;
		});
	    }
	    
	    // Add click event for bottom button
	    if (buttonBelow) {
		buttonBelow.addEventListener('click', async function() {
		    // Disable button for sequentiality
		    buttonBelow.disabled = true;
		    const originalText = buttonBelow.textContent;
		    buttonBelow.textContent = '⏳ Czekaj...';
		    
		    try {
			// Get the table that precedes this container
			const tableForBottom = containerBelow.previousElementSibling;
			
			if (tableForBottom && tableForBottom.tagName === 'TABLE') {
			    // Check if header should be included (use checkbox from bottom container)
			    const includeHeader = checkboxBelow ? checkboxBelow.checked : checkbox.checked;
			    const append = appendCheckboxBelow ? appendCheckboxBelow.checked : appendCheckbox.checked;
			    
			    // Use the shared copy function (WAIT for completion)
			    const result = await copyTableToClipboard(tableForBottom, includeHeader, append);
			    
			    if (result.success) {
				const message = append ? '📋 Tabela dołączona do schowka' : '📋 Tabela skopiowana do schowka';
				showToast(message, 'success', result.rowCount);
				// Update all clipboard info elements after copying
				updateAllClipboardInfo();
			    } else {
				// Don't show error toast if it's a duplicate (warning already shown)
				if (!result.isDuplicate) {
				    showToast('❌ Nie udało się skopiować tabeli', 'error');
				}
			    }
			}
		    } finally {
			// Re-enable button
			buttonBelow.disabled = false;
			buttonBelow.textContent = originalText;
		    }
		});
		
		// Re-add hover effects for bottom button
		buttonBelow.addEventListener('mouseenter', function() {
		    buttonBelow.style.backgroundColor = '#0056b3';
		    buttonBelow.style.boxShadow = '0 4px 8px rgba(0, 123, 255, 0.3)';
		    buttonBelow.style.transform = 'translateY(-1px)';
		});
		
		buttonBelow.addEventListener('mouseleave', function() {
		    buttonBelow.style.backgroundColor = '#007bff';
		    buttonBelow.style.boxShadow = '0 2px 4px rgba(0, 123, 255, 0.2)';
		    buttonBelow.style.transform = 'translateY(0)';
		});
		
		buttonBelow.addEventListener('mousedown', function() {
		    buttonBelow.style.transform = 'translateY(0)';
		    buttonBelow.style.boxShadow = '0 1px 2px rgba(0, 123, 255, 0.2)';
		});
		
		buttonBelow.addEventListener('mouseup', function() {
		    buttonBelow.style.transform = 'translateY(-1px)';
		    buttonBelow.style.boxShadow = '0 4px 8px rgba(0, 123, 255, 0.3)';
		});
	    }
	    
	    // Insert the container below the table
	    if (table.nextSibling) {
		table.parentNode.insertBefore(containerBelow, table.nextSibling);
	    } else {
		table.parentNode.appendChild(containerBelow);
	    }
	    
	    button.addEventListener('click', async function() {
		// Disable button for sequentiality
		button.disabled = true;
		const originalText = button.textContent;
		button.textContent = '⏳ Czekaj...';
		
		try {
		    // Get the table that follows this container
		    const table = container.nextElementSibling;
		    
		    if (table && table.tagName === 'TABLE') {
			// Check if header should be included
			const includeHeader = checkbox.checked;
			const append = appendCheckbox.checked; // Get append mode
			
			// Use the shared copy function (WAIT for completion)
			const result = await copyTableToClipboard(table, includeHeader, append);
			
			if (result.success) {
			    const message = append ? '📋 Tabela dołączona do schowka' : '📋 Tabela skopiowana do schowka';
			    showToast(message, 'success', result.rowCount);
			    // Update all clipboard info elements after copying
			    updateAllClipboardInfo();
			} else {
			    // Don't show error toast if it's a duplicate (warning already shown)
			    if (!result.isDuplicate) {
				showToast('❌ Nie udało się skopiować tabeli', 'error');
			    }
			}
		    }
		} finally {
		    // Re-enable button
		    button.disabled = false;
		    button.textContent = originalText;
		}
	    });
	});
}

function injectTablePanels(force) {
    if (force === true) {
	injectTablePanelsInternal();
	return;
    }
    if (!chrome.storage || !chrome.storage.local) {
	injectTablePanelsInternal();
	return;
    }
    chrome.storage.local.get(['inlineTableControlPanels'], function(result) {
	if (chrome.runtime.lastError) return;
	if (result.inlineTableControlPanels === false) return;
	injectTablePanelsInternal();
    });
}

// Wait until the page is fully loaded
window.addEventListener('load', function() {
    setTimeout(function() {
	chrome.storage.local.get(['extensionEnabled', 'inlineTableControlPanels'], function(result) {
	    if (result.extensionEnabled === false) return;
	    if (result.inlineTableControlPanels !== false) {
		injectTablePanelsInternal();
	    }
	    tryRestoreGridPanelUiOnLoad();
	});
    
    // Detect AJAX pagination
    let lastAutoAppendCopyTime = 0;
    /** Ostatnia zawartość tabeli (hash treści tbody) — bez tego MutationObserver + MUI strzela runAutoAppend w kółko. */
    let lastAutoAppendBodyDataHash = null;
    let mutationQuickTimer = null;  // Fires fast (50ms), non-cancelling - catches each page during rapid navigation
    let mutationSettleTimer = null; // Debounced (400ms) - catches row-by-row loading
    const FETCH_DELAY_MS = 1800;
    const QUICK_DELAY_MS = 50;
    const SETTLE_DELAY_MS = 400;
    
    function runAutoAppendAfterDelay(delayMs) {
	setTimeout(function() {
	    try {
		if (!chrome.runtime?.id) return; // Extension context invalidated
		chrome.storage.local.get(
		    ['extensionEnabled', 'autoAppend', 'crawlerActive', 'includeHeaderPreference'].concat(ENDUX_SUBTABLE_STORAGE_KEYS),
		    function(result) {
		    if (chrome.runtime.lastError) return;
		    if (result.extensionEnabled === false) return;
		    if (result.crawlerActive) {
			handleCrawlerStep();
			return;
		    }
		    if (!result.autoAppend) return;
		    if (_gridPanelRoot && _gridSelectedEl && !_gridSelectedEl.isConnected) {
			tryRebindGridSelectionFromCachedSelectors();
		    }
		    enduxSyncSubtableExportCacheFromSlice(result);
		    var gridPayload = enduxGetGridPanelAutoAppendPayload();
		    if (gridPayload) {
			var gridBodyHash = createHash(gridPayload.bodyText);
			if (lastAutoAppendBodyDataHash !== null && gridBodyHash === lastAutoAppendBodyDataHash) {
			    return;
			}
			chrome.storage.local.get(['accumulatedClipboard'], function(accRes) {
			    if (chrome.runtime.lastError) return;
			    var existing = (accRes.accumulatedClipboard || '').trim();
			    var chunk;
			    if (gridPayload.includeGridHeader && gridPayload.headerLine) {
				chunk = existing.length ? gridPayload.bodyText : (gridPayload.headerLine + '\n' + gridPayload.bodyText);
			    } else {
				chunk = gridPayload.bodyText;
			    }
			    copyTsvTextToClipboard(chunk, gridPayload.bodyText, true, true).then(function(res) {
				if (res.success || res.isDuplicate) {
				    lastAutoAppendBodyDataHash = gridBodyHash;
				}
				if (res.success) {
				    lastAutoAppendCopyTime = Date.now();
				    showToast('✅ Automatycznie dołączono nowe dane', 'success', res.rowCount);
				    updateAllClipboardInfo();
				}
			    });
			});
			return;
		    }
		    var tables = getAllTables();
		    var targetTable = null;
		    var maxRows = 0;
		    tables.forEach(function(t) {
			if (t.rows.length > maxRows && t.offsetParent !== null) {
			    maxRows = t.rows.length;
			    targetTable = t;
			}
		    });
		    if (targetTable) {
			var bodyDataHash = enduxTableBodyDataHash(targetTable);
			if (lastAutoAppendBodyDataHash !== null && bodyDataHash === lastAutoAppendBodyDataHash) {
			    return;
			}
			var includeHeader = result.includeHeaderPreference || false;
			copyTableToClipboard(targetTable, includeHeader, true, true).then(function(res) {
			    if (res.success || res.isDuplicate) {
				lastAutoAppendBodyDataHash = bodyDataHash;
			    }
			    if (res.success) {
				lastAutoAppendCopyTime = Date.now();
				showToast('✅ Automatycznie dołączono nowe dane', 'success', res.rowCount);
				updateAllClipboardInfo();
			    }
			});
		    }
		});
	    } catch (e) {
		// Extension context invalidated - content script will be replaced on next page load
	    }
	}, delayMs);
    }
    
    // Check if crawler or autoAppend should run on initial page load (also handles full-page navigation)
    setTimeout(() => {
        chrome.storage.local.get(['extensionEnabled', 'crawlerActive', 'autoAppend'], function(res) {
            if (res.extensionEnabled === false) return;
            if (res.crawlerActive) {
                handleCrawlerStep();
            } else if (res.autoAppend) {
                runAutoAppendAfterDelay(0);
            }
        });
    }, 2500);

    // Intercept fetch - run AFTER response + DOM update
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
	var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
	var isPaginationRequest = url.includes('page') || url.includes('pagination') || url.includes('ajax') ||
	    (args[1] && args[1].method && args[1].method.toUpperCase() !== 'GET' && url.includes('table'));
	
	var fetchPromise = originalFetch.apply(this, args);
	fetchPromise.finally(function() {
	    scheduleGridPanelPreviewAfterDomChange();
	});
	if (isPaginationRequest) {
	    fetchPromise.then(function() {
		runAutoAppendAfterDelay(FETCH_DELAY_MS);
	    }).catch(function() {});
	}
	return fetchPromise;
    };
    
    // Intercept XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
	this._enduxUrl = url;
	this._enduxMethod = method;
	return originalXHROpen.apply(this, [method, url, ...args]);
    };
    
    XMLHttpRequest.prototype.send = function(...args) {
	var url = this._enduxUrl || '';
	var method = this._enduxMethod || 'GET';
	var isPaginationRequest = url.includes('page') || url.includes('pagination') || url.includes('ajax') ||
	    (method.toUpperCase() !== 'GET' && url.includes('table'));
	
	this.addEventListener('load', function() {
	    scheduleGridPanelPreviewAfterDomChange();
	}, { once: true });
	if (isPaginationRequest) {
	    var onLoad = function() {
		runAutoAppendAfterDelay(FETCH_DELAY_MS);
	    };
	    if (this.readyState === 4) {
		onLoad();
	    } else {
		this.addEventListener('load', onLoad);
	    }
	}
	return originalXHRSend.apply(this, args);
    };
    
    // Monitor DOM changes for table updates (AJAX pagination indicator)
    const observer = new MutationObserver(function(mutations) {
	let tableChanged = false;
	var anyChildList = false;

	mutations.forEach(function(mutation) {
	    if (mutation.type === 'childList') {
		if (mutation.addedNodes.length || mutation.removedNodes.length) anyChildList = true;
		mutation.addedNodes.forEach(function(node) {
		    if (node.nodeType === Node.ELEMENT_NODE) {
			// Check if a table was added or if added node contains tables
			if (node.tagName === 'TABLE' || (node.querySelector && node.querySelector('table'))) {
			    tableChanged = true;
			}
			// Nie oznaczaj tu MUI/div grid — powoduje ciągłe runAutoAppend (wirtualizacja, re-render).
			// Podgląd panelu i tak odświeża scheduleGridPanelPreviewAfterDomChange przy childList.
			// Check for pagination indicators
			if (node.classList && (
			    node.classList.contains('pagination') ||
			    node.classList.contains('pager') ||
			    node.classList.contains('page') ||
			    node.id && node.id.includes('page')
			)) {
			    tableChanged = true;
			}
		    }
		});

		var tgt = mutation.target;
		if (tgt && tgt.nodeType === 1) {
		    if (tgt.tagName === 'TABLE' || tgt.tagName === 'TBODY') {
			tableChanged = true;
		    }
		}
	    }
	});

	if (anyChildList && document.getElementById(GRID_PANEL_ID)) {
	    scheduleGridPanelPreviewAfterDomChange();
	}

	if (tableChanged) {
	    // Quick timer: fires 50ms after first change, non-cancelling.
	    // Captures page N before user clicks page N+1 during rapid navigation.
	    if (!mutationQuickTimer) {
		mutationQuickTimer = setTimeout(function() {
		    mutationQuickTimer = null;
		    runAutoAppendAfterDelay(0);
		}, QUICK_DELAY_MS);
	    }
	    // Settle timer: debounced, fires after DOM stops changing.
	    // Captures complete data when rows load one by one.
	    if (mutationSettleTimer) clearTimeout(mutationSettleTimer);
	    mutationSettleTimer = setTimeout(function() {
		mutationSettleTimer = null;
		runAutoAppendAfterDelay(0);
	    }, SETTLE_DELAY_MS);
	}
    });
    
    // Start observing DOM changes
    observer.observe(document.body, {
	childList: true,
	subtree: true
    });
    }, 2000);
});
