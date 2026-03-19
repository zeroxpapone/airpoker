import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../hooks/useAuth";
import {
  setPlayerReady,
  startGame,
  swapSeats,
  type HandData,
  playerAction,
  leaveTable,
  setSittingOut,
  endGame,
  advanceStage,
  confirmWinners,
  startNextHand
} from "../lib/firestoreApi";

interface TableData {
  name: string;
  state: string;
  initialStack: number;
  smallBlind: number;
  bigBlind: number;
  hostId: string;
  currentHandId: string | null;
  createdAt?: any;
  endedAt?: any;
}


interface PlayerData {
  id: string;
  displayName: string | null;
  stack: number;
  seatIndex: number;
  isReady: boolean;
  userId: string;
  isFolded: boolean;
  isSittingOut?: boolean;
}

interface ExtendedHandData extends HandData {
  votingOpen?: boolean;
  votes?: Record<string, string>;
  winnerId?: string | null;
  winnerIds?: string[];  // ✅ Aggiungi questa riga
}

export default function TablePage() {
  const { tableId: rawTableId } = useParams();
  const tableId = rawTableId?.toLowerCase();
  const { user } = useAuth();

  const [selectedWinners, setSelectedWinners] = useState<string[]>([]);
  const [table, setTable] = useState<TableData | null>(null);
  const [players, setPlayers] = useState<PlayerData[]>([]);
  const [playersLoaded, setPlayersLoaded] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [currentHand, setCurrentHand] = useState<ExtendedHandData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [showBetPanel, setShowBetPanel] = useState(false);
  const [betAmount, setBetAmount] = useState<number>(0);

  const navigate = useNavigate();

  useEffect(() => {
    if (!tableId) return;

    const tableRef = doc(db, "tables", tableId);

    const unsubTable = onSnapshot(
      tableRef,
      (snap) => {
        if (!snap.exists()) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        const data = snap.data() as any;
        setTable({
            name: data.name,
            state: data.state,
            initialStack: data.initialStack,
            smallBlind: data.smallBlind,
            bigBlind: data.bigBlind,
            hostId: data.hostId,
            currentHandId: data.currentHandId ?? null,
            createdAt: data.createdAt ?? null,
            endedAt: data.endedAt ?? null
        });

        setLoading(false);
      },
      (err) => {
        console.error("Errore nel listener del tavolo:", err);
        setLoading(false);
      }
    );

    const playersRef = collection(db, "tables", tableId, "players");
    const q = query(playersRef, orderBy("seatIndex", "asc"));
    const unsubPlayers = onSnapshot(
      q,
      (snap) => {
        const list: PlayerData[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data() as any;
          list.push({
            id: docSnap.id,
            displayName: d.displayName ?? "Giocatore",
            stack: d.stack,
            seatIndex: d.seatIndex,
            isReady: d.isReady,
            userId: d.userId,
            isFolded: !!d.isFolded,
            isSittingOut: !!d.isSittingOut
          });
        });
        setPlayers(list);
        setPlayersLoaded(true);
      },
      (err) => {
        console.error("Errore nel listener dei giocatori:", err);
      }
    );

    return () => {
      unsubTable();
      unsubPlayers();
    };
  }, [tableId]);

  // Redirezione automatica per gli spettatori
  useEffect(() => {
    if (playersLoaded && user?.uid && !players.find((p) => p.userId === user.uid) && table?.state !== "SUMMARY") {
      navigate(`/join?tableId=${tableId}`);
    }
  }, [playersLoaded, user?.uid, players, navigate, tableId, table?.state]);

  // Listener sulla mano corrente
  useEffect(() => {
    if (!tableId) return;
    if (!table?.currentHandId) {
      setCurrentHand(null);
      return;
    }

    const handRef = doc(
      db,
      "tables",
      tableId,
      "hands",
      table.currentHandId
    );

    const unsub = onSnapshot(
      handRef,
      (snap) => {
        if (!snap.exists()) {
          setCurrentHand(null);
          return;
        }
        const d = snap.data() as any;
        const hand: ExtendedHandData = {
          handNumber: d.handNumber,
          stage: d.stage,
          dealerIndex: d.dealerIndex,
          smallBlindIndex: d.smallBlindIndex,
          bigBlindIndex: d.bigBlindIndex,
          currentTurnIndex: d.currentTurnIndex,
          pot: d.pot,
          currentBet: d.currentBet,
          roundBets: d.roundBets || {},
          firstToActIndex: d.firstToActIndex ?? 0,
          votingOpen: d.votingOpen ?? false,
          votes: d.votes || {},
          winnerId: d.winnerId ?? null,
          winnerIds: d.winnerIds || [] 
        };
        setCurrentHand(hand);
      },
      (err) => {
        console.error("Errore nel listener della mano:", err);
      }
    );

    return () => {
      unsub();
    };
  }, [tableId, table?.currentHandId]);

  // Reset selezione vincitori quando cambia mano
  useEffect(() => {
    setSelectedWinners([]);
    setActionError(null);
  }, [currentHand?.handNumber]);


  if (!tableId) {
    return <p>ID tavolo mancante.</p>;
  }

  if (loading) {
    return <p>Caricamento tavolo…</p>;
  }

  if (notFound || !table) {
    return <p>Questo tavolo non esiste (più).</p>;
  }

    const myUid = user?.uid || null;
    const isHost = !!(myUid && table && myUid === table.hostId);
    const inLobby = table?.state === "LOBBY";
    const inGame = table?.state === "IN_GAME";
    const inSummary = table?.state === "SUMMARY";

    const myPlayer = myUid
    ? players.find((p) => p.userId === myUid) || null
    : null;


  const isMyTurn =
    inGame &&
    currentHand &&
    myUid &&
    currentHand.currentTurnIndex != null &&
    currentHand.currentTurnIndex >= 0 &&
    players[currentHand.currentTurnIndex] &&
    players[currentHand.currentTurnIndex].userId === myUid &&
    !players[currentHand.currentTurnIndex].isFolded;

  const myRoundBet =
    currentHand && myUid ? currentHand.roundBets[myUid] ?? 0 : 0;
  const currentBet = currentHand?.currentBet ?? 0;
  const diffToCall = Math.max(0, currentBet - myRoundBet);

  const canCheck = isMyTurn && diffToCall === 0;
  const canCall = isMyTurn && diffToCall > 0 && (myPlayer?.stack ?? 0) >= diffToCall;
  const canBetOrRaise =
    isMyTurn && myPlayer && myPlayer.stack > 0 && currentHand != null;

  const votingOpen =
    inGame && currentHand?.stage === "SHOWDOWN" && currentHand.votingOpen;
  const hasWinner =
    inGame && 
    currentHand?.stage === "SHOWDOWN" && 
    (!!currentHand.winnerId || (currentHand.winnerIds && currentHand.winnerIds.length > 0));

  const myVoteTargetId =
    currentHand && user ? currentHand.votes?.[user.uid] ?? null : null;

  let disableSitToggle = false;
  if (inGame && currentHand && !myPlayer?.isSittingOut) {
    if (!myPlayer?.isFolded && !(currentHand.stage === "SHOWDOWN" && hasWinner)) {
      // Giocatore attivo: bloccato durante tutta la mano finché il vincitore non è assegnato
      disableSitToggle = true;
    }
  }

  // Host bloccato dal terminare la partita durante una mano, sbloccato solo a vincitore assegnato
  const disableEndGame = inGame && !!currentHand && !(currentHand.stage === "SHOWDOWN" && hasWinner);

  const allReady =
    table.state === "LOBBY" &&
    players.length > 0 &&
    players.every((p) => p.isReady === true);

  // ---------- LOBBY ACTIONS ----------

  async function handleToggleReady(player: PlayerData) {
    if (!user) return;
    if (!tableId) return;
    if (player.userId !== user.uid) return;
    await setPlayerReady(tableId, user, !player.isReady);
  }

  async function handleStartGame() {
    if (!isHost) return;
    if (!tableId) return;
    try {
      await startGame(tableId);
    } catch (err) {
      console.error("Errore startGame:", err);
    }
  }

  async function handleMoveUp(index: number) {
    if (!isHost) return;
    if (!tableId) return;
    if (!table) return;
    if (table.state !== "LOBBY") return;
    if (index <= 0) return;

    const current = players[index];
    const above = players[index - 1];

    await swapSeats(
      tableId,
      current.id,
      above.id,
      current.seatIndex,
      above.seatIndex
    );
  }

  async function handleMoveDown(index: number) {
    if (!isHost) return;
    if (!tableId) return;
    if (!table) return;
    if (table.state !== "LOBBY") return;
    if (index >= players.length - 1) return;

    const current = players[index];
    const below = players[index + 1];

    await swapSeats(
      tableId,
      current.id,
      below.id,
      current.seatIndex,
      below.seatIndex
    );
  }

  async function handleLeaveTable() {
  if (!user || !tableId) return;
  try {
    await leaveTable(tableId, user);
  } catch (err) {
    console.error(err);
  } finally {
    navigate("/home");
  }
}

