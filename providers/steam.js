'use strict';

// Steam store search — Windows / Mac games. Public endpoints, no key.
// Search:  https://store.steampowered.com/api/storesearch/
// Details: https://store.steampowered.com/api/appdetails?appids=<id>
// Details are fetched (bounded) to obtain genres, player modes and year.

const { fetchJSON, mapLimit } = require('./util');

async function search(terms) {
  const byAppId = new Map();
  for (const term of terms) {
    const url =
      'https://store.steampowered.com/api/storesearch/?cc=US&l=en' +
      `&term=${encodeURIComponent(term || '')}`;
    const data = await fetchJSON(url);
    for (const item of data.items || []) {
      if (!byAppId.has(item.id)) byAppId.set(item.id, item);
    }
  }

  const items = [...byAppId.values()].slice(0, 60);

  // Enrich the first batch with app details (genres / categories / year).
  const details = await mapLimit(items.slice(0, 30), 5, async (item) => {
    const data = await fetchJSON(
      `https://store.steampowered.com/api/appdetails?appids=${item.id}&cc=US&l=en`,
      {},
      8000
    );
    const entry = data && data[item.id];
    return entry && entry.success ? entry.data : null;
  });

  return items.map((item, i) => {
    const d = details[i] || null;
    const price =
      item.price && typeof item.price.final === 'number'
        ? item.price.final / 100
        : d && d.price_overview
          ? d.price_overview.final / 100
          : d && d.is_free
            ? 0
            : null;
    const access = price === 0 ? 'free' : price !== null && price > 0 ? 'paid' : null;

    const platforms = [];
    const plat = (d && d.platforms) || item.platforms || {};
    if (plat.windows) platforms.push({ platform: 'windows', access, price, url: storeUrl(item.id) });
    if (plat.mac) platforms.push({ platform: 'mac', access, price, url: storeUrl(item.id) });

    const categories = d ? (d.categories || []).map((c) => c.description) : [];
    let players = null;
    if (categories.some((c) => /co-op/i.test(c))) players = 'coop';
    else if (categories.some((c) => /multi-player|multiplayer|mmo/i.test(c))) players = 'multi';
    else if (categories.some((c) => /single-player/i.test(c))) players = 'single';

    return {
      title: item.name,
      developer: d && d.developers ? d.developers.join(', ') : null,
      image: item.tiny_image || (d && d.header_image) || null,
      rating: item.metascore ? Number(item.metascore) / 20 : null, // Metascore 0-100 -> 0-5
      ratingCount: null,
      year:
        d && d.release_date && d.release_date.date
          ? Number((d.release_date.date.match(/\d{4}/) || [])[0]) || null
          : null,
      genres: d ? (d.genres || []).map((g) => g.description) : [],
      players,
      source: 'Steam',
      platforms,
    };
  }).filter((g) => g.platforms.length > 0);
}

function storeUrl(appId) {
  return `https://store.steampowered.com/app/${appId}/`;
}

module.exports = { search };
