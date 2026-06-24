import { useNavigate } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import { PlusCircle, Users, LogOut, Info, FileText } from "lucide-react";

export default function HomePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const nickname = user?.displayName || "Giocatore";

async function handleLogout() {
  try {
    await logout();
  } finally {
    navigate("/"); // torna alla pagina di login
  }
}

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem 1rem 3rem 1rem"
      }}
    >
      <div
        className="glass-panel"
        style={{
          width: "100%",
          maxWidth: "420px",
          padding: "2rem 1.5rem",
          display: "grid",
          gap: "1.2rem"
        }}
      >
        <header style={{ display: "grid", gap: "0.3rem" }}>
          <h1 style={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1.2, fontFamily: "var(--font-display)" }}>
            {t("home.title")}
          </h1>
          <h2 style={{ fontSize: "0.95rem", fontWeight: 400, color: "var(--text-muted)", marginTop: "0.1rem" }}>
            {t("home.subtitle")}
          </h2>
          <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginTop: "0.6rem", margin: 0 }}>
            <Trans
              i18nKey="home.welcome"
              values={{ name: nickname }}
              components={{ nicknameSpan: <span style={{ color: "var(--color-success)", fontWeight: 700 }} /> }}
            />
          </p>
        </header>

        <div
          style={{
            display: "grid",
            gap: "0.85rem",
            marginTop: "0.4rem"
          }}
        >
          <button
            onClick={() => navigate("/create")}
            className="poker-btn-primary"
            style={{
              width: "100%",
              padding: "1rem",
              borderRadius: "0.9rem",
              border: "none",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: "1rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem"
            }}
          >
            <PlusCircle size={20} />
            {t("home.createTableBtn")}
          </button>

          <button
            onClick={() => navigate("/join")}
            className="poker-btn-secondary"
            style={{
              width: "100%",
              padding: "1rem",
              borderRadius: "0.9rem",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: "1rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem"
            }}
          >
            <Users size={20} />
            {t("home.joinTableBtn")}
          </button>
        </div>

        <button
          onClick={handleLogout}
          style={{
            marginTop: "0.4rem",
            width: "100%",
            padding: "0.65rem 1rem",
            borderRadius: "999px",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            cursor: "pointer",
            backgroundColor: "rgba(255, 255, 255, 0.02)",
            color: "var(--text-muted)",
            fontSize: "0.85rem",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.4rem"
          }}
        >
          <LogOut size={16} />
          {t("home.logoutBtn")}
        </button>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.8rem", paddingTop: "0.8rem", borderTop: "1px solid rgba(255, 255, 255, 0.06)" }}>
          <button
            onClick={() => navigate("/about")}
            style={{
              background: "transparent", border: "none", color: "var(--color-primary)", cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.3rem", padding: "0.3rem 0.5rem", borderRadius: "0.4rem", transition: "background 0.2s"
            }}
          >
            <Info size={15} />
            {t("home.aboutLink")}
          </button>
          
          <button
            onClick={() => navigate("/terms")}
            style={{
              background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.3rem", padding: "0.3rem 0.5rem", borderRadius: "0.4rem", transition: "background 0.2s"
            }}
          >
            <FileText size={15} />
            {t("home.termsLink")}
          </button>
        </div>
      </div>
    </div>
  );
}
