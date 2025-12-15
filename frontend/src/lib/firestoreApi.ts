import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  orderBy,
  updateDoc,
  writeBatch,
  where,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "./firebase";

export interface CreateTableInput {
  name: string;
  password?: string;
  initialStack: number;
  smallBlind: number;
  bigBlind: number;
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
  totalBets: Record<string, number>; // Totale puntato in tutta la mano (per side pot)
  allInPlayers: string[]; // Array di userId dei giocatori all-in
  firstToActIndex: number;
  lastAggressorIndex?: number;
  votingOpen?: boolean;
  winnerId?: string | null; // Per retrocompatibilità (singolo vincitore)
  winnerIds?: string[]; // Array di vincitori (per split pot)
  confirmedAt?: any; // Timestamp di conferma
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
    endedAt: null,
    currentHandId: null,
  });

  // Aggiunge subito l'host come giocatore seduto al tavolo (seatIndex 0)
  const playerRef = doc(db, "tables", tableId, "players", uid);
  await setDoc(playerRef, {
    userId: uid,
    displayName: user.displayName,
    stack: data.initialStack,
    seatIndex: 0,
    isReady: false,
    isFolded: false,
    isSittingOut: false,
    joinedAt: serverTimestamp(),
  });

  return tableId;
}

/**
 * Entra in un tavolo esistente aggiungendo il giocatore se non è già seduto.
 */
export async function joinTable(
  tableId: string,
  user: User | null,
  password?: string
) {
  if (!user) throw new Error("User non presente durante il join del tavolo");

  const tableRef = doc(db, "tables", tableId);
  const snap = await getDoc(tableRef);

  if (!snap.exists()) {
    throw new Error("Il tavolo non esiste");
  }

  const data = snap.data() as any;

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
    displayName: user.displayName,
    stack: initialStack,
    seatIndex,
    isReady: false,
    isFolded: false,
    joinedAt: serverTimestamp(),
  });
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
  const playersRef = collection(db, "tables", tableId, "players");
  const q = query(playersRef, where("userId", "==", user.uid));
  const snap = await getDocs(q);

  const batch = writeBatch(db);
  snap.forEach((docSnap) => {
    batch.delete(docSnap.ref);
  });

  await batch.commit();
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
export async function startGame(tableId: string) {
  const tableRef = doc(db, "tables", tableId);
  const tableSnap = await getDoc(tableRef);

  if (!tableSnap.exists()) {
    throw new Error("Tavolo inesistente");
  }

  const tableData = tableSnap.data() as any;

  if (tableData.state !== "LOBBY") {
    throw new Error("La partita è già iniziata o il tavolo non è in LOBBY");
  }

  const playersRef = collection(db, "tables", tableId, "players");
  const playersQuery = query(playersRef, orderBy("seatIndex", "asc"));
  const playersSnap = await getDocs(playersQuery);

  const players = playersSnap.docs.map((d) => {
    const data = d.data() as any;
    return {
      id: d.id,
      ref: d.ref,
      ...data,
    };
  });

  if (players.length < 2) {
    throw new Error("Servono almeno 2 giocatori per iniziare");
  }

  const numPlayers = players.length;
  const sbAmount = Number(tableData.smallBlind) || 0;
  const bbAmount = Number(tableData.bigBlind) || 0;

  let dealerIndex: number;
  let smallBlindIndex: number;
  let bigBlindIndex: number;
  let firstToActIndex: number;

  // CASO HEADS-UP (2 giocatori): player 0 = BB, player 1 = SB/Dealer
  if (numPlayers === 2) {
    dealerIndex = 1; // giocatore 1 è dealer e SB
    smallBlindIndex = 1; // stesso giocatore
    bigBlindIndex = 0; // giocatore 0 è BB
    firstToActIndex = 1; // SB/Dealer agisce per primo preflop in heads-up
  }
  // CASO 3+ GIOCATORI: player 0 = Dealer, 1 = SB, 2 = BB
  else {
    dealerIndex = 0;
    smallBlindIndex = 1;
    bigBlindIndex = 2;
    firstToActIndex = (bigBlindIndex + 1) % numPlayers; // UTG (giocatore dopo BB)
  }

  const currentTurnIndex = firstToActIndex;

  let pot = 0;
  let currentBet = 0;
  const roundBets: Record<string, number> = {};

  // Piazziamo le blind
  const sbPlayer = players[smallBlindIndex];
  const bbPlayer = players[bigBlindIndex];

  if (sbAmount > 0) {
    roundBets[sbPlayer.id] = sbAmount;
    pot += sbAmount;
  }

  if (bbAmount > 0) {
    roundBets[bbPlayer.id] = (roundBets[bbPlayer.id] || 0) + bbAmount;
    pot += bbAmount;
    currentBet = bbAmount;
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
    totalBets: { ...roundBets }, // Inizializza con le blind
    allInPlayers: [], // Nessuno all-in inizialmente
    firstToActIndex,
    lastAggressorIndex: bigBlindIndex, // Il BB è l'aggressore iniziale preflop
  };

  // Crea una nuova hand nella subcollection "hands"
  const handsRef = collection(db, "tables", tableId, "hands");
  const handRef = await addDoc(handsRef, {
    ...handData,
    createdAt: serverTimestamp(),
  });

  // Aggiorna il tavolo: IN_GAME + currentHandId
  await updateDoc(tableRef, {
    state: "IN_GAME",
    currentHandId: handRef.id,
  });

  // Reset isReady di tutti i giocatori e scala le blind dagli stack
  const batch = writeBatch(db);
  players.forEach((p, index) => {
    let newStack = Number(p.stack) || 0;

    if (index === smallBlindIndex && sbAmount > 0) {
      newStack = Math.max(0, newStack - sbAmount);
    }
    if (index === bigBlindIndex && bbAmount > 0) {
      newStack = Math.max(0, newStack - bbAmount);
    }

    batch.update(p.ref, {
      isReady: false,
      stack: newStack,
      isFolded: false,
    });
  });

  await batch.commit();
}

