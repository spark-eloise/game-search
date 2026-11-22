'use strict';

// IGDB — optional provider. Activates only when IGDB_CLIENT_ID and
// IGDB_CLIENT_SECRET are set in the environment (Twitch developer app).
// IGDB does not report store prices, so its platform entries carry
// access: null (shown without an access tag).
// https://api-docs.igdb.com/

const { fetchJSON } = require('./util');

function enabled() {
  return Boolean(process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET);
}

let token = { value: null, expiresAt: 0 };

async function getToken() {
  if (token.value && Date.now() < token.expiresAt) return token.value;
  const url =
    'https://id.twitch.tv/oauth2/token?grant_type=client_credentials' +
    `&client_id=${encodeURIComponent(process.env.IGDB_CLIENT_ID)}` +
    `&client_secret=${encodeURIComponent(process.env.IGDB_CLIENT_SECRET)}`;
  const data = await fetchJSON(url, { method: 'POST' });
  token = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return token.value;
}

// IGDB platform ids: 6 PC (windows), 14 Mac, 39 iOS, 34 Android.
const PLATFORM_IDS = { 6: 'windows', 14: 'mac', 39: 'ios', 34: 'android' };

async function search(terms) {
  if (!enabled()) return [];
  const accessToken = await getToken();
  const games = [];
  for (const term of terms) {
    const body =
      `search "${String(term || '').replace(/"/g, '')}"; ` +
      'fields name,first_release_date,rating,total_rating_count,' +
      'genres.name,platforms,cover.url,websites.url,websites.category; ' +
      'where platforms != null; limit 40;';
    const res = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': process.env.IGDB_CLIENT_ID,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'text/plain',
      },
      body,
    });
    if (!res.ok) throw new Error(`IGDB HTTP ${res.status}`);
    const data = await res.json();
    for (const g of data || []) {
      const platforms = [];
      for (const pid of g.platforms || []) {
        const platform = PLATFORM_IDS[pid];
        if (platform && !platforms.some((e) => e.platform === platform)) {
          platforms.push({
            platform,
            access: null,
            price: null,
            url: `https://www.igdb.com/games/${g.slug || g.id}`,
          });
        }
      }
      if (!platforms.length) continue;
      games.push({
        title: g.name,
        developer: null,
        image: g.cover ? `https:${g.cover.url.replace('t_thumb', 't_cover_big')}` : null,
        rating: g.rating ? g.rating / 20 : null,
        ratingCount: g.total_rating_count || null,
        year: g.first_release_date
          ? new Date(g.first_release_date * 1000).getFullYear()
          : null,
        genres: (g.genres || []).map((x) => x.name),
        players: null,
        source: 'IGDB',
        platforms,
      });
    }
  }
  return games;
}

module.exports = { search, enabled };
