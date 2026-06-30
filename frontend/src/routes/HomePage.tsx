import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTranslation } from "react-i18next";
import { 
  PlusCircle, 
  Users, 
  LogOut, 
  Info, 
  FileText, 
  Trophy, 
  History, 
  UserPlus, 
  Check, 
  X, 
  ArrowUpRight, 
  ArrowDownRight, 
  Sparkles, 
  User as UserIcon,
  Crown,
  KeyRound,
  Camera
} from "lucide-react";
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  limit, 
  getDoc,
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc,
  onSnapshot 
} from "firebase/firestore";
import { db } from "../lib/firebase";

type TabType = "leaderboard" | "history" | "friends";

interface LeaderboardUser {
  uid: string;
  username: string;
  netProfit: number;
  handsWon: number;
}

interface TableHistoryEntry {
  tableId: string;
  tableName: string;
  mode: string;
  endedAt: any;
  netProfit: number;
  players: any[];
}

interface Friend {
  friendUid: string;
  username: string;
  status: "PENDING_SENT" | "PENDING_RECEIVED" | "ACCEPTED";
}

export default function HomePage() {
  const { user, username, isRegisteredUser, logout, linkGuestToRegistered } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<TabType>("leaderboard");

  // Main Dashboard Data States
  const [stats, setStats] = useState({
    handsPlayed: 0,
    handsWon: 0,
    netProfit: 0,
    sessionsPlayed: 0
  });

  // Tab Data States
  const [leaderboard, setLeaderboard] = useState<LeaderboardUser[]>([]);
  const [history, setHistory] = useState<TableHistoryEntry[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);

  // Action States
  const [joinCode, setJoinCode] = useState("");
  const [friendInput, setFriendInput] = useState("");
  const [loadingAction, setLoadingAction] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Upgrade Modal State
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeUsername, setUpgradeUsername] = useState(username || "");
  const [upgradeEmail, setUpgradeEmail] = useState("");
  const [upgradePassword, setUpgradePassword] = useState("");
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  // Selected History Table for Details Modal
  const [selectedTable, setSelectedTable] = useState<TableHistoryEntry | null>(null);

  // Fetch aggregate stats if registered
  useEffect(() => {
    if (!user) return;
    const userRef = doc(db, "users", user.uid);
    const unsub = onSnapshot(userRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.stats) {
          setStats({
            handsPlayed: data.stats.handsPlayed || 0,
            handsWon: data.stats.handsWon || 0,
            netProfit: data.stats.netProfit || 0,
            sessionsPlayed: data.stats.sessionsPlayed || 0
          });
        }
      }
    });
    return () => unsub();
  }, [user]);

  // Fetch Leaderboard
  useEffect(() => {
    const q = query(
      collection(db, "users"),
      where("isRegistered", "==", true),
      orderBy("stats.netProfit", "desc"),
      limit(10)
    );

    const unsub = onSnapshot(q, (snap) => {
      const list: LeaderboardUser[] = [];
      snap.forEach((d) => {
        const data = d.data();
        list.push({
          uid: d.id,
          username: data.username || "Player",
          netProfit: data.stats?.netProfit || 0,
          handsWon: data.stats?.handsWon || 0
        });
      });
      setLeaderboard(list);
    }, (err) => {
      console.error("Leaderboard error:", err);
    });

    return () => unsub();
  }, []);

  // Fetch Match History
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "table_history"),
      where("playerIds", "array-contains", user.uid),
      orderBy("endedAt", "desc"),
      limit(10)
    );

    const unsub = onSnapshot(q, (snap) => {
      const list: TableHistoryEntry[] = [];
      snap.forEach((d) => {
        const data = d.data();
        const myData = data.players?.find((p: any) => p.userId === user.uid);
        list.push({
          tableId: d.id,
          tableName: data.tableName || "Tavolo",
          mode: data.mode || "CASH",
          endedAt: data.endedAt,
          netProfit: myData ? myData.netProfit : 0,
          players: data.players || []
        });
      });
      setHistory(list);
    }, (err) => {
      console.error("History error:", err);
    });

    return () => unsub();
  }, [user]);

  // Fetch Friends
  useEffect(() => {
    if (!user) return;
    const q = collection(db, "users", user.uid, "friends");
    const unsub = onSnapshot(q, (snap) => {
      const list: Friend[] = [];
      snap.forEach((d) => {
        const data = d.data();
        list.push({
          friendUid: d.id,
          username: data.username || "Friend",
          status: data.status
        });
      });
      setFriends(list);
    });
    return () => unsub();
  }, [user]);

  async function handleLogout() {
    try {
      await logout();
      navigate("/");
    } catch (e) {
      console.error(e);
    }
  }

  async function handleJoinTable(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toLowerCase();
    if (!code) return;
    navigate(`/table/${code}`);
  }

  async function handleAddFriend(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    const friendName = friendInput.trim().replace("@", "");
    if (!friendName) return;

    if (friendName.toLowerCase() === username?.toLowerCase()) {
      setErrorMsg(t("dashboard.errFriendSelf"));
      return;
    }

    try {
      setLoadingAction(true);
      // Check if username exists
      const usernameDocRef = doc(db, "usernames", friendName.toLowerCase());
      const usernameSnap = await getDoc(usernameDocRef);
      if (!usernameSnap.exists()) {
        setErrorMsg(t("dashboard.errFriendNotFound", { name: friendName }));
        return;
      }

      const friendUid = usernameSnap.data().uid;

      // Check if already friends/pending
      const checkFriendRef = doc(db, "users", user!.uid, "friends", friendUid);
      const checkFriendSnap = await getDoc(checkFriendRef);
      if (checkFriendSnap.exists()) {
        setErrorMsg(t("dashboard.errFriendExists"));
        return;
      }

      // Create request
      // Me -> Friend (PENDING_SENT)
      await setDoc(doc(db, "users", user!.uid, "friends", friendUid), {
        friendUid,
        username: friendName,
        status: "PENDING_SENT"
      });

      // Friend -> Me (PENDING_RECEIVED)
      await setDoc(doc(db, "users", friendUid, "friends", user!.uid), {
        friendUid: user!.uid,
        username: username,
        status: "PENDING_RECEIVED"
      });

      setSuccessMsg(t("dashboard.successFriendRequest", { name: friendName }));
      setFriendInput("");
    } catch (err: any) {
      console.error(err);
      setErrorMsg(t("dashboard.errFriendGeneric"));
    } finally {
      setLoadingAction(false);
    }
  }

  async function handleAcceptFriend(friend: Friend) {
    try {
      // Update my friend doc to ACCEPTED
      await updateDoc(doc(db, "users", user!.uid, "friends", friend.friendUid), {
        status: "ACCEPTED"
      });
      // Update friend's friend doc to ACCEPTED
      await updateDoc(doc(db, "users", friend.friendUid, "friends", user!.uid), {
        status: "ACCEPTED"
      });
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDeclineFriend(friend: Friend) {
    try {
      await deleteDoc(doc(db, "users", user!.uid, "friends", friend.friendUid));
      await deleteDoc(doc(db, "users", friend.friendUid, "friends", user!.uid));
    } catch (e) {
      console.error(e);
    }
  }

  async function handleUpgradeAccount(e: React.FormEvent) {
    e.preventDefault();
    setUpgradeError(null);

    const name = upgradeUsername.trim();
    const email = upgradeEmail.trim();
    const pass = upgradePassword;

    if (!name || !email || !pass) {
      setUpgradeError(t("dashboard.errorAllFieldsRequired") || "Compila tutti i campi.");
      return;
    }

    try {
      setLoadingAction(true);
      await linkGuestToRegistered(email, pass, name, "email");
      setShowUpgradeModal(false);
      setSuccessMsg("Account registrato con successo! Ora sei un utente registrato.");
    } catch (err: any) {
      console.error(err);
      setUpgradeError(err?.message || "Errore durante la registrazione.");
    } finally {
      setLoadingAction(false);
    }
  }

  async function handleUpgradeWithGoogle() {
    setUpgradeError(null);
    try {
      setLoadingAction(true);
      await linkGuestToRegistered("", "", "", "google");
      setShowUpgradeModal(false);
      setSuccessMsg("Account registrato con successo tramite Google!");
    } catch (err: any) {
      console.error(err);
      setUpgradeError(err?.message || "Errore durante la registrazione con Google.");
    } finally {
      setLoadingAction(false);
    }
  }

  return (
    <div className="dashboard-layout" id="dashboard-page-container">
      
      {/* Top Welcome & Profile Widget */}
      <div className="glass-panel profile-widget-panel" id="profile-widget">
        <div className="profile-widget-info">
          <div className={`profile-avatar-circle ${isRegisteredUser ? "registered" : "guest"}`}>
            {isRegisteredUser ? <Crown size={26} /> : <UserIcon size={26} />}
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 800 }}>
                {isRegisteredUser ? `@${username}` : username || t("dashboard.welcomeGuest")}
              </h2>
              <span className={`profile-badge-status ${isRegisteredUser ? "registered" : "guest"}`}>
                {isRegisteredUser ? t("dashboard.statusRegistered") : t("dashboard.statusGuest")}
              </span>
            </div>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0.1rem 0 0 0" }}>
              {isRegisteredUser ? t("dashboard.statsActive") : t("dashboard.statsSession")}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.6rem" }}>
          {!isRegisteredUser && (
            <button 
              id="btn-trigger-upgrade-modal"
              onClick={() => { setUpgradeUsername(username || ""); setShowUpgradeModal(true); }}
              className="poker-btn-primary"
              style={{ padding: "0.55rem 1rem", borderRadius: "99px", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.3rem" }}
            >
              <Sparkles size={15} />
              {t("dashboard.btnRegister")}
            </button>
          )}
          <button 
            id="btn-logout"
            onClick={handleLogout}
            style={{
              padding: "0.55rem 1rem",
              borderRadius: "99px",
              border: "1px solid rgba(255,255,255,0.08)",
              backgroundColor: "rgba(255,255,255,0.02)",
              color: "var(--text-muted)",
              fontSize: "0.85rem",
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "0.3rem"
            }}
          >
            <LogOut size={15} />
            {t("dashboard.btnLogout")}
          </button>
        </div>
      </div>

      {/* Grid of Actions and Quick Join */}
      <div className="dashboard-actions-grid">
        
        {/* Create and Join Table Action */}
        <div className="glass-panel actions-card-panel" id="card-table-actions">
          <h3 style={{ fontSize: "1.1rem", fontWeight: 800, fontFamily: "var(--font-display)" }}>{t("dashboard.tableActions")}</h3>
          
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <button
              id="btn-create-table"
              onClick={() => navigate("/create")}
              className="poker-btn-primary"
              style={{
                width: "100%",
                padding: "0.85rem",
                borderRadius: "0.75rem",
                border: "none",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: "0.95rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem"
              }}
            >
              <PlusCircle size={18} />
              {t("dashboard.btnCreateTable")}
            </button>

            <form onSubmit={handleJoinTable} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  id="input-join-code"
                  type="text"
                  placeholder={t("dashboard.inputJoinPlaceholder") || "Codice tavolo..."}
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  style={{ flex: 1, borderRadius: "0.75rem", padding: "0.75rem 0.9rem", fontSize: "0.9rem" }}
                />
                <button
                  id="btn-submit-join-code"
                  type="submit"
                  className="poker-btn-secondary"
                  disabled={!joinCode.trim()}
                  style={{
                    padding: "0.75rem 1.2rem",
                    borderRadius: "0.75rem",
                    fontWeight: 700,
                    fontSize: "0.9rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.3rem"
                  }}
                >
                  <Users size={18} />
                  {t("dashboard.btnJoinTable")}
                </button>
              </div>
              <button
                type="button"
                id="btn-scan-qr"
                onClick={() => navigate("/join")}
                className="poker-btn-secondary"
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  borderRadius: "0.75rem",
                  fontWeight: 700,
                  fontSize: "0.9rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem"
                }}
              >
                <Camera size={18} />
                {t("dashboard.btnScanQr")}
              </button>
            </form>
          </div>
        </div>

        {/* Quick Stats Summary Widget */}
        <div className="glass-panel stats-card-panel" id="card-stats-display">
          <h3 style={{ fontSize: "1.1rem", fontWeight: 800, fontFamily: "var(--font-display)" }}>{t("dashboard.myStats")}</h3>
          
          {isRegisteredUser ? (
            <div className="dashboard-stats-grid">
              <div className="dashboard-stat-box">
                <span className="stat-box-label">{t("dashboard.handsPlayed")}</span>
                <span className="stat-box-value">{stats.handsPlayed}</span>
              </div>
              <div className="dashboard-stat-box">
                <span className="stat-box-label">{t("dashboard.winRate")}</span>
                <span className="stat-box-value" style={{ color: "var(--color-success)" }}>
                  {stats.handsPlayed > 0 ? `${Math.round((stats.handsWon / stats.handsPlayed) * 100)}%` : "0%"}
                </span>
              </div>
              <div className="dashboard-stat-box">
                <span className="stat-box-label">{t("dashboard.netProfit")}</span>
                <span className="stat-box-value" style={{ 
                  color: stats.netProfit > 0 ? "#10b981" : stats.netProfit < 0 ? "#ef4444" : "#fff" 
                }}>
                  {stats.netProfit > 0 ? `+${stats.netProfit}` : stats.netProfit}
                </span>
              </div>
              <div className="dashboard-stat-box">
                <span className="stat-box-label">{t("dashboard.sessionsPlayed")}</span>
                <span className="stat-box-value">{stats.sessionsPlayed}</span>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: "0.6rem", textAlign: "center", padding: "0.5rem" }}>
              <KeyRound size={32} style={{ color: "var(--text-muted)", opacity: 0.6 }} />
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: 1.4, margin: 0 }}>
                {t("dashboard.statsGuestWarning")}
              </p>
              <button 
                id="btn-register-link-from-stats"
                onClick={() => { setUpgradeUsername(username || ""); setShowUpgradeModal(true); }}
                style={{ background: "none", border: "none", color: "var(--color-primary)", fontWeight: 700, cursor: "pointer", fontSize: "0.85rem", textDecoration: "underline" }}
              >
                {t("dashboard.btnRegisterNow")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Tabbed Area (Leaderboard, History, Friends) */}
      <div className="glass-panel dashboard-tabs-panel" id="dashboard-tab-panel">
        
        {/* Tab Buttons */}
        <div className="dashboard-tabs-bar" id="dashboard-tab-bar">
          <button
            id="tab-btn-leaderboard"
            onClick={() => setActiveTab("leaderboard")}
            className={`dashboard-tab-btn ${activeTab === "leaderboard" ? "active" : ""}`}
          >
            <Trophy size={16} />
            {t("dashboard.tabLeaderboard")}
          </button>
          
          <button
            id="tab-btn-history"
            onClick={() => setActiveTab("history")}
            className={`dashboard-tab-btn ${activeTab === "history" ? "active" : ""}`}
          >
            <History size={16} />
            {t("dashboard.tabHistory")}
          </button>

          <button
            id="tab-btn-friends"
            onClick={() => setActiveTab("friends")}
            className={`dashboard-tab-btn ${activeTab === "friends" ? "active" : ""}`}
          >
            <Users size={16} />
            {t("dashboard.tabFriends")}
          </button>
        </div>

        {/* Tab Content Panels */}
        <div className="dashboard-tab-content">
          
          {/* LEADERBOARD TAB */}
          {activeTab === "leaderboard" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              <div className="list-header-row">
                <span>{t("dashboard.colPlayer")}</span>
                <span>{t("dashboard.colProfit")}</span>
              </div>
              
              {leaderboard.length === 0 ? (
                <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)", fontSize: "0.9rem" }}>
                  {t("dashboard.noLeaderboard")}
                </div>
              ) : (
                leaderboard.map((item, idx) => (
                  <div 
                    key={item.uid}
                    className={`list-item-row ${item.uid === user?.uid ? "highlighted" : ""}`}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                      <span style={{ 
                        fontSize: "0.9rem", 
                        fontWeight: 800, 
                        color: idx === 0 ? "#fbbf24" : idx === 1 ? "#cbd5e1" : idx === 2 ? "#b45309" : "var(--text-muted)",
                        width: "20px"
                      }}>
                        {idx + 1}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>@{item.username}</span>
                    </div>
                    <span style={{ 
                      fontWeight: 700, 
                      fontSize: "0.9rem",
                      color: item.netProfit > 0 ? "#10b981" : item.netProfit < 0 ? "#ef4444" : "#fff"
                    }}>
                      {item.netProfit > 0 ? `+${item.netProfit}` : item.netProfit}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TABLE HISTORY TAB */}
          {activeTab === "history" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {history.length === 0 ? (
                <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)", fontSize: "0.9rem" }}>
                  {t("dashboard.noHistory")}
                </div>
              ) : (
                history.map((entry) => (
                  <div 
                    key={entry.tableId}
                    onClick={() => setSelectedTable(entry)}
                    className="list-item-row clickable"
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{entry.tableName}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.15rem", display: "flex", gap: "0.5rem" }}>
                        <span>{t("dashboard.colTableId")}: {entry.tableId.toUpperCase()}</span>
                        <span>•</span>
                        <span>{entry.mode}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <span style={{ 
                        fontWeight: 700, 
                        fontSize: "0.9rem",
                        color: entry.netProfit > 0 ? "#10b981" : entry.netProfit < 0 ? "#ef4444" : "#fff",
                        display: "flex",
                        alignItems: "center"
                      }}>
                        {entry.netProfit > 0 ? <ArrowUpRight size={16} /> : entry.netProfit < 0 ? <ArrowDownRight size={16} /> : null}
                        {entry.netProfit > 0 ? `+${entry.netProfit}` : entry.netProfit}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* FRIENDS TAB */}
          {activeTab === "friends" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              
              {/* Add Friend Form */}
              <form onSubmit={handleAddFriend} style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  id="input-friend-username"
                  type="text"
                  placeholder={t("dashboard.inputFriendPlaceholder") || "Username..."}
                  value={friendInput}
                  onChange={(e) => setFriendInput(e.target.value)}
                  style={{ flex: 1, borderRadius: "0.6rem", padding: "0.6rem 0.8rem", fontSize: "0.85rem" }}
                />
                <button
                  id="btn-send-friend-request"
                  type="submit"
                  className="poker-btn-primary"
                  disabled={loadingAction || !friendInput.trim()}
                  style={{
                    padding: "0.6rem 1.2rem",
                    borderRadius: "0.6rem",
                    fontWeight: 700,
                    fontSize: "0.85rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.3rem"
                  }}
                >
                  <UserPlus size={16} />
                  {t("dashboard.btnSendRequest")}
                </button>
              </form>

              {errorMsg && <p style={{ fontSize: "0.8rem", color: "var(--color-danger)", margin: 0 }}>{errorMsg}</p>}
              {successMsg && <p style={{ fontSize: "0.8rem", color: "var(--color-success)", margin: 0 }}>{successMsg}</p>}

              {/* Friends List */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {friends.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)", fontSize: "0.9rem" }}>
                    {t("dashboard.noFriends")}
                  </div>
                ) : (
                  friends.map((friend) => (
                    <div 
                      key={friend.friendUid}
                      className="list-item-row"
                    >
                      <div>
                        <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>@{friend.username}</span>
                        {friend.status === "PENDING_SENT" && (
                          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginLeft: "0.5rem" }}>({t("dashboard.statusPendingSent")})</span>
                        )}
                        {friend.status === "PENDING_RECEIVED" && (
                          <span style={{ fontSize: "0.7rem", color: "#fbbf24", marginLeft: "0.5rem", fontWeight: 600 }}>({t("dashboard.statusPendingReceived")})</span>
                        )}
                      </div>

                      {friend.status === "PENDING_RECEIVED" && (
                        <div style={{ display: "flex", gap: "0.4rem" }}>
                          <button 
                            onClick={() => handleAcceptFriend(friend)}
                            style={{
                              padding: "0.3rem 0.6rem",
                              borderRadius: "0.4rem",
                              border: "none",
                              backgroundColor: "var(--color-success)",
                              color: "#fff",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center"
                            }}
                          >
                            <Check size={14} />
                          </button>
                          <button 
                            onClick={() => handleDeclineFriend(friend)}
                            style={{
                              padding: "0.3rem 0.6rem",
                              borderRadius: "0.4rem",
                              border: "none",
                              backgroundColor: "var(--color-danger)",
                              color: "#fff",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center"
                            }}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      )}

                      {friend.status === "PENDING_SENT" && (
                        <button 
                          onClick={() => handleDeclineFriend(friend)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--color-danger)",
                            cursor: "pointer",
                            fontSize: "0.75rem",
                            fontWeight: 600
                          }}
                        >
                          {t("dashboard.btnCancel")}
                        </button>
                      )}

                      {friend.status === "ACCEPTED" && (
                        <button 
                          onClick={() => navigate(`/user/${friend.username}`)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--color-primary)",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                            fontWeight: 600
                          }}
                        >
                          {t("dashboard.btnViewProfile")}
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer info links */}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem" }} id="dashboard-footer-links">
        <button
          id="btn-footer-about"
          onClick={() => navigate("/about")}
          style={{ background: "transparent", border: "none", color: "var(--color-primary)", cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.3rem" }}
        >
          <Info size={15} />
          {t("dashboard.footerAbout")}
        </button>
        
        <button
          id="btn-footer-terms"
          onClick={() => navigate("/terms")}
          style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.3rem" }}
        >
          <FileText size={15} />
          {t("dashboard.footerTerms")}
        </button>
      </div>

      {/* 1. UPGRADE ACCOUNT MODAL */}
      {showUpgradeModal && (
        <div className="modal-overlay" id="modal-upgrade-account">
          <div className="glass-panel modal-panel-box">
            <div style={{ textAlign: "center" }}>
              <h2 style={{ fontSize: "1.5rem", fontWeight: 800, fontFamily: "var(--font-display)", color: "#fbbf24" }}>
                {t("dashboard.modalUpgradeTitle")}
              </h2>
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
                {t("dashboard.modalUpgradeSubtitle")}
              </p>
            </div>

            <form onSubmit={handleUpgradeAccount} className="form-group" id="form-upgrade-account">
              <div className="form-group">
                <label className="form-label-title">{t("dashboard.labelUniqueUsername")}</label>
                <div className="input-with-username-at">
                  <span className="input-username-at">@</span>
                  <input
                    id="input-upgrade-username"
                    type="text"
                    value={upgradeUsername}
                    onChange={(e) => setUpgradeUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label-title">{t("dashboard.labelEmail")}</label>
                <input
                  id="input-upgrade-email"
                  type="email"
                  placeholder={t("dashboard.labelEmail")}
                  value={upgradeEmail}
                  onChange={(e) => setUpgradeEmail(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label-title">{t("dashboard.labelPassword")}</label>
                <input
                  id="input-upgrade-password"
                  type="password"
                  placeholder={t("dashboard.placeholderPasswordMin")}
                  value={upgradePassword}
                  onChange={(e) => setUpgradePassword(e.target.value)}
                  minLength={6}
                  required
                />
              </div>

              {upgradeError && <p style={{ fontSize: "0.8rem", color: "var(--color-danger)", margin: 0 }}>{upgradeError}</p>}

              <button
                id="btn-submit-upgrade"
                type="submit"
                disabled={loadingAction}
                className="poker-btn-primary"
                style={{ width: "100%", padding: "0.75rem", borderRadius: "99px", fontWeight: 800, marginTop: "0.3rem" }}
              >
                {loadingAction ? t("login.btnRegistering") : t("dashboard.btnConfirmRegister")}
              </button>
            </form>

            <div style={{ display: "flex", alignItems: "center" }}>
              <hr style={{ flex: 1, border: "none", borderTop: "1px solid rgba(255,255,255,0.08)" }} />
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", padding: "0 0.5rem" }}>{t("dashboard.textOr")}</span>
              <hr style={{ flex: 1, border: "none", borderTop: "1px solid rgba(255,255,255,0.08)" }} />
            </div>

            <button
              id="btn-upgrade-with-google"
              onClick={handleUpgradeWithGoogle}
              disabled={loadingAction}
              className="poker-btn-secondary"
              style={{ width: "100%", padding: "0.7rem", borderRadius: "99px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
              </svg>
              {t("dashboard.btnLinkGoogle")}
            </button>

            <button 
              id="btn-cancel-upgrade"
              onClick={() => setShowUpgradeModal(false)}
              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600 }}
            >
              {t("dashboard.btnCancel")}
            </button>
          </div>
        </div>
      )}

      {/* 2. TABLE DETAILS MODAL */}
      {selectedTable && (
        <div className="modal-overlay" id="modal-table-details">
          <div className="glass-panel modal-panel-box">
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                <h3 style={{ fontSize: "1.2rem", fontWeight: 800 }}>{selectedTable.tableName}</h3>
                <button 
                  id="btn-close-table-details-x"
                  onClick={() => setSelectedTable(null)} 
                  style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}
                >
                  <X size={20} />
                </button>
              </div>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.15rem 0 0 0" }}>
                {t("dashboard.colTableId")}: {selectedTable.tableId.toUpperCase()} • {t("dashboard.colMode")}: {selectedTable.mode}
              </p>
            </div>

            <div style={{ display: "grid", gap: "0.6rem" }}>
              <div className="list-header-row" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "0.3rem" }}>
                <span>{t("dashboard.colPlayer")}</span>
                <span style={{ textAlign: "right" }}>{t("dashboard.colProfitDetail")}</span>
              </div>

              {selectedTable.players?.map((p: any) => (
                <div key={p.userId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0" }}>
                  <span style={{ fontSize: "0.9rem", fontWeight: p.userId === user?.uid ? 700 : 500 }}>
                    {p.displayName} {p.userId === user?.uid && ` (${t("dashboard.textYou")})`}
                  </span>
                  <span style={{ 
                    fontSize: "0.9rem", 
                    fontWeight: 700,
                    color: p.netProfit > 0 ? "#10b981" : p.netProfit < 0 ? "#ef4444" : "#fff" 
                  }}>
                    {p.netProfit > 0 ? `+${p.netProfit}` : p.netProfit}
                  </span>
                </div>
              ))}
            </div>

            <button
              id="btn-close-table-details-bottom"
              onClick={() => setSelectedTable(null)}
              className="poker-btn-secondary"
              style={{ width: "100%", padding: "0.65rem", borderRadius: "99px", fontWeight: 700 }}
            >
              {t("dashboard.btnClose")}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
