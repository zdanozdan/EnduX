// Function to show toast message in popup
function showToast(message, type = 'success') {
    // Remove existing toast if any
    const existingToast = document.getElementById('popup-toast');
    if (existingToast) {
        existingToast.remove();
    }

    // Create toast element
    const toast = document.createElement('div');
    toast.id = 'popup-toast';
    
    // Set colors based on type
    let bgColor = '#28a745'; // success (green)
    if (type === 'error') bgColor = '#dc3545'; // error (red)
    if (type === 'warning') bgColor = '#ffc107'; // warning (yellow)
    
    toast.textContent = message;
    toast.style.position = 'fixed';
    toast.style.top = '20px';
    toast.style.right = '20px';
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
    toast.style.pointerEvents = 'none';

    document.body.appendChild(toast);

    // Fade in
    setTimeout(() => {
        toast.style.opacity = '1';
    }, 10);

    // Fade out and remove after 3 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}

// Listen for the DOM content to be loaded
document.addEventListener('DOMContentLoaded', function () {
    const responseMessage = document.getElementById('responseMessage');
    
    if (!responseMessage) {
        return;
    }

    // Handle extension enable/disable checkbox
    const extensionEnabledCheckbox = document.getElementById('extensionEnabled');

    if (extensionEnabledCheckbox) {
	// Load saved state (default to enabled)
	chrome.storage.local.get(['extensionEnabled'], function(result) {
	    const isEnabled = result.extensionEnabled !== false; // Default to true if not set
	    extensionEnabledCheckbox.checked = isEnabled;
	    
	    // Update context menu when popup opens
	    updateContextMenu(isEnabled);
	});
	
	// Handle checkbox change
	extensionEnabledCheckbox.addEventListener('change', function() {
	    const isEnabled = extensionEnabledCheckbox.checked;
	    
	    // Save state to storage
	    chrome.storage.local.set({ extensionEnabled: isEnabled }, function() {
	    });
	    
	    // Update context menu
	    updateContextMenu(isEnabled);
	    
	    // Reload all tabs to apply changes
	    chrome.tabs.query({}, function(tabs) {
		tabs.forEach(function(tab) {
		    chrome.tabs.reload(tab.id);
		});
	    });
	});
    }
    
    // Function to update context menu
    function updateContextMenu(isEnabled) {
	chrome.runtime.sendMessage({
	    action: 'updateContextMenu',
	    enabled: isEnabled
	});
    }
    
    // Handle prevent duplicates checkbox
    const preventDuplicatesCheckbox = document.getElementById('preventDuplicates');
    if (preventDuplicatesCheckbox) {
	// Load saved state (default to checked)
	chrome.storage.local.get(['preventDuplicates'], function(result) {
	    const preventDuplicates = result.preventDuplicates !== false; // Default to true
	    preventDuplicatesCheckbox.checked = preventDuplicates;
	});
	
	// Handle checkbox change
	preventDuplicatesCheckbox.addEventListener('change', function() {
	    const preventDuplicates = preventDuplicatesCheckbox.checked;
	    chrome.storage.local.set({ preventDuplicates: preventDuplicates }, function() {
	    });
	});
    }

    // Handle auto append checkbox
    const autoAppendCheckbox = document.getElementById('autoAppend');
    if (autoAppendCheckbox) {
	// Load saved state (default to false)
	chrome.storage.local.get(['autoAppend'], function(result) {
	    autoAppendCheckbox.checked = result.autoAppend === true;
	});

	// Handle checkbox change
	autoAppendCheckbox.addEventListener('change', function() {
	    const autoAppend = autoAppendCheckbox.checked;
	    chrome.storage.local.set({ autoAppend: autoAppend }, function() {
	    });
	});
    }

    // Handle crawler configuration
    const crawlerClassInput = document.getElementById('crawlerClass');
    const crawlerPaginatorInput = document.getElementById('crawlerPaginator');
    const crawlerActiveCheckbox = document.getElementById('crawlerActive');

    if (crawlerClassInput && crawlerPaginatorInput && crawlerActiveCheckbox) {
	// Load saved state
	chrome.storage.local.get(['crawlerClass', 'crawlerPaginator', 'crawlerActive'], function(result) {
	    if (result.crawlerClass) crawlerClassInput.value = result.crawlerClass;
	    if (result.crawlerPaginator) crawlerPaginatorInput.value = result.crawlerPaginator;
	    crawlerActiveCheckbox.checked = result.crawlerActive === true;
	});

	// Save class name on input
	crawlerClassInput.addEventListener('input', function() {
	    chrome.storage.local.set({ crawlerClass: crawlerClassInput.value.trim() });
	});

	// Save paginator on input
	crawlerPaginatorInput.addEventListener('input', function() {
	    chrome.storage.local.set({ crawlerPaginator: crawlerPaginatorInput.value.trim() });
	});

	// Handle crawler toggle
	crawlerActiveCheckbox.addEventListener('change', function() {
	    const active = crawlerActiveCheckbox.checked;
	    const className = crawlerClassInput.value.trim();
	    const paginator = crawlerPaginatorInput.value.trim();

	    if (active && !className && !paginator) {
		showToast('❌ Podaj klasę przycisku "Dalej" lub Paginator', 'error');
		crawlerActiveCheckbox.checked = false;
		return;
	    }

	    chrome.storage.local.set({ crawlerActive: active }, function() {
		if (active) {
		    showToast('🚀 Crawler uruchomiony', 'success');
		    // Notify content script to start immediately if on a page with table
		    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
			if (tabs[0]) {
			    chrome.tabs.sendMessage(tabs[0].id, { action: 'startCrawler' });
			}
		    });
		} else {
		    showToast('⏹️ Crawler zatrzymany', 'warning');
		}
	    });
	});
    }
    
    // Handle clear clipboard button
    const clearClipboardButton = document.getElementById('clearClipboard');
    if (clearClipboardButton) {
	clearClipboardButton.addEventListener('click', function() {
	    chrome.storage.local.remove(['accumulatedClipboard', 'clipboardHashes'], function() {
		clearClipboardButton.textContent = '✓ Wyczyszczono';
		setTimeout(function() {
		    clearClipboardButton.textContent = 'Wyczyść schowek';
		}, 2000);
	    });
	});
    }
    
    // Display version from manifest
    const versionElement = document.getElementById('version');
    if (versionElement) {
	const manifest = chrome.runtime.getManifest();
	if (manifest && manifest.version) {
	    versionElement.textContent = manifest.version;
	}
    }
    
    // Handle login button
    const loginButton = document.getElementById('loginButton');
    const loginNameInput = document.getElementById('loginName');
    const loginPasswordInput = document.getElementById('loginPassword');
    
    if (loginButton) {
	// Load saved login credentials
	chrome.storage.local.get(['loginName', 'loginPassword'], function(result) {
	    if (result.loginName) {
		loginNameInput.value = result.loginName;
	    }
	    if (result.loginPassword) {
		loginPasswordInput.value = result.loginPassword;
	    }
	});
	
	loginButton.addEventListener('click', function() {
	    const name = loginNameInput.value.trim();
	    const password = loginPasswordInput.value.trim();
	    
	    if (!name || !password) {
		return;
	    }
	    
	    // Save login credentials
	    chrome.storage.local.set({
		loginName: name,
		loginPassword: password
	    }, function() {
		loginButton.textContent = '✓ Zapisano';
		loginButton.classList.remove('btn-primary');
		loginButton.classList.add('btn-success');
		setTimeout(function() {
		    loginButton.textContent = 'Zaloguj';
		    loginButton.classList.remove('btn-success');
		    loginButton.classList.add('btn-primary');
		}, 2000);
	    });
	});
    }

});

function saveToStorage(key, value) {
    let data = {};
    data[key] = value;
    
    // Save the data to Chrome local storage
    chrome.storage.local.set(data, function() {
    });
}
