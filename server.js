'use strict';

// Game Search — standalone server. Plain Node, no dependencies.
// Run: node server.js   (PORT env, default 4173)
//
// Every search is live: providers are queried at request time and the
// merged result is kept only in a short-lived in-memory cache (2 h).
// Nothing is stored as a catalogue.

const http = require('http');
const fs = require('fs');
const path = require('path');

const itunes = require('./providers/itunes');
const steam = require('./providers/steam');
const roblox = require('./providers/roblox');
const googleplay = require('./providers/googleplay');
const arcade = require('./providers/arcade');
const rawg = require('./providers/rawg');
const igdb = require('./providers/igdb');
const { norm } = require('./providers/util');

const PORT = Number(process.env.PORT || 4173);
const PAGE_SIZE = 50;
const CACHE_MS = 2 * 60 * 60 * 1000;

const taxonomy = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'taxonomy.json'), 'utf8')
);

// Aliases so store genre vocabularies match the taxonomy names.
const GENRE_ALIASES = {
  'logic puzzle': ['puzzle', 'logic'],
  'physics puzzle': ['puzzle', 'physics'],
  'tile matching': ['puzzle', 'match 3', 'tile matching'],
  'match three': ['match 3', 'puzzle', 'tile matching'],
  'hidden object': ['hidden object', 'puzzle', 'adventure'],
  'puzzle platformer': ['puzzle', 'platformer'],
  'first person shooter': ['fps', 'shooter', 'first person'],
  'third person shooter': ['shooter', 'third person'],
  'hero shooter': ['shooter', 'hero shooter'],
  'shoot em up': ['shooter', 'shmup'],
  'beat em up': ['brawler', 'beat em up', 'action'],
  'hack and slash': ['hack and slash', 'action'],
  'action rpg': ['action', 'rpg', 'role playing'],
  crpg: ['rpg', 'role playing', 'computer rpg'],
  jrpg: ['rpg', 'role playing', 'japanese rpg'],
  mmorpg: ['mmo', 'rpg', 'role playing', 'massively multiplayer'],
  'tactical rpg': ['rpg', 'tactics', 'strategy'],
  'turn based rpg': ['rpg', 'turn based'],
  'sandbox rpg': ['rpg', 'sandbox', 'open world'],
  'monster taming': ['monster tamer', 'creature collector', 'rpg'],
  'construction and management': ['management', 'simulation', 'building'],
  'city building': ['city builder', 'simulation', 'building'],
  'business simulation': ['business', 'tycoon', 'simulation'],
  'life simulation': ['life sim', 'simulation'],
  'god game': ['god game', 'simulation'],
  'pet raising': ['pet', 'virtual pet', 'simulation'],
  'social simulation': ['social', 'simulation', 'life sim'],
  'dating sim': ['dating', 'romance', 'visual novel'],
  'vehicle simulation': ['vehicle', 'simulation', 'driving'],
  'flight simulation': ['flight', 'simulation', 'flying'],
  'space flight simulation': ['space', 'simulation'],
  'train simulation': ['train', 'simulation'],
  'racing simulation': ['racing', 'simulation', 'driving'],
  'vehicular combat': ['vehicular combat', 'car combat', 'racing'],
  '4x': ['4x', 'strategy'],
  'auto battler': ['auto battler', 'auto chess', 'strategy'],
  moba: ['moba', 'multiplayer online battle arena', 'strategy'],
  'real time strategy': ['rts', 'strategy', 'real time'],
  'real time tactics': ['rtt', 'tactics', 'strategy'],
  'tower defense': ['tower defense', 'strategy'],
  'turn based strategy': ['tbs', 'strategy', 'turn based'],
  'turn based tactics': ['tactics', 'strategy', 'turn based'],
  wargame: ['war', 'strategy', 'wargame'],
  'grand strategy': ['grand strategy', 'strategy'],
  'team sports': ['sports', 'soccer', 'football', 'basketball', 'hockey'],
  'individual sports': ['sports', 'golf', 'tennis', 'boxing'],
  'sports management': ['sports', 'management', 'manager'],
  'kart racing': ['kart', 'racing'],
  'arcade racing': ['arcade', 'racing'],
  'sim racing': ['racing', 'simulation'],
  mmofps: ['mmo', 'fps', 'shooter'],
  mmorts: ['mmo', 'rts', 'strategy'],
  mmotbs: ['mmo', 'strategy', 'turn based'],
  'board game': ['board', 'board game'],
  'card game': ['card', 'card game'],
  'digital collectible card game': ['collectible card', 'card', 'tcg', 'ccg'],
  horror: ['horror'],
  idle: ['idle', 'clicker', 'incremental'],
  party: ['party', 'multiplayer'],
  photography: ['photography', 'photo'],
  'social deduction': ['social deduction', 'deduction'],
  trivia: ['trivia', 'quiz'],
  typing: ['typing'],
  educational: ['educational', 'education', 'learning'],
  esports: ['esports', 'competitive'],
  exergame: ['fitness', 'exercise', 'exergame'],
  'serious game': ['serious'],
  casual: ['casual'],
  sandbox: ['sandbox'],
  creative: ['creative', 'sandbox', 'building'],
  'open world': ['open world'],
  platform: ['platformer', 'platform'],
  stealth: ['stealth'],
  survival: ['survival'],
  rhythm: ['rhythm', 'music'],
  'battle royale': ['battle royale'],
  'survival horror': ['survival horror', 'horror'],
  metroidvania: ['metroidvania'],
  'text adventure': ['text adventure', 'interactive fiction'],
  'graphic adventure': ['adventure', 'point and click'],
  'point and click': ['point and click', 'adventure'],
  'visual novel': ['visual novel'],
  'interactive movie': ['interactive movie', 'fmv'],
  'walking simulator': ['walking simulator', 'adventure', 'exploration'],
};

