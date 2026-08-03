const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Frontend HTML serve karne ke liye
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Terabox link extract karne ka API endpoint
app.post('/api/extract', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'Please provide a Terabox link!' });
        }

        // Yahan hum link processing logic jodenge
        // Abhi ke liye hum ek dummy direct link return kar rahe hain testing ke liye
        res.json({
            success: true,
            downloadUrl: url,
            fileName: "Terabox_Video.mp4"
        });

    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
