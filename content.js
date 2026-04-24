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

    return collapseCellSeparators(joinCellChildFragments(temp));
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
	});
    });
}

// Function to handle Crawler Step
async function handleCrawlerStep() {
    try {
	if (!chrome.runtime?.id) return;
    } catch (e) { return; }
    if (_crawlerStepRunning) {
        console.log('EnduX Crawler: Poprzedni krok jeszcze trwa, pomijanie.');
        return;
    }
    _crawlerStepRunning = true;
    console.log('EnduX Crawler: Sprawdzanie stanu...');
    // Check if crawler is active and has configuration defined
    const result = await new Promise(resolve => {
        chrome.storage.local.get(['crawlerActive', 'crawlerClass', 'crawlerPaginator', 'includeHeaderPreference', 'extensionEnabled', 'crawlerFirstPageHeader', 'crawlerIsFirstPage'], resolve);
    });

    if (!result.extensionEnabled || !result.crawlerActive || (!result.crawlerClass && !result.crawlerPaginator)) {
        console.log('EnduX Crawler: Crawler nie jest aktywny lub brak konfiguracji.');
        _crawlerStepRunning = false;
        return;
    }

    console.log('EnduX Crawler: Próba znalezienia danych...');
    if (_gridPanelRoot && _gridSelectedEl && !_gridSelectedEl.isConnected) {
	tryRebindGridSelectionFromCachedSelectors();
    }
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
	copyResult = await copyTableToClipboard(crawlerHtmlTable, includeHeader, true);
    }

    if (copyResult.isDuplicate) {
        console.log('EnduX Crawler: Wykryto duplikat, zatrzymywanie.');
        chrome.storage.local.set({ crawlerActive: false });
        showToast('⚠️ Crawler: Wykryto duplikaty, zatrzymano.', 'warning');
        _crawlerStepRunning = false;
        return;
    }

    if (!copyResult.success) {
        _crawlerStepRunning = false;
        return;
    }

    console.log('EnduX Crawler: Dane zapisane pomyślnie.');
    showToast('🚀 Crawler: Dane zapisane', 'success', copyResult.rowCount);
    updateAllClipboardInfo();
    if (crawlerHtmlTable) {
	syncGridPanelPreviewFromCrawlerTable(crawlerHtmlTable);
    }
    // Mark that we're no longer on the first page
    if (isFirstPage) chrome.storage.local.set({ crawlerIsFirstPage: false });

    // 1. URL paginator (e.g. &page=1-100)
    if (result.crawlerPaginator && result.crawlerPaginator.includes('=') && result.crawlerPaginator.includes('-')) {
        console.log('EnduX Crawler: Próba użycia Paginatora:', result.crawlerPaginator);
        const cleanPaginator = result.crawlerPaginator.startsWith('&') ? result.crawlerPaginator.substring(1) : result.crawlerPaginator;
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
    if (!result.crawlerClass) {
        console.log('EnduX Crawler: Brak klasy przycisku Dalej i paginator nie obsłużył przejścia.');
        chrome.storage.local.set({ crawlerActive: false });
        _crawlerStepRunning = false;
        return;
    }

    const rawSelector = result.crawlerClass.trim();
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

// ── Selector Picker ──────────────────────────────────────────────────────────

let _pickerActive = false;
let _pickerHighlightEl = null;
let _pickerBanner = null;
let _pickerStorageKey = 'crawlerClass';

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
	if (c.nodeType === 1 && !isInsideEnduxGridPanel(c)) return c;
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
    if (t.closest('#endux-picker-banner')) return;
    if (t.closest('#' + GRID_PANEL_ID)) return;
    const target = _nearestClickable(t);
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
    if (rel && rel.nodeType === 1 &&
	(rel.closest('#endux-picker-banner') || rel.closest('#' + GRID_PANEL_ID))) return;
    _pickerHighlightEl.style.outline = _pickerHighlightEl._enduxOrigOutline || '';
    _pickerHighlightEl.style.cursor = _pickerHighlightEl._enduxOrigCursor || '';
    _pickerHighlightEl = null;
}

