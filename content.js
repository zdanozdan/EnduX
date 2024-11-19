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
    //alert('Page loaded. Extension is ready');
});
