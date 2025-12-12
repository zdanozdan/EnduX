// background.js

// Function to create context menu items
function createContextMenu() {
    // Get platform info to show correct keyboard shortcut
    chrome.runtime.getPlatformInfo(function(info) {
	const isMac = info.os === 'mac';
	const modifier = isMac ? '⌘' : 'Ctrl';
	
	chrome.contextMenus.removeAll(() => {
	    chrome.contextMenus.create({
		id: 'endux-copy-table',
		title: '📋 Kopiuj tabelę\t' + modifier + '+C',
		contexts: ['page', 'selection']
	    });
	    
	    chrome.contextMenus.create({
		id: 'endux-append-table',
		title: '📋 Dołącz tabelę\t' + modifier + '+A',
		contexts: ['page', 'selection']
	    });
	});
    });
}

// Function to remove context menu items
function removeContextMenu() {
    chrome.contextMenus.removeAll();
}

// Create context menu when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
    // Check if extension is enabled (default to true)
    chrome.storage.local.get(['extensionEnabled'], function(result) {
	const isEnabled = result.extensionEnabled !== false; // Default to true
	if (isEnabled) {
	    createContextMenu();
	}
    });
});

// Handle extension startup
chrome.runtime.onStartup.addListener(() => {
    chrome.storage.local.get(['extensionEnabled'], function(result) {
	const isEnabled = result.extensionEnabled !== false;
	if (isEnabled) {
	    createContextMenu();
	}
    });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'endux-copy-table') {
	// Send message to content script to copy table - includeHeader will be determined from preference
	chrome.tabs.sendMessage(tab.id, {
	    action: 'copyTable',
	    append: false
	});
    } else if (info.menuItemId === 'endux-append-table') {
	// Send message to content script to append table - includeHeader will be determined from preference
	chrome.tabs.sendMessage(tab.id, {
	    action: 'copyTable',
	    append: true
	});
    }
});

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
	if (tabs[0]) {
	    if (command === 'copy-table') {
		// Copy table - includeHeader will be determined from preference in content.js
		chrome.tabs.sendMessage(tabs[0].id, {
		    action: 'copyTable',
		    append: false
		});
	    } else if (command === 'append-table') {
		// Append table - includeHeader will be determined from preference in content.js
		chrome.tabs.sendMessage(tabs[0].id, {
		    action: 'copyTable',
		    append: true
		});
	    }
	}
    });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'fetchPageSource') {
	chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
	    chrome.tabs.sendMessage(tabs[0].id, { action: 'getPageSource' }, function(response) {
		if (response && response.pageSource) {
		    sendResponse(response);  // Send the page source back to the caller
		} else {
		    sendResponse({ pageSource: '' });  // Return an empty string if no page source
		}
	    });
	});
	
	// Keep the message channel open for async response
	return true;
    } else if (request.action === 'updateContextMenu') {
	// Update context menu based on enabled state
	if (request.enabled) {
	    createContextMenu();
	} else {
	    removeContextMenu();
	}
	sendResponse({ success: true });
	return true;
    } else if (request.action === 'openClipboardInNewTab') {
	// Open clipboard content in a new tab
	const content = request.content || '';
	
	if (!content || content.trim().length === 0) {
	    sendResponse({ success: false, message: 'Schowek jest pusty' });
	    return;
	}
	
	// Create HTML page with clipboard content
	// Convert text to HTML, preserving line breaks
	const htmlContent = content
	    .split('\n')
	    .map(line => {
		// Escape HTML special characters
		const escaped = line
		    .replace(/&/g, '&amp;')
		    .replace(/</g, '&lt;')
		    .replace(/>/g, '&gt;')
		    .replace(/"/g, '&quot;')
		    .replace(/'/g, '&#039;');
		return escaped || '&nbsp;'; // Preserve empty lines
	    })
	    .join('<br>');
	
	const fullHtml = `<!DOCTYPE html>
<html lang="pl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Zawartość schowka - EnduX</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            margin-top: 0;
            border-bottom: 2px solid #007bff;
            padding-bottom: 10px;
        }
        .content {
            font-family: 'Courier New', monospace;
            font-size: 14px;
            line-height: 1.6;
            white-space: pre-wrap;
            word-wrap: break-word;
            background-color: #f8f9fa;
            padding: 20px;
            border-radius: 4px;
            border: 1px solid #dee2e6;
        }
        .info {
            color: #6c757d;
            font-size: 12px;
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid #dee2e6;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📋 Zawartość schowka</h1>
        <div class="content">${htmlContent}</div>
        <div class="info">
            Wygenerowano przez rozszerzenie EnduX
        </div>
    </div>
</body>
</html>`;
	
	// Create data URL (works in service workers)
	// Encode the HTML content properly for data URL
	const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(fullHtml);
	
	chrome.tabs.create({ url: dataUrl }, function(tab) {
	    if (chrome.runtime.lastError) {
		sendResponse({ success: false, message: chrome.runtime.lastError.message });
		return;
	    }
	    sendResponse({ success: true, tabId: tab.id });
	});
	
	return true; // Keep message channel open for async response
    }
});
