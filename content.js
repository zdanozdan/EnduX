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

// Function to extract plain text from HTML element, removing all HTML tags
function getPlainText(element) {
    if (!element) return '';
    
    // Create a temporary element to extract text
    const temp = document.createElement('div');
    temp.innerHTML = element.innerHTML;
    
    // Get text content (this removes all HTML tags)
    let text = temp.textContent || temp.innerText || '';
    
    // Clean up: replace multiple whitespaces with single space, remove leading/trailing whitespace
    text = text.replace(/\s+/g, ' ').trim();
    
    return text;
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
        chrome.storage.local.get(['crawlerActive', 'crawlerClass', 'crawlerPaginator', 'includeHeaderPreference', 'extensionEnabled'], resolve);
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
    const includeHeader = result.includeHeaderPreference || false;
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

    console.log('EnduX Crawler: Przycisk Dalej (', rawSelector, '):', nextButton);

    const canGoNext = nextButton &&
        !nextButton.classList.contains('disabled') &&
        !nextButton.hasAttribute('disabled') &&
        nextButton.offsetParent !== null;

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

// Function to copy table to clipboard (with append support)
function copyTableToClipboard(table, includeHeader, append = false, silentDuplicate = false) {
    if (!table || table.tagName !== 'TABLE') {
	return Promise.resolve({ success: false, rowCount: null });
    }
    
    // Extract table data as text
    let tableText = '';
    
    // Get thead rows if they exist
    const thead = table.querySelector('thead');
    const theadRows = thead ? thead.rows : [];
    
    // Get all tbody elements (tables can have multiple tbody)
    const allTbodies = table.querySelectorAll('tbody');
    let bodyRows = [];
    
    if (allTbodies.length > 0) {
	// Collect rows from all tbody elements
	for (let i = 0; i < allTbodies.length; i++) {
	    const tbodyRows = Array.from(allTbodies[i].rows);
	    bodyRows = bodyRows.concat(tbodyRows);
	}
    } else {
	// If no tbody, get all rows and skip thead rows
	bodyRows = Array.from(table.rows).filter((row, index) => {
	    // If there's a thead, skip thead rows from table.rows
	    return !thead || index >= theadRows.length;
	});
    }
    
    // Add thead rows if includeHeader is true
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
    
    // Add body rows
    for (let i = 0; i < bodyRows.length; i++) {
	const row = bodyRows[i];
	const cells = [];
	
	// Extract cell text from each cell in the row (removing all HTML tags)
	for (let j = 0; j < row.cells.length; j++) {
	    cells.push(getPlainText(row.cells[j]));
	}
	
	// Join cells with tab separator (works well for pasting into spreadsheets)
	tableText += cells.join('\t') + '\n';
    }
    
    // Remove trailing newline from tableText for consistent comparison
    tableText = tableText.replace(/\n$/, '');
    
    // Count rows in current table
    let currentRowCount = bodyRows.length;
    if (includeHeader && theadRows.length > 0) {
	currentRowCount += theadRows.length;
    }
    
    // Create hash for the table text - ALWAYS use only body rows (without header) for hash
    // This ensures the same table is detected as duplicate regardless of includeHeader setting
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
    const tableHash = createHash(hashText);
    
    // If append mode, get existing clipboard content from storage
    if (append) {
	return new Promise(function(resolve) {
	    chrome.storage.local.get(['accumulatedClipboard', 'preventDuplicates', 'clipboardHashes'], function(result) {
		const existingContent = result.accumulatedClipboard || '';
		const preventDuplicates = result.preventDuplicates === undefined ? true : result.preventDuplicates;
		const existingHashes = result.clipboardHashes || [];
		    
		// Check for duplicates using hash if option is enabled
		if (preventDuplicates && tableHash) {
		    if (existingHashes.includes(tableHash)) {
			if (!silentDuplicate) {
			    showToast('⚠️ Ta tabela już jest w schowku! Duplikat nie został dodany.', 'warning');
			}
			resolve({ success: false, rowCount: null, isDuplicate: true });
			return;
		    }
		}
		
		// Add newline back for storage
		const tableTextWithNewline = tableText + '\n';
		const combinedText = existingContent + (existingContent ? '\n\n' : '') + tableTextWithNewline;
		
		// Add hash to the list
		const updatedHashes = [...existingHashes, tableHash];
		
		// Count total rows in combined text
		const totalRowCount = combinedText.split('\n').filter(line => line.trim().length > 0).length;
		
		// Save to storage (both content and hashes)
		chrome.storage.local.set({ 
		    accumulatedClipboard: combinedText,
		    clipboardHashes: updatedHashes
		}, function() {
		    // Try to copy to clipboard, but don't fail if it's blocked
		    navigator.clipboard.writeText(combinedText)
			.then(function() {
			    resolve({ success: true, rowCount: totalRowCount });
			})
			.catch(function() {
			    // Schowek zablokowany (brak fokusu) - dane w pamięci rozszerzenia
			    // Resolve with success anyway because data is in storage!
			    resolve({ success: true, rowCount: totalRowCount, clipboardError: true });
			});
		});
	    });
	});
    } else {
	// Normal mode: just copy and save to storage (for future appends)
	// Add newline back for storage
	const tableTextWithNewline = tableText + '\n';
	return new Promise(function(resolve) {
	    chrome.storage.local.set({ 
		accumulatedClipboard: tableTextWithNewline,
		clipboardHashes: [tableHash]  // Start new hash list with this table
	    }, function() {
		navigator.clipboard.writeText(tableTextWithNewline)
		    .then(function() {
			resolve({ success: true, rowCount: currentRowCount });
		    })
		    .catch(function() {
			// Schowek zablokowany - dane w pamięci rozszerzenia
			resolve({ success: true, rowCount: currentRowCount, clipboardError: true });
		    });
	    });
	});
    }
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

function _pickerMouseOver(e) {
    if (!_pickerActive || e.target === _pickerBanner) return;
    if (_pickerHighlightEl && _pickerHighlightEl !== e.target) {
        _pickerHighlightEl.style.outline = _pickerHighlightEl._enduxOrigOutline || '';
        _pickerHighlightEl.style.cursor = _pickerHighlightEl._enduxOrigCursor || '';
    }
    _pickerHighlightEl = e.target;
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
    const selector = generateCssSelector(e.target);
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
