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
  // Top-level groups (selecting a whole group also matches its own name).
  action: ['action'],
  'action adventure': ['action adventure', 'action', 'adventure'],
  adventure: ['adventure'],
  puzzle: ['puzzle', 'puzzles', 'brain'],
  'role playing': ['rpg', 'role playing', 'roleplay'],
  simulation: ['simulation', 'simulator', 'sim', 'tycoon'],
  strategy: ['strategy', 'tactics'],
  sports: ['sports', 'racing'],
  mmo: ['mmo', 'massively multiplayer'],
  'sandbox open world': ['sandbox', 'open world', 'building'],
};

// Groups too broad to be matched by their own name.
const UNMATCHABLE_GROUPS = new Set(['other', 'by purpose']);

// Companion apps that stores file next to games: mods, maps, skins,
// guides, wallpapers... Dropped unless the query asks for them.
const COMPANION_RE =
  /\b(mods?|addons?|add ons|skins?|maps? for|guides?|walkthroughs?|wallpapers?|cheats?|launcher|seeds for|texture packs?|servers? for|for minecraft|for roblox|for mcpe|mcpe|codes for|trackers?|save editor|editor for|library for|calculators?|wiki|companion|helper for|tips for|tips and tricks)\b/;

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'to', 'in', 'on', 'game', 'games']);

// ---------------------------------------------------------------- cache
const cache = new Map(); // key -> { ts, games, failedSources }
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > (hit.ttl || CACHE_MS)) {
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

// ------------------------------------------------------------ matching
const words = (value) => norm(value).split(' ').filter(Boolean);
const singular = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

// Whole-word phrase containment, tolerant of plural endings.
function hasPhrase(haystack, needle) {
  if (!haystack || !needle) return false;
  const h = ' ' + words(haystack).map(singular).join(' ') + ' ';
  const n = ' ' + words(needle).map(singular).join(' ') + ' ';
  return n.trim() !== '' && h.includes(n);
}

// Levenshtein distance capped at 2 (enough for typo tolerance).
function closeEnough(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length] <= 1;
}

// How strongly a game matches the selected genres (0 = no match).
function genreScore(game, selected) {
  if (!selected.length) return 0;
  // Apple writes "Roleplaying" as one word.
  const genres = (game.genres || []).join(' | ').replace(/roleplaying/gi, 'role playing');
  let best = 0;
  for (const sel of selected) {
    const name = norm(sel.name);
    const aliases = GENRE_ALIASES[name] || [];
    if (hasPhrase(genres, name)) best = Math.max(best, 3);
    else if (hasPhrase(game.title, name)) best = Math.max(best, 2.5);
    else if (aliases.some((a) => hasPhrase(genres, a))) best = Math.max(best, 1.5);
    else if (name.length >= 5 && hasPhrase(game.description, name)) best = Math.max(best, 1.2);
    else if (aliases.some((a) => a.length >= 4 && hasPhrase(game.title, a))) best = Math.max(best, 1);
  }
  return best;
}

// Relevance of a game to the keyword query (0 = no textual match at all).
function queryScore(game, q) {
  const qNorm = norm(q);
  const qWords = words(q).filter((w) => !STOPWORDS.has(w));
  if (!qWords.length) return 0;
  const title = norm(game.title);
  const titleWords = words(game.title).map(singular);

  let score = 0;
  if (title === qNorm) score += 100;
  else if (title.startsWith(qNorm + ' ') || title.startsWith(qNorm)) score += 70;
  else if (hasPhrase(title, qNorm)) score += 50;

  let hits = 0;
  for (const raw of qWords) {
    const w = singular(raw);
    if (titleWords.includes(w)) hits += 1;
    else if (w.length >= 3 && titleWords.some((t) => t.startsWith(w))) hits += 0.75;
    else if (w.length >= 5 && titleWords.some((t) => closeEnough(t, w))) hits += 0.6;
  }
  score += 45 * (hits / qWords.length);
  if (hits === qWords.length) score += 15; // every query word is in the title

  // Words missing from the title can still be found elsewhere.
  const rest = qWords.filter((w) => !titleWords.includes(singular(w)));
  if (rest.length) {
    const meta = [game.developer, ...(game.genres || [])].join(' | ');
    score += 15 * (rest.filter((w) => hasPhrase(meta, w)).length / qWords.length);
    score += 8 * (rest.filter((w) => hasPhrase(game.description, w)).length / qWords.length);
  }
  return score;
}

// Signals that do not depend on the query: the store's own ranking and
// how many people rated / play the game.
function popularityScore(game) {
  let score = 0;
  if (typeof game.sourceRank === 'number') {
    score += 12 * Math.max(0, 1 - game.sourceRank / 40);
  }
  if (game.popularity) score += Math.min(40, 6 * Math.log10(game.popularity + 1));
  // Found on several platforms/stores: a real, established title.
  score += 6 * Math.max(0, (game.platforms || []).length - 1);
  if (game.playing) score += Math.min(5, Math.log10(game.playing + 1));
  if (game.rating && game.ratingCount && game.ratingCount >= 50) score += (game.rating - 3) * 2;
  return score;
}

function isCompanionApp(game, q) {
  return COMPANION_RE.test(norm(game.title)) && !COMPANION_RE.test(norm(q || ''));
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
    const mode = game.players;
    const modeOk =
      !players || players === 'any' || !mode || mode === players ||
      (players === 'multi' && mode === 'coop');
    if (!modeOk) {
      // Player mode is only known for some sources; unknown passes,
      // a known mismatch does not.
      continue;
    }
    out.push({ ...game, platforms: entries });
  }
  return out;
}