async function handleToggleSittingOut() {
  if (!user || !tableId) return;
  if (!myPlayer) return;
  const newValue = !myPlayer.isSittingOut;
  // Aggiornamento ottimistico
  setPlayers(prev => prev.map(p => p.id === myPlayer.id ? { ...p, isSittingOut: newValue } : p));
  try {
    await setSittingOut(tableId, user, newValue);
  } catch (err: any) {
    console.error(err);
    // Revert ottimistico
    setPlayers(prev => prev.map(p => p.id === myPlayer.id ? { ...p, isSittingOut: !newValue } : p));
    setActionError(err.message || "Errore nel gestire lo stato di pausa.");
    window.alert("ATTENZIONE! Firebase ha scartato la richiesta: " + err.message);
  }
}

async function handleAdvanceStage() {
  if (!user || !tableId) return;
  try {
    await advanceStage(tableId, user);
  } catch (err) {
    console.error(err);
    setActionError((err as any)?.message || "Errore nell'avanzare la mano.");
  }
}

async function handleNextHand() {
  if (!user || !tableId) return;
  if (!isHost) return;
  if (!currentHand) return;
  
  // ✅ Controlla sia winnerId che winnerIds
  const hasWinners = currentHand.winnerId || (currentHand.winnerIds && currentHand.winnerIds.length > 0);
  if (!hasWinners) return;

  try {
    await startNextHand(tableId, user);
  } catch (err) {
    console.error(err);
    setActionError(
      (err as any)?.message || "Errore nell'avvio della mano successiva."
    );
  }
}

