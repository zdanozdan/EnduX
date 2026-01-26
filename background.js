// background.js

// Function to create context menu items
function createContextMenu() {
    chrome.contextMenus.removeAll(() => {
	chrome.contextMenus.create({
	    id: 'endux-copy-table',
	    title: '📋 Kopiuj tabelę\tShift+C',
	    contexts: ['page', 'selection']
	});
	
	chrome.contextMenus.create({
	    id: 'endux-append-table',
	    title: '📋 Dołącz tabelę\tShift+A',
	    contexts: ['page', 'selection']
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
	// Pass click coordinates to help find the correct table
	chrome.tabs.sendMessage(tab.id, {
	    action: 'copyTable',
	    append: false,
	    clickX: info.pageX,
	    clickY: info.pageY
	});
    } else if (info.menuItemId === 'endux-append-table') {
	// Send message to content script to append table - includeHeader will be determined from preference
	// Pass click coordinates to help find the correct table
	chrome.tabs.sendMessage(tab.id, {
	    action: 'copyTable',
	    append: true,
	    clickX: info.pageX,
	    clickY: info.pageY
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
    } else if (request.action === 'updateClipboardInfo') {
	// Notify all tabs to update clipboard info
	chrome.tabs.query({}, function(tabs) {
	    tabs.forEach(function(tab) {
		chrome.tabs.sendMessage(tab.id, {
		    action: 'updateClipboardInfo'
		}, function(response) {
		    // Ignore errors (tab might not have content script)
		    if (chrome.runtime.lastError) {
			// Tab doesn't have content script or is not accessible
		    }
		});
	    });
	});
	sendResponse({ success: true });
	return true;
    } else if (request.action === 'openClipboardInNewTab') {
	// Open clipboard content in a new tab or switch to existing one
	// Use extension HTML file which has access to chrome.storage
	const extensionUrl = chrome.runtime.getURL('clipboard-viewer.html');
	const extensionId = chrome.runtime.id;
	
	// First, check if a tab with clipboard-viewer.html is already open
	// Query all tabs across all windows
	chrome.tabs.query({}, function(allTabs) {
	    if (chrome.runtime.lastError) {
		sendResponse({ success: false, message: chrome.runtime.lastError.message });
		return;
	    }
	    
	    // Find existing tab with clipboard-viewer.html
	    let existingTab = null;
	    if (allTabs && allTabs.length > 0) {
		for (let i = 0; i < allTabs.length; i++) {
		    const tab = allTabs[i];
		    // Check both url and pendingUrl (for tabs that are loading)
		    const tabUrl = tab.url || tab.pendingUrl || '';
		    
		    // Check multiple conditions to find the clipboard viewer tab
		    if (tabUrl && (
			tabUrl.indexOf('clipboard-viewer.html') !== -1 ||
			tabUrl === extensionUrl ||
			(tabUrl.startsWith('chrome-extension://') && 
			 tabUrl.indexOf(extensionId) !== -1 && 
			 tabUrl.indexOf('clipboard-viewer.html') !== -1)
		    )) {
			existingTab = tab;
			break;
		    }
		}
	    }
	    
	    if (existingTab && existingTab.id) {
		// Tab already exists, switch to it and reload
		// First, bring the window to front
		chrome.windows.update(existingTab.windowId, { focused: true }, function() {
		    // Then activate the tab
		    chrome.tabs.update(existingTab.id, { active: true }, function() {
			if (chrome.runtime.lastError) {
			    sendResponse({ success: false, message: chrome.runtime.lastError.message });
			    return;
			}
			// Reload the tab to refresh content
			chrome.tabs.reload(existingTab.id, function() {
			    if (chrome.runtime.lastError) {
				sendResponse({ success: false, message: chrome.runtime.lastError.message });
				return;
			    }
			    sendResponse({ success: true, tabId: existingTab.id, reloaded: true });
			});
		    });
		});
	    } else {
		// No existing tab, create a new one
		chrome.tabs.create({ url: extensionUrl }, function(tab) {
		    if (chrome.runtime.lastError) {
			sendResponse({ success: false, message: chrome.runtime.lastError.message });
			return;
		    }
		    sendResponse({ success: true, tabId: tab.id, reloaded: false });
		});
	    }
	});
	
	return true; // Keep message channel open for async response
    }
});
