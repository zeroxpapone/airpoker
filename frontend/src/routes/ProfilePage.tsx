import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
   Award,
   Upload,
   Trash2,
   Mail,
   Link as LinkIcon
} from "lucide-react";
import { doc, getDoc, runTransaction, updateDoc, collection, query, where, limit, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import AdvancedStats from "../components/AdvancedStats";
import { deleteAccount } from "../lib/firestoreApi";

export default function ProfilePage() {
  const {
    user, username, isRegisteredUser, profileChecked, photoURL, updatePhotoURL,
    linkedProviderIds, linkEmailPasswordToAccount, linkGoogleToAccount
  } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();

  const [stats, setStats] = useState({
    handsPlayed: 0,
    handsWon: 0,
    totalChipsWon: 0,
    totalChipsLost: 0,
    netProfit: 0,
    sessionsPlayed: 0,
    timePlayedSeconds: 0,
    bestHandName: "",
    vpipCount: 0,
    vpipEligibleHands: 0,
    totalActions: 0,
    aggressiveActions: 0,
    stagePreflopCount: 0,
    stageFlopCount: 0,
    stageTurnCount: 0,
    stageRiverCount: 0,
    createdAt: null as any
  });

  const [newUsername, setNewUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [photoInput, setPhotoInput] = useState("");
  const [loadingPhoto, setLoadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoSuccess, setPhotoSuccess] = useState<string | null>(null);

  const [linkEmailInput, setLinkEmailInput] = useState("");
  const [linkPasswordInput, setLinkPasswordInput] = useState("");
  const [loadingLinkEmail, setLoadingLinkEmail] = useState(false);
  const [linkEmailError, setLinkEmailError] = useState<string | null>(null);
  const [linkEmailSuccess, setLinkEmailSuccess] = useState<string | null>(null);

  const [loadingLinkGoogle, setLoadingLinkGoogle] = useState(false);
  const [linkGoogleError, setLinkGoogleError] = useState<string | null>(null);

  const [loadingReset, setLoadingReset] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);

  const [showResetStatsConfirm, setShowResetStatsConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [loadingDelete, setLoadingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const advancedStatsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (photoURL) {
      setPhotoInput(photoURL);
    }
  }, [photoURL]);

  useEffect(() => {
    if (searchParams.get("tab") === "stats") {
      setTimeout(() => {
        advancedStatsRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 300);
    }
  }, [searchParams]);

  useEffect(() => {
    // Wait for the profile read before bouncing anyone: !isRegisteredUser is also true
    // while the check is still in flight, which would eject a registered user who lands
    // here right after signing in. The logged-out case is already handled by the route
    // guard in App.tsx, so this only ever decides registered-vs-guest.
    if (profileChecked && !isRegisteredUser) {
      navigate("/home");
      return;
    }
  }, [profileChecked, isRegisteredUser, navigate]);

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
              timePlayedSeconds: data.stats.timePlayedSeconds || 0,
              bestHandName: data.stats.bestHandName || "Nessuna",
              vpipCount: data.stats.vpipCount || 0,
              vpipEligibleHands: data.stats.vpipEligibleHands || 0,
              totalActions: data.stats.totalActions || 0,
              aggressiveActions: data.stats.aggressiveActions || 0,
              stagePreflopCount: data.stats.stagePreflopCount || 0,
              stageFlopCount: data.stats.stageFlopCount || 0,
              stageTurnCount: data.stats.stageTurnCount || 0,
              stageRiverCount: data.stats.stageRiverCount || 0,
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

      // 1. Check if new username is taken
      const qUnique = query(collection(db, "users"), where("usernameLowercase", "==", cleanName.toLowerCase()), limit(1));
      const snapUnique = await getDocs(qUnique);
      if (!snapUnique.empty) {
        throw new Error("Questo nome utente è già occupato.");
      }

      await runTransaction(db, async (transaction) => {
        // Update user profile document
        transaction.update(userDocRef, { 
          username: cleanName,
          usernameLowercase: cleanName.toLowerCase()
        });
      });

      setSuccessMsg(t("profile.successUsernameUpdateReload"));
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || t("profile.errUsernameUpdateGeneric"));
    } finally {
      setLoading(false);
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setPhotoError(t("profile.errNotAnImage") || "Il file selezionato non è un'immagine.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 128;
        const MAX_HEIGHT = 128;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        setPhotoInput(dataUrl);
        setPhotoError(null);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  async function handleUpdatePhoto(e: React.FormEvent) {
    e.preventDefault();
    setPhotoError(null);
    setPhotoSuccess(null);

    const cleanUrl = photoInput.trim();
    if (!cleanUrl) {
      setPhotoError(t("profile.errPhotoEmpty"));
      return;
    }

    try {
      setLoadingPhoto(true);
      await updatePhotoURL(cleanUrl);
      setPhotoSuccess(t("profile.successPhotoUpdate"));
    } catch (err: any) {
      console.error(err);
      setPhotoError(err?.message || t("profile.errPhotoUpdateGeneric"));
    } finally {
      setLoadingPhoto(false);
    }
  }

  async function handleLinkEmailPassword(e: React.FormEvent) {
    e.preventDefault();
    setLinkEmailError(null);
    setLinkEmailSuccess(null);

    if (!linkEmailInput.trim() || !linkPasswordInput) {
      setLinkEmailError(t("profile.errLinkEmailEmpty"));
      return;
    }

    try {
      setLoadingLinkEmail(true);
      await linkEmailPasswordToAccount(linkEmailInput.trim(), linkPasswordInput);
      setLinkEmailSuccess(t("profile.successLinkEmail"));
      setLinkPasswordInput("");
    } catch (err: any) {
      console.error(err);
      setLinkEmailError(err?.message || t("profile.errLinkEmailGeneric"));
    } finally {
      setLoadingLinkEmail(false);
    }
  }

  async function handleLinkGoogle() {
    setLinkGoogleError(null);
    try {
      setLoadingLinkGoogle(true);
      await linkGoogleToAccount();
    } catch (err: any) {
      console.error(err);
      setLinkGoogleError(err?.message || t("profile.errLinkGoogleGeneric"));
    } finally {
      setLoadingLinkGoogle(false);
    }
  }

  async function handleResetStats() {
    if (!user) return;

    setLoadingReset(true);
    setResetError(null);
    setResetSuccess(null);

    try {
      const userDocRef = doc(db, "users", user.uid);
      const resetData = {
        "stats.handsPlayed": 0,
        "stats.handsWon": 0,
        "stats.totalChipsWon": 0,
        "stats.totalChipsLost": 0,
        "stats.netProfit": 0,
        "stats.bestHandName": "",
        "stats.bestHandRank": -1,
        "stats.vpipCount": 0,
        "stats.vpipEligibleHands": 0,
        "stats.totalActions": 0,
        "stats.aggressiveActions": 0,
        "stats.stagePreflopCount": 0,
        "stats.stageFlopCount": 0,
        "stats.stageTurnCount": 0,
        "stats.stageRiverCount": 0
      };

      await updateDoc(userDocRef, resetData);

      setStats((prev) => ({
        ...prev,
        handsPlayed: 0,
        handsWon: 0,
        totalChipsWon: 0,
        totalChipsLost: 0,
        netProfit: 0,
        bestHandName: "",
        vpipCount: 0,
        vpipEligibleHands: 0,
        totalActions: 0,
        aggressiveActions: 0,
        stagePreflopCount: 0,
        stageFlopCount: 0,
        stageTurnCount: 0,
        stageRiverCount: 0
      }));

      setResetSuccess(t("profile.successResetStats") || "Statistiche resettate con successo!");
    } catch (err: any) {
      console.error(err);
      setResetError(err?.message || "Errore durante il reset delle statistiche.");
    } finally {
      setLoadingReset(false);
      setShowResetStatsConfirm(false);
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
          {photoURL ? (
            <img src={photoURL} alt="Avatar" />
          ) : (
            <Crown size={40} />
          )}
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

      {/* Edit Profile Photo Form */}
      <div className="glass-panel" style={{ padding: "1.5rem" }} id="card-edit-photo">
        <h3 style={{ fontSize: "1.1rem", fontWeight: 800, fontFamily: "var(--font-display)", marginBottom: "0.8rem" }}>
          {t("profile.editPhotoTitle") || "Modifica Foto Profilo"}
        </h3>
        
        <form onSubmit={handleUpdatePhoto} className="form-field-group" id="form-edit-photo">
          <div className="form-field-group">
            <label className="form-label-title" style={{ marginBottom: "0.5rem", display: "block" }}>
              {t("profile.labelUploadPhoto") || "Carica Foto Profilo"}
            </label>
            <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
              {photoInput ? (
                <img 
                  src={photoInput} 
                  alt="Preview" 
                  style={{ width: "64px", height: "64px", borderRadius: "50%", objectFit: "cover", border: "2px solid var(--color-primary)" }} 
                />
              ) : (
                <div style={{ width: "64px", height: "64px", borderRadius: "50%", backgroundColor: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Upload size={20} color="var(--text-muted)" />
                </div>
              )}
              
              <label 
                className="poker-btn-secondary" 
                style={{ 
                  padding: "0.6rem 1rem", 
                  borderRadius: "8px", 
                  cursor: "pointer", 
                  fontSize: "0.85rem", 
                  fontWeight: 600, 
                  display: "flex", 
                  alignItems: "center", 
                  gap: "0.4rem" 
                }}
              >
                <Upload size={16} />
                {t("profile.btnSelectFile") || "Scegli Immagine"}
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={handleFileChange} 
                  style={{ display: "none" }} 
                />
              </label>
            </div>
          </div>

          {photoError && (
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", color: "var(--color-danger)", fontSize: "0.8rem" }} id="edit-photo-error">
              <AlertCircle size={14} />
              <span>{photoError}</span>
            </div>
          )}

          {photoSuccess && (
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", color: "var(--color-success)", fontSize: "0.8rem" }} id="edit-photo-success">
              <Check size={14} />
              <span>{photoSuccess}</span>
            </div>
          )}

          <button
            id="btn-save-photo"
            type="submit"
            disabled={loadingPhoto || !photoInput.trim() || photoInput === photoURL}
            className={loadingPhoto || !photoInput.trim() || photoInput === photoURL ? "" : "poker-btn-primary"}
            style={{
              padding: "0.7rem",
              borderRadius: "99px",
              border: "none",
              cursor: loadingPhoto || !photoInput.trim() || photoInput === photoURL ? "not-allowed" : "pointer",
              backgroundColor: loadingPhoto || !photoInput.trim() || photoInput === photoURL ? "rgba(75, 85, 99, 0.4)" : undefined,
              color: loadingPhoto || !photoInput.trim() || photoInput === photoURL ? "var(--text-muted)" : "var(--text-inverse)",
              fontWeight: 800,
              fontSize: "0.9rem"
            }}
          >
            {loadingPhoto ? t("profile.btnSaving") : t("profile.btnSave")}
          </button>
        </form>
      </div>

      {/* Login Methods Section — link additional sign-in methods to this same account */}
      {isRegisteredUser && (
        <div className="glass-panel" style={{ padding: "1.5rem", width: "100%", marginTop: "1.5rem" }} id="login-methods-section">
          <h3 style={{ fontSize: "1.2rem", fontWeight: 800, fontFamily: "var(--font-display)", marginBottom: "0.3rem" }}>
            {t("profile.loginMethodsTitle")}
          </h3>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
            {t("profile.loginMethodsDesc")}
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {/* Google */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <LinkIcon size={16} color="var(--text-muted)" />
                <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>Google</span>
              </div>
              {linkedProviderIds.includes("google.com") ? (
                <span style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.8rem", color: "var(--color-success)", fontWeight: 700 }}>
                  <Check size={14} /> {t("profile.linked")}
                </span>
              ) : (
                <button
                  id="btn-link-google"
                  type="button"
                  onClick={handleLinkGoogle}
                  disabled={loadingLinkGoogle}
                  className="poker-btn-secondary"
                  style={{ padding: "0.5rem 1rem", borderRadius: "999px", cursor: loadingLinkGoogle ? "default" : "pointer", fontSize: "0.8rem", fontWeight: 700 }}
                >
                  {loadingLinkGoogle ? t("profile.btnSaving") : t("profile.btnLinkGoogle")}
                </button>
              )}
            </div>

            {linkGoogleError && (
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", color: "var(--color-danger)", fontSize: "0.8rem" }}>
                <AlertCircle size={14} />
                <span>{linkGoogleError}</span>
              </div>
            )}

            {/* Email / Password */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <Mail size={16} color="var(--text-muted)" />
                <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>{t("profile.emailPassword")}</span>
              </div>
              {linkedProviderIds.includes("password") && (
                <span style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.8rem", color: "var(--color-success)", fontWeight: 700 }}>
                  <Check size={14} /> {t("profile.linked")}
                </span>
              )}
            </div>

            {!linkedProviderIds.includes("password") && (
              <form onSubmit={handleLinkEmailPassword} style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                <input
                  id="input-link-email"
                  type="email"
                  value={linkEmailInput}
                  onChange={(e) => setLinkEmailInput(e.target.value)}
                  placeholder={t("profile.placeholderEmail")}
                  autoComplete="off"
                  style={{
                    width: "100%", padding: "0.65rem 1rem", borderRadius: "999px", boxSizing: "border-box",
                    backgroundColor: "rgba(15, 23, 42, 0.6)", border: "1px solid rgba(255,255,255,0.1)",
                    color: "white", outline: "none", fontSize: "0.85rem"
                  }}
                />
                <input
                  id="input-link-password"
                  type="password"
                  value={linkPasswordInput}
                  onChange={(e) => setLinkPasswordInput(e.target.value)}
                  placeholder={t("profile.placeholderPassword")}
                  autoComplete="new-password"
                  style={{
                    width: "100%", padding: "0.65rem 1rem", borderRadius: "999px", boxSizing: "border-box",
                    backgroundColor: "rgba(15, 23, 42, 0.6)", border: "1px solid rgba(255,255,255,0.1)",
                    color: "white", outline: "none", fontSize: "0.85rem"
                  }}
                />

                {linkEmailError && (
                  <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", color: "var(--color-danger)", fontSize: "0.8rem" }}>
                    <AlertCircle size={14} />
                    <span>{linkEmailError}</span>
                  </div>
                )}
                {linkEmailSuccess && (
                  <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", color: "var(--color-success)", fontSize: "0.8rem" }}>
                    <Check size={14} />
                    <span>{linkEmailSuccess}</span>
                  </div>
                )}

                <button
                  id="btn-link-email"
                  type="submit"
                  disabled={loadingLinkEmail || !linkEmailInput.trim() || !linkPasswordInput}
                  className="poker-btn-secondary"
                  style={{
                    padding: "0.6rem", borderRadius: "999px",
                    cursor: loadingLinkEmail || !linkEmailInput.trim() || !linkPasswordInput ? "default" : "pointer",
                    fontSize: "0.85rem", fontWeight: 700,
                    opacity: loadingLinkEmail || !linkEmailInput.trim() || !linkPasswordInput ? 0.6 : 1
                  }}
                >
                  {loadingLinkEmail ? t("profile.btnSaving") : t("profile.btnLinkEmail")}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Advanced Statistics Section */}
      <div ref={advancedStatsRef} style={{ width: "100%" }}>
        <h3 style={{ fontSize: "1.2rem", fontWeight: 800, fontFamily: "var(--font-display)", marginTop: "1.5rem", marginBottom: "0.5rem" }}>
          {t("stats.title") || "Statistiche Dettagliate"}
        </h3>
        <AdvancedStats stats={stats} />
      </div>

      {/* Reset Stats Section */}
      <div style={{ marginTop: "2rem", width: "100%", display: "flex", flexDirection: "column", gap: "0.8rem", alignItems: "center" }} id="reset-stats-container">
        {resetSuccess && (
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", color: "var(--color-success)", fontSize: "0.8rem" }} id="reset-stats-success">
            <Check size={14} />
            <span>{resetSuccess}</span>
          </div>
        )}
        {resetError && (
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", color: "var(--color-danger)", fontSize: "0.8rem" }} id="reset-stats-error">
            <AlertCircle size={14} />
            <span>{resetError}</span>
          </div>
        )}
        <button
          id="btn-reset-stats"
          type="button"
          onClick={() => setShowResetStatsConfirm(true)}
          disabled={loadingReset}
          style={{
            padding: "0.75rem 1.5rem",
            borderRadius: "99px",
            border: "1px solid rgba(239, 68, 68, 0.4)",
            cursor: loadingReset ? "not-allowed" : "pointer",
            backgroundColor: "rgba(239, 68, 68, 0.08)",
            color: "#ef4444",
            fontWeight: 800,
            fontSize: "0.85rem",
            width: "100%",
            maxWidth: "280px",
            transition: "all 0.2s ease"
          }}
          onMouseEnter={(e) => {
            if (!loadingReset) {
              e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.15)";
              e.currentTarget.style.borderColor = "#ef4444";
            }
          }}
          onMouseLeave={(e) => {
            if (!loadingReset) {
              e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.08)";
              e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.4)";
            }
          }}
        >
          {loadingReset ? t("profile.btnResetting") || "Reset in corso..." : t("profile.btnResetStats") || "Resetta tutte le statistiche"}
        </button>

        {/* ---- Danger Zone: Elimina Account ---- */}
        <div style={{
          marginTop: "2rem",
          paddingTop: "1.5rem",
          borderTop: "1px solid rgba(239, 68, 68, 0.2)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.5rem"
        }}>
          <p style={{ fontSize: "0.8rem", color: "#9ca3af", margin: 0, textAlign: "center" }}>
            Questa azione è <strong style={{ color: "#ef4444" }}>irreversibile</strong>: tutti i tuoi dati verranno eliminati permanentemente.
          </p>
          {deleteError && (
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", color: "var(--color-danger)", fontSize: "0.8rem" }}>
              <AlertCircle size={14} />
              <span>{deleteError}</span>
            </div>
          )}
          <button
            id="btn-delete-account"
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            style={{
              padding: "0.75rem 1.5rem",
              borderRadius: "99px",
              border: "1.5px solid rgba(239, 68, 68, 0.6)",
              cursor: "pointer",
              backgroundColor: "rgba(239, 68, 68, 0.1)",
              color: "#ef4444",
              fontWeight: 800,
              fontSize: "0.85rem",
              width: "100%",
              maxWidth: "280px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.4rem",
              transition: "all 0.2s ease"
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.2)";
              e.currentTarget.style.borderColor = "#ef4444";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.1)";
              e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.6)";
            }}
          >
            <Trash2 size={15} />
            Elimina account
          </button>
        </div>
      </div>

      {/* ---- Confirm Reset Stats Modal ---- */}
      {showResetStatsConfirm && (
        <div
          className="modal-overlay"
          id="modal-reset-stats"
          style={{ zIndex: 2000 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowResetStatsConfirm(false); }}
        >
          <div className="glass-panel modal-panel-box" style={{
            maxWidth: "360px",
            padding: "2rem",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: "1.2rem"
          }}>
            <div>
              <h3 style={{ fontSize: "1.2rem", fontWeight: 800, margin: 0 }}>{t("profile.btnResetStats")}</h3>
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.6rem", lineHeight: 1.5 }}>
                {t("profile.confirmResetStats") || "Sei sicuro di voler resettare tutte le tue statistiche? Questa azione manterrà solo il tempo di gioco."}
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.8rem" }}>
              <button
                id="btn-cancel-reset-stats"
                onClick={() => setShowResetStatsConfirm(false)}
                disabled={loadingReset}
                className="poker-btn-secondary"
                style={{ flex: 1, padding: "0.7rem", borderRadius: "99px", fontWeight: 700 }}
              >
                {t("table.cancel")}
              </button>
              <button
                id="btn-confirm-reset-stats"
                onClick={handleResetStats}
                disabled={loadingReset}
                style={{
                  flex: 1,
                  padding: "0.7rem",
                  borderRadius: "99px",
                  border: "none",
                  backgroundColor: loadingReset ? "#6b1d1d" : "#ef4444",
                  color: "#fff",
                  fontWeight: 700,
                  cursor: loadingReset ? "not-allowed" : "pointer"
                }}
              >
                {loadingReset ? t("profile.btnResetting") : t("profile.btnResetStatsConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Confirm Delete Modal ---- */}
      {showDeleteConfirm && (
        <div
          className="modal-overlay"
          id="modal-delete-account"
          style={{ zIndex: 2000 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowDeleteConfirm(false); }}
        >
          <div className="glass-panel modal-panel-box" style={{
            maxWidth: "360px",
            padding: "2rem",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: "1.2rem"
          }}>
            <div style={{ color: "#ef4444", display: "flex", justifyContent: "center" }}>
              <Trash2 size={44} />
            </div>
            <div>
              <h3 style={{ fontSize: "1.2rem", fontWeight: 800, margin: 0 }}>Elimina account</h3>
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.6rem", lineHeight: 1.5 }}>
                Stai per eliminare definitivamente il tuo account e tutti i dati associati (statistiche, amici, inviti).
                <br /><strong style={{ color: "#ef4444" }}>Questa azione non può essere annullata.</strong>
              </p>
            </div>
            {deleteError && (
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", color: "var(--color-danger)", fontSize: "0.8rem", justifyContent: "center" }}>
                <AlertCircle size={14} />
                <span>{deleteError}</span>
              </div>
            )}
            <div style={{ display: "flex", gap: "0.8rem" }}>
              <button
                id="btn-cancel-delete-account"
                onClick={() => { setShowDeleteConfirm(false); setDeleteError(null); }}
                disabled={loadingDelete}
                className="poker-btn-secondary"
                style={{ flex: 1, padding: "0.7rem", borderRadius: "99px", fontWeight: 700 }}
              >
                Annulla
              </button>
              <button
                id="btn-confirm-delete-account"
                onClick={async () => {
                  if (!user) return;
                  setLoadingDelete(true);
                  setDeleteError(null);
                  try {
                    await deleteAccount(user);
                    localStorage.clear();
                    navigate("/");
                  } catch (err: any) {
                    if (err.code === "auth/requires-recent-login") {
                      setDeleteError("Per sicurezza, esci e rientra nell'account prima di eliminarlo.");
                    } else {
                      setDeleteError(err.message || "Errore durante l'eliminazione.");
                    }
                  } finally {
                    setLoadingDelete(false);
                  }
                }}
                disabled={loadingDelete}
                style={{
                  flex: 1,
                  padding: "0.7rem",
                  borderRadius: "99px",
                  border: "none",
                  backgroundColor: loadingDelete ? "#6b1d1d" : "#ef4444",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: "0.9rem",
                  cursor: loadingDelete ? "not-allowed" : "pointer",
                  transition: "background 0.2s ease"
                }}
              >
                {loadingDelete ? "Eliminazione..." : "Sì, elimina"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