/**
 * Scambia i seatIndex di due giocatori (usato dall'host per riordinare).
 */
export async function swapSeats(
  tableId: string,
  playerAId: string,
  playerBId: string,
  seatA: number,
  seatB: number
) {
  const playerARef = doc(db, "tables", tableId, "players", playerAId);
  const playerBRef = doc(db, "tables", tableId, "players", playerBId);

  const batch = writeBatch(db);
  batch.update(playerARef, { seatIndex: seatB });
  batch.update(playerBRef, { seatIndex: seatA });

  await batch.commit();
}

export async function setSittingOut(
  tableId: string,
  user: User,
  isSittingOut: boolean
) {
  const playersRef = collection(db, "tables", tableId, "players");
  const q = query(playersRef, where("userId", "==", user.uid));
  const snap = await getDocs(q);

  const batch = writeBatch(db);
  snap.forEach((docSnap) => {
    batch.update(docSnap.ref, { isSittingOut });
  });

  await batch.commit();
}

export async function endGame(tableId: string) {
  const tableRef = doc(db, "tables", tableId);
  await updateDoc(tableRef, {
    state: "SUMMARY",
    endedAt: serverTimestamp(),
  });
}

/**
 * Avvia una nuova mano dopo che la precedente è terminata (showdown completato).
 * Ruota dealer, SB e BB di uno rispetto alla mano precedente.
 */
