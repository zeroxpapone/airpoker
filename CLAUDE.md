# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All frontend work happens in `frontend/`:

```bash
cd frontend
npm install
npm run dev        # Vite dev server on 0.0.0.0:5173 (host exposed for phone testing over LAN/ngrok)
npm run build      # tsc -b && vite build  -> frontend/dist
npx tsc -b         # type-check only (much faster than a full build)
npm run lint       # eslint flat config (typescript-eslint + react-hooks + react-refresh)
```

`npm run dev` and `npm run build` require `frontend/.env` (gitignored) with the six
`VITE_FIREBASE_*` keys — the same names CI injects from repo secrets. Without it the app boots
into a Firebase init error.

`npx tsc -b` is the real gate and passes clean; **`npm run lint` does not** — `main` currently
carries ~134 pre-existing errors (122 of them `@typescript-eslint/no-explicit-any`, since Firestore
snapshot data is read as `any` throughout). Nothing in CI runs it. Compare against the baseline
rather than treating a non-zero exit as your own regression.

There is **no test suite and no test runner**, and `firebase.json` configures no Auth/Firestore
emulators. Changes are verified by running the dev server against the real `airpoker-84425`
project, so prefer creating a throwaway table over touching existing data.

Maintenance script (standalone, not part of the frontend build):

```bash
cd scripts && npm install
DRY_RUN=1 npm run end-stale-tables   # needs FIRESTORE_SWEEPER_KEY (inline SA JSON) or GOOGLE_APPLICATION_CREDENTIALS
```

### Deploys

Pushes to `main` build and deploy to Firebase Hosting live channel automatically
(`.github/workflows/firebase-hosting-merge.yml`); PRs get preview channels. Manual equivalents:
`npx firebase deploy --only hosting` (public dir is `frontend/dist`) and
`npx firebase deploy --only firestore:indexes`.

**Firestore security rules are not in this repo** — `firebase.json` declares only indexes. Rules live
in the Firebase console, so nothing here enforces them and any new invariant that needs rule-level
enforcement has to be applied in the console separately. In-repo, the only authorization checks are
client-side (`tableData.hostId !== user.uid` and similar in `firestoreApi.ts`).

Every mutating API in `firestoreApi.ts` now takes a `user` and compares it against `hostId` —
`startGame` and `endGame` were the last two without one, and gained the check (plus a `SUMMARY`
guard on `endGame`) alongside `startNextHand`, `advanceStage`, `kickPlayer`, `addChips`,
`confirmWinners`, `transferHost` and `swapPlayerSeats`. There is no longer an unguarded mutating
API — `swapSeats`, the last one, was deleted as a duplicate of `swapPlayerSeats`.

Because these checks are client-side, they constrain the app's own code paths, not a hand-crafted
SDK call against the same project. Anything that must actually hold has to be enforced in the
console rules.

One gap worth knowing about, since nothing in the repo covers it:

- The table `password` is stored **in cleartext on the table doc** and checked client-side in
  `joinTable`, so any client that can read `tables/{id}` can read it out of the snapshot.

## Architecture

### There is no backend

Despite what `README.md` says, there are no Cloud Functions. Dealing, betting, side-pot math,
showdown evaluation and player-stat aggregation all run **in the browser**, inside Firestore
transactions, from `frontend/src/lib/firestoreApi.ts` (~2.5k lines — the heart of the app).
Clients converge purely through `onSnapshot` listeners on shared documents.

The only server-side code is `scripts/end-stale-tables.mjs`, a GitHub Actions cron job
(every 30 min) that force-ends tables stuck `IN_GAME` with no new hand for 3h. It intentionally
**duplicates `endGame()`'s logic** in `firebase-admin` JS so recaps look identical either way —
change one, change the other.

### Firestore data model

