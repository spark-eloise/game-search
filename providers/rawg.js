'use strict';

// RAWG — optional provider. Activates only when RAWG_API_KEY is set in
// the environment. RAWG does not report store prices, so its platform
// entries carry access: null (shown without an access tag).
// Get a free key at https://rawg.io/apidocs

const { fetchJSON } = require('./util');

function enabled() {
  return Boolean(process.env.RAWG_API_KEY);
}

const PLATFORM_MAP = [
  [/ios|iphone|ipad/i, 'ios'],
  [/android/i, 'android'],
  [/mac/i, 'mac'],
  [/pc|windows/i, 'windows'],
];

async function search(terms) {
  if (!enabled()) return [];
  const key = process.env.RAWG_API_KEY;
  const games = [];
  for (const term of terms) {
    const url =
      'https://api.rawg.io/api/games?page_size=40&key=' +
      encodeURIComponent(key) +
      `&search=${encodeURIComponent(term || '')}`;
    const data = await fetchJSON(url);
    for (const g of data.results || []) {
      const platforms = [];
      for (const p of g.platforms || []) {
        const name = (p.platform && (p.platform.name || p.platform.slug)) || '';
        const hit = PLATFORM_MAP.find(([re]) => re.test(name));
        if (hit && !platforms.some((e) => e.platform === hit[1])) {
          platforms.push({
            platform: hit[1],
            access: null,
            price: null,
            url: `https://rawg.io/games/${g.slug}`,
          });
        }
      }
      if (!platforms.length) continue;
      games.push({
        title: g.name,
        developer: null,
        image: g.background_image || null,
        rating: g.rating || null,
        ratingCount: g.ratings_count || null,
        year: g.released ? new Date(g.released).getFullYear() : null,
        genres: (g.genres || []).map((x) => x.name),
        players: null,
        source: 'RAWG',
        platforms,
      });
    }
  }
  return games;
}

module.exports = { search, enabled };