// ---------------------------------------------------------------- cache
const cache = new Map(); // key -> { ts, games, failedSources }
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_MS) {
    cache.delete(key);
    return null;
  }
  return hit;
}

// ---------------------------------------------------------------- search
function buildTerms({ q, genreNames }) {
  if (q) return [q];
  if (genreNames && genreNames.length) {
    return [...new Set(genreNames)].slice(0, 3);
  }
  return [''];
}

function genreMatches(game, selected) {
  if (!selected.length) return true;
  const gameGenres = (game.genres || []).map(norm);
  const haystack = [norm(game.title), ...gameGenres];
  return selected.some((sel) => {
    const name = norm(sel.name);
    const needles = [name, ...(GENRE_ALIASES[name] || [])];
    return needles.some((needle) =>
      haystack.some((h) => h && (h.includes(needle) || needle.includes(h)))
    );
  });
}

function keywordMatches(game, q) {
  const stems = norm(q)
    .split(' ')
    .filter((t) => t.length >= 3)
    .map((t) => (t.endsWith('s') ? t.slice(0, -1) : t));
  if (!stems.length) return true;
  const words = norm(game.title).split(' ');
  return stems.some((stem) =>
    words.some((w) => w.length >= 3 && (w.startsWith(stem) || stem.startsWith(w)))
  );
}

function applyFilters(games, { platforms, access, players }) {
  const out = [];
  for (const game of games) {
    let entries = game.platforms;
    if (platforms.length) {
      entries = entries.filter((e) => platforms.includes(e.platform));
    }
    if (access.length) {
      entries = entries.filter(
        (e) => e.access === null || access.includes(e.access)
      );
    }
    if (!entries.length) continue;
    if (players && players !== 'any' && game.players && game.players !== players) {
      // Player mode is only known for some sources; unknown passes,
      // a known mismatch does not.
      continue;
    }
    out.push({ ...game, platforms: entries });
  }
  return out;
}

function mergeGames(games) {
  const byTitle = new Map();
  for (const game of games) {
      const key = norm(game.title);
      if (!key) continue;
      const existing = byTitle.get(key);
      if (!existing) {
        byTitle.set(key, { ...game, platforms: [...game.platforms] });
        continue;
      }
      for (const entry of game.platforms) {
        if (!existing.platforms.some((e) => e.platform === entry.platform)) {
          existing.platforms.push(entry);
        }
      }
      if (!existing.image && game.image) existing.image = game.image;
      if (!existing.developer && game.developer) existing.developer = game.developer;
      if (!existing.rating && game.rating) existing.rating = game.rating;
      if (!existing.year && game.year) existing.year = game.year;
      if (!existing.players && game.players) existing.players = game.players;
      const genres = new Set([...(existing.genres || []), ...(game.genres || [])]);
      existing.genres = [...genres];
  }
  return [...byTitle.values()];
}

