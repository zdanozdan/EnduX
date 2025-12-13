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

// Function to load form
function loadForm() {
    const responseMessage = document.getElementById('responseMessage');
    if (!responseMessage) return;
    
    responseMessage.textContent = 'Loading form... Please wait.';
    responseMessage.style.display = '';
    // Fetch the form from the URL
    fetch('https://p3.enduhub.com/pl/zgloszenia/wszystkie/')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok: ' + response.status);
            }
            return response.text(); // Parse the response as text (HTML)
        })
        .then(html => {
            
            // Create a temporary DOM element to parse the HTML content
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;

            // Try to find the submission form (not search form)
            // Look for form with action containing "zgloszenia" or "nowe"
            let form = tempDiv.querySelector('form[action*="zgloszenia"]');
            
            if (!form) {
                // Try to find form with specific fields (name, url, country, location, date, category)
                const allForms = tempDiv.querySelectorAll('form');
                
                // Look for form that has fields like name, url, country, location, date, category
                for (let i = 0; i < allForms.length; i++) {
                    const testForm = allForms[i];
                    const hasName = testForm.querySelector('input[name="name"]');
                    const hasUrl = testForm.querySelector('input[name="url"]');
                    const hasCountry = testForm.querySelector('select[name="country"]');
                    const hasLocation = testForm.querySelector('input[name="location"]');
                    const hasDate = testForm.querySelector('input[name="date"]');
                    const hasCategory = testForm.querySelector('select[name="category"]');
                    
                    if (hasName && hasUrl && hasCountry && hasLocation && hasDate && hasCategory) {
                        form = testForm;
                        break;
                    }
                }
            }
            
            // Fallback: try form with ID endux-form
            if (!form) {
                form = tempDiv.querySelector('form#endux-form');
            }
            
            // Last resort: any form (but skip search forms)
            if (!form) {
                const allForms = tempDiv.querySelectorAll('form');
                for (let i = 0; i < allForms.length; i++) {
                    const testForm = allForms[i];
                    // Skip search forms
                    if (!testForm.id || !testForm.id.includes('search')) {
                        form = testForm;
                        break;
                    }
                }
            }
            
            if (form) {
                // Check if this is the right form (submission form, not search form)
                const isSearchForm = form.action && (form.action.includes('/szukaj/') || form.id && form.id.includes('search'));
                const hasSubmissionFields = form.querySelector('input[name="name"]') && form.querySelector('input[name="url"]') && form.querySelector('select[name="country"]');
                
                if (isSearchForm && !hasSubmissionFields) {
                    responseMessage.textContent = 'Znaleziono formularz wyszukiwania zamiast formularza zgłoszenia. Formularz może być na innej stronie.';
                    responseMessage.className = 'alert alert-warning';
                    responseMessage.style.display = '';
                    return;
                }
                
                // Set form ID if it doesn't have one (for compatibility)
                if (!form.id) {
                    form.id = 'endux-form';
                }
                
                // Append the form to the container in popup.html
                const container = document.getElementById('formContainer');
                container.appendChild(form);
                
                // Remove "Anuluj" (Cancel) button - keep only "Zgłoś wyniki" (Submit) button
                const cancelButtons = form.querySelectorAll('button, input[type="button"], input[type="reset"], a.btn');
                cancelButtons.forEach(function(btn) {
                    const btnText = btn.textContent || btn.value || '';
                    if (btnText.toLowerCase().includes('anuluj') || 
                        btnText.toLowerCase().includes('cancel') ||
                        btn.type === 'reset' ||
                        btn.classList.contains('cancel') ||
                        btn.classList.contains('btn-secondary') && !btnText.toLowerCase().includes('zgłoś') && !btnText.toLowerCase().includes('submit')) {
                        btn.remove();
                    }
                });
                
                form.addEventListener('submit', handleFormSubmit);
                form.addEventListener('input', handleFormInput);
                
                // Use the form element directly instead of querying by ID
                const formFields = form.querySelectorAll('input, textarea, select');

                // Loop through all form fields and populate with stored values if available
                formFields.forEach(function(field) {
                    const fieldName = field.name; // Get the field's name attribute
                    
                    if (fieldName && fieldName !== 'csrfmiddlewaretoken') { // Skip CSRF token
                        // Retrieve saved data from Chrome storage
                        chrome.storage.local.get([fieldName], function(result) {
                            // If the field's value is found in storage, set it to the field
                            if (result[fieldName] !== undefined) {
                                if (field.type === 'checkbox') {
                                    field.checked = result[fieldName] === true || result[fieldName] === 'true';
                                } else {
                                    field.value = result[fieldName];
                                }
                            }
                        });
                    }
                });

                responseMessage.textContent = '';
                responseMessage.style.display = 'none';
            } else {
                responseMessage.textContent = 'Formularz nie został znaleziony na stronie.';
                responseMessage.className = 'alert alert-danger';
                responseMessage.style.display = '';
            }
        })
        .catch(error => {
            const errorMsg = document.getElementById('responseMessage');
            errorMsg.textContent = 'Failed to load form: ' + error.message;
            errorMsg.className = 'alert alert-danger';
            errorMsg.style.display = '';
        });
}

