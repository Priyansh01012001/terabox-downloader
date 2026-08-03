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

        // Teri screenshots wali exact cookies yahan embedded hain
        const cookieString = "ndus=YVOf2LVpeHuiTMati6UbujR3LJg821yBfes9B0ly; browserid=FC7WNxpU5oKPLaTFHiWcLAtSxujvwsU1Q0rvLIW4fZSu7W83eUCO6qBZiZY=; csrfToken=ODkMtlKj_BGuE6KzW_6ho8FZ";
        const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

        // Terabox official web bypass worker endpoint
        const apiResponse = await axios.get(`https://terabox-dl-api.oto.workers.dev/?url=${encodeURIComponent(url)}`, {
            headers: {
                'Cookie': cookieString,
                'User-Agent': userAgent,
                'Referer': 'https://www.terabox.com/'
            },
            timeout: 12000
        });

        if (apiResponse.data && (apiResponse.data.url || apiResponse.data.downloadLink || apiResponse.data.direct_link)) {
            const downloadUrl = apiResponse.data.url || apiResponse.data.downloadLink || apiResponse.data.direct_link;
            const fileName = apiResponse.data.filename || "Terabox_Video.mp4";

            return res.json({
                success: true,
                fileName: fileName,
                downloadUrl: downloadUrl
            });
        }

        return res.status(400).json({ success: false, error: 'Link extract nahi ho paya. Dobara try karo.' });

    } catch (error) {
        console.error("Extraction error:", error.message);
        return res.status(500).json({ success: false, error: 'Server error! Terabox block kar raha hai.' });
    }
});

module.exports = app;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}
