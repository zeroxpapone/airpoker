import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useLocation } from "react-router-dom";
import { Home } from "lucide-react";

interface Props {
  children: ReactNode;
}

export default function Layout({ children }: Props) {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const currentLang = i18n.resolvedLanguage;
  const toggleLanguage = () => {
    i18n.changeLanguage(currentLang === "it" ? "en" : "it");
  };

  const showHomeBtn = location.pathname !== "/home" && location.pathname !== "/";

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "radial-gradient(circle at 50% 20%, #0f172a 0%, #020617 80%, #000000 100%)",
        color: "var(--text-main)",
        fontFamily: "var(--font-sans)"
      }}
    >
      <header style={{ 
        display: "flex", 
        justifyContent: "flex-end", 
        padding: "1.2rem 1.2rem 0 1.2rem", 
        gap: "0.5rem",
        zIndex: 10
      }}>
        {showHomeBtn && (
          <button
            onClick={() => navigate("/home")}
            style={{
              background: "rgba(15, 23, 42, 0.65)",
              color: "var(--text-main)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "0.6rem",
              padding: "0.45rem 0.65rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
              backdropFilter: "blur(8px)",
              transition: "all 0.2s"
            }}
            title="Home"
          >
            <Home size={18} />
          </button>
        )}

        <button
          onClick={toggleLanguage}
          style={{
            background: "rgba(15, 23, 42, 0.65)",
            color: "var(--text-main)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "0.6rem",
            padding: "0.45rem 0.8rem",
            fontSize: "0.85rem",
            cursor: "pointer",
            fontWeight: 600,
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
            backdropFilter: "blur(8px)",
            transition: "all 0.2s"
          }}
        >
          {currentLang === "it" ? "🇮🇹 IT" : "🇬🇧 EN"}
        </button>
      </header>
      
      <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {children}
      </main>
    </div>
  );
}
