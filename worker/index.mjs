// Game Search API as a Cloudflare Worker.
// Serves GET /api/search (same parameters and JSON as the Node server)
// so the static page on GitHub Pages can search every store: the stores
// don't allow cross-origin requests from a browser, the Worker does the
// fetching server-side and answers with CORS headers.
//
// Deploy: npx wrangler deploy   (config in wrangler.toml at the repo root)

import search from '../lib/search.js';

const { handleSearch, configure } = search;

// Free Workers get 50 outbound requests per incoming request. Steam's
// per-game detail lookups are the bulk of them, so cap those here.
configure({ steamDetails: 12 });

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());
  const origin = request.headers.get('Origin') || '';
  const allow = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (url.pathname === '/api/search' && request.method === 'GET') {
      try {
        const body = await handleSearch(url.searchParams);
        // Let Cloudflare's edge and the browser reuse a page for a few minutes.
        return json(body, 200, { ...cors, 'Cache-Control': 'public, max-age=300' });
      } catch (err) {
        return json({ error: String((err && err.message) || err) }, 500, cors);
      }
    }
    if (url.pathname === '/') {
      return json({ ok: true, endpoints: ['/api/search'] }, 200, cors);
    }
    return json({ error: 'Not found' }, 404, cors);
  },
};
