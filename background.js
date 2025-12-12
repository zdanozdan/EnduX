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
    }
});
