const axios = require('axios');

// Example test data to send to the server
const testData = {
    name: 'John Doe',
    email: 'john.doe@example.com',
    pageSource: '<html><body><h1>Test Page</h1></body></html>' // Example of page source
};

// Send the POST request to the local server
axios.post('http://localhost:3000/submit', testData)
    .then(response => {
        console.log('Server Response:', response.data);
    })
    .catch(error => {
        console.error('Error occurred:', error);
    });
