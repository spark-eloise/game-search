'use strict';

// Game Search — standalone server. Plain Node, no dependencies.
// Run: node server.js   (PORT env, default 4173)
//
// Every search is live: providers are queried at request time and the
// merged result is kept only in a short-lived in-memory cache (2 h).
// Nothing is stored as a catalogue. The search logic lives in
// lib/search.js and is shared with the Cloudflare Worker (worker/).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleSearch, providerNames } = require('./lib/search');

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/search') {
    try {
      sendJSON(res, await handleSearch(url.searchParams));
    } catch (err) {
      sendJSON(res, { error: String((err && err.message) || err) }, 500);
    }
    return;
  }

  if (url.pathname === '/taxonomy.json') {
    return sendFile(res, path.join(__dirname, 'taxonomy.json'));
  }

  const filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  sendFile(res, filePath);
});

function sendJSON(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
    });
    res.end(data);
  });
}

server.listen(PORT, () => {
  console.log(`Game Search listening on http://localhost:${PORT}`);
  console.log(`Providers: ${providerNames().join(', ')}`);
});
