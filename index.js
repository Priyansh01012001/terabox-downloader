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
            return res.status(400).json({ success: false, error: 'Link toh daal bhai!' });
        }

        // Direct url return karenge bina kisi external dependency ke
        return res.json({
            success: true,
            fileName: "Terabox_Video.mp4",
            downloadUrl: url
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