async function handleEndGame() {
  if (!isHost || !tableId) return;
  const confirmEnd = window.confirm(
    "Vuoi terminare la partita per tutti e vedere il riepilogo?"
  );
  if (!confirmEnd) return;

  try {
    await endGame(tableId);
  } catch (err) {
    console.error(err);
  }
}


  // ---------- GAME ACTIONS ----------

  async function doAction(
    type: "CHECK" | "CALL" | "BET" | "FOLD",
    amount?: number
  ) {
    setActionError(null);
    if (!tableId) return;
    if (!user) {
      setActionError("Devi essere loggato per agire.");
      return;
    }
    if (!currentHand) {
      setActionError("Nessuna mano corrente.");
      return;
    }
    if (!isMyTurn) {
      setActionError("Non è il tuo turno.");
      return;
    }

    try {
      setActionLoading(true);
      await playerAction(tableId, user, type, amount);
    } catch (err: any) {
      console.error(err);
      setActionError(err?.message || "Errore durante l'azione.");
    } finally {
      setActionLoading(false);
    }
  }

  function openBetPanel() {
  if (!canBetOrRaise || !myPlayer || !table) return;
  setActionError(null);

  const baseMin =
    currentBet === 0
      ? table.smallBlind || 5
      : currentBet + (table.smallBlind || 5);

    const myMaxFinal = myRoundBet + myPlayer.stack;

    const min = Math.min(baseMin, myMaxFinal);
    const defaultValue = Math.max(baseMin, currentBet || baseMin);

    setBetAmount(
      Math.max(min, Math.min(defaultValue, myMaxFinal))
    );
    setShowBetPanel(true);
  }

  function closeBetPanel() {
    setShowBetPanel(false);
  }

  function applyQuickBet(type: "1BB" | "HALF_POT" | "POT") {
  if (!currentHand || !myPlayer || !table) return;

    const bb = table.bigBlind || 10;
    const pot = currentHand.pot;
    const myMaxFinal = myRoundBet + myPlayer.stack;

    let target = 0;
    if (type === "1BB") {
      target = currentBet === 0 ? bb : Math.max(currentBet + bb);
    } else if (type === "HALF_POT") {
      target = Math.max(currentBet || 0, Math.floor(pot / 2));
    } else if (type === "POT") {
      target = Math.max(currentBet || 0, pot);
    }

    // Clamp al massimo consentito
    target = Math.min(target, myMaxFinal);
    if (target <= myRoundBet) {
      // non ha senso ridurre la propria bet
      target = myRoundBet;
    }

    setBetAmount(target);
  }

  async function confirmBet() {
    if (!canBetOrRaise || !myPlayer) return;
    if (!betAmount || betAmount <= myRoundBet) {
      setActionError("Importo bet/raise non valido.");
      return;
    }
    if (currentBet % 5 !== 0) {
      setActionError("La puntata deve essere multipla di 5");
      return;
    }
    await doAction("BET", betAmount);
    setShowBetPanel(false);
  }

  function renderRoleBadges(index: number) {
    if (!currentHand) return null;

    const badges: string[] = [];
    if (index === currentHand.dealerIndex) badges.push("D");
    if (index === currentHand.smallBlindIndex) badges.push("SB");
    if (index === currentHand.bigBlindIndex) badges.push("BB");

    if (badges.length === 0) return null;

    return (
      <span
        style={{
          marginLeft: "0.5rem",
          fontSize: "0.75rem",
          padding: "0.1rem 0.35rem",
          borderRadius: "999px",
          backgroundColor: "#1f2933",
          color: "#e5e7eb"
        }}
      >
        {badges.join(" • ")}
      </span>
    );
  }

  function getSeatPosition(index: number, total: number) {
    const angle = (2 * Math.PI * index) / total - Math.PI / 2;
    const radius = 40; // percentuale

    const top = 50 + radius * Math.sin(angle);
    const left = 50 + radius * Math.cos(angle);

    return {
      top: `${top}%`,
      left: `${left}%`
    };
  }

  // Toglie/aggiunge un giocatore dalla lista dei vincitori selezionati
function toggleWinnerSelection(userId: string) {
  if (!user || !tableId) return;
  if (!currentHand || !votingOpen) return;
  
  // Solo l'host può selezionare
  if (!isHost) {
    setActionError("Solo l'host può confermare i vincitori.");
    return;
  }
  
  setSelectedWinners(prev => {
    if (prev.includes(userId)) {
      // Rimuovi se già selezionato
      return prev.filter(id => id !== userId);
    } else {
      // Aggiungi alla selezione
      return [...prev, userId];
    }
  });
}