// Function to setup from-list tab
function setupFromListTab() {
    const fromListPane = document.getElementById('from-list-tab');

    if (fromListPane) {
        fromListPane.addEventListener('click', () => {
            // Perform your action here
            handleUserEvents();
        });
    }
}

// Listen for the DOM content to be loaded
document.addEventListener('DOMContentLoaded', function () {
    const responseMessage = document.getElementById('responseMessage');
    
    if (!responseMessage) {
        return;
    }

    // Function to show/hide tabs and content based on extension state
    function toggleExtensionFeatures(isEnabled) {
	const noweTab = document.getElementById('nowe-tab');
	const fromListTab = document.getElementById('from-list-tab');
	const nowePane = document.getElementById('nowe');
	const fromListPane = document.getElementById('from-list');
	
	if (noweTab && fromListTab) {
	    if (isEnabled) {
		noweTab.style.display = '';
		fromListTab.style.display = '';
		if (nowePane) nowePane.style.display = '';
		if (fromListPane) fromListPane.style.display = '';
	    } else {
		noweTab.style.display = 'none';
		fromListTab.style.display = 'none';
		if (nowePane) nowePane.style.display = 'none';
		if (fromListPane) fromListPane.style.display = 'none';
		
		// Switch to Ustawienia tab if extension is disabled
		const ustawieniaTab = document.getElementById('ustawienia-tab');
		if (ustawieniaTab) {
		    if (typeof bootstrap !== 'undefined' && bootstrap.Tab) {
			const tab = new bootstrap.Tab(ustawieniaTab);
			tab.show();
		    } else {
			ustawieniaTab.click();
		    }
		}
	    }
	}
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
	    
	    // Show/hide tabs based on extension state
	    toggleExtensionFeatures(isEnabled);
	    
	    // Load form and list only if extension is enabled
	    if (isEnabled) {
		loadForm();
		setupFromListTab();
	    }
	});
	
	// Handle checkbox change
	extensionEnabledCheckbox.addEventListener('change', function() {
	    const isEnabled = extensionEnabledCheckbox.checked;
	    
	    // Save state to storage
	    chrome.storage.local.set({ extensionEnabled: isEnabled }, function() {
	    });
	    
	    // Update context menu
	    updateContextMenu(isEnabled);
	    
	    // Show/hide tabs based on extension state
	    toggleExtensionFeatures(isEnabled);
	    
	    // Load form and list only if extension is enabled
	    if (isEnabled) {
		loadForm();
		setupFromListTab();
	    } else {
		// Clear form container when disabled
		const formContainer = document.getElementById('formContainer');
		if (formContainer) {
		    formContainer.innerHTML = '';
		}
		// Clear dropdown when disabled
		const userSubmitsDropdown = document.getElementById('userSubmits');
		if (userSubmitsDropdown) {
		    userSubmitsDropdown.innerHTML = '<option value="">Wybierz zgłoszenie</option>';
		}
	    }
	    
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

    const selectButton = document.getElementById('selectButton');

    // Check if the button exists
    if (selectButton) {
        // Add a click event listener
        selectButton.addEventListener('click', () => {
            // Add your custom logic here
	    const userSubmitsDropdown = document.getElementById('userSubmits');
            const selectedValue = userSubmitsDropdown.value;

	    // Retrieve the events from Chrome local storage
            chrome.storage.local.get(['eventsById'], (result) => {
                const eventResults = result.eventsById || {};

                // Fetch the event based on the selected value
                const eventDetails = eventResults[selectedValue];

                if (eventDetails) {
		    const form = document.getElementById('endux-form');
		    if (form) {
			// Iterate over the form's input fields
			const inputs = form.querySelectorAll('input[name]');
			inputs.forEach((input) => {
			    const fieldName = input.name; // Get the 'name' attribute of the input
			    if (eventDetails[fieldName]) {
				input.value = eventDetails[fieldName]; // Populate the input with the value from storage
				saveToStorage(fieldName, input.value);
			    }
			});

			// Handle select dropdowns
			const selects = form.querySelectorAll('select[name]');
			selects.forEach((select) => {
			    const fieldName = select.name; // Get the 'name' attribute of the select
			    if (eventDetails[fieldName]) {
				// Try to set the select value directly
				const value = eventDetails[fieldName];

				// Check if the value exists in the options
				const option = Array.from(select.options).find(opt => opt.value === value);

				if (option) {
				    // If the value exists, set the select value
				    select.value = value;
				} else {
				    // If the value doesn't exist, select by visible text (name)
				    const name = eventDetails[fieldName]; // assuming the name text is in the eventDetails object
				    const textOption = Array.from(select.options).find(opt => opt.text === name);
				    if (textOption) {
					select.value = textOption.value; // Set the value based on the text
				    }
				}
				
				// Save to storage (whether it was set by value or by text)
				saveToStorage(fieldName, select.value);
			    }
			});
			
			// Show toast message
			showToast('✅ Formularz został wypełniony', 'success');
			
			// Switch to "Zgłoszenie" tab
			const noweTab = document.getElementById('nowe-tab');
			if (noweTab) {
			    // Use Bootstrap Tab API or trigger click
			    if (typeof bootstrap !== 'undefined' && bootstrap.Tab) {
				const tab = new bootstrap.Tab(noweTab);
				tab.show();
			    } else {
				// Fallback: trigger click on the tab
				noweTab.click();
			    }
			}
		    }
		};
            });
	});
    }

});

function handleUserEvents() {
    event.preventDefault();  // Prevents the form from submitting normally
    
    const url = 'https://enduhub.com/pl/api/submits/?format=json';

    // Send data using Fetch API
    fetch(url, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',  // Specify content type as JSON
	    'Authorization': 'Token 1c37b03696c640cec090242a792ebda46df987ec' 
        },
    })
	.then(response => response.json())
	.then(data => {
	    const events = data;

	    // Get the dropdown element
            const dropdown = document.getElementById('userSubmits');

	    // Populate dropdown with event names
            events.forEach(event => {
                const option = document.createElement('option');
                option.value = event.id;  // Set the value to event ID
                option.textContent = event.name;  // Set the text to event name
                dropdown.appendChild(option);
            });

	    // Convert the array into an object indexed by ID
	    const indexedEvents = events.reduce((acc, item) => {
		acc[item.id] = item;
		return acc;
	    }, {});

	    // Save the indexed results to Chrome storage
	    chrome.storage.local.set({ eventsById: indexedEvents }, () => {
	    });

	    const msg = document.getElementById('responseMessage');
	    msg.textContent = '';
	    msg.style.display = 'none';
	})
	.catch((error) => {
            const msg = document.getElementById('responseMessage');
            msg.textContent = error;
            msg.style.display = '';
            console.error('Error:', error);  // Log any errors
	});
};

