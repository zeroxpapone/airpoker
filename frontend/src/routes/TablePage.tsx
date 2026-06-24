import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { useTranslation } from "react-i18next";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../hooks/useAuth";
import { useWakeLock } from "../hooks/useWakeLock";
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
  startNextHand,
  addChips,
  swapPlayerSeats,
  transferHost,
  forceFoldPlayer
} from "../lib/firestoreApi";

interface TableData {
  name: string;
  state: string;
  initialStack: number;
  smallBlind: number;
  bigBlind: number;
  hostId: string;
  currentHandId: string | null;
  password?: string | null;
  createdAt?: any;
  endedAt?: any;
  mode?: 'CASH' | 'TOURNAMENT';
  tournamentConfig?: any; // To avoid importing types if not exported, using any or explicitly redefining
  currentLevelIndex?: number;
  levelStartedAt?: any;
  isVirtualCards?: boolean;
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
  isAllIn?: boolean;
  totalBuyIn?: number;
  eliminatedAt?: number;
}

const Card = ({ card, hidden }: { card?: string, hidden?: boolean }) => {
  if (hidden || !card) {
    return (
      <div className="poker-card poker-card-hidden" />
    );
  }

  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  const isRed = suit === 'h' || suit === 'd';
  
  const suitIcon = {
    'h': '♥️',
    'd': '♦️',
    's': '♠️',
    'c': '♣️'
  }[suit] || suit;

  const rankDisplay = rank === 'T' ? '10' : rank;

  return (
    <div className={`poker-card ${isRed ? 'poker-card-red' : 'poker-card-black'}`}>
      <div className="poker-card-corner-top">{rankDisplay}</div>
      <div className="poker-card-center-suit">{suitIcon}</div>
      <div className="poker-card-corner-bottom">{rankDisplay}</div>
    </div>
  );
};


interface ExtendedHandData extends HandData {
  votingOpen?: boolean;
  votes?: Record<string, string>;
  winnerId?: string | null;
  winnerIds?: string[];
  pots?: import('../lib/firestoreApi').Pot[];
  handContributions?: Record<string, number>;
  id: string;
  createdAt?: any;
  blindsPopupClosed?: boolean;
  handResults?: Record<string, { rank: number; rankName: string; bestCards: string[] }>;
}