function sortGames(games, sort) {
  const arr = [...games];
  switch (sort) {
    case 'rating':
      arr.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      break;
    case 'newest':
      arr.sort((a, b) => (b.year || 0) - (a.year || 0));
      break;
    case 'name':
      arr.sort((a, b) => a.title.localeCompare(b.title));
      break;
    default:
      break; // relevance = merge order
  }
  return arr;
}

async function runSearch(filters) {
  const key = JSON.stringify(filters);
  const hit = cacheGet(key);
  if (hit) return hit;

  const terms = buildTerms(filters);
  const want = (p) => !filters.platforms.length || filters.platforms.includes(p);
  const wantAccess = (a) => !filters.access.length || filters.access.includes(a);

  const jobs = [];
  const run = (name, fn) =>
    jobs.push(
      fn()
        .then((games) => ({ name, games }))
        .catch(() => ({ name, games: [], failed: true }))
    );

  if (want('ios') && wantAccess('free')) run('itunes', () => itunes.search(terms));
  if (want('ios') && wantAccess('arcade')) run('arcade', () => arcade.search(terms));
  if (want('windows') || want('mac')) run('steam', () => steam.search(terms));
  if (want('roblox')) run('roblox', () => roblox.search(terms));
  if (want('android')) run('googleplay', () => googleplay.search(terms));
  if (rawg.enabled()) run('rawg', () => rawg.search(terms));
  if (igdb.enabled()) run('igdb', () => igdb.search(terms));

  const results = await Promise.all(jobs);
  const failedSources = results.filter((r) => r.failed).map((r) => r.name);

  // Interleave sources round-robin so no single source fills page 1 alone.
  const lists = results.map((r) => r.games);
  const interleaved = [];
  const maxLen = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < maxLen; i++) {
    for (const list of lists) {
      if (list[i]) interleaved.push(list[i]);
    }
  }

  let games = mergeGames(interleaved);
  games = games.filter((g) => genreMatches(g, filters.genres));
  if (filters.q) games = games.filter((g) => keywordMatches(g, filters.q));
  games = applyFilters(games, filters);
  games = sortGames(games, filters.sort);

  const entry = { ts: Date.now(), games, failedSources };
  cache.set(key, entry);
  return entry;
}

// ---------------------------------------------------------------- http
function parseFilters(searchParams) {
  const csv = (name) =>
    (searchParams.get(name) || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const genreNames = csv('genres');
  const genres = [];
  for (const name of genreNames) {
    for (const group of taxonomy.genres) {
      if (group.name === name) {
        genres.push(...group.subgenres.map((s) => ({ name: s, parent: group.name })));
      } else if (group.subgenres.includes(name)) {
        genres.push({ name, parent: group.name });
      }
    }
  }
  return {
    q: (searchParams.get('q') || '').trim(),
    genreNames,
    platforms: csv('platforms').map((p) => p.toLowerCase()),
    access: csv('access').map((a) => a.toLowerCase()),
    genres,
    players: (searchParams.get('players') || 'any').toLowerCase(),
    sort: (searchParams.get('sort') || 'relevance').toLowerCase(),
    page: Math.max(0, Number(searchParams.get('page') || 0) || 0),
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/search') {
    try {
      const filters = parseFilters(url.searchParams);
      const { games, failedSources } = await runSearch(filters);
      const start = filters.page * PAGE_SIZE;
      const slice = games.slice(start, start + PAGE_SIZE);
      sendJSON(res, {
        results: slice,
        loaded: Math.min(games.length, start + slice.length),
        total: games.length,
        hasMore: games.length > start + slice.length,
        page: filters.page,
        pageSize: PAGE_SIZE,
        failedSources,
      });
    } catch (err) {
      sendJSON(res, { error: String(err && err.message || err) }, 500);
    }
    return;
  }

  if (url.pathname === '/taxonomy.json') {
    return sendFile(res, path.join(__dirname, 'taxonomy.json'));
  }

  const filePath = path.join(
    __dirname,
    'public',
    url.pathname === '/' ? 'index.html' : url.pathname
  );
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  sendFile(res, filePath);
});

function sendJSON(res, obj, status = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
    });
    res.end(data);
  });
}

server.listen(PORT, () => {
  console.log(`Game Search listening on http://localhost:${PORT}`);
  console.log(
    `Providers: iTunes, Steam, Roblox, Google Play, Apple Arcade` +
      (rawg.enabled() ? ', RAWG' : '') +
      (igdb.enabled() ? ', IGDB' : '')
  );
});
