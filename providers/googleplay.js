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
    parseResults(html).forEach((entry, rank) => {
      if (seen.has(entry.pkg)) return;
      seen.add(entry.pkg);
      games.push({
        title: entry.title,
        developer: entry.developer,
        image: entry.image,
        rating: entry.rating,
        ratingCount: entry.reviews,
        year: null,
        genres: [],
        players: null,
        source: 'Google Play',
        sourceRank: rank,
        platforms: [
          {
            platform: 'android',
            access: entry.price !== null && entry.price > 0 ? 'paid' : entry.price === 0 ? 'free' : null,
            price: entry.price,
            url: `https://play.google.com/store/apps/details?id=${entry.pkg}`,
          },
        ],
      });
    });
  }
  return games;
}

// The search page renders two kinds of result cards:
//  - a featured card: <a href="/store/apps/details?id=PKG" aria-label="TITLE">
//    followed by <div class="vWM94c">TITLE</div><div class="LbQbAe">DEV</div>
//  - regular cards: <span class="DdYX5">TITLE</span> then
//    <span class="wMUdtb">DEV</span>
// Each card's markup runs until the next details link with a different id.
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
    const end = i + 1 < positions.length ? positions[i + 1].index : start + 6000;
    const card = html.slice(start, Math.min(end, start + 6000));

    const title =
      pick(card, /<span class="DdYX5">([^<]+)<\/span>/) ||
      pick(card, /<div class="vWM94c">([^<]+)<\/div>/) ||
      pick(card, /aria-label="([^"]+)"/);
    if (!title || /^Rated /.test(title)) continue;
    const developer =
      pick(card, /<span class="wMUdtb">([^<]+)<\/span>/) ||
      pick(card, /<div class="LbQbAe">([^<]+)<\/div>/);

    // Prices appear as a buy button label ("$6.99 Buy") or a standalone
    // price element (">$3.99<"); a "$" inside description text is ignored.
    const priceMatch = card.match(/(?:aria-label="|>)\$(\d+(?:\.\d{2})?)\b/);
    const reviewsMatch = card.match(/>([\d.]+)([KMB]?) reviews</);
    const ratingMatch = card.match(/Rated (\d(?:\.\d)?) stars/);
    const imgMatch =
      card.match(/(https:\/\/play-lh\.googleusercontent\.com\/[A-Za-z0-9_\-]+)=s\d+[^"]*"[^>]*alt="(?:Thumbnail|Icon) image"/) ||
      card.match(/(https:\/\/play-lh\.googleusercontent\.com\/[A-Za-z0-9_\-]+)=s\d+/);

    out.push({
      pkg: positions[i].pkg,
      title,
      developer,
      image: imgMatch ? `${imgMatch[1]}=s256` : null,
      rating: ratingMatch ? Number(ratingMatch[1]) : null,
      reviews: reviewsMatch
        ? Math.round(Number(reviewsMatch[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[reviewsMatch[2]] || 1))
        : null,
      // A listed price means paid; no price on a card means free to install.
      price: priceMatch ? Number(priceMatch[1]) : 0,
    });
    if (out.length >= 60) break;
  }
  return out;
}

function pick(text, re) {
  const m = text.match(re);
  return m ? decode(m[1].trim()) : null;
}

function decode(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

module.exports = { search };
