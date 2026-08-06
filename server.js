// server.js
// Lightweight Express server for Render/Docker
// Supports direct public media URLs only (.mp4/.webm/.mov/.m4v/.m3u8)
// No Puppeteer/Chromium, so it works better on Render free tier.

const express = require('express');
const path = require('path');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { pipeline } = require('stream');
const { promisify } = require('util');
const dns = require('dns').promises;
const net = require('net');

const pump = promisify(pipeline);

const app = express();
const PORT = process.env.PORT || 3000;

// Optional allowlist:
// Example env: ALLOWED_HOSTS=example.com,mycdn.com
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/healthz', (req, res) => {
  res.status(200).json({ ok: true });
});

function isValidHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isPrivateIp(ip) {
  if (!ip) return true;

  // IPv6 localhost/private basics
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) {
    return true;
  }

  // IPv4 checks
  if (net.isIP(ip) === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;

    // 10.0.0.0/8
    if (a === 10) return true;

    // 127.0.0.0/8
    if (a === 127) return true;

    // 172.16.0.0 - 172.31.255.255
    if (a === 172 && b >= 16 && b <= 31) return true;

    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;

    // 169.254.0.0/16
    if (a === 169 && b === 254) return true;

    // 0.0.0.0
    if (a === 0) return true;
  }

  return false;
}

function hostAllowedByEnv(hostname) {
  if (!ALLOWED_HOSTS.length) return true;

  hostname = hostname.toLowerCase();

  return ALLOWED_HOSTS.some(allowed => {
    return hostname === allowed || hostname.endsWith('.' + allowed);
  });
}

async function validatePublicUrl(rawUrl) {
  if (!isValidHttpUrl(rawUrl)) {
    throw new Error('Invalid URL');
  }

  const u = new URL(rawUrl);
  const hostname = u.hostname.toLowerCase();

  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '0.0.0.0'
  ) {
    throw new Error('Localhost/private URLs are not allowed');
  }

  if (!hostAllowedByEnv(hostname)) {
    throw new Error('This host is not allowed by server configuration');
  }

  // If hostname is already IP, check directly
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error('Private IP URLs are not allowed');
    }
    return true;
  }

  // DNS check to reduce SSRF risk
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records.length) {
      throw new Error('Could not resolve hostname');
    }

    for (const record of records) {
      if (isPrivateIp(record.address)) {
        throw new Error('Private network target is not allowed');
      }
    }
  } catch (err) {
    throw new Error(err.message || 'DNS validation failed');
  }

  return true;
}

function isDirectMediaUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const pathname = decodeURIComponent(u.pathname).toLowerCase();
    return /\.(mp4|webm|mov|m4v|m3u8)(?:$|\?)/i.test(pathname);
  } catch {
    return false;
  }
}

function isKnownProtectedPlatform(rawUrl) {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return (
      hostname.includes('terabox.com') ||
      hostname.includes('1024terabox.com') ||
      hostname.includes('teraboxapp.com') ||
      hostname.includes('nephobox.com') ||
      hostname.includes('4funbox.com') ||
      hostname.includes('mirrobox.com')
    );
  } catch {
    return false;
  }
}

function humanSize(bytes) {
  if (!bytes) return 'Unknown';

  let n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return 'Unknown';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;

  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }

  return `${n.toFixed(n < 10 && i > 0 ? 2 : 1)} ${units[i]}`;
}

function fileNameFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const base = path.basename(u.pathname);
    return decodeURIComponent(base || 'video');
  } catch {
    return 'video';
  }
}

async function getMediaInfo(rawUrl) {
  try {
    const head = await axios.head(rawUrl, {
      timeout: 10000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': '*/*'
      },
      validateStatus: status => status >= 200 && status < 400
    });

    const contentType = head.headers['content-type'] || null;
    const contentLength = head.headers['content-length']
      ? Number(head.headers['content-length'])
      : null;

    return {
      contentType,
      contentLength,
      sizeText: humanSize(contentLength)
    };
  } catch {
    return {
      contentType: null,
      contentLength: null,
      sizeText: 'Unknown'
    };
  }
}

app.post('/api/extract', async (req, res) => {
  const { url } = req.body || {};

  if (!url || !isValidHttpUrl(url)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid or missing URL'
    });
  }

  // Safe handling for protected platforms
  if (isKnownProtectedPlatform(url)) {
    return res.status(422).json({
      success: false,
      error:
        'Protected platform links cannot be directly extracted/proxied here. Use an official embed/API or a direct public media URL you own.',
      openUrl: url
    });
  }

  if (!isDirectMediaUrl(url)) {
    return res.status(422).json({
      success: false,
      error:
        'Please provide a direct public video URL ending with .mp4, .webm, .mov, .m4v, or .m3u8.'
    });
  }

  try {
    await validatePublicUrl(url);

    const info = await getMediaInfo(url);
    const proxied = `/api/stream?url=${encodeURIComponent(url)}`;

    return res.json({
      success: true,
      isEmbed: false,
      downloadUrl: proxied,
      fileName: fileNameFromUrl(url),
      contentType: info.contentType,
      contentLength: info.contentLength,
      sizeText: info.sizeText
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message || 'URL validation failed'
    });
  }
});

app.get('/api/stream', async (req, res) => {
  const rawUrl = req.query.url;

  if (!rawUrl || !isValidHttpUrl(rawUrl)) {
    return res.status(400).json({
      error: 'Missing or invalid url'
    });
  }

  if (isKnownProtectedPlatform(rawUrl)) {
    return res.status(422).json({
      error: 'Protected platform proxying is not supported'
    });
  }

  if (!isDirectMediaUrl(rawUrl)) {
    return res.status(422).json({
      error: 'Only direct media URLs are supported'
    });
  }

  try {
    await validatePublicUrl(rawUrl);

    const clientRange = req.headers.range;

    const upstreamResp = await axios({
      method: 'GET',
      url: rawUrl,
      responseType: 'stream',
      timeout: 30000,
      maxRedirects: 5,
      headers: {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        'Accept': '*/*',
        ...(clientRange ? { Range: clientRange } : {})
      },
      validateStatus: status =>
        (status >= 200 && status < 300) || status === 206
    });

    if (upstreamResp.headers['content-type']) {
      res.setHeader('Content-Type', upstreamResp.headers['content-type']);
    }

    if (upstreamResp.headers['content-length']) {
      res.setHeader('Content-Length', upstreamResp.headers['content-length']);
    }

    if (upstreamResp.headers['accept-ranges']) {
      res.setHeader('Accept-Ranges', upstreamResp.headers['accept-ranges']);
    } else {
      res.setHeader('Accept-Ranges', 'bytes');
    }

    if (upstreamResp.headers['content-range']) {
      res.setHeader('Content-Range', upstreamResp.headers['content-range']);
    }

    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    res.status(upstreamResp.status === 206 || clientRange ? 206 : 200);

    await pump(upstreamResp.data, res);
  } catch (err) {
    console.error('Stream error:', err.message || err);

    if (!res.headersSent) {
      return res.status(502).json({
        error: 'Failed to fetch stream',
        details: err.message || 'Unknown error'
      });
    }

    try {
      res.end();
    } catch {}
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Not found'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
