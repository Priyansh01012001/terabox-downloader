// Run on VPS. Example Express endpoint using puppeteer to capture .m3u8/.mp4 requests.
// Install: npm i puppeteer express
const express = require('express');
const puppeteer = require('puppeteer');
const app = express();
const PORT = process.env.PORT || 4000;

async function findMediaUrl(embedPage) {
  const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  let mediaUrl = null;

  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  await page.setRequestInterception(true);

  page.on('request', req => {
    const url = req.url();
    if (/\.m3u8|\.mp4/.test(url)) {
      mediaUrl = url;
      // we can continue requests
    }
    req.continue();
  });

  try {
    await page.goto(embedPage, { waitUntil: 'networkidle2', timeout: 30000 });
    // wait a bit for media requests to fire
    await page.waitForTimeout(3000);
  } catch (e) {
    console.error('puppeteer goto error', e.message || e);
  } finally {
    await browser.close();
  }
  return mediaUrl;
}

app.get('/extract', async (req, res) => {
  const embed = req.query.embed;
  if (!embed) return res.status(400).json({ error: 'missing embed' });
  try {
    const media = await findMediaUrl(embed);
    if (!media) return res.status(404).json({ error: 'media not found' });
    return res.json({ mediaUrl: media });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log('Puppeteer extractor listening on', PORT));
