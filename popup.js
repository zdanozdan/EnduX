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

    //alert('ready to fetch data');

    // Send the data to the local Express server
    //const url = 'http://localhost:3000/submit';  // Local server URL
    //const url = 'https://enduhub.com/pl/api/event/109353?format=json';
    const url = 'https://enduhub.com/pl/api/submits/?format=json';

    const data = {
        name: name,
        email: email,
        pageSource: pageSource  // Attach the page source
    };

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
	    const firstRecord = data[0];  // Get the first record in the array
	    const imieNazwisko = firstRecord.imie_nazwisko; 
            document.getElementById('responseMessage').textContent = imieNazwisko;
            console.log(data);  // Log server response

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

	    document.getElementById('responseMessage').textContent = "Pobrano: "+events.length;
	})
	.catch((error) => {
            document.getElementById('responseMessage').textContent = error;
            console.error('Error:', error);  // Log any errors
	});
});
