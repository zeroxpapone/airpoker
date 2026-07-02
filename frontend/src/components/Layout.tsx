import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useLocation } from "react-router-dom";
import { Home, ShieldAlert } from "lucide-react";
import { useAuth } from "../hooks/useAuth";

interface Props {
  children: ReactNode;
}

export default function Layout({ children }: Props) {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isRegisteredUser, claimUsername, logout } = useAuth();

  const [newUsername, setNewUsername] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const currentLang = i18n.resolvedLanguage;
  const toggleLanguage = () => {
    i18n.changeLanguage(currentLang === "it" ? "en" : "it");
  };

  async function handleClaim(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    const trimmed = newUsername.trim();
    if (!trimmed) {
      setErrorMsg(t("login.errorEmptyNickname") || "Scegli un nome utente.");
      return;
    }
    try {
      setSubmitting(true);
      await claimUsername(trimmed);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Errore durante il salvataggio.");
    } finally {
      setSubmitting(false);
    }
  }

  const showHomeBtn = location.pathname !== "/home" && location.pathname !== "/";
  const showUsernameModal = user && !user.isAnonymous && !isRegisteredUser;

  return (
    <div className="app-layout" id="app-layout-root">
      <header className="app-header" id="app-header-navigation">
        {showHomeBtn && !showUsernameModal && (
          <button
            id="btn-header-home"
            onClick={() => navigate("/home")}
            className="header-btn"
            title="Home"
          >
            <Home size={18} />
          </button>
        )}

        <button
          id="btn-header-lang-toggle"
          onClick={toggleLanguage}
          className="header-btn header-btn-lang"
        >
          {currentLang === "it" ? "🇮🇹 IT" : "🇬🇧 EN"}
        </button>
      </header>
      
      <main className="app-main-content" id="app-main-view">
        {children}
      </main>

      {showUsernameModal && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(2, 6, 23, 0.9)", backdropFilter: "blur(12px)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99999
        }}>
          <div className="glass-panel" style={{
            padding: "2.5rem 2rem", maxWidth: "400px", width: "90%",
            display: "grid", gap: "1.5rem", borderRadius: "1.5rem",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)", border: "1px solid rgba(255,255,255,0.08)"
          }}>
            <div style={{ textAlign: "center" }}>
              <h2 style={{ fontSize: "1.6rem", fontWeight: 800, margin: 0, color: "#facc15" }}>
                {t("login.tabRegister") || "Registrazione"}
              </h2>
              <p style={{ fontSize: "0.9rem", color: "#9ca3af", marginTop: "0.5rem", lineHeight: 1.4 }}>
                Scegli il tuo username unico per iniziare a giocare su AirPoker.
              </p>
            </div>

            <form onSubmit={handleClaim} className="form-group" style={{ display: "grid", gap: "1rem" }}>
              <div className="form-group">
                <label className="form-label-title" htmlFor="input-new-username">
                  Username
                </label>
                <input
                  id="input-new-username"
                  type="text"
                  placeholder="Il tuo username..."
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  autoComplete="off"
                  disabled={submitting}
                  style={{
                    width: "100%", padding: "0.75rem 1rem", borderRadius: "999px",
                    backgroundColor: "rgba(15, 23, 42, 0.6)", border: "1px solid rgba(255,255,255,0.1)",
                    color: "white", outline: "none", boxSizing: "border-box"
                  }}
                />
              </div>

              {errorMsg && (
                <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", color: "var(--color-danger)", fontSize: "0.8rem" }}>
                  <ShieldAlert size={14} />
                  <span>{errorMsg}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !newUsername.trim()}
                className="poker-btn-primary"
                style={{
                  width: "100%", padding: "0.75rem 1rem", borderRadius: "999px",
                  border: "none", cursor: (submitting || !newUsername.trim()) ? "not-allowed" : "pointer",
                  fontWeight: 700, opacity: (submitting || !newUsername.trim()) ? 0.6 : 1
                }}
              >
                {submitting ? "Salvataggio..." : "Conferma"}
              </button>

              <button
                type="button"
                onClick={() => logout()}
                style={{
                  background: "transparent", border: "none", color: "#9ca3af",
                  cursor: "pointer", fontSize: "0.85rem", textDecoration: "underline",
                  textAlign: "center"
                }}
              >
                Disconnetti
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