function handleFormInput(event) {
    event.preventDefault();  // Prevents the form from submitting normally
    // If the changed element is an input, textarea, or select, save the data
    const target = event.target;

    // Check if the target is an input or textarea or select element
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
	// Skip CSRF token
	if (target.name === 'csrfmiddlewaretoken') {
	    return;
	}
	
	// Handle checkbox differently
	if (target.type === 'checkbox') {
	    saveToStorage(target.name, target.checked);
	} else {
	    saveToStorage(target.name, target.value);
	}
    }
};

// Function to save form field data to Chrome storage
function saveToStorage(key, value) {
    let data = {};
    data[key] = value;
    
    // Save the data to Chrome local storage
    chrome.storage.local.set(data, function() {
    });
}

function handleFormSubmit(event) {
    event.preventDefault();  // Prevents the form from submitting normally

    // Send a message to the background script to get the page source
    chrome.runtime.sendMessage({ action: 'fetchPageSource' }, function(response) {	
	if (response && response.pageSource) {
	    const pageSource = response.pageSource;

	    // Create a temporary DOM element to parse the page source
            const parser = new DOMParser();
            const doc = parser.parseFromString(pageSource, 'text/html');
	    
            // Remove all <script> and <style> elements
            const scripts = doc.querySelectorAll('script');
            const styles = doc.querySelectorAll('style');
	    const cssLinks = doc.querySelectorAll('link[rel="stylesheet"]');
	    const allElementsWithClass = doc.querySelectorAll('[class]');  // Select all elements with a class attribute
	    const allElementsWithStyle = doc.querySelectorAll('[style]');  // Select all elements with a style attribute
	    
            // Remove <script> elements
            scripts.forEach(script => script.remove());
            // Remove <style> elements
            styles.forEach(style => style.remove());
            // Remove <link> elements referencing external stylesheets
	    cssLinks.forEach(link => link.remove());
	    // Remove all inline class="" attributes
	    allElementsWithClass.forEach(element => element.removeAttribute('class'));
	    // Remove all inline style="" attributes
	    allElementsWithStyle.forEach(element => element.removeAttribute('style'));
	    
            // Serialize the cleaned-up document back to a string
            let cleanedPageSource = doc.documentElement.outerHTML;

	    // Remove empty lines (lines that only contain spaces or are completely blank)
            cleanedPageSource = cleanedPageSource.replace(/^\s*[\r\n]/gm, '').trim();
	    
	    // Send the data to the local Express server
	    const url = 'http://localhost:8000/endux/post';  // Local server URL

	    // Get the container
	    const formContainer = document.getElementById('formContainer');

	    // Find the form inside the container
	    const form = formContainer.querySelector('form');
	    const formData = new FormData(form); // Create a FormData object from the form
	    const data = {
		pageSource: cleanedPageSource  // Attach the page source
	    };

	    // Iterate through the FormData entries and populate the data object
	    formData.forEach((value, key) => {
		data[key] = value; // Add each form field name and its value to the data object
	    });

	    //data['pageSource'] = cleanedPageSource;
	    
	    //const data = {
	//	name: name,
	//	pageSource: cleanedPageSource  // Attach the page source
	  //  };

	    // Send data using Fetch API
	    fetch(url, {
		method: 'POST',
		headers: {
		    'Content-Type': 'application/json; charset=UTF-8'  // Explicitly set UTF-8 encoding
		},
		body: JSON.stringify(data)  // Convert data to JSON
	    })
		.then(response => response.json())
		.then(data => {
		    const msg = document.getElementById('responseMessage');
		    msg.textContent = data.message;
		    msg.style.display = '';
		    document.getElementById('formContainer').innerHTML = '';
		})
		.catch((error) => {
		    const msg = document.getElementById('responseMessage');
		    msg.textContent = 'There was an error sending the form.';
		    msg.style.display = '';
		    console.error('Error:', error);  // Log any errors
		});
	} else {
	    const msg = document.getElementById('responseMessage');
	    msg.textContent = 'Failed to retrieve page source.';
	    msg.style.display = '';
	}
    });
};
