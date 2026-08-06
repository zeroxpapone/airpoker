import {
  collection,
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  updateDoc,
  writeBatch,
  runTransaction,
  where,
  increment
} from "firebase/firestore";
import type { Transaction } from "firebase/firestore";
import { deleteUser } from "firebase/auth";
import type { User } from "firebase/auth";
import { db } from "./firebase";
import { determineWinners } from "./pokerEvaluator";


export interface BlindLevel {
  sb: number;
  bb: number;
  durationMins: number;
}

export interface TournamentConfig {
  startingStack: number;
  estimatedPlayers: number;
  targetDurationHours: number;
  levelDurationMins: number;
  blindSchedule: BlindLevel[];
  allowRebuys?: boolean;
}

export interface CreateTableInput {
  name: string;
  password?: string;
  initialStack: number;
  smallBlind: number;
  bigBlind: number;
  mode?: 'CASH' | 'TOURNAMENT';
  tournamentConfig?: TournamentConfig;
  isVirtualCards?: boolean;
}

export interface HandData {
  handNumber: number;
  stage: "PREFLOP" | "FLOP" | "TURN" | "RIVER" | "SHOWDOWN";
  dealerIndex: number;
  smallBlindIndex: number;
  bigBlindIndex: number;
  currentTurnIndex: number;
  pot: number;
  currentBet: number;
  roundBets: Record<string, number>;
  handContributions?: Record<string, number>;
  pots?: Pot[];
  firstToActIndex: number;
  lastAggressorIndex?: number;
  votingOpen?: boolean;
  winnerId?: string | null;
  winnerIds?: string[];
  confirmedAt?: any;
  isVirtualCards?: boolean;
  communityCards?: string[];
  playerHands?: Record<string, string[]>;
  handResults?: Record<string, { rank: number; rankName: string; bestCards: string[] }>;
}

export interface Pot {
  id: string;
  amount: number;
  eligible: string[];
  settled: boolean;
  winners?: string[];
}

/**
 * Divide `amount` tra `numWinners` vincitori arrotondando al multiplo di 5 inferiore.
 * Il resto (sempre multiplo di 5) viene assegnato a un vincitore casuale.
 * Restituisce un array di importi della stessa lunghezza di `numWinners`.
 */
function splitPot(amount: number, numWinners: number): number[] {
  if (numWinners <= 0) return [];
  if (numWinners === 1) return [amount];
  const base = Math.floor(amount / numWinners / 5) * 5;
  const remainder = amount - base * numWinners;
  const shares = Array(numWinners).fill(base);
  if (remainder > 0) {
    const luckyIdx = Math.floor(Math.random() * numWinners);
    shares[luckyIdx] += remainder;
  }
  return shares;
}

/**
 * Calcola quante chips ha vinto ciascun giocatore in base ai pot settlati.
 */
function computeChipsWonMap(pots: Pot[]): Record<string, number> {
  const chipsWonMap: Record<string, number> = {};
  pots.forEach(pot => {
    if (pot.settled && pot.winners && pot.winners.length > 0) {
      const shares = splitPot(pot.amount, pot.winners.length);
      pot.winners.forEach((wId, idx) => {
        chipsWonMap[wId] = (chipsWonMap[wId] || 0) + shares[idx];
      });
    }
  });
  return chipsWonMap;
}

/**
 * Determina quali utenti hanno bisogno di un aggiornamento statistiche per questa mano
 * (usato per sapere quali documenti /users/{id} leggere PRIMA di iniziare a scrivere
 * nella transazione — Firestore richiede che tutte le letture avvengano prima di ogni scrittura).
 */
function getStatsCandidateIds(
  hand: Pick<HandData, "handContributions" | "pots">,
  players: { id: string }[]
): string[] {
  const contributions = hand.handContributions || {};
  const chipsWonMap = computeChipsWonMap(hand.pots || []);
  return players
    .filter(p => (contributions[p.id] || 0) !== 0 || (chipsWonMap[p.id] || 0) !== 0)
    .map(p => p.id);
}

/**
 * Aggiorna le statistiche dei giocatori registrati al termine di una mano.
 * `userSnaps` deve contenere le snapshot (già lette nella fase di lettura della transazione)
 * per tutti gli id restituiti da getStatsCandidateIds.
 */
function applyStatsUpdates(
  transaction: Transaction,
  hand: HandData,
  players: { id: string; isFolded: boolean }[],
  userSnaps: Map<string, any>
) {
  const contributions = hand.handContributions || {};
  const chipsWonMap = computeChipsWonMap(hand.pots || []);

  for (const player of players) {
    const userId = player.id;
    const contribution = contributions[userId] || 0;
    const chipsWon = chipsWonMap[userId] || 0;

    // Se non ha partecipato e non ha vinto/perso nulla, non aggiorniamo le sue stats
    if (contribution === 0 && chipsWon === 0) {
      continue;
    }

    const userSnap = userSnaps.get(userId);
    if (!userSnap || !userSnap.exists()) continue;

    const userData = userSnap.data();
    const currentStats = userData.stats || {};
    const netProfit = chipsWon - contribution;
    const wonHand = chipsWon > 0;

    let bestHandRank = currentStats.bestHandRank;
    let bestHandName = currentStats.bestHandName || "";

    if (bestHandRank === undefined || bestHandRank === null || bestHandRank === 999999 || bestHandRank === -1) {
      const RANK_NAMES = [
        'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
        'Flush', 'Full House', 'Four of a Kind', 'Straight Flush', 'Royal Flush'
      ];
      const inferredIdx = RANK_NAMES.indexOf(bestHandName);
      bestHandRank = inferredIdx !== -1 ? inferredIdx : -1;
    }

    if (!player.isFolded && hand.isVirtualCards && hand.handResults && hand.handResults[userId]) {
      const myResult = hand.handResults[userId];
      if (bestHandRank === -1 || myResult.rank > bestHandRank) {
        bestHandRank = myResult.rank;
        bestHandName = myResult.rankName;
      }
    }

    transaction.update(userSnap.ref, {
      "stats.handsPlayed": increment(1),
      "stats.handsWon": increment(wonHand ? 1 : 0),
      "stats.totalChipsWon": increment(chipsWon),
      "stats.totalChipsLost": increment(contribution),
      "stats.netProfit": increment(netProfit),
      "stats.bestHandRank": bestHandRank,
      "stats.bestHandName": bestHandName
    });
  }
}

/**
 * Auto-evaluates the showdown for virtual card hands.
 * Determines winners for each pot using poker hand evaluation and
 * mutates each player's in-memory `stack` with their winnings (no DB writes —
 * the caller flushes all player stacks to Firestore in a single pass at the end).
 *
 * @returns handUpdate fields to merge into the hand document
 */
function autoEvaluateShowdown(
  pots: Pot[],
  playerHands: Record<string, string[]>,
  communityCards: string[],
  players: { id: string; ref: any; stack: number; isFolded: boolean }[]
): Record<string, any> {
  // Evaluate all non-folded players' hands
  const activePlayers = players.filter(p => !p.isFolded);
  const activeHands: Record<string, string[]> = {};
  for (const p of activePlayers) {
    if (playerHands[p.id] && playerHands[p.id].length >= 2) {
      activeHands[p.id] = playerHands[p.id];
    }
  }

  // Evaluate to get all results (for display purposes)
  const { results: allResults } = determineWinners(activeHands, communityCards);

  // Convert HandResult to storable format
  const handResults: Record<string, { rank: number; rankName: string; bestCards: string[] }> = {};
  for (const [pid, result] of Object.entries(allResults)) {
    handResults[pid] = {
      rank: result.rank,
      rankName: result.rankName,
      bestCards: result.bestCards
    };
  }

  // Settle each pot
  const globalWinners = new Set<string>();
  const playerChipsWon: Record<string, number> = {};

  for (const pot of pots) {
    if (pot.settled) {
      // Already settled (e.g. single eligible player / uncalled bet)
      // Still need to credit chips for these!
      if (pot.winners && pot.winners.length > 0) {
        pot.winners.forEach(w => globalWinners.add(w));
        const shares = splitPot(pot.amount, pot.winners.length);
        pot.winners.forEach((wId, i) => {
          playerChipsWon[wId] = (playerChipsWon[wId] || 0) + shares[i];
          const w = players.find(p => p.id === wId);
          if (w) {
            w.stack += shares[i];
          }
        });
      }
      continue;
    }

    // Find eligible active hands for this pot
    const eligibleIds = pot.eligible.filter(id => activeHands[id]);
    
    if (eligibleIds.length === 0) {
      continue;
    }

    if (eligibleIds.length === 1) {
      const winnerId = eligibleIds[0];
      pot.winners = [winnerId];
      pot.settled = true;
      globalWinners.add(winnerId);
      playerChipsWon[winnerId] = (playerChipsWon[winnerId] || 0) + pot.amount;

      const w = players.find(p => p.id === winnerId);
      if (w) {
        w.stack += pot.amount;
      }
      continue;
    }

    // Evaluate winners among eligible players for this pot
    const { winners: potWinners } = determineWinners(activeHands, communityCards, eligibleIds);
    
    if (potWinners.length === 0) continue;

    pot.winners = potWinners;
    pot.settled = true;
    potWinners.forEach(w => globalWinners.add(w));

    // Distribute chips
    const shares = splitPot(pot.amount, potWinners.length);
    potWinners.forEach((wId, i) => {
      playerChipsWon[wId] = (playerChipsWon[wId] || 0) + shares[i];
      const w = players.find(p => p.id === wId);
      if (w) {
        w.stack += shares[i];
      }
    });
  }

  // Add chipsWon to each player's handResult
  for (const pid of Object.keys(handResults)) {
    (handResults[pid] as any).chipsWon = playerChipsWon[pid] || 0;
  }

  const winnerIds = Array.from(globalWinners);

  return {
    pots,
    handResults,
    votingOpen: false,
    confirmedAt: serverTimestamp(),
    winnerIds,
    winnerId: winnerIds.length === 1 ? winnerIds[0] : null
  };
}

/**
 * Crea un nuovo tavolo e aggiunge l'utente come primo giocatore (seatIndex 0).
 */
