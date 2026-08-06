Docker
FROM node:20-bullseye-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]


Index.html 
<!DOCTYPE html>
<html lang="hi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Terabox Direct Player</title>
  <style>
    body{background:#0b1120;color:#fff;font-family:Segoe UI,Arial;margin:0;padding:20px;display:flex;flex-direction:column;align-items:center}
    .container{width:100%;max-width:720px}
    input{width:100%;padding:12px;border-radius:8px;border:1px solid #334155;background:#0f1724;color:#fff;margin-bottom:10px}
    button{padding:12px 16px;border-radius:8px;border:none;background:#2563eb;color:#fff;cursor:pointer}
    .info{color:#94a3b8;margin-top:8px}
    .player{margin-top:12px;background:#000;border-radius:8px;padding:12px;border:1px solid #202632}
    video{width:100%;max-height:480px;background:#000;border-radius:6px}
  </style>
</head>
<body>
  <div class="container">
    <h2>Terabox Direct Player</h2>
    <p class="info">Terabox link yahan paste karo aur bina kisi ad ke yahin video chalao:</p>
    <input id="link" placeholder="https://1024terabox.com/s/..." />
    <div style="display:flex;gap:8px">
      <button id="playBtn">Play Video</button>
      <button id="copyBtn">Copy Link</button>
    </div>
    <div id="meta" class="info"></div>

    <div class="player" id="playerWrap" style="display:none">
      <video id="player" controls autoplay></video>
    </div>
  </div>

  <script>
    document.getElementById('copyBtn').addEventListener('click', () => {
      const v = document.getElementById('link').value.trim();
      if(!v) return alert('Link paste karo');
      navigator.clipboard.writeText(v).then(() => alert('Copied'));
    });

    document.getElementById('playBtn').addEventListener('click', doExtract);

    async function doExtract(){
      const url = document.getElementById('link').value.trim();
      if(!url) return alert('Link paste karo');
      
      const meta = document.getElementById('meta');
      const playerWrap = document.getElementById('playerWrap');
      const player = document.getElementById('player');

      meta.innerText = 'Fetching video, please wait (takes 5-10 seconds)...';
      playerWrap.style.display = 'none';
      player.pause();
      player.src = '';

      try {
        const resp = await fetch('/api/extract', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ url })
        });
        const data = await resp.json();
        
        if(!resp.ok || !data.success){ 
          meta.innerText = data.error || 'Failed to extract video.'; 
          return; 
        }

        meta.innerText = `Filename: ${data.fileName || 'Video'} | Size: ${data.sizeText || 'Unknown'}`;
        playerWrap.style.display = 'block';
        player.src = data.downloadUrl;
        player.load();
        player.play().catch(e => console.log("Autoplay blocked:", e));

      } catch (err) {
        console.error(err);
        meta.innerText = 'Server error occurred.';
      }
    }
  </script>
</body>
</html>


Server.js 
// server.js
// Main Express server: /api/extract and /api/stream
// Uses cheerio to try quick extraction, falls back to Puppeteer to capture .mp4/.m3u8 requests.
// Caches extracted media URLs. Streams proxied media with Range support.

const express = require('express');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { pipeline } = require('stream');
const { promisify } = require('util');
const pump = promisify(pipeline);
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 5 * 60 * 1000); // 5 min
const MAX_PUPPETEER_CONCURRENCY = Number(process.env.MAX_PUPPETEER_CONCURRENCY || 2);

// Helmet configured to disable Content Security Policy so inline scripts work properly
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const cache = new Map();
let puppeteerActive = 0;

function isValidHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function makeAbsoluteUrl(base, maybeRelative) {
  if (!maybeRelative) return null;
  if (maybeRelative.startsWith('//')) return 'https:' + maybeRelative;
  if (maybeRelative.startsWith('http://') || maybeRelative.startsWith('https://')) return maybeRelative;
  try {
    const baseUrl = new URL(base);
    return new URL(maybeRelative, baseUrl).toString();
  } catch {
    return maybeRelative;
  }
}

async function extractMediaFromEmbedFast(embedUrl) {
  try {
    const resp = await axios.get(embedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
      maxRedirects: 5,
      responseType: 'text'
    });
    const html = resp.data;
    const $ = cheerio.load(html);

    let src = $('video source').attr('src') || $('video').attr('src');
    if (src) return makeAbsoluteUrl(embedUrl, src);

    src = $('[data-src]').attr('data-src') || $('[data-video]').attr('data-video');
    if (src) return makeAbsoluteUrl(embedUrl, src);

    const regex = /(https?:\/\/[^"'<>\\\s]+(?:\.m3u8|\.mp4)[^"'<>\\\s]*)/ig;
    let m;
    while ((m = regex.exec(html)) !== null) {
      if (m[1]) return m[1].startsWith('//') ? 'https:' + m[1] : m[1];
    }

    const protoRel = html.match(/(["'])\/\/[^"']+\.(m3u8|mp4)[^"']*\1/);
    if (protoRel) {
      return 'https:' + protoRel[0].slice(1, -1);
    }

    return null;
  } catch (err) {
    console.error('Fast extract error:', err.message || err);
    return null;
  }
}

async function extractMediaWithPuppeteer(embedUrl, timeoutMs = 20000) {
  const cached = cache.get(embedUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.mediaUrl;
  }

  if (puppeteerActive >= MAX_PUPPETEER_CONCURRENCY) {
    await new Promise(resolve => {
      const check = () => {
        if (puppeteerActive < MAX_PUPPETEER_CONCURRENCY) return resolve();
        setTimeout(check, 300);
      };
      check();
    });
  }

  puppeteerActive++;
  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    await page.setRequestInterception(true);

    let found = null;
    page.on('request', (req) => {
      try {
        const url = req.url();
        if (/\.m3u8|\.mp4/i.test(url)) {
          if (!found) found = url;
        }
      } catch (e) {}
      req.continue().catch(()=>{});
    });

    await page.goto(embedUrl, { waitUntil: 'networkidle2', timeout: timeoutMs }).catch(()=>{});
    
    await new Promise(resolve => setTimeout(resolve, 2500));

    if (!found) {
      const html = await page.content();
      const regex = /(https?:\/\/[^"'<>\\\s]+(?:\.m3u8|\.mp4)[^"'<>\\\s]*)/ig;
      let m;
      while ((m = regex.exec(html)) !== null) {
        if (m[1]) { found = m[1]; break; }
      }
    }

    if (found) {
      cache.set(embedUrl, { mediaUrl: found, expiresAt: Date.now() + CACHE_TTL_MS });
      return found;
    }
    return null;
  } catch (err) {
    console.error('Puppeteer extraction error:', err.message || err);
    return null;
  } finally {
    try { if (browser) await browser.close(); } catch(e){}
    puppeteerActive--;
  }
}

async function checkEmbedAllowed(embedPage) {
  try {
    const head = await axios.head(embedPage, { timeout: 7000, maxRedirects: 5, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const xfo = (head.headers['x-frame-options'] || '').toLowerCase();
    const csp = (head.headers['content-security-policy'] || '').toLowerCase();
    if (xfo.includes('deny') || xfo.includes('sameorigin')) return false;
    if (csp.includes('frame-ancestors')) return false;
    return true;
  } catch (err) {
    return false;
  }
}

function humanSize(bytes) {
  if (!bytes) return 'Unknown';
  let n = Number(bytes);
  const units = ['B','KB','MB','GB','TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 2 : 1)} ${units[i]}`;
}

app.post('/api/extract', async (req, res) => {
  const { url } = req.body || {};
  if (!url || !isValidHttpUrl(url)) return res.status(400).json({ success: false, error: 'Invalid or missing url' });

  let match = url.match(/\/s\/1([a-zA-Z0-9_-]+)/) || url.match(/surl=1([a-zA-Z0-9_-]+)/);
  let shortId = match ? "1" + match[1] : '';
  if (!shortId) {
    const parts = url.split('/');
    shortId = parts[parts.length - 1] || '';
  }
  const embedPage = shortId ? `https://www.1024terabox.com/sharing/embed?surl=${shortId}&autoplay=1` : url;

  let direct = await extractMediaFromEmbedFast(embedPage);

  if (!direct) {
    direct = await extractMediaWithPuppeteer(embedPage);
  }

  const embedAllowed = await checkEmbedAllowed(embedPage);

  if (direct) {
    try {
      const head = await axios.head(direct, { timeout: 8000, maxRedirects: 5, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const contentType = head.headers['content-type'] || '';
      const contentLength = head.headers['content-length'] ? Number(head.headers['content-length']) : null;
      const fileName = path.basename(new URL(direct).pathname) || 'video';
      const proxied = `/api/stream?url=${encodeURIComponent(direct)}`;
      return res.json({
        success: true,
        isEmbed: false,
        downloadUrl: proxied,
        fileName,
        contentType,
        contentLength,
        sizeText: humanSize(contentLength)
      });
    } catch (err) {
      const proxied = `/api/stream?url=${encodeURIComponent(direct)}`;
      return res.json({
        success: true,
        isEmbed: false,
        downloadUrl: proxied,
        fileName: path.basename(direct.split('?')[0]) || 'video',
        contentType: null,
        contentLength: null,
        sizeText: 'Unknown'
      });
    }
  }

  return res.json({
    success: true,
    isEmbed: true,
    downloadUrl: embedPage,
    fileName: 'Terabox_Stream (embed)',
    embedAllowed,
    warning: embedAllowed ? null : 'Embedding blocked or requires JS; use Open on Terabox.'
  });
});

app.get('/api/stream', async (req, res) => {
  const raw = req.query.url;
  if (!raw || !isValidHttpUrl(raw)) return res.status(400).json({ error: 'missing or invalid url' });

  const upstreamUrl = raw;
  const clientRange = req.headers.range;

  try {
    const axiosOpts = {
      method: 'GET',
      url: upstreamUrl,
      responseType: 'stream',
      timeout: 20000,
      maxRedirects: 5,
      headers: {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        ...(clientRange ? { Range: clientRange } : {})
      },
      validateStatus: status => (status >= 200 && status < 300) || status === 206
    };

    const upstreamResp = await axios(axiosOpts);

    if (upstreamResp.headers['content-type']) res.setHeader('Content-Type', upstreamResp.headers['content-type']);
    if (upstreamResp.headers['content-length']) res.setHeader('Content-Length', upstreamResp.headers['content-length']);
    if (upstreamResp.headers['accept-ranges']) res.setHeader('Accept-Ranges', upstreamResp.headers['accept-ranges']);
    if (upstreamResp.headers['content-range']) res.setHeader('Content-Range', upstreamResp.headers['content-range']);

    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (upstreamResp.status === 206 || clientRange) res.status(206);
    else res.status(200);

    await pump(upstreamResp.data, res);
  } catch (err) {
    console.error('stream error:', err.message || err);
    if (err.response) {
      return res.status(err.response.status || 502).json({ error: 'Upstream error', details: err.message });
    }
    return res.status(502).json({ error: 'Failed to fetch stream', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});



Package.json 
{
  "name": "terabox-extractor",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "cheerio": "^1.0.0-rc.12",
    "express": "^4.18.2",
    "helmet": "^6.0.0",
    "cors": "^2.8.5",
    "express-rate-limit": "^6.7.0",
    "puppeteer": "^21.3.0"
  }
}



Render-build.sh
#!/usr/bin/env bash
# Exit on error
set -o errexit

# Install dependencies for Puppeteer/Chromium
apt-get update && apt-get install -y \
libnss3 \
libnspr4 \
libatk1.0-0 \
libatk-bridge2.0-0 \
libcups2 \
libdrm2 \
libxkbcommon0 \
libxcomposite1 \
libxdamage1 \
libxfixes3 \
libxrandr2 \
libgbm1 \
libpango-1.0-0 \
libcairo2 \
libasound2 \
libatspi0 \
libx11-xcb1 \
libxcb-dri3-0




README
# Terabox Downloader & Quick Streamer

A Node.js web application that extracts and streams videos from Terabox sharing links using Cheerio and Puppeteer, packaged with Docker for seamless deployment.

---

## Local Setup (Non-Docker)
1. Clone or download the files into a local folder.
2. Install dependencies:
   ```bash
   npm install
