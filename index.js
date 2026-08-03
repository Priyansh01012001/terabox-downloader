const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/extract', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ success: false, error: 'Link paste karo bhai!' });
        }

        // Link se direct code extract karne ka safe tarika
        let match = url.match(/\/s\/1([a-zA-Z0-9_-]+)/) || url.match(/surl=1([a-zA-Z0-9_-]+)/);
        let shortUrl = match ? "1" + match[1] : "";

        if (!shortUrl) {
            const parts = url.split('/');
            shortUrl = parts[parts.length - 1];
        }

        // Agar link mil gaya toh direct player/download format ready karenge
        if (shortUrl) {
            // Direct web streaming fallback redirect link
            const directDownloadUrl = `https://www.1024terabox.com/sharing/link?surl=${shortUrl}`;
            
            return res.json({
                success: true,
                fileName: "Terabox_Stream_Video.mp4",
                downloadUrl: directDownloadUrl
            });
        }

        return res.status(400).json({ success: false, error: 'Sahi Terabox link daalo bhai.' });

    } catch (error) {
        console.error("Error:", error.message);
        return res.status(500).json({ success: false, error: 'Server error! Link process nahi ho saka.' });
    }
});

module.exports = app;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}
