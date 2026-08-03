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

        const cookieString = "ndus=YVOf2LVpeHuiTMati6UbujR3LJg821yBfes9B0ly; browserid=FC7WNxpU5oKPLaTFHiWcLAtSxujvwsU1Q0rvLIW4fZSu7W83eUCO6qBZiZY=; csrfToken=ODkMtlKj_BGuE6KzW_6ho8FZ";
        const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

        let shortUrl = "";
        const match = url.match(/\/s\/1([a-zA-Z0-9_-]+)/) || url.match(/surl=1([a-zA-Z0-9_-]+)/);
        if (match) {
            shortUrl = "1" + match[1];
        } else {
            const parts = url.split('/');
            shortUrl = parts[parts.length - 1].replace(/^s-/, '');
        }

        const targetApi = `https://www.1024terabox.com/sharing/list?shorturl=${shortUrl}&root=1`;

        const response = await axios.get(targetApi, {
            headers: {
                'Cookie': cookieString,
                'User-Agent': userAgent,
                'Referer': url,
                'X-Requested-With': 'XMLHttpRequest'
            },
            timeout: 12000
        });

        if (response.data && response.data.errno === 0 && response.data.list && response.data.list.length > 0) {
            const fileItem = response.data.list[0];
            const downloadUrl = fileItem.dlink || fileItem.streaming_url;
            const fileName = fileItem.server_filename || "Terabox_Video.mp4";

            if (downloadUrl) {
                return res.json({
                    success: true,
                    fileName: fileName,
                    downloadUrl: downloadUrl
                });
            }
        }

        return res.status(400).json({ success: false, error: 'File fetch nahi ho payi. Cookies ya link check karo.' });

    } catch (error) {
        console.error("Extraction error:", error.message);
        return res.status(500).json({ success: false, error: 'Server error! Link process nahi ho saka.' });
    }
});

module.exports = app;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}
