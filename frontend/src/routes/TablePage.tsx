import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { useTranslation } from "react-i18next";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  serverTimestamp,
  where,
  setDoc
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
  quitGame,
  kickPlayer,
  endGame,
  advanceStage,
  confirmWinners,
  startNextHand,
  addChips,
  swapPlayerSeats,
  transferHost,
  forceFoldPlayer,
  joinTable
} from "../lib/firestoreApi";
import { Users, ShieldAlert } from "lucide-react";

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
  gameStartedAt?: any;
}





interface PlayerData {
  id: string;
  stack: number;
  seatIndex: number;
  isReady: boolean;
  userId: string;
  isFolded: boolean;
  isSittingOut?: boolean;
  isAllIn?: boolean;
  totalBuyIn?: number;
  eliminatedAt?: number;
  hasLeft?: boolean;
}

const Card = ({ card, hidden, mini, miniMe, flipDelay }: { card?: string, hidden?: boolean, mini?: boolean, miniMe?: boolean, flipDelay?: number }) => {
  const miniClass = miniMe ? 'poker-card-mini-me' : (mini ? 'poker-card-mini-others' : '');
  
  const rank = card ? card.slice(0, -1) : "";
  const suit = card ? card.slice(-1) : "";
  const isRed = suit === 'h' || suit === 'd';
  
  const suitIcon = {
    'h': '♥️',
    'd': '♦️',
    's': '♠️',
    'c': '♣️'
  }[suit] || suit;

  const rankDisplay = rank === 'T' ? '10' : rank;

  return (
    <div className={`poker-card-3d-container ${!hidden ? 'is-flipped' : ''} ${miniClass}`}>
      <div 
        className="poker-card-3d-inner"
        style={{
          transitionDelay: flipDelay ? `${flipDelay}ms` : undefined
        }}
      >
        <div className={`poker-card-3d-back ${miniClass}`} />
        <div className={`poker-card-3d-front ${isRed ? 'poker-card-red' : 'poker-card-black'} ${miniClass}`}>
          <div className="poker-card-corner-top">{rankDisplay}</div>
          <div className="poker-card-center-suit">{suitIcon}</div>
          <div className="poker-card-corner-bottom">{rankDisplay}</div>
        </div>
      </div>
    </div>
  );
};

const PokerChip = ({ size = 16, style }: { size?: number; style?: React.CSSProperties }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ display: "inline-block", verticalAlign: "middle", ...style }}
  >
    {/* Outer circle - Dark slate/black base with gold border */}
    <circle cx="12" cy="12" r="11" fill="#0f172a" stroke="#fbbf24" strokeWidth="1.2" />
    {/* Outer stripes - Luxury gold dashed pattern */}
    <circle cx="12" cy="12" r="9.5" stroke="#fbbf24" strokeWidth="1.2" strokeDasharray="3 2.5" opacity="0.9" />
    {/* Inner circle - Dark inlay with gold border */}
    <circle cx="12" cy="12" r="6.8" fill="#1e293b" stroke="#fbbf24" strokeWidth="0.8" />
    <circle cx="12" cy="12" r="5.5" fill="#0f172a" />
    {/* Center text "AP" in gold */}
    <text
      x="12"
      y="15.2"
      fill="#fbbf24"
      fontSize="8"
      fontWeight="900"
      fontFamily="sans-serif"
      textAnchor="middle"
      letterSpacing="-0.5"
    >
      AP
    </text>
  </svg>
);

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
  revealedPlayers?: Record<string, boolean>;
}

