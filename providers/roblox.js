'use strict';

// Roblox public search — no key required.
// Omni-search: https://apis.roblox.com/search-api/omni-search
// Game details: https://games.roblox.com/v1/games?universeIds=...
// Votes:        https://games.roblox.com/v1/games/votes?universeIds=...
// Icons:        https://thumbnails.roblox.com/v1/games/icons?universeIds=...
// Roblox games are always Free.
//
// Omni-search rate-limits quickly (HTTP 429). Results from terms already
// fetched are kept when a later one fails, and enrichment calls (votes, icons) are
// optional: if they fail the games are still returned without them.

const { fetchJSON } = require('./util');
const { randomUUID } = require('crypto');

async function search(terms) {
  const games = [];
  const seen = new Set();
  let anyOk = false;
  let lastError = null;

  // One omni-search page (~40 games) per term: its page token does not
  // advance the results, and extra calls only trigger rate limiting.
  for (const term of terms) {
    const url =
      'https://apis.roblox.com/search-api/omni-search?sessionId=' +
      encodeURIComponent(randomUUID()) +
      `&searchQuery=${encodeURIComponent(term || 'popular')}`;
    let data;
    try {
      data = await fetchJSON(url);
    } catch (err) {
      lastError = err; // keep what earlier terms returned
      continue;
    }
    anyOk = true;
    const fresh = (data.searchResults || [])
      .filter((g) => g.contentGroupType === 'Game')
      .flatMap((g) => g.contents || [])
      .filter((c) => c.universeId && !c.isSponsored && !seen.has(c.universeId));
    fresh.forEach((c) => seen.add(c.universeId));
    if (fresh.length) {
      const batch = await details(fresh);
      batch.forEach((g, i) => (g.sourceRank = i));
      games.push(...batch);
    }
  }
  if (!anyOk && lastError) throw lastError;
  return games;
}

async function details(contents) {
  const ids = contents.map((c) => c.universeId);
  const qs = ids.map(encodeURIComponent).join(',');
  const [info, votes, icons] = await Promise.all([
    fetchJSON(
      'https://games.roblox.com/v1/games?universeIds=' + qs
    ).catch(() => null),
    fetchJSON('https://games.roblox.com/v1/games/votes?universeIds=' + qs).catch(() => null),
    fetchJSON(
      'https://thumbnails.roblox.com/v1/games/icons?size=256x256&format=Png&isCircular=false&universeIds=' + qs
    ).catch(() => null),
  ]);
  const infoById = new Map(((info && info.data) || []).map((g) => [g.id, g]));
  const votesById = new Map(((votes && votes.data) || []).map((v) => [v.id, v]));
  const iconById = new Map(
    ((icons && icons.data) || [])
      .filter((t) => t.state === 'Completed' && t.imageUrl)
      .map((t) => [t.targetId, t.imageUrl])
  );

  return contents.map((c) => {
    const g = infoById.get(c.universeId) || {};
    const v = votesById.get(c.universeId);
    const up = v ? v.upVotes : c.totalUpVotes;
    const down = v ? v.downVotes : c.totalDownVotes;
    const total = (up || 0) + (down || 0);
    const placeId = g.rootPlaceId || c.rootPlaceId;
    const genre = g.genre_l1 || g.genre;
    return {
      title: g.name || c.name,
      developer: g.creator ? g.creator.name : c.creatorName || null,
      image: iconById.get(c.universeId) || null,
      // Like ratio (0-100%) mapped onto a 0-5 scale.
      rating: total > 0 ? Math.round((up / total) * 50) / 10 : null,
      ratingCount: total || null,
      year: g.created ? new Date(g.created).getFullYear() : null,
      genres: genre && genre !== 'All' ? [genre] : [],
      description: (g.description || c.description || '').slice(0, 600),
      players: g.maxPlayers ? (g.maxPlayers > 1 ? 'multi' : 'single') : null,
      source: 'Roblox',
      platforms: [
        {
          platform: 'roblox',
          access: 'free',
          price: 0,
          url: placeId
            ? `https://www.roblox.com/games/${placeId}/`
            : 'https://www.roblox.com/discover',
        },
      ],
      playing: typeof c.playerCount === 'number' ? c.playerCount : g.playing || null,
    };
  }).filter((g) => g.title);
}

module.exports = { search };
