'use strict';

// Steam store search — Windows / Mac games. Public endpoints, no key.
//
// Search:  https://store.steampowered.com/search/results/?infinite=1
//          (the store's own search, restricted to category1=998 = Games,
//          so DLC, soundtracks, tools and videos are excluded; returns up
//          to 50 rows per page with platforms, release date, price and
//          review score)
// Details: https://store.steampowered.com/api/appdetails?appids=<id>
//          (fetched for the top results only, to add genres and player
//          modes; Steam rate-limits this endpoint)

const { fetchJSON, mapLimit } = require('./util');

const DETAILS_LIMIT = 24;
const detailsCache = new Map(); // appid -> { ts, data }
const DETAILS_MS = 6 * 60 * 60 * 1000;

async function search(terms) {
  const byAppId = new Map();
  for (const term of terms) {
    const rows = await searchRows(term);
    rows.forEach((row, i) => {
      if (!byAppId.has(row.id)) byAppId.set(row.id, { ...row, rank: i });
    });
  }
  const items = [...byAppId.values()];

  const details = await mapLimit(items.slice(0, DETAILS_LIMIT), 6, (item) =>
    appDetails(item.id)
  );

  const games = [];
  items.forEach((item, i) => {
    const d = details[i] || null;
    if (d && d.type && d.type !== 'game') return; // safety net: drop DLC etc.

    let price = item.price;
    if (price === null && d) {
      if (d.is_free) price = 0;
      else if (d.price_overview) price = d.price_overview.final / 100;
    }
    const access = price === 0 ? 'free' : price !== null && price > 0 ? 'paid' : null;

    const plat = d && d.platforms ? d.platforms : item.platforms;
    const platforms = [];
    const url = `https://store.steampowered.com/app/${item.id}/`;
    if (plat.windows) platforms.push({ platform: 'windows', access, price, url });
    if (plat.mac) platforms.push({ platform: 'mac', access, price, url });
    if (!platforms.length) return;

    const categories = d ? (d.categories || []).map((c) => c.description) : [];
    let players = null;
    if (categories.some((c) => /co-op/i.test(c))) players = 'coop';
    else if (categories.some((c) => /multi-player|multiplayer|mmo|pvp/i.test(c))) players = 'multi';
    else if (categories.some((c) => /single-player/i.test(c))) players = 'single';

    games.push({
      title: item.title,
      developer: d && d.developers ? d.developers.join(', ') : null,
      image: (d && d.header_image) || item.image || null,
      // Steam's % positive (0-100) mapped onto a 0-5 scale.
      rating: item.reviewPct !== null ? Math.round((item.reviewPct / 20) * 10) / 10 : null,
      ratingCount: item.reviewCount,
      year: item.year || (d && d.release_date ? yearOf(d.release_date.date) : null),
      genres: d ? (d.genres || []).map((g) => g.description) : [],
      players,
      source: 'Steam',
      sourceRank: item.rank,
      platforms,
    });
  });
  return games;
}

async function searchRows(term) {
  const url =
    'https://store.steampowered.com/search/results/?infinite=1&category1=998' +
    '&count=50&cc=US&l=english' +
    (term ? `&term=${encodeURIComponent(term)}` : '&filter=topsellers');
  const data = await fetchJSON(url);
  const html = (data && data.results_html) || '';
  const rows = [];
  for (const chunk of html.split(/<a href="/).slice(1)) {
    const id = (chunk.match(/data-ds-appid="(\d+)"/) || [])[1];
    const title = (chunk.match(/<span class="title">([^<]+)<\/span>/) || [])[1];
    if (!id || !title) continue;

    const priceAttr = chunk.match(/data-price-final="(\d+)"/);
    let price = priceAttr ? Number(priceAttr[1]) / 100 : null;
    if (price === null && /discount_final_price[^>]*>\s*Free/i.test(chunk)) price = 0;

    const review = chunk.match(/(\d+)% of the ([\d,]+) user reviews/);
    const released = (chunk.match(/search_released[^>]*>\s*([^<]*?)\s*</) || [])[1] || '';
    const img = (chunk.match(/<img src="([^"]+)"/) || [])[1] || null;

    rows.push({
      id,
      title: decode(title.trim()),
      price,
      reviewPct: review ? Number(review[1]) : null,
      reviewCount: review ? Number(review[2].replace(/,/g, '')) : null,
      year: yearOf(released),
      image: img,
      platforms: {
        windows: /platform_img win/.test(chunk),
        mac: /platform_img mac/.test(chunk),
      },
    });
  }
  return rows;
}

async function appDetails(id) {
  const hit = detailsCache.get(id);
  if (hit && Date.now() - hit.ts < DETAILS_MS) return hit.data;
  const data = await fetchJSON(
    `https://store.steampowered.com/api/appdetails?appids=${id}&cc=US&l=en`,
    {},
    8000
  );
  const entry = data && data[id];
  const result = entry && entry.success ? entry.data : null;
  detailsCache.set(id, { ts: Date.now(), data: result });
  return result;
}

function yearOf(text) {
  const m = String(text || '').match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
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
