const express = require('express');
const axios = require('axios');
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

        // Direct public streaming bypass endpoint to avoid Vercel IP blocking
        const response = await axios.get(`https://terabox-dl-api.oto.workers.dev/?url=${encodeURIComponent(url)}`, {
            timeout: 10000
        });

        if (response.data && (response.data.url || response.data.downloadLink)) {
            const downloadUrl = response.data.url || response.data.downloadLink;
            const fileName = response.data.filename || "Terabox_Video.mp4";

            return res.json({
                success: true,
                fileName: fileName,
                downloadUrl: downloadUrl
            });
        }

        return res.status(400).json({ success: false, error: 'Link extract nahi ho paya.' });

    } catch (error) {
        // Fallback direct web player link if API fails
        const { url } = req.body;
        let match = url.match(/\/s\/1([a-zA-Z0-9_-]+)/) || url.match(/surl=1([a-zA-Z0-9_-]+)/);
        let shortUrl = match ? "1" + match[1] : "";
        
        if (shortUrl) {
            return res.json({
                success: true,
                fileName: "Terabox_Video.mp4",
                downloadUrl: `https://www.1024terabox.com/sharing/link?surl=${shortUrl}`
            });
        }

        return res.status(500).json({ success: false, error: 'Server error! Link process nahi ho saka.' });
    }
});

module.exports = app;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}
