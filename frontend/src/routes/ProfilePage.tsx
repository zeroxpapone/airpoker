import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTranslation } from "react-i18next";
import { 
   ArrowLeft, 
   Crown, 
   Calendar, 
   Trophy, 
   Play, 
   Check, 
   AlertCircle,
   TrendingUp,
   Award
} from "lucide-react";
import { doc, getDoc, runTransaction } from "firebase/firestore";
import { db } from "../lib/firebase";

export default function ProfilePage() {
  const { user, username, isRegisteredUser } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [stats, setStats] = useState({
    handsPlayed: 0,
    handsWon: 0,
    totalChipsWon: 0,
    totalChipsLost: 0,
    netProfit: 0,
    sessionsPlayed: 0,
    bestHandName: "",
    createdAt: null as any
  });

  const [newUsername, setNewUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isRegisteredUser) {
      navigate("/home");
      return;
    }
  }, [isRegisteredUser, navigate]);

  // Fetch full profile and stats
  useEffect(() => {
    if (!user) return;
    async function fetchProfile() {
      try {
        const docSnap = await getDoc(doc(db, "users", user!.uid));
        if (docSnap.exists()) {
          const data = docSnap.data();
          setNewUsername(data.username || "");
          if (data.stats) {
            setStats({
              handsPlayed: data.stats.handsPlayed || 0,
              handsWon: data.stats.handsWon || 0,
              totalChipsWon: data.stats.totalChipsWon || 0,
              totalChipsLost: data.stats.totalChipsLost || 0,
              netProfit: data.stats.netProfit || 0,
              sessionsPlayed: data.stats.sessionsPlayed || 0,
              bestHandName: data.stats.bestHandName || "Nessuna",
              createdAt: data.createdAt
            });
          }
        }
      } catch (e) {
        console.error(e);
      }
    }
    fetchProfile();
  }, [user]);

  async function handleUpdateUsername(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanName = newUsername.trim();
    if (!cleanName || cleanName.length < 3) {
      setErrorMsg(t("profile.errUsernameMin"));
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(cleanName)) {
      setErrorMsg(t("profile.errUsernameChars"));
      return;
    }

    try {
      setLoading(true);

      const userDocRef = doc(db, "users", user!.uid);
      const userSnap = await getDoc(userDocRef);
      if (!userSnap.exists()) return;

      const currentUsername = userSnap.data().username;
      if (currentUsername.toLowerCase() === cleanName.toLowerCase()) {
        setSuccessMsg(t("profile.successUsernameUpdate"));
        setLoading(false);
        return;
      }

      await runTransaction(db, async (transaction) => {
        // 1. Check if new username is taken
        const newUsernameRef = doc(db, "usernames", cleanName.toLowerCase());
        const newUsernameSnap = await transaction.get(newUsernameRef);
        if (newUsernameSnap.exists()) {
          throw new Error("Questo nome utente è già occupato.");
        }

        // 2. Delete old username reservation if existed
        if (currentUsername) {
          const oldUsernameRef = doc(db, "usernames", currentUsername.toLowerCase());
          transaction.delete(oldUsernameRef);
        }

        // 3. Set new reservation
        transaction.set(newUsernameRef, { uid: user!.uid });

        // 4. Update user profile document
        transaction.update(userDocRef, { username: cleanName });
      });

      setSuccessMsg(t("profile.successUsernameUpdateReload"));
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || t("profile.errUsernameUpdateGeneric"));
    } finally {
      setLoading(false);
    }
  }

  const winRate = stats.handsPlayed > 0 ? Math.round((stats.handsWon / stats.handsPlayed) * 100) : 0;

  return (
    <div className="profile-layout" id="profile-page-container">
      
      {/* Header with back button */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <button 
          id="btn-profile-back"
          onClick={() => navigate("/home")}
          className="profile-back-btn"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 style={{ fontSize: "1.6rem", fontWeight: 800, fontFamily: "var(--font-display)" }} id="profile-title">
          {t("profile.title")}
        </h1>
      </div>

      {/* Profile Card Header */}
      <div className="glass-panel" style={{ padding: "1.5rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", textAlign: "center" }} id="profile-card-header">
        <div className="profile-avatar-large registered-yellow" id="profile-avatar-icon">
          <Crown size={40} />
        </div>

        <div>
          <h2 style={{ fontSize: "1.4rem", fontWeight: 800 }} id="profile-username-label">@{username}</h2>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.2rem" }} id="profile-email-label">{user?.email}</p>
          
          {stats.createdAt && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.3rem", fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.5rem" }} id="profile-membership-date">
              <Calendar size={13} />
              <span>
                {t("profile.memberSince", { date: new Date(stats.createdAt.seconds * 1000).toLocaleDateString() })}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Grid of Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }} id="profile-stats-grid">
        
        <div className="glass-panel" style={{ padding: "1rem", display: "flex", alignItems: "center", gap: "0.8rem" }} id="stat-card-hands-played">
          <div className="icon-wrapper-base blue">
            <Play size={20} />
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>{t("profile.handsPlayed")}</div>
            <div style={{ fontSize: "1.25rem", fontWeight: 800, marginTop: "0.1rem" }}>{stats.handsPlayed}</div>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: "1rem", display: "flex", alignItems: "center", gap: "0.8rem" }} id="stat-card-hands-won">
          <div className="icon-wrapper-base green">
            <Trophy size={20} />
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>{t("profile.handsWon")}</div>
            <div style={{ fontSize: "1.25rem", fontWeight: 800, marginTop: "0.1rem" }}>{stats.handsWon} ({winRate}%)</div>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: "1rem", display: "flex", alignItems: "center", gap: "0.8rem" }} id="stat-card-net-profit">
          <div className="icon-wrapper-base yellow">
            <TrendingUp size={20} />
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>{t("profile.netProfit")}</div>
            <div style={{ 
              fontSize: "1.25rem", 
              fontWeight: 800, 
              marginTop: "0.1rem",
              color: stats.netProfit > 0 ? "#10b981" : stats.netProfit < 0 ? "#ef4444" : "#fff"
            }}>
              {stats.netProfit > 0 ? `+${stats.netProfit}` : stats.netProfit}
            </div>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: "1rem", display: "flex", alignItems: "center", gap: "0.8rem" }} id="stat-card-best-hand">
          <div className="icon-wrapper-base pink">
            <Award size={20} />
          </div>
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>{t("profile.bestHand")}</div>
            <div style={{ fontSize: "1rem", fontWeight: 800, marginTop: "0.1rem" }}>{stats.bestHandName || "Nessuna"}</div>
          </div>
        </div>

      </div>

      {/* Edit Username / Nickname Form */}
      <div className="glass-panel" style={{ padding: "1.5rem" }} id="card-edit-username">
        <h3 style={{ fontSize: "1.1rem", fontWeight: 800, fontFamily: "var(--font-display)", marginBottom: "1rem" }}>{t("profile.editUsernameTitle")}</h3>
        
        <form onSubmit={handleUpdateUsername} className="form-field-group" id="form-edit-username">
          <div className="form-field-group">
            <label className="form-label-title">{t("profile.labelUniqueUsername")}</label>
            <div className="input-with-username-at">
              <span className="input-username-at">@</span>
              <input
                id="input-edit-username"
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
                required
              />
            </div>
          </div>

          {errorMsg && (
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", color: "var(--color-danger)", fontSize: "0.8rem" }} id="edit-username-error">
              <AlertCircle size={14} />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", color: "var(--color-success)", fontSize: "0.8rem" }} id="edit-username-success">
              <Check size={14} />
              <span>{successMsg}</span>
            </div>
          )}

          <button
            id="btn-save-username"
            type="submit"
            disabled={loading || !newUsername.trim() || newUsername === username}
            className={loading || !newUsername.trim() || newUsername === username ? "" : "poker-btn-primary"}
            style={{
              padding: "0.7rem",
              borderRadius: "99px",
              border: "none",
              cursor: loading || !newUsername.trim() || newUsername === username ? "not-allowed" : "pointer",
              backgroundColor: loading || !newUsername.trim() || newUsername === username ? "rgba(75, 85, 99, 0.4)" : undefined,
              color: loading || !newUsername.trim() || newUsername === username ? "var(--text-muted)" : "var(--text-inverse)",
              fontWeight: 800,
              fontSize: "0.9rem"
            }}
          >
            {loading ? t("profile.btnSaving") : t("profile.btnSave")}
          </button>
        </form>
      </div>

    </div>
  );
}