export default function TablePage() {
  useWakeLock();
  const { t } = useTranslation();

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
  const [bbClicks, setBbClicks] = useState<number>(0);
  const [showSettings, setShowSettings] = useState(false);
  const [rebuyAmounts, setRebuyAmounts] = useState<Record<string, number>>({});
  const [showFoldConfirm, setShowFoldConfirm] = useState(false);
  const [showEndGameConfirm, setShowEndGameConfirm] = useState(false);
  const [transferHostConfirmTarget, setTransferHostConfirmTarget] = useState<string | null>(null);
  const [forceFoldConfirmTarget, setForceFoldConfirmTarget] = useState<string | null>(null);
  const [showMyCards, setShowMyCards] = useState(false);
  const [, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const handleResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const [timeRemainingStr, setTimeRemainingStr] = useState<string>("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [blindsPopupVisible, setBlindsPopupVisible] = useState(false);
  const [lastSeenHandId, setLastSeenHandId] = useState<string | null>(null);

  const navigate = useNavigate();

  // Pre-action states for virtual cards mode
  const [preAction, setPreAction] = useState<{ type: "CHECK_FOLD" | "CHECK" | "CALL_ANY" | "CALL_X" | "FOLD"; amount?: number } | null>(null);
  const [lastStage, setLastStage] = useState<string>("");
  const [lastHandNumber, setLastHandNumber] = useState<number>(0);

  useEffect(() => {
    const handleVisChange = () => {
      if (document.visibilityState === "visible") {
        setRefreshKey(prev => prev + 1);
      }
    };
    document.addEventListener("visibilitychange", handleVisChange);
    return () => document.removeEventListener("visibilitychange", handleVisChange);
  }, []);

  useEffect(() => {
    if (table?.mode !== "TOURNAMENT" || !table?.levelStartedAt || !table?.tournamentConfig) {
      setTimeRemainingStr("");
      return;
    }

    const config = table.tournamentConfig;
    const currentLevelIndex = table.currentLevelIndex || 0;
    const levelDurationMins = config.blindSchedule[currentLevelIndex]?.durationMins || 15;
    
    // Check if levelStartedAt has toMillis or seconds
    const startMillis = typeof table.levelStartedAt.toMillis === "function" 
      ? table.levelStartedAt.toMillis() 
      : (table.levelStartedAt.seconds ? table.levelStartedAt.seconds * 1000 : Date.now());

    const endMillis = startMillis + levelDurationMins * 60 * 1000;

    const updateTimer = () => {
      const now = Date.now();
      const diff = endMillis - now;
      if (diff <= 0) {
        setTimeRemainingStr("00:00 (Next level on next hand)");
      } else {
        const totalSecs = Math.floor(diff / 1000);
        const m = Math.floor(totalSecs / 60).toString().padStart(2, "0");
        const s = (totalSecs % 60).toString().padStart(2, "0");
        setTimeRemainingStr(`${m}:${s}`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [table?.mode, table?.levelStartedAt, table?.tournamentConfig, table?.currentLevelIndex]);

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
            password: data.password ?? null,
            createdAt: data.createdAt ?? null,
            endedAt: data.endedAt ?? null,
            mode: data.mode,
            tournamentConfig: data.tournamentConfig ?? undefined,
            levelStartedAt: data.levelStartedAt ?? undefined,
            currentLevelIndex: data.currentLevelIndex ?? 0,
            isVirtualCards: !!data.isVirtualCards
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
            isSittingOut: !!d.isSittingOut,
            isAllIn: !!d.isAllIn,
            totalBuyIn: d.totalBuyIn,
            eliminatedAt: d.eliminatedAt
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
  }, [tableId, refreshKey]);

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
          winnerIds: d.winnerIds || [],
          pots: d.pots || [],
          handContributions: d.handContributions || {},
          id: snap.id,
          createdAt: d.createdAt ?? null,
          blindsPopupClosed: d.blindsPopupClosed ?? false,
          isVirtualCards: !!d.isVirtualCards,
          communityCards: d.communityCards || [],
          playerHands: d.playerHands || {},
          handResults: d.handResults || null
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
  }, [tableId, table?.currentHandId, refreshKey]);

  // Reset selezione vincitori quando cambia mano
  useEffect(() => {
    setSelectedWinners([]);
    setActionError(null);
  }, [currentHand?.handNumber]);

  // Gestione del popup Nuova Mano all'inizio
  useEffect(() => {
    const isCurrentlyInGame = table?.state === "IN_GAME";
    if (isCurrentlyInGame && currentHand && currentHand.id !== lastSeenHandId && currentHand.stage === "PREFLOP") {
      setLastSeenHandId(currentHand.id);
      if (!currentHand.isVirtualCards) {
        setBlindsPopupVisible(true);
      }
    }
  }, [table?.state, currentHand?.id, currentHand?.stage, lastSeenHandId]);

  useEffect(() => {
    if (blindsPopupVisible && currentHand && !currentHand.blindsPopupClosed) {
      const now = Date.now();
      const createdAt = currentHand.createdAt?.toMillis 
        ? currentHand.createdAt.toMillis() 
        : (currentHand.createdAt?.seconds ? currentHand.createdAt.seconds * 1000 : now);
        
      const elapsed = now - createdAt;
      const remaining = Math.max(0, 7000 - elapsed);
      
      if (remaining > 0) {
        const timer = setTimeout(() => {
          setBlindsPopupVisible(false);
        }, remaining);
        return () => clearTimeout(timer);
      } else {
        setBlindsPopupVisible(false);
      }
    } else if (currentHand?.blindsPopupClosed) {
      setBlindsPopupVisible(false);
    }
  }, [blindsPopupVisible, currentHand?.blindsPopupClosed, currentHand?.createdAt]);

  const handleCloseBlindsPopup = async () => {
    setBlindsPopupVisible(false);
    if (tableId && currentHand) {
      try {
        await updateDoc(doc(db, "tables", tableId, "hands", currentHand.id), { blindsPopupClosed: true });
      } catch (e) {
        console.error(e);
      }
    }
  };

  // Auto-advance stage per le carte virtuali (FLOP, TURN, RIVER)
  useEffect(() => {
    const checkHost = !!(user?.uid && table && user.uid === table.hostId);
    if (!checkHost || !currentHand?.isVirtualCards || currentHand.currentTurnIndex !== -1) return;
    if (currentHand.stage === "SHOWDOWN" || blindsPopupVisible) return;

    const timer = setTimeout(() => {
      handleAdvanceStage();
    }, 2000);

    return () => clearTimeout(timer);
  }, [currentHand?.id, currentHand?.stage, currentHand?.currentTurnIndex, table?.hostId, user?.uid, blindsPopupVisible]);

  // Local variables for pre-action hooks
  const localMyUid = user?.uid || null;
  const localInGame = table?.state === "IN_GAME";
  const localIsMyTurn = !!(
    localInGame &&
    currentHand &&
    localMyUid &&
    currentHand.currentTurnIndex != null &&
    currentHand.currentTurnIndex >= 0 &&
    players[currentHand.currentTurnIndex] &&
    players[currentHand.currentTurnIndex].userId === localMyUid &&
    !players[currentHand.currentTurnIndex].isFolded
  );

  const togglePreAction = (type: "CHECK_FOLD" | "CHECK" | "CALL_ANY" | "CALL_X" | "FOLD", amount?: number) => {
    setPreAction(prev => {
      if (prev?.type === type && prev?.amount === amount) {
        return null;
      }
      return { type, amount };
    });
  };

  // Pre-action auto-execution when turn reaches this player
  useEffect(() => {
    if (!localIsMyTurn || !preAction || !currentHand || actionLoading || !localMyUid) return;

    const myRoundBet = currentHand.roundBets[localMyUid] ?? 0;
    const currentBet = currentHand.currentBet ?? 0;
    const actualDiff = Math.max(0, currentBet - myRoundBet);

    const executeAutoAction = async () => {
      const chosenPreAction = preAction;
      setPreAction(null);
      
      if (chosenPreAction.type === "CHECK_FOLD") {
        if (actualDiff === 0) {
          await doAction("CHECK");
        } else {
          await doAction("FOLD");
        }
      } else if (chosenPreAction.type === "CHECK") {
        if (actualDiff === 0) {
          await doAction("CHECK");
        }
      } else if (chosenPreAction.type === "FOLD") {
        if (actualDiff > 0) {
          await doAction("FOLD");
        } else {
          await doAction("CHECK");
        }
      } else if (chosenPreAction.type === "CALL_X") {
        if (actualDiff === chosenPreAction.amount) {
          await doAction("CALL");
        }
      } else if (chosenPreAction.type === "CALL_ANY") {
        if (actualDiff === 0) {
          await doAction("CHECK");
        } else {
          await doAction("CALL");
        }
      }
    };

    executeAutoAction();
  }, [localIsMyTurn, preAction, currentHand, actionLoading, localMyUid]);

  // Pre-action real-time cancellation based on other players' actions
  useEffect(() => {
    if (localIsMyTurn || !preAction || !currentHand || !localMyUid) return;

    const myRoundBet = currentHand.roundBets[localMyUid] ?? 0;
    const currentBet = currentHand.currentBet ?? 0;
    const actualDiff = Math.max(0, currentBet - myRoundBet);

    if (preAction.type === "CALL_X" && actualDiff !== preAction.amount) {
      setPreAction(null);
    } else if (preAction.type === "CHECK" && actualDiff > 0) {
      setPreAction(null);
    } else if (preAction.type === "FOLD" && actualDiff === 0) {
      setPreAction(null);
    }
  }, [currentHand, localIsMyTurn, preAction, localMyUid]);

  // Clear pre-action when stage or hand changes, and cover cards at start of hand
  useEffect(() => {
    if (!currentHand) return;
    if (currentHand.stage !== lastStage || currentHand.handNumber !== lastHandNumber) {
      setPreAction(null);
      if (currentHand.handNumber !== lastHandNumber) {
        setShowMyCards(false);
      }
      setLastStage(currentHand.stage);
      setLastHandNumber(currentHand.handNumber || 0);
    }
  }, [currentHand, lastStage, lastHandNumber]);


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

  const canCheck = isMyTurn && diffToCall === 0 && (myPlayer?.stack ?? 0) > 0;
  // Permetti call anche se lo stack è inferiore al diffToCall (all-in parziale)
  const canCall = isMyTurn && diffToCall > 0 && (myPlayer?.stack ?? 0) > 0;
  // L'importo effettivo che il giocatore pagherà per callare (cappato allo stack disponibile)
  const effectiveCallAmount = Math.min(diffToCall, myPlayer?.stack ?? 0);
  // Indica se fare CALL svuoterebbe completamente lo stack (all-in)
  const isGoingAllIn = canCall && effectiveCallAmount < diffToCall;
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

  const activePot = currentHand?.pots?.find(p => !p.settled);

  let disableSitToggle = false;
  if (inGame && currentHand) {
    if (myPlayer?.isSittingOut) {
      // Spettatore: non può sedersi durante la mano (solo tra una mano e l'altra)
      const handOver = currentHand.stage === "SHOWDOWN" && hasWinner;
      if (!handOver) {
        disableSitToggle = true;
      }
    } else if (!myPlayer?.isFolded && !(currentHand.stage === "SHOWDOWN" && hasWinner)) {
      // Giocatore attivo: bloccato durante tutta la mano finché il vincitore non è assegnato
      disableSitToggle = true;
    }
  }

  const disableEndGame = inGame && !!currentHand && !(currentHand.stage === "SHOWDOWN" && hasWinner);

  const inActiveHand = !!(
    inGame &&
    currentHand &&
    myPlayer &&
    !myPlayer.isFolded &&
    !myPlayer.isSittingOut &&
    (myPlayer.stack ?? 0) > 0 &&
    currentHand.stage !== "SHOWDOWN"
  );

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
  setShowEndGameConfirm(true);
}

async function confirmEndGameAction() {
  if (!isHost || !tableId) return;
  try {
    setShowEndGameConfirm(false);
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

    setBbClicks(0);
    setBetAmount(
      Math.max(min, Math.min(defaultValue, myMaxFinal))
    );
    setShowBetPanel(true);
  }

  function closeBetPanel() {
    setShowBetPanel(false);
  }

  function applyQuickBet(type: "1BB" | "HALF_POT" | "POT" | "MAX") {
  if (!currentHand || !myPlayer || !table) return;

    const bb = table.bigBlind || 10;
    const pot = currentHand.pot;
    const myMaxFinal = myRoundBet + myPlayer.stack;
    const baseMin =
      currentBet === 0
        ? bb
        : currentBet + (table.smallBlind || 5);

    let target = 0;
    if (type === "1BB") {
      const newClicks = bbClicks + 1;
      setBbClicks(newClicks);
      target = currentBet === 0 ? (bb * newClicks) : currentBet + (bb * newClicks);
    } else {
      setBbClicks(0); // L'utente ha selezionato altro, resettiamo la serie
      // Calcolo Pot-sized Raise
      const callDiff = currentBet - myRoundBet;
      const potAfterCall = pot + callDiff;

      if (type === "HALF_POT") {
        const raiseAmt = Math.floor(potAfterCall / 2);
        const roundedRaise = Math.floor(raiseAmt / 5) * 5;
        target = currentBet + roundedRaise;
      } else if (type === "POT") {
        const raiseAmt = potAfterCall;
        const roundedRaise = Math.floor(raiseAmt / 5) * 5;
        target = currentBet + roundedRaise;
      } else if (type === "MAX") {
        target = myMaxFinal;
      }

      // Nei calcoli Pot/Half-Pot, assicura che il rilancio raggiunga almeno il minimo legale
      target = Math.max(target, baseMin);
    }

    // Clamp al massimo consentito
    target = Math.min(target, myMaxFinal);
    if (target <= myRoundBet) {
      target = myRoundBet;
    }

    setBetAmount(target);
  }

  async function confirmBet() {
    if (!canBetOrRaise || !myPlayer) return;
    if (!betAmount || betAmount <= myRoundBet) {
      setActionError(t("table.invalidBet"));
      return;
    }
    if (betAmount % 5 !== 0) {
      setActionError(t("table.betMultipleOf5"));
      return;
    }
    await doAction("BET", betAmount);
    setShowBetPanel(false);
  }

  function renderRoleBadges(index: number) {
    if (!currentHand) return null;

    const badges: { type: string; label: string; className: string }[] = [];
    if (index === currentHand.dealerIndex) {
      badges.push({ type: "D", label: "D", className: "role-badge role-badge-d" });
    }
    if (index === currentHand.smallBlindIndex) {
      badges.push({ type: "SB", label: "SB", className: "role-badge role-badge-sb" });
    }
    if (index === currentHand.bigBlindIndex) {
      badges.push({ type: "BB", label: "BB", className: "role-badge role-badge-bb" });
    }

    if (badges.length === 0) return null;

    return (
      <div style={{ display: "flex", gap: "0.2rem", flexShrink: 0, marginLeft: "0.3rem" }}>
        {badges.map((b) => (
          <span key={b.type} className={b.className} title={b.label}>
            {b.label}
          </span>
        ))}
      </div>
    );
  }

  function getSeatPosition(index: number, total: number) {
    // index 0 is Me, placed at the bottom center (90 degrees or PI/2).
    // The others are spaced clockwise.
    const angle = Math.PI / 2 + index * (2 * Math.PI / total);

    const radiusX = 46; // Horizontal radius (wider, pushes seats to rails)
    const radiusY = 43; // Vertical radius (shorter, pushes seats to rails)
    const top = 50 + radiusY * Math.sin(angle);
    const left = 50 + radiusX * Math.cos(angle);

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
    setActionError(t("table.hostOnlyWinner"));
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
async function handleConfirmWinners(potId: string) {
  if (!user || !tableId) return;
  if (!currentHand || !votingOpen) return;
  if (!isHost) {
    setActionError("Solo l'host può confermare i vincitori.");
    return;
  }
  
  if (selectedWinners.length === 0) {
    setActionError(t("table.selectAtLeastOne"));
    return;
  }
  
  try {
    setActionLoading(true);
    await confirmWinners(tableId, user, selectedWinners, potId);
    setSelectedWinners([]); // Reset selezione
    setActionError(null);
  } catch (err) {
    console.error(err);
    setActionError((err as any)?.message || "Errore durante la conferma dei vincitori.");
  } finally {
    setActionLoading(false);
  }
}

  // ---------- RENDER LOBBY ----------

  function renderLobby() {
    if (!table) return null;

    return (
      <div
        style={{
          minHeight: "100dvh",
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
          className="glass-panel"
          style={{
            width: "100%",
            maxWidth: "640px",
            padding: "2rem 1.5rem",
            display: "grid",
            gap: "1.2rem"
          }}
        >
        <header style={{ display: "grid", gap: "0.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.25rem" }}>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 600, margin: 0 }}>
              {table.name}{" "}
              <span style={{ fontSize: "0.9rem", opacity: 0.7 }}>
                <br/>(ID: {tableId})
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
    {t("table.lobbyPlayersCount", { count: players.length })}
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
    {t("table.leaveLobby")}
  </button>
</div>

          <p style={{ fontSize: "0.9rem", color: "#cbd5f5" }}>
            {t("table.blindsShort")} {table.smallBlind}/{table.bigBlind} • {t("table.startingStack")} {" "}
            {table.initialStack} • {t("table.state")} {table.state}
          </p>
          {isHost && (
            <p style={{ fontSize: "0.85rem", color: "#a5b4fc" }}>
              {t("table.youAreHost")}
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
                {t("table.playersReady", { ready: players.filter((p) => p.isReady).length, total: players.length })}
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
                {t("table.lobbyStartGame")}
              </button>
            </div>
          )}
        </header>

        <section style={{ display: "grid", gap: "0.5rem" }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 600 }}>{t("table.lobbyPlayersTitle")}</h2>

          {players.length === 0 ? (
            <p style={{ fontSize: "0.9rem", color: "#cbd5f5" }}>
              {t("table.noPlayersYet")}
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
                        {p.isSittingOut && <span style={{ color: "#facc15" }}>{t("table.pauseBadge")}</span>}
                        {p.displayName}
                    </span>
                    {isHostPlayer && (
                        <span
                        style={{
                            marginLeft: "0.35rem",
                            fontSize: "0.8rem",
                            color: "#facc15"
                        }}
                        >
                        {t("table.hostBadge")}
                        </span>
                    )}
                    <div
                        style={{
                        fontSize: "0.8rem",
                        color: "#9ca3af",
                        marginTop: "0.1rem"
                        }}
                    >
                        {t("table.seat")} {p.seatIndex} • {t("table.stack")} {p.stack} •{" "}
                        {p.isReady ? `${t("table.ready")} ✅` : t("table.notReady")}
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
                        {p.isReady ? t("table.notReady") : t("table.ready")}
                        </button>
                    )}

                    {isHost && (
                        <div style={{ display: "flex", gap: "0.25rem" }}>
                        {!isMe && (
                            <button
                                onClick={() => setTransferHostConfirmTarget(p.userId)}
                                style={{ ...smallButtonStyle, backgroundColor: "#facc15", color: "#000", fontSize: "0.85rem", padding: "0.15rem 0.3rem" }}
                                title={t("table.transferHost")}
                            >
                                👑
                            </button>
                        )}
                        <button
                            onClick={() => handleMoveUp(index)}
                            disabled={index === 0}
                            style={smallButtonStyle}
                            title={t("table.moveUp")}
                        >
                            ↑
                        </button>
                        <button
                            onClick={() => handleMoveDown(index)}
                            disabled={index === players.length - 1}
                            style={smallButtonStyle}
                            title={t("table.moveDown")}
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
          position: "fixed",
          top: 0, left: 0, right: 0, bottom: 0,
          display: "flex",
          flexDirection: "column",
          padding: "0.5rem",
          paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)",
          gap: "0.5rem",
          boxSizing: "border-box",
          overflow: "hidden",
          background: "radial-gradient(circle at 50% 20%, #0f172a 0%, #020617 80%, #000000 100%)",
          color: "var(--text-main)",
          fontFamily: "var(--font-sans)",
          zIndex: 1
        }}
      >
        <header style={{ display: "grid", gap: "0.25rem", paddingTop: "3rem" }}>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 800, fontFamily: "var(--font-display)" }}>
            {table.name}
          </h1>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: 0 }}>
            {t("table.hand")} #{currentHand?.handNumber ?? "-"} •{" "}
            {t("table.blinds")} {table.smallBlind}/{table.bigBlind}
            {table?.mode === "TOURNAMENT" && (
              <>
                {" • "}
                {t("table.level")} {(table.currentLevelIndex || 0) + 1}
                {timeRemainingStr && ` (${timeRemainingStr})`}
              </>
            )}
          </p>
          {/* Indicatore Side Pots — visibile solo quando esistono più pot */}
          {currentHand?.pots && currentHand.pots.length > 1 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.15rem" }}>
              {currentHand.pots.map((pot, i) => (
                <span
                  key={pot.id}
                  style={{
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    padding: "0.15rem 0.5rem",
                    borderRadius: "999px",
                    backgroundColor: pot.settled ? "rgba(74,222,128,0.15)" : "rgba(251,191,36,0.15)",
                    color: pot.settled ? "#4ade80" : "#fbbf24",
                    border: `1px solid ${pot.settled ? "#4ade8055" : "#fbbf2455"}`
                  }}
                >
                  {i === 0 ? "Main" : `Side ${i}`}: {pot.amount}
                  {!pot.settled && pot.eligible.length > 0 && (
                    <span style={{ opacity: 0.7, fontWeight: 400 }}> ({pot.eligible.length}👤)</span>
                  )}
                  {pot.settled && " ✓"}
                </span>
              ))}
            </div>
          )}
          <div
            style={{
              marginTop: "0.4rem",
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              fontSize: "0.8rem"
            }}
          >
            <div style={{ display: "flex", gap: "0.4rem" }}>
              {table?.mode !== "TOURNAMENT" && (
                <button
                  onClick={handleToggleSittingOut}
                  disabled={!!disableSitToggle}
                  style={{
                    padding: "0.35rem 0.75rem",
                    borderRadius: "999px",
                    border: "1px solid var(--color-warning)",
                    backgroundColor: "transparent",
                    color: disableSitToggle ? "var(--text-muted)" : "var(--color-warning)",
                    cursor: disableSitToggle ? "default" : "pointer",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    opacity: disableSitToggle ? 0.5 : 1
                  }}
                >
                  {myPlayer?.isSittingOut ? t("table.sitDown") : t("table.standUp")}
                </button>
              )}

              {isHost && !disableEndGame && table?.mode !== "TOURNAMENT" && (
                <button
                  onClick={handleEndGame}
                  className="poker-btn-primary"
                  style={{
                    padding: "0.35rem 0.75rem",
                    borderRadius: "999px",
                    border: "none",
                    backgroundColor: "var(--color-danger)",
                    color: "#ffffff",
                    cursor: "pointer",
                    fontWeight: 700,
                    boxShadow: "0 2px 8px rgba(239, 68, 68, 0.3)"
                  }}
                >
                  {t("table.endGame")}
                </button>
              )}
              {isHost && inGame && (
                <button
                  onClick={() => setShowSettings(s => !s)}
                  title="Impostazioni"
                  style={{
                    padding: "0.35rem 0.55rem",
                    borderRadius: "999px",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    backgroundColor: showSettings ? "rgba(255, 255, 255, 0.1)" : "transparent",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: "1rem",
                    lineHeight: 1
                  }}
                >
                  ⚙️
                </button>
              )}
            </div>
          </div>

        </header>

        <main
          style={{
            flex: 1,
            position: "relative",
            minHeight: 0,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            overflow: "hidden"
          }}
        >

          <div
            className="poker-felt"
            style={{
              width: "min(100%, 530px)"
            }}
          >
            {/* Testo centrale: pot, stage, turno e community cards */}
            <div style={{
              position: "absolute",
              top: "32%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              textAlign: "center",
              zIndex: 14
            }}>
              <span style={{ fontSize: "0.7rem", color: "rgba(255, 255, 255, 0.6)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block" }}>
                {t("table.pot")}
              </span>
              <span style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--color-warning)", textShadow: "0 2px 4px rgba(0,0,0,0.6)" }}>
                🪙 {currentHand?.pot ?? 0}
              </span>
            </div>

            {table?.isVirtualCards && currentHand && (
              <div
                style={{
                  position: "absolute",
                  top: "52%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  display: "flex",
                  gap: "0.3rem",
                  zIndex: 15,
                  flexWrap: "wrap",
                  justifyContent: "center",
                  width: "min(100%, 280px)"
                }}
              >
                {currentHand.communityCards?.map((card, idx) => {
                  let hidden = true;
                  if (currentHand.stage === "FLOP" && idx < 3) hidden = false;
                  if (currentHand.stage === "TURN" && idx < 4) hidden = false;
                  if (currentHand.stage === "RIVER" && idx < 5) hidden = false;
                  if (currentHand.stage === "SHOWDOWN") hidden = false;
                  return <Card key={idx} card={card} hidden={hidden} />;
                })}
              </div>
            )}

            <div style={{
              position: "absolute",
              top: "70%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              textAlign: "center",
              zIndex: 14,
              width: "160px"
            }}>
              <div style={{ fontSize: "0.7rem", color: "rgba(255, 255, 255, 0.6)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {currentHand?.stage ?? "N/A"}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-main)", fontWeight: 700, marginTop: "0.15rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {isMyTurn
                  ? t("table.yourTurn")
                  : currentHand &&
                    currentHand.currentTurnIndex != null &&
                    currentHand.currentTurnIndex >= 0 &&
                    players[currentHand.currentTurnIndex]
                  ? t("table.turnOf", { name: players[currentHand.currentTurnIndex].displayName })
                  : t("table.waitingTurn")}
              </div>
            </div>

            {/* Giocatori e Fiches puntate attorno al tavolo */}
            {players.map((p, index) => {
              const myIndex = players.findIndex(orig => orig.userId === myUid);
              const visualIndex = myIndex >= 0 ? (index - myIndex + players.length) % players.length : index;
              const { top, left } = getSeatPosition(visualIndex, players.length);
              const isMe = myUid === p.userId;
              const isTurn =
                currentHand &&
                currentHand.currentTurnIndex === index &&
                !p.isFolded;

              const isEligibleForActivePot = activePot 
                ? activePot.eligible?.includes(p.userId) 
                : (!p.isFolded && !p.isSittingOut);

              const roundBet = currentHand && currentHand.roundBets[p.userId] ? currentHand.roundBets[p.userId] : 0;
              const hasVirtualCardsDealt = isMe && table?.isVirtualCards && currentHand && currentHand.stage !== "SHOWDOWN" && currentHand.playerHands?.[p.userId] && !p.isFolded;
              
              const angle = Math.PI / 2 + visualIndex * (2 * Math.PI / players.length);
              const isOnRightSide = Math.cos(angle) > 0.01;

              return (
                <div
                  key={p.id}
                  style={{
                    position: "absolute",
                    top,
                    left,
                    transform: "translate(-50%, -50%)",
                    width: (isMe && showMyCards) ? "32%" : "22%",
                    maxWidth: (isMe && showMyCards) ? "150px" : "120px",
                    zIndex: 10
                  }}
                >
                  {/* Carte del giocatore allo Showdown */}
                  {table?.isVirtualCards && currentHand?.stage === "SHOWDOWN" && currentHand.playerHands?.[p.userId] && !p.isFolded && (
                    <div style={{
                      position: "absolute",
                      top: "-45px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      display: "flex",
                      gap: "2px",
                      zIndex: 100
                    }}>
                      {currentHand.playerHands[p.userId].map((c, i) => (
                        <Card key={i} card={c} />
                      ))}
                    </div>
                  )}

                  {/* Le mie carte personali durante il gioco (al posto del pod capsule) */}
                  {hasVirtualCardsDealt && showMyCards ? (
                    <div 
                      className="my-cards-felt-display"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMyCards(false);
                      }}
                      style={{
                        display: "flex",
                        gap: "4px",
                        justifyContent: "center",
                        alignItems: "center",
                        width: "100%",
                        animation: "scaleIn 0.18s ease-out forwards",
                        cursor: "pointer"
                      }}
                    >
                      {currentHand.playerHands?.[p.userId]?.map((c, i) => (
                        <Card key={i} card={c} />
                      ))}
                    </div>
                  ) : (
                    <div
                      className={`player-pod ${isMe ? 'player-pod-me' : ''} ${isTurn ? 'player-pod-active-turn' : ''} ${p.isFolded ? 'player-pod-folded' : ''} ${p.isSittingOut ? 'player-pod-sitout' : ''}`}
                      onClick={() => {
                        if (hasVirtualCardsDealt) {
                          setShowMyCards(true);
                        }
                      }}
                      style={{
                        borderWidth: isTurn || (selectedWinners.includes(p.userId) && votingOpen) ? "2px" : "1px",
                        borderColor: isTurn || (selectedWinners.includes(p.userId) && votingOpen) ? "var(--color-success)" : undefined,
                        boxShadow: isTurn ? "0 0 15px var(--color-success-glow)" : undefined,
                        opacity: p.isSittingOut ? 0.4 : p.isFolded || (votingOpen && activePot && !isEligibleForActivePot) ? 0.6 : 1,
                        cursor: hasVirtualCardsDealt ? "pointer" : undefined
                      }}
                    >
                      <div style={{
                        display: "flex",
                        flexDirection: isOnRightSide ? "row-reverse" : "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        width: "100%",
                        gap: "0.4rem"
                      }}>
                        <span
                          style={{
                            fontWeight: 600,
                            color: p.isSittingOut ? "var(--text-muted)" : p.isFolded ? "#6b7280" : isMe ? "var(--color-success)" : "var(--text-main)",
                            textDecoration: p.isFolded && !p.isSittingOut ? "line-through" : "none",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            flexShrink: 1,
                            textAlign: isOnRightSide ? "right" : "left"
                          }}
                        >
                          {p.isSittingOut && table?.mode === "TOURNAMENT" && p.stack === 0 && (
                            <span style={{ color: "var(--color-danger)", paddingRight: "0.2rem", fontWeight: 700 }}>
                              [Out]
                            </span>
                          )}
                          {p.displayName}
                        </span>
                        {renderRoleBadges(index)}
                      </div>
                      <div
                        style={{
                          marginTop: "0.1rem",
                          color: "#94a3b8",
                          fontWeight: 600,
                          fontSize: "0.75rem",
                          textAlign: isOnRightSide ? "right" : "left"
                        }}
                      >
                        {p.stack}
                        {votingOpen && myVoteTargetId === p.userId && ` • ${t("table.yourChoice")}`}
                      </div>
                    </div>
                  )}

                  {/* Fiche puntata e badge di stato (Fold/Pause) posizionati in un layer relativo al suo pod */}
                  <div
                    style={{
                      position: "absolute",
                      bottom: "-6px",
                      left: isOnRightSide ? "-10px" : undefined,
                      right: isOnRightSide ? undefined : "-10px",
                      zIndex: 20,
                      display: "flex",
                      flexDirection: isOnRightSide ? "row" : "row-reverse",
                      gap: "0.25rem"
                    }}
                  >
                    {roundBet > 0 && !(isMe && showMyCards) && (
                      <div
                        style={{
                          backgroundColor: "rgba(15, 23, 42, 0.95)",
                          border: "1.5px solid var(--color-warning)",
                          color: "var(--color-warning)",
                          borderRadius: "999px",
                          padding: "0.25rem 0.55rem",
                          fontSize: "0.75rem",
                          fontWeight: "bold",
                          boxShadow: "0 3px 8px rgba(0,0,0,0.6), 0 0 8px rgba(251, 191, 36, 0.2)",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.25rem",
                          animation: "scaleIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
                          whiteSpace: "nowrap"
                        }}
                      >
                        🪙 {roundBet}
                      </div>
                    )}

                    {p.isFolded && !p.isSittingOut && (
                      <div
                        style={{
                          backgroundColor: "rgba(15, 23, 42, 0.95)",
                          border: "1.5px solid var(--color-danger)",
                          color: "var(--color-danger)",
                          borderRadius: "999px",
                          fontSize: "0.68rem",
                          fontWeight: "bold",
                          boxShadow: "0 3px 8px rgba(0,0,0,0.6), 0 0 8px rgba(239, 68, 68, 0.2)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          animation: "scaleIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
                          width: "22px",
                          height: "22px",
                          minWidth: "22px"
                        }}
                        title={t("table.folded")}
                      >
                        F
                      </div>
                    )}

                    {p.isSittingOut && (
                      <div
                        style={{
                          backgroundColor: "rgba(15, 23, 42, 0.95)",
                          border: "1.5px solid #a78bfa",
                          color: "#a78bfa",
                          borderRadius: "999px",
                          fontSize: "0.68rem",
                          fontWeight: "bold",
                          boxShadow: "0 3px 8px rgba(0,0,0,0.6), 0 0 8px rgba(167, 139, 250, 0.2)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          animation: "scaleIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
                          width: "22px",
                          height: "22px",
                          minWidth: "22px"
                        }}
                        title={t("table.pauseBadge")}
                      >
                        P
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </main>

        {/* Action bar in basso */}
        <footer
          style={{
            position: "relative",
            display: "grid",
            gap: "0.5rem",
            paddingTop: "0.5rem",
            borderTop: "1px solid #1e293b",
            flexShrink: 0
          }}
        >


          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.4rem"
            }}
          >
            {/* Pulsanti azione */}
            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                width: "100%"
              }}
            >
              {table?.isVirtualCards && !isMyTurn && inActiveHand ? (
                <>
                  {/* Pre-action buttons */}
                  {diffToCall === 0 ? (
                    <>
                      {/* 1. CHECK/FOLD */}
                      <button
                        onClick={() => togglePreAction("CHECK_FOLD")}
                        style={{
                          ...pillActionButton,
                          flex: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: preAction?.type === "CHECK_FOLD" ? "#ef4444" : "rgba(15, 23, 42, 0.6)",
                          border: preAction?.type === "CHECK_FOLD" ? "1px solid transparent" : "1px solid rgba(239, 68, 68, 0.45)",
                          color: preAction?.type === "CHECK_FOLD" ? "#ffffff" : "rgba(239, 68, 68, 0.85)",
                          boxShadow: preAction?.type === "CHECK_FOLD" ? "0 2px 8px rgba(239, 68, 68, 0.35)" : "none",
                          transition: "all 0.2s ease"
                        }}
                      >
                        Check/Fold
                      </button>
                      {/* 2. CHECK */}
                      <button
                        onClick={() => togglePreAction("CHECK")}
                        style={{
                          ...pillActionButton,
                          flex: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: preAction?.type === "CHECK" ? "#3b82f6" : "rgba(15, 23, 42, 0.6)",
                          border: preAction?.type === "CHECK" ? "1px solid transparent" : "1px solid rgba(59, 130, 246, 0.45)",
                          color: preAction?.type === "CHECK" ? "#ffffff" : "rgba(59, 130, 246, 0.85)",
                          boxShadow: preAction?.type === "CHECK" ? "0 2px 8px rgba(59, 130, 246, 0.35)" : "none",
                          transition: "all 0.2s ease"
                        }}
                      >
                        Check
                      </button>
                    </>
                  ) : (
                    <>
                      {/* 1. FOLD */}
                      <button
                        onClick={() => togglePreAction("FOLD")}
                        style={{
                          ...pillActionButton,
                          flex: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: preAction?.type === "FOLD" ? "#ef4444" : "rgba(15, 23, 42, 0.6)",
                          border: preAction?.type === "FOLD" ? "1px solid transparent" : "1px solid rgba(239, 68, 68, 0.45)",
                          color: preAction?.type === "FOLD" ? "#ffffff" : "rgba(239, 68, 68, 0.85)",
                          boxShadow: preAction?.type === "FOLD" ? "0 2px 8px rgba(239, 68, 68, 0.35)" : "none",
                          transition: "all 0.2s ease"
                        }}
                      >
                        Fold
                      </button>
                      {/* 2. CALL x */}
                      <button
                        onClick={() => togglePreAction("CALL_X", diffToCall)}
                        style={{
                          ...pillActionButton,
                          flex: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: preAction?.type === "CALL_X" ? "#f59e0b" : "rgba(15, 23, 42, 0.6)",
                          border: preAction?.type === "CALL_X" ? "1px solid transparent" : "1px solid rgba(245, 158, 11, 0.45)",
                          color: preAction?.type === "CALL_X" ? "#020617" : "rgba(245, 158, 11, 0.85)",
                          boxShadow: preAction?.type === "CALL_X" ? "0 2px 8px rgba(245, 158, 11, 0.35)" : "none",
                          transition: "all 0.2s ease"
                        }}
                      >
                        {t("table.call")} {diffToCall}
                      </button>
                    </>
                  )}
                  {/* 3. CALL ANY */}
                  <button
                    onClick={() => togglePreAction("CALL_ANY")}
                    style={{
                      ...pillActionButton,
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: preAction?.type === "CALL_ANY" ? "#22c55e" : "rgba(15, 23, 42, 0.6)",
                      border: preAction?.type === "CALL_ANY" ? "1px solid transparent" : "1px solid rgba(34, 197, 94, 0.45)",
                      color: preAction?.type === "CALL_ANY" ? "#020617" : "rgba(34, 197, 94, 0.85)",
                      boxShadow: preAction?.type === "CALL_ANY" ? "0 2px 8px rgba(34, 197, 94, 0.35)" : "none",
                      transition: "all 0.2s ease"
                    }}
                  >
                    Call Any
                  </button>
                </>
              ) : (
                <>
                  {/* Fold sempre disponibile se è il tuo turno */}
                  <button
                    disabled={!isMyTurn || actionLoading}
                    onClick={() => setShowFoldConfirm(true)}
                    style={{
                      ...pillActionButton,
                      backgroundColor: isMyTurn ? "#ef4444" : "#ef444433",
                      color: isMyTurn ? "#f8fafc" : "rgba(248, 250, 252, 0.4)",
                      boxShadow: isMyTurn ? "0 4px 12px rgba(239, 68, 68, 0.25)" : "none",
                      cursor: isMyTurn && !actionLoading ? "pointer" : "default"
                    }}
                  >
                    Fold
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
                      cursor: isMyTurn && (canCheck || canCall) && !actionLoading ? "pointer" : "default",
                      backgroundColor: isMyTurn && (canCheck || canCall)
                        ? (canCall ? "#f59e0b" : "#3b82f6")
                        : "#4b556333",
                      color: isMyTurn && (canCheck || canCall) ? "#f8fafc" : "rgba(248, 250, 252, 0.4)",
                      fontWeight: 600,
                      fontSize: "0.9rem",
                      textAlign: "center",
                      boxShadow: isMyTurn && (canCheck || canCall)
                        ? (canCall ? "0 4px 12px rgba(245, 158, 11, 0.25)" : "0 4px 12px rgba(59, 130, 246, 0.25)")
                        : "none",
                      transition: "all 0.2s"
                    }}
                  >
                    {!isMyTurn
                      ? t("table.waitingTurn")
                      : canCall
                      ? isGoingAllIn
                        ? `ALL IN ${effectiveCallAmount}`
                        : `${t("table.call")} ${effectiveCallAmount}`
                      : canCheck
                      ? t("table.check")
                      : "—"}
                  </button>

                  {/* Bottone Bet/Raise + pannello */}
                  <button
                    disabled={!isMyTurn || actionLoading || !canBetOrRaise}
                    onClick={openBetPanel}
                    style={{
                      ...pillActionButton,
                      backgroundColor: isMyTurn && canBetOrRaise ? "#22c55e" : "#22c55e33",
                      color: isMyTurn && canBetOrRaise ? "#020617" : "rgba(248, 250, 252, 0.4)",
                      boxShadow: isMyTurn && canBetOrRaise ? "0 4px 12px rgba(34, 197, 94, 0.25)" : "none",
                      cursor: isMyTurn && canBetOrRaise && !actionLoading ? "pointer" : "default"
                    }}
                  >
                    {currentBet === 0 && myRoundBet === 0 ? t("table.bet") : t("table.raise")}
                  </button>
                </>
              )}
            </div>
          </div>

        </footer>
        
        {/* pannello bet/raise in sovraimpressione */}
        {showBetPanel && isMyTurn && myPlayer && (
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 60,
              padding: "1.5rem",
              paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
              borderTopLeftRadius: "1.5rem",
              borderTopRightRadius: "1.5rem",
              borderTop: "1px solid #1e293b",
              backgroundColor: "rgba(15,23,42,0.98)",
              boxShadow: "0 -10px 40px rgba(0,0,0,0.8)",
              display: "grid",
              gap: "1.2rem"
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto 1fr",
                alignItems: "center",
                fontSize: "0.95rem",
                color: "#e5e7eb"
              }}
            >
              <span style={{ textAlign: "left" }}>
                {currentBet === 0 && myRoundBet === 0 ? t("table.bet") : t("table.raise")}: <strong>{betAmount - (currentHand?.currentBet ?? 0)}</strong>
              </span>
              <div style={{ textAlign: "center", color: "#22c55e", fontWeight: "bold", fontSize: "1.1rem" }}>
                {t("table.totalBet")}: {betAmount}
              </div>
              <span style={{ textAlign: "right", color: "#9ca3af", fontSize: "0.9rem" }}>
                Stack: {myPlayer.stack}
              </span>
            </div>

            <input
              type="range"
              min={currentBet+5}
              step={5}
              max={myRoundBet + myPlayer.stack}
              value={betAmount}
              onChange={(e) => {
                setBetAmount(Number(e.target.value));
                setBbClicks(0);
              }}
              style={{ padding: "0.5rem 0" }}
            />

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "0.5rem"
              }}
            >
              <button
                onClick={() => applyQuickBet("1BB")}
                style={{ ...quickBetButtonStyle, padding: "0.6rem", fontSize: "0.9rem" }}
              >
                1 BB
              </button>
              <button
                onClick={() => applyQuickBet("HALF_POT")}
                style={{ ...quickBetButtonStyle, padding: "0.6rem", fontSize: "0.9rem" }}
              >
                ½ Pot
              </button>
              <button
                onClick={() => applyQuickBet("POT")}
                style={{ ...quickBetButtonStyle, padding: "0.6rem", fontSize: "0.9rem" }}
              >
                Pot
              </button>
              <button
                onClick={() => applyQuickBet("MAX")}
                style={{ ...quickBetButtonStyle, padding: "0.6rem", fontSize: "0.9rem", color: "#f87171", fontWeight: 700 }}
              >
                All-In
              </button>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "1rem",
                marginTop: "0.5rem"
              }}
            >
              <button
                onClick={closeBetPanel}
                style={{
                  flex: 1,
                  padding: "0.8rem 1rem",
                  borderRadius: "999px",
                  border: "1px solid #4b5563",
                  backgroundColor: "transparent",
                  color: "#e5e7eb",
                  fontSize: "1rem",
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                {t("table.cancel")}
              </button>
              <button
                onClick={confirmBet}
                disabled={actionLoading}
                style={{
                  flex: 1,
                  padding: "0.8rem 1rem",
                  borderRadius: "999px",
                  border: "none",
                  backgroundColor: "#22c55e",
                  color: "#020617",
                  fontWeight: 700,
                  fontSize: "1rem",
                  cursor: "pointer"
                }}
              >
                {t("table.putInPot")}
              </button>
            </div>
          </div>
        )}
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
        minHeight: "100dvh",
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
            {t("table.summaryTitle")}
          </h2>
          <p style={{ fontSize: "0.9rem", color: "#9ca3af" }}>
            {t("table.tableName")}:{" "}
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
          <div>{t("table.sessionDuration")}: {durata}</div>
          <div>{t("table.handsPlayed")}: {handsPlayed}</div>
          <div style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
            {t("table.summaryDisclaimer")}
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
            {t("table.finalStacks")}
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
            {[...players].sort((a, b) => {
              if (table?.mode === "TOURNAMENT") {
                if (a.stack !== b.stack) return b.stack - a.stack;
                const aTime = a.eliminatedAt || 0;
                const bTime = b.eliminatedAt || 0;
                return bTime - aTime; // higher timestamp = later elimination = better rank
              }
              return 0;
            }).map((p, idx) => {
              const totalInvested = (p as any).totalBuyIn || table?.initialStack || 0;
              const diff = p.stack - totalInvested;
              const isPositive = diff > 0;
              const isNegative = diff < 0;

              let diffText = "-";
              let diffColor = "#9ca3af";

              if (isPositive) {
                diffText = `+${diff}`;
                diffColor = "#22c55e";
              } else if (isNegative) {
                diffText = `${diff}`;
                diffColor = "#ef4444";
              }

              const isTournament = table?.mode === "TOURNAMENT";

              return (
                <li
                  key={p.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.3rem",
                    padding: "0.5rem 0.8rem",
                    borderRadius: "0.5rem",
                    backgroundColor: "rgba(15,23,42,0.9)",
                    border: "1px solid #1e293b",
                    fontSize: "0.9rem"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, color: "#f8fafc" }}>
                      {isTournament && <span style={{ marginRight: "0.5rem", color: "#fbbf24" }}>#{idx + 1}</span>}
                      {p.displayName}
                    </span>
                    {!isTournament && (
                      <span style={{ fontSize: "1rem", color: diffColor, fontWeight: 700 }}>
                        {t("table.netProfit")}: {diffText}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#94a3b8" }}>
                    {!isTournament && <span>{t("table.invested")}: <strong style={{ color: "#e2e8f0" }}>{totalInvested}</strong></span>}
                    <span style={isTournament ? { marginLeft: "auto" } : {}}>{t("table.finalStack")}: <strong style={{ color: "#e2e8f0", fontSize: isTournament ? "1rem" : "inherit" }}>{p.stack}</strong></span>
                  </div>
                </li>
              );
            })}
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
          {t("table.backHome")}
        </button>
      </div>
    </div>
  );
}

  
  // ---------- RENDER ROOT ----------

  const inviteLink = `${window.location.origin}/join?tableId=${tableId}${table?.password ? `&pwd=${table.password}` : ""}`;

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
        <h2 style={{ fontSize: "1.4rem", margin: 0, color: "#e2e8f0" }}>{t("table.invite")}</h2>
        <div style={{ background: "white", padding: "1.2rem", borderRadius: "1rem", display: "inline-block", margin: "0 auto" }}>
          <QRCodeSVG value={inviteLink} size={200} />
        </div>
        <p style={{ margin: 0, fontSize: "0.9rem", color: "#9ca3af" }}>
          {t("table.inviteDesc")}
        </p>
        <button 
          onClick={async () => {
            if (navigator.share) {
              try {
                await navigator.share({
                  title: 'AirPoker',
                  text: t("table.inviteDesc"),
                  url: inviteLink,
                });
              } catch (e) {
                console.error("Condivisione annullata o fallita", e);
              }
            } else {
              navigator.clipboard.writeText(inviteLink);
              alert(t("table.linkCopied"));
            }
          }}
          style={{
            background: "linear-gradient(135deg, #3b82f6, #2563eb)", color: "#ffffff", border: "none", padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontWeight: 700, fontSize: "0.95rem"
          }}
        >
          {typeof navigator.share === "function" ? t("table.shareLink") : t("table.copyLink")}
        </button>
        <button 
          onClick={() => setShowShareModal(false)}
          style={{
            background: "transparent", color: "#9ca3af", border: "none", padding: "0.5rem", cursor: "pointer", fontWeight: 600, fontSize: "0.9rem"
          }}
        >
          {t("table.close")}
        </button>
      </div>
    </div>
  );
  const foldConfirmModalUI = showFoldConfirm && (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(2, 6, 23, 0.8)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000
    }}>
      <div style={{
        background: "rgba(15,23,42,0.95)", border: "1px solid #1e293b",
        borderRadius: "1.5rem", padding: "2rem", display: "grid", gap: "1.5rem",
        textAlign: "center", maxWidth: "340px", width: "90%",
        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)"
      }}>
        <h2 style={{ fontSize: "1.3rem", margin: 0, color: "#e2e8f0" }}>{t("table.confirmFold")}</h2>
        
        <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem", marginTop: "0.5rem" }}>
          <button 
            onClick={() => {
              setShowFoldConfirm(false);
              doAction("FOLD");
            }}
            style={{
              background: "#ef4444", color: "#ffffff", border: "none", padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontWeight: 700, fontSize: "0.95rem"
            }}
          >
            {t("table.foldYes")}
          </button>
          <button 
            onClick={() => setShowFoldConfirm(false)}
            style={{
              background: "transparent", color: "#9ca3af", border: "1px solid #374151", padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontWeight: 600, fontSize: "0.95rem"
            }}
          >
            {t("table.foldNo")}
          </button>
        </div>
      </div>
    </div>
  );

  const endGameConfirmModalUI = showEndGameConfirm && (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(2, 6, 23, 0.8)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000
    }}>
      <div style={{
        background: "rgba(15,23,42,0.95)", border: "1px solid #1e293b",
        borderRadius: "1.5rem", padding: "2rem", display: "grid", gap: "1.5rem",
        textAlign: "center", maxWidth: "340px", width: "90%",
        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)"
      }}>
        <h2 style={{ fontSize: "1.3rem", margin: 0, color: "#e2e8f0" }}>{t("table.confirmEndGame")}</h2>
        
        <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem", marginTop: "0.5rem" }}>
          <button 
            onClick={confirmEndGameAction}
            style={{
              background: "#ef4444", color: "#ffffff", border: "none", padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontWeight: 700, fontSize: "0.95rem"
            }}
          >
            {t("table.endGameYes")}
          </button>
          <button 
            onClick={() => setShowEndGameConfirm(false)}
            style={{
              background: "transparent", color: "#9ca3af", border: "1px solid #374151", padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontWeight: 600, fontSize: "0.95rem"
            }}
          >
            {t("table.endGameNo")}
          </button>
        </div>
      </div>
    </div>
  );

  const transferHostConfirmModalUI = transferHostConfirmTarget && (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(2, 6, 23, 0.8)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000
    }}>
      <div style={{
        background: "rgba(15,23,42,0.95)", border: "1px solid #1e293b",
        borderRadius: "1.5rem", padding: "2rem", display: "grid", gap: "1.5rem",
        textAlign: "center", maxWidth: "340px", width: "90%",
        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)"
      }}>
        <h2 style={{ fontSize: "1.3rem", margin: 0, color: "#e2e8f0" }}>{t("table.transferHost")}</h2>
        <p style={{ margin: 0, fontSize: "0.9rem", color: "#9ca3af" }}>
          {t("table.confirmTransferHost")}
        </p>
        
        <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem", marginTop: "0.5rem" }}>
          <button 
            onClick={async () => {
              try {
                if (transferHostConfirmTarget && user && tableId) {
                  await transferHost(tableId, user, transferHostConfirmTarget);
                  setTransferHostConfirmTarget(null);
                  setShowSettings(false);
                }
              } catch (e: any) {
                console.error(e);
              }
            }}
            style={{
              background: "#eab308", color: "#000000", border: "none", padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontWeight: 700, fontSize: "0.95rem"
            }}
          >
            {t("table.transferHost")}
          </button>
          <button 
            onClick={() => setTransferHostConfirmTarget(null)}
            style={{
              background: "transparent", color: "#9ca3af", border: "1px solid #374151", padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontWeight: 600, fontSize: "0.95rem"
            }}
          >
            {t("table.cancel") || "Annulla"}
          </button>
        </div>
      </div>
    </div>
  );

  /* ─── Force Fold Confirm Modal ─── */
  const forceFoldConfirmModalUI = forceFoldConfirmTarget && (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(2, 6, 23, 0.85)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000
    }}>
      <div style={{
        background: "rgba(15,23,42,0.95)", border: "1px solid #1e293b",
        borderRadius: "1.5rem", padding: "2rem", display: "grid", gap: "1.5rem",
        textAlign: "center", maxWidth: "340px", width: "90%",
        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)"
      }}>
        <h2 style={{ fontSize: "1.3rem", margin: 0, color: "#e2e8f0" }}>🃏 {t("table.forceFold")}</h2>
        <p style={{ margin: 0, fontSize: "0.9rem", color: "#9ca3af" }}>
          {t("table.confirmForceFold")}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
          <button
            onClick={async () => {
              if (forceFoldConfirmTarget && user && tableId) {
                try { 
                  await forceFoldPlayer(tableId, user, forceFoldConfirmTarget); 
                  setShowSettings(false);
                }
                catch (e: any) { setActionError(e.message); }
                setForceFoldConfirmTarget(null);
              }
            }}
            style={{ background: "#ef4444", color: "#fff", border: "none", padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontWeight: 700, fontSize: "0.95rem" }}
          >
            {t("table.forceFold")}
          </button>
          <button
            onClick={() => setForceFoldConfirmTarget(null)}
            style={{ background: "transparent", color: "#9ca3af", border: "1px solid #374151", padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontWeight: 600, fontSize: "0.95rem" }}
          >
            {t("table.cancel")}
          </button>
        </div>
      </div>
    </div>
  );

  let stageModalVisible = false;
  let stageModalTitle = "";
  let stageModalContent: React.ReactNode = null;
  let stageModalAction: React.ReactNode = null;
  let stageModalFooter: React.ReactNode = null;

  if (inGame && currentHand) {
    if (currentHand.stage === "SHOWDOWN" && hasWinner) {
      stageModalVisible = true;
      stageModalTitle = t("table.handOver");

      const winnerNames = currentHand.winnerIds && currentHand.winnerIds.length > 1
        ? currentHand.winnerIds.map(wId => players.find(p => p.userId === wId)?.displayName || t("table.unknown")).join(", ")
        : players.find(p => p.userId === currentHand.winnerId)?.displayName || t("table.unknown");

      // Check if this was a fold-out win (only 1 active player, no handResults)
      const isFoldOutWin = !currentHand.handResults || Object.keys(currentHand.handResults).length === 0;

      // Winner hand description
      const winnerResult = currentHand.handResults && currentHand.winnerIds?.[0] 
        ? currentHand.handResults[currentHand.winnerIds[0]] 
        : null;

      stageModalContent = (
        <div style={{ color: "#e2e8f0", fontSize: "1rem", display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 }}>
          {/* Winner announcement */}
          <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "#facc15", marginBottom: "0.5rem" }}>
            🏆 {winnerNames} 🏆
          </div>
          {winnerResult && (
            <div style={{ fontSize: "0.95rem", color: "#4ade80", fontWeight: 600, marginBottom: "0.75rem" }}>
              {winnerResult.rankName}
            </div>
          )}
          <div style={{ marginBottom: "1rem" }}>{t("table.pot")}: {currentHand.pot}</div>

          {/* Community Cards — only shown for virtual cards with actual showdown */}
          {currentHand.isVirtualCards && !isFoldOutWin && currentHand.communityCards && currentHand.communityCards.length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: "0.8rem", color: "#9ca3af", marginBottom: "0.4rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t("table.communityCards")}
              </div>
              <div style={{ display: "flex", gap: "0.35rem", justifyContent: "center", flexWrap: "wrap" }}>
                {currentHand.communityCards.map((card, idx) => (
                  <Card key={idx} card={card} />
                ))}
              </div>
            </div>
          )}

          {/* Player Hands — only shown for virtual cards with actual showdown */}
          {currentHand.isVirtualCards && !isFoldOutWin && currentHand.handResults && (
            <>
              <div style={{ fontSize: "0.8rem", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0, marginBottom: "0.4rem" }}>
                {t("table.playerHands")}
              </div>
              <div style={{ display: "grid", gap: "0.6rem", flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
              {players
                .filter(p => !p.isFolded && currentHand.playerHands?.[p.userId])
                .map(p => {
                  const result = currentHand.handResults?.[p.userId];
                  const isWinner = currentHand.winnerIds?.includes(p.userId);
                  return (
                    <div 
                      key={p.userId} 
                      style={{ 
                        display: "flex", 
                        alignItems: "center", 
                        gap: "0.6rem",
                        padding: "0.5rem 0.7rem",
                        borderRadius: "0.75rem",
                        backgroundColor: isWinner ? "rgba(34, 197, 94, 0.15)" : "rgba(30, 41, 59, 0.5)",
                        border: isWinner ? "1px solid rgba(34, 197, 94, 0.4)" : "1px solid transparent"
                      }}
                    >
                      {/* Player cards */}
                      <div style={{ display: "flex", gap: "0.2rem", flexShrink: 0 }}>
                        {currentHand.playerHands?.[p.userId]?.map((card, idx) => (
                          <Card key={idx} card={card} />
                        ))}
                      </div>
                      {/* Player info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ 
                          fontWeight: 600, 
                          fontSize: "0.85rem",
                          color: isWinner ? "#4ade80" : "#e2e8f0",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis"
                        }}>
                          {isWinner && "🏆 "}{p.displayName}
                        </div>
                        {result && (
                          <div style={{ fontSize: "0.75rem", color: isWinner ? "#86efac" : "#9ca3af", display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
                            <span>{result.rankName}</span>
                            {isWinner && (result as any).chipsWon > 0 && (
                              <span style={{ color: "#facc15", fontWeight: 700 }}>+{(result as any).chipsWon}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
            </>
          )}
        </div>
      );

      // Host controls inside the winner modal
      stageModalFooter = (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginTop: "0.5rem", paddingTop: "0.75rem", borderTop: "1px solid #1e293b" }}>
          {isHost && (
            <button onClick={handleNextHand} style={{ ...pillActionButton, width: "100%", padding: "0.8rem", fontSize: "1rem", backgroundColor: "#22c55e" }}>
              {t("table.nextHand")}
            </button>
          )}
          {isHost && table?.mode !== "TOURNAMENT" && (
            <button
              onClick={handleEndGame}
              style={{ width: "100%", padding: "0.65rem", borderRadius: "999px", border: "none", backgroundColor: "#ef4444", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: "0.9rem" }}
            >
              {t("table.endGame")}
            </button>
          )}
          {isHost && (
            <button
              onClick={() => setShowSettings(s => !s)}
              style={{ width: "100%", padding: "0.65rem", borderRadius: "999px", border: "1px solid #4b5563", backgroundColor: "transparent", color: "#94a3b8", fontWeight: 600, cursor: "pointer", fontSize: "0.9rem" }}
            >
              ⚙️ {t("table.hostSettings")}
            </button>
          )}
          {/* Sit/Stand for all players */}
          {table?.mode !== "TOURNAMENT" && myPlayer && (
            <button
              onClick={handleToggleSittingOut}
              disabled={!!disableSitToggle}
              style={{ width: "100%", padding: "0.65rem", borderRadius: "999px", border: "1px solid #f59e0b", backgroundColor: "transparent", color: disableSitToggle ? "#6b7280" : "#fcd34d", fontWeight: 600, cursor: disableSitToggle ? "default" : "pointer", fontSize: "0.9rem", opacity: disableSitToggle ? 0.5 : 1 }}
            >
              {myPlayer?.isSittingOut ? t("table.sitDown") : t("table.standUp")}
            </button>
          )}
        </div>
      );

    } else if (currentHand.stage === "SHOWDOWN" && votingOpen) {
      stageModalVisible = true;
      stageModalTitle = "Showdown!";
      stageModalContent = (
        <div style={{ color: "#e2e8f0", fontSize: "1rem" }}>
          <div style={{ color: "#facc15", fontWeight: 700, fontSize: "1.1rem" }}>{t("table.flipCards")}</div>
          {isHost && activePot && (
            <div style={{ marginTop: "1rem", color: "#facc15" }}>
              {t("table.selectWinner")}
              <br/>
              <span style={{color: "#e2e8f0", fontSize: "0.85rem"}}>
                {currentHand.pots?.length && currentHand.pots.length > 1 ? `Main/Side Pot (${activePot.amount})` : `Pot (${activePot.amount})`}
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "center", marginTop: "1rem" }}>
                {players.filter(p => activePot ? activePot.eligible?.includes(p.userId) : (!p.isFolded && !p.isSittingOut)).map(p => (
                  <button
                    key={p.userId}
                    onClick={() => toggleWinnerSelection(p.userId)}
                    style={{
                      padding: "0.5rem 1rem",
                      borderRadius: "999px",
                      border: selectedWinners.includes(p.userId) ? "2px solid #22c55e" : "1px solid #4b5563",
                      backgroundColor: selectedWinners.includes(p.userId) ? "rgba(34,197,94,0.2)" : "rgba(15,23,42,0.8)",
                      color: selectedWinners.includes(p.userId) ? "#4ade80" : "#e2e8f0",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "0.9rem"
                    }}
                  >
                    {p.displayName}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      );
      if (isHost) {
        stageModalAction = (
          <button
            onClick={() => handleConfirmWinners(activePot?.id || "")}
            disabled={selectedWinners.length === 0 || actionLoading}
            style={{ ...pillActionButton, width: "100%", padding: "0.8rem", fontSize: "1rem", opacity: selectedWinners.length === 0 ? 0.5 : 1, backgroundColor: selectedWinners.length > 0 ? "#22c55e" : "#4b5563" }}
          >
            {selectedWinners.length > 1 ? t("table.confirmWinners") : t("table.confirmWinner")} ({selectedWinners.length})
          </button>
        );
      }
    } else if (currentHand.currentTurnIndex === -1) {
      stageModalVisible = true;
      if (currentHand.stage === "PREFLOP") {
        stageModalTitle = "Flop";
        stageModalContent = <div style={{ color: "#facc15", fontWeight: 700, fontSize: "1.1rem" }}>{currentHand.isVirtualCards ? t("table.virtualFlop") : t("table.dealFlop")}</div>;
        if (isHost) {
          stageModalAction = <button onClick={handleAdvanceStage} style={{ ...pillActionButton, width: "100%", padding: "0.8rem", fontSize: "1rem" }}>{t("table.continueFlop")}</button>;
        }
      } else if (currentHand.stage === "FLOP") {
        stageModalTitle = "Turn";
        stageModalContent = <div style={{ color: "#facc15", fontWeight: 700, fontSize: "1.1rem" }}>{currentHand.isVirtualCards ? t("table.virtualTurn") : t("table.dealTurn")}</div>;
        if (isHost) {
          stageModalAction = <button onClick={handleAdvanceStage} style={{ ...pillActionButton, width: "100%", padding: "0.8rem", fontSize: "1rem" }}>{t("table.continueTurn")}</button>;
        }
      } else if (currentHand.stage === "TURN") {
        stageModalTitle = "River";
        stageModalContent = <div style={{ color: "#facc15", fontWeight: 700, fontSize: "1.1rem" }}>{currentHand.isVirtualCards ? t("table.virtualRiver") : t("table.dealRiver")}</div>;
        if (isHost) {
          stageModalAction = <button onClick={handleAdvanceStage} style={{ ...pillActionButton, width: "100%", padding: "0.8rem", fontSize: "1rem" }}>{t("table.continueRiver")}</button>;
        }
      }
    } else if (blindsPopupVisible && currentHand.stage === "PREFLOP") {
      stageModalVisible = true;
      stageModalTitle = t("table.newHand");
      const sb = players[currentHand.smallBlindIndex]?.displayName;
      const bb = players[currentHand.bigBlindIndex]?.displayName;

      stageModalContent = (
        <div style={{ display: "grid", gap: "0.5rem", color: "#e2e8f0", fontSize: "0.95rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Small Blind:</span> <strong>{sb}</strong></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Big Blind:</span> <strong>{bb}</strong></div>
          <div style={{ marginTop: "0.8rem", color: "#facc15", fontWeight: 700 }}>{currentHand.isVirtualCards ? t("table.virtualDealCards") : t("table.dealCards")}</div>
        </div>
      );
      if (isHost) {
        stageModalAction = <button onClick={handleCloseBlindsPopup} style={{ ...pillActionButton, width: "100%", padding: "0.8rem", fontSize: "1rem" }}>{t("table.startNow")}</button>;
      }
    }
  }

  const stageModalUI = stageModalVisible && (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(2, 6, 23, 0.8)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      padding: "1rem"
    }}>
      <div style={{
        background: "rgba(15,23,42,0.95)", border: "1px solid #1e293b",
        borderRadius: "1.5rem", padding: "1.5rem", display: "flex", flexDirection: "column",
        textAlign: "center", maxWidth: "360px", width: "100%",
        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
        maxHeight: "calc(100dvh - 2rem)", overflow: "hidden", gap: "1rem"
      }}>
        {/* Title — pinned */}
        <h2 style={{ fontSize: "1.5rem", margin: 0, color: "#e2e8f0", flexShrink: 0 }}>{stageModalTitle}</h2>
        
        {/* Content — uses flex, hands list inside will scroll */}
        <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
          {stageModalContent}
        </div>

        {/* Action + Footer — pinned at bottom */}
        <div style={{ flexShrink: 0, display: "grid", gap: "0.75rem" }}>
          {stageModalAction}
          {stageModalFooter}
          {!isHost && !stageModalFooter && (
            <div style={{ color: "#9ca3af", fontSize: "0.85rem", fontStyle: "italic" }}>
              {t("table.waitingHost")}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  /* ─── Pannello Impostazioni Host ─── rendered AFTER stageModalUI to guarantee it's on top */
  const hostSettingsPanelUI = isHost && inGame && showSettings && (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(2, 6, 23, 0.8)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 5000
    }}>
      <div style={{
        background: "rgba(15,23,42,0.95)", border: "1px solid #1e293b",
        borderRadius: "1.5rem", padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem",
        maxWidth: "450px", width: "95%", boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
        maxHeight: "90vh", overflowY: "auto"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#e2e8f0" }}>
            ⚙️  {t("table.hostSettings")}
            {disableEndGame && (
              <span style={{ fontSize: "0.75rem", color: "#f97373", marginLeft: "0.5rem", fontWeight: 400 }}>
                {t("table.availableBetweenHands")}
              </span>
            )}
          </div>
          <button onClick={() => setShowSettings(false)} style={{ background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "1.2rem" }}>✕</button>
        </div>

        <div style={{ display: "grid", gap: "0.6rem" }}>
          {players.map((p, idx) => {
            const isTournament = table?.mode === "TOURNAMENT";
            const canRebuy = !isTournament && p.stack < (table?.bigBlind || 0);
            const isMe = myUid === p.userId;
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", padding: "0.5rem", backgroundColor: "rgba(30,41,59,0.5)", borderRadius: "0.5rem" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <button disabled={idx === 0 || disableEndGame} onClick={async () => { if (idx === 0 || !user) return; try { await swapPlayerSeats(tableId!, user, p.userId, players[idx - 1].userId); } catch (e: any) { setActionError(e.message); } }} style={{ padding: "0 0.4rem", fontSize: "0.7rem", cursor: idx === 0 || disableEndGame ? "default" : "pointer", opacity: idx === 0 || disableEndGame ? 0.3 : 1, background: "transparent", border: "1px solid #475569", borderRadius: "4px", color: "#e5e7eb" }}>▲</button>
                  <button disabled={idx === players.length - 1 || disableEndGame} onClick={async () => { if (idx === players.length - 1 || !user) return; try { await swapPlayerSeats(tableId!, user, p.userId, players[idx + 1].userId); } catch (e: any) { setActionError(e.message); } }} style={{ padding: "0 0.4rem", fontSize: "0.7rem", cursor: idx === players.length - 1 || disableEndGame ? "default" : "pointer", opacity: idx === players.length - 1 || disableEndGame ? 0.3 : 1, background: "transparent", border: "1px solid #475569", borderRadius: "4px", color: "#e5e7eb" }}>▼</button>
                </div>
                {!isMe && (<button onClick={() => setTransferHostConfirmTarget(p.userId)} style={{ padding: "0 0.4rem", fontSize: "0.85rem", cursor: "pointer", background: "transparent", border: "1px solid #ca8a04", borderRadius: "4px", color: "#facc15" }} title={t("table.transferHost")}>👑</button>)}
                {!isMe && inGame && currentHand && currentHand.currentTurnIndex === idx && (
                  <button onClick={() => setForceFoldConfirmTarget(p.userId)} style={{ padding: "0 0.4rem", fontSize: "0.85rem", cursor: "pointer", background: "transparent", border: "1px solid #ef4444", borderRadius: "4px", color: "#f87171" }} title={t("table.forceFold")}>🃏</button>
                )}
                <span style={{ flex: 1, fontSize: "0.85rem", color: "#f8fafc", minWidth: "100px", fontWeight: 500 }}>{p.displayName} <span style={{ color: "#94a3b8", fontWeight: 400 }}>({p.stack})</span></span>
                {canRebuy ? (
                  <>
                    <input type="number" min={5} step={5} placeholder={isTournament ? "Add-on" : "Rebuy"} disabled={disableEndGame} value={rebuyAmounts[p.userId] ?? ""} onChange={e => setRebuyAmounts(prev => ({ ...prev, [p.userId]: Number(e.target.value) }))} style={{ width: "75px", padding: "0.35rem 0.5rem", borderRadius: "0.4rem", border: "1px solid #475569", backgroundColor: "#0f172a", color: "#f8fafc", fontSize: "0.85rem", opacity: disableEndGame ? 0.5 : 1 }} />
                    <button disabled={disableEndGame || !rebuyAmounts[p.userId] || rebuyAmounts[p.userId] <= 0 || actionLoading} onClick={async () => { const amount = rebuyAmounts[p.userId]; if (!amount || !user) return; setActionLoading(true); try { await addChips(tableId!, user, p.userId, amount); setRebuyAmounts(prev => { const n = { ...prev }; delete n[p.userId]; return n; }); } catch (e: any) { setActionError(e.message); } finally { setActionLoading(false); } }} style={{ padding: "0.35rem 0.7rem", borderRadius: "999px", border: "none", backgroundColor: rebuyAmounts[p.userId] > 0 && !disableEndGame ? "#3b82f6" : "#475569", color: "#fff", fontSize: "0.8rem", fontWeight: 600, cursor: rebuyAmounts[p.userId] > 0 && !disableEndGame ? "pointer" : "default", opacity: disableEndGame ? 0.5 : 1 }}>+ Chips</button>
                  </>
                ) : (!isTournament && (<span style={{ fontSize: "0.8rem", color: "#94a3b8", fontStyle: "italic", marginLeft: "auto" }}>{t("table.stackOk")}</span>))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );



  const actionErrorUI = actionError && (
    <div style={{
      position: "fixed", top: "2rem", left: "50%", transform: "translateX(-50%)",
      background: "#fecaca", color: "#b91c1c", padding: "0.75rem 1.25rem", borderRadius: "1rem",
      fontSize: "0.9rem", border: "1px solid #f87171", zIndex: 20000, textAlign: "center",
      boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.5)", fontWeight: 600,
      display: "flex", alignItems: "center", gap: "0.5rem"
    }}>
      <span>⚠️ {t(actionError)}</span>
      <button onClick={() => setActionError(null)} style={{ background: "transparent", border: "none", color: "#b91c1c", cursor: "pointer", fontSize: "1.2rem", padding: "0 0.2rem" }}>✕</button>
    </div>
  );

  return (
    <>
      <style>{`
        @keyframes scaleIn {
          from { transform: scale(0.8); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>
      {inLobby && renderLobby()}
      {inGame && renderGame()}
      {inSummary && renderSummary()}
      {modalUI}
      {foldConfirmModalUI}
      {endGameConfirmModalUI}
      {transferHostConfirmModalUI}
      {forceFoldConfirmModalUI}
      {actionErrorUI}
      {/* Popups specifici del gioco */}
      {inGame && (
        <>
          {stageModalUI}
          {hostSettingsPanelUI}
        </>
      )}
    </>
  );
}

const smallButtonStyle: React.CSSProperties = {
  padding: "0.3rem 0.6rem",
  borderRadius: "0.5rem",
  border: "1px solid rgba(255, 255, 255, 0.08)",
  cursor: "pointer",
  backgroundColor: "rgba(15, 23, 42, 0.6)",
  color: "var(--text-main)",
  fontSize: "0.8rem",
  fontWeight: 600,
  transition: "all 0.2s"
};


const pillActionButton: React.CSSProperties = {
  padding: "0.65rem 1rem",
  borderRadius: "999px",
  border: "none",
  cursor: "pointer",
  backgroundColor: "rgba(15, 23, 42, 0.6)",
  color: "#f8fafc",
  fontWeight: 700,
  fontSize: "0.9rem",
  minWidth: "80px",
  textAlign: "center",
  boxShadow: "0 2px 5px rgba(0,0,0,0.3)",
  transition: "all 0.2s"
};

const quickBetButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: "0.45rem 0.6rem",
  borderRadius: "0.6rem",
  border: "1px solid rgba(255, 255, 255, 0.08)",
  cursor: "pointer",
  backgroundColor: "rgba(15, 23, 42, 0.65)",
  color: "var(--text-main)",
  fontSize: "0.85rem",
  fontWeight: 600,
  boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
  transition: "all 0.2s"
};
