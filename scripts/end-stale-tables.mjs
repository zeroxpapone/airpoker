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

async function endStaleTable(db, tableSnap) {
  const tableId = tableSnap.id;
  const tableData = tableSnap.data();

  const playersSnap = await db.collection("tables").doc(tableId).collection("players").get();
  const userSnaps = {};

  const playersData = await Promise.all(
    playersSnap.docs.map(async (d) => {
      const p = d.data();
      const finalStack = Number(p.stack) || 0;
      const initialStack = Number(tableData.initialStack) || 0;
      const totalBuyIn = Number(p.totalBuyIn) || initialStack;

      const userSnap = await db.collection("users").doc(p.userId).get();
      if (userSnap.exists) {
        userSnaps[p.userId] = userSnap.data();
      }

      // Table is still IN_GAME at sweep time by construction, same as the
      // `tableData.state === "IN_GAME"` check in the client endGame().
      let elapsedSeconds = 0;
      if (p.satAt) {
        elapsedSeconds = Math.floor((Date.now() - p.satAt) / 1000);
      }
      const sessionTimeSeated = (p.accumulatedTime || 0) + elapsedSeconds;

      return {
        ref: d.ref,
        userId: p.userId,
        startingStack: initialStack,
        finalStack,
        netProfit: finalStack - totalBuyIn,
        sessionTimeSeated
      };
    })
  );

  const playerIds = playersData.map((p) => p.userId);

  if (DRY_RUN) {
    console.log(`[dry-run] Would end table ${tableId} (${playerIds.length} players)`);
    return;
  }

  const batch = db.batch();

  batch.update(db.collection("tables").doc(tableId), {
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
      batch.update(db.collection("users").doc(p.userId), {
        "stats.sessionsPlayed": (currentStats.sessionsPlayed || 0) + 1,
        "stats.timePlayedSeconds": prevSeconds + (p.sessionTimeSeated || 0)
      });
    }
  }

  for (const p of playersData) {
    batch.update(p.ref, { satAt: null, accumulatedTime: 0 });
  }

  await batch.commit();
  console.log(`Ended stale table ${tableId} (${playerIds.length} players, idle since last hand)`);
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
      await endStaleTable(db, tableSnap);
      endedCount++;
    }
  }

  console.log(`Done. Ended ${endedCount} stale table(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Sweep failed:", err);
    process.exit(1);
  });