// Conferma i vincitori selezionati
async function handleConfirmWinners() {
  if (!user || !tableId) return;
  if (!currentHand || !votingOpen) return;
  if (!isHost) {
    setActionError("Solo l'host può confermare i vincitori.");
    return;
  }
  
  if (selectedWinners.length === 0) {
    setActionError("Devi selezionare almeno un vincitore.");
    return;
  }
  
  try {
    await confirmWinners(tableId, user, selectedWinners);
    setSelectedWinners([]); // Reset selezione
    setActionError(null);
  } catch (err) {
    console.error(err);
    setActionError((err as any)?.message || "Errore durante la conferma dei vincitori.");
  }
}

  // ---------- RENDER LOBBY ----------

  function renderLobby() {
    if (!table) return null;

    return (
      <div
      style={{
        minHeight: "100vh",
        padding: "1rem",
        background:
          "radial-gradient(circle at top, #020617, #020617 40%, #000000)",
        boxSizing: "border-box",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start"
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "640px",
          padding: "1.2rem 1rem",
          borderRadius: "1rem",
          border: "1px solid #1f2937",
          backgroundColor: "rgba(15,23,42,0.98)",
          boxShadow: "0 18px 35px rgba(0,0,0,0.55)",
          display: "grid",
          gap: "1rem"
        }}
      >
        <header style={{ display: "grid", gap: "0.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.25rem" }}>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 600, margin: 0 }}>
              {table.name}{" "}
              <span style={{ fontSize: "0.9rem", opacity: 0.7 }}>
                (ID: {tableId})
              </span>
            </h1>
            <button
              onClick={() => setShowShareModal(true)}
              style={{
                padding: "0.4rem 0.8rem",
                borderRadius: "0.5rem",
                border: "1px solid #3b82f6",
                backgroundColor: "rgba(59, 130, 246, 0.1)",
                color: "#60a5fa",
                cursor: "pointer",
                fontSize: "0.85rem",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "0.4rem"
              }}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
              Invita
            </button>
          </div>
          
        <div
  style={{
    marginTop: "0.5rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: "0.85rem"
  }}
>
  <span style={{ color: "#9ca3af" }}>
    Giocatori: {players.length}
  </span>
  <button
    onClick={handleLeaveTable}
    style={{
      padding: "0.3rem 0.7rem",
      borderRadius: "999px",
      border: "1px solid #4b5563",
      backgroundColor: "transparent",
      color: "#e5e7eb",
      cursor: "pointer",
      fontSize: "0.8rem"
    }}
  >
    Esci dal tavolo
  </button>