export async function startNextHand(tableId: string, user: User) {
  const tableRef = doc(db, "tables", tableId);
  const tableSnap = await getDoc(tableRef);
  if (!tableSnap.exists()) throw new Error("Tavolo inesistente.");
  const tableData = tableSnap.data() as any;

  if (tableData.hostId !== user.uid) {
    throw new Error("Solo l'host può avviare la mano successiva.");
  }

  if (tableData.state !== "IN_GAME") {
    throw new Error("Il tavolo non è in stato di gioco.");
  }

  const prevHandId: string | null = tableData.currentHandId ?? null;
  if (!prevHandId) throw new Error("Nessuna mano precedente trovata.");

  const prevHandRef = doc(db, "tables", tableId, "hands", prevHandId);
  const prevHandSnap = await getDoc(prevHandRef);
  if (!prevHandSnap.exists()) throw new Error("Mano precedente non trovata.");

  const prevHand = prevHandSnap.data() as any as HandData;
  if (prevHand.stage !== "SHOWDOWN") {
    throw new Error("La mano corrente non è ancora in SHOWDOWN.");
  }

  // Prendiamo i giocatori ordinati per seatIndex
  const playersRef = collection(db, "tables", tableId, "players");
  const playersQuery = query(playersRef, orderBy("seatIndex", "asc"));
  const playersSnap = await getDocs(playersQuery);
  const players = playersSnap.docs.map((d) => {
    const data = d.data() as any;
    return {
      id: d.id,
      ref: d.ref,
      stack: Number(data.stack) || 0,
      seatIndex: data.seatIndex,
      isFolded: !!data.isFolded,
      isSittingOut: !!data.isSittingOut,
    };
  });

  if (players.length < 2) {
    throw new Error("Servono almeno 2 giocatori per una nuova mano.");
  }

  const numPlayers = players.length;
  const sbAmount = Number(tableData.smallBlind) || 0;
  const bbAmount = Number(tableData.bigBlind) || 0;

  // Ruotiamo dealer, SB e BB di uno rispetto alla mano precedente
  let dealerIndex: number;
  let smallBlindIndex: number;
  let bigBlindIndex: number;
  let firstToActIndex: number;

  if (numPlayers === 2) {
    // Heads-up: ruotiamo semplicemente i ruoli
    dealerIndex = (prevHand.dealerIndex + 1) % numPlayers;
    smallBlindIndex = dealerIndex;
    bigBlindIndex = (dealerIndex + 1) % numPlayers;
    firstToActIndex = smallBlindIndex;
  } else {
    dealerIndex = (prevHand.dealerIndex + 1) % numPlayers;
    smallBlindIndex = (dealerIndex + 1) % numPlayers;
    bigBlindIndex = (dealerIndex + 2) % numPlayers;
    firstToActIndex = (bigBlindIndex + 1) % numPlayers;
  }

  let pot = 0;
  let currentBet = 0;
  const roundBets: Record<string, number> = {};

  const sbPlayer = players[smallBlindIndex];
  const bbPlayer = players[bigBlindIndex];

  if (sbAmount > 0) {
    roundBets[sbPlayer.id] = sbAmount;
    pot += sbAmount;
  }

  if (bbAmount > 0) {
    roundBets[bbPlayer.id] = (roundBets[bbPlayer.id] || 0) + bbAmount;
    pot += bbAmount;
    currentBet = bbAmount;
  }

  const handsRef = collection(db, "tables", tableId, "hands");

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
    totalBets: { ...roundBets }, // Inizializza con le blind
    allInPlayers: [], // Reset all-in per nuova mano
    firstToActIndex,
    lastAggressorIndex: bigBlindIndex,
  };

  const newHandRef = await addDoc(handsRef, {
    ...newHand,
    createdAt: serverTimestamp(),
  });

  const batch = writeBatch(db);

  // Aggiorniamo il tavolo con la nuova mano corrente
  batch.update(tableRef, {
    currentHandId: newHandRef.id,
  });

  // Reset stato giocatori per la nuova mano (isFolded false)
  players.forEach((p, index) => {
    let newStack = p.stack;

    if (index === smallBlindIndex && sbAmount > 0) {
      newStack = Math.max(0, newStack - sbAmount);
    }
    if (index === bigBlindIndex && bbAmount > 0) {
      newStack = Math.max(0, newStack - bbAmount);
    }

    batch.update(p.ref, {
      isFolded: false,
      stack: newStack,
    });
  });

  await batch.commit();
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
  const tableSnap = await getDoc(tableRef);

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
  const handSnap = await getDoc(handRef);

  if (!handSnap.exists()) {
    throw new Error("La mano corrente non esiste");
  }

  const handData = handSnap.data() as any as HandData;

  let lastAggressorIndex: number =
    handData.lastAggressorIndex ?? handData.bigBlindIndex;

  if (handData.currentTurnIndex == null || handData.currentTurnIndex < 0) {
    throw new Error("Non è il turno di nessuno al momento");
  }

  // Prendiamo i giocatori in ordine di seatIndex
  const playersRef = collection(db, "tables", tableId, "players");
  const q = query(playersRef, orderBy("seatIndex", "asc"));
  const playersSnap = await getDocs(q);

  const players = playersSnap.docs.map((d) => {
    const data = d.data() as any;
    return {
      id: d.id,
      ref: d.ref,
      userId: data.userId,
      displayName: data.displayName,
      stack: Number(data.stack) || 0,
      seatIndex: data.seatIndex,
      isFolded: !!data.isFolded,
      isSittingOut: !!data.isSittingOut,
    };
  });

  if (players.length === 0) {
    throw new Error("Nessun giocatore al tavolo");
  }

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

  // Round bets e total bets
  const roundBets: Record<string, number> = {
    ...(handData.roundBets || {}),
  };
  const totalBets: Record<string, number> = {
    ...(handData.totalBets || {}),
  };
  const allInPlayers: string[] = handData.allInPlayers || [];

  const myBet = roundBets[user.uid] || 0;
  let pot = handData.pot;
  let currentBet = handData.currentBet;

  // Helper per trovare il prossimo giocatore attivo (salta all-in e folded)
  function getNextActiveIndex(fromIndex: number): number {
    for (let i = 1; i <= numPlayers; i++) {
      const idx = (fromIndex + i) % numPlayers;
      const p = players[idx];
      const isAllIn = allInPlayers.includes(p.userId);
      if (!p.isFolded && !p.isSittingOut && !isAllIn && p.stack > 0) {
        return idx;
      }
    }
    return -1;
  }

  function getPreviousActiveIndex(fromIndex: number): number {
    for (let i = 1; i <= numPlayers; i++) {
      const idx = (fromIndex - i + numPlayers) % numPlayers;
      const p = players[idx];
      const isAllIn = allInPlayers.includes(p.userId);
      if (!p.isFolded && !p.isSittingOut && !isAllIn && p.stack > 0) {
        return idx;
      }
    }
    return -1;
  }

  // Eseguiamo l'azione
  let wentAllIn = false;

  switch (action) {
    case "CHECK": {
      if (myBet !== currentBet) {
        throw new Error("Non puoi fare check: devi ancora coprire la puntata.");
      }
      // Registra il check nel roundBets (importante per la logica di chiusura round)
      roundBets[user.uid] = myBet;
      break;
    }

    case "CALL": {
      if (currentBet <= myBet) {
        throw new Error("Niente da chiamare.");
      }

      const diff = currentBet - myBet;

      // Gestione all-in: se non ha abbastanza per callare, va all-in
      if (currentPlayer.stack < diff) {
        const allInAmount = myBet + currentPlayer.stack;
        roundBets[user.uid] = allInAmount;
        totalBets[user.uid] = (totalBets[user.uid] || 0) + currentPlayer.stack;
        pot += currentPlayer.stack;
        currentPlayer.stack = 0;
        wentAllIn = true;
      } else {
        roundBets[user.uid] = currentBet;
        totalBets[user.uid] = (totalBets[user.uid] || 0) + diff;
        pot += diff;
        currentPlayer.stack -= diff;
      }
      break;
    }

    case "BET": {
      const target = Number(amount);
      if (!target || target <= 0) {
        throw new Error("Importo bet/raise non valido.");
      }

      const maxFinal = myBet + currentPlayer.stack;
      if (target > maxFinal) {
        throw new Error("Non puoi puntare più del tuo stack.");
      }

      // Validazione minimo raise
      if (currentBet > 0 && target <= currentBet) {
        throw new Error(
          "Il raise deve essere maggiore della puntata corrente."
        );
      }

      const diff = target - myBet;
      if (diff <= 0) {
        throw new Error(
          "La nuova puntata deve aumentare il totale che hai investito."
        );
      }

      roundBets[user.uid] = target;
      totalBets[user.uid] = (totalBets[user.uid] || 0) + diff;
      pot += diff;
      currentPlayer.stack -= diff;

      // Se ha puntato tutto, è all-in
      if (currentPlayer.stack === 0) {
        wentAllIn = true;
      } else {
        // Solo se non è all-in diventa l'aggressore (un all-in non riapre il betting)
        if (target > currentBet) {
          currentBet = target;
          lastAggressorIndex = currentIndex;
        }
      }

      break;
    }

    case "FOLD": {
      currentPlayer.isFolded = true;
      break;
    }

    default:
      throw new Error("Azione non supportata");
  }

  // Se il giocatore è andato all-in, aggiungilo alla lista
  if (wentAllIn && !allInPlayers.includes(user.uid)) {
    allInPlayers.push(user.uid);
  }

  // Giocatori che possono ancora agire (non folded, not sitting out, not all-in)
  const activePlayers = players.filter((p) => !p.isFolded && !p.isSittingOut);

  // Giocatori che possono ancora fare betting (esclude all-in)
  const bettingPlayers = activePlayers.filter(
    (p) => !allInPlayers.includes(p.userId) && p.stack > 0
  );

  let newStage = handData.stage;
  let nextTurnIndex = getNextActiveIndex(currentIndex);
  let autoWinnerId: string | null = null;

  // Se rimane solo 1 giocatore attivo (o meno), andiamo subito a SHOWDOWN
  if (activePlayers.length <= 1) {
    newStage = "SHOWDOWN";
    nextTurnIndex = -1;

    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      winner.stack += pot;
      autoWinnerId = winner.userId;
    }
  }
  // Se rimane solo 1 giocatore che può fare betting (tutti gli altri all-in), vai a SHOWDOWN
  else if (bettingPlayers.length <= 1) {
    newStage = "SHOWDOWN";
    nextTurnIndex = -1;
  }
  // Altrimenti verifichiamo se il round di betting è completo
  else if (bettingPlayers.length > 1) {
    // Tutti i giocatori che possono agire devono aver agito E matched la puntata
    const allMatched = bettingPlayers.every((p) => {
      const b = roundBets[p.userId];
      // Il giocatore deve aver agito (b !== undefined) E aver matched il currentBet
      return b !== undefined && b === currentBet;
    });

    if (allMatched) {
      // PREFLOP: regole speciali
      if (handData.stage === "PREFLOP") {
        // Contiamo quanti giocatori possono ancora agire
        if (bettingPlayers.length === 1) {
          // Solo un giocatore può agire: chiudi il round
          nextTurnIndex = -1;
        } else if (
          lastAggressorIndex !== undefined &&
          lastAggressorIndex !== handData.bigBlindIndex
        ) {
          // C'è stato un raise dopo il BB (da un altro giocatore)
          // Il round chiude quando tutti dopo il raiser hanno agito (callato/foldato)
          const closerIndex = getPreviousActiveIndex(lastAggressorIndex);
          if (closerIndex !== -1 && currentIndex === closerIndex) {
            nextTurnIndex = -1;
          }
        } else {
          // lastAggressorIndex === bigBlindIndex o undefined
          // Dobbiamo verificare se il BB ha raisato o no
          const bbAmount = Number(tableData.bigBlind) || 0;

          if (currentBet > bbAmount) {
            // Il BB ha raisato: il round chiude quando il giocatore prima del BB ha agito
            const closerIndex = getPreviousActiveIndex(handData.bigBlindIndex);
            if (closerIndex !== -1 && currentIndex === closerIndex) {
              nextTurnIndex = -1;
            }
          } else {
            // Nessun raise o solo il blind del BB
            // Il BB ha l'opzione di checkare: chiude quando il BB checka
            const bbPlayer = players[handData.bigBlindIndex];
            const bbIsActive =
              !bbPlayer.isFolded &&
              !bbPlayer.isSittingOut &&
              !allInPlayers.includes(bbPlayer.userId);

            if (bbIsActive && currentIndex === handData.bigBlindIndex) {
              // Il BB ha appena agito: se ha checkato, chiudi
              const bbBet = roundBets[bbPlayer.userId] || 0;
              if (bbBet === currentBet) {
                nextTurnIndex = -1;
              }
            } else if (!bbIsActive) {
              // Il BB non può agire (folded/all-in): chiudi quando siamo tornati al BB
              if (
                currentIndex === handData.bigBlindIndex ||
                currentIndex === getPreviousActiveIndex(handData.bigBlindIndex)
              ) {
                nextTurnIndex = -1;
              }
            }
          }
        }
      }
      // POST-FLOP: regole normali
      else {
        if (currentBet === 0) {
          // Tutti hanno checkato: chiude quando il giocatore prima del firstToAct checka
          const beforeFirst = getPreviousActiveIndex(handData.firstToActIndex);
          if (beforeFirst !== -1 && currentIndex === beforeFirst) {
            nextTurnIndex = -1;
          }
        } else {
          // C'è stata aggressione: chiude quando il giocatore prima dell'aggressore calla
          if (lastAggressorIndex !== undefined) {
            const closerIndex = getPreviousActiveIndex(lastAggressorIndex);
            if (closerIndex !== -1 && currentIndex === closerIndex) {
              nextTurnIndex = -1;
            }
          }
        }
      }
    }
  }
  // Se non ci sono betting players ma ci sono all-in, vai a showdown
  else {
    newStage = "SHOWDOWN";
    nextTurnIndex = -1;
  }

  // Applichiamo gli update
  const batch = writeBatch(db);

  // Aggiorna i player (stack + isFolded)
  players.forEach((p) => {
    const ref = p.ref;
    const isFolded = p.isFolded;
    const newStack = p.stack;
    batch.update(ref, {
      isFolded,
      stack: newStack,
    });
  });

  // Aggiorna la hand
  const handUpdate: any = {
    pot,
    currentBet,
    roundBets,
    totalBets,
    allInPlayers,
    currentTurnIndex: nextTurnIndex,
    stage: newStage,
    lastAggressorIndex,
  };

  // Se siamo andati in SHOWDOWN per fold e c'è un solo vincitore,
  // impostiamo il winnerId direttamente (senza votazione)
  if (newStage === "SHOWDOWN" && autoWinnerId) {
    handUpdate.winnerId = autoWinnerId;
    handUpdate.winnerIds = [autoWinnerId];
    handUpdate.votingOpen = false;
    handUpdate.confirmedAt = serverTimestamp();
  }
  // Se siamo andati in SHOWDOWN ma ci sono più giocatori attivi (side pot scenario),
  // apriamo la votazione per selezionare i vincitori
  else if (newStage === "SHOWDOWN" && !autoWinnerId) {
    handUpdate.votingOpen = true;
    handUpdate.winnerIds = [];
  }

  batch.update(handRef, handUpdate);

  await batch.commit();
}

