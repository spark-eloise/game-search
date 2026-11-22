'use strict';

// Apple iTunes Search API — iOS games. No key required.
// Docs: https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/
//
// Only apps whose genres include Games (genre id 6014) are kept, so
// companion apps, education and utilities filed under other genres drop
// out. Access rule (enforced here): an iOS version is only ever Free or
// Apple Arcade in this tool, never Paid — paid App Store apps are dropped.
// Arcade titles also come back here with price 0; they are recognised by
// their App Store id (from the Arcade catalogue) and tagged "arcade".

const { fetchJSON } = require('./util');
const { arcadeIds } = require('./arcade');

const GAMES_GENRE_ID = '6014';

async function search(terms) {
  const games = [];
  const arcade = await arcadeIds();
  for (const term of terms) {
    const url =
      'https://itunes.apple.com/search?media=software&entity=software' +
      `&limit=200&country=US&genreId=${GAMES_GENRE_ID}` +
      `&term=${encodeURIComponent(term || 'game')}`;
    const data = await fetchJSON(url);
    (data.results || []).forEach((app, rank) => {
      if (app.kind && app.kind !== 'software') return;
      const genreIds = (app.genreIds || []).map(String);
      if (!genreIds.includes(GAMES_GENRE_ID) && app.primaryGenreName !== 'Games') return;
      const price = typeof app.price === 'number' ? app.price : null;
      if (price !== null && price > 0) return; // iOS is never Paid here
      const isArcade = arcade.has(String(app.trackId));
      const genres = [...new Set([app.primaryGenreName, ...(app.genres || [])])].filter(
        (g) => g && g !== 'Games'
      );
      games.push({
        title: app.trackName,
        developer: app.artistName || null,
        image: app.artworkUrl512 || app.artworkUrl100 || null,
        rating: typeof app.averageUserRating === 'number'
          ? Math.round(app.averageUserRating * 10) / 10
          : null,
        ratingCount: app.userRatingCount || null,
        year: app.releaseDate ? new Date(app.releaseDate).getFullYear() : null,
        genres,
        description: (app.description || '').slice(0, 600),
        players: null,
        source: isArcade ? 'Apple Arcade' : 'App Store',
        sourceRank: rank,
        platforms: [
          {
            platform: 'ios',
            access: isArcade ? 'arcade' : 'free',
            price: isArcade ? null : 0,
            url: app.trackViewUrl,
          },
        ],
      });
    });
  }
  return games;
}

module.exports = { search };
