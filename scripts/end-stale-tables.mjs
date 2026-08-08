// Scheduled maintenance job (run via GitHub Actions cron — see
// .github/workflows/end-stale-tables.yml). NOT part of the frontend build.
//
// Sweeps tables stuck in IN_GAME with no hand started in a long time (host
// forgot/was unable to click "End Game") and force-transitions them to
// SUMMARY, mirroring exactly what frontend/src/lib/firestoreApi.ts's
// endGame() does client-side, so the resulting recap looks identical either
// way. Keep the two in sync if endGame()'s logic changes.
//
// Auth: expects GOOGLE_APPLICATION_CREDENTIALS to point at a service-account
// JSON key with Firestore access (roles/datastore.user is sufficient).

import { pathToFileURL } from "node:url";
import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

const STALE_THRESHOLD_MS = Number(process.env.STALE_THRESHOLD_MS || 3 * 60 * 60 * 1000); // 3h default
const DRY_RUN = process.env.DRY_RUN === "1";

function initApp() {
  const inlineKey = process.env.FIRESTORE_SWEEPER_KEY;
  if (inlineKey) {
    return initializeApp({ credential: cert(JSON.parse(inlineKey)) });
  }
  // Falls back to GOOGLE_APPLICATION_CREDENTIALS (a key file path) if set.
  return initializeApp({ credential: applicationDefault() });
}

function toMillis(value) {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return null;
}

// Transactional for the same reason the client endGame() is: the outer query
// selects IN_GAME tables, but the host can end one between that query and this
// write. Read-then-batch let both paths read the pre-end state and both increment
// stats.sessionsPlayed / stats.timePlayedSeconds. Re-reading the table inside the
// transaction makes the read guarded — a concurrent commit forces a retry, and the
// retry sees SUMMARY and skips.
//
// Returns the outcome so main() can log it without aborting the whole sweep: a
// table someone else just closed is an expected race, not a failure.
export async function endStaleTable(db, tableSnap) {
  const tableId = tableSnap.id;
  const tableRef = db.collection("tables").doc(tableId);
  let outcome;
  let playerCount = 0;

  await db.runTransaction(async (t) => {
    // Reset per attempt — the transaction body re-runs on contention, so nothing
    // in here may accumulate or log; both are done once, by the caller, after it
    // has actually committed.
    outcome = "ended";
    playerCount = 0;

    // ===== READS =====
    const freshTable = await t.get(tableRef);
    if (!freshTable.exists) {
      outcome = "vanished";
      return;
    }
    const tableData = freshTable.data();

    // The state we selected on may no longer hold.
    if (tableData.state !== "IN_GAME") {
      outcome = "already-ended";
      return;
    }

    // Unlike the Web SDK, firebase-admin can read a query inside a transaction, so
    // the player set is read under the same guard rather than fetched beforehand.
    const playersSnap = await t.get(tableRef.collection("players"));

    const userIds = [
      ...new Set(playersSnap.docs.map((d) => d.data().userId).filter(Boolean))
    ];
    const userSnaps = {};
    if (userIds.length > 0) {
      const snaps = await Promise.all(
        userIds.map((id) => t.get(db.collection("users").doc(id)))
      );
      for (const s of snaps) {
        if (s.exists) userSnaps[s.id] = s.data();
      }
    }

    // ===== COMPUTE =====
    const initialStack = Number(tableData.initialStack) || 0;

    const playersData = playersSnap.docs.map((d) => {
      const p = d.data();
      const finalStack = Number(p.stack) || 0;
      const totalBuyIn = Number(p.totalBuyIn) || initialStack;

      // Table is still IN_GAME here by the guard above, same as the client's
      // `wasInGame` check in endGame().
      let elapsedSeconds = 0;
      if (p.satAt) {
        elapsedSeconds = Math.floor((Date.now() - p.satAt) / 1000);
      }

      return {
        ref: d.ref,
        userId: p.userId,
        startingStack: initialStack,
        finalStack,
        netProfit: finalStack - totalBuyIn,
        sessionTimeSeated: (p.accumulatedTime || 0) + elapsedSeconds
      };
    });

    const playerIds = playersData.map((p) => p.userId);
    playerCount = playerIds.length;

    if (DRY_RUN) {
      outcome = "dry-run";
      return; // no writes — the transaction commits empty
    }

    // ===== WRITES =====
    t.update(tableRef, {
      state: "SUMMARY",
      endedAt: FieldValue.serverTimestamp(),
      endedByAutoSweep: true,
      playerIds,
      players: playersData.map(({ ref, ...rest }) => rest)
    });

    for (const p of playersData) {
      if (userSnaps[p.userId]) {
        const currentStats = userSnaps[p.userId].stats || {};
        const prevSeconds = currentStats.timePlayedSeconds || 0;
        t.update(db.collection("users").doc(p.userId), {
          "stats.sessionsPlayed": (currentStats.sessionsPlayed || 0) + 1,
          "stats.timePlayedSeconds": prevSeconds + (p.sessionTimeSeated || 0)
        });
      }
    }

    for (const p of playersData) {
      t.update(p.ref, { satAt: null, accumulatedTime: 0 });
    }
  });

  if (outcome === "ended") {
    console.log(`Ended stale table ${tableId} (${playerCount} players, idle since last hand)`);
  } else if (outcome === "dry-run") {
    console.log(`[dry-run] Would end table ${tableId} (${playerCount} players)`);
  } else {
    console.log(`Skipped table ${tableId}: ${outcome} before the sweep could close it`);
  }

  return outcome;
}

async function main() {
  const app = initApp();
  const db = getFirestore(app);

  const snap = await db.collection("tables").where("state", "==", "IN_GAME").get();
  console.log(`Found ${snap.size} table(s) currently IN_GAME`);

  const now = Date.now();
  let endedCount = 0;

  for (const tableSnap of snap.docs) {
    const data = tableSnap.data();
    const referenceMs =
      toMillis(data.lastHandStartedAt) ??
      toMillis(data.gameStartedAt) ??
      toMillis(data.createdAt);

    // No usable timestamp at all — leave it alone rather than guessing.
    if (referenceMs === null) continue;

    const idleMs = now - referenceMs;
    if (idleMs >= STALE_THRESHOLD_MS) {
      const outcome = await endStaleTable(db, tableSnap);
      if (outcome === "ended") endedCount++;
    }
  }

  console.log(`Done. Ended ${endedCount} stale table(s).`);
}

// Only sweep when invoked as a script. Importing this module (e.g. to exercise
// endStaleTable against a fake db — there is no Firestore emulator configured, and
// the service-account key exists only as a CI secret) must not hit the real project.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Sweep failed:", err);
      process.exit(1);
    });
}
