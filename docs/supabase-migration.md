# TODO (later): migrate off Google Sheets → Supabase

**Status:** proposed, not started. Nothing in this document has been implemented.
The app currently runs on Google Apps Script + Google Sheets and works fine —
this is a performance improvement to pick up when there's time.

---

## Why

The app works, but every action feels slow. Two separate causes, and it matters
which is which:

### 1. Apps Script platform floor — the pain you feel today

Every `/exec` request pays a 302 redirect to `googleusercontent.com`, plus a V8
cold start when the script hasn't run recently. That's roughly **0.5–1.5s before
your code executes**, on every single call. Nothing you write can remove it.

### 2. Read amplification — a problem that's coming, not here yet

`readSheetAsObjects` (`apps-script/Utils.gs:43`) reads the *entire* sheet on
every call:

- Saving one 4-player game ≈ **10 sheet operations** — `getSettings` reads all of
  Settings, then `findOrCreatePlayer_` re-reads the whole Players sheet once per
  player, then 4 writes, then the append.
- `getPlayerBalance` does **4 full-sheet reads**, one of which is redundant:
  `apps-script/Balances.gs:45` re-reads Settlements that
  `apps-script/Balances.gs:22` already fetched.
- Every write serializes behind a global `LockService` lock, so simultaneous
  logging at the court queues up.

With only a handful of games in the sheet, full-sheet reads currently cost almost
nothing. **So optimizing the Apps Script would not fix what you feel now** — it
would only protect you later. The floor is the platform. That's the case for
migrating rather than tuning.

**Expected result:** ~1.5–3s → **~100–300ms** per action (Singapore region is
~30–50ms RTT from Bangkok).

---

## Constraints this decision was made under

- **Free tier only** — must stay $0/month.
- **Nobody opens the raw spreadsheet.** The Sheet was pure storage; losing
  spreadsheet UX costs nothing. This removed the original reason Sheets was chosen.
- Frontend stays on Vercel. Still no login. Users are on phones at the court, in Thailand.
- Data is tiny: tens of players, low hundreds of games per year.

---

## Options compared

> Free-tier limits change over time. **Verify current numbers before committing.**

| Option | Free tier | Browser-direct? | Sleep behaviour | Fit |
|---|---|---|---|---|
| **Supabase** (Postgres) | 500MB DB, 5GB egress | ✅ via PostgREST + anon key | ⚠️ **pauses after 7 days idle** (~30s to resume) | **Best** — relational model fits the balance math exactly |
| **Firebase Firestore** | 50k reads / 20k writes **per day** | ✅ via JS SDK | ✅ never sleeps | Strong runner-up; NoSQL aggregation needs care |
| **Neon** (Postgres) | 0.5GB, ~190 compute-hrs | ❌ needs API routes | ✅ scale-to-zero, ~500ms wake | Good, but you must write serverless routes |
| **Turso** (SQLite) | ~9GB, 1B row reads/mo | ❌ needs API routes | ✅ no pause | Very generous, but same API-route overhead |
| **Cloudflare D1** | 5GB, 5M reads/day | ❌ needs Workers | ✅ no pause | Splits you across two platforms |
| Self-host (PocketBase) | — | — | — | ❌ needs a paid VPS |

