const express = require('express');
const cors = require('cors');
const app = express();
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');

const extensionOrigin = 'chrome-extension://epdgokbmghfmgbaemdcbnafejngpbkmk';

app.use(express.json({ limit: '50mb' }));  // Increase the limit to 10MB (adjust as needed)

app.use(cors({
    origin: extensionOrigin, // Allow your extension's origin
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Middleware to parse JSON data
app.use(bodyParser.json());

app.post('/submit', (req, res) => {
    const { name, email, pageSource } = req.body;

    // Log the data or save it to a database
    console.log('Received data:', { name, email });

    // Define the path where you want to save the pageSource (e.g., in a file)
    const filePath = path.join(__dirname, 'pageSourceData.html');

    // Write the pageSource to a file (append if file already exists)
    fs.writeFile(filePath, `${pageSource}\n`, { encoding: 'utf8' }, (err) => {
        if (err) {
            console.log('Error writing to file', err);
         //   return res.status(500).json({ message: 'Error saving data to file' });
        }

        // Respond with success message
        //res.json({ message: 'Dane zostały odebrane i zapisane.' });
	console.log('Dane zapisane');
    });

    // Respond with a success message
    res.json({ message: 'Dane zostały odebrane.' });
});

app.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
});
