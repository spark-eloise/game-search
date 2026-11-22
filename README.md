# Game Search

A game search tool covering iOS, Android, Mac, Windows and Roblox. Pick a
platform, an access type (Free / Paid / Apple Arcade), genres and subgenres,
a player mode, a keyword and a sort order — results are queried live from the
stores and catalogues at search time. Nothing is stored as a catalogue; the
only data file in the project is the genre taxonomy.

The genre list (11 top genres, 110+ subgenres) comes from Wikipedia's
[List of video game genres](https://en.wikipedia.org/wiki/List_of_video_game_genres)
and lives in `taxonomy.json`. Roblox uses its own genre list, kept as a
separate section in the same file.

## Run

Requires Node 18 or newer. No dependencies to install.

```sh
node server.js
```

Then open http://localhost:4173 (set `PORT` to change the port).

## Sources

Every search queries these sources live, merges and dedupes the results,
ranks them, and pages them 50 at a time (Load more). Merged results are
kept in a short-lived in-memory cache (2 hours) per filter combination;
"Load more" pages through that cached result instead of re-querying. A
search where a source failed is only cached for 2 minutes.

| Source | Platforms | Access |
| --- | --- | --- |
| Apple iTunes Search API (Games genre only) | iOS | Free (price 0), or Apple Arcade when the id is in the Arcade catalogue |
| Apple Arcade page (fetched at query time) | iOS | Apple Arcade |
| Steam store search (Games category only: no DLC or soundtracks) + app details for the top hits | Windows, Mac | Free / Paid (live price) |
| Roblox omni-search + games, votes and icons APIs | Roblox | Free |
| Google Play search page (fetched at query time) | Android | Free / Paid (page price) |
| RAWG (optional, needs key) | iOS, Android, Mac, Windows | — |
| IGDB (optional, needs keys) | iOS, Android, Mac, Windows | — |

Google Play and Apple Arcade have no public search API, so their own store
pages are fetched and parsed server-side per search. If a fetch fails, that
source contributes no results for that search; results are never fabricated.

Access rules are enforced on the server: an iOS version is only ever Free or
Apple Arcade, never Paid; Roblox is always Free; Paid applies only to
Android, Mac and Windows. Access is shown per platform on each result.

## Ranking

With a keyword, each result gets a relevance score:

- title match: exact title, title starting with the query, query as a
  phrase, then each query word found in the title (prefix and one-typo
  matches count for less);
- developer, genre and store description matches add a little;
- the store's own rank, rating count, live player count (Roblox) and being
  found on several platforms add a popularity signal.

Results with no textual match at all are dropped, except a store's own
top few hits (stores also match on data we can't see). Companion apps
(mods, maps, skins, guides, trackers, save editors…) are dropped unless the
query asks for them. "Top rated" uses a weighted rating, so a 5.0 from a
handful of ratings does not beat a 4.7 from a million.

Genre filters match whole words against each store's genres (and the title
or description), so "Action" no longer matches every "Action RPG" filter
and vice versa. Sources without genre data (Google Play, Apple Arcade) are
searched with the genre name itself when there is no keyword.

## Optional providers

RAWG and IGDB activate only when their keys are present in the environment.
Keys are read from environment variables only and are never committed.

```sh
RAWG_API_KEY=... node server.js

IGDB_CLIENT_ID=... IGDB_CLIENT_SECRET=... node server.js
```

- RAWG: free key at https://rawg.io/apidocs
- IGDB: Twitch developer app at https://dev.twitch.tv/console

## Architecture

- `server.js` — zero-dependency HTTP server. Serves the page and
  `GET /api/search?q=&platforms=&access=&genres=&players=&sort=&page=`,
  runs the providers in parallel, merges, filters, sorts, paginates, caches.
- `providers/` — one module per source (`itunes.js`, `steam.js`,
  `roblox.js`, `googleplay.js`, `arcade.js`, `rawg.js`, `igdb.js`), plus
  shared fetch/matching helpers in `util.js`.
- `public/index.html` — the single-page interface (IBM Carbon styling:
  IBM Plex Sans/Mono, `#0f62fe` accent, square corners, pill tags).
- `taxonomy.json` — the genre/subgenre data.
