const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Server block bypass fallback route
app.post('/api/extract', async (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ success: false, error: 'Link paste karo bhai!' });
    }

    let match = url.match(/\/s\/1([a-zA-Z0-9_-]+)/) || url.match(/surl=1([a-zA-Z0-9_-]+)/);
    let shortUrl = match ? "1" + match[1] : "";
    if (!shortUrl) {
        const parts = url.split('/');
        shortUrl = parts[parts.length - 1];
    }

    // Direct embed/stream link generation
    if (shortUrl) {
        return res.json({
            success: true,
            fileName: "Terabox_Stream.mp4",
            downloadUrl: `https://www.1024terabox.com/sharing/embed?surl=${shortUrl}&autoplay=1`
        });
    }

    return res.status(400).json({ success: false, error: 'Invalid link' });
});

module.exports = app;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}
