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

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors()); // For simplicity allow CORS; restrict in production as needed
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

// Serve static index.html when run locally (Vercel will serve static separately)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Helpers
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

async function extractMediaFromEmbed(embedUrl) {
  try {
    const resp = await axios.get(embedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 10000,
      maxRedirects: 5,
      responseType: 'text'
    });
    const html = resp.data;
    const $ = cheerio.load(html);

    // 1) <video> source
    let src = $('video source').attr('src') || $('video').attr('src');
    if (src) return makeAbsoluteUrl(embedUrl, src);

    // 2) data-src / data-video attributes
    src = $('[data-src]').attr('data-src') || $('[data-video]').attr('data-video');
    if (src) return makeAbsoluteUrl(embedUrl, src);

    // 3) look for .m3u8 or .mp4 in HTML/script text
    const regex = /(https?:\/\/[^"'<>\\\s]+(?:\.m3u8|\.mp4)[^"'<>\\\s]*)/ig;
    let m;
    while ((m = regex.exec(html)) !== null) {
      if (m[1]) return m[1].startsWith('//') ? 'https:' + m[1] : m[1];
    }

    // 4) protocol-relative occurrence
    const protoRel = html.match(/(["'])\/\/[^"']+\.(m3u8|mp4)[^"']*\1/);
    if (protoRel) {
      return 'https:' + protoRel[0].slice(1, -1);
    }

    return null;
  } catch (err) {
    console.error('extractMediaFromEmbed error:', err.message || err);
    return null;
  }
}

// POST /api/extract
app.post('/api/extract', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ success: false, error: 'Link paste karo bhai!' });

  // try to normalize short id (common terabox pattern)
  let match = url.match(/\/s\/1([a-zA-Z0-9_-]+)/) || url.match(/surl=1([a-zA-Z0-9_-]+)/);
  let shortUrl = match ? "1" + match[1] : "";
  if (!shortUrl) {
    const parts = url.split('/');
    shortUrl = parts[parts.length - 1] || '';
  }

  const embedPage = shortUrl ? `https://www.1024terabox.com/sharing/embed?surl=${shortUrl}&autoplay=1` : url;

  // Try extract direct media (.mp4/.m3u8)
  let directMedia = null;
  if (isValidHttpUrl(embedPage)) {
    directMedia = await extractMediaFromEmbed(embedPage);
  }

  if (directMedia) {
    const proxied = `/api/stream?url=${encodeURIComponent(directMedia)}`;
    return res.json({
      success: true,
      fileName: path.basename(directMedia.split('?')[0]) || 'video.mp4',
      downloadUrl: proxied,
      isEmbed: false
    });
  }

  // Fallback to embed page (iframe). Note: embed may require JS or cookies to generate real media.
  return res.json({
    success: true,
    fileName: 'Terabox_Stream (embed)',
    downloadUrl: embedPage,
    isEmbed: true,
    warning: 'Direct media URL not auto-detected. If playback fails, the link may require JS or auth.'
  });
});

// GET /api/stream?url=ENCODED_URL -> proxy stream with Range support
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

    // forward important headers
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
      const status = err.response.status || 502;
      return res.status(status).json({ error: 'Upstream error', details: err.message });
    }
    return res.status(502).json({ error: 'Failed to fetch stream', details: err.message });
  }
});

// Export app (for Vercel). When run directly, start server.
module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
          }
