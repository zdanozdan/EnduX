// content.js
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'getPageSource') {
	// Get the outerHTML of the page
	const pageSource = document.documentElement.outerHTML;
	
	// Send the page source back to the background script or popup
	sendResponse({ pageSource: pageSource });
    }
    
    return true;
});

// Wait until the page is fully loaded
window.addEventListener('load', function() {
    setTimeout(function() {
	//alert('Page loaded 5s delayed. EnduX ready');    
	
	const tables = document.querySelectorAll('table');
	
	// Loop through each table and apply a border (read frame)
	tables.forEach(function(table) {
	    table.style.border = '1px solid blue';  // Apply a red border around each table
	    table.style.padding = '5px';          // Optional: add some padding to the table
	    
	    // Count the number of rows in the table
	    const rowCount = table.rows.length;
	    
	    // Create a button element
	    const button = document.createElement('button');
	    button.textContent = 'EnduX (' + rowCount + ' rows)';  // Button text with row count
	    
	    button.style.marginBottom = '10px';  // Optional: space between button and table
	    
	    // Insert the button above the table
	    table.parentNode.insertBefore(button, table);
	    
	    button.addEventListener('click', function() {
		// Redirect to Google when the button is clicked
		alert('clicked: ');
		window.location.href = 'https://www.google.com';
	    });
	});
    },5000);
});