</div>

          <p style={{ fontSize: "0.9rem", color: "#cbd5f5" }}>
            Bui: {table.smallBlind}/{table.bigBlind} • Stack iniziale:{" "}
            {table.initialStack} • Stato: {table.state}
          </p>
          {isHost && (
            <p style={{ fontSize: "0.85rem", color: "#a5b4fc" }}>
              Sei l'host di questo tavolo.
            </p>
          )}

          {isHost && (
            <div
              style={{
                marginTop: "0.5rem",
                padding: "0.5rem 0.75rem",
                borderRadius: "0.5rem",
                backgroundColor: "rgba(15,23,42,0.9)",
                border: "1px solid #1e293b",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: "0.9rem"
              }}
            >
              <span>
                Giocatori pronti: {players.filter((p) => p.isReady).length}/
                {players.length}
              </span>
              <button
                onClick={handleStartGame}
                disabled={!allReady}
                style={{
                  padding: "0.3rem 0.75rem",
                  borderRadius: "0.5rem",
                  border: "none",
                  cursor: allReady ? "pointer" : "default",
                  backgroundColor: allReady ? "#22c55e" : "#4b5563",
                  color: "#020617",
                  fontWeight: 600
                }}
              >
                Avvia partita
              </button>
            </div>
          )}
        </header>

        <section style={{ display: "grid", gap: "0.5rem" }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 600 }}>Giocatori</h2>

          {players.length === 0 ? (
            <p style={{ fontSize: "0.9rem", color: "#cbd5f5" }}>
              Nessun giocatore ancora seduto al tavolo.
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {players.map((p, index) => {
                const isMe = myUid === p.userId;
                const isHostPlayer = p.userId === table.hostId;

                return (
                <li
                    key={p.id}
                    style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "0.5rem 0.75rem",
                    marginBottom: "0.35rem",
                    borderRadius: "0.5rem",
                    backgroundColor: "rgba(15,23,42,0.9)",
                    border: "1px solid #1e293b"
                    }}
                >
                    <div>
                    <span style={{ fontWeight: 500, color: p.isSittingOut ? "#9ca3af" : "#e5e7eb" }}>
                        {p.isSittingOut && <span style={{ color: "#facc15" }}>[Pausa] </span>}
                        {p.displayName}
                        {isMe && " (tu)"}
                    </span>
                    {isHostPlayer && (
                        <span
                        style={{
                            marginLeft: "0.35rem",
                            fontSize: "0.8rem",
                            color: "#facc15"
                        }}
                        >
                        👑 Host
                        </span>
                    )}
                    <div
                        style={{
                        fontSize: "0.8rem",
                        color: "#9ca3af",
                        marginTop: "0.1rem"
                        }}
                    >
                        Seat: {p.seatIndex} • Stack: {p.stack} •{" "}
                        {p.isReady ? "Pronto ✅" : "Non pronto"}
                    </div>
                    </div>

                    <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                    {isMe && (
                        <button
                        onClick={() => handleToggleReady(p)}
                        style={{
                            ...smallButtonStyle,
                            backgroundColor: p.isReady ? "#f97316" : "#22c55e",
                            color: "#020617",
                            fontWeight: 600
                        }}
                        >
                        {p.isReady ? "Non pronto" : "Pronto"}
                        </button>
                    )}

                    {isHost && (
                        <div style={{ display: "flex", gap: "0.25rem" }}>
                        <button
                            onClick={() => handleMoveUp(index)}
                            disabled={index === 0}
                            style={smallButtonStyle}
                            title="Sposta su"
                        >
                            ↑
                        </button>
                        <button
                            onClick={() => handleMoveDown(index)}
                            disabled={index === players.length - 1}
                            style={smallButtonStyle}
                            title="Sposta giù"
                        >
                            ↓
                        </button>
                        </div>
                    )}
                    </div>
                </li>
                );

              })}
            </ul>
          )}
        </section>
      </div>
    </div>
    );
  }

  // ---------- RENDER GAME ----------

  function renderGame() {
    if (!table) return null;

    return (
      <div
        style={{
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    padding: "0.75rem",
    gap: "0.75rem",
    boxSizing: "border-box"
  }}
      >
        <header style={{ display: "grid", gap: "0.25rem" }}>
          <h1 style={{ fontSize: "1.3rem", fontWeight: 600 }}>
            {table.name}
          </h1>
          <p style={{ fontSize: "0.85rem", color: "#cbd5f5" }}>
            Mano #{currentHand?.handNumber ?? "-"} •{" "}
            {currentHand?.stage ?? "N/A"} • Pot: {currentHand?.pot ?? 0} •
            Puntata attuale: {currentHand?.currentBet ?? 0}
          </p>
          <p style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
            Bui {table?.smallBlind}/{table?.bigBlind}
          </p>
          <div
            style={{
              marginTop: "0.4rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "0.8rem"
            }}
          >
            <button
              onClick={() => navigate("/home")}
              style={{
                padding: "0.3rem 0.6rem",
                borderRadius: "999px",
                border: "1px solid #4b5563",
                backgroundColor: "transparent",
                color: "#9ca3af",
                cursor: "pointer"
              }}
            >
              Home
            </button>

            <div style={{ display: "flex", gap: "0.4rem" }}>
              <button
                onClick={handleToggleSittingOut}
                disabled={!!disableSitToggle}
                style={{
                  padding: "0.3rem 0.6rem",
                  borderRadius: "999px",
                  border: "1px solid #f59e0b",
                  backgroundColor: "transparent",
                  color: disableSitToggle ? "#6b7280" : "#fcd34d",
                  cursor: disableSitToggle ? "default" : "pointer",
                  fontSize: "0.8rem",
                  opacity: disableSitToggle ? 0.5 : 1
                }}
              >
                {myPlayer?.isSittingOut ? "Siediti al tavolo" : "Alzati dal tavolo"}
              </button>

              {isHost && (
                <button
                  onClick={handleEndGame}
                  disabled={disableEndGame}
                  style={{
                    padding: "0.3rem 0.6rem",
                    borderRadius: "999px",
                    border: "none",
                    backgroundColor: "#ef4444",
                    color: disableEndGame ? "#fca5a5" : "#020617",
                    cursor: disableEndGame ? "default" : "pointer",
                    opacity: disableEndGame ? 0.5 : 1,
                    fontWeight: 600
                  }}
                >
                  Termina partita
                </button>
              )}
            </div>
          </div>

        </header>

        <main
          style={{
    flex: 1,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden"
  }}
        >
          <div
            style={{
              position: "relative",
              width: "min(600px, 100%)",
              aspectRatio: "1 / 1",
              borderRadius: "999px",
              background:
                "radial-gradient(circle at 30% 30%, #1f2937, #020617)",
              border: "2px solid #1e293b",
              boxShadow: "0 0 30px rgba(15,23,42,0.8)",
              padding: "1rem"
            }}
          >
            {/* Testo centrale: turno */}
<div
  style={{
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    textAlign: "center"
  }}
>
  <div
    style={{
      fontSize: "0.8rem",
      color: "#9ca3af",
      marginBottom: "0.25rem"
    }}
  >
    {currentHand?.stage ?? "N/A"}
  </div>

  <div style={{ fontSize: "0.9rem", color: "#e5e7eb" }}>
    {isMyTurn
      ? "È il TUO turno"
      : currentHand &&
        currentHand.currentTurnIndex != null &&
        currentHand.currentTurnIndex >= 0 &&
        players[currentHand.currentTurnIndex]
      ? `Turno di ${
          players[currentHand.currentTurnIndex].displayName
        }`
      : "In attesa..."}
  </div>

  {isHost && currentHand && currentHand.currentTurnIndex === -1 && (
    <div
      style={{
        marginTop: "0.5rem",
        display: "flex",
        gap: "0.5rem",
        justifyContent: "center"
      }}
    >
      {currentHand.stage !== "SHOWDOWN" && (
        <button
          onClick={handleAdvanceStage}
          style={{
            padding: "0.35rem 0.8rem",
            borderRadius: "999px",
            border: "none",
            backgroundColor: "#22c55e",
            color: "#020617",
            fontSize: "0.85rem",
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          Prosegui ({currentHand.stage} completato)
        </button>
      )}

      {currentHand.stage === "SHOWDOWN" && hasWinner && (
        <button
          onClick={handleNextHand}
          style={{
            padding: "0.35rem 0.8rem",
            borderRadius: "999px",
            border: "none",
            backgroundColor: "#22c55e",
            color: "#020617",
            fontSize: "0.85rem",
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          Prossima mano
        </button>
      )}
    </div>
  )}
  
  {currentHand?.stage === "SHOWDOWN" && votingOpen && isHost && (
    <button
      onClick={handleConfirmWinners}
      disabled={selectedWinners.length === 0}
      style={{
        marginTop: "0.5rem",
        padding: "0.5rem 1rem",
        borderRadius: "999px",
        border: "none",
        backgroundColor: selectedWinners.length > 0 ? "#22c55e" : "#4b5563",
        color: "#020617",
        fontSize: "0.85rem",
        fontWeight: 600,
        cursor: selectedWinners.length > 0 ? "pointer" : "default"
      }}
    >
      Conferma vincitor{selectedWinners.length > 1 ? "i" : "e"} ({selectedWinners.length})
    </button>
  )}
</div>


            {/* Giocatori attorno al tavolo */}
            {players.map((p, index) => {
              const { top, left } = getSeatPosition(index, players.length);
              const isMe = myUid === p.userId;
              const isTurn =
                currentHand &&
                currentHand.currentTurnIndex === index &&
                !p.isFolded;

              const roundBet =
                currentHand && currentHand.roundBets[p.userId]
                  ? currentHand.roundBets[p.userId]
                  : 0;

              return (
                <div
                  key={p.id}
                  style={{
                    position: "absolute",
                    top,
                    left,
                    transform: "translate(-50%, -50%)",
                    minWidth: "50px",
                  }}
                >
                    <div
                      style={{
                        borderRadius: "999px",
                        padding: "0.4rem 0.6rem",
                        backgroundColor: isMe
                          ? "rgba(34,197,94,0.15)"
                          : "rgba(15,23,42,0.9)",
                        border: isTurn
                          ? "2px solid #22c55e"
                          : selectedWinners.includes(p.userId) && votingOpen
                          ? "2px solid #22c55e"
                          : "1px solid #1e293b",
                        boxShadow: isTurn
                          ? "0 0 15px rgba(34,197,94,0.6)"
                          : "0 0 8px rgba(15,23,42,0.6)",
                        fontSize: "0.7rem",
                        cursor:
                          votingOpen && currentHand?.stage === "SHOWDOWN" && !p.isFolded && !p.isSittingOut
                            ? "pointer"
                            : "default",
                        opacity: p.isSittingOut ? 0.4 : p.isFolded ? 0.6 : 1
                      }}
                      onClick={() => {
                        if (votingOpen && currentHand?.stage === "SHOWDOWN" && !p.isFolded && !p.isSittingOut) {
                          toggleWinnerSelection(p.userId);
                        }
                      }}
                    >
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <span
                        style={{
                          fontWeight: 500,
                          color: p.isSittingOut ? "#9ca3af" : p.isFolded ? "#6b7280" : "#e5e7eb",
                          textDecoration: p.isFolded && !p.isSittingOut
                            ? "line-through"
                            : "none"
                        }}
                      >
                        {p.isSittingOut && <span style={{ color: "#facc15" }}>[Pausa] </span>}
                        {p.displayName}
                        {isMe && " (tu)"}
                        {renderRoleBadges(index)}
                      </span>
                    </div>
                    <div
                      style={{
                        marginTop: "0.15rem",
                        color: "#9ca3af",
                        fontSize: "0.75rem"
                      }}
                    >
                      {p.stack} • {roundBet}
                      {p.isFolded && " • Foldato"}
                      {votingOpen && myVoteTargetId === p.userId &&
                        " • (tua scelta)"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </main>

        {/* Action bar in basso */}
        <footer
          style={{
            display: "grid",
            gap: "0.5rem",
            paddingTop: "0.5rem",
            borderTop: "1px solid #1e293b"
          }}
        >
          {hasWinner && (
            <div
              style={{
                padding: "0.6rem 0.8rem",
                borderRadius: "0.75rem",
                border: "1px solid #1e293b",
                backgroundColor: "rgba(15,23,42,0.98)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "0.5rem"
              }}
            >
              <div
                style={{
                  fontSize: "0.85rem",
                  color: "#e5e7eb"
                }}
              >
                {currentHand?.winnerIds && currentHand.winnerIds.length > 1 ? (
                  // Più vincitori (split pot)
                  <>
                    Vincitori della mano (split pot):{" "}
                    <strong>
                      {currentHand.winnerIds
                        .map(wId => players.find(p => p.userId === wId)?.displayName || "Sconosciuto")
                        .join(", ")}
                    </strong>
                  </>
                ) : (
                  // Singolo vincitore
                  <>
                    Vincitore della mano:{" "}
                    <strong>
                      {(
                        players.find((p) => p.userId === currentHand.winnerId)
                          ?.displayName || "Sconosciuto"
                      )}
                    </strong>
                  </>
                )}
              </div>
              {isHost && (
                <button
                  onClick={handleNextHand}
                  style={{
                    padding: "0.4rem 0.8rem",
                    borderRadius: "999px",
                    border: "none",
                    backgroundColor: "#22c55e",
                    color: "#020617",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  Prossima mano
                </button>
              )}
            </div>
          )}
          {actionError && (
            <p style={{ fontSize: "0.8rem", color: "#f97373" }}>
              {actionError}
            </p>
          )}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.4rem"
            }}
          >
            {/* Barra pot/info */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "0.85rem",
                color: "#cbd5f5"
              }}
            >
              <span>Pot: {currentHand?.pot ?? 0}</span>
              <span>
                Puntata corrente: {currentHand?.currentBet ?? 0} • La tua:{" "}
                {myRoundBet}
              </span>
            </div>

            {/* Pulsanti azione */}
            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "center"
              }}
            >
              {/* Fold sempre disponibile se è il tuo turno */}
              <button
                disabled={!isMyTurn || actionLoading}
                onClick={() => doAction("FOLD")}
                style={{
                  ...circleActionButton,
                  backgroundColor: 
                    isMyTurn 
                      ? "#ef4444ff"
                      : "#ef444473"
                }}
              >
                F
              </button>

              {/* Bottone centrale: Check o Call */}
              <button
                disabled={!isMyTurn || actionLoading || (!canCheck && !canCall)}
                onClick={() =>
                  canCall ? doAction("CALL") : canCheck ? doAction("CHECK") : null
                }
                style={{
                  flex: 1,
                  padding: "0.6rem 0.9rem",
                  borderRadius: "999px",
                  border: "none",
                  cursor:
                    isMyTurn && (canCheck || canCall) && !actionLoading
                      ? "pointer"
                      : "default",
                  backgroundColor:
                    isMyTurn && (canCheck || canCall)
                      ? "#e5e7eb"
                      : "#4b5563",
                  color: "#020617",
                  fontWeight: 600,
                  fontSize: "0.9rem",
                  textAlign: "center"
                }}
              >
                {!isMyTurn
                  ? "In attesa..."
                  : canCall
                  ? `Call ${diffToCall}`
                  : canCheck
                  ? "Check"
                  : "—"}
              </button>

              {/* Bottone Bet/Raise + pannello */}
              <button
                disabled={!isMyTurn || actionLoading || !canBetOrRaise}
                onClick={openBetPanel}
                style={{
                  ...pillActionButton,
                  backgroundColor:
                    isMyTurn && canBetOrRaise ? "#22c55e" : "#4b5563"
                }}
              >
                {currentBet === 0 && myRoundBet === 0 ? "Bet" : "Raise"}
              </button>
            </div>
          </div>

          {/* pannello bet/raise */}
          {showBetPanel && isMyTurn && myPlayer && (
            <div
              style={{
                marginTop: "0.5rem",
                padding: "0.6rem 0.8rem",
                borderRadius: "0.75rem",
                border: "1px solid #1e293b",
                backgroundColor: "rgba(15,23,42,0.95)",
                display: "grid",
                gap: "0.5rem"
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "0.85rem",
                  color: "#e5e7eb"
                }}
              >
                <span>
                  Raise: <strong>{betAmount - (currentHand?.currentBet ?? 0)}</strong>
                </span>
                <span style={{ color: "#9ca3af" }}>
                  Stack: {myPlayer.stack}
                </span>
              </div>

              <input
                type="range"
                min={currentBet+5}
                step={5}
                max={myRoundBet + myPlayer.stack}
                value={betAmount}
                onChange={(e) => setBetAmount(Number(e.target.value))}
              />

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "0.4rem"
                }}
              >
                <button
                  onClick={() => applyQuickBet("1BB")}
                  style={quickBetButtonStyle}
                >
                  1 BB
                </button>
                <button
                  onClick={() => applyQuickBet("HALF_POT")}
                  style={quickBetButtonStyle}
                >
                  ½ Pot
                </button>
                <button
                  onClick={() => applyQuickBet("POT")}
                  style={quickBetButtonStyle}
                >
                  Pot
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "0.5rem",
                  marginTop: "0.3rem"
                }}
              >
                <button
                  onClick={closeBetPanel}
                  style={{
                    flex: 1,
                    padding: "0.4rem 0.7rem",
                    borderRadius: "0.5rem",
                    border: "1px solid #4b5563",
                    backgroundColor: "transparent",
                    color: "#e5e7eb",
                    fontSize: "0.85rem",
                    cursor: "pointer"
                  }}
                >
                  Annulla
                </button>
                <button
                  onClick={confirmBet}
                  disabled={actionLoading}
                  style={{
                    flex: 1,
                    padding: "0.4rem 0.7rem",
                    borderRadius: "0.5rem",
                    border: "none",
                    backgroundColor: "#22c55e",
                    color: "#020617",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    cursor: "pointer"
                  }}
                >
                  Metti nel piatto
                </button>
              </div>
            </div>
          )}
        </footer>
      </div>
    );
  }

  // ---------- RENDER SUMMARY ----------
  
  function renderSummary() {
  if (!table) return null;

  const start =
    table.createdAt && table.createdAt.toDate
      ? table.createdAt.toDate()
      : null;
  const end =
    table.endedAt && table.endedAt.toDate
      ? table.endedAt.toDate()
      : null;

  let durata = "N/D";
  if (start && end) {
    const ms = end.getTime() - start.getTime();
    const mins = Math.max(1, Math.round(ms / 1000 / 60));
    durata = `${mins} min`;
  }

  const handsPlayed = currentHand?.handNumber ?? "-";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem"
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "480px",
          padding: "1.6rem 1.4rem",
          borderRadius: "1rem",
          border: "1px solid #1f2937",
          backgroundColor: "rgba(15,23,42,0.98)",
          boxShadow: "0 18px 35px rgba(0,0,0,0.55)",
          display: "grid",
          gap: "1rem"
        }}
      >
        <header style={{ display: "grid", gap: "0.25rem" }}>
          <h2 style={{ fontSize: "1.4rem", fontWeight: 600 }}>
            Riepilogo partita
          </h2>
          <p style={{ fontSize: "0.9rem", color: "#9ca3af" }}>
            Tavolo:{" "}
            <span style={{ color: "#e5e7eb", fontWeight: 500 }}>
              {table.name}
            </span>
          </p>
        </header>

        <div
          style={{
            display: "grid",
            gap: "0.3rem",
            fontSize: "0.9rem",
            color: "#e5e7eb"
          }}
        >
          <div>Durata sessione: {durata}</div>
          <div>Mani giocate: {handsPlayed}</div>
          <div style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
            Le statistiche avanzate (percentuali di vittoria, ecc.) verranno implementate in futuro.
          </div>
        </div>

        <div style={{ marginTop: "0.5rem" }}>
          <h3
            style={{
              fontSize: "1rem",
              fontWeight: 500,
              marginBottom: "0.4rem"
            }}
          >
            Stack finali
          </h3>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "grid",
              gap: "0.3rem"
            }}
          >
            {players.map((p) => (
              <li
                key={p.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "0.4rem 0.6rem",
                  borderRadius: "0.5rem",
                  backgroundColor: "rgba(15,23,42,0.9)",
                  border: "1px solid #1e293b",
                  fontSize: "0.9rem"
                }}
              >
                <span>{p.displayName}</span>
                <span>{p.stack}</span>
              </li>
            ))}
          </ul>
        </div>

        <button
          onClick={() => navigate("/home")}
          style={{
            marginTop: "0.5rem",
            width: "100%",
            padding: "0.7rem 1rem",
            borderRadius: "999px",
            border: "none",
            cursor: "pointer",
            backgroundColor: "#22c55e",
            color: "#020617",
            fontWeight: 700,
            fontSize: "0.95rem"
          }}
        >
          Torna alla home
        </button>
      </div>
    </div>
  );
}

  
  // ---------- RENDER ROOT ----------

  const modalUI = showShareModal && (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(2, 6, 23, 0.8)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
    }}>
      <div style={{
        background: "rgba(15,23,42,0.95)", border: "1px solid #1e293b",
        borderRadius: "1.5rem", padding: "2rem", display: "grid", gap: "1.5rem",
        textAlign: "center", maxWidth: "340px", width: "90%",
        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)"
      }}>
        <h2 style={{ fontSize: "1.4rem", margin: 0, color: "#e2e8f0" }}>Invita al tavolo</h2>
        <div style={{ background: "white", padding: "1.2rem", borderRadius: "1rem", display: "inline-block", margin: "0 auto" }}>
          <QRCodeSVG value={`${window.location.origin}/table/${tableId}`} size={200} />
        </div>
        <p style={{ margin: 0, fontSize: "0.9rem", color: "#9ca3af" }}>
          Copia il link qui sotto o fai inquadrare questo QR ai tuoi amici.
        </p>
        <button 
          onClick={() => {
            navigator.clipboard.writeText(`${window.location.origin}/table/${tableId}`);
            alert("Link copiato negli appunti!");
          }}
          style={{
            background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "#ffffff", border: "none", padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontWeight: 700, fontSize: "0.95rem"
          }}
        >
          Copia Link
        </button>
        <button 
          onClick={() => setShowShareModal(false)}
          style={{
            background: "transparent", color: "#9ca3af", border: "none", padding: "0.5rem", cursor: "pointer", fontWeight: 600, fontSize: "0.9rem"
          }}
        >
          Chiudi
        </button>
      </div>
    </div>
  );

