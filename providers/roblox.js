'use strict';

// Roblox public search — no key required.
// Omni-search: https://apis.roblox.com/search-api/omni-search
// Game details: https://games.roblox.com/v1/games?universeIds=...
// Roblox games are always Free.

const { fetchJSON } = require('./util');
const { randomUUID } = require('crypto');

async function search(terms) {
  const games = [];
  const seen = new Set();

  for (const term of terms) {
    const sessionId = randomUUID();
    let pageToken = '';
    // Walk up to 3 omni-search pages per term.
    for (let page = 0; page < 3; page++) {
      const url =
        'https://apis.roblox.com/search-api/omni-search?sessionId=' +
        encodeURIComponent(sessionId) +
        `&searchQuery=${encodeURIComponent(term || 'adventure')}` +
        (pageToken ? `&nextPageToken=${encodeURIComponent(pageToken)}` : '');
      const data = await fetchJSON(url);
      const groups = (data.searchResults || []).filter(
        (g) => g.contentGroupType === 'Game'
      );
      const contents = groups.flatMap((g) => g.contents || []);
      const ids = contents.map((c) => c.universeId).filter((id) => !seen.has(id));
      ids.forEach((id) => seen.add(id));
      if (ids.length) {
        games.push(...(await details(ids, contents)));
      }
      pageToken = data.nextPageToken || '';
      if (!pageToken) break;
    }
  }
  return games;
}

async function details(universeIds, contents) {
  const url =
    'https://games.roblox.com/v1/games?universeIds=' +
    universeIds.map(encodeURIComponent).join('&universeIds=');
  const data = await fetchJSON(url);
  const byId = new Map(contents.map((c) => [c.universeId, c]));
  return (data.data || []).map((g) => {
    const c = byId.get(g.id) || {};
    return {
      title: g.name,
      developer: g.creator ? g.creator.name : null,
      image: null,
      rating: null,
      ratingCount: null,
      year: g.created ? new Date(g.created).getFullYear() : null,
      genres: g.genre && g.genre !== 'All' ? [g.genre] : [],
      players: g.maxPlayers && g.maxPlayers > 1 ? 'multi' : 'single',
      source: 'Roblox',
      platforms: [
        {
          platform: 'roblox',
          access: 'free',
          price: 0,
          url: g.rootPlaceId
            ? `https://www.roblox.com/games/${g.rootPlaceId}/`
            : 'https://www.roblox.com/discover',
        },
      ],
      playing: typeof c.playerCount === 'number' ? c.playerCount : g.playing || null,
    };
  });
}

module.exports = { search };
