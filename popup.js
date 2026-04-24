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
	    
	    updateContextMenu(isEnabled);
	    setTabsEnabled(isEnabled);
	});
	
	// Handle checkbox change
	extensionEnabledCheckbox.addEventListener('change', function() {
	    const isEnabled = extensionEnabledCheckbox.checked;
	    
	    chrome.storage.local.set({ extensionEnabled: isEnabled }, function() {
	    });
	    
	    updateContextMenu(isEnabled);
	    setTabsEnabled(isEnabled);
	    
	    chrome.tabs.query({}, function(tabs) {
		tabs.forEach(function(tab) {
		    chrome.tabs.reload(tab.id);
		});
	    });
	});
    }

    const showGridPanelBtn = document.getElementById('showGridExtractorPanelBtn');
    if (showGridPanelBtn) {
	showGridPanelBtn.addEventListener('click', function() {
	    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
		if (!tabs[0]) return;
		chrome.tabs.sendMessage(tabs[0].id, { action: 'showGridExtractorPanel' }, function() {
		    if (chrome.runtime.lastError) {
			showToast('❌ Nie można uruchomić na tej stronie', 'error');
			return;
		    }
		    window.close();
		});
	    });
	});
    }
    
    // Show/hide or enable/disable tabs based on extension state
    function setTabsEnabled(isEnabled) {
	const tabLinks = document.querySelectorAll('#myTab .nav-link');
	const tabContent = document.getElementById('myTabContent');
	if (!tabLinks.length || !tabContent) return;
	
	tabLinks.forEach(function(link) {
	    if (isEnabled) {
		link.classList.remove('disabled');
		link.style.pointerEvents = '';
		link.style.opacity = '';
		link.setAttribute('tabindex', '0');
	    } else {
		link.classList.add('disabled');
		link.style.pointerEvents = 'none';
		link.style.opacity = '0.5';
		link.setAttribute('tabindex', '-1');
	    }
	});
	
	const inputs = tabContent.querySelectorAll('input, button, select, textarea');
	inputs.forEach(function(el) {
	    el.disabled = !isEnabled;
	});
	const gridPanelBtn = document.getElementById('showGridExtractorPanelBtn');
	if (gridPanelBtn) {
	    gridPanelBtn.disabled = !isEnabled;
	}
	
	if (tabContent) {
	    tabContent.style.pointerEvents = isEnabled ? '' : 'none';
	    tabContent.style.opacity = isEnabled ? '1' : '0.6';
	}
    }
    
    // Function to update context menu
    function updateContextMenu(isEnabled) {
	chrome.runtime.sendMessage({
	    action: 'updateContextMenu',
	    enabled: isEnabled
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
