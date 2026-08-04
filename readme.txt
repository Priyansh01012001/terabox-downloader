Quick setup (local, non-Docker)
1) Copy files into a folder.
2) npm install
3) NODE_ENV=production node server.js
4) Open http://localhost:3000

Using Docker (recommended for Puppeteer)
1) docker build -t terabox-extractor .
2) docker run -p 3000:3000 --rm terabox-extractor
3) Open http://localhost:3000

Important production notes
- Puppeteer needs CPU/memory; use a VPS (DigitalOcean, Linode, Hetzner). Do NOT run heavy load on Vercel.
- Add HTTPS (reverse proxy / nginx) in front for security.
- Restrict CORS origins in server.js before going public.
- Increase CACHE_TTL_MS if you want longer caching of captured media URLs.
- Respect content ownership and Terabox TOS. Only use for content you own or have permission for.
- Add monitoring and logs for errors and extraction failures.
