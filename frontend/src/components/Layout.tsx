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
        background: "radial-gradient(circle at center, #0f172a 0%, #000000 100%)",
        color: "#e2e8f0",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
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
              background: "rgba(15, 23, 42, 0.7)",
              color: "#e2e8f0",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "0.5rem",
              padding: "0.4rem 0.6rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.5)"
            }}
            title="Home"
          >
            <Home size={18} />
          </button>
        )}

        <button
          onClick={toggleLanguage}
          style={{
            background: "rgba(15, 23, 42, 0.7)",
            color: "#e2e8f0",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "0.5rem",
            padding: "0.4rem 0.7rem",
            fontSize: "0.85rem",
            cursor: "pointer",
            fontWeight: 600,
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.5)"
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
