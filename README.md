# Yotube-Clone-By-Venkatesh live website link https://wencateisch.github.io/Youtube-Clone-By-Venkatesh/

## Backend (`server/`)

A small Node server (Node 24+, no dependencies) that can answer the app's
searches from a shared cache instead of spending quota on every device.

| Endpoint | Cost | Behaviour |
| --- | --- | --- |
| `GET /api/search?q=…&maxResults=24` | 0 on a cache hit, 100 on a miss | Cached 24 h; stale copies are served instantly while refreshing; when every key is spent it answers `200` with `degraded: true` and popular videos instead of a `403` |
| `GET /api/feed/home` | 1 | Popular videos, cached 30 min |
| `GET /api/health` | 0 | Key count and searches left today |

`search.list` costs 100 units and is capped at 100 calls per Google Cloud
project per day, so every distinct query is the expensive part; `videos.list`
costs 1 unit.

### Configuration (environment)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Listen port |
| `YOUTUBE_KEYS` | `config.json` keys | Comma-separated keys, ideally one per Google Cloud project. Keep them in the host's environment so they never ship in the APK |
| `SEARCH_DAILY_CAP` | `100` | `search.list` calls allowed per key per day |
| `SEARCH_TTL_MS` | 24 h | How long a cached search stays fresh |
| `POPULAR_TTL_MS` | 30 min | How long the popular feed stays fresh |
| `DB_PATH` | `server/data/ytclone.db` | SQLite file (cache, key usage, users) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | – | Optional Google login |
| `RAILWAY_TOKEN` / `RAILWAY_SERVICE_ID` | – | Repository secrets; without them the deploy job skips instead of failing |

Run it locally with `cd server && npm start`, then point the app at it by
setting `backendUrl` in `config.json` (empty means "call YouTube directly").