/**
 * Avanza la mano allo stage successivo (PREFLOP -> FLOP -> TURN -> RIVER -> SHOWDOWN).
 *
 * IMPORTANTE: Post-flop, la prima mossa è SEMPRE dello SB (o del primo giocatore
 * attivo dopo lo SB se lo SB ha foldato).
 */
export async function advanceStage(tableId: string, user: User) {
  const tableRef = doc(db, "tables", tableId);
  const tableSnap = await getDoc(tableRef);
  if (!tableSnap.exists()) throw new Error("Tavolo inesistente.");
  const tableData = tableSnap.data() as any;

  if (tableData.hostId !== user.uid) {
    throw new Error("Solo l'host può avanzare la mano.");
  }

  const currentHandId = tableData.currentHandId;
  if (!currentHandId) throw new Error("Nessuna mano corrente.");

  const handRef = doc(db, "tables", tableId, "hands", currentHandId);
  const handSnap = await getDoc(handRef);
  if (!handSnap.exists()) throw new Error("Mano non trovata.");

  const hand = handSnap.data() as any as HandData;

  let nextStage: HandData["stage"] = hand.stage;
  if (hand.stage === "PREFLOP") nextStage = "FLOP";
  else if (hand.stage === "FLOP") nextStage = "TURN";
  else if (hand.stage === "TURN") nextStage = "RIVER";
  else if (hand.stage === "RIVER") nextStage = "SHOWDOWN";
  else throw new Error("La mano è già in SHOWDOWN.");

  let firstToActIndex = hand.firstToActIndex;
  let lastAggressorIndex: number | undefined = undefined;

  if (nextStage !== "SHOWDOWN") {
    const playersRef = collection(db, "tables", tableId, "players");
    const q = query(playersRef, orderBy("seatIndex", "asc"));
    const playersSnap = await getDocs(q);
    const players = playersSnap.docs.map((d) => {
      const data = d.data() as any;
      return {
        seatIndex: data.seatIndex,
        isFolded: !!data.isFolded,
        isSittingOut: !!data.isSittingOut,
      };
    });

    const n = players.length;

    // POST-FLOP: la prima mossa è SEMPRE dello SB (o SB+1 se ha foldato)
    // Questo vale per FLOP, TURN e RIVER
    let startIndex = hand.smallBlindIndex % n;

    // Troviamo il primo giocatore attivo partendo da SB
    let idx = startIndex;
    for (let i = 0; i < n; i++) {
      const p = players[idx];
      if (!p.isFolded && !p.isSittingOut) {
        firstToActIndex = idx;
        break;
      }
      idx = (idx + 1) % n;
    }

    // All'inizio di un nuovo stage, non c'è ancora un aggressore
    // Impostiamo lastAggressorIndex al giocatore prima del firstToAct
    // così la logica di chiusura funziona correttamente
    for (let i = 1; i <= n; i++) {
      const prevIdx = (firstToActIndex - i + n) % n;
      const p = players[prevIdx];
      if (!p.isFolded && !p.isSittingOut) {
        lastAggressorIndex = prevIdx;
        break;
      }
    }
  }

  const updateData: any = {
    stage: nextStage,
    currentBet: 0,
    roundBets: {},
    currentTurnIndex: nextStage === "SHOWDOWN" ? -1 : firstToActIndex,
    firstToActIndex,
  };

  if (lastAggressorIndex !== undefined) {
    updateData.lastAggressorIndex = lastAggressorIndex;
  }

  // Se passiamo a SHOWDOWN dopo il river, apriamo la votazione
  if (hand.stage === "RIVER" && nextStage === "SHOWDOWN") {
    // Controlliamo quanti giocatori sono ancora attivi
    const playersRef = collection(db, "tables", tableId, "players");
    const playersSnap = await getDocs(playersRef);
    const activePlayers = playersSnap.docs.filter((d) => {
      const data = d.data() as any;
      return !data.isFolded && !data.isSittingOut;
    });

    // Se c'è solo un giocatore attivo, assegniamo automaticamente la vincita
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      const winnerData = winner.data() as any;
      const newStack = (Number(winnerData.stack) || 0) + (hand.pot || 0);

      // Aggiorna lo stack del vincitore
      await updateDoc(winner.ref, { stack: newStack });

      updateData.winnerId = winner.id;
      updateData.winnerIds = [winner.id]; // ✅ Aggiungi anche questo
      updateData.votingOpen = false;
      updateData.confirmedAt = serverTimestamp(); // ✅ Aggiungi anche questo
    } else {
      // Più di un giocatore: l'host dovrà confermare i vincitori
      updateData.votingOpen = true;
      updateData.winnerIds = []; // ✅ Inizializza array vuoto
    }
  }

  await updateDoc(handRef, updateData);
}

