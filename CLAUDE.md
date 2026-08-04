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
  `mode` (`CASH`|`TOURNAMENT`) + `tournamentConfig`, `isVirtualCards`, `currentHandId`, and
  `lastHandStartedAt`/`gameStartedAt` (bumped only on hand start — the sweeper's idleness signal).
  On `endGame()` the recap (`playerIds[]`, `players[]`) is written **onto the table doc itself**;
  there is no separate history collection. `HomePage` reads history via
  `where("state","==","SUMMARY") + where("playerIds","array-contains",uid)` — the one composite
  index in `firestore.indexes.json`.
- `tables/{tableId}/players/{uid}` — `stack`, `seatIndex`, `isFolded`, `isSittingOut`, `isAllIn`,
  `totalBuyIn` (rebuys, for net-profit), `satAt`/`accumulatedTime` (time-played tracking).
  **Turn order is `seatIndex` ascending, and hand logic indexes players by seat position, not uid.**
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

Firestore transactions cannot run queries, and every read must precede every write. So each mutating
API in `firestoreApi.ts` follows the same shape, and new ones should too:

1. `getDocs(query(players, orderBy("seatIndex")))` **outside** the transaction, purely to learn which
   doc refs exist (seat order can't change mid-hand).
2. Inside `runTransaction`: `transaction.get()` the table, the hand, all player docs — *and* the
   `users/{id}` docs needed for stats (`getStatsCandidateIds()` exists to compute that set before any
   write).
3. Pure in-memory computation.
4. All `transaction.update()` calls last.

Functions are commented with `===== LETTURA =====` / `===== SCRITTURA =====` markers delimiting these
phases. Adding a read after a write silently breaks the transaction at runtime.

Operations that can't fit one transaction (e.g. `startNextHand` discovering the tournament is over)
set a flag and call the follow-up (`endGame()`) after the transaction commits.

### Hand lifecycle

`startGame` / `startNextHand` create a hand doc (rotating dealer/SB/BB, heads-up special-cased:
dealer is SB and acts first preflop) → `playerAction` (`CHECK` | `CALL` | `BET` | `FOLD`; all-in is
expressed as a `BET` equal to the full stack, or a `CALL` clipped to it — there is no `ALLIN` action)
→ round closes via `lastAggressorIndex` bookkeeping → `advanceStage`
(`PREFLOP`→`FLOP`→`TURN`→`RIVER`→`SHOWDOWN`; post-flop the SB, or the first active player after,
always acts first) → showdown → `startNextHand` (host-only).

Pots: `calculatePotsCore()` derives cascading side pots from `handContributions`; a pot with ≤1
eligible player auto-settles. `splitPot()` rounds shares down to a multiple of 5 and hands the
remainder to a random winner — chip totals stay integral and losslessly conserved.

### Two card modes, one engine

- **Virtual** (`isVirtualCards`): the deck is shuffled and the *entire* board (with burn cards) plus
  all hole cards are dealt up-front into the hand doc at creation. Showdown is settled automatically
  by `autoEvaluateShowdown()` + `determineWinners()` from `lib/pokerEvaluator.ts` (brute-forces all
  C(7,5) combos into comparable score arrays; ties split).
- **Physical**: the app tracks money only. At showdown `votingOpen` is set and the host resolves each
  unsettled pot with `confirmWinners(tableId, user, winnerIds, potId)`.

Both paths converge on the same pot/stat writes, so changes to settlement usually need to touch both.

### Player stats

`applyStatsUpdates()` runs inside the same transaction that finishes a hand. Note the VPIP
bookkeeping: `stats.vpipCount` is divided by `stats.vpipEligibleHands`, deliberately **not** by
`handsPlayed`/`stagePreflopCount`, because those accumulated before VPIP tracking existed and would
skew the ratio for months. Keep new ratio metrics on their own matched-baseline denominators.

### Auth

`hooks/useAuth.tsx` is the single source of truth: anonymous guests (nickname only), email/password,
and Google, plus `linkGuestToRegistered()` which upgrades a guest **in place** (uid preserved, so an
in-progress table session survives). Several non-obvious workarounds in there are commented — the
`isRegisteringRef` mirror (the `onAuthStateChanged` subscription must not resubscribe), and tracking
`linkedProviderIds` as separate state (Firebase mutates the `User` object in place, so identity-based
re-render detection fails). Read the comments before refactoring that file.

### UI conventions

- **No Tailwind** (the README is wrong). Styling is `frontend/src/styles/index.css` (~1.9k lines) with
  CSS custom properties (`--color-primary`, `--text-muted`, …) and utility-ish classes
  (`.glass-panel`, `.poker-card-3d-*`), supplemented by inline `style` objects.
- The app is route-heavy rather than component-heavy: `routes/TablePage.tsx` (~3.7k lines) contains the
  whole in-game UI. Confirmations are custom JSX modal blocks (`foldConfirmModalUI`,
  `kickConfirmModalUI`, …) assembled at the bottom of the component — native `confirm()`/`alert()`
  were deliberately removed, so follow that pattern for new prompts.
- All user-facing text goes through `react-i18next` (`locales/en.json`, `locales/it.json`; add keys to
  **both**). User-visible errors thrown from `firestoreApi.ts` should be i18n keys — `throw new
  Error("error.onlyHost")` — because `TablePage` renders them as `t(actionError)`. Older code throws
  raw Italian strings, which pass through `t()` unchanged; prefer keys for anything new.
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