if (inLobby) return <>{renderLobby()}{modalUI}</>;
if (inGame) return <>{renderGame()}{modalUI}</>;
if (inSummary) return <>{renderSummary()}{modalUI}</>;
return <p>Stato tavolo non supportato.</p>;
}

const smallButtonStyle: React.CSSProperties = {
  padding: "0.25rem 0.5rem",
  borderRadius: "0.375rem",
  border: "none",
  cursor: "pointer",
  backgroundColor: "#4b5563",
  color: "#e5e7eb",
  fontSize: "0.8rem"
};

const circleActionButton: React.CSSProperties = {
  width: "38px",
  height: "38px",
  borderRadius: "999px",
  border: "none",
  cursor: "pointer",
  backgroundColor: "#4b5563",
  color: "#e5e7eb",
  fontWeight: 700,
  fontSize: "0.9rem",
  display: "flex",
  alignItems: "center",
  justifyContent: "center"
};

const pillActionButton: React.CSSProperties = {
  padding: "0.6rem 0.9rem",
  borderRadius: "999px",
  border: "none",
  cursor: "pointer",
  backgroundColor: "#22c55e",
  color: "#020617",
  fontWeight: 600,
  fontSize: "0.9rem",
  minWidth: "80px",
  textAlign: "center"
};

const quickBetButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: "0.35rem 0.4rem",
  borderRadius: "0.5rem",
  border: "none",
  cursor: "pointer",
  backgroundColor: "#1f2937",
  color: "#e5e7eb",
  fontSize: "0.8rem",
  fontWeight: 500
};