function _pickerClick(e) {
    if (!_pickerActive) return;
    const t = e.target;
    if (!t || t.nodeType !== 1) return;
    if (t.closest('#endux-picker-banner')) return;
    if (t.closest('#' + GRID_PANEL_ID)) return;
    e.preventDefault();
    e.stopPropagation();
    const selector = generateCssSelector(_nearestClickable(t));
    stopSelectorPicker();
    try {
        chrome.storage.local.set({ [_pickerStorageKey]: selector }, function() {
            showToast('🎯 Selektor zapisany: ' + selector, 'success');
        });
    } catch (err) {}
}

function _pickerKeyDown(e) {
    if (e.key === 'Escape') {
        stopSelectorPicker();
        showToast('Wybieranie anulowane', 'warning');
    }
}

function startSelectorPicker(storageKey) {
    if (_pickerActive) stopSelectorPicker();
    _pickerStorageKey = storageKey || 'crawlerClass';
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
    msg.textContent =
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

function scheduleGridPanelPreviewAfterDomChange() {
    if (!document.getElementById(GRID_PANEL_ID)) return;
    if (_gridPreviewAfterDomTimer) clearTimeout(_gridPreviewAfterDomTimer);
    _gridPreviewAfterDomTimer = setTimeout(function() {
	_gridPreviewAfterDomTimer = null;
	if (!_gridPanelRoot) return;
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
    });
}

function switchGridPanelTab(tabId) {
    var root = _gridPanelRoot;
    if (!root) return;
    var extractPane = root.querySelector('[data-endux-grid-tab-pane="extract"]');
    var crawlPane = root.querySelector('[data-endux-grid-tab-pane="crawler"]');
    var btnE = root.querySelector('[data-endux-grid-tab="extract"]');
    var btnC = root.querySelector('[data-endux-grid-tab="crawler"]');
    if (!extractPane || !crawlPane || !btnE || !btnC) return;
    root.setAttribute('data-endux-grid-active-tab', tabId);
    var activeBg = '#ffffff';
    var idleBg = '#d1d5db';
    var activeColor = '#111827';
    var idleColor = '#4b5563';
    if (tabId === 'crawler') {
	extractPane.style.setProperty('display', 'none', 'important');
	crawlPane.style.setProperty('display', 'flex', 'important');
	crawlPane.style.setProperty('flex-direction', 'column', 'important');
	btnE.style.setProperty('background', idleBg, 'important');
	btnE.style.setProperty('color', idleColor, 'important');
	btnE.style.setProperty('font-weight', '500', 'important');
	btnC.style.setProperty('background', activeBg, 'important');
	btnC.style.setProperty('color', activeColor, 'important');
	btnC.style.setProperty('font-weight', '700', 'important');
    } else {
	crawlPane.style.setProperty('display', 'none', 'important');
	extractPane.style.setProperty('display', 'flex', 'important');
	extractPane.style.setProperty('flex-direction', 'column', 'important');
	btnE.style.setProperty('background', activeBg, 'important');
	btnE.style.setProperty('color', activeColor, 'important');
	btnE.style.setProperty('font-weight', '700', 'important');
	btnC.style.setProperty('background', idleBg, 'important');
	btnC.style.setProperty('color', idleColor, 'important');
	btnC.style.setProperty('font-weight', '500', 'important');
    }
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

function computeGridExportColumnCount() {
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

function buildTsvFromRows(rows, colCount) {
    return rows.map(function(row) {
	return padCellsToColumnCount(rowDirectCellTexts(row), colCount).join('\t');
    }).join('\n');
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
    if (isInsideEnduxGridPanel(t)) return;
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
    if (rel && rel.nodeType === 1 && isInsideEnduxGridPanel(rel)) return;
    _gridPickerHoverEl.style.outline = _gridPickerHoverEl._enduxGridHoverOrigOutline || '';
    _gridPickerHoverEl.style.cursor = _gridPickerHoverEl._enduxGridHoverOrigCursor || '';
    _gridPickerHoverEl = null;
}

function _gridPickerClick(e) {
    if (!_gridPickerActive) return;
    const t = e.target;
    if (!t || t.nodeType !== 1) return;
    if (isInsideEnduxGridPanel(t)) return;
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
    _gridPickerActive = true;
    document.body.style.cursor = 'crosshair';
    document.addEventListener('mouseover', _gridPickerMouseOver, true);
    document.addEventListener('mouseout', _gridPickerMouseOut, true);
    document.addEventListener('click', _gridPickerClick, true);
    document.addEventListener('keydown', _gridPickerKeyDown, true);
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
    refreshGridPanelSelectionIfStale();
    const statusEl = _gridPanelRoot.querySelector('[data-grid-status]');
    const pathEl = _gridPanelRoot.querySelector('[data-grid-selection-path]');
    const pathTextEl = _gridPanelRoot.querySelector('[data-grid-selection-path-text]');
    const previewWrap = _gridPanelRoot.querySelector('[data-grid-preview]');
    if (!statusEl || !previewWrap) return;
    if (!_gridSelectedEl) {
	statusEl.textContent = 'Podgląd · brak wyboru' + (_gridHeaderRowEl ? ' (nagłówek: zapisany)' : '');
	previewWrap.innerHTML = '';
	if (pathEl) {
	    pathEl.style.display = 'none';
	    _gridPathEditActive = false;
	    setGridSelectionPathEditMode(false);
	    if (pathTextEl) {
		pathTextEl.textContent = '';
		pathTextEl.removeAttribute('title');
	    }
	}
	updateGridCopyButtonLabel();
	return;
    }
    const dataRows = getGridDataRowsOnly();
    const previewRows = dataRows.slice(0, 5);
    const colCount = computeGridExportColumnCount();
    let statusText = 'Podgląd · kolumn: ' + colCount;
    statusText += _gridHeaderRowEl ? ', nagłówek: tak' : ', nagłówek: nie';
    statusText += ' · wierszy danych: ' + previewRows.length + ' (z ' + dataRows.length + ')';
    statusEl.textContent = statusText;
    if (pathEl && pathTextEl && _gridSelectedEl.isConnected && !isInsideEnduxGridPanel(_gridSelectedEl)) {
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
	appendCells(trH, padCellsToColumnCount(rowDirectCellTexts(_gridHeaderRowEl), colCount), true);
	table.appendChild(trH);
    }
    previewRows.forEach(function(r) {
	const tr = document.createElement('tr');
	appendCells(tr, padCellsToColumnCount(rowDirectCellTexts(r), colCount), false);
	table.appendChild(tr);
    });
    previewWrap.innerHTML = '';
    previewWrap.appendChild(table);
    updateGridCopyButtonLabel();
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
    var colCount = computeGridExportColumnCount();
    if (colCount === 0) return null;
    var bodyText = buildTsvFromRows(dataRows, colCount).replace(/\n$/, '');
    var includeGridHeader = !!(_gridHeaderRowEl && _gridHeaderRowEl.isConnected);
    var headerLine = null;
    if (includeGridHeader) {
	headerLine = padCellsToColumnCount(rowDirectCellTexts(_gridHeaderRowEl), colCount).join('\t');
    }
    return { bodyText: bodyText, headerLine: headerLine, includeGridHeader: includeGridHeader };
}

function copyGridFromPanel(append) {
    if (!_gridSelectedEl) {
	showToast('Najpierw wskaż wiersz danych (div)', 'warning');
	return;
    }
    const dataRows = getGridDataRowsOnly();
    if (dataRows.length === 0) {
	showToast('Brak wierszy danych — wskaż wiersz szablonu lub usuń nagłówek z listy', 'warning');
	return;
    }
    const colCount = computeGridExportColumnCount();
    if (colCount === 0) {
	showToast('Brak kolumn do eksportu', 'warning');
	return;
    }
    const bodyText = buildTsvFromRows(dataRows, colCount).replace(/\n$/, '');
    // Nagłówek z „Ustaw nagłówek” (zielony w podglądzie) — nie zależy od przełącznika „Z nagłówkiem” (ten dotyczy tabel HTML).
    var includeGridHeader = !!(_gridHeaderRowEl && _gridHeaderRowEl.isConnected);
    var headerLine = null;
    if (includeGridHeader) {
	headerLine = padCellsToColumnCount(rowDirectCellTexts(_gridHeaderRowEl), colCount).join('\t');
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
	chrome.storage.local.get(['accumulatedClipboard'], function(result) {
	    if (chrome.runtime.lastError) return;
	    var existing = (result.accumulatedClipboard || '').trim();
	    var chunk;
	    if (includeGridHeader && headerLine) {
		// Pierwsze dołączenie (pusty bufor): nagłówek + dane; kolejne strony — tylko wiersze danych.
		chunk = existing.length ? bodyText : (headerLine + '\n' + bodyText);
	    } else {
		chunk = bodyText;
	    }
	    finishGridCopy(chunk);
	});
	return;
    }

    var fullText = bodyText;
    if (includeGridHeader && headerLine) {
	fullText = headerLine + '\n' + bodyText;
    }
    finishGridCopy(fullText);
}

function removeGridExtractorPanel(skipSaveUiState) {
    stopGridPicker();
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
	padding: '10px 12px',
	border: 'none',
	background: '#d1d5db',
	fontWeight: '500',
	cursor: 'pointer',
	fontSize: '13px',
	color: '#4b5563',
	fontFamily: 'inherit'
    });
    tabBtnExtract.addEventListener('click', function() {
	switchGridPanelTab('extract');
	loadAndApplyGridPanelSplitWidth();
    });
    tabBtnCrawl.addEventListener('click', function() {
	switchGridPanelTab('crawler');
    });
    tabBar.appendChild(tabBtnExtract);
    tabBar.appendChild(tabBtnCrawl);

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

    const clipboardInfoContainer = document.createElement('span');
    Object.assign(clipboardInfoContainer.style, {
	display: 'inline-flex',
	alignItems: 'center',
	gap: '6px',
	flexWrap: 'wrap'
    });

    const clipboardInfo = document.createElement('span');
    clipboardInfo.id = 'clipboard-info-' + Math.random().toString(36).substr(2, 9);
    clipboardInfo.setAttribute('data-endux-grid-clipboard', '1');
    Object.assign(clipboardInfo.style, {
	fontSize: '13px',
	color: '#6c757d',
	fontWeight: '500',
	cursor: 'pointer',
	textDecoration: 'underline'
    });
    clipboardInfo.title = 'Kliknij, aby otworzyć zawartość schowka w nowej zakładce';
    clipboardInfo.addEventListener('mouseenter', function() {
	clipboardInfo.style.color = '#2563eb';
    });
    clipboardInfo.addEventListener('mouseleave', function() {
	clipboardInfo.style.color = '#6c757d';
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

    copyMetaRow.appendChild(includeHdrToggle.wrap);
    copyMetaRow.appendChild(includeHdrLbl);
    copyMetaRow.appendChild(appendToggle.wrap);
    copyMetaRow.appendChild(appendLbl);
    copyMetaRow.appendChild(clipboardInfoContainer);

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
    status.style.fontWeight = '600';
    status.style.fontSize = '13px';
    status.textContent = 'Podgląd · brak wyboru';

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

    right.appendChild(status);
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

    tabHost.appendChild(extractPane);
    tabHost.appendChild(crawlPane);
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
	    clipboardInfo.style.color = '#6c757d';
	    clipboardInfo.style.fontWeight = '500';
	    clipboardInfo.style.cursor = 'pointer';
	    clipboardInfo.style.textDecoration = 'underline';
	    clipboardInfo.style.transition = 'color 0.2s ease';
	    clipboardInfo.title = 'Kliknij, aby otworzyć zawartość schowka w nowej zakładce';
	    
	    // Hover effect for clipboard info
	    clipboardInfo.addEventListener('mouseenter', function() {
		clipboardInfo.style.color = '#007bff';
	    });
	    
	    clipboardInfo.addEventListener('mouseleave', function() {
		clipboardInfo.style.color = '#6c757d';
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
		    clipboardInfoBelow.style.color = '#007bff';
		});
		clipboardInfoBelow.addEventListener('mouseleave', function() {
		    clipboardInfoBelow.style.color = '#6c757d';
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
		chrome.storage.local.get(['extensionEnabled', 'autoAppend', 'crawlerActive', 'includeHeaderPreference'], function(result) {
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