- `tables/{tableId}` — id is a 5-char human-typeable code (`generateShortTableId`, ambiguous chars
  excluded). `state`: `LOBBY` → `IN_GAME` → `SUMMARY`. Holds `hostId`, blinds, `initialStack`,
  `mode` (`CASH`|`TOURNAMENT`) + `tournamentConfig`, `isVirtualCards`, `currentHandId`, `password`
  (cleartext, see above), `createdAt`, and two timestamps that are easy to confuse:
  `lastHandStartedAt` is bumped on **every** hand start (the sweeper's idleness signal), while
  `gameStartedAt` is written **once**, in `startGame`, and never again — `TablePage`'s whole-session
  elapsed timer reads `gameStartedAt || createdAt`, so bumping it per hand would reset that timer
  every hand. The sweeper falls back `lastHandStartedAt ?? gameStartedAt ?? createdAt`.
  On `endGame()` the recap (`playerIds[]`, `players[]`) is written **onto the table doc itself**;
  there is no separate history collection. `HomePage` reads history via
  `where("state","==","SUMMARY") + where("playerIds","array-contains",uid)` — the one composite
  index in `firestore.indexes.json`.
- `tables/{tableId}/players/{uid}` — `stack`, `seatIndex`, `isFolded`, `isSittingOut`, `isAllIn`,
  `totalBuyIn` (rebuys, for net-profit), `satAt`/`accumulatedTime` (time-played tracking), and
  `hasLeft`/`leftAt`. **Turn order is `seatIndex` ascending, and hand logic indexes players by seat
  position, not uid.** That is why `quitGame` sets `hasLeft: true` rather than deleting the doc —
  deleting mid-hand would shift every stored positional index. Host handoff picks the first
  candidate with `!hasLeft`, so anything that iterates players for a *live* role must filter on it.
  Note `leaveTable` (lobby-only in practice, wired to the "leave lobby" button) *does* delete the
  doc, and `joinTable` derives the new `seatIndex` from the player count — so a lobby departure
  followed by a join produces two players on the same seat.
- `tables/{tableId}/hands/{handId}` — the `HandData` interface: `stage`, `dealerIndex`/
  `smallBlindIndex`/`bigBlindIndex`/`currentTurnIndex`/`firstToActIndex`/`lastAggressorIndex`,
  `pot`, `currentBet`, `roundBets` (this street), `handContributions` (whole hand — the side-pot
  input), `pots[]`, `votingOpen`, `winnerIds`, plus virtual-mode `communityCards`, `playerHands`,
  `handResults`.
- `users/{uid}` — created for guests too (so every seat resolves to a profile). `username` /
  `usernameLowercase` (uniqueness enforced by a query in `useAuth.tsx`, **not** by rules),
  `isRegistered`, `photoURL`, `presence.{status,location,tableId,lastActive}` (heartbeat written by
  `HomePage`/`TablePage`), and `stats.*` counters. Subcollections: `friends`, `invitations`.

### Transaction discipline (the main footgun)

Firestore transactions cannot run queries, and every read must precede every write. So most mutating
APIs in `firestoreApi.ts` follow the same shape, and new ones should too:

1. `getDocs(query(players, orderBy("seatIndex")))` **outside** the transaction, purely to learn which
   doc refs exist. This assumes seat order can't change mid-hand. `swapPlayerSeats` — the only writer
   of `seatIndex` on an existing player — now enforces that: it is transactional and rejects a swap
   unless the current hand is over (`SHOWDOWN` with a winner assigned), mirroring the UI's
   `disableEndGame`. Reordering *between* hands is a supported feature, so the guard is "no live
   hand", not "LOBBY only".
2. Inside `runTransaction`: `transaction.get()` the table, the hand, all player docs — *and* the
   `users/{id}` docs needed for stats (`getStatsCandidateIds()` exists to compute that set before any
   write).
3. Pure in-memory computation.
4. All `transaction.update()` calls last.

Functions are commented with `===== LETTURA =====` / `===== SCRITTURA =====` markers delimiting these
phases. Adding a read after a write silently breaks the transaction at runtime.

Operations that can't fit one transaction (e.g. `startNextHand` discovering the tournament is over)
set a flag and call the follow-up (`endGame()`) after the transaction commits.

Known exceptions to the shape above — don't read them as the pattern:

- `endGame()` is **not transactional at all**: it does `getDoc`/`getDocs` and then commits a
  `writeBatch`. Its `state === "SUMMARY"` guard rejects a *sequential* re-end (the case that used to
  silently double every player's `stats.sessionsPlayed`), but it does **not** close the concurrent
  race: two clients that both read before either commits both see `IN_GAME`, both pass the guard,
  and both increment `stats.sessionsPlayed`/`stats.timePlayedSeconds`. Making that safe needs the
  read and the write in one transaction, not a stronger guard. `scripts/end-stale-tables.mjs`
  mirrors the same read-then-batch shape, so the race exists server-side too.
- `endGame()` and `confirmWinners()` call `getDocs(playersRef)` with **no `orderBy`**, so their
  `playerRefs` are *not* in seat order. Don't index them positionally.

### Hand lifecycle

`startGame` **(host-only)** / `startNextHand` create a hand doc (rotating dealer/SB/BB, heads-up special-cased:
dealer is SB and acts first preflop) → `playerAction` (`CHECK` | `CALL` | `BET` | `FOLD`; all-in is
expressed as a `BET` equal to the full stack, or a `CALL` clipped to it — there is no `ALLIN` action)
→ round closes via `lastAggressorIndex` bookkeeping → `advanceStage` **(host-only)**
(`PREFLOP`→`FLOP`→`TURN`→`RIVER`→`SHOWDOWN`; post-flop the SB, or the first active player after,
always acts first) → showdown → `startNextHand` **(host-only)**.

`HomePage` also branches on a `state === "ENDED"`, which nothing in `frontend/src` or `scripts/`
ever writes — treat it as vestigial, not a fourth state.

Pots: `calculatePotsCore()` derives cascading side pots from `handContributions`; a pot with ≤1
eligible player auto-settles. `splitPot()` rounds shares down to a multiple of 5 and hands the
remainder to a random winner, so chip totals stay integral. **It picks that winner with an internal
`Math.random()` and is called more than once per settlement** (once to credit stacks, again from
`getStatsCandidateIds`/`applyStatsUpdates`), so the rolls disagree and recorded stats can diverge
from the chips actually paid. Compute the split once and thread the result through.

### Two card modes, one engine

- **Virtual** (`isVirtualCards`): the deck is shuffled and the *entire* board (with burn cards) plus
  all hole cards are dealt up-front into the hand doc at creation. Showdown is settled automatically
  by `autoEvaluateShowdown()` + `determineWinners()` from `lib/pokerEvaluator.ts` (brute-forces all
  C(7,5) combos into comparable score arrays; ties split).
- **Physical**: the app tracks money only. At showdown `votingOpen` is set and the host resolves each
  unsettled pot with `confirmWinners(tableId, user, winnerIds, potId)`.

Both paths converge on the same pot/stat writes, so changes to settlement usually need to touch both.

### Player stats

`applyStatsUpdates()` runs inside the same transaction that finishes a hand, and handles the
per-hand counters (`handsPlayed`, `handsWon`, `totalChipsWon`/`totalChipsLost`, `netProfit`,
`bestHandRank`).

VPIP is **not** in there, despite being the stat most likely to be copied as a template. Its two
counters are incremented in `playerAction`, in the preflop branch, gated on the player's first
preflop decision — so `stats.vpipEligibleHands` counts decision points, not hands — and the ratio
itself is computed in `components/AdvancedStats.tsx`. It is divided by `vpipEligibleHands`
deliberately, **not** by `handsPlayed`/`stagePreflopCount`, because those accumulated before VPIP
tracking existed and would skew the ratio for months. Keep new ratio metrics on their own
matched-baseline denominators, and increment them where the event actually happens.

### Auth

`hooks/useAuth.tsx` is the single source of truth: anonymous guests (nickname only), email/password,
and Google, plus `linkGuestToRegistered()` which upgrades a guest **in place** (uid preserved, so an
in-progress table session survives). Several non-obvious workarounds in there are commented — the
`isRegisteringRef` mirror (the `onAuthStateChanged` subscription must not resubscribe), and tracking
`linkedProviderIds` as separate state (Firebase mutates the `User` object in place, so identity-based
re-render detection fails). Read the comments before refactoring that file.

`isRegisteredUser: false` is **ambiguous on its own** — it means both "this user has no profile" and
"the profile hasn't been read yet". `profileChecked` disambiguates, and anything that reacts to a
*missing* profile must gate on it (`Layout`'s username modal, `ProfilePage`'s redirect). The gap is
only observable on an **in-session** sign-in: `loading` goes true→false exactly once, on the first
auth resolution, so on a page reload `App` holds a spinner until the profile read finishes, while a
Google popup later in the session renders straight through the window where `onAuthStateChanged` has
set `user` but not yet resolved the Firestore read. A read *failure* deliberately leaves
`profileChecked` false, so an unanswered question never renders as "no profile".

### UI conventions

- **No Tailwind** (the README is wrong). Styling is `frontend/src/styles/index.css` (~1.9k lines) with
  CSS custom properties (`--color-primary`, `--text-muted`, …) and utility-ish classes
  (`.glass-panel`, `.poker-card-3d-*`), supplemented by inline `style` objects.
- The app is route-heavy rather than component-heavy: `routes/TablePage.tsx` (~3.7k lines) contains the
  whole in-game UI. Confirmations are custom JSX modal blocks (`foldConfirmModalUI`,
  `kickConfirmModalUI`, …) assembled at the bottom of the component — native `confirm()`/`alert()`
  were deliberately removed, so follow that pattern for new prompts.
- Almost all user-facing text goes through `react-i18next` (`locales/en.json`, `locales/it.json`; add
  keys to **both** — the current baseline is 387 vs 386 keys, `it.json` is missing
  `joinTable.gameInProgressWarning`). The documented exception is `components/ReloadPrompt.tsx`,
  which branches on `i18n.resolvedLanguage === 'it'` and inlines both translations, so its strings
  are invisible to anyone grepping the locale files.
- User-visible errors thrown from `firestoreApi.ts` should be i18n keys — `throw new
  Error("error.onlyHost")` — because `TablePage` renders them as `t(actionError)`. Older code throws
  raw Italian strings. Those pass through `t()` unchanged **only if they contain no colon**:
  `i18n.ts` doesn't set `nsSeparator: false`, so i18next reads the text before a `:` as a namespace
  and renders only what follows it, silently truncating the message. Several existing throws are
  already truncated this way. Use keys for anything new.
- Comments and internal error text are mixed Italian/English (Italian dominates the older code).
  Match the surrounding file.

### PWA

`vite-plugin-pwa` with `registerType: 'prompt'`. `components/ReloadPrompt.tsx` actively polls for a new
service worker (15 min interval, 1 min floor, "Later" snoozes 30 min) because installed sessions run
for hours with a wake lock held and would otherwise never see a deploy. `firebase.json` pairs with this:
`index.html` and `/sw.js` are `no-store`, hashed assets are immutable-cached. Don't add long-lived
cache headers to those two.

### Ignore these

`dataconnect/` and `frontend/src/dataconnect-generated/` are gitignored and unused — nothing imports
`@dataconnect/generated` despite the package.json entry. Root `dist/` is a stale gh-pages leftover;
the deployed output is `frontend/dist`.

`frontend/src/index.css` and `frontend/src/App.css` are orphans — `main.tsx` imports only
`./styles/index.css`, and the reset in `src/index.css` is duplicated inside it. Editing the
conventional-looking `src/index.css` has no effect on the app and produces no error.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