/**
 * Calcola i pot (main pot + side pot) in base alle puntate totali di ogni giocatore.
 *
 * @param players - Array di giocatori con le loro puntate totali
 * @param totalBets - Record delle puntate totali per userId
 * @returns Array di pot, ognuno con l'importo e i giocatori eleggibili
 */
interface PotInfo {
  amount: number;
  eligiblePlayers: string[]; // userId dei giocatori che possono vincere questo pot
}

function calculatePots(
  players: Array<{ userId: string; isFolded: boolean; isSittingOut: boolean }>,
  totalBets: Record<string, number>
): PotInfo[] {
  // Giocatori ancora in gioco (non folded)
  const activePlayers = players.filter((p) => !p.isFolded && !p.isSittingOut);

  if (activePlayers.length === 0) return [];
  if (activePlayers.length === 1) {
    // Un solo giocatore: vince tutto
    const totalPot = Object.values(totalBets).reduce(
      (sum, bet) => sum + bet,
      0
    );
    return [
      {
        amount: totalPot,
        eligiblePlayers: [activePlayers[0].userId],
      },
    ];
  }

  const pots: PotInfo[] = [];
  const remainingBets: Record<string, number> = { ...totalBets };
  let remainingPlayers = [...activePlayers];

  while (remainingPlayers.length > 0) {
    // Trova la puntata minima tra i giocatori rimasti
    const minBet = Math.min(
      ...remainingPlayers
        .map((p) => remainingBets[p.userId] || 0)
        .filter((bet) => bet > 0)
    );

    if (minBet <= 0) break;

    // Crea un pot con l'importo minimo da ogni giocatore rimasto
    let potAmount = 0;
    const eligiblePlayers: string[] = [];

    remainingPlayers.forEach((p) => {
      const bet = remainingBets[p.userId] || 0;
      if (bet > 0) {
        const contribution = Math.min(bet, minBet);
        potAmount += contribution;
        remainingBets[p.userId] = bet - contribution;
        eligiblePlayers.push(p.userId);
      }
    });

    if (potAmount > 0) {
      pots.push({ amount: potAmount, eligiblePlayers });
    }

    // Rimuovi i giocatori che hanno esaurito le loro chips (all-in completo)
    remainingPlayers = remainingPlayers.filter(
      (p) => (remainingBets[p.userId] || 0) > 0
    );
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
  // Delega a confirmWinners con un singolo vincitore
  return confirmWinners(tableId, user, [votedUserId]);
}

/**
 * Permette all'host di confermare il/i vincitore/i della mano.
 * Gestisce automaticamente main pot e side pot in base agli all-in.
 *
 * IMPORTANTE: winnerIds deve contenere i vincitori ordinati per forza della mano,
 * dal più forte al più debole. Il sistema distribuirà i pot di conseguenza.
 *
 * @param tableId - ID del tavolo
 * @param user - Utente che conferma (deve essere l'host)
 * @param winnerIds - Array di userId ordinati per forza mano (migliore per primo)
 */
export async function confirmWinners(
  tableId: string,
  user: User,
  winnerIds: string[]
) {
  if (!winnerIds || winnerIds.length === 0) {
    throw new Error("Devi selezionare almeno un vincitore.");
  }

  const tableRef = doc(db, "tables", tableId);
  const tableSnap = await getDoc(tableRef);
  if (!tableSnap.exists()) throw new Error("Tavolo inesistente.");

  const tableData = tableSnap.data() as any;

  if (tableData.hostId !== user.uid) {
    throw new Error("Solo l'host può confermare i vincitori.");
  }

  const currentHandId = tableData.currentHandId;
  if (!currentHandId) throw new Error("Nessuna mano corrente.");

  const handRef = doc(db, "tables", tableId, "hands", currentHandId);
  const handSnap = await getDoc(handRef);
  if (!handSnap.exists()) throw new Error("Mano non trovata.");

  const hand = handSnap.data() as any as HandData;

  if (hand.stage !== "SHOWDOWN") {
    throw new Error("Puoi confermare i vincitori solo durante lo SHOWDOWN.");
  }

  // Prendi tutti i giocatori
  const playersRef = collection(db, "tables", tableId, "players");
  const playersSnap = await getDocs(playersRef);
  const players = playersSnap.docs.map((d) => ({
    id: d.id,
    userId: d.id,
    ref: d.ref,
    data: d.data() as any,
    isFolded: !!(d.data() as any).isFolded,
    isSittingOut: !!(d.data() as any).isSittingOut,
  }));

  const validPlayerIds = players.map((p) => p.id);
  const invalidWinners = winnerIds.filter((id) => !validPlayerIds.includes(id));

  if (invalidWinners.length > 0) {
    throw new Error(
      "Uno o più vincitori selezionati non sono giocatori validi."
    );
  }

  const totalBets = hand.totalBets || {};

  // Calcola i pot (main pot + eventuali side pot)
  const pots = calculatePots(players, totalBets);

  if (pots.length === 0) {
    throw new Error("Errore nel calcolo dei pot.");
  }

  const batch = writeBatch(db);

  // Per ogni pot, trova il vincitore con la mano più forte tra quelli eleggibili
  const winningsPerPlayer: Record<string, number> = {};

  pots.forEach((pot, potIndex) => {
    // Se il pot ha solo 1 giocatore eleggibile, è automaticamente il vincitore
    if (pot.eligiblePlayers.length === 1) {
      const autoWinner = pot.eligiblePlayers[0];
      winningsPerPlayer[autoWinner] =
        (winningsPerPlayer[autoWinner] || 0) + pot.amount;
      return;
    }

    // Trova i vincitori eleggibili per questo pot (ordinati per forza mano)
    const eligibleWinners = winnerIds.filter((wId) =>
      pot.eligiblePlayers.includes(wId)
    );

    if (eligibleWinners.length === 0) {
      // Nessun vincitore eleggibile: non dovrebbe accadere, ma gestiamolo
      console.warn(`Pot ${potIndex} senza vincitori eleggibili`);
      return;
    }

    // Split pot: tutti i vincitori eleggibili dividono il pot
    // Se winnerIds contiene più giocatori, significa che hanno la stessa mano
    // e quindi dividono equamente ogni pot a cui sono eleggibili
    const potWinners = eligibleWinners;

    const sharePerWinner = Math.floor(pot.amount / potWinners.length);
    const remainder = pot.amount % potWinners.length;

    potWinners.forEach((winnerId, index) => {
      const winAmount = sharePerWinner + (index === 0 ? remainder : 0);
      winningsPerPlayer[winnerId] =
        (winningsPerPlayer[winnerId] || 0) + winAmount;
    });
  });

  // Applica le vincite agli stack dei giocatori
  Object.entries(winningsPerPlayer).forEach(([winnerId, amount]) => {
    const winner = players.find((p) => p.id === winnerId);
    if (winner) {
      const currentStack = Number(winner.data.stack) || 0;
      const newStack = currentStack + amount;
      batch.update(winner.ref, { stack: newStack });
    }
  });

  // Aggiorna la mano: imposta i vincitori e chiude la votazione
  const handUpdate: any = {
    winnerIds: winnerIds,
    votingOpen: false,
    confirmedAt: serverTimestamp(),
  };

  // Manteniamo winnerId per retrocompatibilità (primo vincitore)
  if (winnerIds.length === 1) {
    handUpdate.winnerId = winnerIds[0];
  } else {
    handUpdate.winnerId = null;
  }

  batch.update(handRef, handUpdate);

  await batch.commit();
}