function generateShortTableId() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let id = "";
  for (let i = 0; i < 5; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// genera un ID univoco controllando che il doc non esista
async function generateUniqueTableId(): Promise<string> {
  const tablesCol = collection(db, "tables");

  while (true) {
    const candidate = generateShortTableId();
    const candidateRef = doc(tablesCol, candidate);
    const snap = await getDoc(candidateRef);
    if (!snap.exists()) {
      return candidate;
    }
    // se esiste già, riprova
  }
}

export async function createTable(data: CreateTableInput, user: User | null) {
  if (!user) {
    throw new Error("User non presente durante la creazione del tavolo");
  }

  const uid = user.uid;

  const tablesCol = collection(db, "tables");

  const tableId = await generateUniqueTableId();
  const tableRef = doc(tablesCol, tableId);

  await setDoc(tableRef, {
    name: data.name,
    initialStack: data.initialStack,
    smallBlind: data.smallBlind,
    bigBlind: data.bigBlind,
    hostId: uid,
    state: "LOBBY",
    password: data.password || null,
    createdAt: serverTimestamp(),
    mode: data.mode || "CASH",
    tournamentConfig: data.tournamentConfig || null,
    isVirtualCards: !!data.isVirtualCards,
    endedAt: null,
    currentHandId: null,
    currentLevelIndex: data.mode === "TOURNAMENT" ? 0 : null,
    levelStartedAt: null,
  });

  // Aggiunge subito l'host come giocatore seduto al tavolo (seatIndex 0)
  await setDoc(doc(db, "tables", tableId, "players", user.uid), {
    userId: user.uid,
    stack: data.initialStack,
    seatIndex: 0,
    isSittingOut: false,
    joinedAt: serverTimestamp()
  });

  return tableId;
}

function createDeck(): string[] {
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const suits = ['h', 'd', 's', 'c'];
  const deck: string[] = [];
  for (const s of suits) {
    for (const r of ranks) {
      deck.push(r + s);
    }
  }
  return deck;
}

function shuffleDeck(deck: string[]): string[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Entra in un tavolo esistente aggiungendo il giocatore se non è già seduto.
 */
export async function joinTable(tableId: string, user: User | null, password?: string) {
  if (!user) throw new Error("User non presente durante il join del tavolo");

  const tableRef = doc(db, "tables", tableId);
  const snap = await getDoc(tableRef);

  if (!snap.exists()) {
    throw new Error("Il tavolo non esiste");
  }

  const data = snap.data() as any;

  if (data.state !== "LOBBY" && data.state !== "IN_GAME") {
    throw new Error("Non è possibile unirsi a questo tavolo: la partita è già terminata.");
  }

  if (data.password) {
    if (!password || password !== data.password) {
      throw new Error("Password del tavolo non corretta.");
    }
  }
  const initialStack = data.initialStack;

  const playerRef = doc(db, "tables", tableId, "players", user.uid);
  const playerSnap = await getDoc(playerRef);

  if (playerSnap.exists()) {
    // Già seduto, niente da fare
    return;
  }

  // Calcola prossimo seatIndex
  const playersRef = collection(db, "tables", tableId, "players");
  const q = query(playersRef, orderBy("seatIndex", "asc"));
  const playersSnap = await getDocs(q);
  const seatIndex = playersSnap.size;

  await setDoc(playerRef, {
    userId: user.uid,
    stack: initialStack,
    totalBuyIn: initialStack,
    seatIndex,
    isReady: false,
    isFolded: false,
    isSittingOut: data.state === "IN_GAME",
    joinedAt: serverTimestamp()
  });
}

function getNextActivePlayerIndex(players: any[], fromIndex: number): number {
  const numPlayers = players.length;
  for (let i = 1; i <= numPlayers; i++) {
      const idx = (fromIndex + i) % numPlayers;
      const p = players[idx];
      if (!p.isSittingOut && p.stack > 0) return idx;
  }
  return -1;
}

/**
 * Imposta lo stato "pronto / non pronto" per il player corrente.
 */
export async function setPlayerReady(
  tableId: string,
  user: User | null,
  isReady: boolean
) {
  if (!user) throw new Error("User non presente per setPlayerReady");

  const playerRef = doc(db, "tables", tableId, "players", user.uid);
  await updateDoc(playerRef, { isReady });
}

export async function leaveTable(tableId: string, user: User) {
  const tableRef = doc(db, "tables", tableId);
  const tableSnap = await getDoc(tableRef);

  const playersRef = collection(db, "tables", tableId, "players");
  const q = query(playersRef, where("userId", "==", user.uid));
  const snap = await getDocs(q);

  const batch = writeBatch(db);
  let totalTimeToAdd = 0;

  snap.forEach((docSnap) => {
    const p = docSnap.data();
    if (tableSnap.exists() && tableSnap.data().state === "IN_GAME") {
      const now = Date.now();
      const elapsed = p.satAt ? Math.floor((now - p.satAt) / 1000) : 0;
      totalTimeToAdd = (p.accumulatedTime || 0) + elapsed;
    }
    batch.delete(docSnap.ref);
  });

  await batch.commit();

  if (totalTimeToAdd > 0) {
    try {
      const userDocRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userDocRef);
      if (userSnap.exists()) {
        const stats = userSnap.data().stats || {};
        const prevSeconds = stats.timePlayedSeconds || 0;
        await updateDoc(userDocRef, {
          "stats.timePlayedSeconds": prevSeconds + totalTimeToAdd
        });
      }
    } catch (e) {
      console.error("Error updating user timePlayedSeconds on leaveTable:", e);
    }
  }
}

/**
 * Host: aggiunge chips a un giocatore (rebuy).
 * Incrementa sia lo stack che il totalBuyIn per tracciare il profitto/perdita finale.
 */
export async function addChips(
  tableId: string,
  host: User,
  targetUserId: string,
  amount: number
) {
  if (amount <= 0) throw new Error("L'importo deve essere positivo");

  const tableRef = doc(db, "tables", tableId);
  const playerRef = doc(db, "tables", tableId, "players", targetUserId);

  await runTransaction(db, async (transaction) => {
    const tableSnap = await transaction.get(tableRef);
    if (!tableSnap.exists()) throw new Error("Tavolo inesistente");
    const tableData = tableSnap.data() as any;
    if (tableData.hostId !== host.uid) throw new Error("Solo l'host può aggiungere chips");

    const playerSnap = await transaction.get(playerRef);
    if (!playerSnap.exists()) throw new Error("Giocatore non trovato");
    const pd = playerSnap.data() as any;

    const currentStack = Number(pd.stack) || 0;
    const currentBuyIn = Number(pd.totalBuyIn) || Number(tableData.initialStack) || 0;

    transaction.update(playerRef, {
      stack: currentStack + amount,
      totalBuyIn: currentBuyIn + amount
    });
  });
}

/**
 * Host: riordina i giocatori scambiando i seatIndex di due posti.
 *
 * L'ordine dei posti è un invariante del motore di gioco: la logica delle mani
 * indicizza i giocatori per posizione, non per uid, quindi scambiare i seatIndex
 * mentre una mano è viva sposta dealer/SB/BB e i turni sotto i piedi della mano
 * in corso. Il guard qui sotto rispecchia `disableEndGame` lato UI: riordinare è
 * lecito in LOBBY, in SUMMARY e *tra* una mano e l'altra (showdown con vincitore
 * già assegnato), mai a mano viva.
 *
 * Sta dentro una transazione proprio per quel guard: con il vecchio
 * read-then-writeBatch, una mano che parte tra la lettura e il commit avrebbe
 * lasciato passare lo scambio comunque.
 */
export async function swapPlayerSeats(
  tableId: string,
  host: User,
  userIdA: string,
  userIdB: string
) {
  const tableRef = doc(db, "tables", tableId);
  const refA = doc(db, "tables", tableId, "players", userIdA);
  const refB = doc(db, "tables", tableId, "players", userIdB);

  await runTransaction(db, async (transaction) => {
    // ===== LETTURA =====
    const tableSnap = await transaction.get(tableRef);
    if (!tableSnap.exists()) throw new Error("error.tableNotFound");
    const tableData = tableSnap.data() as any;

    if (tableData.hostId !== host.uid) throw new Error("error.onlyHost");

    if (tableData.state === "IN_GAME" && tableData.currentHandId) {
      const handRef = doc(db, "tables", tableId, "hands", tableData.currentHandId);
      const handSnap = await transaction.get(handRef);
      if (handSnap.exists()) {
        const handData = handSnap.data();
        const handOver =
          handData.stage === "SHOWDOWN" &&
          (!!handData.winnerId ||
            (Array.isArray(handData.winnerIds) && handData.winnerIds.length > 0));
        if (!handOver) throw new Error("error.seatChangeDuringHand");
      }
    }

    const snapA = await transaction.get(refA);
    const snapB = await transaction.get(refB);
    if (!snapA.exists() || !snapB.exists()) throw new Error("error.playerNotFound");

    const seatA = (snapA.data() as any).seatIndex;
    const seatB = (snapB.data() as any).seatIndex;

    // ===== SCRITTURA =====
    transaction.update(refA, { seatIndex: seatB });
    transaction.update(refB, { seatIndex: seatA });
  });
}

/**
 * Avvia la partita:
 * - controlla che ci siano almeno 2 giocatori
 * - crea la PRIMA mano con dealer, SB, BB, currentTurn
 * - setta lo stato del tavolo a IN_GAME + currentHandId
 * - resetta isReady per tutti
 * 
 * REGOLE:
 * - Con 2 giocatori (heads-up): giocatore 0 = BB, giocatore 1 = SB/Dealer
 * - Con 3+ giocatori: giocatore 0 = Dealer, 1 = SB, 2 = BB
 */
export async function startGame(tableId: string, user: User) {
  const tableRef = doc(db, "tables", tableId);

  const playersRef = collection(db, "tables", tableId, "players");
  const orderedPlayersSnap = await getDocs(query(playersRef, orderBy("seatIndex", "asc")));
  const playerRefs = orderedPlayersSnap.docs.map((d) => d.ref);

  await runTransaction(db, async (transaction) => {
    const tableSnap = await transaction.get(tableRef);

    if (!tableSnap.exists()) {
      throw new Error("Tavolo inesistente");
    }

    const tableData = tableSnap.data() as any;

    if (tableData.hostId !== user.uid) {
      throw new Error("error.onlyHost");
    }

    if (tableData.state !== "LOBBY") {
      throw new Error("La partita è già iniziata o il tavolo non è in LOBBY");
    }

    const sbAmount = Number(tableData.smallBlind) || 0;
    const bbAmount = Number(tableData.bigBlind) || 0;

    const playerSnaps = await Promise.all(playerRefs.map((r) => transaction.get(r)));
    const players = playerSnaps.map((d) => {
      const data = d.data() as any;
      let isSittingOut = !!data.isSittingOut;
      const stack = Number(data.stack) || 0;

      // Se ha meno del BB, viene forzato in panchina
      if (!isSittingOut && stack < bbAmount) {
        isSittingOut = true;
      }

      return {
        id: d.id,
        ref: d.ref,
        ...data,
        isSittingOut,
        stack
      };
    });

    const activePlayersCount = players.filter(p => !p.isSittingOut && p.stack > 0).length;

    if (activePlayersCount < 2) {
      throw new Error("error.minPlayersStart");
    }

    let dealerIndex: number;
    let smallBlindIndex: number;
    let bigBlindIndex: number;
    let firstToActIndex: number;

    const p1 = getNextActivePlayerIndex(players, -1);
    const p2 = getNextActivePlayerIndex(players, p1);
    const p3 = getNextActivePlayerIndex(players, p2);

    // CASO HEADS-UP (2 giocatori attivi): player 1 è BB, player 2 è SB/Dealer
    if (activePlayersCount === 2) {
      dealerIndex = p2;
      smallBlindIndex = p2;
      bigBlindIndex = p1;
      firstToActIndex = p2;
    }
    // CASO 3+ GIOCATORI:
    else {
      dealerIndex = p1;
      smallBlindIndex = p2;
      bigBlindIndex = p3;
      firstToActIndex = getNextActivePlayerIndex(players, p3);
    }

    const currentTurnIndex = firstToActIndex;

    let pot = 0;
    let currentBet = 0;
    const roundBets: Record<string, number> = {};
    const handContributions: Record<string, number> = {};

    // Piazziamo le blind
    const sbPlayer = players[smallBlindIndex];
    const bbPlayer = players[bigBlindIndex];

    if (sbAmount > 0) {
      roundBets[sbPlayer.id] = sbAmount;
      handContributions[sbPlayer.id] = sbAmount;
      pot += sbAmount;
    }

    if (bbAmount > 0) {
      roundBets[bbPlayer.id] = (roundBets[bbPlayer.id] || 0) + bbAmount;
      handContributions[bbPlayer.id] = (handContributions[bbPlayer.id] || 0) + bbAmount;
      pot += bbAmount;
      currentBet = bbAmount;
    }

    const isVirtualCards = !!tableData.isVirtualCards;
    let communityCards: string[] = [];
    let playerHands: Record<string, string[]> = {};

    if (isVirtualCards) {
      const deck = shuffleDeck(createDeck());
      const activePlayers = players.filter(p => !p.isSittingOut && p.stack > 0);

      // Dealing logic: 1 to each, then 2nd to each, starting from SB
      playerHands = {};
      activePlayers.forEach(p => playerHands[p.id] = []);

      const sbInActiveIdx = activePlayers.findIndex(p => p.id === sbPlayer.id);
      if (sbInActiveIdx !== -1) {
        for (let round = 0; round < 2; round++) {
          for (let i = 0; i < activePlayers.length; i++) {
            const p = activePlayers[(sbInActiveIdx + i) % activePlayers.length];
            playerHands[p.id].push(deck.pop()!);
          }
        }
      }

      deck.pop(); // Burn 1 before Flop
      const f1 = deck.pop()!;
      const f2 = deck.pop()!;
      const f3 = deck.pop()!;
      deck.pop(); // Burn 1 before Turn
      const t = deck.pop()!;
      deck.pop(); // Burn 1 before River
      const r = deck.pop()!;
      communityCards = [f1, f2, f3, t, r];
    }

    const handData: HandData = {
      handNumber: 1,
      stage: "PREFLOP",
      dealerIndex,
      smallBlindIndex,
      bigBlindIndex,
      currentTurnIndex,
      pot,
      currentBet,
      roundBets,
      handContributions,
      firstToActIndex,
      lastAggressorIndex: bigBlindIndex,
      isVirtualCards,
      communityCards,
      playerHands
    };

    const handsRef = collection(db, "tables", tableId, "hands");
    const handRef = doc(handsRef);

    transaction.set(handRef, {
      ...handData,
      createdAt: serverTimestamp()
    });

    const tableUpdate: any = {
      state: "IN_GAME",
      currentHandId: handRef.id,
      gameStartedAt: serverTimestamp(),
      // Used by the stale-table sweep to auto-end tables where no hand has
      // started in a long time — bumped here and in startNextHand only,
      // deliberately not on every single betting action.
      lastHandStartedAt: serverTimestamp()
    };

    if (tableData.mode === "TOURNAMENT") {
      tableUpdate.levelStartedAt = serverTimestamp();
      tableUpdate.currentLevelIndex = 0;
    }

    transaction.update(tableRef, tableUpdate);

    // Reset isReady di tutti i giocatori e scala le blind dagli stack
    players.forEach((p, index) => {
      let newStack = Number(p.stack) || 0;

      if (index === smallBlindIndex && sbAmount > 0) {
        newStack = Math.max(0, newStack - sbAmount);
      }
      if (index === bigBlindIndex && bbAmount > 0) {
        newStack = Math.max(0, newStack - bbAmount);
      }

      transaction.update(p.ref, {
        isFolded: !!p.isSittingOut || newStack === 0,
        isSittingOut: p.isSittingOut,
        stack: newStack,
        isReady: false,
        satAt: p.isSittingOut ? null : Date.now(),
        accumulatedTime: 0
      });
    });
  });
}


// swapSeats() è stato rimosso: duplicava swapPlayerSeats() senza host check né
// guard di stato, e si fidava dei seatIndex passati dal chiamante invece di
// rileggerli. Usare swapPlayerSeats().

export async function setSittingOut(
  tableId: string,
  user: User,
  isSittingOut: boolean
) {
  const tableRef = doc(db, "tables", tableId);
  const tableSnap = await getDoc(tableRef);
  if (!tableSnap.exists()) throw new Error("Tavolo inesistente.");
  const tableData = tableSnap.data() as any;

  const playerRef = doc(db, "tables", tableId, "players", user.uid);
  const playerSnap = await getDoc(playerRef);
  if (!playerSnap.exists()) throw new Error("Giocatore non trovato.");
  const playerData = playerSnap.data() as any;

  if (playerData.hasLeft) {
    throw new Error("Hai già lasciato definitivamente questa partita e non puoi rientrare.");
  }

  const updates: any = { isSittingOut };

  if (tableData.state === "IN_GAME") {
    const now = Date.now();
    if (isSittingOut) {
      if (playerData.satAt) {
        const elapsed = Math.floor((now - playerData.satAt) / 1000);
        updates.accumulatedTime = (playerData.accumulatedTime || 0) + elapsed;
        updates.satAt = null;
      }
    } else {
      updates.satAt = now;
    }
  }

  await updateDoc(playerRef, updates);
}

/**
 * Permette a un giocatore di lasciare DEFINITIVAMENTE una partita in corso —
 * a differenza di setSittingOut (pausa reversibile), qui il player viene marcato
 * `hasLeft`: il suo player-pod sparirà dal tavolo live, ma il documento player NON
 * viene eliminato, quindi il suo nome resta visibile nel recap finale (endGame())
 * e la numerazione dei seatIndex usata per calcolare dealer/turni resta stabile.
 *
 * Stessa regola di setSittingOut: non è permesso lasciare mentre si è ancora "vivi"
 * (non foldati, non già seduti fuori) in una mano attiva — altrimenti il piatto
 * potrebbe restare bloccato in attesa di un'azione, o peggio il giocatore
 * resterebbe idoneo a vincere un piatto pur avendo lasciato la partita (perché
 * l'idoneità ai side-pot si basa solo su isFolded, non su isSittingOut/hasLeft).
 * Va quindi prima foldato o atteso che la mano finisca.
 */
export async function quitGame(tableId: string, user: User) {
  const tableRef = doc(db, "tables", tableId);
  const playerRef = doc(db, "tables", tableId, "players", user.uid);

  // Only needed to hand off the host role if the quitter turns out to be the host —
  // a transaction can't run a query, so we fetch the candidate refs once here and
  // re-read each one fresh inside the transaction before deciding.
  const otherPlayerRefs = (await getDocs(
    query(collection(db, "tables", tableId, "players"), orderBy("seatIndex", "asc"))
  )).docs.map((d) => d.ref).filter((r) => r.id !== user.uid);

  await runTransaction(db, async (transaction) => {
    const tableSnap = await transaction.get(tableRef);
    if (!tableSnap.exists()) throw new Error("Tavolo inesistente.");
    const tableData = tableSnap.data() as any;

    if (tableData.state !== "IN_GAME") {
      throw new Error("Puoi lasciare definitivamente la partita solo mentre è in corso.");
    }

    const playerSnap = await transaction.get(playerRef);
    if (!playerSnap.exists()) throw new Error("Giocatore non trovato.");
    const playerData = playerSnap.data() as any;

    if (!playerData.isSittingOut && !playerData.isFolded) {
      const currentHandId = tableData.currentHandId;
      if (currentHandId) {
        const handRef = doc(db, "tables", tableId, "hands", currentHandId);
        const handSnap = await transaction.get(handRef);
        if (handSnap.exists()) {
          const hand = handSnap.data() as any as HandData;
          const handOver = hand.stage === "SHOWDOWN" &&
            (!!hand.winnerId || (hand.winnerIds && hand.winnerIds.length > 0));
          if (!handOver) {
            throw new Error("Non puoi lasciare la partita mentre sei ancora in mano: aspetta la fine della mano o folda prima.");
          }
        }
      }
    }

    // Se chi lascia è l'host, il ruolo passa al primo altro giocatore ancora presente
    // (non hasLeft) — altrimenti nessuno potrebbe più avanzare la mano o terminare
    // la partita. Se non resta nessun altro, il tavolo resta senza host: verrà
    // recuperato dal time-cap automatico sui tavoli IN_GAME inattivi.
    let newHostId: string | null = null;
    if (tableData.hostId === user.uid && otherPlayerRefs.length > 0) {
      const otherPlayerSnaps = await Promise.all(otherPlayerRefs.map((r) => transaction.get(r)));
      const candidate = otherPlayerSnaps.find((s) => s.exists() && !(s.data() as any).hasLeft);
      if (candidate) {
        newHostId = (candidate.data() as any).userId;
      }
    }

    const now = Date.now();
    const update: any = {
      isSittingOut: true,
      hasLeft: true,
      leftAt: serverTimestamp()
    };
    if (playerData.satAt) {
      const elapsed = Math.floor((now - playerData.satAt) / 1000);
      update.accumulatedTime = (playerData.accumulatedTime || 0) + elapsed;
      update.satAt = null;
    }

    transaction.update(playerRef, update);

    if (newHostId) {
      transaction.update(tableRef, { hostId: newHostId });
    }
  });
}

/**
 * Host-only: rimuove definitivamente un giocatore dal tavolo in corso — stessa
 * semantica di quitGame() (il player resta nel recap finale, ma il suo pod
 * sparisce dal tavolo live) ma iniziata dall'host anziché dal giocatore stesso.
 * Stessa restrizione di quitGame: non si può rimuovere un giocatore ancora
 * "vivo" (non foldato, non già seduto fuori) in una mano attiva — se sta
 * bloccando il turno, l'host deve prima usare forceFoldPlayer.
 */
export async function kickPlayer(tableId: string, hostUser: User, targetUserId: string) {
  const tableRef = doc(db, "tables", tableId);
  const playerRef = doc(db, "tables", tableId, "players", targetUserId);

  await runTransaction(db, async (transaction) => {
    const tableSnap = await transaction.get(tableRef);
    if (!tableSnap.exists()) throw new Error("Tavolo inesistente.");
    const tableData = tableSnap.data() as any;

    if (tableData.hostId !== hostUser.uid) {
      throw new Error("Solo l'host può rimuovere un giocatore.");
    }

    if (tableData.state !== "IN_GAME") {
      throw new Error("Puoi rimuovere un giocatore solo mentre la partita è in corso.");
    }

    if (targetUserId === hostUser.uid) {
      throw new Error("Non puoi rimuovere te stesso: usa \"Abbandona partita\".");
    }

    const playerSnap = await transaction.get(playerRef);
    if (!playerSnap.exists()) throw new Error("Giocatore non trovato.");
    const playerData = playerSnap.data() as any;

    if (!playerData.isSittingOut && !playerData.isFolded) {
      const currentHandId = tableData.currentHandId;
      if (currentHandId) {
        const handRef = doc(db, "tables", tableId, "hands", currentHandId);
        const handSnap = await transaction.get(handRef);
        if (handSnap.exists()) {
          const hand = handSnap.data() as any as HandData;
          const handOver = hand.stage === "SHOWDOWN" &&
            (!!hand.winnerId || (hand.winnerIds && hand.winnerIds.length > 0));
          if (!handOver) {
            throw new Error("Non puoi rimuovere questo giocatore mentre è ancora in mano: forzalo al fold prima.");
          }
        }
      }
    }

    const now = Date.now();
    const update: any = {
      isSittingOut: true,
      hasLeft: true,
      leftAt: serverTimestamp(),
      removedByHost: true
    };
    if (playerData.satAt) {
      const elapsed = Math.floor((now - playerData.satAt) / 1000);
      update.accumulatedTime = (playerData.accumulatedTime || 0) + elapsed;
      update.satAt = null;
    }

    transaction.update(playerRef, update);
  });
}

/**
 * Host-only: folds a specific player (must be their turn) and forces them to sit out.
 */
export async function forceFoldPlayer(
  tableId: string,
  hostUser: User,
  targetPlayerId: string
) {
  const tableRef = doc(db, "tables", tableId);

  const orderedPlayersSnap = await getDocs(query(collection(db, "tables", tableId, "players"), orderBy("seatIndex")));
  const playerRefs = orderedPlayersSnap.docs.map((d) => d.ref);

  await runTransaction(db, async (transaction) => {
    // ===== LETTURA =====
    const tableSnap = await transaction.get(tableRef);
    if (!tableSnap.exists()) throw new Error("Tavolo inesistente.");
    const tableData = tableSnap.data() as any;
    if (tableData.hostId !== hostUser.uid) throw new Error("Solo l'host può eseguire questa azione.");

    const handId = tableData.currentHandId;
    if (!handId) throw new Error("Nessuna mano in corso.");

    const handRef = doc(db, "tables", tableId, "hands", handId);
    const handSnap = await transaction.get(handRef);
    if (!handSnap.exists()) throw new Error("Mano non trovata.");
    const hand = handSnap.data() as any;

    const playerSnaps = await Promise.all(playerRefs.map((r) => transaction.get(r)));
    const players = playerSnaps.map(d => ({ id: d.id, ref: d.ref, data: d.data() as any }));
    const targetIdx = players.findIndex(p => p.id === targetPlayerId);

    if (targetIdx === -1) throw new Error("Giocatore non trovato.");
    if (hand.currentTurnIndex !== targetIdx) throw new Error("Puoi forzare il fold solo durante il turno del giocatore.");

    // ===== CALCOLO (pura logica in memoria, nessuna scrittura ancora) =====
    const activePlayers = players.filter(p => !p.data.isFolded && !p.data.isSittingOut);
    const remaining = activePlayers.filter(p => p.id !== targetPlayerId);

    let handUpdate: any = null;
    let nextTurnIndex: number | null = null;
    let winnerStackUpdate: { ref: any; stack: number } | null = null;
    let statsHand: HandData | null = null;
    let statsPlayers: { id: string; isFolded: boolean }[] | null = null;

    // If only one player remains after fold, auto-advance to showdown
    if (remaining.length === 1) {
      const winnerId = remaining[0].id;
      const handContributions = hand.handContributions || {};

      // Calculate pots with the target player already marked as folded
      const pots = calculatePotsCore(
        players.map(p => ({
          id: p.id,
          isFolded: p.id === targetPlayerId ? true : !!p.data.isFolded
        })),
        handContributions
      );

      // Auto-settle all pots for the only remaining player
      pots.forEach(p => {
        p.winners = [winnerId];
        p.settled = true;
      });

      handUpdate = {
        stage: "SHOWDOWN",
        currentTurnIndex: -1,
        pots,
        winnerIds: [winnerId],
        confirmedAt: serverTimestamp(),
        votingOpen: false
      };

      if (pots.length > 0) {
        handUpdate.winnerId = winnerId;
        handUpdate.pot = pots.reduce((sum: number, p: any) => sum + p.amount, 0);
      }

      // Update winner's stack
      const totalPot = pots.reduce((sum: number, p: any) => sum + p.amount, 0);
      const winnerIdx = players.findIndex(p => p.id === winnerId);
      if (winnerIdx !== -1) {
        winnerStackUpdate = {
          ref: players[winnerIdx].ref,
          stack: (players[winnerIdx].data.stack || 0) + totalPot
        };
      }

      statsHand = { ...hand, pots, handContributions: hand.handContributions };
      statsPlayers = players.map(p => ({ id: p.id, isFolded: p.id === targetPlayerId ? true : !!p.data.isFolded }));
    } else {
      // Find next active player
      let next = (targetIdx + 1) % players.length;
      while (next !== targetIdx && (players[next].data.isFolded || players[next].data.isSittingOut || players[next].id === targetPlayerId)) {
        next = (next + 1) % players.length;
      }
      nextTurnIndex = next;
    }

    // ===== LETTURA (2): documenti /users/{id} necessari per le statistiche =====
    let statsUserSnaps: Map<string, any> | null = null;
    if (statsHand && statsPlayers) {
      const candidateIds = getStatsCandidateIds(statsHand, statsPlayers);
      const snaps = await Promise.all(candidateIds.map((id) => transaction.get(doc(db, "users", id))));
      statsUserSnaps = new Map(candidateIds.map((id, i) => [id, snaps[i]]));
    }

    // ===== SCRITTURA =====
    // Set as folded and sitting out
    transaction.update(players[targetIdx].ref, { isFolded: true, isSittingOut: true });

    if (winnerStackUpdate) {
      transaction.update(winnerStackUpdate.ref, { stack: winnerStackUpdate.stack });
    }

    // Aggiorna statistiche per i giocatori registrati
    if (statsHand && statsPlayers && statsUserSnaps) {
      applyStatsUpdates(transaction, statsHand, statsPlayers, statsUserSnaps);
    }

    if (nextTurnIndex !== null) {
      transaction.update(handRef, { currentTurnIndex: nextTurnIndex });
    } else {
      transaction.update(handRef, handUpdate);
    }
  });
}

export async function endGame(tableId: string, user: User) {
  const tableRef = doc(db, "tables", tableId);
  const tableSnap = await getDoc(tableRef);
  if (!tableSnap.exists()) throw new Error("error.tableNotFound");
  const tableData = tableSnap.data() as any;

  if (tableData.hostId !== user.uid) {
    throw new Error("error.onlyHost");
  }

  // Senza questo guard, ri-terminare un tavolo già in SUMMARY ri-incrementa
  // stats.sessionsPlayed e stats.timePlayedSeconds di ogni giocatore.
  if (tableData.state === "SUMMARY") {
    throw new Error("error.gameAlreadyEnded");
  }

  const playersSnap = await getDocs(collection(db, "tables", tableId, "players"));
  const userSnaps: Record<string, any> = {};

  const playersData = await Promise.all(playersSnap.docs.map(async (d) => {
    const p = d.data();
    const finalStack = Number(p.stack) || 0;
    const initialStack = Number(tableData.initialStack) || 0;
    const totalBuyIn = Number(p.totalBuyIn) || initialStack;

    // Check if player is registered in users collection (still needed for stats update)
    const userDocRef = doc(db, "users", p.userId);
    const userSnap = await getDoc(userDocRef);

    if (userSnap.exists()) {
      userSnaps[p.userId] = userSnap.data();
    }

    // Calculate sitting time for this game session
    let elapsedSeconds = 0;
    if (tableData.state === "IN_GAME" && p.satAt) {
      elapsedSeconds = Math.floor((Date.now() - p.satAt) / 1000);
    }
    const sessionTimeSeated = (p.accumulatedTime || 0) + elapsedSeconds;

    return {
      userId: p.userId,
      startingStack: initialStack,
      finalStack: finalStack,
      netProfit: finalStack - totalBuyIn,
      sessionTimeSeated
    };
  }));

  const playerIds = playersData.map((p) => p.userId);

  const batch = writeBatch(db);

  // Write summary data directly on the table document — no separate table_history collection
  batch.update(tableRef, {
    state: "SUMMARY",
    endedAt: serverTimestamp(),
    playerIds,
    players: playersData
  });

  // Aggiorna sessionsPlayed e timePlayedSeconds per ciascun utente registrato
  for (const p of playersData) {
    if (userSnaps[p.userId]) {
      const userDocRef = doc(db, "users", p.userId);
      const currentStats = userSnaps[p.userId].stats || {};
      const prevSeconds = currentStats.timePlayedSeconds || 0;
      batch.update(userDocRef, {
        "stats.sessionsPlayed": (currentStats.sessionsPlayed || 0) + 1,
        "stats.timePlayedSeconds": prevSeconds + (p.sessionTimeSeated || 0)
      });
    }
  }

  // Resetta i contatori temporanei sui player document del tavolo
  playersSnap.docs.forEach((docSnap) => {
    batch.update(docSnap.ref, {
      satAt: null,
      accumulatedTime: 0
    });
  });

  await batch.commit();
}

/**
 * Avvia una nuova mano dopo che la precedente è terminata (showdown completato).
 * Ruota dealer, SB e BB di uno rispetto alla mano precedente.
 */
export async function startNextHand(tableId: string, user: User) {
  const tableRef = doc(db, "tables", tableId);

  // Prendiamo i giocatori ordinati per seatIndex (fuori dalla transazione, solo per sapere quali documenti leggere)
  const playersRef = collection(db, "tables", tableId, "players");
  const orderedPlayersSnap = await getDocs(query(playersRef, orderBy("seatIndex", "asc")));
  const playerRefs = orderedPlayersSnap.docs.map((d) => d.ref);

  // Se il torneo termina per mancanza di giocatori attivi, endGame() viene invocata
  // FUORI dalla transazione (è una funzione a sé, con le proprie letture/scritture).
  let shouldEndTournament = false;

  await runTransaction(db, async (transaction) => {
    const tableSnap = await transaction.get(tableRef);
    if (!tableSnap.exists()) throw new Error("error.tableNotFound");
    const tableData = tableSnap.data() as any;

    if (tableData.hostId !== user.uid) {
      throw new Error("error.onlyHost");
    }

    if (tableData.state !== "IN_GAME") {
      throw new Error("error.notInGame");
    }

    const prevHandId: string | null = tableData.currentHandId ?? null;
    if (!prevHandId) throw new Error("error.noPrevHand");

    const prevHandRef = doc(db, "tables", tableId, "hands", prevHandId);
    const prevHandSnap = await transaction.get(prevHandRef);
    if (!prevHandSnap.exists()) throw new Error("error.prevHandNotFound");

    const prevHand = prevHandSnap.data() as any as HandData;
    if (prevHand.stage !== "SHOWDOWN") {
      throw new Error("error.notShowdown");
    }

    let sbAmount = Number(tableData.smallBlind) || 0;
    let bbAmount = Number(tableData.bigBlind) || 0;
    let updatedTableData: any = {};

    if (tableData.mode === "TOURNAMENT" && tableData.tournamentConfig && tableData.levelStartedAt) {
      const config = tableData.tournamentConfig;
      // Check if levelStartedAt has toMillis (it's a Firestore Timestamp)
      const levelStartedAtMillis = typeof tableData.levelStartedAt.toMillis === "function"
        ? tableData.levelStartedAt.toMillis()
        : tableData.levelStartedAt.seconds * 1000;

      const now = Date.now();

      if (config.blindSchedule && config.blindSchedule.length > 0) {
        const currentLevelIndex = tableData.currentLevelIndex || 0;
        const levelDurationMins = config.blindSchedule[currentLevelIndex]?.durationMins || 15;

        // If elapsed time is greater than level duration
        if (now >= levelStartedAtMillis + levelDurationMins * 60 * 1000) {
          const nextLevelIndex = Math.min(currentLevelIndex + 1, config.blindSchedule.length - 1);

          if (nextLevelIndex !== currentLevelIndex) {
            sbAmount = config.blindSchedule[nextLevelIndex].sb;
            bbAmount = config.blindSchedule[nextLevelIndex].bb;

            updatedTableData = {
              currentLevelIndex: nextLevelIndex,
              smallBlind: sbAmount,
              bigBlind: bbAmount,
              levelStartedAt: serverTimestamp()
            };
          } else {
            // If at max level, just reset timer but keep same blinds
            updatedTableData.levelStartedAt = serverTimestamp();
          }
        }
      }
    }

    const playerSnaps = await Promise.all(playerRefs.map((r) => transaction.get(r)));
    const players = playerSnaps.map((d) => {
      const data = d.data() as any;
      let isSittingOut = !!data.isSittingOut;
      const stack = Number(data.stack) || 0;

      // Se ha meno del BB, viene forzato in panchina
      if (!isSittingOut && stack < bbAmount) {
        isSittingOut = true;
      }

      return {
        id: d.id,
        ref: d.ref,
        stack,
        seatIndex: data.seatIndex,
        isFolded: !!data.isFolded,
        isSittingOut
      };
    });

    const activePlayersCount = players.filter(p => !p.isSittingOut && p.stack > 0).length;

    if (activePlayersCount < 2) {
      if (tableData.mode === "TOURNAMENT") {
        shouldEndTournament = true;
        return;
      }
      throw new Error("error.minPlayers");
    }

    let dealerIndex: number;
    let smallBlindIndex: number;
    let bigBlindIndex: number;
    let firstToActIndex: number;

    if (activePlayersCount === 2) {
      // Heads-up: ruotiamo semplicemente i ruoli tramite i giocatori attivi presenti
      dealerIndex = getNextActivePlayerIndex(players, prevHand.dealerIndex);
      smallBlindIndex = dealerIndex;
      bigBlindIndex = getNextActivePlayerIndex(players, dealerIndex);
      firstToActIndex = smallBlindIndex;
    } else {
      dealerIndex = getNextActivePlayerIndex(players, prevHand.dealerIndex);
      smallBlindIndex = getNextActivePlayerIndex(players, dealerIndex);
      bigBlindIndex = getNextActivePlayerIndex(players, smallBlindIndex);
      firstToActIndex = getNextActivePlayerIndex(players, bigBlindIndex);
    }

    let pot = 0;
    let currentBet = 0;
    const roundBets: Record<string, number> = {};
    const handContributions: Record<string, number> = {};

    const sbPlayer = players[smallBlindIndex];
    const bbPlayer = players[bigBlindIndex];

    if (sbAmount > 0) {
      roundBets[sbPlayer.id] = sbAmount;
      handContributions[sbPlayer.id] = sbAmount;
      pot += sbAmount;
    }

    if (bbAmount > 0) {
      roundBets[bbPlayer.id] = (roundBets[bbPlayer.id] || 0) + bbAmount;
      handContributions[bbPlayer.id] = (handContributions[bbPlayer.id] || 0) + bbAmount;
      pot += bbAmount;
      currentBet = bbAmount;
    }

    const handsRef = collection(db, "tables", tableId, "hands");
    const newHandRef = doc(handsRef);

    const isVirtualCards = !!tableData.isVirtualCards;
    let communityCards: string[] = [];
    let playerHands: Record<string, string[]> = {};

    if (isVirtualCards) {
      const deck = shuffleDeck(createDeck());
      const activePlayers = players.filter(p => !p.isSittingOut && p.stack > 0);

      playerHands = {};
      activePlayers.forEach(p => playerHands[p.id] = []);

      const sbInActiveIdx = activePlayers.findIndex(p => p.id === sbPlayer.id);
      if (sbInActiveIdx !== -1) {
        for (let round = 0; round < 2; round++) {
          for (let i = 0; i < activePlayers.length; i++) {
            const p = activePlayers[(sbInActiveIdx + i) % activePlayers.length];
            playerHands[p.id].push(deck.pop()!);
          }
        }
      }

      deck.pop(); // Burn 1 before Flop
      const f1 = deck.pop()!;
      const f2 = deck.pop()!;
      const f3 = deck.pop()!;
      deck.pop(); // Burn 1 before Turn
      const t = deck.pop()!;
      deck.pop(); // Burn 1 before River
      const r = deck.pop()!;
      communityCards = [f1, f2, f3, t, r];
    }

    const newHand: HandData = {
      handNumber: (prevHand.handNumber || 1) + 1,
      stage: "PREFLOP",
      dealerIndex,
      smallBlindIndex,
      bigBlindIndex,
      currentTurnIndex: firstToActIndex,
      pot,
      currentBet,
      roundBets,
      handContributions,
      firstToActIndex,
      lastAggressorIndex: bigBlindIndex,
      isVirtualCards,
      communityCards,
      playerHands
    };

    transaction.set(newHandRef, {
      ...newHand,
      createdAt: serverTimestamp()
    });

    // Aggiorniamo il tavolo con la nuova mano corrente e i nuovi blinds se aggiornati
    transaction.update(tableRef, {
      currentHandId: newHandRef.id,
      lastHandStartedAt: serverTimestamp(),
      ...updatedTableData
    });

    // Reset stato giocatori per la nuova mano
    players.forEach((p, index) => {
      let newStack = p.stack;

      if (index === smallBlindIndex && sbAmount > 0) {
        newStack = Math.max(0, newStack - sbAmount);
      }
      if (index === bigBlindIndex && bbAmount > 0) {
        newStack = Math.max(0, newStack - bbAmount);
      }

      transaction.update(p.ref, {
        isFolded: !!p.isSittingOut || newStack === 0,
        isSittingOut: p.isSittingOut,
        stack: newStack
      });
    });
  });

  if (shouldEndTournament) {
    await endGame(tableId, user);
  }
}


export type PlayerActionType = "CHECK" | "CALL" | "BET" | "FOLD";

/**
 * Esegue una azione di gioco per il player corrente.
 * 
 * LOGICA CHIUSURA ROUND:
 * 
 * PREFLOP:
 * - Il round chiude quando il giocatore PRIMA dell'ultimo aggressore ha agito
 *   e tutti hanno matched la puntata
 * 
 * POST-FLOP (FLOP/TURN/RIVER):
 * - Se tutti checkano: chiude quando il giocatore prima dello SB checka
 * - Se qualcuno raisa: chiude quando il giocatore prima del raiser calla
 */
export async function playerAction(
  tableId: string,
  user: User | null,
  action: PlayerActionType,
  amount?: number
) {
  if (!user) throw new Error("User non presente per playerAction");

  const tableRef = doc(db, "tables", tableId);

  // L'ordine dei posti non cambia durante una mano: lo leggiamo una volta sola,
  // fuori dalla transazione, solo per sapere QUALI documenti player leggere/scrivere
  // (le transazioni Firestore non supportano query, solo letture per singolo documento).
  const playersRef = collection(db, "tables", tableId, "players");
  const orderedPlayersSnap = await getDocs(query(playersRef, orderBy("seatIndex", "asc")));
  const playerRefs = orderedPlayersSnap.docs.map((d) => d.ref);

  if (playerRefs.length === 0) {
    throw new Error("Nessun giocatore al tavolo");
  }

  await runTransaction(db, async (transaction) => {
    // ===== LETTURA =====
    const tableSnap = await transaction.get(tableRef);
    if (!tableSnap.exists()) {
      throw new Error("Tavolo inesistente");
    }
    const tableData = tableSnap.data() as any;

    if (tableData.state !== "IN_GAME") {
      throw new Error("La partita non è in stato IN_GAME");
    }

    const currentHandId: string | null = tableData.currentHandId ?? null;
    if (!currentHandId) {
      throw new Error("Nessuna mano corrente impostata");
    }

    const handRef = doc(db, "tables", tableId, "hands", currentHandId);
    const handSnap = await transaction.get(handRef);

    if (!handSnap.exists()) {
      throw new Error("La mano corrente non esiste");
    }

    const handData = handSnap.data() as any as HandData;

    let lastAggressorIndex: number = handData.lastAggressorIndex ?? handData.bigBlindIndex;

    if (handData.currentTurnIndex == null || handData.currentTurnIndex < 0) {
      throw new Error("Non è il turno di nessuno al momento");
    }

    const playerSnaps = await Promise.all(playerRefs.map((r) => transaction.get(r)));

    const players = playerSnaps.map((d) => {
      const data = d.data() as any;
      const stack = Number(data.stack) || 0;
      return {
        id: d.id,
        ref: d.ref,
        userId: data.userId,
        stack,
        seatIndex: data.seatIndex,
        isFolded: !!data.isFolded,
        isSittingOut: !!data.isSittingOut,
        isAllIn: stack === 0 && !data.isFolded && !data.isSittingOut
      };
    });

    const numPlayers = players.length;
    const currentIndex = handData.currentTurnIndex;

    if (currentIndex < 0 || currentIndex >= numPlayers) {
      throw new Error("Indice turno non valido");
    }

    const currentPlayer = players[currentIndex];
    if (currentPlayer.userId !== user.uid) {
      throw new Error("Non è il tuo turno");
    }

    if (currentPlayer.isFolded) {
      throw new Error("Sei già foldato in questa mano");
    }

    // ===== CALCOLO (pura logica in memoria, nessuna scrittura ancora) =====

    // Round bets
    const roundBets: Record<string, number> = {
      ...(handData.roundBets || {})
    };

    const myBet = roundBets[user.uid] || 0;
    let pot = handData.pot;
    let currentBet = handData.currentBet;

    // Helper per trovare il prossimo giocatore attivo che puo' ancora agire (non all-in, non foldato)
    function getNextActiveIndex(fromIndex: number): number {
      for (let i = 1; i <= numPlayers; i++) {
        const idx = (fromIndex + i) % numPlayers;
        const p = players[idx];
        // Salta foldati, sitting-out, e chi e' in all-in (stack = 0 e non foldato)
        if (!p.isFolded && !p.isSittingOut && p.stack > 0) {
          return idx;
        }
      }
      return -1;
    }

    function getPreviousActiveIndex(fromIndex: number): number {
      for (let i = 1; i <= numPlayers; i++) {
        const idx = (fromIndex - i + numPlayers) % numPlayers;
        const p = players[idx];
        if (!p.isFolded && !p.isSittingOut && p.stack > 0) {
          return idx;
        }
      }
      return -1;
    }

    // Eseguiamo l'azione
    switch (action) {
      case "CHECK": {
        if (myBet !== currentBet) {
          throw new Error("Non puoi fare check: devi ancora coprire la puntata.");
        }
        break;
      }

      case "CALL": {
        if (currentBet <= myBet) {
          throw new Error("Niente da chiamare.");
        }

        let diff = currentBet - myBet;
        if (currentPlayer.stack < diff) {
          diff = currentPlayer.stack; // All-in (Chiama tutto ciò che ha)
        }

        roundBets[user.uid] = myBet + diff;
        pot += diff;
        currentPlayer.stack -= diff;
        break;
      }

      case "BET": {
        const target = Number(amount);
        if (!target || target <= 0) {
          throw new Error("Importo bet/raise non valido.");
        }

        const maxFinal = myBet + currentPlayer.stack;
        if (target > maxFinal) {
          throw new Error(
            "Non puoi puntare più del tuo stack (gioca la quantità esatta dello stack residuo per l'All-in)."
          );
        }

        if (currentBet === 0) {
          if (target <= 0) {
            throw new Error("La puntata deve essere maggiore di zero.");
          }
        } else {
          if (target <= currentBet && target < maxFinal) {
            throw new Error(
              "Il raise deve essere maggiore della puntata corrente (oppure uguale al proprio All-in)."
            );
          }
        }

        const diff = target - myBet;

        if (diff <= 0) {
          throw new Error("La nuova puntata deve aumentare il totale che hai investito.");
        }

        roundBets[user.uid] = target;
        pot += diff;
        currentBet = target;
        currentPlayer.stack -= diff;

        // L'ultimo aggressore diventa chi effettua questa bet/raise
        lastAggressorIndex = currentIndex;
        break;
      }

      case "FOLD": {
        currentPlayer.isFolded = true;
        break;
      }

      default:
        throw new Error("Azione non supportata");
    }

    const handContributions: Record<string, number> = handData.handContributions || {};
    // Captured BEFORE the mutation below — handContributions is the same object
    // reference as handData.handContributions (not a copy, unlike roundBets), so
    // reading it after this point would already reflect this action's own
    // contribution. The VPIP stats check further down needs the PRE-action value
    // to tell a voluntary entry into the pot from a player who'd already put
    // money in (e.g. completing the blind).
    const contributionBeforeThisAction = handContributions[user.uid] || 0;
    if (action === "CALL" || action === "BET") {
      const diff = (roundBets[user.uid] || 0) - myBet;
      handContributions[user.uid] = (handContributions[user.uid] || 0) + diff;
    }

    // Giocatori non foldati/non sitting-out
    const activePlayers = players.filter(
      (p) => !p.isFolded && !p.isSittingOut
    );

    // Giocatori che possono ancora AGIRE (hanno ancora chips, non sono in all-in)
    const actingPlayers = activePlayers.filter(p => p.stack > 0);

    let newStage = handData.stage;
    let nextTurnIndex = getNextActiveIndex(currentIndex);

    // Se rimane 1 solo giocatore attivo (o meno), tutti gli altri hanno foldato -> SHOWDOWN immediato
    let potsCalculatedFastForward: Pot[] | undefined = undefined;

    if (activePlayers.length <= 1) {
      // Solo un giocatore rimasto (tutti gli altri foldati)
      newStage = "SHOWDOWN";
      nextTurnIndex = -1;
      potsCalculatedFastForward = calculatePotsCore(
        players.map(p => ({ id: p.userId, isFolded: p.isFolded })),
        handContributions
      );
    } else if (actingPlayers.length <= 1) {
      // Tutti gli altri sono in all-in o foldati: solo 1 o 0 possono ancora scommettere
      // Se anche l'ultimo attore ha matchato, si va subito a showdown
      const lastActingPlayer = actingPlayers[0];
      const lastActingBet = lastActingPlayer ? (roundBets[lastActingPlayer.userId] || 0) : 0;

      const shouldGoToShowdown = actingPlayers.length === 0 ||
        (actingPlayers.length === 1 && (lastActingBet >= currentBet || currentBet === 0));

      if (shouldGoToShowdown) {
        newStage = "SHOWDOWN";
        nextTurnIndex = -1;
        potsCalculatedFastForward = calculatePotsCore(
          players.map(p => ({ id: p.userId, isFolded: p.isFolded })),
          handContributions
        );
      } else {
        // Non va ancora a showdown: verifica se tutti hanno matched la puntata (O SONO IN ALL-IN!)
        const allMatched = activePlayers.every((p) => {
          const b = roundBets[p.userId] || 0;
          return b === currentBet || p.stack === 0;
        });

        if (handData.stage === "PREFLOP") {
          if (allMatched) {
            if (currentBet === Number(tableData.bigBlind)) {
              if (currentIndex === handData.bigBlindIndex) {
                nextTurnIndex = -1;
              }
            } else {
              nextTurnIndex = -1;
            }
          }
        } else {
          // POST-FLOP
          if (allMatched) {
            if (currentBet === 0) {
              const wasFolded = currentPlayer.isFolded;
              currentPlayer.isFolded = false;
              const originalCloser = getPreviousActiveIndex(handData.smallBlindIndex);
              currentPlayer.isFolded = wasFolded;
              if (originalCloser !== -1 && currentIndex === originalCloser) {
                nextTurnIndex = -1;
              }
            } else {
              nextTurnIndex = -1;
            }
          }
        }
      }
    } else {
      // Caso normale: più giocatori con chips, la verifica di allMatched si applica normalmente
      const allMatched = activePlayers.every((p) => {
        const b = roundBets[p.userId] || 0;
        return b === currentBet || p.stack === 0;
      });

      if (handData.stage === "PREFLOP") {
        if (allMatched) {
          if (currentBet === Number(tableData.bigBlind)) {
            if (currentIndex === handData.bigBlindIndex) {
              nextTurnIndex = -1;
            }
          } else {
            nextTurnIndex = -1;
          }
        }
      } else {
        // POST-FLOP (FLOP, TURN, RIVER)
        if (allMatched) {
          let shouldEndRound = false;
          if (currentBet === 0) {
            const wasFolded = currentPlayer.isFolded;
            currentPlayer.isFolded = false;
            const originalCloser = getPreviousActiveIndex(handData.smallBlindIndex);
            currentPlayer.isFolded = wasFolded;
            if (originalCloser !== -1 && currentIndex === originalCloser) {
              shouldEndRound = true;
            }
          } else {
            shouldEndRound = true;
          }

          if (shouldEndRound) {
            if (handData.stage === "RIVER") {
              newStage = "SHOWDOWN";
              nextTurnIndex = -1;
              potsCalculatedFastForward = calculatePotsCore(
                players.map(p => ({ id: p.userId, isFolded: p.isFolded })),
                handContributions
              );
            } else {
              nextTurnIndex = -1;
            }
          }
        }
      }
    }

    // Snapshot di isAllIn nello stesso punto in cui il codice scriveva storicamente
    // stack/isFolded/isAllIn, cioè PRIMA dell'accredito dei pot di showdown.
    const isAllInSnapshot: Record<string, boolean> = {};
    players.forEach(p => {
      isAllInSnapshot[p.userId] = p.stack === 0 && !p.isFolded && !p.isSittingOut;
    });

    // Aggiorna la hand (solo in memoria per ora)
    const handUpdate: any = {
      pot,
      currentBet,
      roundBets,
      handContributions,
      currentTurnIndex: nextTurnIndex,
      stage: newStage,
      lastAggressorIndex
    };

    if (potsCalculatedFastForward) {
      // Showdown rapido: usa i pot già calcolati
      handUpdate.pots = potsCalculatedFastForward;
    } else {
      // Durante il gioco: ricalcola live i pot per mostrare i side-pot nell'UI
      handUpdate.pots = calculatePotsCore(
        players.map(p => ({ id: p.userId, isFolded: p.isFolded })),
        handContributions
      );
    }

    // Gestione SHOWDOWN rapido (per fold o per all-in) — mutazioni in memoria, nessuna scrittura
    if (newStage === "SHOWDOWN") {
      if (activePlayers.length <= 1) {
        // Tutti gli altri hanno foldato: solo 1 vincitore possibile
        // Le carte del vincitore NON vengono mostrate
        if (activePlayers.length === 1) {
          handUpdate.winnerId = activePlayers[0].userId;
          handUpdate.winnerIds = [activePlayers[0].userId];
        }
        handUpdate.votingOpen = false;
        handUpdate.confirmedAt = serverTimestamp();

        // Riaccredita chips dai pot settlati automaticamente
        if (potsCalculatedFastForward) {
          potsCalculatedFastForward.forEach(pt => {
            if (pt.settled && pt.winners && pt.winners.length > 0) {
              const wId = pt.winners[0];
              const wPlayer = players.find(p => p.userId === wId);
              if (wPlayer) {
                wPlayer.stack += pt.amount;
              }
            }
          });
        }
      } else if (potsCalculatedFastForward) {
        // Scenario all-in o river completato: più giocatori attivi

        // Se carte virtuali e abbiamo le mani dei giocatori, auto-valuta
        if (handData.isVirtualCards && handData.playerHands && handData.communityCards && handData.communityCards.length === 5) {
          const playersForEval = players.map(p => ({
            id: p.userId,
            ref: p.ref,
            stack: p.stack,
            isFolded: p.isFolded
          }));
          const evalResult = autoEvaluateShowdown(
            potsCalculatedFastForward,
            handData.playerHands,
            handData.communityCards,
            playersForEval
          );
          Object.assign(handUpdate, evalResult);
          // autoEvaluateShowdown ha mutato playersForEval[i].stack: riportiamo i valori sui players originali
          playersForEval.forEach((pe) => {
            const p = players.find(pp => pp.userId === pe.id);
            if (p) p.stack = pe.stack;
          });
        } else {
          // Carte fisiche o dati mancanti: fallback al flusso manuale
          // Accredita SUBITO i pots con un solo eligible (uncalled bets / pots automatici)
          potsCalculatedFastForward.forEach(pt => {
            if (pt.settled && pt.winners && pt.winners.length === 1) {
              const wPlayer = players.find(p => p.userId === pt.winners![0]);
              if (wPlayer) {
                wPlayer.stack += pt.amount;
              }
            }
          });

          // Verifica se ci sono ancora pot da assegnare manualmente
          const hasUnseattledPots = potsCalculatedFastForward.some(pt => !pt.settled);
          if (hasUnseattledPots) {
            handUpdate.votingOpen = true;
            handUpdate.winnerIds = [];
          } else {
            const globalWinners = new Set<string>();
            potsCalculatedFastForward.forEach(pt => pt.winners?.forEach(w => globalWinners.add(w)));
            handUpdate.winnerIds = Array.from(globalWinners);
            handUpdate.winnerId = handUpdate.winnerIds.length === 1 ? handUpdate.winnerIds[0] : null;
            handUpdate.votingOpen = false;
            handUpdate.confirmedAt = serverTimestamp();
          }
        }
      }
    }

    // ===== LETTURA (2): documenti /users/{id} necessari per le statistiche =====
    // Devono essere letti PRIMA di qualsiasi scrittura (regola delle transazioni Firestore).
    let statsHand: HandData | null = null;
    let statsUserSnaps: Map<string, any> | null = null;
    if (handUpdate.confirmedAt) {
      const finalPots = handUpdate.pots || handData.pots || [];
      statsHand = {
        ...handData,
        pots: finalPots,
        handContributions,
        handResults: handUpdate.handResults || handData.handResults
      };
      const candidateIds = getStatsCandidateIds(statsHand, players.map(p => ({ id: p.userId })));
      const snaps = await Promise.all(candidateIds.map((id) => transaction.get(doc(db, "users", id))));
      statsUserSnaps = new Map(candidateIds.map((id, i) => [id, snaps[i]]));
    }

    // Aggiorna le statistiche delle azioni dell'utente registrato
    const userDocRef = doc(db, "users", user.uid);
    const userDocSnap = await transaction.get(userDocRef);

    // ===== SCRITTURA =====

    // Aggiorna i player (stack + isFolded + isAllIn) in un solo passaggio
    players.forEach((p) => {
      transaction.update(p.ref, {
        isFolded: p.isFolded,
        stack: p.stack,
        isAllIn: isAllInSnapshot[p.userId]
      });
    });

    if (statsHand && statsUserSnaps) {
      applyStatsUpdates(
        transaction,
        statsHand,
        players.map(p => ({ id: p.userId, isFolded: !!p.isFolded })),
        statsUserSnaps
      );
    }

    if (userDocSnap.exists()) {
      const isAggressive = action === "BET";
      const stage = handData.stage || "PREFLOP";

      const updates: Record<string, any> = {};
      updates["stats.totalActions"] = increment(1);
      if (isAggressive) {
        updates["stats.aggressiveActions"] = increment(1);
      }

      if (stage === "PREFLOP") {
        updates["stats.stagePreflopCount"] = increment(1);

        const sbSize = Number(tableData.smallBlind) || 0;
        const bbSize = Number(tableData.bigBlind) || 0;
        const currentContrib = contributionBeforeThisAction;
        const isSB = currentPlayer.seatIndex === handData.smallBlindIndex;
        const isBB = currentPlayer.seatIndex === handData.bigBlindIndex;

        // True on a player's first preflop decision point of the hand, regardless
        // of what they do with it (fold/check/call/bet) — this is the correct VPIP
        // denominator. stats.handsPlayed/stagePreflopCount aren't usable for this:
        // they've been accumulating correctly since long before vpipCount tracking
        // was fixed, so dividing the (still small, just-started) vpipCount by either
        // of them produces an artificially low ratio until months of new hands dilute
        // the old history back out. vpipEligibleHands starts from the same zero
        // baseline as vpipCount, so their ratio is meaningful immediately.
        const isFirstPreflopDecision =
          (!isSB && !isBB && currentContrib === 0) ||
          (isSB && currentContrib <= sbSize) ||
          (isBB && currentContrib <= bbSize);

        let isVpipAction = false;
        if (action === "CALL" || action === "BET") {
          if (!isSB && !isBB && currentContrib === 0) {
            isVpipAction = true;
          } else if (isSB && currentContrib <= sbSize) {
            isVpipAction = true;
          } else if (isBB && currentContrib <= bbSize) {
            isVpipAction = true;
          }
        }

        if (isFirstPreflopDecision) {
          updates["stats.vpipEligibleHands"] = increment(1);
        }

        if (isVpipAction) {
          updates["stats.vpipCount"] = increment(1);
        }
      } else if (stage === "FLOP") {
        updates["stats.stageFlopCount"] = increment(1);
      } else if (stage === "TURN") {
        updates["stats.stageTurnCount"] = increment(1);
      } else if (stage === "RIVER") {
        updates["stats.stageRiverCount"] = increment(1);
      }

      transaction.update(userDocRef, updates);
    }

    transaction.update(handRef, handUpdate);
  });
}

/**
 * Avanza la mano allo stage successivo (PREFLOP -> FLOP -> TURN -> RIVER -> SHOWDOWN).
 * 
 * IMPORTANTE: Post-flop, la prima mossa è SEMPRE dello SB (o del primo giocatore
 * attivo dopo lo SB se lo SB ha foldato).
 */
export async function advanceStage(tableId: string, user: User) {
  const tableRef = doc(db, "tables", tableId);

  const playersRef = collection(db, "tables", tableId, "players");
  const orderedPlayersSnap = await getDocs(query(playersRef, orderBy("seatIndex", "asc")));
  const playerRefs = orderedPlayersSnap.docs.map((d) => d.ref);

  await runTransaction(db, async (transaction) => {
    // ===== LETTURA =====
    const tableSnap = await transaction.get(tableRef);
    if (!tableSnap.exists()) throw new Error("Tavolo inesistente.");
    const tableData = tableSnap.data() as any;

    if (tableData.hostId !== user.uid) {
      throw new Error("Solo l'host può avanzare la mano.");
    }

    const currentHandId = tableData.currentHandId;
    if (!currentHandId) throw new Error("Nessuna mano corrente.");

    const handRef = doc(db, "tables", tableId, "hands", currentHandId);
    const handSnap = await transaction.get(handRef);
    if (!handSnap.exists()) throw new Error("Mano non trovata.");

    const hand = handSnap.data() as any as HandData;

    const playerSnaps = await Promise.all(playerRefs.map((r) => transaction.get(r)));
    const plyrsData = playerSnaps.map((d) => {
      const dd = d.data() as any;
      return {
        id: d.id,
        ref: d.ref,
        seatIndex: dd.seatIndex,
        isFolded: !!dd.isFolded,
        isSittingOut: !!dd.isSittingOut,
        stack: Number(dd.stack) || 0
      };
    });

    // ===== CALCOLO (pura logica in memoria, nessuna scrittura ancora) =====
    let nextStage: HandData["stage"] = hand.stage;
    if (hand.stage === "PREFLOP") nextStage = "FLOP";
    else if (hand.stage === "FLOP") nextStage = "TURN";
    else if (hand.stage === "TURN") nextStage = "RIVER";
    else if (hand.stage === "RIVER") nextStage = "SHOWDOWN";
    else throw new Error("La mano è già in SHOWDOWN.");

    let firstToActIndex = hand.firstToActIndex;
    let lastAggressorIndex: number | undefined = undefined;

    if (nextStage !== "SHOWDOWN") {
      const n = plyrsData.length;

      // Controlla se tutti i giocatori attivi sono all-in → vai direttamente a SHOWDOWN
      const canActPlayers = plyrsData.filter(p => !p.isFolded && !p.isSittingOut && p.stack > 0);
      if (canActPlayers.length <= 1) {
        // Al massimo 1 (o zero) giocatori possono ancora puntare → forza SHOWDOWN
        nextStage = "SHOWDOWN";
      } else {
        // POST-FLOP: la prima mossa è SEMPRE dello SB (o SB+1 se ha foldato o è all-in)
        const startIndex = hand.smallBlindIndex % n;

        // Troviamo il primo giocatore che può ancora agire (non foldato, non all-in)
        let idx = startIndex;
        for (let i = 0; i < n; i++) {
          const p = plyrsData[idx];
          if (!p.isFolded && !p.isSittingOut && p.stack > 0) {
            firstToActIndex = idx;
            break;
          }
          idx = (idx + 1) % n;
        }

        // Impostiamo lastAggressorIndex all'ultimo giocatore che può agire prima del firstToAct
        for (let i = 1; i <= n; i++) {
          const prevIdx = (firstToActIndex - i + n) % n;
          const p = plyrsData[prevIdx];
          if (!p.isFolded && !p.isSittingOut && p.stack > 0) {
            lastAggressorIndex = prevIdx;
            break;
          }
        }
      }
    }

    const updateData: any = {
      stage: nextStage,
      currentBet: 0,
      roundBets: {},
      currentTurnIndex: nextStage === "SHOWDOWN" ? -1 : firstToActIndex,
      firstToActIndex
    };

    if (lastAggressorIndex !== undefined) {
      updateData.lastAggressorIndex = lastAggressorIndex;
    }

    // ID dei player il cui stack è stato modificato da un accredito di showdown
    // (solo questi verranno riscritti su Firestore, come nel comportamento storico).
    const stackChangedIds = new Set<string>();
    let statsHand: HandData | null = null;
    let statsPlayers: { id: string; isFolded: boolean }[] | null = null;

    // Se passiamo a SHOWDOWN, valutiamo le mani (virtuali) o apriamo la votazione (fisiche)
    if (nextStage === "SHOWDOWN") {
      const activePlayers = plyrsData.filter(p => !p.isFolded);

      // Calcoliamo i side pots da mettere nel DB
      const calcPots = calculatePotsCore(plyrsData, hand.handContributions || {});
      updateData.pots = calcPots;

      if (activePlayers.length <= 1) {
        // Solo 1 giocatore — vince automaticamente, carte non mostrate
        calcPots.forEach(pt => {
          if (pt.settled && pt.winners && pt.winners.length > 0) {
            const shares = splitPot(pt.amount, pt.winners.length);
            pt.winners.forEach((wid, i) => {
              const w = plyrsData.find(p => p.id === wid);
              if (w) {
                w.stack += shares[i];
                stackChangedIds.add(wid);
              }
            });
          }
        });

        if (activePlayers.length === 1) {
          updateData.winnerId = activePlayers[0].id;
          updateData.winnerIds = [activePlayers[0].id];
        }
        updateData.votingOpen = false;
        updateData.confirmedAt = serverTimestamp();

        statsHand = { ...hand, pots: calcPots, handContributions: hand.handContributions };
        statsPlayers = plyrsData.map(p => ({ id: p.id, isFolded: p.isFolded }));
      } else if (hand.isVirtualCards && hand.playerHands && hand.communityCards && hand.communityCards.length === 5) {
        // Carte virtuali con 2+ giocatori: auto-valutazione
        const evalResult = autoEvaluateShowdown(
          calcPots,
          hand.playerHands,
          hand.communityCards,
          plyrsData
        );
        Object.assign(updateData, evalResult);
        (evalResult.winnerIds as string[] || []).forEach((id: string) => stackChangedIds.add(id));

        statsHand = { ...hand, pots: updateData.pots || calcPots, handContributions: hand.handContributions, handResults: updateData.handResults };
        statsPlayers = plyrsData.map(p => ({ id: p.id, isFolded: p.isFolded }));
      } else {
        // Carte fisiche: flusso manuale con votazione
        const allPotsSettled = calcPots.every(p => p.settled);

        if (allPotsSettled) {
          calcPots.forEach(pt => {
            if (pt.settled && pt.winners && pt.winners.length > 0) {
              const shares = splitPot(pt.amount, pt.winners.length);
              pt.winners.forEach((wid, i) => {
                const w = plyrsData.find(p => p.id === wid);
                if (w) {
                  w.stack += shares[i];
                  stackChangedIds.add(wid);
                }
              });
            }
          });
          updateData.votingOpen = false;
          updateData.confirmedAt = serverTimestamp();
        } else {
          // Accredita solo i pots auto-settled
          calcPots.forEach(pt => {
            if (pt.settled && pt.winners && pt.winners.length === 1) {
              const w = plyrsData.find(p => p.id === pt.winners![0]);
              if (w) {
                w.stack += pt.amount;
                stackChangedIds.add(pt.winners![0]);
              }
            }
          });
          updateData.votingOpen = true;
          updateData.winnerIds = [];
        }

        // Se la mano si è conclusa (tutti i piatti settlati automatici)
        if (updateData.confirmedAt) {
          statsHand = { ...hand, pots: calcPots, handContributions: hand.handContributions };
          statsPlayers = plyrsData.map(p => ({ id: p.id, isFolded: p.isFolded }));
        }
      }
    }

    // ===== LETTURA (2): documenti /users/{id} necessari per le statistiche =====
    let statsUserSnaps: Map<string, any> | null = null;
    if (statsHand && statsPlayers) {
      const candidateIds = getStatsCandidateIds(statsHand, statsPlayers);
      const snaps = await Promise.all(candidateIds.map((id) => transaction.get(doc(db, "users", id))));
      statsUserSnaps = new Map(candidateIds.map((id, i) => [id, snaps[i]]));
    }

    // ===== SCRITTURA =====
    stackChangedIds.forEach((id) => {
      const p = plyrsData.find(pp => pp.id === id);
      if (p) transaction.update(p.ref, { stack: p.stack });
    });

    if (statsHand && statsPlayers && statsUserSnaps) {
      applyStatsUpdates(transaction, statsHand, statsPlayers, statsUserSnaps);
    }

    transaction.update(handRef, updateData);
  });
}

export function calculatePotsCore(players: {id: string, isFolded: boolean}[], contributions: Record<string, number>): Pot[] {
  // Discard amounts of 0
  const amounts = Object.values(contributions).filter(v => v > 0).sort((a,b) => a - b);
  const sortedAmounts = [...new Set(amounts)];
  
  let previousAmount = 0;
  const pots: Pot[] = [];
  let potIdx = 0;
  
  for (const amount of sortedAmounts) {
    const delta = amount - previousAmount;
    if (delta <= 0) continue;
    
    // Who contributed at least `amount`?
    const contributors = Object.keys(contributions).filter(id => contributions[id] >= amount);
    if (contributors.length === 0) break;
    
    const potSize = delta * contributors.length;
    
    // Who is eligible?
    const eligible = contributors.filter(id => {
      const p = players.find(p => p.id === id);
      return p && !p.isFolded;
    });
    
    pots.push({
      id: `pot-${potIdx++}`,
      amount: potSize,
      eligible,
      settled: eligible.length <= 1,
      winners: eligible.length === 1 ? [eligible[0]] : []
    });
    
    previousAmount = amount;
  }
  
  return pots;
}

/**
 * DEPRECATA: Usa confirmWinners() invece.
 * Mantenuta per retrocompatibilità con componenti esistenti.
 */
export async function voteWinner(
  tableId: string,
  user: User,
  votedUserId: string
) {
  // Delega a confirmWinners con un singolo vincitore (fallback mode svuotando il potId)
  return confirmWinners(tableId, user, [votedUserId], "");
}


/**
 * Permette all'host di confermare il/i vincitore/i della mano.
 * Se ci sono più vincitori, il piatto viene diviso equamente tra loro.
 * 
 * @param tableId - ID del tavolo
 * @param user - Utente che conferma (deve essere l'host)
 * @param winnerIds - Array di userId dei vincitori selezionati
 */
export async function confirmWinners(
  tableId: string,
  user: User,
  winnerIds: string[],
  potId: string
) {
  if (!winnerIds || winnerIds.length === 0) {
    throw new Error("Devi selezionare almeno un vincitore.");
  }

  const tableRef = doc(db, "tables", tableId);

  const playersRef = collection(db, "tables", tableId, "players");
  const playersSnapOuter = await getDocs(playersRef);
  const playerRefs = playersSnapOuter.docs.map((d) => d.ref);

  await runTransaction(db, async (transaction) => {
    // ===== LETTURA =====
    const tableSnap = await transaction.get(tableRef);
    if (!tableSnap.exists()) throw new Error("Tavolo inesistente.");
    const tableData = tableSnap.data() as any;

    // Solo l'host può confermare i vincitori
    if (tableData.hostId !== user.uid) {
      throw new Error("Solo l'host può confermare i vincitori.");
    }

    const currentHandId = tableData.currentHandId;
    if (!currentHandId) throw new Error("Nessuna mano corrente.");

    const handRef = doc(db, "tables", tableId, "hands", currentHandId);
    const handSnap = await transaction.get(handRef);
    if (!handSnap.exists()) throw new Error("Mano non trovata.");

    const hand = handSnap.data() as any as HandData;

    if (hand.stage !== "SHOWDOWN") {
      throw new Error("Puoi confermare i vincitori solo durante lo SHOWDOWN.");
    }

    const playerSnaps = await Promise.all(playerRefs.map((r) => transaction.get(r)));
    const players = playerSnaps.map((d) => ({
      id: d.id,
      ref: d.ref,
      data: d.data() as any
    }));

    // ===== CALCOLO (pura logica in memoria, nessuna scrittura ancora) =====

    // Verifica che i vincitori selezionati siano giocatori validi e non foldati
    const validPlayerIds = players.map(p => p.id);
    const invalidWinners = winnerIds.filter(id => !validPlayerIds.includes(id));

    if (invalidWinners.length > 0) {
      throw new Error("Uno o più vincitori selezionati non sono giocatori validi.");
    }

    // Verifica che nessun vincitore abbia foldato
    const foldedWinners = winnerIds.filter(id => {
      const p = players.find(player => player.id === id);
      return p ? p.data.isFolded : false;
    });

    if (foldedWinners.length > 0) {
      throw new Error("Uno o più vincitori selezionati hanno foldato.");
    }

    const rawPots = hand.pots || [];
    let pots: Pot[] = rawPots;

    // Se pots è vuoto ma abbiamo handContributions, ricalcoliamo i pots al volo
    if (pots.length === 0 && hand.handContributions && Object.keys(hand.handContributions).length > 0) {
      pots = calculatePotsCore(
        players.map(p => ({ id: p.id, isFolded: p.data.isFolded })),
        hand.handContributions
      );
    }

    const currentPotIndex = pots.findIndex((p: Pot) => p.id === potId);

    const stackChangedIds = new Set<string>();
    const eliminatedIds: string[] = [];
    const eliminatedAtTimestamp = Date.now();
    let handUpdate: any;
    let statsHand: HandData | null = null;
    let statsPlayers: { id: string; isFolded: boolean }[] | null = null;

    if (currentPotIndex === -1) {
      // Fallback legacy: nessun pot strutturato disponibile, usa il pot totale grezzo
      const pot = hand.pot || 0;
      const shares = splitPot(pot, winnerIds.length);
      winnerIds.forEach((wId, i) => {
        const w = players.find(p => p.id === wId);
        if (w) {
          const cStack = Number(w.data.stack) || 0;
          w.data.stack = cStack + shares[i];
          stackChangedIds.add(wId);
        }
      });

      handUpdate = {
        winnerIds: winnerIds,
        votingOpen: false,
        confirmedAt: serverTimestamp()
      };
      if (winnerIds.length === 1) handUpdate.winnerId = winnerIds[0];

      const simulatedPots: Pot[] = [{
        id: "pot_legacy",
        amount: pot,
        eligible: players.map(p => p.id),
        settled: true,
        winners: winnerIds
      }];
      statsHand = { ...hand, pots: simulatedPots, handContributions: hand.handContributions };
      statsPlayers = players.map(p => ({ id: p.id, isFolded: p.data.isFolded }));
    } else {
      // LOGICA CASCADING SIDE POT

      // 1) Assegna il pot corrente richiesto dall'host
      const targetPot = pots[currentPotIndex];
      if (targetPot.settled) {
        throw new Error("Questo pot è già stato assegnato.");
      }

      const distributePot = (targetPot: Pot, wins: string[]) => {
        const shares = splitPot(targetPot.amount, wins.length);
        wins.forEach((wId, i) => {
          const w = players.find(p => p.id === wId);
          if (w) {
            w.data.stack = (Number(w.data.stack) || 0) + shares[i];
            stackChangedIds.add(wId);
          }
        });
        targetPot.settled = true;
        targetPot.winners = wins;
      };

      distributePot(targetPot, winnerIds);

      let currentWinners = [...winnerIds];

      // 2) Cascading sui pots successivi
      for (let i = currentPotIndex + 1; i < pots.length; i++) {
        const nextPot = pots[i];
        if (nextPot.settled) continue;

        const intersection = currentWinners.filter(id => nextPot.eligible.includes(id));
        if (intersection.length > 0) {
          // I vincitori precedenti sono idonei a questo secondary pot! Lo vincono senza chiedere manuale!
          distributePot(nextPot, intersection);
          currentWinners = intersection;
        } else {
          // Nessuno dei vincitori attuali è eligible per questo pot.
          // Dobbiamo fermare la cascata perché l'Host dovrà selezionare nuovi vincitori per questo platter.
          break;
        }
      }

      const allPotsSettled = pots.every((p: Pot) => p.settled);

      handUpdate = { pots };

      if (allPotsSettled) {
        handUpdate.votingOpen = false;
        handUpdate.confirmedAt = serverTimestamp();

        // Raccoglie tutti i winnerId unici che hanno preso almeno una fiches per salvarli su "winnerIds" globali
        const globalWinners = new Set<string>();
        pots.forEach((p: Pot) => p.winners?.forEach(w => globalWinners.add(w)));
        handUpdate.winnerIds = Array.from(globalWinners);

        if (handUpdate.winnerIds.length === 1) {
          handUpdate.winnerId = handUpdate.winnerIds[0];
        } else {
          handUpdate.winnerId = null;
        }

        // Imposta eliminatedAt per chi è a zero fiches e non l'aveva
        players.forEach(p => {
          const currentStack = Number(p.data.stack) || 0;
          if (currentStack === 0 && !p.data.eliminatedAt) {
            eliminatedIds.push(p.id);
          }
        });

        statsHand = { ...hand, pots, handContributions: hand.handContributions };
        statsPlayers = players.map(p => ({ id: p.id, isFolded: p.data.isFolded }));
      }
    }

    // ===== LETTURA (2): documenti /users/{id} necessari per le statistiche =====
    let statsUserSnaps: Map<string, any> | null = null;
    if (statsHand && statsPlayers) {
      const candidateIds = getStatsCandidateIds(statsHand, statsPlayers);
      const snaps = await Promise.all(candidateIds.map((id) => transaction.get(doc(db, "users", id))));
      statsUserSnaps = new Map(candidateIds.map((id, i) => [id, snaps[i]]));
    }

    // ===== SCRITTURA =====
    stackChangedIds.forEach((id) => {
      const w = players.find(p => p.id === id);
      if (w) transaction.update(w.ref, { stack: w.data.stack });
    });

    eliminatedIds.forEach((id) => {
      const p = players.find(pp => pp.id === id);
      if (p) transaction.update(p.ref, { eliminatedAt: eliminatedAtTimestamp });
    });

    if (statsHand && statsPlayers && statsUserSnaps) {
      applyStatsUpdates(transaction, statsHand, statsPlayers, statsUserSnaps);
    }

    transaction.update(handRef, handUpdate);
  });
}

/**
 * Trasferisce il ruolo di host a un altro giocatore.
 */
export async function transferHost(tableId: string, currentUser: User, targetUserId: string) {
  const tableRef = doc(db, "tables", tableId);
  const tableSnap = await getDoc(tableRef);
  if (!tableSnap.exists()) throw new Error("Tavolo inesistente.");
  
  const data = tableSnap.data();
  if (data.hostId !== currentUser.uid) {
    throw new Error("Solo l'host attuale può cedere il ruolo.");
  }

  await updateDoc(tableRef, { hostId: targetUserId });
}

/**
 * Elimina completamente l'account dell'utente:
 * - Rimuove tutte le subcollection Firestore note (invitations, friends, invites)
 * - Elimina il documento principale dell'utente in /users/{uid}
 * - Elimina l'account Firebase Auth
 */
export async function deleteAccount(user: User): Promise<void> {
  const uid = user.uid;
  const userRef = doc(db, "users", uid);

  // Helper: elimina tutti i doc di una subcollection
  async function deleteSubcollection(subcollectionName: string) {
    const colRef = collection(db, "users", uid, subcollectionName);
    const snap = await getDocs(colRef);
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  // 1. Cancella subcollections note
  await Promise.all([
    deleteSubcollection("invitations"),
    deleteSubcollection("invites"),
    deleteSubcollection("friends"),
    deleteSubcollection("notifications"),
  ]);

  // 2. Cancella il documento principale dell'utente
  await deleteDoc(userRef);

  // 3. Cancella l'account Firebase Auth
  // Nota: se la sessione è troppo vecchia Firebase richiede re-autenticazione
  // (errore auth/requires-recent-login) — il chiamante deve gestirlo
  await deleteUser(user);
}