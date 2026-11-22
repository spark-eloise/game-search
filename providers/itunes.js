'use strict';

// Apple iTunes Search API — iOS games. No key required.
// Docs: https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/
//
// Access rule (enforced here): an iOS version is only ever Free or Apple
// Arcade in this tool, never Paid — paid App Store apps are dropped.

const { fetchJSON } = require('./util');

async function search(terms) {
  const games = [];
  for (const term of terms) {
    const url =
      'https://itunes.apple.com/search?media=software&entity=software' +
      `&limit=200&country=US&term=${encodeURIComponent(term || 'game')}`;
    const data = await fetchJSON(url);
    for (const app of data.results || []) {
      if (app.kind && app.kind !== 'software') continue;
      const price = typeof app.price === 'number' ? app.price : null;
      if (price !== null && price > 0) continue; // iOS is never Paid here
      games.push({
        title: app.trackName,
        developer: app.artistName || null,
        image: app.artworkUrl512 || app.artworkUrl100 || null,
        rating: typeof app.averageUserRating === 'number' ? app.averageUserRating : null,
        ratingCount: app.userRatingCount || null,
        year: app.releaseDate ? new Date(app.releaseDate).getFullYear() : null,
        genres: [app.primaryGenreName, ...(app.genres || [])].filter(Boolean),
        players: null,
        source: 'App Store',
        platforms: [
          {
            platform: 'ios',
            access: 'free',
            price: 0,
            url: app.trackViewUrl,
          },
        ],
      });
    }
  }
  return games;
}

module.exports = { search };