// Written Steam reviews are far rarer than mobile star taps or Roblox
// likes; scale them so popularity is comparable across stores.
const COUNT_SCALE = { Steam: 20 };
const popCount = (game) => (game.ratingCount || 0) * (COUNT_SCALE[game.source] || 1);

const DEV_NOISE = new Set(['games', 'game', 'studio', 'studios', 'inc', 'ltd', 'llc', 'co', 'entertainment', 'interactive', 'the', 'corporation', 'limited', 'gmbh', 'software']);
const devWords = (dev) => words(dev).filter((w) => w.length >= 2 && !DEV_NOISE.has(w));

// Same title is only the same game if nothing says otherwise: different
// developers, or a Roblox experience vs a store app, mean different games.
function sameGame(a, b) {
  if ((a.source === 'Roblox') !== (b.source === 'Roblox')) return false;
  const da = devWords(a.developer);
  const db = devWords(b.developer);
  if (da.length && db.length && !da.some((w) => db.includes(w))) return false;
  return true;
}

function mergeGames(games) {
  const byTitle = new Map(); // title key -> [merged games]
  const out = [];
  for (const game of games) {
    const key = norm(String(game.title || '').replace(/[™®©]/g, ''));
    if (!key) continue;
    const bucket = byTitle.get(key) || [];
    byTitle.set(key, bucket);
    const existing = bucket.find((g) => sameGame(g, game));
    if (!existing) {
      const fresh = { ...game, platforms: [...game.platforms], popularity: popCount(game) };
      bucket.push(fresh);
      out.push(fresh);
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
    if (!existing.description && game.description) existing.description = game.description;
    if ((game.ratingCount || 0) > (existing.ratingCount || 0)) {
      existing.ratingCount = game.ratingCount;
      if (game.rating) existing.rating = game.rating; // rating from the larger sample
    }
    existing.popularity = Math.max(existing.popularity, popCount(game));
    if (typeof game.sourceRank === 'number') {
      existing.sourceRank = Math.min(existing.sourceRank ?? Infinity, game.sourceRank);
    }
    existing.genres = [...new Set([...(existing.genres || []), ...(game.genres || [])])];
  }
  return out;
}

function sortGames(games, sort) {
  const arr = [...games];
  switch (sort) {
    case 'rating':
      // Bayesian-style: a 5.0 from 3 ratings should not beat a 4.7 from 1M.
      arr.sort((a, b) => weightedRating(b) - weightedRating(a) || b._score - a._score);
      break;
    case 'newest':
      arr.sort((a, b) => (b.year || 0) - (a.year || 0) || b._score - a._score);
      break;
    case 'name':
      arr.sort((a, b) => a.title.localeCompare(b.title));
      break;
    default:
      arr.sort((a, b) => b._score - a._score);
  }
  return arr;
}

function weightedRating(game) {
  if (!game.rating) return 0;
  const n = game.ratingCount || 0;
  const prior = 3.5;
  const m = 200;
  return (game.rating * n + prior * m) / (n + m);
}

async function runSearch(filters) {
  // Pages are slices of one merged result: the cache key leaves page out,
  // so "Load more" never re-queries the stores or reshuffles results.
  const { page, ...rest } = filters;
  const key = JSON.stringify(rest);
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

  // iTunes also returns Arcade titles (tagged by App Store id), so it feeds
  // Arcade-only searches too; applyFilters then keeps the right access.
  if (want('ios') && (wantAccess('free') || wantAccess('arcade'))) {
    run('itunes', () => itunes.search(terms));
  }
  if (want('ios') && wantAccess('arcade')) run('arcade', () => arcade.search(terms));
  const storeAccess = wantAccess('free') || wantAccess('paid');
  if ((want('windows') || want('mac')) && storeAccess) run('steam', () => steam.search(terms));
  if (want('roblox') && wantAccess('free')) run('roblox', () => roblox.search(terms));
  if (want('android') && storeAccess) run('googleplay', () => googleplay.search(terms));
  if (rawg.enabled()) run('rawg', () => rawg.search(terms));
  if (igdb.enabled()) run('igdb', () => igdb.search(terms));

  const results = await Promise.all(jobs);
  const failedSources = results.filter((r) => r.failed).map((r) => r.name);

  let games = mergeGames(results.flatMap((r) => r.games));
  games = applyFilters(games, filters);

  const scored = [];
  for (const game of games) {
    if (isCompanionApp(game, filters.q)) continue;
    const g = genreScore(game, filters.genres);
    if (filters.genres.length && g === 0) {
      // Sources without genre data (Google Play, Apple Arcade) were queried
      // with the genre itself when there is no keyword, so their results
      // are on-genre by construction; with a keyword they must show it.
      const noGenreData = !(game.genres || []).length;
      if (!(noGenreData && !filters.q)) continue;
    }
    let score = popularityScore(game) + 10 * g;
    if (filters.q) {
      const qs = queryScore(game, filters.q);
      // No textual match anywhere: keep only the store's own top hits
      // (stores also match on descriptions and tags we cannot see).
      if (qs === 0 && !(game.sourceRank < 5)) continue;
      score += qs;
    }
    scored.push({ ...game, _score: score });
  }
  games = sortGames(scored, filters.sort).map(({ _score, description, sourceRank, popularity, ...g }) => g);

  // A search where a source failed (often a rate limit) is cached only
  // briefly, so a retry soon after can pick that source up again.
  const ttl = failedSources.length ? 2 * 60 * 1000 : CACHE_MS;
  const entry = { ts: Date.now(), ttl, games, failedSources };
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
        if (!UNMATCHABLE_GROUPS.has(norm(group.name))) {
          genres.push({ name: group.name, parent: group.name });
        }
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
