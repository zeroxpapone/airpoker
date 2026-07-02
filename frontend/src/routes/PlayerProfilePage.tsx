import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTranslation } from "react-i18next";
import { 
  ArrowLeft, 
  User, 
  Trophy, 
  Play, 
  UserPlus, 
  UserMinus, 
  UserCheck, 
  Clock, 
  AlertCircle,
  TrendingUp,
  Award,
  Calendar
} from "lucide-react";
import { 
  collection, 
  query, 
  where, 
  limit, 
  getDocs, 
  doc, 
  setDoc, 
  deleteDoc, 
  updateDoc,
  onSnapshot
} from "firebase/firestore";
import { db } from "../lib/firebase";
import AdvancedStats, { type AdvancedStatsData } from "../components/AdvancedStats";

interface TargetUser {
  uid: string;
  username: string;
  photoURL?: string;
  createdAt?: any;
  stats: AdvancedStatsData;
}

export default function PlayerProfilePage() {
  const { username: targetUsername } = useParams();
  const { user, username: myUsername, isRegisteredUser } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [targetUser, setTargetUser] = useState<TargetUser | null>(null);
  const [targetUserPresence, setTargetUserPresence] = useState<any>(null);
  const [friendStatus, setFriendStatus] = useState<"NONE" | "PENDING_SENT" | "PENDING_RECEIVED" | "ACCEPTED" | "SELF">("NONE");
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load target user profile and real-time presence
  useEffect(() => {
    if (!targetUsername) return;
    setLoading(true);
    setErrorMsg(null);

    let unsubPresence: (() => void) | undefined;

    async function fetchTargetUser() {
      try {
        if (!targetUsername) return;
        const q = query(collection(db, "users"), where("usernameLowercase", "==", targetUsername.toLowerCase()), limit(1));
        const snap = await getDocs(q);
        if (snap.empty) {
          setErrorMsg(t("profile.errPlayerNotFound"));
          setLoading(false);
          return;
        }

        const userDoc = snap.docs[0];
        const data = userDoc.data();
        
        setTargetUser({
          uid: userDoc.id,
          username: data.username || targetUsername || "Player",
          photoURL: data.photoURL || undefined,
          createdAt: data.createdAt,
          stats: {
            handsPlayed: data.stats?.handsPlayed || 0,
            handsWon: data.stats?.handsWon || 0,
            totalChipsWon: data.stats?.totalChipsWon || 0,
            totalChipsLost: data.stats?.totalChipsLost || 0,
            netProfit: data.stats?.netProfit || 0,
            sessionsPlayed: data.stats?.sessionsPlayed || 0,
            timePlayedSeconds: data.stats?.timePlayedSeconds || 0,
            bestHandName: data.stats?.bestHandName || "Nessuna",
            vpipCount: data.stats?.vpipCount || 0,
            totalActions: data.stats?.totalActions || 0,
            aggressiveActions: data.stats?.aggressiveActions || 0,
            stagePreflopCount: data.stats?.stagePreflopCount || 0,
            stageFlopCount: data.stats?.stageFlopCount || 0,
            stageTurnCount: data.stats?.stageTurnCount || 0,
            stageRiverCount: data.stats?.stageRiverCount || 0
          }
        });

        // Set up real-time presence listener
        unsubPresence = onSnapshot(doc(db, "users", userDoc.id), (docSnap) => {
          if (docSnap.exists()) {
            setTargetUserPresence(docSnap.data().presence || null);
          }
        });

        if (user && userDoc.id === user.uid) {
          setFriendStatus("SELF");
        }
      } catch (err) {
        console.error(err);
        setErrorMsg(t("profile.errPlayerLoad"));
      } finally {
        setLoading(false);
      }
    }

    fetchTargetUser();

    return () => {
      if (unsubPresence) unsubPresence();
    };
  }, [targetUsername, user]);

  // Listen to friend status
  useEffect(() => {
    if (!user || !targetUser || targetUser.uid === user.uid) return;

    const friendDocRef = doc(db, "users", user.uid, "friends", targetUser.uid);
    const unsub = onSnapshot(friendDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setFriendStatus(data.status);
      } else {
        setFriendStatus("NONE");
      }
    });

    return () => unsub();
  }, [user, targetUser]);

  async function handleAddFriend() {
    if (!user || !targetUser) return;
    
    // Only registered users can add friends
    if (!isRegisteredUser) {
      alert(t("dashboard.errGuestCannotAddFriend") || "Solo gli utenti registrati possono aggiungere amici.");
      return;
    }
    
    try {
      // Me -> Target (PENDING_SENT)
      await setDoc(doc(db, "users", user.uid, "friends", targetUser.uid), {
        friendUid: targetUser.uid,
        username: targetUser.username,
        status: "PENDING_SENT"
      });

      // Target -> Me (PENDING_RECEIVED)
      await setDoc(doc(db, "users", targetUser.uid, "friends", user.uid), {
        friendUid: user.uid,
        username: myUsername,
        status: "PENDING_RECEIVED"
      });
    } catch (e) {
      console.error(e);
    }
  }

  async function handleAcceptFriend() {
    if (!user || !targetUser) return;
    try {
      await updateDoc(doc(db, "users", user.uid, "friends", targetUser.uid), {
        status: "ACCEPTED"
      });
      await updateDoc(doc(db, "users", targetUser.uid, "friends", user.uid), {
        status: "ACCEPTED"
      });
    } catch (e) {
      console.error(e);
    }
  }

  async function handleRemoveFriend() {
    if (!user || !targetUser) return;
    if (!window.confirm(t("profile.confirmRemoveFriend", { name: targetUser.username }))) return;
    try {
      await deleteDoc(doc(db, "users", user.uid, "friends", targetUser.uid));
      await deleteDoc(doc(db, "users", targetUser.uid, "friends", user.uid));
    } catch (e) {
      console.error(e);
    }
  }

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "80vh", color: "var(--text-muted)" }} id="player-profile-loading">
        Caricamento profilo...
      </div>
    );
  }

  if (errorMsg || !targetUser) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", padding: "2rem", textAlign: "center" }} id="player-profile-error-container">
        <AlertCircle size={40} style={{ color: "var(--color-danger)" }} />
        <p style={{ color: "var(--text-muted)" }} id="player-profile-error-text">{errorMsg || "Profilo non trovato."}</p>
        <button id="btn-player-profile-error-home" onClick={() => navigate("/home")} className="poker-btn-secondary" style={{ padding: "0.6rem 1.2rem", borderRadius: "99px" }}>
          {t("profile.btnBackHome")}
        </button>
      </div>
    );
  }

  const winRate = targetUser.stats.handsPlayed > 0 ? Math.round((targetUser.stats.handsWon / targetUser.stats.handsPlayed) * 100) : 0;

  return (
    <div className="profile-layout" id="player-profile-page-container">
      
      {/* Header with back button */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <button 
          id="btn-player-profile-back"
          onClick={() => navigate("/home")}
          className="profile-back-btn"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 style={{ fontSize: "1.6rem", fontWeight: 800, fontFamily: "var(--font-display)" }} id="player-profile-title">
          {t("profile.titlePlayer")}
        </h1>
      </div>

      {/* Profile Card Header */}
      <div className="glass-panel" style={{ padding: "1.5rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "1.2rem", textAlign: "center" }} id="player-profile-card-header">
        <div className="profile-avatar-large registered-green" id="player-profile-avatar-icon">
          {targetUser.photoURL ? (
            <img src={targetUser.photoURL} alt="Avatar" className="profile-avatar-large-img" />
          ) : (
            <User size={40} />
          )}
        </div>

        <div>
          <h2 style={{ fontSize: "1.4rem", fontWeight: 800 }} id="player-profile-username-label">@{targetUser.username}</h2>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.2rem" }} id="player-profile-status-label">
            {t("profile.statusRegistered")}
          </p>
          {targetUser.createdAt && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.3rem", fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.5rem" }} id="player-profile-membership-date">
              <Calendar size={13} />
              <span>
                {t("profile.memberSince", { date: new Date(targetUser.createdAt.seconds * 1000).toLocaleDateString() })}
              </span>
            </div>
          )}
        </div>

        {/* Social / Friendship Buttons */}
        {user && friendStatus !== "SELF" && (
          <div style={{ marginTop: "0.4rem", width: "100%", maxWidth: "240px" }} id="friendship-controls">
            {friendStatus === "NONE" && (
              <button 
                id="btn-friendship-add"
                onClick={handleAddFriend}
                className="poker-btn-primary"
                style={{ width: "100%", padding: "0.65rem", borderRadius: "99px", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", fontSize: "0.9rem" }}
              >
                <UserPlus size={16} />
                {t("profile.btnAddFriend")}
              </button>
            )}

            {friendStatus === "PENDING_SENT" && (
              <button 
                id="btn-friendship-pending-sent"
                disabled
                style={{ width: "100%", padding: "0.65rem", borderRadius: "99px", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", fontSize: "0.9rem", backgroundColor: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--text-muted)", cursor: "default" }}
              >
                <Clock size={16} />
                {t("profile.btnRequestSent")}
              </button>
            )}

            {friendStatus === "PENDING_RECEIVED" && (
              <button 
                id="btn-friendship-accept"
                onClick={handleAcceptFriend}
                className="poker-btn-primary"
                style={{ width: "100%", padding: "0.65rem", borderRadius: "99px", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", fontSize: "0.9rem", backgroundColor: "#fbbf24", color: "#000" }}
              >
                <UserCheck size={16} />
                {t("profile.btnAcceptRequest")}
              </button>
            )}

            {friendStatus === "ACCEPTED" && (
              <button 
                id="btn-friendship-remove"
                onClick={handleRemoveFriend}
                style={{
                  width: "100%",
                  padding: "0.65rem",
                  borderRadius: "99px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.4rem",
                  fontSize: "0.9rem",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  backgroundColor: "rgba(239, 68, 68, 0.08)",
                  color: "#ef4444",
                  cursor: "pointer",
                  fontWeight: 700
                }}
              >
                <UserMinus size={16} />
                {t("profile.btnRemoveFriend")}
              </button>
            )}
          </div>
        )}

        {/* Join Active Table Button */}
        {targetUserPresence?.status === "ONLINE" &&
         targetUserPresence?.location === "TABLE" &&
         targetUserPresence?.tableId && (
          <button
            id="btn-player-profile-join-table"
            onClick={() => navigate(`/table/${targetUserPresence.tableId}`)}
            className="poker-btn-success"
            style={{ width: "100%", maxWidth: "240px", padding: "0.65rem", borderRadius: "99px", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", fontSize: "0.9rem", marginTop: "0.5rem" }}
          >
            <Play size={16} fill="currentColor" />
            Unisciti al Tavolo
          </button>
        )}
      </div>

      {/* Grid of Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }} id="player-profile-stats-grid">
        
        <div className="glass-panel" style={{ padding: "1rem", display: "flex", alignItems: "center", gap: "0.8rem" }} id="player-stat-hands-played">
          <div className="icon-wrapper-base blue">
            <Play size={20} />
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>{t("profile.handsPlayed")}</div>
            <div style={{ fontSize: "1.25rem", fontWeight: 800, marginTop: "0.1rem" }}>{targetUser.stats.handsPlayed}</div>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: "1rem", display: "flex", alignItems: "center", gap: "0.8rem" }} id="player-stat-hands-won">
          <div className="icon-wrapper-base green">
            <Trophy size={20} />
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>{t("profile.handsWon")}</div>
            <div style={{ fontSize: "1.25rem", fontWeight: 800, marginTop: "0.1rem" }}>{targetUser.stats.handsWon} ({winRate}%)</div>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: "1rem", display: "flex", alignItems: "center", gap: "0.8rem" }} id="player-stat-net-profit">
          <div className="icon-wrapper-base yellow">
            <TrendingUp size={20} />
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>{t("profile.netProfit")}</div>
            <div style={{ 
              fontSize: "1.25rem", 
              fontWeight: 800, 
              marginTop: "0.1rem",
              color: targetUser.stats.netProfit > 0 ? "#10b981" : targetUser.stats.netProfit < 0 ? "#ef4444" : "#fff"
            }}>
              {targetUser.stats.netProfit > 0 ? `+${targetUser.stats.netProfit}` : targetUser.stats.netProfit}
            </div>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: "1rem", display: "flex", alignItems: "center", gap: "0.8rem" }} id="player-stat-best-hand">
          <div className="icon-wrapper-base pink">
            <Award size={20} />
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>{t("profile.bestHand")}</div>
            <div style={{ fontSize: "1rem", fontWeight: 800, marginTop: "0.1rem" }}>{targetUser.stats.bestHandName || "Nessuna"}</div>
          </div>
        </div>

      </div>

      {/* Advanced Statistics Section */}
      <div style={{ width: "100%", marginTop: "1rem" }} id="player-profile-advanced-stats">
        <h3 style={{ fontSize: "1.2rem", fontWeight: 800, fontFamily: "var(--font-display)", marginTop: "1.5rem", marginBottom: "0.5rem" }}>
          {t("stats.title") || "Statistiche Dettagliate"}
        </h3>
        <AdvancedStats stats={targetUser.stats} />
      </div>

    </div>
  );
}
