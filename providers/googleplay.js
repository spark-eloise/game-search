'use strict';

// Google Play (Android) — no official search API exists.
// The store's own search page is fetched server-side at query time and
// parsed. If the fetch or parse fails, this provider returns nothing —
// results are never fabricated.

const { fetchText } = require('./util');

async function search(terms) {
  const games = [];
  const seen = new Set();
  for (const term of terms) {
    const url =
      'https://play.google.com/store/search?c=apps&hl=en_US&gl=US&q=' +
      encodeURIComponent(term || 'games');
    let html;
    try {
      html = await fetchText(url);
    } catch {
      continue;
    }
    for (const entry of parseResults(html)) {
      if (seen.has(entry.pkg)) continue;
      seen.add(entry.pkg);
      games.push({
        title: entry.title,
        developer: entry.developer,
        image: entry.image,
        rating: entry.rating,
        ratingCount: null,
        year: null,
        genres: [],
        players: null,
        source: 'Google Play',
        platforms: [
          {
            platform: 'android',
            access: entry.price !== null && entry.price > 0 ? 'paid' : entry.price === 0 ? 'free' : null,
            price: entry.price,
            url: `https://play.google.com/store/apps/details?id=${entry.pkg}`,
          },
        ],
      });
    }
  }
  return games;
}

// The search page embeds each result's package id in details links, with
// the title and price in the surrounding markup. Extract per-result windows.
function parseResults(html) {
  const out = [];
  const idRe = /\/store\/apps\/details\?id=([a-zA-Z0-9._]+)/g;
  const positions = [];
  let m;
  while ((m = idRe.exec(html)) !== null) {
    if (!positions.some((p) => p.pkg === m[1])) {
      positions.push({ pkg: m[1], index: m.index });
    }
  }
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].index;
    const end = i + 1 < positions.length ? positions[i + 1].index : start + 4000;
    const window = html.slice(start, Math.min(end, start + 4000));

    // Title: first substantial span text in the window; developer: next one.
    let title = null;
    let developer = null;
    const spanRe = /<span[^>]*>([^<]{2,90})<\/span>/g;
    let s;
    while ((s = spanRe.exec(window)) !== null) {
      const text = s[1].trim();
      if (!text || /^(Free|Install|Contains ads|In-app purchases|\$|★)/.test(text)) continue;
      if (!title) { title = text; continue; }
      developer = text;
      break;
    }
    if (!title) continue;

    const priceMatch = window.match(/\$(\d+\.\d{2})/);
    const price = priceMatch ? Number(priceMatch[1]) : null;
    const ratingMatch = window.match(/(\d\.\d)\s*★|★\s*(\d\.\d)/);
    const imgMatch = window.match(/https:\/\/play-lh\.googleusercontent\.com\/[A-Za-z0-9_\-=]+/);

    out.push({
      pkg: positions[i].pkg,
      title,
      developer,
      image: imgMatch ? imgMatch[0] : null,
      rating: ratingMatch ? Number(ratingMatch[1] || ratingMatch[2]) : null,
      price,
    });
    if (out.length >= 60) break;
  }
  return out;
}

module.exports = { search };
