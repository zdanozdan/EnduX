// popup.js
document.getElementById('myForm').addEventListener('submit', function(event) {
    event.preventDefault();  // Prevents the form from submitting normally
    
    // Collect form data
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    
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
	    
	    const data = {
		name: name,
		email: email,
		pageSource: cleanedPageSource  // Attach the page source
	    };
	    
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
});

document.getElementById('testButton').addEventListener('click', function(event) {
    event.preventDefault();  // Prevents the form from submitting normally
    
    // Collect form data
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    
    // Get the page source (HTML)
    const pageSource = document.documentElement.outerHTML;

    // Send the data to the local Express server
    const url = 'http://localhost:3000/submit';  // Local server URL

    const data = {
        name: name,
        email: email,
        pageSource: pageSource  // Attach the page source
    };

    // Send data using Fetch API
    fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'  // Specify content type as JSON
        },
        body: JSON.stringify(data)  // Convert data to JSON
    })
    .then(response => response.json())
    .then(data => {
        document.getElementById('responseMessage').textContent = 'Form data sent successfully!';
        console.log(data);  // Log server response
    })
    .catch((error) => {
        document.getElementById('responseMessage').textContent = 'There was an error sending the form.';
	alert(error)
        console.error('Error:', error);  // Log any errors
    });
});