export default function TablePage() {
  useWakeLock();
  const { t } = useTranslation();

  const { tableId: rawTableId } = useParams();
  const tableId = rawTableId?.toLowerCase();
  const { user, username, isRegisteredUser } = useAuth();

  // Presence heartbeat inside TablePage
  useEffect(() => {
    if (!user || !tableId) return;

    const updatePresence = () => {
      updateDoc(doc(db, "users", user.uid), {
        "presence.status": "ONLINE",
        "presence.location": "TABLE",
        "presence.tableId": tableId,
        "presence.lastActive": serverTimestamp()
      }).catch(() => {
        // Safe to ignore if user document doesn't exist (e.g. guest user)
      });
    };

    updatePresence();
    const interval = setInterval(updatePresence, 30000);

    return () => {
      clearInterval(interval);
      updateDoc(doc(db, "users", user.uid), {
        "presence.location": null,
        "presence.tableId": null
      }).catch(() => {});
    };
  }, [user, tableId]);

  const [selectedWinners, setSelectedWinners] = useState<string[]>([]);
  const [table, setTable] = useState<TableData | null>(null);
  const [players, setPlayers] = useState<PlayerData[]>([]);
  const [playersLoaded, setPlayersLoaded] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [linkCopiedMsg, setLinkCopiedMsg] = useState(false);
  const [currentHand, setCurrentHand] = useState<ExtendedHandData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Join modal state (when not seated)
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  // Guard: set to true when the user intentionally leaves so the auto-join
  // useEffect cannot re-trigger a join before the component unmounts
  const hasLeftRef = useRef(false);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [showBetPanel, setShowBetPanel] = useState(false);
  const [betAmount, setBetAmount] = useState<number>(0);
  const [bbClicks, setBbClicks] = useState<number>(0);
  const [showSettings, setShowSettings] = useState(false);
  const [rebuyAmounts, setRebuyAmounts] = useState<Record<string, number>>({});
  const [showFoldConfirm, setShowFoldConfirm] = useState(false);
  const [showEndGameConfirm, setShowEndGameConfirm] = useState(false);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [transferHostConfirmTarget, setTransferHostConfirmTarget] = useState<string | null>(null);
  const [forceFoldConfirmTarget, setForceFoldConfirmTarget] = useState<string | null>(null);
  const [kickConfirmTarget, setKickConfirmTarget] = useState<string | null>(null);
  const [showMyCards, setShowMyCards] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  // Tracks the last hand stage we reacted to, so the flip-lock above can be set
  // synchronously during render the instant the stage changes (see effect below).
  const [prevFlipStage, setPrevFlipStage] = useState<string | undefined>(undefined);
  // What's actually painted on each of the 5 community card slots. This is intentionally
  // NOT just `currentHand.communityCards` — that would update the instant Firestore sends
  // the next hand's real cards, so the "flip back to hidden" animation between hands would
  // either show the next hand's cards early (a leak) or, if we blanked it, show a bare
  // white face instead of the hand that just ended (looks broken). Instead we only commit
  // a slot's real value into this cache at the exact moment that slot is due to be revealed
  // for whichever hand is current; while a slot is hidden, it keeps showing whatever it last
  // legitimately revealed, so the outgoing flip animates the correct (already-public) card.
  const [revealedCommunityCards, setRevealedCommunityCards] = useState<(string | undefined)[]>([]);
  const [, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  const [onlineFriends, setOnlineFriends] = useState<{ uid: string; username: string }[]>([]);
  const [invitedFriends, setInvitedFriends] = useState<Record<string, boolean>>({});
  const [enteredPassword, setEnteredPassword] = useState("");

  // Map to store real-time user profiles (UID -> { username, photoURL })
  const [userProfiles, setUserProfiles] = useState<Record<string, { username: string; photoURL?: string }>>({});

  useEffect(() => {
    const handleResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Listen to friends status in real-time in TablePage
  useEffect(() => {
    if (!user) return;

    const qFriends = query(
      collection(db, "users", user.uid, "friends"),
      where("status", "==", "ACCEPTED")
    );

    let unsubFriendDocs: (() => void)[] = [];

    const unsubFriends = onSnapshot(qFriends, (snap) => {
      unsubFriendDocs.forEach(unsub => unsub());
      unsubFriendDocs = [];

      const friendsList: { friendUid: string; username: string }[] = [];
      snap.forEach((d) => {
        const fData = d.data();
        friendsList.push({
          friendUid: d.id,
          username: fData.username || "Friend"
        });
      });

      if (friendsList.length === 0) {
        setOnlineFriends([]);
        return;
      }

      const activeFriendStates: Record<string, any> = {};

      friendsList.forEach((friend) => {
        const friendDocRef = doc(db, "users", friend.friendUid);
        const unsubDoc = onSnapshot(friendDocRef, (friendSnap) => {
          if (friendSnap.exists()) {
            const fDocData = friendSnap.data();
            const presence = fDocData.presence;
            
            const isOnlineAndHome = presence?.status === "ONLINE" &&
                                    presence?.location === "HOME" &&
                                    presence?.lastActive &&
                                    (Date.now() - presence.lastActive.toMillis() < 5 * 60 * 1000);

            if (isOnlineAndHome) {
              activeFriendStates[friend.friendUid] = {
                uid: friend.friendUid,
                username: fDocData.username || friend.username
              };
            } else {
              delete activeFriendStates[friend.friendUid];
            }
          } else {
            delete activeFriendStates[friend.friendUid];
          }

          setOnlineFriends(Object.values(activeFriendStates));
        });

        unsubFriendDocs.push(unsubDoc);
      });
    });

    return () => {
      unsubFriends();
      unsubFriendDocs.forEach(unsub => unsub());
    };
  }, [user]);

  // Session timer: derives elapsed time from server-side gameStartedAt timestamp
  const [sessionElapsed, setSessionElapsed] = useState<string>("");
  useEffect(() => {
    if (!table || table.state !== "IN_GAME") {
      setSessionElapsed("");
      return;
    }
    // Use gameStartedAt if available, otherwise fall back to createdAt
    const tsField = table.gameStartedAt || table.createdAt;
    if (!tsField) {
      setSessionElapsed("");
      return;
    }
    // Firestore Timestamp → epoch ms
    const startMs = tsField.toDate ? tsField.toDate().getTime() : tsField;
    const tick = () => {
      const diff = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      const m = String(Math.floor(diff / 60)).padStart(2, "0");
      const s = String(diff % 60).padStart(2, "0");
      setSessionElapsed(`${m}:${s}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [table?.state, table?.gameStartedAt, table?.createdAt]);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    const originalHeight = document.body.style.height;
    const originalPosition = document.body.style.position;
    const originalWidth = document.body.style.width;

    document.body.style.overflow = "hidden";
    document.body.style.height = "100dvh";
    document.body.style.position = "fixed";
    document.body.style.width = "100%";

    const html = document.documentElement;
    const originalHtmlOverflow = html.style.overflow;
    const originalHtmlHeight = html.style.height;
    html.style.overflow = "hidden";
    html.style.height = "100dvh";

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.height = originalHeight;
      document.body.style.position = originalPosition;
      document.body.style.width = originalWidth;

      html.style.overflow = originalHtmlOverflow;
      html.style.height = originalHtmlHeight;
    };
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
            isVirtualCards: !!data.isVirtualCards,
            gameStartedAt: data.gameStartedAt ?? null
        });

        setLoading(false);
      },
      (err) => {
        console.error("Errore nel listener del tavolo:", err);
        if (err.code === "permission-denied") {
          setNotFound(true);
        }
        setLoading(false);
      }
    );

    // Keep track of active users listeners to clean them up
    let unsubUserDocs: Record<string, () => void> = {};

    const playersRef = collection(db, "tables", tableId, "players");
    const q = query(playersRef, orderBy("seatIndex", "asc"));
    const unsubPlayers = onSnapshot(
      q,
      (snap) => {
        const list: PlayerData[] = [];
        const activeUids: string[] = [];

        snap.forEach((docSnap) => {
          const d = docSnap.data() as any;
          list.push({
            id: docSnap.id,
            stack: d.stack,
            seatIndex: d.seatIndex,
            isReady: d.isReady,
            userId: d.userId,
            isFolded: !!d.isFolded,
            isSittingOut: !!d.isSittingOut,
            isAllIn: !!d.isAllIn,
            totalBuyIn: d.totalBuyIn,
            eliminatedAt: d.eliminatedAt,
            hasLeft: !!d.hasLeft
          });
          activeUids.push(d.userId);
        });

        // 1. Clean up user listeners for users who left
        Object.keys(unsubUserDocs).forEach((uid) => {
          if (!activeUids.includes(uid)) {
            unsubUserDocs[uid]();
            delete unsubUserDocs[uid];
          }
        });

        // 2. Set up real-time listener for each new player's user document
        activeUids.forEach((uid) => {
          if (!unsubUserDocs[uid]) {
            const userRef = doc(db, "users", uid);
            unsubUserDocs[uid] = onSnapshot(userRef, (userSnap) => {
              if (userSnap.exists()) {
                const uData = userSnap.data();
                setUserProfiles((prev) => ({
                  ...prev,
                  [uid]: { 
                    username: uData.username || uData.displayName || "Giocatore",
                    photoURL: uData.photoURL || undefined
                  }
                }));
              } else {
                setUserProfiles((prev) => ({
                  ...prev,
                  [uid]: { username: "Guest" }
                }));
              }
            }, (err) => {
              console.error("Error listening to user profile:", uid, err);
            });
          }
        });
        
        // A player who has permanently quit still has a document here (so the final
        // recap and seat-index math stay correct), but they shouldn't count as
        // "currently in this game" for the home page's "return to your table" banner.
        if (user && list.some(p => p.userId === user.uid && !p.hasLeft)) {
          localStorage.setItem("activeTableId", tableId);
        } else {
          if (user && localStorage.getItem("activeTableId") === tableId) {
            localStorage.removeItem("activeTableId");
          }
        }

        setPlayers(list);
        setPlayersLoaded(true);
      },
      (err) => {
        console.error("Errore nel listener dei giocatori:", err);
        if (err.code === "permission-denied") {
          setNotFound(true);
        }
      }
    );

    return () => {
      unsubTable();
      unsubPlayers();
      // Clean up all active user profile listeners
      Object.values(unsubUserDocs).forEach((unsub) => unsub());
    };
  }, [tableId, refreshKey]);

  // Auto-join with password or show join modal for spectators
  const [searchParams] = useSearchParams();
  useEffect(() => {
    if (!playersLoaded || !user?.uid || !tableId || !table) return;

    const isSeated = players.some((p) => p.userId === user.uid);
    
    // If already seated or game is summary, nothing to do
    if (isSeated || table.state === "SUMMARY") return;

    // If the user just explicitly left, don't auto-join again
    if (hasLeftRef.current) return;

    // Check url params
    const pwd = searchParams.get("pwd");
    const autoJoin = searchParams.get("autoJoin") === "1";

    if (pwd) {
      // Auto-join with explicit password in URL
      (async () => {
        try {
          await joinTable(tableId, user, pwd);
        } catch (err: any) {
          console.error("Auto-join failed:", err);
          setJoinError(err.message || "Errore durante il join automatico");
          setShowJoinModal(true);
        }
      })();
    } else if (!table.password || autoJoin) {
      // Public table OR coming from invite/friend-link — join silently without modal
      (async () => {
        try {
          await joinTable(tableId, user, undefined);
        } catch (err: any) {
          console.error("Auto-join failed:", err);
          setJoinError(err.message || "Errore durante il join automatico");
          setShowJoinModal(true);
        }
      })();
    } else {
      // Password-protected table and no auto-join hint — show modal
      setShowJoinModal(true);
    }
  }, [playersLoaded, user?.uid, players, tableId, table, searchParams]);

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
          handResults: d.handResults || null,
          revealedPlayers: d.revealedPlayers || {}
        };
        setCurrentHand(hand);
      },
      (err) => {
        console.error("Errore nel listener della mano:", err);
        if (err.code === "permission-denied") {
          setNotFound(true);
        }
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
    }, 100);

    return () => clearTimeout(timer);
  }, [currentHand?.id, currentHand?.stage, currentHand?.currentTurnIndex, table?.hostId, user?.uid, blindsPopupVisible]);

  // Track card flipping state to disable actions during card animation.
  //
  // The "turn on" must happen synchronously during render (not in a useEffect),
  // otherwise there's a paint frame where the new stage has already committed
  // (community cards start animating) but isFlipping is still stale `false`,
  // leaving the action buttons briefly clickable. Comparing against state
  // computed during render is the React-sanctioned way to react to a prop/state
  // change without waiting for a post-paint effect.
  if (currentHand?.stage !== prevFlipStage) {
    const newStage = currentHand?.stage;
    setPrevFlipStage(newStage);

    let duration = 0;
    if (newStage === "FLOP") duration = 2100;
    else if (newStage === "TURN" || newStage === "RIVER") duration = 1600;

    if (duration > 0 && !isFlipping) {
      setIsFlipping(true);
    }
  }

  // Commit newly-revealed community cards into `revealedCommunityCards` — synchronously
  // during render, same reasoning as isFlipping above: this must land in the very same
  // commit as the stage change, or there'd be a frame where the slot is already flagged
  // `!hidden` but still showing the previous value. Slots that aren't due to be revealed
  // yet are left untouched, so they keep displaying whatever they last legitimately showed.
  if (currentHand?.communityCards) {
    const stage = currentHand.stage;
    const real = currentHand.communityCards;
    let changed = false;
    const next = [...revealedCommunityCards];
    for (let idx = 0; idx < real.length; idx++) {
      let shouldReveal = false;
      if (stage === "FLOP" && idx < 3) shouldReveal = true;
      if (stage === "TURN" && idx < 4) shouldReveal = true;
      if (stage === "RIVER" && idx < 5) shouldReveal = true;
      if (stage === "SHOWDOWN") shouldReveal = true;

      if (shouldReveal && next[idx] !== real[idx]) {
        next[idx] = real[idx];
        changed = true;
      }
    }
    if (changed) {
      setRevealedCommunityCards(next);
    }
  }

  // Turning it back OFF doesn't need to be paint-synchronous (re-enabling a frame
  // late isn't exploitable), so a regular effect scheduling the timeout is fine.
  useEffect(() => {
    if (!isFlipping || !currentHand?.stage) return;

    let duration = 0;
    if (currentHand.stage === "FLOP") duration = 2100;
    else if (currentHand.stage === "TURN" || currentHand.stage === "RIVER") duration = 1600;

    if (duration <= 0) {
      setIsFlipping(false);
      return;
    }

    const timer = setTimeout(() => {
      setIsFlipping(false);
    }, duration);
    return () => clearTimeout(timer);
  }, [isFlipping, currentHand?.stage]);

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


  // Styles for Loading & Error Screens
  const fullScreenContainerStyle: React.CSSProperties = {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "radial-gradient(circle at top, #020617, #020617 45%, #000000)",
    color: "#f8fafc",
    fontFamily: "var(--font-sans)",
    padding: "1rem",
    boxSizing: "border-box"
  };

  const panelContainerStyle: React.CSSProperties = {
    padding: "2.5rem 2rem",
    borderRadius: "1.5rem",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "1.2rem",
    maxWidth: "360px",
    width: "100%",
    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.75)",
    border: "1px solid rgba(255, 255, 255, 0.08)"
  };

  const titleStyle: React.CSSProperties = {
    fontSize: "1.25rem",
    fontWeight: 800,
    margin: 0
  };

  const descStyle: React.CSSProperties = {
    fontSize: "0.85rem",
    color: "var(--text-muted)",
    marginTop: "0.5rem",
    lineHeight: 1.5,
    marginBottom: 0
  };

  const btnStyle: React.CSSProperties = {
    width: "100%",
    padding: "0.75rem 1rem",
    borderRadius: "999px",
    border: "none",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: "0.9rem",
    color: "var(--text-inverse)"
  };

  if (!tableId) {
    return (
      <div style={fullScreenContainerStyle}>
        <div className="glass-panel" style={panelContainerStyle}>
          <div style={{ color: "#ef4444" }}><ShieldAlert size={44} /></div>
          <div>
            <h3 style={titleStyle}>{t("table.error") || "Errore"}</h3>
            <p style={descStyle}>ID tavolo non fornito o non valido nell'URL.</p>
          </div>
          <button onClick={() => navigate("/home")} className="poker-btn-primary" style={btnStyle}>
            Torna alla Home
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={fullScreenContainerStyle}>
        <div className="glass-panel" style={panelContainerStyle}>
          <div style={{ position: "relative", width: "50px", height: "50px" }}>
            <div style={{
              width: "100%", height: "100%",
              borderRadius: "50%",
              border: "3px solid rgba(59, 130, 246, 0.1)",
              borderTopColor: "var(--color-primary)",
              animation: "spin 1s linear infinite"
            }} />
            <div style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              fontSize: "1.25rem"
            }}>♣️</div>
          </div>
          <div>
            <h3 style={titleStyle}>{t("table.connecting") || "Connessione..."}</h3>
            <p style={descStyle}>Caricamento dei dati del tavolo da gioco...</p>
          </div>
        </div>
      </div>
    );
  }

  if (notFound || !table) {
    return (
      <div style={fullScreenContainerStyle}>
        <div className="glass-panel" style={panelContainerStyle}>
          <div style={{ color: "#ef4444" }}><ShieldAlert size={44} /></div>
          <div>
            <h3 style={titleStyle}>Tavolo Non Trovato</h3>
            <p style={descStyle}>
              Il tavolo che stai cercando di visualizzare non esiste, è stato chiuso o rimosso dall'host.
            </p>
          </div>
          <button onClick={() => navigate("/home")} className="poker-btn-primary" style={btnStyle}>
            Torna alla Home
          </button>
        </div>
      </div>
    );
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
    table?.state === "LOBBY" &&
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
    // Mark as left immediately to prevent any auto-join re-trigger
    hasLeftRef.current = true;
    try {
      await leaveTable(tableId, user);
    } catch (err) {
      console.error(err);
    } finally {
      // Explicitly remove the cached table ID so the "return to table" banner
      // doesn't appear on the home page (the Firestore listener may not have
      // fired yet by the time the user lands on /home)
      localStorage.removeItem("activeTableId");
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
  }
}

async function handleQuitGame() {
  if (!user || !tableId) return;
  setActionLoading(true);
  try {
    await quitGame(tableId, user);
    // Same cleanup as leaving a lobby: prevent the "return to table" banner and
    // any auto-rejoin logic from firing before the Firestore listener catches up.
    hasLeftRef.current = true;
    localStorage.removeItem("activeTableId");
    navigate("/home");
  } catch (err: any) {
    console.error(err);
    setActionError(err.message || "Errore nell'abbandonare la partita.");
  } finally {
    setActionLoading(false);
    setShowQuitConfirm(false);
  }
}

async function handleRevealOwnCards() {
  if (!tableId || !table || !table.currentHandId || !user) return;
  try {
    const handRef = doc(db, "tables", tableId, "hands", table.currentHandId);
    await updateDoc(handRef, {
      [`revealedPlayers.${user.uid}`]: true
    });
  } catch (err: any) {
    console.error(err);
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

  function renderRoleBadgesAbsolute(index: number, isOnRightSide: boolean) {
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

    const absoluteStyle: React.CSSProperties = {
      position: "absolute",
      top: "-9px",
      display: "flex",
      gap: "0.15rem",
      zIndex: 15
    };

    if (isOnRightSide) {
      absoluteStyle.left = "6px";
    } else {
      absoluteStyle.right = "6px";
    }

    return (
      <div style={absoluteStyle}>
        {badges.map((b) => (
          <span key={b.type} className={b.className} title={b.label}>
            {b.label}
          </span>
        ))}
      </div>
    );
  }

  function getAdjustedAngle(index: number, total: number) {
    if (total <= 1) return Math.PI / 2; // 90°

    let B = 1;
    if (total > 4) {
      B = Math.ceil(total / 2);
    }
    const T = total - B;

    if (index === 0) return Math.PI / 2;

    const topAngles: number[] = [];
    if (T === 1) {
      topAngles.push(270);
    } else if (T === 2) {
      topAngles.push(220, 320);
    } else if (T === 3) {
      topAngles.push(220, 270, 320);
    } else if (T > 3) {
      const step = 120 / (T - 1);
      for (let i = 0; i < T; i++) {
        topAngles.push(210 + i * step);
      }
    }

    const bottomAngles: number[] = [];
    const B_others = B - 1;
    if (B_others === 2) {
      bottomAngles.push(140, 40);
    } else if (B_others > 2) {
      const half = Math.floor(B_others / 2);
      const stepLeft = 35 / Math.max(1, half - 1);
      const stepRight = 35 / Math.max(1, half - 1);
      for (let i = 0; i < half; i++) {
        bottomAngles.push(140 - i * stepLeft);
      }
      for (let i = 0; i < half; i++) {
        bottomAngles.push(40 + i * stepRight);
      }
      if (B_others % 2 !== 0) {
        bottomAngles.push(115);
      }
    }

    const allAngles = [...topAngles, ...bottomAngles].map(deg => {
      let norm = deg;
      if (norm <= 90) norm += 360;
      return { deg, norm };
    });
    allAngles.sort((a, b) => a.norm - b.norm);

    const chosen = allAngles[index - 1];
    return (chosen ? chosen.deg : 270) * Math.PI / 180;
  }

  function getSeatPosition(index: number, total: number) {
    // index 0 is Me, placed at the bottom center (90 degrees or PI/2).
    // The others are spaced clockwise.
    const angle = getAdjustedAngle(index, total);

    const radiusX = 46; // Pulled in slightly from 46 to prevent mobile rail overflow
    const radiusY = 43; // Pulled in from 43 for balance
    const top = 50 + radiusY * Math.sin(angle);
    const left = 50 + radiusX * Math.cos(angle);

    return {
      top: `${top}%`,
      left: `${left}%`
    };
  }



  // Manual join to table
  async function handleJoinTable() {
    if (!tableId || !user) return;
    setJoinError(null);
    setJoinLoading(true);
    try {
      const pwd = searchParams.get("pwd") || enteredPassword;
      await joinTable(tableId, user, pwd || undefined);
      setShowJoinModal(false);
    } catch (err: any) {
      console.error(err);
      setJoinError(err.message || t("joinTable.errorGeneric"));
    } finally {
      setJoinLoading(false);
    }
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
              className="poker-btn-secondary"
              style={{
                padding: "0.4rem 0.8rem",
                borderRadius: "0.5rem",
                cursor: "pointer",
                fontSize: "0.85rem",
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
    className="poker-btn-danger"
    style={{
      padding: "0.3rem 0.7rem",
      borderRadius: "999px",
      cursor: "pointer",
      fontSize: "0.8rem"
    }}
  >
    {t("table.leaveLobby")}
  </button>
</div>

          <p style={{ fontSize: "0.9rem", color: "#cbd5f5" }}>
            {t("table.blindsShort")} {table?.smallBlind}/{table?.bigBlind} • {t("table.startingStack")} {" "}
            {table?.initialStack} • {t("table.state")} {table?.state}
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
                className={allReady ? "poker-btn-success" : "poker-btn-secondary"}
                style={{
                  padding: "0.3rem 0.75rem",
                  borderRadius: "0.5rem",
                  cursor: allReady ? "pointer" : "default"
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
                const isHostPlayer = p.userId === table?.hostId;

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
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      {userProfiles[p.userId]?.photoURL ? (
                        <img 
                          src={userProfiles[p.userId].photoURL} 
                          alt="Avatar" 
                          style={{ width: "24px", height: "24px", borderRadius: "50%", objectFit: "cover" }} 
                        />
                      ) : (
                        <div style={{ width: "24px", height: "24px", borderRadius: "50%", background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 700 }}>
                          {(userProfiles[p.userId]?.username || "G").charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <span style={{ fontWeight: 500, color: p.isSittingOut ? "#9ca3af" : "#e5e7eb" }}>
                            {p.isSittingOut && <span style={{ color: "#facc15" }}>{t("table.pauseBadge")}</span>}
                            {userProfiles[p.userId]?.username || "Giocatore"}
                        </span>
                      </div>
                    </div>
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
                          className={p.isReady ? "poker-btn-success" : "poker-btn-warning"}
                          style={{
                            padding: "0.3rem 0.6rem",
                            borderRadius: "0.5rem",
                            cursor: "pointer",
                            fontSize: "0.8rem"
                          }}
                        >
                          {p.isReady ? t("table.ready") : t("table.notReady")}
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

    // A player who has permanently quit keeps a document (recap + seat-index stability),
    // but must never see or interact with the live game again — otherwise they'd end up
    // in the exact broken state this guards against: invisible on the felt (their pod is
    // filtered out) yet still able to act via the Stand Up toggle or action buttons, since
    // nothing else in this component checks hasLeft. This single early return is the one
    // place that has to catch it.
    if (myPlayer?.hasLeft) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem" }}>
          <div className="glass-panel" style={{ padding: "2rem", borderRadius: "1.5rem", textAlign: "center", maxWidth: "380px", width: "100%", display: "grid", gap: "1rem" }}>
            <h2 style={{ margin: 0, fontSize: "1.2rem", color: "#e2e8f0" }}>{t("table.youHaveLeftTitle")}</h2>
            <p style={{ margin: 0, fontSize: "0.9rem", color: "#9ca3af" }}>{t("table.youHaveLeftBody")}</p>
            <button
              onClick={() => navigate("/home")}
              className="poker-btn-primary"
              style={{ padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontSize: "0.95rem" }}
            >
              {t("table.backHome")}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="game-page-container" id="game-table-screen">
        <header className="game-header" id="game-table-header">
          <h1 className="game-title" id="game-table-title-label">
            {table.name}
          </h1>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: 0, paddingRight: "120px", boxSizing: "border-box" }} id="game-table-info-label">
            {t("table.hand")} #{currentHand?.handNumber ?? "-"} •{" "}
            {t("table.blinds")} {table.smallBlind}/{table.bigBlind}
            {sessionElapsed && (
              <>
                {" • "}
                <span style={{ fontVariantNumeric: "tabular-nums" }}>⏱ {sessionElapsed}</span>
              </>
            )}
            {table?.mode === "TOURNAMENT" && (
              <>
                {" • "}
                {t("table.level")} {(table.currentLevelIndex || 0) + 1}
                {timeRemainingStr && ` (${timeRemainingStr})`}
              </>
            )}
          </p>
          <div className="game-controls-bar" id="game-table-controls-bar">
            <div className="game-controls-flex" id="game-table-controls-buttons">
              {table?.mode !== "TOURNAMENT" && (
                <button
                  id="btn-table-toggle-sit"
                  onClick={handleToggleSittingOut}
                  disabled={!!disableSitToggle}
                  className={myPlayer?.isSittingOut ? "poker-btn-success" : "poker-btn-warning"}
                  style={{
                    padding: "0.35rem 0.75rem",
                    borderRadius: "999px",
                    cursor: disableSitToggle ? "default" : "pointer",
                    fontSize: "0.8rem",
                    opacity: disableSitToggle ? 0.5 : 1
                  }}
                >
                  {myPlayer?.isSittingOut ? t("table.sitDown") : t("table.standUp")}
                </button>
              )}

              {!myPlayer?.hasLeft && (
                <button
                  id="btn-table-quit-game"
                  onClick={() => setShowQuitConfirm(true)}
                  disabled={!!disableSitToggle}
                  className="poker-btn-danger"
                  style={{
                    padding: "0.35rem 0.75rem",
                    borderRadius: "999px",
                    cursor: disableSitToggle ? "default" : "pointer",
                    fontSize: "0.8rem",
                    opacity: disableSitToggle ? 0.5 : 1
                  }}
                >
                  {t("table.quitGame")}
                </button>
              )}

              {isHost && !disableEndGame && table?.mode !== "TOURNAMENT" && (
                <button
                  id="btn-table-end-game"
                  onClick={handleEndGame}
                  className="poker-btn-danger"
                  style={{
                    padding: "0.35rem 0.75rem",
                    borderRadius: "999px",
                    cursor: "pointer"
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
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            overflow: "hidden",
            padding: "0.5rem 0"
          }}
        >
          {/* Top victory banner shown in the upper empty space */}
          {inGame && currentHand && currentHand.stage === "SHOWDOWN" && (!!currentHand.winnerId || (currentHand.winnerIds && currentHand.winnerIds.length > 0)) && (
            <div style={{
              margin: "0.25rem auto",
              padding: "0.6rem 1.2rem",
              borderRadius: "0.75rem",
              background: "rgba(16, 185, 129, 0.12)",
              border: "1px solid rgba(16, 185, 129, 0.35)",
              textAlign: "center",
              maxWidth: "480px",
              width: "90%",
              boxShadow: "0 4px 15px rgba(16, 185, 129, 0.15)",
              animation: "scaleIn 0.3s ease",
              zIndex: 20
            }}>
              <div style={{ fontSize: "1.1rem", fontWeight: 800, color: "#facc15" }}>
                🏆 {
                  currentHand.winnerIds && currentHand.winnerIds.length > 1
                    ? `${t("table.winnerSplit")} `
                    : `${t("table.winnerSingle")} `
                } {
                  currentHand.winnerIds && currentHand.winnerIds.length > 1
                    ? currentHand.winnerIds.map(wId => userProfiles[wId]?.username || t("table.unknown")).join(", ")
                    : userProfiles[currentHand.winnerId || ""]?.username || t("table.unknown")
                } 🏆
              </div>
              {currentHand.handResults && currentHand.winnerIds?.[0] && currentHand.handResults[currentHand.winnerIds[0]] && (
                <div style={{ fontSize: "0.85rem", color: "#4ade80", fontWeight: 600, marginTop: "0.2rem" }}>
                  {currentHand.handResults[currentHand.winnerIds[0]].rankName} (Vinto: {currentHand.pot} fiches)
                </div>
              )}
            </div>
          )}

          {/* Centering wrapper — fills all remaining space between banner and showdown buttons */}
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", width: "100%", minHeight: 0 }}>
          <div
            className="poker-felt"
          >
            {/* Testo centrale: pot, stage, turno e community cards */}
            <div className="felt-pot" id="felt-pot-display">
              <span style={{ fontSize: "0.7rem", color: "rgba(255, 255, 255, 0.6)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block" }}>
                {t("table.pot")}
              </span>
              <span style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--color-warning)", textShadow: "0 2px 4px rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <PokerChip size={20} style={{ marginRight: "0.3rem" }} />{currentHand?.pot ?? 0}
              </span>
            </div>

            {table?.isVirtualCards && currentHand && (
              <div className="felt-cards" id="felt-cards-display">
                {currentHand.communityCards?.map((_card, idx) => {
                  let hidden = true;
                  if (currentHand.stage === "FLOP" && idx < 3) hidden = false;
                  if (currentHand.stage === "TURN" && idx < 4) hidden = false;
                  if (currentHand.stage === "RIVER" && idx < 5) hidden = false;
                  if (currentHand.stage === "SHOWDOWN") hidden = false;

                  let delayMs = 0;
                  if (!hidden) {
                    if (currentHand.stage === "FLOP") {
                      delayMs = 1000 + idx * 250;
                    } else if (currentHand.stage === "TURN" && idx === 3) {
                      delayMs = 1000;
                    } else if (currentHand.stage === "RIVER" && idx === 4) {
                      delayMs = 1000;
                    }
                  }

                  return (
                    <div key={idx}>
                      {/* Card value comes from revealedCommunityCards, not currentHand.communityCards
                          directly — see the comment where that state is declared. This keeps the
                          outgoing flip-to-hidden animation showing the hand that just ended instead
                          of either leaking the next hand's card or flashing a blank face. */}
                      <Card card={revealedCommunityCards[idx]} hidden={hidden} flipDelay={delayMs} />
                    </div>
                  );
                })}
              </div>
            )}

            <div className="felt-turn" id="felt-turn-display">
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
                  ? t("table.turnOf", { name: userProfiles[players[currentHand.currentTurnIndex].userId]?.username || "Giocatore" })
                  : t("table.waitingTurn")}
              </div>
            </div>

            {/* Giocatori e Fiches puntate attorno al tavolo */}
            {/* Giocatori attorno al tavolo */}
            {players.map((p, index) => {
              // A player who has fully quit keeps their document (and seat slot) alive —
              // their name must still show up in the final recap and dealer/turn indices
              // must stay stable — but their pod should no longer render on the live felt.
              // We deliberately don't filter the array itself: index/visualIndex/players.length
              // below all have to line up with currentHand.currentTurnIndex, which is computed
              // server-side against the full, unfiltered seat order.
              if (p.hasLeft) return null;

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

              const hasVirtualCardsDealt = isMe && table?.isVirtualCards && currentHand && currentHand.stage !== "SHOWDOWN" && currentHand.playerHands?.[p.userId];
              
              const isHandOver = inGame && currentHand && currentHand.stage === "SHOWDOWN" && (!!currentHand.winnerId || (currentHand.winnerIds && currentHand.winnerIds.length > 0));
              const isWinner = currentHand && (currentHand.winnerId === p.userId || currentHand.winnerIds?.includes(p.userId));
              const isFoldOutWin = !currentHand?.handResults || Object.keys(currentHand.handResults).length === 0;
              const isShowdownReveal = table?.isVirtualCards && 
                                       currentHand?.stage === "SHOWDOWN" && 
                                       currentHand.playerHands?.[p.userId] && 
                                       ((!p.isFolded && !isFoldOutWin) || (currentHand as any).revealedPlayers?.[p.userId]);
              const isMePeeking = isMe && hasVirtualCardsDealt && showMyCards;
              const showCardsInPod = isShowdownReveal || isMePeeking;
              const cardsToReveal = showCardsInPod ? currentHand.playerHands?.[p.userId] : null;

              const angle = getAdjustedAngle(visualIndex, players.length);
              const isOnRightSide = Math.cos(angle) > 0.01;
              const roundBet = currentHand && currentHand.roundBets[p.userId] ? currentHand.roundBets[p.userId] : 0;

              return (
                <div
                  key={p.id}
                  style={{
                    position: "absolute",
                    top,
                    left,
                    transform: "translate(-50%, -50%)",
                    width: showCardsInPod ? (isMe ? "28%" : "25%") : "22%",
                    maxWidth: showCardsInPod ? (isMe ? "130px" : "110px") : "110px",
                    zIndex: 10
                  }}
                >
                  <div
                    className={`player-pod ${isMe ? 'player-pod-me' : ''} ${isTurn ? 'player-pod-active-turn' : ''} ${p.isFolded ? 'player-pod-folded' : ''} ${p.isSittingOut ? 'player-pod-sitout' : ''} ${showCardsInPod ? (isMe ? 'player-pod-dilated-me' : 'player-pod-dilated-others') : ''}`}
                    onClick={() => {
                      if (isMe && isHandOver) {
                        handleRevealOwnCards();
                      } else if (hasVirtualCardsDealt) {
                        if (isMe) {
                          setShowMyCards(prev => !prev);
                        }
                      }
                    }}
                    style={{
                      borderWidth: "1.5px",
                      borderColor: isHandOver
                        ? (isWinner ? "var(--color-warning)" : "rgba(255, 255, 255, 0.1)")
                        : isTurn
                        ? "var(--color-success)"
                        : p.isSittingOut
                        ? "rgba(56, 189, 248, 0.75)"
                        : p.isFolded
                        ? "rgba(239, 68, 68, 0.7)"
                        : roundBet > 0
                        ? "rgba(251, 191, 36, 0.85)"
                        : (selectedWinners.includes(p.userId) && votingOpen)
                        ? "var(--color-success)"
                        : "rgba(255, 255, 255, 0.1)",
                      boxShadow: isHandOver
                        ? (isWinner ? "0 0 18px rgba(251, 191, 36, 0.85)" : undefined)
                        : isTurn
                        ? "0 0 15px var(--color-success-glow)"
                        : p.isSittingOut
                        ? "0 0 12px rgba(56, 189, 248, 0.55)"
                        : p.isFolded
                        ? "0 0 12px rgba(239, 68, 68, 0.55)"
                        : roundBet > 0
                        ? "0 0 12px rgba(251, 191, 36, 0.65)"
                        : undefined,
                      opacity: p.isSittingOut ? 0.6 : p.isFolded || (votingOpen && activePot && !isEligibleForActivePot) ? 0.6 : 1,
                      cursor: (hasVirtualCardsDealt || (isMe && isHandOver)) ? "pointer" : undefined
                    }}
                  >
                    {renderRoleBadgesAbsolute(index, isOnRightSide)}

                    <div className="player-pod-inner" id={`player-pod-inner-${p.userId}`}>
                      <div
                        className={`player-pod-name ${isOnRightSide ? "right-side" : "left-side"}`}
                        id={`player-pod-name-${p.userId}`}
                        style={{
                          color: p.isSittingOut ? "var(--text-muted)" : p.isFolded ? "#6b7280" : isMe ? "var(--color-success)" : "var(--text-main)",
                          textDecoration: p.isFolded && !p.isSittingOut ? "line-through" : "none",
                          textAlign: isOnRightSide ? "right" : "left",
                          display: "block",
                          width: "100%"
                        }}
                      >
                        {p.isSittingOut && table?.mode === "TOURNAMENT" && p.stack === 0 && (
                          <span style={{ color: "var(--color-danger)", paddingRight: "0.2rem", fontWeight: 700 }}>
                            [Out]
                          </span>
                        )}
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", verticalAlign: "middle" }}>
                          {userProfiles[p.userId]?.photoURL && (
                            <img 
                              src={userProfiles[p.userId].photoURL} 
                              alt="" 
                              style={{ width: "16px", height: "16px", borderRadius: "50%", objectFit: "cover" }} 
                            />
                          )}
                          <span>{userProfiles[p.userId]?.username || "Giocatore"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Cards Container (Fade In/Out with height transition) */}
                    <div style={{
                      display: "flex",
                      gap: "5px",
                      justifyContent: "center",
                      transition: "opacity 0.25s ease, max-height 0.25s ease, transform 0.25s ease, margin-top 0.25s ease",
                      opacity: showCardsInPod && cardsToReveal ? 1 : 0,
                      maxHeight: showCardsInPod && cardsToReveal ? "70px" : "0px",
                      transform: showCardsInPod && cardsToReveal ? "scale(1)" : "scale(0.85)",
                      marginTop: showCardsInPod && cardsToReveal ? "0.15rem" : "0rem",
                      overflow: "hidden",
                      pointerEvents: showCardsInPod && cardsToReveal ? "auto" : "none"
                    }}>
                      {(cardsToReveal || (isMe && currentHand?.playerHands?.[p.userId]) || []).map((c, i) => (
                        <Card key={i} card={c} miniMe={isMe} mini={!isMe} />
                      ))}
                    </div>

                    {/* Stack Container (Fade In/Out with height transition) */}
                    <div
                      className={`player-pod-stack ${isOnRightSide ? "right-side" : "left-side"}`}
                      id={`player-pod-stack-${p.userId}`}
                      style={{
                        textAlign: isOnRightSide ? "right" : "left",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: isOnRightSide ? "flex-end" : "flex-start",
                        gap: "0.4rem",
                        transition: "opacity 0.25s ease, max-height 0.25s ease, transform 0.25s ease",
                        opacity: showCardsInPod && cardsToReveal ? 0 : 1,
                        maxHeight: showCardsInPod && cardsToReveal ? "0px" : "20px",
                        transform: showCardsInPod && cardsToReveal ? "scale(0.85)" : "scale(1)",
                        overflow: "hidden",
                        pointerEvents: showCardsInPod && cardsToReveal ? "none" : "auto",
                        width: "100%"
                      }}
                    >
                      <span>{p.stack}</span>
                      {roundBet > 0 && (
                        <span style={{ 
                          color: "var(--color-warning)", 
                          fontWeight: 800, 
                          display: "inline-flex", 
                          alignItems: "center", 
                          gap: "2px" 
                        }}>
                          <PokerChip size={11} /> {roundBet}
                        </span>
                      )}
                      {votingOpen && myVoteTargetId === p.userId && (
                        <span style={{ fontSize: "0.65rem", opacity: 0.7 }}>
                          • {t("table.yourChoice")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          </div>{/* end centering wrapper */}

          {/* Bottom inline controls for host & players shown in the lower empty space */}
          {inGame && currentHand && currentHand.stage === "SHOWDOWN" && (!!currentHand.winnerId || (currentHand.winnerIds && currentHand.winnerIds.length > 0)) && (
            <div style={{
              margin: "0.25rem auto",
              display: "flex",
              gap: "0.6rem",
              justifyContent: "center",
              alignItems: "center",
              width: "90%",
              maxWidth: "480px",
              zIndex: 20
            }}>
              {isHost && (
                <button
                  onClick={handleNextHand}
                  className="poker-btn-success"
                  style={{ padding: "0.6rem 1.5rem", fontSize: "0.95rem", borderRadius: "999px", fontWeight: 700 }}
                >
                  {t("table.nextHand")}
                </button>
              )}
            </div>
          )}
        </main>

        {/* Action bar in basso */}
        <footer className="table-action-footer-bar" id="table-action-footer">
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <div className="action-buttons-flex-row" id="action-buttons-container">
              {table?.isVirtualCards && !isMyTurn && inActiveHand ? (
                <>
                  {/* Pre-action buttons */}
                  {diffToCall === 0 ? (
                    <>
                      <button
                        id="btn-preaction-check-fold"
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
                        id="btn-preaction-fold"
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
                        id="btn-preaction-call-x"
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
                    id="btn-preaction-call-any"
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
                    id="btn-action-fold"
                    disabled={!isMyTurn || actionLoading || isFlipping}
                    onClick={() => setShowFoldConfirm(true)}
                    className={isMyTurn && !isFlipping ? "poker-btn-danger" : ""}
                    style={{
                      ...pillActionButton,
                      backgroundColor: isMyTurn && !isFlipping ? undefined : "#ef444433",
                      color: isMyTurn && !isFlipping ? undefined : "rgba(248, 250, 252, 0.4)",
                      boxShadow: isMyTurn && !isFlipping ? undefined : "none",
                      cursor: isMyTurn && !actionLoading && !isFlipping ? "pointer" : "default"
                    }}
                  >
                    Fold
                  </button>

                  {/* Bottone centrale: Check o Call */}
                  <button
                    id="btn-action-check-call"
                    disabled={!isMyTurn || actionLoading || (!canCheck && !canCall) || isFlipping}
                    onClick={() =>
                      canCall ? doAction("CALL") : canCheck ? doAction("CHECK") : null
                    }
                    className={isMyTurn && (canCheck || canCall) && !isFlipping ? (canCall ? "poker-btn-warning" : "poker-btn-info") : ""}
                    style={{
                      flex: 1,
                      padding: "0.6rem 0.9rem",
                      borderRadius: "999px",
                      border: isMyTurn && (canCheck || canCall) && !isFlipping ? undefined : "none",
                      cursor: isMyTurn && (canCheck || canCall) && !actionLoading && !isFlipping ? "pointer" : "default",
                      backgroundColor: isMyTurn && (canCheck || canCall) && !isFlipping ? undefined : "#4b556333",
                      color: isMyTurn && (canCheck || canCall) && !isFlipping ? undefined : "rgba(248, 250, 252, 0.4)",
                      fontWeight: 700,
                      fontSize: "0.9rem",
                      textAlign: "center",
                      boxShadow: isMyTurn && (canCheck || canCall) && !isFlipping ? undefined : "none",
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
                    id="btn-action-bet-raise"
                    disabled={!isMyTurn || actionLoading || !canBetOrRaise || isFlipping}
                    onClick={openBetPanel}
                    className={isMyTurn && canBetOrRaise && !isFlipping ? "poker-btn-success" : ""}
                    style={{
                      ...pillActionButton,
                      backgroundColor: isMyTurn && canBetOrRaise && !isFlipping ? undefined : "#22c55e33",
                      color: isMyTurn && canBetOrRaise && !isFlipping ? undefined : "rgba(248, 250, 252, 0.4)",
                      boxShadow: isMyTurn && canBetOrRaise && !isFlipping ? undefined : "none",
                      cursor: isMyTurn && canBetOrRaise && !actionLoading && !isFlipping ? "pointer" : "default"
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
              zIndex: 120,
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
                className="poker-btn-secondary"
                style={{
                  flex: 1,
                  padding: "0.8rem 1rem",
                  borderRadius: "999px",
                  fontSize: "1rem",
                  cursor: "pointer"
                }}
              >
                {t("table.cancel")}
              </button>
              <button
                onClick={confirmBet}
                disabled={actionLoading}
                className="poker-btn-success"
                style={{
                  flex: 1,
                  padding: "0.8rem 1rem",
                  borderRadius: "999px",
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
              {table?.name}
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
                      {userProfiles[p.userId]?.username || "Giocatore"}
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
          className="poker-btn-success"
          style={{
            marginTop: "0.5rem",
            width: "100%",
            padding: "0.7rem 1rem",
            borderRadius: "999px",
            cursor: "pointer",
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

  const inviteLink = `${window.location.origin}/table/${tableId}${table?.password ? `?pwd=${table.password}` : ""}`;

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
        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
        overflow: "visible"
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
              setLinkCopiedMsg(true);
              setTimeout(() => setLinkCopiedMsg(false), 2000);
            }
          }}
          className="poker-btn-info"
          style={{
            padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontSize: "0.95rem"
          }}
        >
          {typeof navigator.share === "function" ? t("table.shareLink") : t("table.copyLink")}
        </button>

        {linkCopiedMsg && (
          <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--color-success)", textAlign: "center" }}>
            {t("table.linkCopied")}
          </p>
        )}

        {/* Invito Diretto Amici Online */}
        {isRegisteredUser && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "1.2rem", textAlign: "left" }}>
            <label style={{ fontSize: "0.85rem", fontWeight: 700, color: "#e2e8f0", display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.5rem" }}>
              <Users size={14} /> Invito Diretto Amici Online
            </label>
            {onlineFriends.length === 0 ? (
              <p style={{ fontSize: "0.8rem", color: "#9ca3af", margin: 0 }}>Nessun amico online a casa.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxHeight: "120px", overflowY: "auto", overflowX: "visible", padding: "0 4px" }}>
                {onlineFriends.map((friend) => {
                  const invited = invitedFriends[friend.uid];
                  return (
                    <div key={friend.uid} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 2px" }}>
                      <span style={{ fontSize: "0.85rem" }}>@{friend.username}</span>
                      <button
                        disabled={invited}
                        onClick={async () => {
                          try {
                            if (!tableId || !table) return;
                            const inviteRef = doc(db, "users", friend.uid, "invitations", tableId);
                            await setDoc(inviteRef, {
                              tableId,
                              tableName: table.name,
                              senderUsername: username || user?.displayName || "AirPoker Player",
                              senderUid: user?.uid,
                              createdAt: serverTimestamp()
                            });
                            setInvitedFriends(prev => ({ ...prev, [friend.uid]: true }));
                            // Automatically reset invite state after 10 seconds to allow re-invite
                            setTimeout(() => {
                              setInvitedFriends(prev => ({ ...prev, [friend.uid]: false }));
                            }, 10000);
                          } catch (err) {
                            console.error(err);
                          }
                        }}
                        className="poker-btn-success"
                        style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem", borderRadius: "999px" }}
                      >
                        {invited ? "Invitato" : "Invita"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

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

  const joinModalUI = showJoinModal && table && (
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
        <div style={{ display: "flex", justifyContent: "center", color: "var(--color-primary)" }}>
          <Users size={40} />
        </div>
        <div>
          <h2 style={{ fontSize: "1.4rem", margin: 0, color: "#e2e8f0", fontFamily: "var(--font-display)" }}>
            {t("table.joinTableTitle") || "Unisciti al Tavolo"}
          </h2>
          <p style={{ fontSize: "0.9rem", color: "#9ca3af", marginTop: "0.5rem", lineHeight: 1.4 }}>
            {table.name}
          </p>
        </div>
        
        {joinError && (
          <p style={{ fontSize: "0.85rem", color: "var(--color-danger)", margin: "0.5rem 0" }}>{joinError}</p>
        )}

        {table.password && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", textAlign: "left" }}>
            <label style={{ fontSize: "0.85rem", color: "#e2e8f0", fontWeight: 600 }}>Tavolo Privato: Inserisci Password</label>
            <input
              type="text"
              placeholder="Password..."
              value={enteredPassword}
              onChange={(e) => setEnteredPassword(e.target.value)}
              style={{
                width: "100%", padding: "0.6rem 0.8rem", borderRadius: "0.5rem",
                backgroundColor: "rgba(15, 23, 42, 0.6)", border: "1px solid rgba(255,255,255,0.1)",
                color: "white", outline: "none", boxSizing: "border-box"
              }}
            />
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem", marginTop: "0.5rem" }}>
          <button
            onClick={handleJoinTable}
            disabled={joinLoading}
            className="poker-btn-primary"
            style={{
              padding: "0.8rem", borderRadius: "999px", cursor: joinLoading ? "default" : "pointer",
              fontSize: "0.95rem", opacity: joinLoading ? 0.7 : 1, color: "var(--text-inverse)", fontWeight: 700
            }}
          >
            {joinLoading ? t("dashboard.loading") : t("table.joinBtn") || "Unisciti"}
          </button>
          <button 
            onClick={() => navigate("/home")}
            disabled={joinLoading}
            style={{
              background: "transparent", color: "#9ca3af", border: "none", padding: "0.8rem", cursor: joinLoading ? "default" : "pointer",
              fontWeight: 600, fontSize: "0.9rem", opacity: joinLoading ? 0.7 : 1
            }}
          >
            {t("dashboard.btnCancel")}
          </button>
        </div>
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
            className="poker-btn-danger"
            style={{
              padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontSize: "0.95rem"
            }}
          >
            {t("table.foldYes")}
          </button>
          <button
            onClick={() => setShowFoldConfirm(false)}
            className="poker-btn-secondary"
            style={{
              padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontSize: "0.95rem"
            }}
          >
            {t("table.foldNo")}
          </button>
        </div>
      </div>
    </div>
  );

  const quitGameConfirmModalUI = showQuitConfirm && (
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
        <h2 style={{ fontSize: "1.3rem", margin: 0, color: "#e2e8f0" }}>{t("table.confirmQuitGame")}</h2>
        <p style={{ fontSize: "0.9rem", color: "#9ca3af", margin: 0 }}>{t("table.quitGameWarning")}</p>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem", marginTop: "0.5rem" }}>
          <button
            onClick={handleQuitGame}
            disabled={actionLoading}
            className="poker-btn-danger"
            style={{
              padding: "0.8rem", borderRadius: "999px",
              cursor: actionLoading ? "default" : "pointer", fontSize: "0.95rem",
              opacity: actionLoading ? 0.7 : 1
            }}
          >
            {t("table.quitGameYes")}
          </button>
          <button
            onClick={() => setShowQuitConfirm(false)}
            disabled={actionLoading}
            className="poker-btn-secondary"
            style={{
              padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontSize: "0.95rem"
            }}
          >
            {t("table.quitGameNo")}
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
            className="poker-btn-danger"
            style={{
              padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontSize: "0.95rem"
            }}
          >
            {t("table.endGameYes")}
          </button>
          <button 
            onClick={() => setShowEndGameConfirm(false)}
            className="poker-btn-secondary"
            style={{
              padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontSize: "0.95rem"
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
            className="poker-btn-warning"
            style={{
              padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontSize: "0.95rem"
            }}
          >
            {t("table.transferHost")}
          </button>
          <button 
            onClick={() => setTransferHostConfirmTarget(null)}
            className="poker-btn-secondary"
            style={{
              padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontSize: "0.95rem"
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
            className="poker-btn-danger"
            style={{ padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontSize: "0.95rem" }}
          >
            {t("table.forceFold")}
          </button>
          <button
            onClick={() => setForceFoldConfirmTarget(null)}
            className="poker-btn-secondary"
            style={{ padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontSize: "0.95rem" }}
          >
            {t("table.cancel")}
          </button>
        </div>
      </div>
    </div>
  );

  /* ─── Kick Player Confirm Modal ─── */
  const kickConfirmModalUI = kickConfirmTarget && (
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
        <h2 style={{ fontSize: "1.3rem", margin: 0, color: "#e2e8f0" }}>
          {t("table.kickPlayer")} {userProfiles[kickConfirmTarget]?.username ? `@${userProfiles[kickConfirmTarget].username}` : ""}
        </h2>
        <p style={{ margin: 0, fontSize: "0.9rem", color: "#9ca3af" }}>
          {t("table.confirmKickPlayer")}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
          <button
            onClick={async () => {
              if (kickConfirmTarget && user && tableId) {
                try {
                  await kickPlayer(tableId, user, kickConfirmTarget);
                } catch (e: any) { setActionError(e.message); }
                setKickConfirmTarget(null);
              }
            }}
            className="poker-btn-danger"
            style={{ padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontSize: "0.95rem" }}
          >
            {t("table.kickPlayer")}
          </button>
          <button
            onClick={() => setKickConfirmTarget(null)}
            className="poker-btn-secondary"
            style={{ padding: "0.8rem", borderRadius: "999px", cursor: "pointer", fontSize: "0.95rem" }}
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
      stageModalVisible = false; // Reworked to show inline rather than modal popup
      stageModalTitle = t("table.handOver");

      const winnerNames = currentHand.winnerIds && currentHand.winnerIds.length > 1
        ? currentHand.winnerIds.map(wId => userProfiles[wId]?.username || t("table.unknown")).join(", ")
        : userProfiles[currentHand.winnerId || ""]?.username || t("table.unknown");

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
              <div className="winner-players-scroll-container" id="showdown-players-list">
              {players
                .filter(p => !p.isFolded && currentHand.playerHands?.[p.userId])
                .map(p => {
                  const result = currentHand.handResults?.[p.userId];
                  const isWinner = currentHand.winnerIds?.includes(p.userId);
                  return (
                    <div 
                      key={p.userId} 
                      className={`winner-player-card-row ${isWinner ? "winner" : "loser"}`}
                      id={`showdown-player-row-${p.userId}`}
                    >
                      {/* Player cards */}
                      <div className="winner-cards-container">
                        {currentHand.playerHands?.[p.userId]?.map((card, idx) => (
                          <Card key={idx} card={card} />
                        ))}
                      </div>
                      {/* Player info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className={`winner-player-name-title ${isWinner ? "winner" : "loser"}`}>
                          {isWinner && "🏆 "}{userProfiles[p.userId]?.username || "Giocatore"}
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
            <button
              onClick={handleNextHand}
              className="poker-btn-success"
              style={{ width: "100%", padding: "0.8rem", fontSize: "1rem", borderRadius: "999px" }}
            >
              {t("table.nextHand")}
            </button>
          )}
          {isHost && table?.mode !== "TOURNAMENT" && (
            <button
              onClick={handleEndGame}
              className="poker-btn-danger"
              style={{ width: "100%", padding: "0.65rem", borderRadius: "999px", cursor: "pointer", fontSize: "0.95rem" }}
            >
              {t("table.endGame")}
            </button>
          )}
          {isHost && (
            <button
              onClick={() => setShowSettings(s => !s)}
              className="poker-btn-secondary"
              style={{ width: "100%", padding: "0.65rem", borderRadius: "999px", cursor: "pointer", fontSize: "0.95rem" }}
            >
              ⚙️ {t("table.hostSettings")}
            </button>
          )}
          {/* Sit/Stand for all players */}
          {table?.mode !== "TOURNAMENT" && myPlayer && (
            <button
              onClick={handleToggleSittingOut}
              disabled={!!disableSitToggle}
              className={myPlayer?.isSittingOut ? "poker-btn-success" : "poker-btn-warning"}
              style={{ width: "100%", padding: "0.65rem", borderRadius: "999px", cursor: disableSitToggle ? "default" : "pointer", fontSize: "0.95rem", opacity: disableSitToggle ? 0.5 : 1 }}
            >
              {myPlayer?.isSittingOut ? t("table.sitDown") : t("table.standUp")}
            </button>
          )}
          {myPlayer && !myPlayer.hasLeft && (
            <button
              onClick={() => setShowQuitConfirm(true)}
              disabled={!!disableSitToggle}
              className="poker-btn-danger"
              style={{ width: "100%", padding: "0.65rem", borderRadius: "999px", cursor: disableSitToggle ? "default" : "pointer", fontSize: "0.95rem", opacity: disableSitToggle ? 0.5 : 1 }}
            >
              {t("table.quitGame")}
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
                    {userProfiles[p.userId]?.username || "Giocatore"}
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
            className={selectedWinners.length > 0 ? "poker-btn-success" : "poker-btn-secondary"}
            style={{ width: "100%", padding: "0.8rem", fontSize: "1rem", opacity: selectedWinners.length === 0 ? 0.5 : 1, borderRadius: "999px" }}
          >
            {selectedWinners.length > 1 ? t("table.confirmWinners") : t("table.confirmWinner")} ({selectedWinners.length})
          </button>
        );
      }
    } else if (currentHand.currentTurnIndex === -1 && !table?.isVirtualCards) {
      stageModalVisible = true;
      if (currentHand.stage === "PREFLOP") {
        stageModalTitle = "Flop";
        stageModalContent = <div style={{ color: "#facc15", fontWeight: 700, fontSize: "1.1rem" }}>{currentHand.isVirtualCards ? t("table.virtualFlop") : t("table.dealFlop")}</div>;
        if (isHost) {
          stageModalAction = (
            <button
              onClick={handleAdvanceStage}
              className="poker-btn-info"
              style={{ width: "100%", padding: "0.8rem", fontSize: "1rem", borderRadius: "999px" }}
            >
              {t("table.continueFlop")}
            </button>
          );
        }
      } else if (currentHand.stage === "FLOP") {
        stageModalTitle = "Turn";
        stageModalContent = <div style={{ color: "#facc15", fontWeight: 700, fontSize: "1.1rem" }}>{currentHand.isVirtualCards ? t("table.virtualTurn") : t("table.dealTurn")}</div>;
        if (isHost) {
          stageModalAction = (
            <button
              onClick={handleAdvanceStage}
              className="poker-btn-info"
              style={{ width: "100%", padding: "0.8rem", fontSize: "1rem", borderRadius: "999px" }}
            >
              {t("table.continueTurn")}
            </button>
          );
        }
      } else if (currentHand.stage === "TURN") {
        stageModalTitle = "River";
        stageModalContent = <div style={{ color: "#facc15", fontWeight: 700, fontSize: "1.1rem" }}>{currentHand.isVirtualCards ? t("table.virtualRiver") : t("table.dealRiver")}</div>;
        if (isHost) {
          stageModalAction = (
            <button
              onClick={handleAdvanceStage}
              className="poker-btn-info"
              style={{ width: "100%", padding: "0.8rem", fontSize: "1rem", borderRadius: "999px" }}
            >
              {t("table.continueRiver")}
            </button>
          );
        }
      }
    } else if (blindsPopupVisible && currentHand.stage === "PREFLOP") {
      stageModalVisible = true;
      stageModalTitle = t("table.newHand");
      const sb = players[currentHand.smallBlindIndex]?.userId ? userProfiles[players[currentHand.smallBlindIndex].userId]?.username : undefined;
      const bb = players[currentHand.bigBlindIndex]?.userId ? userProfiles[players[currentHand.bigBlindIndex].userId]?.username : undefined;

      stageModalContent = (
        <div style={{ display: "grid", gap: "0.5rem", color: "#e2e8f0", fontSize: "0.95rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Small Blind:</span> <strong>{sb}</strong></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span>Big Blind:</span> <strong>{bb}</strong></div>
          <div style={{ marginTop: "0.8rem", color: "#facc15", fontWeight: 700 }}>{currentHand.isVirtualCards ? t("table.virtualDealCards") : t("table.dealCards")}</div>
        </div>
      );
      if (isHost) {
        stageModalAction = (
          <button
            onClick={handleCloseBlindsPopup}
            className="poker-btn-success"
            style={{ width: "100%", padding: "0.8rem", fontSize: "1rem", borderRadius: "999px" }}
          >
            {t("table.startNow")}
          </button>
        );
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
            // Same reasoning as the felt render — keep the array/indices intact, just
            // skip rendering a row for someone who already left (nothing here is
            // actionable for them anymore).
            if (p.hasLeft) return null;

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
                {!isMe && (() => {
                  const targetHandOver = currentHand?.stage === "SHOWDOWN" && hasWinner;
                  const canKick = !currentHand || p.isFolded || p.isSittingOut || targetHandOver;
                  return (
                    <button
                      onClick={() => canKick && setKickConfirmTarget(p.userId)}
                      disabled={!canKick}
                      title={canKick ? t("table.kickPlayer") : t("table.kickPlayerBlocked")}
                      style={{ padding: "0 0.4rem", fontSize: "0.85rem", cursor: canKick ? "pointer" : "default", opacity: canKick ? 1 : 0.35, background: "transparent", border: "1px solid #ef4444", borderRadius: "4px", color: "#f87171" }}
                    >
                      ⛔
                    </button>
                  );
                })()}
                <span style={{ flex: 1, fontSize: "0.85rem", color: "#f8fafc", minWidth: "100px", fontWeight: 500 }}>{userProfiles[p.userId]?.username || "Giocatore"} <span style={{ color: "#94a3b8", fontWeight: 400 }}>({p.stack})</span></span>
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
      {joinModalUI}
      {modalUI}
      {foldConfirmModalUI}
      {quitGameConfirmModalUI}
      {endGameConfirmModalUI}
      {transferHostConfirmModalUI}
      {forceFoldConfirmModalUI}
      {kickConfirmModalUI}
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
