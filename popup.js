// Listen for the DOM content to be loaded
document.addEventListener('DOMContentLoaded', function () {
    const responseMessage = document.getElementById('responseMessage');

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
		console.log('Extension enabled state saved:', isEnabled);
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
		console.log('Prevent duplicates state saved:', preventDuplicates);
	    });
	});
    }
    
    // Handle clear clipboard button
    const clearClipboardButton = document.getElementById('clearClipboard');
    if (clearClipboardButton) {
	clearClipboardButton.addEventListener('click', function() {
	    chrome.storage.local.remove(['accumulatedClipboard', 'clipboardHashes'], function() {
		alert('Schowek wyczyszczony');
		clearClipboardButton.textContent = '✓ Wyczyszczono';
		setTimeout(function() {
		    clearClipboardButton.textContent = 'Wyczyść schowek';
		}, 2000);
	    });
	});
    }

    const selectButton = document.getElementById('selectButton');

    // Check if the button exists
    if (selectButton) {
        // Add a click event listener
        selectButton.addEventListener('click', () => {
            console.log('The "Wypełnij" button was clicked!');
            // Add your custom logic here
	    const userSubmitsDropdown = document.getElementById('userSubmits');
            const selectedValue = userSubmitsDropdown.value;

	    // Retrieve the events from Chrome local storage
            chrome.storage.local.get(['eventsById'], (result) => {
                const eventResults = result.eventsById || {};

                // Fetch the event based on the selected value
                const eventDetails = eventResults[selectedValue];

                if (eventDetails) {
                    console.log('Event Details:', eventDetails);

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
		    }
		};
            });
	});
    }

    const fromListPane = document.getElementById('from-list-tab');

    if (fromListPane) {
        fromListPane.addEventListener('click', () => {
            console.log('Tab pane "fromlist" was clicked!');
            // Perform your action here
	    handleUserEvents();
        });
    }
    
    responseMessage.textContent = 'Loading form... Please wait.';
    // Fetch the form from the URL
    fetch('https://dev.enduhub.com/pl/submit/endux/')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.text(); // Parse the response as text (HTML)
        })
        .then(html => {
            // Create a temporary DOM element to parse the HTML content
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;

            // Extract the <form> element from the fetched HTML
            const form = tempDiv.querySelector('form');
            if (form) {
                // Append the form to the container in popup.html
                document.getElementById('formContainer').appendChild(form);
		form.addEventListener('submit', handleFormSubmit);
		form.addEventListener('input', handleFormInput);
		
		const formFields = document.querySelectorAll('#endux-form input, #endux-form textarea, #endux-form select');

		// Loop through all form fields and populate with stored values if available
		formFields.forEach(function(field) {
		    const fieldName = field.name; // Get the field's name attribute
		    
		    // Retrieve saved data from Chrome storage
		    chrome.storage.local.get([fieldName], function(result) {
			// If the field's value is found in storage, set it to the field
			if (result[fieldName]) {
			    field.value = result[fieldName];
			}
		    });
		});

		responseMessage.textContent = '';
            } else {
                console.error('Form element not found in the response');
            }
        })
        .catch(error => {
            console.error('Error fetching form:', error);
            document.getElementById('responseMessage').textContent = 'Failed to load form.';
        });
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

	    console.log(indexedEvents);

	    // Save the indexed results to Chrome storage
	    chrome.storage.local.set({ eventsById: indexedEvents }, () => {
		console.log('Results indexed by ID saved successfully!');
	    });

	    document.getElementById('responseMessage').textContent = "Pobrano: "+events.length;
	})
	.catch((error) => {
            document.getElementById('responseMessage').textContent = error;
            console.error('Error:', error);  // Log any errors
	});
};

function handleFormInput(event) {
    event.preventDefault();  // Prevents the form from submitting normally
    // If the changed element is an input, textarea, or select, save the data
    const target = event.target;

    // Check if the target is an input or textarea or select element
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        saveToStorage(target.name, target.value);
    }
};

// Function to save form field data to Chrome storage
function saveToStorage(key, value) {
    let data = {};
    data[key] = value;
    
    // Save the data to Chrome local storage
    chrome.storage.local.set(data, function() {
        console.log(`Saved ${key}: ${value}`);
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
		    document.getElementById('responseMessage').textContent = data.message
		    console.log(data);  // Log server response
		    document.getElementById('formContainer').innerHTML = '';
		})
		.catch((error) => {
		    document.getElementById('responseMessage').textContent = 'There was an error sending the form.';
		    document.getElementById('responseMessage').textContent = response
		    console.error('Error:', error);  // Log any errors
		});
	} else {
	    document.getElementById('responseMessage').textContent = 'Failed to retrieve page source.';
	}
    });
};
