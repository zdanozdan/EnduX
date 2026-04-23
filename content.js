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
	
	// Find all clipboard info elements
	const allClipboardInfos = document.querySelectorAll('[id^="clipboard-info-"]');
	allClipboardInfos.forEach(function(element) {
	    element.textContent = infoText;
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

    console.log('EnduX Crawler: Próba znalezienia tabeli...');
    const tables = getAllTables();
    let targetTable = null;
    let maxRows = 0;
    tables.forEach(t => {
        if (t.rows.length > maxRows && t.offsetParent !== null) {
            maxRows = t.rows.length;
            targetTable = t;
        }
    });

    if (!targetTable) {
        console.log('EnduX Crawler: Nie znaleziono tabeli na tej stronie.');
        _crawlerStepRunning = false;
        return;
    }

    console.log('EnduX Crawler: Znaleziono tabelę, kopiowanie...');
    // Determine whether to include header:
    // - crawlerFirstPageHeader ON: first page gets header, all subsequent pages don't
    // - crawlerFirstPageHeader OFF: use the global includeHeaderPreference
    const isFirstPage = result.crawlerIsFirstPage !== false; // defaults to true
    let includeHeader;
    if (result.crawlerFirstPageHeader) {
        includeHeader = isFirstPage;
    } else {
        includeHeader = result.includeHeaderPreference || false;
    }
    const copyResult = await copyTableToClipboard(targetTable, includeHeader, true);

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

// Function to copy table to clipboard (with append support)
function copyTableToClipboard(table, includeHeader, append = false, silentDuplicate = false) {
    if (!table || table.tagName !== 'TABLE') {
	return Promise.resolve({ success: false, rowCount: null });
    }

    let tableText = '';

    const thead = table.querySelector('thead');
    const theadRows = thead ? thead.rows : [];

    const allTbodies = table.querySelectorAll('tbody');
    let bodyRows = [];

    if (allTbodies.length > 0) {
	for (let i = 0; i < allTbodies.length; i++) {
	    const tbodyRows = Array.from(allTbodies[i].rows);
	    bodyRows = bodyRows.concat(tbodyRows);
	}
    } else {
	bodyRows = Array.from(table.rows).filter(function(row, index) {
	    return !thead || index >= theadRows.length;
	});
    }

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

    let hashText = '';
    for (let i = 0; i < bodyRows.length; i++) {
	const row = bodyRows[i];
	const cells = [];
	for (let j = 0; j < row.cells.length; j++) {
	    cells.push(getPlainText(row.cells[j]));
	}
	hashText += cells.join('\t') + '\n';
    }
    hashText = hashText.replace(/\n$/, '');

    return copyTsvTextToClipboard(tableText, hashText, append, silentDuplicate);
}

let _crawlerStepRunning = false; // Guard against concurrent crawler executions

// ── Selector Picker ──────────────────────────────────────────────────────────

let _pickerActive = false;
let _pickerHighlightEl = null;
let _pickerBanner = null;
let _pickerStorageKey = 'crawlerClass';

function generateCssSelector(el) {
    if (!el || el === document.body) return 'body';

    // Prefer stable ID
    if (el.id && !el.id.includes('endux')) {
        try {
            const escaped = '#' + CSS.escape(el.id);
            if (document.querySelectorAll(escaped).length === 1) return escaped;
        } catch (e) {}
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
    if (!_pickerActive || e.target === _pickerBanner) return;
    const target = _nearestClickable(e.target);
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
    if (!_pickerActive || !_pickerHighlightEl || e.target === _pickerBanner) return;
    _pickerHighlightEl.style.outline = _pickerHighlightEl._enduxOrigOutline || '';
    _pickerHighlightEl.style.cursor = _pickerHighlightEl._enduxOrigCursor || '';
    _pickerHighlightEl = null;
}

function _pickerClick(e) {
    if (!_pickerActive || e.target === _pickerBanner) return;
    e.preventDefault();
    e.stopPropagation();
    const selector = generateCssSelector(_nearestClickable(e.target));
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
    _pickerBanner.textContent = '🎯 EnduX: Kliknij przycisk "Dalej" / element paginacji. Esc = anuluj.';
    Object.assign(_pickerBanner.style, {
        position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647',
        background: '#007bff', color: '#fff', textAlign: 'center',
        padding: '10px 16px', fontSize: '14px', fontWeight: '600',
        fontFamily: 'sans-serif', boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        pointerEvents: 'none'
    });
    document.body.appendChild(_pickerBanner);

    document.addEventListener('mouseover', _pickerMouseOver, true);
    document.addEventListener('mouseout',  _pickerMouseOut,  true);
    document.addEventListener('click',     _pickerClick,     true);
    document.addEventListener('keydown',   _pickerKeyDown,   true);
}

function stopSelectorPicker() {
    _pickerActive = false;
    document.body.style.cursor = '';
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

const GRID_PANEL_ID = 'endux-grid-extractor-root';
const GRID_SELECTION_OUTLINE = '3px solid #f97316';
const GRID_HEADER_OUTLINE = '3px solid #16a34a';

let _gridPanelRoot = null;
let _gridSelectedEl = null;
let _gridHeaderRowEl = null;
let _gridUndoStack = [];
let _gridPickerActive = false;
let _gridPickerHoverEl = null;

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
    if (tr === 'row') {
	return cr === 'row';
    }
    if (tr && cr && tr !== cr) return false;
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
}

function getGridDataRowsOnly() {
    if (!_gridSelectedEl) return [];
    const rows = getSiblingRows(_gridSelectedEl);
    if (!_gridHeaderRowEl) return rows;
    return rows.filter(function(r) { return r !== _gridHeaderRowEl; });
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
    const p = _gridSelectedEl.parentElement;
    if (!p || p === document.documentElement || p === document.body) {
	showToast('Brak wyższego elementu', 'warning');
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

function updateGridPreviewUI() {
    if (!_gridPanelRoot) return;
    const statusEl = _gridPanelRoot.querySelector('[data-grid-status]');
    const previewWrap = _gridPanelRoot.querySelector('[data-grid-preview]');
    if (!statusEl || !previewWrap) return;
    if (!_gridSelectedEl) {
	statusEl.textContent = 'Podgląd · brak wyboru' + (_gridHeaderRowEl ? ' (nagłówek: zapisany)' : '');
	previewWrap.innerHTML = '';
	return;
    }
    const dataRows = getGridDataRowsOnly();
    const previewRows = dataRows.slice(0, 5);
    const colCount = computeGridExportColumnCount();
    let statusText = 'Podgląd · kolumn: ' + colCount;
    statusText += _gridHeaderRowEl ? ', nagłówek: tak' : ', nagłówek: nie';
    statusText += ' · wierszy danych: ' + previewRows.length + ' (z ' + dataRows.length + ')';
    statusEl.textContent = statusText;
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
    let fullText = bodyText;
    if (_gridHeaderRowEl) {
	const headerLine = padCellsToColumnCount(rowDirectCellTexts(_gridHeaderRowEl), colCount).join('\t');
	fullText = headerLine + '\n' + bodyText;
    }
    copyTsvTextToClipboard(fullText, bodyText, append, false).then(function(res) {
	if (res.isDuplicate) return;
	if (res.success) {
	    showToast(append ? '📋 Siatka dołączona do schowka' : '📋 Siatka skopiowana', 'success', res.rowCount);
	    updateAllClipboardInfo();
	}
    });
}

function removeGridExtractorPanel() {
    stopGridPicker();
    clearGridSelectionOutline();
    clearGridHeaderVisual();
    _gridUndoStack = [];
    const el = document.getElementById(GRID_PANEL_ID);
    if (el) el.remove();
    _gridPanelRoot = null;
}

function injectGridExtractorPanel() {
    removeGridExtractorPanel();

    const root = document.createElement('div');
    root.id = GRID_PANEL_ID;
    root.setAttribute('data-endux-panel', 'grid');
    _gridPanelRoot = root;
    Object.assign(root.style, {
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
	maxHeight: '42vh'
    });

    const header = document.createElement('div');
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
    title.textContent = 'EnduX · ekstrakcja siatki (div)';
    title.style.fontWeight = '600';
    title.style.fontSize = '14px';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Zamknij');
    Object.assign(closeBtn.style, {
	border: 'none',
	background: 'transparent',
	cursor: 'pointer',
	fontSize: '18px',
	lineHeight: '1',
	padding: '4px 8px'
    });
    closeBtn.addEventListener('click', function() {
	removeGridExtractorPanel();
    });
    header.appendChild(title);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    Object.assign(body.style, {
	display: 'flex',
	flex: '1',
	minHeight: '0',
	gap: '16px',
	padding: '12px',
	overflow: 'hidden'
    });

    const left = document.createElement('div');
    Object.assign(left.style, {
	flex: '0 0 38%',
	maxWidth: '420px',
	display: 'flex',
	flexDirection: 'column',
	gap: '10px',
	fontSize: '13px',
	color: '#444'
    });
    const help = document.createElement('p');
    help.style.margin = '0';
    help.innerHTML = 'Najpierw <strong>Wskaż element</strong> na wierszu nagłówka i <strong>Ustaw nagłówek</strong>. Potem ponownie <strong>Wskaż element</strong> na wierszu danych. <strong>Rozwiń</strong> / <strong>Cofnij</strong> pomagają trafić w cały wiersz (div).';
    left.appendChild(help);

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
    left.appendChild(btnRow);

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
    left.appendChild(headerRow);

    const appendCb = document.createElement('input');
    appendCb.type = 'checkbox';
    appendCb.id = 'endux-grid-append-' + Math.random().toString(36).substr(2, 8);
    const appendLbl = document.createElement('label');
    appendLbl.htmlFor = appendCb.id;
    appendLbl.textContent = 'Dołącz do schowka (jak „Dołącz tabelę”)';
    appendLbl.style.cursor = 'pointer';
    appendLbl.style.fontSize = '13px';

    const copyRow = document.createElement('div');
    Object.assign(copyRow.style, {
	display: 'flex',
	alignItems: 'center',
	gap: '8px',
	flexWrap: 'wrap'
    });
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = '📋 Kopiuj siatkę';
    Object.assign(copyBtn.style, {
	padding: '10px 18px',
	borderRadius: '6px',
	border: 'none',
	background: '#ea580c',
	color: '#fff',
	fontWeight: '600',
	cursor: 'pointer',
	fontSize: '14px'
    });
    copyBtn.addEventListener('click', function() {
	copyGridFromPanel(appendCb.checked);
    });

    copyRow.appendChild(copyBtn);
    copyRow.appendChild(appendCb);
    copyRow.appendChild(appendLbl);
    left.appendChild(copyRow);

    const right = document.createElement('div');
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

    const preview = document.createElement('div');
    preview.setAttribute('data-grid-preview', '1');
    preview.style.overflow = 'auto';
    preview.style.flex = '1';
    preview.style.background = '#fff';
    preview.style.border = '1px solid #e8d5c4';
    preview.style.borderRadius = '6px';
    preview.style.padding = '6px';

    right.appendChild(status);
    right.appendChild(preview);

    body.appendChild(left);
    body.appendChild(right);
    root.appendChild(header);
    root.appendChild(body);
    document.body.appendChild(root);
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
	    injectTablePanels();
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
	    showToast('Panel ekstrakcji (div)', 'success');
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

function removeExistingPanels() {
    document.querySelectorAll('[data-endux-panel]').forEach(function(el) { el.remove(); });
}

function injectTablePanels() {
    const tables = getAllTables();
    tables.forEach(function(table) {
	    table.style.border = '1px solid blue';  // Apply a red border around each table
	    table.style.padding = '5px';          // Optional: add some padding to the table
	    
	    // Count the number of rows in the table
	    const rowCount = table.rows.length;
	    
	    // Create a container for button and checkbox
	    const container = document.createElement('div');
	    container.setAttribute('data-endux-panel', '1');
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

// Wait until the page is fully loaded
window.addEventListener('load', function() {
    setTimeout(function() {
	chrome.storage.local.get(['extensionEnabled'], function(result) {
	    if (result.extensionEnabled === false) return;
	    injectTablePanels();
	});
    
    // Detect AJAX pagination
    let lastAutoAppendCopyTime = 0;
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
			var includeHeader = result.includeHeaderPreference || false;
			copyTableToClipboard(targetTable, includeHeader, true, true).then(function(res) {
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
	
	mutations.forEach(function(mutation) {
	    if (mutation.type === 'childList') {
		mutation.addedNodes.forEach(function(node) {
		    if (node.nodeType === Node.ELEMENT_NODE) {
			// Check if a table was added or if added node contains tables
			if (node.tagName === 'TABLE' || (node.querySelector && node.querySelector('table'))) {
			    tableChanged = true;
			}
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
		
		// Check if table rows were added/removed
		if (mutation.target && mutation.target.tagName === 'TABLE') {
		    tableChanged = true;
		}
		if (mutation.target && mutation.target.tagName === 'TBODY') {
		    tableChanged = true;
		}
	    }
	});
	
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
