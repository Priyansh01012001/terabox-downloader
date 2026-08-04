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
