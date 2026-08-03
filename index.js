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
            return res.status(400).json({ success: false, error: 'Please provide a Terabox link!' });
        }

        // Yahan hum public extraction API ya scraping logic use karenge
        // Filhal testing ke liye hum check kar rahe hain ki link valid hai ya nahi
        if (!url.includes('terabox') && !url.includes('1024tera')) {
            return res.status(400).json({ success: false, error: 'Invalid Terabox link!' });
        }

        // Note: Terabox links ko direct stream me badalne ke liye hum free public parser APIs ka use kar sakte hain
        // Yahan hum ek reliable public endpoint integrate kar rahe hain
        const apiResponse = `https://terabox-dl.qtcloud.workers.dev/api/get-info?url=${encodeURIComponent(url)}`;
        
        const response = await axios.get(apiResponse);
        
        if (response.data && response.data.direct_link) {
            res.json({
                success: true,
                fileName: response.data.file_name || "Terabox_Video.mp4",
                downloadUrl: response.data.direct_link
            });
        } else {
            // Fallback agar direct API response na aaye
            res.json({
                success: false,
                error: 'Could not extract direct link. Try another link.'
            });
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'Internal Server Error during extraction' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
