const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/extract', (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ success: false, error: 'Please provide a Terabox link!' });
        }

        if (!url.includes('terabox') && !url.includes('1024tera') && !url.includes('nephobox')) {
            return res.status(400).json({ success: false, error: 'Invalid Terabox link!' });
        }

        // Bina kisi external API ke direct link ko web player/stream format mein convert karna
        // Terabox sharing links ko direct stream ya download view mein badalne ka direct manipulation
        let directDownloadUrl = url;

        // Agar link share link hai toh use streamable format mein map karna
        if (url.includes('/s/')) {
            // Native conversion logic without external API dependencies
            directDownloadUrl = url.replace('/s/', '/sharing/link?surl=');
        }

        res.json({
            success: true,
            fileName: "Terabox_Stream_Video.mp4",
            downloadUrl: directDownloadUrl
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
