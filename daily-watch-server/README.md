# Daily Watch account service

This folder contains the account routes, trusted identity adapter, D1 schema and migrations, replay validation, and the matching game rules. The full managed deployment source lives in the Daily Watch Sites repository. The game’s browser source is in `../public/watch/`. [Open the hosted game](https://sea-gates-watch.edcr.chatgpt.site/play/index.html)

To host the account edition, start with the Sites Vinext starter and its native ChatGPT authentication. Replace its `app/api/`, `app/chatgpt-auth.ts`, `db/` and `drizzle/` with these sources, then copy the complete `../public/watch/` into `public/play/`. Set `HOSTED_ORIGIN` and `PUBLIC_GAME_URL` in `public/play/config.mjs` to your deployment URLs. Configure the `DB` D1 binding as shown in `manifest.example.json`, apply the migrations, and deploy through Sites. The identity adapter depends on the trusted authentication headers supplied by that platform.

| Route | Purpose |
| --- | --- |
| `GET /api/daily` | Returns the current UTC challenge and reset time |
| `GET /api/player` | Returns sign-in links and the current player’s saved record |
| `POST /api/claim` | Replays and validates a completed current daily before saving its result |
| `GET /api/leaderboard` | Returns public result aliases for a selected challenge |

The server obtains the account identity from the authentication boundary and recomputes results from the submitted seed and move history. The database stores the account identifier, challenge dates, outcomes, replay and timestamps. Public results use derived aliases. Emails and real names are not stored in the game tables.

Run `npm test` from the repository root to exercise game, replay, account policy, database and route checks. The account tests supply a local SQLite database and test identity boundary. They exercise the actual route modules without needing a deployed account.

[Release verification](docs/verification.md) records the tested behavior, balance sample and remaining verification limits.