**Ruled out:** Vercel KV / Upstash Redis (wrong shape for these queries);
staying on Sheets and optimizing (doesn't clear the platform floor).

---

## Recommendation: Supabase

1. **No API routes needed.** PostgREST lets the browser query directly with an
   anon key, so the migration stays confined to one file instead of adding a
   serverless backend.
2. **The balance math becomes one SQL view.** Today's ~80 lines of Apps Script
   that read three whole sheets to compute who owes what collapses into a single
   indexed query. No per-row read billing to worry about (unlike Firestore).
3. **Singapore region** (`ap-southeast-1`) — lowest latency of the options for
   Thai users.
4. **The 7-day pause is fully solvable.** A free UptimeRobot monitor (5-min
   interval) or a daily Vercel cron pinging one REST endpoint keeps it awake.
   UptimeRobot is the more reliable of the two on Vercel Hobby.

**Pick Firestore instead if** the pause workaround feels fragile and you'd rather
never think about it — it genuinely never sleeps and needs no keep-alive. The
trade-off is that computing balances means either scanning all game docs
client-side (fine now, grows with data) or maintaining denormalized per-player
counters in transactions.

---

## What the migration involves

### The seam is already clean

All backend access goes through 11 exported functions in `src/api/appsScript.ts`.
Replacing that one module with `src/api/supabase.ts` exporting the **same
signatures** means **no component changes at all** — `CalendarView`, `GameSheet`,
`DayHistorySheet`, `PaySheet`, `SearchAndPayView`, `SettingsView` stay untouched.

### Schema

Normalizes away the awkward `player1_*`…`player4_*` slot columns, and removes the
hard 4-player cap as a side effect:

```
players       (id, nickname, department, created_at, UNIQUE(nickname, department))
games         (id, played_at, shuttles_used, price_per_shuttle, total_cost,
               cost_per_player, deleted, created_at, edited_at)
game_players  (game_id, player_id, PRIMARY KEY(game_id, player_id))
settlements   (id, player_id, amount, settled_at)
app_settings  (key, value, updated_at)
```

Keep `price_per_shuttle` and `cost_per_player` stored per game — that preserves
the existing frozen-price rule (changing the price never re-prices old games,
and editing a game's shuttle count re-uses its original price).

A `player_balances` view replaces `getOutstanding` / `computeBalance_`:
per player, `sum(cost_per_player)` over non-deleted games joined via
`game_players`, minus `sum(amount)` from settlements.

### Two Postgres functions replace Apps Script mechanics

- `settle_player(player_id)` — computes outstanding and inserts the settlement
  inside one transaction, replacing `LockService`.
- `verify_settings_password(pw)` — `SECURITY DEFINER`, returns boolean.
  ⚠️ **The settings password must not live in an anon-readable row**, or the anon
  key would expose it. Today it's protected by never being returned from
  `getSettings`; under RLS it needs this function plus a policy hiding that row.

### RLS policies

Anon gets select/insert/update on `players`, `games`, `game_players`,
`settlements` — the same wide-open posture as today, since the app has no login
by design.

### Security note (unchanged, not a regression)

The Supabase URL + anon key ship in the JS bundle, exactly as the `/exec` URL
does today. Anyone with the site link can read and write everything. That's
inherent to a no-login app calling a database directly. If that ever becomes a
concern, the fix is the same in both worlds: put the calls behind Vercel
serverless functions so credentials stay server-side.

---

## Checklist for when this gets picked up

- [ ] Verify current Supabase free-tier limits still fit
- [ ] Create project in `ap-southeast-1` (Singapore)
- [ ] Create schema + `player_balances` view
- [ ] Add `settle_player()` and `verify_settings_password()` functions
- [ ] Add RLS policies (and confirm the password row is not anon-selectable)
- [ ] Export the 4 sheet tabs → import (check how much real data exists first)
- [ ] Write `src/api/supabase.ts` with the same 11 signatures as `src/api/appsScript.ts`
- [ ] Rewrite `scripts/check-backend.mjs` against Supabase
- [ ] Swap `VITE_APPS_SCRIPT_URL` for `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` on Vercel (all 3 environments), then **Redeploy** — Vite bakes env vars at build time
- [ ] Set up UptimeRobot keep-alive ping
- [ ] Delete `apps-script/` and the old API module
- [ ] Update `README.md` setup instructions

**Effort:** roughly half a day to a day.

---

## Verification (when implemented)

- Time a game save before and after in devtools Network panel — expect
  ~1.5–3s → under 300ms.
- Run the rewritten `scripts/check-backend.mjs` so all read paths pass before
  touching the frontend.
- Walk the full flow at phone width: log a game with 1 player and with 4,
  back-date one, edit shuttle count and confirm the frozen price still applies,
  delete a game, check the ranked debtor list, settle someone and confirm the
  balance resets while history survives.
- Confirm the settings password still gates the page **and** cannot be read via
  the anon key — try selecting `app_settings` from the browser console; it must
  not return that row.
- Leave it 8+ days (or pause the project manually) and confirm the keep-alive
  prevented the cold-start stall.
