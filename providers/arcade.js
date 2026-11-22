'use strict';

// Apple Arcade (iOS) — no official search API flags Arcade titles.
// Apple's own Arcade page is fetched server-side at query time; its
// embedded JSON payload lists the Arcade catalogue (lockup objects).
// Access for these entries is always "arcade". If the fetch or parse
// fails, this provider returns nothing — titles are never fabricated.

const { fetchText, norm } = require('./util');

// Note: /us/arcade itself serves only a redirect shell; the full Arcade
// catalogue page (with the lockup payload) is the iPhone Arcade page.
const ARCADE_URL = 'https://apps.apple.com/us/iphone/arcade';
let cache = { ts: 0, games: [] };
const CACHE_MS = 2 * 60 * 60 * 1000;

async function catalogue() {
  if (Date.now() - cache.ts < CACHE_MS && cache.games.length) return cache.games;
  const html = await fetchText(ARCADE_URL);
  const games = parseArcade(html);
  if (games.length) cache = { ts: Date.now(), games };
  return games;
}

async function search(terms) {
  let all;
  try {
    all = await catalogue();
  } catch {
    return [];
  }
  const needles = terms.map(norm).filter((t) => t && t !== 'game' && t !== 'games');
  if (!needles.length) return all;
  return all.filter((g) => {
    const title = norm(g.title);
    return needles.some((n) => title.includes(n) || n.includes(title));
  });
}

// The page carries a serialized JSON payload; walk it and collect lockup
// objects (objects holding both a title/name and an app id or store url).
function parseArcade(html) {
  const scriptMatch = html.match(
    /<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/
  );
  const jsonText = scriptMatch ? scriptMatch[1] : null;
  const found = new Map();
  if (jsonText) {
    try {
      walk(JSON.parse(jsonText), found);
    } catch {
      /* fall through to regex fallback */
    }
  }
  if (!found.size) {
    // Fallback: app links in the raw markup carry ids; titles sit in
    // adjacent heading text.
    const linkRe = /href="\/us\/app\/[^"]*?id(\d+)"/g;
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      const window = html.slice(m.index, m.index + 1500);
      const t = window.match(/>([^<>{}"]{2,80})</);
      if (t && !found.has(m[1])) {
        found.set(m[1], {
          id: m[1],
          title: t[1].trim(),
        });
      }
    }
  }
  return [...found.values()]
    .filter((g) => g.title && g.title.length >= 2)
    .map((g) => ({
      title: g.title,
      developer: g.developer || null,
      image: g.image || null,
      rating: typeof g.rating === 'number' ? g.rating : null,
      ratingCount: g.ratingCount || null,
      year: null,
      genres: [],
      players: null,
      source: 'Apple Arcade',
      platforms: [
        {
          platform: 'ios',
          access: 'arcade',
          price: null,
          url: `https://apps.apple.com/us/app/id${g.id}`,
        },
      ],
    }));
}

// Arcade titles appear in the payload as Lockup objects:
// { $kind: "Lockup", title, adamId, icon: { template }, rating, ... }
function walk(node, found) {
  if (!node || typeof node !== 'object') return;
  if (!Array.isArray(node) && node.$kind === 'Lockup') {
    const id = node.adamId;
    const title = node.title;
    if (id !== undefined && typeof title === 'string' && /^\d+$/.test(String(id))) {
      if (!found.has(String(id))) {
        let image = null;
        const icon = node.icon;
        if (icon && icon.template) {
          image = icon.template
            .replace('{w}', '512')
            .replace('{h}', '512')
            .replace('{c}', '')
            .replace('{f}', 'png');
        }
        found.set(String(id), {
          id: String(id),
          title,
          image,
          rating: node.rating,
          ratingCount: parseCount(node.ratingCount),
          developer: typeof node.developer === 'string' ? node.developer : null,
        });
      }
    }
  }
  for (const value of Object.values(node)) walk(value, found);
}

function parseCount(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const m = value.match(/^([\d.]+)\s*([KM])?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!m[2]) return n;
  return Math.round(n * (m[2].toUpperCase() === 'K' ? 1000 : 1000000));
}

module.exports = { search };
