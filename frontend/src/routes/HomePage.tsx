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
        style={{
          width: "100%",
          maxWidth: "420px",
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
          <h1 style={{ fontSize: "1.6rem", fontWeight: 700, lineHeight: 1.2 }}>
            {t("home.title")}
          </h1>
          <h2 style={{ fontSize: "1rem", fontWeight: 400, color: "#9ca3af", marginTop: "0.25rem" }}>
            {t("home.subtitle")}
          </h2>
          <p style={{ fontSize: "0.9rem", color: "#9ca3af", marginTop: "0.5rem" }}>
            <Trans
              i18nKey="home.welcome"
              values={{ name: nickname }}
              components={{ nicknameSpan: <span style={{ color: "#22c55e", fontWeight: 600 }} /> }}
            />
          </p>
        </header>

        <div
          style={{
            display: "grid",
            gap: "0.75rem",
            marginTop: "0.5rem"
          }}
        >
          <button
            onClick={() => navigate("/create")}
            style={{
              width: "100%",
              padding: "0.9rem 1rem",
              borderRadius: "0.9rem",
              border: "none",
              cursor: "pointer",
              background:
                "linear-gradient(135deg, #22c55e, #4ade80, #22c55e)",
              color: "#020617",
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
            style={{
              width: "100%",
              padding: "0.9rem 1rem",
              borderRadius: "0.9rem",
              border: "1px solid #3b82f6",
              cursor: "pointer",
              backgroundColor: "transparent",
              color: "#e5e7eb",
              fontWeight: 600,
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
                marginTop: "0.5rem",
                width: "100%",
                padding: "0.6rem 1rem",
                borderRadius: "999px",
                border: "1px solid #4b5563",
                cursor: "pointer",
                backgroundColor: "transparent",
                color: "#9ca3af",
                fontSize: "0.85rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.4rem"
            }}
            >
            <LogOut size={16} />
            {t("home.logoutBtn")}
        </button>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #1f2937" }}>
          <button
            onClick={() => navigate("/about")}
            style={{
              background: "transparent", border: "none", color: "#60a5fa", cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.3rem", padding: "0.2rem"
            }}
          >
            <Info size={15} />
            {t("home.aboutLink")}
          </button>
          
          <button
            onClick={() => navigate("/terms")}
            style={{
              background: "transparent", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.3rem", padding: "0.2rem"
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
