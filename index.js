const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
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

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
        };

        const response = await axios.get(url, { headers });
        const html = response.data;
        const $ = cheerio.load(html);

        let directStreamUrl = null;

        const scriptTags = $('script').toArray();
        for (let script of scriptTags) {
            const scriptContent = $(script).html() || '';
            const streamMatch = scriptContent.match(/https?:\\?\/\\?\/[^\s"']+\.(mp4|m3u8)[^\s"']*/i) || 
                                scriptContent.match(/"dlink"\s*:\s*"(.*?)"/i);
                                
            if (streamMatch) {
                directStreamUrl = streamMatch[1] || streamMatch[0];
                directStreamUrl = directStreamUrl.replace(/\\/g, '');
                break;
            }
        }

        if (!directStreamUrl) {
            directStreamUrl = url;
        }

        return res.json({
            success: true,
            fileName: "Terabox_Direct_Stream.mp4",
            downloadUrl: directStreamUrl
        });

    } catch (error) {
        console.error("Extraction error:", error.message);
        return res.status(500).json({ success: false, error: 'Link process nahi ho paya, doosra link try karo!' });
    }
});

module.exports = app;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}
